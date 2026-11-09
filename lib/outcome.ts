import { suspensefulOrder, winners, type VotePair } from "./suspense";

/**
 * Who is banished, including the tiebreak.
 *
 * On a tie, the tied players' own votes are removed and the remaining votes are counted
 * again between the tied players only (votes for anyone else are set aside). If that is
 * still level, or no votes are left, the host decides.
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
  /** One id normally; several if still tied after the tiebreak. */
  banished: string[];
  count: number;
  tiebreak?: Tiebreak;
  unresolved: boolean;
};

export function resolveOutcome(order: VotePair[]): Outcome {
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
  if (!tiebreak.order.length) return { banished: first.ids, count: first.count, tiebreak, unresolved: true };

  const w = winners(tiebreak.order);
  return { banished: w.ids, count: w.count, tiebreak, unresolved: w.ids.length > 1 };
}
