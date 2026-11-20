import * as msg from "./messages";
import { RoundError } from "./rounds";
import * as slack from "./slack";
import { getStore } from "./store";
import { winners, type VotePair } from "./suspense";
import { getReveal, revealKey, type RevealState } from "./reveal";

/**
 * Face-to-face meeting banishments: breaking a tie with a re-vote.
 *
 *  - The tied players sit it out: their own votes are removed.
 *  - Votes for the tied players from everyone else stand.
 *  - Everyone at the meeting whose vote went to someone outside the tie votes again, between the
 *    tied players only. Advance voters aren't there, so their votes outside the tie are set aside.
 *  - Re-voters dialling in get a Slack ballot with one minute; the office re-votes on paper, entered
 *    on the round page like the first round of paper votes.
 *  - The votes that stood and the re-votes are counted together. Straws only if that's still level.
 */

export type RevotePlan = {
  tiedIds: string[];
  tiedCount: number;
  /** Votes cast by the tied players: removed. */
  removed: VotePair[];
  /** Advance votes for players outside the tie: set aside (they can't re-vote live). */
  setAside: VotePair[];
  /** Votes for the tied players from everyone else: they stand. */
  carried: VotePair[];
  /** Who votes again: at the meeting, and voted for someone outside the tie. */
  voterIds: string[];
  /** Re-voters who vote on paper (the office, or everyone in a test round). The rest get a Slack ballot. */
  paperIds: string[];
  requestedAt?: string;
  closesAt?: string;
  finishedAt?: string;
  ballots?: Record<string, { channel?: string; ts?: string; error?: string }>;
};

/** A re-vote. `targetId` null: a blank paper. */
export type RevoteEntry = { targetId: string | null; at: string; via: "slack" | "paper" };

export const REVOTE_MS = 60 * 1000;
const GRACE_MS = 3 * 1000;

const entriesKey = (roundId: string, runId: string) => `revote:${roundId}:${runId}`;

/** Work out the tiebreak re-vote, or null if there's no tie. `order` is every vote, with paper votes filled in. */
export function planRevote(order: VotePair[], opts: { advance: string[]; paperIds: string[]; test: boolean }): RevotePlan | null {
  const counted = order.filter((v) => v.targetId);
  const w = winners(counted);
  if (w.ids.length < 2) return null;
  const tied = new Set(w.ids);
  const early = new Set(opts.advance);
  const others = counted.filter((v) => !tied.has(v.voterId));
  const outside = others.filter((v) => !tied.has(v.targetId));
  const voterIds = outside.filter((v) => !early.has(v.voterId)).map((v) => v.voterId);
  return {
    tiedIds: w.ids,
    tiedCount: w.count,
    removed: counted.filter((v) => tied.has(v.voterId)),
    setAside: outside.filter((v) => early.has(v.voterId)),
    carried: others.filter((v) => tied.has(v.targetId)),
    voterIds,
    paperIds: opts.test ? voterIds : voterIds.filter((id) => opts.paperIds.includes(id)),
  };
}

export async function getRevotes(roundId: string, runId: string) {
  return getStore().getFields<RevoteEntry>(entriesKey(roundId, runId));
}

/** The re-vote is over: the Slack minute has passed (or was ended early). */
export const revoteClosed = (plan: RevotePlan, now = Date.now()) =>
  !!plan.finishedAt || (!!plan.closesAt && now >= Date.parse(plan.closesAt) + GRACE_MS);

/** The result has been worked out from the re-vote (the script has moved past the tie card). */
export const revoteSettled = (state: RevealState) => !!state.revote && !!state.beats?.some((b) => b.kind === "final");

async function load(roundId: string) {
  const store = getStore();
  const round = await store.getRound(roundId);
  if (!round) throw new RoundError("Round not found.");
  const state = await getReveal(roundId);
  if (!state?.revote) throw new RoundError("There's no tiebreak vote in this reveal.");
  return { store, round, state, plan: state.revote };
}

/** Save the plan back, unless the reveal was reset meanwhile. */
async function savePlan(roundId: string, runId: string, plan: RevotePlan) {
  const fresh = await getReveal(roundId);
  if (!fresh || fresh.runId !== runId) return;
  fresh.revote = plan;
  await getStore().setJSON(revealKey(roundId), fresh);
}

/** Open the tiebreak vote: Slack ballots (one minute) to re-voters dialling in. The office re-votes on paper. */
export async function requestRevote(roundId: string) {
  const { round, state, plan } = await load(roundId);
  if (plan.requestedAt) throw new RoundError("The tiebreak vote has already been requested.");
  const slackIds = plan.voterIds.filter((id) => !plan.paperIds.includes(id));
  const now = Date.now();
  plan.requestedAt = new Date(now).toISOString();
  // Nothing to wait for if nobody votes in Slack.
  plan.closesAt = new Date(slackIds.length ? now + REVOTE_MS : now - GRACE_MS).toISOString();
  plan.ballots = {};
  await savePlan(roundId, state.runId, plan); // open the window before any ballot arrives
  if (round.test || !slackIds.length) return;

  const tied = round.players.filter((p) => plan.tiedIds.includes(p.id));
  await Promise.all(
    slackIds.map(async (id) => {
      const p = round.players.find((x) => x.id === id);
      if (!p) return;
      const b: { channel?: string; ts?: string; error?: string } = {};
      plan.ballots![id] = b;
      try {
        b.channel = round.delivery[id]?.channel ?? (await slack.openDm(id));
        b.ts = await slack.postMessage(b.channel, msg.tiebreakBallotMessage(round, p, tied, plan.closesAt!));
      } catch (e) {
        b.error = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  await savePlan(roundId, state.runId, plan);
}

/** Close the tiebreak vote when the minute is up (or now, if `now`). Unused ballots say time's up. */
export async function finishRevote(roundId: string, opts: { now?: boolean } = {}) {
  const { round, state, plan } = await load(roundId);
  if (!plan.requestedAt) throw new RoundError("The tiebreak vote hasn't been requested yet.");
  if (plan.finishedAt) return;
  const now = Date.now();
  if (!opts.now && now < Date.parse(plan.closesAt!) + GRACE_MS) return;
  plan.finishedAt = new Date(now).toISOString();
  if (opts.now && now < Date.parse(plan.closesAt!)) plan.closesAt = plan.finishedAt;
  await savePlan(roundId, state.runId, plan);

  const voted = await getRevotes(roundId, state.runId);
  await Promise.all(
    Object.entries(plan.ballots ?? {}).map(async ([id, b]) => {
      if (id in voted || !b.channel || !b.ts) return;
      await slack.updateMessage(b.channel, b.ts, msg.tiebreakTimeUpMessage(round)).catch(() => {});
    }),
  );
}

/** A re-voter picked someone on their Slack tiebreak ballot. Returns the message to replace it with. */
export async function castRevote(roundId: string, voterId: string, targetId: string) {
  const store = getStore();
  const round = await store.getRound(roundId);
  if (!round) return msg.notEligibleMessage();
  const state = await getReveal(roundId);
  const plan = state?.revote;
  if (!state || !plan?.requestedAt || !plan.voterIds.includes(voterId) || plan.paperIds.includes(voterId)) {
    return msg.tiebreakClosedMessage(round);
  }
  if (revoteClosed(plan)) return msg.tiebreakTimeUpMessage(round);
  const target = round.players.find((p) => p.id === targetId);
  if (!target || !plan.tiedIds.includes(targetId)) return msg.tiebreakClosedMessage(round);
  if (!(await store.claim(`revote-cast:${roundId}:${state.runId}:${voterId}`, 12 * 60 * 60))) {
    return msg.tiebreakVotedMessage(round);
  }
  await store.setField(entriesKey(roundId, state.runId), voterId, {
    targetId,
    at: new Date().toISOString(),
    via: "slack",
  } satisfies RevoteEntry);
  return msg.tiebreakVotedMessage(round, target);
}

/** The host (or helper) enters an office re-voter's paper (or one for someone whose Slack ballot failed). */
export async function enterRevotePaper(roundId: string, voterId: string, targetId: string | null) {
  const { store, round, state, plan } = await load(roundId);
  if (!plan.requestedAt) throw new RoundError("Request the tiebreak vote first.");
  const name = (id: string) => round.players.find((p) => p.id === id)?.name ?? "That player";
  if (!plan.voterIds.includes(voterId)) throw new RoundError(`${name(voterId)} isn't re-voting in the tiebreak.`);
  if (targetId && !plan.tiedIds.includes(targetId)) throw new RoundError("The tiebreak vote is between the tied players only.");
  if (revoteSettled(state)) {
    throw new RoundError("The script has moved past the tie. Go back to the tie card to change a tiebreak vote.");
  }
  const existing = (await getRevotes(roundId, state.runId))[voterId];
  if (existing?.via === "slack") throw new RoundError(`${name(voterId)} has already re-voted on Slack.`);
  await store.setField(entriesKey(roundId, state.runId), voterId, {
    targetId,
    at: new Date().toISOString(),
    via: "paper",
  } satisfies RevoteEntry);
}

/** Re-voters on paper whose vote hasn't been entered yet. */
export function missingRevotes(plan: RevotePlan, entries: Record<string, RevoteEntry>) {
  return plan.paperIds.filter((id) => !(id in entries));
}

/** Rounds deleted: the re-vote hash for the current run. */
export const revoteEntriesKey = entriesKey;
