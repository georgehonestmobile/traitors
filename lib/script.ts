import type { Outcome } from "./outcome";
import type { Round } from "./store";
import type { VotePair } from "./suspense";

/**
 * Face-to-face reveals: instead of posting in Slack, the host gets a script on the
 * round's page, one card per beat, in the same suspenseful order.
 */

/** The beats of a face-to-face reveal, in order. */
export type ScriptBeat =
  | { kind: "intro" }
  | { kind: "vote"; voterId: string; targetId: string; n: number; total: number; advance?: boolean }
  | { kind: "tie" }
  | { kind: "recount"; voterId: string; targetId: string; n: number; total: number }
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
  /** Lines for the host to read out. */
  say: string[];
  /** Private notes for the host. */
  note?: string;
  /** The count after this beat. */
  tally?: { name: string; count: number }[];
};

/** `advance`: voters who voted before the meeting (they aren't there; the host reads their vote out). */
export function scriptBeats(order: VotePair[], outcome: Outcome, advance: string[] = []): ScriptBeat[] {
  const early = new Set(advance);
  const beats: ScriptBeat[] = [{ kind: "intro" }];
  order.forEach((v, i) =>
    beats.push({ kind: "vote", ...v, n: i + 1, total: order.length, ...(early.has(v.voterId) ? { advance: true } : {}) }),
  );
  const tb = outcome.tiebreak;
  if (tb) {
    beats.push({ kind: "tie" });
    tb.order.forEach((v, i) => beats.push({ kind: "recount", ...v, n: i + 1, total: tb.order.length }));
  }
  if (outcome.drawnFrom) beats.push({ kind: "draw-announce" }, { kind: "draw-result" });
  beats.push({ kind: "final" });
  return beats;
}

const and = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const votes = (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`;

function tally(order: VotePair[], upTo: number, name: (id: string) => string) {
  const counts = new Map<string, number>();
  for (const v of order.slice(0, upTo)) counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ name: name(id), count }));
}

export function scriptCard(beat: ScriptBeat, round: Round, order: VotePair[], outcome: Outcome, beats: ScriptBeat[] = []): ScriptCard {
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
        ],
        note: "Call each player in the order shown. The order is picked to keep the result in doubt for as long as possible.",
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
      return {
        kind: beat.kind,
        heading: `Vote ${beat.n} of ${beat.total}${last ? " · the final vote" : ""}`,
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
            ? `Even after the recount, ${who} are level on ${votes(outcome.count)} each.`
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
        note: "Picked at random by the app when the script started.",
      };
    case "final": {
      if (!order.length) return { kind: beat.kind, heading: "Verdict", say: ["No votes were cast. Nobody is banished… tonight."] };
      const who = name(outcome.banished[0]);
      const say = outcome.drawnFrom
        ? [`${who} drew the short straw.`, `${who}, you have been banished from the Round Table.`]
        : outcome.unresolved
          ? [`It's still a tie between ${and(outcome.banished.map(name))}.`]
          : [`${tb ? "After the tiebreak, with" : "With"} ${votes(outcome.count)}, ${who}, you have been banished from the Round Table.`];
      return { kind: beat.kind, heading: "Verdict", say, tally: tally(order, order.length, name) };
    }
  }
}
