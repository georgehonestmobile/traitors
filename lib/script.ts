import type { Outcome } from "./outcome";
import type { RevotePlan } from "./revote";
import type { Round } from "./store";
import type { VotePair } from "./suspense";

/**
 * Face-to-face reveals: instead of posting in Slack, the host gets a script on the
 * round's page, one card per beat, in the same suspenseful order.
 */

/** The beats of a face-to-face reveal, in order. */
export type ScriptBeat =
  | { kind: "intro" }
  | { kind: "vote"; voterId: string; targetId: string; n: number; total: number; advance?: boolean; paper?: boolean }
  | { kind: "tie" }
  | { kind: "recount"; voterId: string; targetId: string; n: number; total: number }
  /** Face-to-face meetings: the tie is broken by a re-vote (see lib/revote.ts). */
  | { kind: "revote-open" }
  | { kind: "revote"; voterId: string; targetId: string; n: number; total: number; paper?: boolean }
  | { kind: "draw-announce" }
  | { kind: "draw-result" }
  | { kind: "final" };

export type ScriptCard = {
  kind: ScriptBeat["kind"];
  heading: string;
  /** Who the host calls on to reveal their vote. */
  call?: string;
  /** The vote recorded for them, so the host can correct a different answer. */
  expect?: string;
  /** What `expect` is: their Slack vote, or the paper vote the host entered. */
  expectLabel?: string;
  /** Lines for the host to read out. */
  say: string[];
  /** Private notes for the host. */
  note?: string;
  /** The count after this beat. */
  tally?: { name: string; count: number }[];
  /** What `tally` shows, when it isn't the main count. */
  tallyLabel?: string;
  /** Office voters: their paper vote, entered on the round page as they reveal it. */
  paper?: {
    voterId: string;
    /** The name entered: a player id, null for a blank or spoilt paper, or undefined if not entered yet. */
    targetId?: string | null;
  };
};

/**
 * `advance`: voters who voted before the meeting (they aren't there; the host reads their vote out).
 * `paper`: office voters, who reveal a paper vote. Until the host enters it, their `targetId` is "".
 */
export function voteBeats(order: VotePair[], advance: string[] = [], paper: string[] = []): ScriptBeat[] {
  const early = new Set(advance);
  const onPaper = new Set(paper);
  const beats: ScriptBeat[] = [{ kind: "intro" }];
  order.forEach((v, i) =>
    beats.push({
      kind: "vote",
      ...v,
      n: i + 1,
      total: order.length,
      ...(early.has(v.voterId) ? { advance: true } : {}),
      ...(onPaper.has(v.voterId) ? { paper: true } : {}),
    }),
  );
  return beats;
}

/** After the votes: any tie, recount and draw, then the verdict. Needs every vote to be known. */
export function tailBeats(outcome: Outcome): ScriptBeat[] {
  const beats: ScriptBeat[] = [];
  const tb = outcome.tiebreak;
  if (tb) {
    beats.push({ kind: "tie" });
    tb.order.forEach((v, i) => beats.push({ kind: "recount", ...v, n: i + 1, total: tb.order.length }));
  }
  if (outcome.drawnFrom) beats.push({ kind: "draw-announce" }, { kind: "draw-result" });
  beats.push({ kind: "final" });
  return beats;
}

/** After a tiebreak re-vote (the tie card is already in the script): the re-votes, any draw, the verdict. */
export function revoteTailBeats(outcome: Outcome, paperIds: string[] = []): ScriptBeat[] {
  const votes = outcome.tiebreak?.revote?.votes ?? [];
  const onPaper = new Set(paperIds);
  return [
    { kind: "revote-open" },
    ...votes.map((v, i): ScriptBeat => ({
      kind: "revote",
      ...v,
      n: i + 1,
      total: votes.length,
      ...(onPaper.has(v.voterId) ? { paper: true } : {}),
    })),
    ...(outcome.drawnFrom ? [{ kind: "draw-announce" } as const, { kind: "draw-result" } as const] : []),
    { kind: "final" },
  ];
}

export function scriptBeats(order: VotePair[], outcome: Outcome, advance: string[] = [], paper: string[] = []): ScriptBeat[] {
  return [...voteBeats(order, advance, paper), ...tailBeats(outcome)];
}

const and = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const votes = (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`;

function tally(order: VotePair[], upTo: number, name: (id: string) => string) {
  const counts = new Map<string, number>();
  for (const v of order.slice(0, upTo)) if (v.targetId) counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ name: name(id), count }));
}

/** Paper votes entered so far: a player id, or null for a blank paper. Missing until entered. */
export type PaperEntries = Record<string, string | null>;

export function scriptCard(
  beat: ScriptBeat,
  round: Round,
  order: VotePair[],
  outcome: Outcome,
  beats: ScriptBeat[] = [],
  entries: PaperEntries = {},
  /** Face-to-face meetings: the tiebreak re-vote, if the vote was tied. */
  revote?: RevotePlan,
): ScriptCard {
  const names = new Map(round.players.map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? "Unknown";
  const tb = outcome.tiebreak;

  switch (beat.kind) {
    case "intro": {
      const voted = new Set(order.map((v) => v.voterId));
      const absent = round.players.filter((p) => !voted.has(p.id)).map((p) => p.name);
      const early = beats.filter((b) => b.kind === "vote" && b.advance).length;
      return {
        kind: beat.kind,
        heading: "Opening",
        say: [
          `The votes are in. ${order.length} of ${round.players.length} players voted.`,
          ...(absent.length ? [`${and(absent)} didn't vote.`] : []),
          ...(early
            ? [`${early} ${early === 1 ? "player" : "players"} couldn't be with us and voted in advance. I'll read those votes out.`]
            : []),
          "When I call your name, reveal who you believe is a Traitor, and tell us why.",
          ...(beats.some((b) => b.kind === "vote" && b.paper)
            ? ["If you're in the office, hold up your paper when I call your name."]
            : []),
        ],
        note: beats.some((b) => b.kind === "vote" && b.paper)
          ? "Call each player in the order shown. The order is picked to keep the result in doubt for as long as possible. Office votes are entered in the Players list as each paper is revealed."
          : "Call each player in the order shown. The order is picked to keep the result in doubt for as long as possible.",
      };
    }
    case "vote": {
      const last = beat.n === beat.total;
      const self = beat.voterId === beat.targetId;
      if (beat.advance) {
        return {
          kind: beat.kind,
          heading: `Vote ${beat.n} of ${beat.total}${last ? " · the final vote" : ""} · cast in advance`,
          expect: name(beat.targetId),
          say: [
            last
              ? `And the final vote, cast in advance by ${name(beat.voterId)}… ${name(beat.targetId)}.`
              : `${name(beat.voterId)} couldn't be with us, and voted for… ${name(beat.targetId)}.`,
          ],
          note: self ? "Read this one out yourself. They voted for themselves." : "Read this one out yourself.",
          tally: tally(order, beat.n, name),
        };
      }
      if (beat.paper) {
        const entered = entries[beat.voterId];
        const known = beat.voterId in entries;
        return {
          kind: beat.kind,
          heading: `Vote ${beat.n} of ${beat.total}${last ? " · the final vote" : ""} · on paper`,
          call: name(beat.voterId),
          ...(entered ? { expect: name(entered) } : {}),
          say: last
            ? [`And the final vote… ${name(beat.voterId)}, please reveal your paper.`]
            : [`${name(beat.voterId)}, please reveal your paper. Who did you vote for?`],
          tally: tally(order, beat.n, name),
          paper: { voterId: beat.voterId, ...(known ? { targetId: entered } : {}) },
        };
      }
      return {
        kind: beat.kind,
        heading: `Vote ${beat.n} of ${beat.total}${last ? " · the final vote" : ""} · on Slack`,
        call: name(beat.voterId),
        expect: name(beat.targetId),
        say: last ? [`And the final vote… ${name(beat.voterId)}.`] : [`${name(beat.voterId)}, who did you vote for?`],
        note: self
          ? "They voted for themselves."
          : `If they name anyone other than ${name(beat.targetId)}, their recorded vote was for ${name(beat.targetId)}.`,
        tally: tally(order, beat.n, name),
      };
    }
    case "tie": {
      const rv = revote;
      if (rv) {
        const tied = and(rv.tiedIds.map(name));
        const say = [
          `It's a tie. ${tied} are level on ${votes(rv.tiedCount)} each.`,
          `${tied} sit out the tiebreak, so their own votes are removed. Votes for ${tied} from everyone else stand.`,
        ];
        if (rv.setAside.length) {
          say.push(`${votes(rv.setAside.length)} cast in advance for players outside the tie ${rv.setAside.length === 1 ? "is" : "are"} set aside.`);
        }
        if (rv.voterIds.length) {
          const slackIds = rv.voterIds.filter((id) => !rv.paperIds.includes(id));
          say.push(
            `${and(rv.voterIds.map(name))}, you voted for someone outside the tie. Please vote again, choosing only between ${tied}.`,
          );
          if (slackIds.length && rv.paperIds.length) {
            say.push("If you're dialling in, your ballot arrives in Slack now, and you have one minute. If you're in the office, write your vote on paper.");
          } else if (slackIds.length) {
            say.push("Your ballot arrives in Slack now, and you have one minute.");
          } else {
            say.push("Write your vote on paper.");
          }
        } else {
          say.push("Nobody voted outside the tie, so there's no re-vote: the votes that stand decide it.");
        }
        return {
          kind: beat.kind,
          heading: "It's a tie",
          say,
          note: rv.voterIds.length
            ? "Press Request tiebreak votes below. Once the minute is up (and any paper votes are entered), press Next to count them."
            : "Press Next to count the votes that stand.",
          tally: tally(rv.carried, rv.carried.length, name),
          tallyLabel: "Votes that stand",
        };
      }
      const t = tb!;
      const tied = and(t.tiedIds.map(name));
      const say = [
        `It's a tie. ${tied} are level on ${votes(t.tiedCount)} each.`,
        `Tied players can't vote in the tiebreak, so their votes are removed and the count is replayed between ${tied} only.`,
      ];
      if (t.removed.length) {
        say.push(`Removed: ${and(t.removed.map((v) => `${name(v.voterId)}'s vote for ${name(v.targetId)}`))}.`);
      }
      if (t.setAside.length) say.push(`${votes(t.setAside.length)} for players outside the tie are set aside.`);
      say.push(
        t.order.length
          ? `That leaves ${votes(t.order.length)} to count again.`
          : "That leaves no votes to count, so it comes down to drawing straws.",
      );
      return { kind: beat.kind, heading: "It's a tie", say, tally: tally(order, order.length, name) };
    }
    case "revote-open": {
      const r = tb!.revote!;
      const counted = new Set(r.votes.map((v) => v.voterId));
      const missed = r.voterIds.filter((id) => !counted.has(id));
      const standing = tally(r.carried, r.carried.length, name);
      if (!r.voterIds.length) {
        return {
          kind: beat.kind,
          heading: "The tiebreak count",
          say: [standing.length ? `The votes that stand: ${and(standing.map((t) => `${t.name} ${t.count}`))}.` : "No votes stand."],
          tally: standing,
          tallyLabel: "Votes that stand",
        };
      }
      return {
        kind: beat.kind,
        heading: "The tiebreak count",
        say: [
          standing.length
            ? `The tiebreak votes are in. We start from the votes that stand: ${and(standing.map((t) => `${t.name} ${t.count}`))}.`
            : "The tiebreak votes are in. No votes stand from the first count, so we start from nothing.",
          ...(missed.length ? [`${and(missed.map(name))} didn't cast a tiebreak vote, so ${missed.length === 1 ? "isn't" : "aren't"} counted.`] : []),
          ...(r.votes.length ? ["When I call your name, tell us who you voted for in the tiebreak."] : []),
        ],
        tally: standing,
        tallyLabel: "Votes that stand",
      };
    }
    case "revote": {
      const r = tb!.revote!;
      const last = beat.n === beat.total;
      const all = [...r.carried, ...r.votes];
      return {
        kind: beat.kind,
        heading: `Tiebreak vote ${beat.n} of ${beat.total}${last ? " · the final vote" : ""} · ${beat.paper ? "on paper" : "on Slack"}`,
        call: name(beat.voterId),
        expect: name(beat.targetId),
        ...(beat.paper ? { expectLabel: "Paper entered" } : {}),
        say: last
          ? [`And the final tiebreak vote… ${name(beat.voterId)}.`]
          : [`${name(beat.voterId)}, who did you vote for in the tiebreak?`],
        note: `If they name anyone other than ${name(beat.targetId)}, their recorded tiebreak vote was for ${name(beat.targetId)}.`,
        tally: tally(all, r.carried.length + beat.n, name),
        tallyLabel: "Tiebreak count so far",
      };
    }
    case "recount": {
      const t = tb!;
      return {
        kind: beat.kind,
        heading: `Recount ${beat.n} of ${beat.total}`,
        say: [`${name(beat.voterId)}'s vote goes to… ${name(beat.targetId)}.`],
        note: "You read these out; players don't need to reveal again.",
        tally: tally(t.order, beat.n, name),
      };
    }
    case "draw-announce": {
      const who = and((outcome.drawnFrom ?? []).map(name));
      return {
        kind: beat.kind,
        heading: "Still level",
        say: [
          tb?.order.length
            ? tb.revote && !tb.revote.voterIds.length
              ? `With the votes that stand, ${who} are level on ${votes(outcome.count)} each.`
              : `Even after the ${tb.revote ? "tiebreak vote" : "recount"}, ${who} are level on ${votes(outcome.count)} each.`
            : `There are no votes left to separate ${who}.`,
          "It comes down to chance. Each of them draws a straw, and whoever draws the short straw is banished.",
        ],
        note: "Hand out straws if you have them. The next card shows who the app drew.",
      };
    }
    case "draw-result":
      return {
        kind: beat.kind,
        heading: "The draw",
        say: [`${name(outcome.banished[0])} draws the short straw.`],
        note: "Picked at random by the app when the result was worked out.",
      };
    case "final": {
      if (!order.length) return { kind: beat.kind, heading: "Verdict", say: ["No votes were cast. Nobody is banished… tonight."] };
      const who = name(outcome.banished[0]);
      const say = outcome.drawnFrom
        ? [`${who} drew the short straw.`, `${who}, you have been banished from the Round Table.`]
        : outcome.unresolved
          ? [`It's still a tie between ${and(outcome.banished.map(name))}.`]
          : [`${tb ? "After the tiebreak, with" : "With"} ${votes(outcome.count)}, ${who}, you have been banished from the Round Table.`];
      // After a re-vote, the count that decided it is the tiebreak's.
      if (tb?.revote) return { kind: beat.kind, heading: "Verdict", say, tally: tally(tb.order, tb.order.length, name), tallyLabel: "Tiebreak count" };
      return { kind: beat.kind, heading: "Verdict", say, tally: tally(order, order.length, name) };
    }
  }
}
