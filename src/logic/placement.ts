import { DECK_PAD_MM, type Panel, padLength } from "./preview/geometry";

/** The smallest Size, as a multiple of the Deck's pad. */
export const MIN_SIZE = 0.3;

/**
 * The largest Size: the biggest square that fits a pad's half of `panel`, as a multiple of the Deck's pad. Never
 * below 1, so on a screen too small for the Deck's pad the slider's upper half holds the largest pad instead of
 * running backwards.
 */
export function maxSize(panel: Panel): number {
  return Math.max(Math.min(panel.width / 2, panel.height) / DECK_PAD_MM, 1);
}

/**
 * The Size at a slider `position` from 0 to 2: 0.3× to 1× over the first half and 1× to {@link maxSize} over the
 * second, so the Deck's pad sits on the middle notch.
 */
export function sizeAt(position: number, panel: Panel): number {
  const size = position <= 1 ? MIN_SIZE + (1 - MIN_SIZE) * position : 1 + (maxSize(panel) - 1) * (position - 1);
  return Number(size.toFixed(3));
}

/** The slider position of `size`; a size past either end sits at that end. */
export function sizePosition(size: number, panel: Panel): number {
  if (size <= 1) return Math.max((size - MIN_SIZE) / (1 - MIN_SIZE), 0);
  const top = maxSize(panel);
  return top === 1 ? 2 : Math.min(1 + (size - 1) / (top - 1), 2);
}

/**
 * The vertical position of a pad, from 0 (flush with the top) to 1 (flush with the bottom), for the daemon's `center_y`, the
 * pad's centre as a fraction of the screen height, which the daemon clamps to keep the pad on the screen.
 */
export function heightOf(centerY: number, size: number, panel: Panel): number {
  const length = padLength(size, panel);
  const room = panel.height - length;
  if (room <= 0) return 0.5;
  const height = (centerY * panel.height - length / 2) / room;
  // Three places: enough for the slider's 0.05 steps, and coarser than the error of `center_y`'s four, so a height
  // reads back exactly as it was written.
  return Number(Math.min(Math.max(height, 0), 1).toFixed(3));
}

/** The daemon's `center_y` that puts a pad of `size` at `height` ({@link heightOf}). */
export function centerYOf(height: number, size: number, panel: Panel): number {
  const length = padLength(size, panel);
  return Number(((length / 2 + height * (panel.height - length)) / panel.height).toFixed(4));
}
