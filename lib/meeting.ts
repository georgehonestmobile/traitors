import * as msg from "./messages";
import { MEETING_VOTE_MS, RoundError, roundStatus } from "./rounds";
import * as slack from "./slack";
import { getStore, rsvpKey, type Round, type Rsvp } from "./store";

/**
 * Meeting banishments:
 *  1. The day before (9am), each player is asked whether they'll be at the meeting (reply by 5pm).
 *  2. "No" replies get a ballot straight away: an advance vote, read out by the host.
 *  3. In the meeting, the host requests votes: everyone who hasn't voted gets a ballot with one minute
 *     to vote. Votes not made in time don't count.
 *  4. The host runs the face-to-face script.
 */

const GRACE_MS = 3 * 1000;

export async function getRsvps(roundId: string) {
  return getStore().getFields<Rsvp>(rsvpKey(roundId));
}

async function load(id: string) {
  const round = await getStore().getRound(id);
  if (!round) throw new RoundError("Round not found.");
  if (round.format !== "meeting" || !round.meeting) throw new RoundError("This isn't a meeting banishment.");
  return round;
}

/** A player answered the RSVP. Returns the message to replace their DM with. */
export async function recordRsvp(roundId: string, voterId: string, answer: "yes" | "no") {
  const store = getStore();
  const round = await store.getRound(roundId);
  if (!round?.meeting) return msg.notEligibleMessage();
  const voter = round.players.find((p) => p.id === voterId);
  if (!voter) return msg.notEligibleMessage();
  if (roundStatus(round) === "cancelled") return msg.cancelledMessage(round);

  const m = round.meeting;
  const now = Date.now();
  if (m.requestedAt || now > Date.parse(m.rsvpClosesAt) + GRACE_MS) return msg.rsvpClosedMessage(round);

  const voted = (await store.getVotes(roundId)).find((v) => v.voterId === voterId);
  if (voted) return msg.alreadyVotedMessage(round, round.players.find((p) => p.id === voted.targetId));

  await store.setField(rsvpKey(roundId), voterId, { answer, at: new Date(now).toISOString() } satisfies Rsvp);
  return msg.rsvpAnsweredMessage(round, voter, answer, now < Date.parse(m.rsvpClosesAt));
}

/** In the meeting: open the one-minute vote and DM a ballot to everyone who hasn't voted. */
export async function requestVotes(roundId: string): Promise<Round> {
  const store = getStore();
  const round = await load(roundId);
  const status = roundStatus(round);
  if (status !== "open") throw new RoundError(status === "scheduled" ? "RSVPs haven't gone out yet." : `This round is ${status}.`);
  const m = round.meeting!;
  if (m.requestedAt) throw new RoundError("Votes have already been requested.");

  const now = Date.now();
  m.requestedAt = new Date(now).toISOString();
  m.votingClosesAt = new Date(now + MEETING_VOTE_MS).toISOString();
  round.closesAt = new Date(now + MEETING_VOTE_MS + GRACE_MS).toISOString();
  m.ballots = {};
  await store.saveRound(round); // open the window before any ballot arrives
  if (round.test) return round;

  const voted = new Set((await store.getVotes(roundId)).map((v) => v.voterId));
  const recipients = round.players.filter((p) => !voted.has(p.id));
  await Promise.all(
    recipients.map(async (p) => {
      const b: { channel?: string; ts?: string; error?: string } = {};
      m.ballots![p.id] = b;
      try {
        b.channel = round.delivery[p.id]?.channel ?? (await slack.openDm(p.id));
        b.ts = await slack.postMessage(b.channel, msg.meetingBallotMessage(round, p));
      } catch (e) {
        b.error = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  await store.saveRound(round);
  return round;
}

/**
 * Close the meeting vote: when the minute is up, or early if `now` is set (e.g. everyone has voted).
 * Ballots that weren't used are updated to say time's up.
 */
export async function finishMeetingVote(roundId: string, opts: { now?: boolean } = {}): Promise<Round> {
  const store = getStore();
  const round = await load(roundId);
  const m = round.meeting!;
  if (!m.requestedAt) throw new RoundError("Votes haven't been requested yet.");
  if (m.finishedAt) return round;
  const now = Date.now();
  if (!opts.now && now < Date.parse(m.votingClosesAt!)) return round; // not yet

  if (opts.now && now < Date.parse(round.closesAt)) round.closedEarlyAt = new Date(now).toISOString();
  m.finishedAt = new Date(now).toISOString();
  await store.saveRound(round);

  const voted = new Set((await store.getVotes(roundId)).map((v) => v.voterId));
  await Promise.all(
    Object.entries(m.ballots ?? {}).map(async ([playerId, b]) => {
      if (voted.has(playerId) || !b.channel || !b.ts) return;
      await slack.updateMessage(b.channel, b.ts, msg.timeUpMessage(round)).catch(() => {});
    }),
  );
  return round;
}
