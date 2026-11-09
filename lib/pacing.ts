/**
 * Reveal pacing (seconds). Shared by the server (building the plan) and the admin page (estimates).
 *
 * Early votes come quickly; the gaps stretch out as the reveal goes on, and the final
 * few votes each get the full 10 seconds. The tiebreak recount runs faster.
 */

export const INTRO_PAUSE = 8;
export const MIN_GAP = 3;
export const MAX_GAP = 10;
/** How many of the last votes get the full MAX_GAP before them. */
export const FINAL_STRETCH = 3;
export const AFTER_LAST_VOTE = 6;
export const STANDINGS_PAUSE = 3;
export const TIE_PAUSE = 14;
export const RECOUNT_GAP = 3;
export const DRAW_ANNOUNCE_PAUSE = 8;
export const DRAW_TEASE_PAUSE = 6;

/** Pause after vote n is revealed, before vote n + 1 begins. */
export function gapAfter(n: number, total: number): number {
  if (n >= total) return AFTER_LAST_VOTE;
  if (n >= total - FINAL_STRETCH) return MAX_GAP;
  const t = n / Math.max(1, total - FINAL_STRETCH);
  return Math.round(MIN_GAP + (MAX_GAP - 1 - MIN_GAP) * t * t);
}

/** Pause between "Jack picks up their slate…" and the name appearing. */
export function teasePause(n: number, total: number): number {
  if (n === total) return 5;
  if (n > total - FINAL_STRETCH) return 4;
  return n / total < 0.5 ? 2 : 3;
}

/** Rough length of the reveal, ignoring any tiebreak. */
export function estimateSeconds(votes: number, standingsEvery: number): number {
  let s = INTRO_PAUSE;
  for (let n = 1; n <= votes; n++) {
    s += teasePause(n, votes) + gapAfter(n, votes);
    if (standingsEvery > 0 && n < votes && n % standingsEvery === 0) s += STANDINGS_PAUSE;
  }
  return s;
}
