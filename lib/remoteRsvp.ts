import * as msg from "./messages";
import { roundStatus } from "./rounds";
import * as slack from "./slack";
import { getStore, rsvpKey, scheduledBallotId, type Round, type Rsvp } from "./store";

/**
 * Remote rounds with an RSVP: when the round is created, players are asked whether they can vote
 * in the window. "Can't" gets a ballot straight away (an advance vote) and their scheduled ballot is
 * withdrawn; "can" (or no reply) gets the ballot when voting opens. Answers can change until the
 * reply deadline.
 *
 * Each player's RSVP (including their rescheduled ballot) lives in their own field of the RSVP hash,
 * so replies arriving at once don't overwrite each other.
 */

const GRACE_MS = 3 * 1000;

export async function recordRemoteRsvp(round: Round, voterId: string, choice: "yes" | "no") {
  const store = getStore();
  const voter = round.players.find((p) => p.id === voterId);
  if (!voter || !round.rsvp) return msg.notEligibleMessage();
  const status = roundStatus(round);
  if (status === "cancelled") return msg.cancelledMessage(round);

  const now = Date.now();
  const deadline = Date.parse(round.rsvp.closesAt);
  const answerOpen = status === "scheduled" && now <= deadline + GRACE_MS;
  const canChange = status === "scheduled" && now < deadline;
  const current = (await store.getFields<Rsvp>(rsvpKey(round.id)))[voterId];

  if (!answerOpen) {
    if (current) return msg.remoteRsvpAnsweredMessage(round, voter, current, false, `Replies closed ${slackTime(round.rsvp.closesAt)}. If something's changed, let the host know.`);
    if (status === "closed") return msg.closedMessage(round, { voted: false });
    return msg.remoteRsvpClosedMessage(round);
  }

  const voted = (await store.getVotes(round.id)).find((v) => v.voterId === voterId);
  if (voted) return msg.alreadyVotedMessage(round, round.players.find((p) => p.id === voted.targetId));

  // Voting in advance: withdraw the ballot scheduled for when voting opens (they vote from the RSVP).
  // Back to voting in the window: schedule it again.
  const d = round.delivery[voterId];
  let ballotScheduledId = current?.ballotScheduledId;
  const scheduled = scheduledBallotId(d, current);
  if (!round.test && d?.channel) {
    if (choice === "no" && scheduled) {
      await slack.deleteScheduledMessage(d.channel, scheduled).catch((e) => console.error(e));
      ballotScheduledId = null;
    } else if (choice === "yes" && !scheduled && Date.parse(round.opensAt) - now > 60 * 1000) {
      try {
        ballotScheduledId = await slack.scheduleMessage(d.channel, new Date(round.opensAt), msg.voteMessage(round, voter));
      } catch (e) {
        console.error(e);
      }
    }
  }

  const rsvp: Rsvp = {
    answer: choice,
    at: new Date(now).toISOString(),
    ...(ballotScheduledId !== undefined ? { ballotScheduledId } : {}),
  };
  await store.setField(rsvpKey(round.id), voterId, rsvp);
  return msg.remoteRsvpAnsweredMessage(round, voter, rsvp, canChange);
}

const slackTime = (iso: string) => `<!date^${Math.floor(Date.parse(iso) / 1000)}^{date_short_pretty} at {time}|${new Date(iso).toUTCString()}>`;
