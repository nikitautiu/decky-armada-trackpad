/**
 * How long after a modal closes the panel ignores B.
 *
 * Steam UI workaround: a modal opened from the panel over a game closes on B's press, Steam brings the Quick Access
 * menu back, and the same press then reaches the panel as a second Back (measured on the Nova: ~100 ms after the panel
 * mounts again, ~280 ms after the close).
 */
export const BACK_GUARD_MS = 500;

/** How many ms the panel still ignores B, given when a modal last closed (`null`: never), at `now`. */
export function backGuardLeft(closedAt: number | null, now: number): number {
  return closedAt === null ? 0 : Math.max(0, closedAt + BACK_GUARD_MS - now);
}
