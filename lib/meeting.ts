import * as msg from "./messages";
import { MEETING_VOTE_MS, RoundError, roundStatus } from "./rounds";
import * as slack from "./slack";
import { getReveal, paperSettled } from "./reveal";
import { getStore, joinLocksAt, paperKey, rsvpKey, type JoinMode, type PaperEntry, type Round, type Rsvp } from "./store";

/**
 * Meeting banishments:
 *  1. The day before (9am), each player is asked whether they'll be at the meeting, in the office or
 *     dialling in (reply by 5pm). Attendees can switch between the two until an hour before.
 *  2. "Can't make it" replies get a ballot straight away: an advance vote, read out by the host.
 *  3. In the meeting, the host requests votes: everyone who hasn't voted, except those in the office,
 *     gets a ballot with one minute to vote. Votes not made in time don't count.
 *  4. The office votes on paper.
 *  5. The host runs the face-to-face script. Office voters reveal their paper when called on, and
 *     whoever is helping enters each name on the round page as it's revealed.
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

export type RsvpChoice = "yes" | "no" | JoinMode;

const lockLabel = (iso: string) => `<!date^${Math.floor(Date.parse(iso) / 1000)}^{time}|${new Date(iso).toUTCString()}>`;

/** A player answered the RSVP (or switched between the office and dialling in). Returns the message to replace their DM with. */
export async function recordRsvp(roundId: string, voterId: string, choice: RsvpChoice) {
  const store = getStore();
  const round = await store.getRound(roundId);
  if (!round?.meeting) return msg.notEligibleMessage();
  const voter = round.players.find((p) => p.id === voterId);
  if (!voter) return msg.notEligibleMessage();
  if (roundStatus(round) === "cancelled") return msg.cancelledMessage(round);

  const m = round.meeting;
  const now = Date.now();
  const current = (await getRsvps(roundId))[voterId];
  // Coming or not: until 5pm the day before. Office or dialling in: until an hour before the meeting.
  const answerOpen = !m.requestedAt && now <= Date.parse(m.rsvpClosesAt) + GRACE_MS;
  const joinOpen = !m.requestedAt && now <= Date.parse(joinLocksAt(m)) + GRACE_MS;
  const can = { answer: !m.requestedAt && now < Date.parse(m.rsvpClosesAt), join: !m.requestedAt && now < Date.parse(joinLocksAt(m)) };

  const answer = choice === "no" ? "no" : "yes";
  const join = choice === "office" || choice === "dial-in" ? choice : current?.answer === "yes" ? current.join : undefined;
  const switchingJoin = current?.answer === "yes" && answer === "yes";

  if (switchingJoin ? !joinOpen : !answerOpen) {
    if (current?.answer === "yes") {
      const notice = !joinOpen
        ? `This was locked in at ${lockLabel(joinLocksAt(m))}. If something's changed, let the host know.`
        : `Replies closed ${lockLabel(m.rsvpClosesAt)}, so you can't switch to voting in advance now. If you can't make it, let the host know.`;
      return msg.rsvpAnsweredMessage(round, voter, current, can, notice);
    }
    return msg.rsvpClosedMessage(round);
  }

  const voted = (await store.getVotes(roundId)).find((v) => v.voterId === voterId);
  if (voted) return msg.alreadyVotedMessage(round, round.players.find((p) => p.id === voted.targetId));

  const at = new Date(now).toISOString();
  const rsvp: Rsvp = {
    answer,
    at: switchingJoin ? current.at : at,
    ...(answer === "yes" && join ? { join, joinAt: join === current?.join ? current.joinAt ?? at : at } : {}),
  };
  await store.setField(rsvpKey(roundId), voterId, rsvp);
  return msg.rsvpAnsweredMessage(round, voter, rsvp, can);
}

/** Attendees who said they'd come but not how (they replied before the office/dial-in choice existed). */
export async function undecidedAttendees(round: Round) {
  const rsvps = await getRsvps(round.id);
  return round.players.filter((p) => rsvps[p.id]?.answer === "yes" && !rsvps[p.id].join);
}

/** DM attendees who haven't said whether they're in the office or dialling in. Returns how many were asked. */
export async function askHowJoining(roundId: string) {
  const store = getStore();
  const round = await load(roundId);
  const m = round.meeting!;
  if (m.requestedAt) throw new RoundError("Votes have already been requested.");
  if (Date.now() >= Date.parse(joinLocksAt(m))) throw new RoundError("It's less than an hour until the meeting, so choices are locked.");
  const who = await undecidedAttendees(round);
  if (!who.length) throw new RoundError("Everyone coming has already said how they're joining.");
  const failed: string[] = [];
  if (!round.test) {
    await Promise.all(
      who.map(async (p) => {
        try {
          const channel = round.delivery[p.id]?.channel ?? (await slack.openDm(p.id));
          await slack.postMessage(channel, msg.joinQuestionMessage(round));
        } catch (e) {
          console.error(e);
          failed.push(p.name);
        }
      }),
    );
  }
  m.joinAskedAt = new Date().toISOString();
  await store.saveRound(round);
  return { asked: who.length - failed.length, failed };
}

/** The host sets how someone is joining (e.g. they told the host in person). Until votes are requested. */
export async function setAttendance(roundId: string, playerId: string, join: JoinMode) {
  const store = getStore();
  const round = await load(roundId);
  if (round.meeting!.requestedAt) throw new RoundError("Votes have already been requested.");
  if (!round.players.some((p) => p.id === playerId)) throw new RoundError("That player isn't in this round.");
  const current = (await getRsvps(roundId))[playerId];
  const at = new Date().toISOString();
  await store.setField(rsvpKey(roundId), playerId, {
    answer: "yes",
    at: current?.answer === "yes" ? current.at : at,
    join,
    joinAt: at,
    byHost: true,
  } satisfies Rsvp);
}

/**
 * The office's paper votes, entered on the round page as each paper is revealed (or before the
 * script, if collected up front). `targetId` null: a blank or spoilt paper.
 */
export async function enterPaperVote(roundId: string, voterId: string, targetId: string | null) {
  const store = getStore();
  const round = await load(roundId);
  if (!round.meeting!.requestedAt) throw new RoundError("Request votes first.");
  const voter = round.players.find((p) => p.id === voterId);
  if (!voter) throw new RoundError("That player isn't in this round.");
  if (targetId && !round.players.some((p) => p.id === targetId)) throw new RoundError("That player isn't in this round.");
  const existing = (await store.getVotes(roundId)).find((v) => v.voterId === voterId);
  if (existing && existing.via !== "paper") throw new RoundError(`${voter.name} has already voted on Slack.`);

  const reveal = await getReveal(roundId);
  if (reveal) {
    if (!reveal.paperIds?.includes(voterId)) {
      throw new RoundError(`${voter.name} isn't in the script's running order. Reset the reveal to include them.`);
    }
    if (paperSettled(reveal)) {
      throw new RoundError("The script has moved past the votes. Go back in the script to change a paper vote.");
    }
  }

  await store.setField(paperKey(roundId), voterId, { targetId, at: new Date().toISOString() } satisfies PaperEntry);
  // Keep the round's record of votes in step.
  if (existing) await store.deleteVote(roundId, voterId);
  if (targetId) await store.castVote(roundId, { voterId, targetId, at: new Date().toISOString(), via: "paper" });
}

export async function getPaperVotes(roundId: string) {
  return getStore().getFields<PaperEntry>(paperKey(roundId));
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

  // Everyone who hasn't voted, except the office (they vote on paper).
  const [votes, rsvps] = await Promise.all([store.getVotes(roundId), getRsvps(roundId)]);
  const voted = new Set(votes.map((v) => v.voterId));
  const recipients = round.players.filter((p) => !voted.has(p.id) && rsvps[p.id]?.join !== "office");
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
