import crypto from "node:crypto";
import * as slack from "./slack";
import * as msg from "./messages";
import { activeIds, getCurrentGame, getNotPlaying } from "./game";
import { getStore, rsvpKey, type Delivery, type Player, type Round, type Rsvp } from "./store";
import { addDays, appTimeZone, ymdIn, zonedTime } from "./time";

export type RoundStatus = "scheduled" | "open" | "closed" | "cancelled";

/** Slack only allows scheduling messages up to 120 days ahead. */
const MAX_SCHEDULE_MS = 120 * 24 * 60 * 60 * 1000;
/** Anything opening sooner than this is sent straight away rather than scheduled. */
const SEND_NOW_WINDOW_MS = 30 * 1000;

export class RoundError extends Error {}

export function effectiveCloseAt(r: Round): number {
  const close = Date.parse(r.closesAt);
  return r.closedEarlyAt ? Math.min(close, Date.parse(r.closedEarlyAt)) : close;
}

export function roundStatus(r: Round, now = Date.now()): RoundStatus {
  if (r.cancelledAt) return "cancelled";
  if (now >= effectiveCloseAt(r)) return "closed";
  if (now < Date.parse(r.opensAt)) return "scheduled";
  return "open";
}

/** Run fn over items with limited concurrency (keeps us well inside Slack rate limits). */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type CreateRoundInput = {
  title?: string;
  playerIds: string[];
  /** ISO string; omitted or in the past means "open now" */
  opensAt?: string;
  closesAt: string;
  test?: boolean;
  /** "meeting": RSVP the day before, then vote live in the meeting (opensAt/closesAt are ignored). */
  format?: "remote" | "meeting";
  /** ISO start of the meeting. */
  meetingAt?: string;
  /** The schedule event this round is for. */
  scheduleId?: string;
};

const HOUR = 60 * 60 * 1000;
/** Grace for slow clicks after the one-minute meeting vote. */
export const MEETING_VOTE_MS = 60 * 1000;
const MEETING_GRACE_MS = 3 * 1000;

/**
 * RSVPs open at 9am the day before the meeting and close at 5pm (in APP_TIMEZONE).
 * If that's already passed, they open now and close an hour later (never after the meeting).
 */
export function rsvpWindow(meetingAt: number, now = Date.now()) {
  const tz = appTimeZone();
  const dayBefore = addDays(ymdIn(new Date(meetingAt), tz), -1);
  let opens = zonedTime(dayBefore, 9, 0, tz).getTime();
  let closes = zonedTime(dayBefore, 17, 0, tz).getTime();
  if (opens < now) opens = now;
  if (closes <= opens) closes = opens + HOUR;
  if (closes > meetingAt) closes = meetingAt;
  return { opens, closes };
}

export async function createRound(input: CreateRoundInput): Promise<Round> {
  const now = Date.now();
  const title = (input.title ?? "").trim().slice(0, 100) || "Banishment vote";

  const ids = [...new Set(input.playerIds ?? [])];
  if (ids.length < 2) throw new RoundError("Select at least two players.");

  const meeting = input.format === "meeting";
  let meetingAt = NaN;
  let rsvp = { opens: 0, closes: 0 };
  if (meeting) {
    meetingAt = Date.parse(input.meetingAt ?? "");
    if (Number.isNaN(meetingAt)) throw new RoundError("Choose when the meeting is.");
    if (meetingAt - now < 60 * 1000) throw new RoundError("The meeting must be in the future.");
    rsvp = rsvpWindow(meetingAt, now);
  }
  let opens = meeting ? rsvp.opens : input.opensAt ? Date.parse(input.opensAt) : now;
  // Meeting rounds stay open until votes are requested in the meeting (or 12 hours after it starts).
  const closes = meeting ? meetingAt + 12 * HOUR : Date.parse(input.closesAt);
  if (Number.isNaN(opens) || Number.isNaN(closes)) throw new RoundError("Invalid date.");
  if (opens < now) opens = now;
  if (closes <= now) throw new RoundError("The deadline must be in the future.");
  if (closes - opens < 60 * 1000) throw new RoundError("Voting must stay open for at least a minute.");
  if (closes - now > MAX_SCHEDULE_MS) throw new RoundError("Slack can only schedule up to 120 days ahead.");

  // Resolve names from Slack rather than trusting the browser.
  const everyone = await slack.listPlayers();
  const directory = new Map(everyone.map((p) => [p.id, p]));
  const players: Player[] = ids.map((id) => {
    const p = directory.get(id);
    if (!p) throw new RoundError(`Unknown Slack user: ${id}`);
    return p;
  });
  const game = await getCurrentGame();
  if (game.status === "ended" && !input.test) throw new RoundError(`${game.name} has ended. Start a new game first.`);
  const notPlaying = new Set(await getNotPlaying(everyone));
  // With a cast, only players still in the game can take part; without one, anyone can.
  const active = new Set(activeIds(game));
  const barred = players.filter((p) => notPlaying.has(p.id) || (game.cast.length > 0 && !active.has(p.id)));
  if (barred.length) {
    throw new RoundError(`${barred.map((p) => p.name).join(", ")} can't play: not in the game, out, or marked as not playing.`);
  }

  const round: Round = {
    id: crypto.randomUUID().slice(0, 8),
    title,
    opensAt: new Date(opens).toISOString(),
    closesAt: new Date(closes).toISOString(),
    createdAt: new Date(now).toISOString(),
    players,
    delivery: {},
    gameId: game.id,
    ...(input.test ? { test: true } : {}),
    ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
    ...(meeting
      ? {
          format: "meeting" as const,
          meeting: {
            at: new Date(meetingAt).toISOString(),
            rsvpOpensAt: new Date(rsvp.opens).toISOString(),
            rsvpClosesAt: new Date(rsvp.closes).toISOString(),
          },
        }
      : {}),
  };
  const store = getStore();
  await store.saveRound(round);
  if (round.test) return round; // nobody is messaged

  const sendNow = opens - now < SEND_NOW_WINDOW_MS;
  await eachLimited(players, 3, async (p) => {
    const d: Delivery = {};
    round.delivery[p.id] = d;
    try {
      d.channel = await slack.openDm(p.id);
      // Meeting rounds start with an RSVP; remote rounds with the ballot itself.
      const first = meeting ? msg.rsvpMessage(round) : msg.voteMessage(round, p);
      if (sendNow) d.ts = await slack.postMessage(d.channel, first);
      else d.scheduledId = await slack.scheduleMessage(d.channel, new Date(opens), first);
      if (!meeting) d.closeScheduledId = await slack.scheduleMessage(d.channel, new Date(closes), msg.deadlineMessage(round));
    } catch (e) {
      d.error = errMsg(e);
    }
  });

  await store.saveRound(round);
  return round;
}

async function load(id: string) {
  const round = await getStore().getRound(id);
  if (!round) throw new RoundError("Round not found.");
  return round;
}

/** End voting now. Non-voters' DMs are updated (or replaced) with a "closed" notice. */
export async function closeRound(id: string): Promise<Round> {
  const round = await load(id);
  if (roundStatus(round) !== "open") throw new RoundError("Only an open round can be closed early.");

  round.closedEarlyAt = new Date().toISOString();
  const store = getStore();
  await store.saveRound(round); // enforce the new deadline immediately

  const voted = new Set((await store.getVotes(id)).map((v) => v.voterId));
  await eachLimited(round.players, 3, async (p) => {
    const d = round.delivery[p.id];
    if (!d?.channel) return;
    try {
      if (d.closeScheduledId) {
        await slack.deleteScheduledMessage(d.channel, d.closeScheduledId).catch(() => {});
        d.closeScheduledId = undefined;
      }
      const closed = msg.closedMessage(round, { voted: voted.has(p.id) });
      if (voted.has(p.id)) await slack.postMessage(d.channel, closed);
      else if (d.ts) await slack.updateMessage(d.channel, d.ts, closed);
      else await slack.postMessage(d.channel, closed); // scheduled DM already posted; we don't know its ts
    } catch (e) {
      d.error = errMsg(e);
    }
  });

  await store.saveRound(round);
  return round;
}

/** Call off a round. Scheduled DMs are deleted; sent ones are marked as cancelled. */
export async function cancelRound(id: string): Promise<Round> {
  const round = await load(id);
  const status = roundStatus(round);
  if (status === "cancelled" || status === "closed") throw new RoundError(`This round is already ${status}.`);

  round.cancelledAt = new Date().toISOString();
  const store = getStore();
  await store.saveRound(round);

  await eachLimited(round.players, 3, async (p) => {
    const d = round.delivery[p.id];
    if (!d?.channel) return;
    try {
      if (d.closeScheduledId) {
        await slack.deleteScheduledMessage(d.channel, d.closeScheduledId).catch(() => {});
        d.closeScheduledId = undefined;
      }
      if (status === "scheduled" && d.scheduledId) {
        await slack.deleteScheduledMessage(d.channel, d.scheduledId);
        d.scheduledId = undefined;
      } else if (d.ts) {
        await slack.updateMessage(d.channel, d.ts, msg.cancelledMessage(round));
      } else {
        await slack.postMessage(d.channel, msg.cancelledMessage(round));
      }
    } catch (e) {
      d.error = errMsg(e);
    }
  });

  await store.saveRound(round);
  return round;
}

export type VoteOutcome = "recorded" | "already" | "closed" | "not_open" | "cancelled" | "ineligible";

/**
 * Record a vote. Used when a player picks someone in their DM, and by the host in test rounds.
 * Returns the outcome plus the message to replace the player's DM with.
 */
export async function castVote(args: { roundId: string; voterId: string; targetId: string }) {
  const result = (outcome: VoteOutcome, message: ReturnType<typeof msg.votedMessage>) => ({ outcome, message });
  const store = getStore();
  const round = await store.getRound(args.roundId);
  if (!round) return result("ineligible", msg.notEligibleMessage());

  const voter = round.players.find((p) => p.id === args.voterId);
  if (!voter) return result("ineligible", msg.notEligibleMessage());

  const status = roundStatus(round);
  if (status === "cancelled") return result("cancelled", msg.cancelledMessage(round));
  if (status === "scheduled") return result("not_open", msg.notOpenMessage(round));

  const existing = (await store.getVotes(round.id)).find((v) => v.voterId === voter.id);
  if (status === "closed") return result("closed", msg.closedMessage(round, { voted: !!existing }));

  const target = round.players.find((p) => p.id === args.targetId);
  // Picked from an older ballot someone who has since been murdered or banished.
  if (!target) {
    if (existing) return result("already", msg.alreadyVotedMessage(round, round.players.find((p) => p.id === existing.targetId)));
    return result("ineligible", msg.targetGoneMessage(round, voter));
  }

  if (existing) {
    return result("already", msg.alreadyVotedMessage(round, round.players.find((p) => p.id === existing.targetId)));
  }

  // Meeting rounds: vote in advance only if you said you can't come; otherwise in the meeting's minute.
  if (round.format === "meeting" && round.meeting && !round.test) {
    const m = round.meeting;
    const now = Date.now();
    const inMeeting = !!m.requestedAt && now >= Date.parse(m.requestedAt) && now < Date.parse(m.votingClosesAt!) + MEETING_GRACE_MS;
    if (!inMeeting) {
      const rsvp = (await store.getFields<Rsvp>(rsvpKey(round.id)))[voter.id];
      const advance = !m.requestedAt && rsvp?.answer === "no" && now < Date.parse(m.at);
      if (!advance) return result("not_open", msg.meetingWaitMessage(round));
    }
  }

  const recorded = await store.castVote(round.id, {
    voterId: voter.id,
    targetId: target.id,
    at: new Date().toISOString(),
  });
  if (!recorded) return result("already", msg.alreadyVotedMessage(round));
  return result("recorded", msg.votedMessage(round, target));
}
