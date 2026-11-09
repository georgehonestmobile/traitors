import crypto from "node:crypto";
import * as slack from "./slack";
import * as msg from "./messages";
import { getStore, type Delivery, type Player, type Round } from "./store";

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
};

export async function createRound(input: CreateRoundInput): Promise<Round> {
  const now = Date.now();
  const title = (input.title ?? "").trim().slice(0, 100) || "Banishment vote";

  const ids = [...new Set(input.playerIds ?? [])];
  if (ids.length < 2) throw new RoundError("Select at least two players.");

  let opens = input.opensAt ? Date.parse(input.opensAt) : now;
  const closes = Date.parse(input.closesAt);
  if (Number.isNaN(opens) || Number.isNaN(closes)) throw new RoundError("Invalid date.");
  if (opens < now) opens = now;
  if (closes <= now) throw new RoundError("The deadline must be in the future.");
  if (closes - opens < 60 * 1000) throw new RoundError("Voting must stay open for at least a minute.");
  if (closes - now > MAX_SCHEDULE_MS) throw new RoundError("Slack can only schedule up to 120 days ahead.");

  // Resolve names from Slack rather than trusting the browser.
  const directory = new Map((await slack.listPlayers()).map((p) => [p.id, p]));
  const players: Player[] = ids.map((id) => {
    const p = directory.get(id);
    if (!p) throw new RoundError(`Unknown Slack user: ${id}`);
    return p;
  });

  const round: Round = {
    id: crypto.randomUUID().slice(0, 8),
    title,
    opensAt: new Date(opens).toISOString(),
    closesAt: new Date(closes).toISOString(),
    createdAt: new Date(now).toISOString(),
    players,
    delivery: {},
  };
  const store = getStore();
  await store.saveRound(round);

  const sendNow = opens - now < SEND_NOW_WINDOW_MS;
  await eachLimited(players, 3, async (p) => {
    const d: Delivery = {};
    round.delivery[p.id] = d;
    try {
      d.channel = await slack.openDm(p.id);
      const vote = msg.voteMessage(round, p);
      if (sendNow) d.ts = await slack.postMessage(d.channel, vote);
      else d.scheduledId = await slack.scheduleMessage(d.channel, new Date(opens), vote);
      d.closeScheduledId = await slack.scheduleMessage(d.channel, new Date(closes), msg.deadlineMessage(round));
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

/** Called when a player picks someone in their DM. Returns the message to replace their DM with. */
export async function castVote(args: { roundId: string; voterId: string; targetId: string }) {
  const store = getStore();
  const round = await store.getRound(args.roundId);
  if (!round) return msg.notEligibleMessage();

  const voter = round.players.find((p) => p.id === args.voterId);
  if (!voter) return msg.notEligibleMessage();

  const status = roundStatus(round);
  if (status === "cancelled") return msg.cancelledMessage(round);
  if (status === "scheduled") return msg.notOpenMessage(round);

  const existing = (await store.getVotes(round.id)).find((v) => v.voterId === voter.id);
  if (status === "closed") return msg.closedMessage(round, { voted: !!existing });

  const target = round.players.find((p) => p.id === args.targetId);
  if (!target) return msg.notEligibleMessage();

  if (existing) return msg.alreadyVotedMessage(round, round.players.find((p) => p.id === existing.targetId));

  const recorded = await store.castVote(round.id, {
    voterId: voter.id,
    targetId: target.id,
    at: new Date().toISOString(),
  });
  if (!recorded) return msg.alreadyVotedMessage(round);
  return msg.votedMessage(round, target);
}
