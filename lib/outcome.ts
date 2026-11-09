import crypto from "node:crypto";
import { suspensefulOrder, winners, type VotePair } from "./suspense";

/**
 * Who is banished, including the tiebreak.
 *
 * On a tie, the tied players' own votes are removed and the remaining votes are counted
 * again between the tied players only (votes for anyone else are set aside). If that is
 * still level, or no votes are left, the players still tied draw straws: one is picked at random.
 */

export type Tiebreak = {
  tiedIds: string[];
  tiedCount: number;
  /** Votes cast by the tied players: removed. */
  removed: VotePair[];
  /** Votes for players outside the tie: set aside. */
  setAside: VotePair[];
  /** The recount, in reveal order. */
  order: VotePair[];
};

export type Outcome = {
  /** The banished player (empty only when nobody voted). */
  banished: string[];
  count: number;
  tiebreak?: Tiebreak;
  /** Set when the tiebreak was still level: the players who drew straws. banished[0] drew the short one. */
  drawnFrom?: string[];
  /** Kept for reveals saved before the straw draw existed. */
  unresolved: boolean;
};

/** Picks a random index below n. Replaceable in tests. */
export type Pick = (n: number) => number;
const fairPick: Pick = (n) => crypto.randomInt(n);

export function resolveOutcome(order: VotePair[], pick: Pick = fairPick): Outcome {
  if (!order.length) return { banished: [], count: 0, unresolved: false };
  const first = winners(order);
  if (first.ids.length === 1) return { banished: first.ids, count: first.count, unresolved: false };

  const tied = new Set(first.ids);
  const tiebreak: Tiebreak = {
    tiedIds: first.ids,
    tiedCount: first.count,
    removed: order.filter((v) => tied.has(v.voterId)),
    setAside: order.filter((v) => !tied.has(v.voterId) && !tied.has(v.targetId)),
    order: suspensefulOrder(order.filter((v) => !tied.has(v.voterId) && tied.has(v.targetId))),
  };
  const draw = (ids: string[], count: number): Outcome => ({
    banished: [ids[pick(ids.length)]],
    count,
    tiebreak,
    drawnFrom: ids,
    unresolved: false,
  });

  if (!tiebreak.order.length) return draw(first.ids, first.count);
  const w = winners(tiebreak.order);
  if (w.ids.length > 1) return draw(w.ids, w.count);
  return { banished: w.ids, count: w.count, tiebreak, unresolved: false };
}
