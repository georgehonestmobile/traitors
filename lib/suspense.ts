/**
 * Picks the order to reveal votes in so the result stays in doubt for as long as possible.
 *
 * We score candidate orderings and keep the best:
 *  - The moment the outcome becomes mathematically certain should come as late as possible
 *    (ideally the very last vote).
 *  - The gap between first and second place should stay small along the way.
 *  - The eventual loser of the vote shouldn't sit alone at the top early on.
 *  - Lead changes are good; long runs of votes for the same person are dull.
 *
 * Random restarts plus hill-climbing by swapping pairs is plenty for a few dozen votes.
 */

export type VotePair = { voterId: string; targetId: string };

type Score = { total: number; decidedAt: number };

function finalCounts(votes: VotePair[]) {
  const c = new Map<string, number>();
  for (const v of votes) c.set(v.targetId, (c.get(v.targetId) ?? 0) + 1);
  return c;
}

export function winners(votes: VotePair[]): { ids: string[]; count: number } {
  const c = finalCounts(votes);
  const max = Math.max(0, ...c.values());
  return { ids: [...c].filter(([, n]) => n === max).map(([id]) => id), count: max };
}

/** Number of votes revealed at the point nobody could still catch the leader (n = only at the end). */
export function decidedAt(order: VotePair[]): number {
  const n = order.length;
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    counts.set(order[i].targetId, (counts.get(order[i].targetId) ?? 0) + 1);
    const remaining = n - i - 1;
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const top = sorted[0];
    const second = sorted[1] ?? 0;
    // Any player, including someone with no votes yet, could take all remaining votes.
    if (top > Math.max(second, 0) + remaining) return i + 1;
  }
  return n;
}

function score(order: VotePair[], finalWinners: Set<string>): Score {
  const n = order.length;
  const counts = new Map<string, number>();
  let marginSum = 0;
  let leadChanges = 0;
  let winnerAloneEarly = 0;
  let repeats = 0;
  let prevLeader: string | null = null;

  for (let i = 0; i < n; i++) {
    const t = order[i].targetId;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (i > 0 && order[i - 1].targetId === t) repeats++;

    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const [leaderId, top] = ranked[0];
    const second = ranked[1]?.[1] ?? 0;
    marginSum += top - second;

    const soleLeader = top > second ? leaderId : null;
    if (soleLeader && prevLeader && soleLeader !== prevLeader) leadChanges++;
    if (soleLeader) prevLeader = soleLeader;
    if (soleLeader && finalWinners.has(soleLeader) && i < n * 0.7) winnerAloneEarly++;
  }

  const d = decidedAt(order);
  return {
    decidedAt: d,
    total: d * 100 - marginSum * 6 + leadChanges * 4 - winnerAloneEarly * 3 - repeats * 2,
  };
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function suspensefulOrder(votes: VotePair[], restarts = 60): VotePair[] {
  if (votes.length < 3) return shuffle(votes);
  const finalWinners = new Set(winners(votes).ids);

  let best = votes;
  let bestScore = -Infinity;

  for (let r = 0; r < restarts; r++) {
    let cur = shuffle(votes);
    let curScore = score(cur, finalWinners).total;
    // Hill-climb: try swapping pairs until no swap helps.
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < cur.length - 1; i++) {
        for (let j = i + 1; j < cur.length; j++) {
          if (cur[i].targetId === cur[j].targetId) continue;
          const next = [...cur];
          [next[i], next[j]] = [next[j], next[i]];
          const s = score(next, finalWinners).total;
          if (s > curScore) {
            cur = next;
            curScore = s;
            improved = true;
          }
        }
      }
    }
    if (curScore > bestScore) {
      best = cur;
      bestScore = curScore;
    }
  }
  return best;
}
