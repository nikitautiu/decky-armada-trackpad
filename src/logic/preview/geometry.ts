import { effective, type Side } from "../presets";
import type { Settings } from "../wire";

/** A point on the screen, in fractions of its width and height from the top left. */
export type Point = { readonly x: number; readonly y: number };

/** A rectangle on the screen, in fractions of its width and height. */
export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The touch panel's physical size in mm. */
export type Panel = { readonly width: number; readonly height: number };

/** The Steam Deck pad's side in mm; size 1 means this, as in the daemon. */
export const DECK_PAD_MM = 32.5;

// The daemon's defaults, for a settings object that lacks a key.
const DAEMON_LAYOUT = { size: 1, center_y: 0.5, side: 0 } as const;

/** The panel size from `panel_mm`, or `null` when it is not two positive numbers: nothing can be laid out then. */
export function panelOf(settings: Settings): Panel | null {
  const value = settings.panel_mm;
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [width, height] = value;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return null;
  return { width, height };
}

/** A pad's side in mm at `size`: `size` times the Deck pad, shrunk to fit its half of `panel`, as the daemon does. */
export function padLength(size: number, panel: Panel): number {
  const full = size * DECK_PAD_MM;
  return full * Math.min(1, panel.width / 2 / full, panel.height / full);
}

function layoutValue(settings: Settings, side: Side, key: keyof typeof DAEMON_LAYOUT): number {
  const value = effective(settings, side, key);
  return typeof value === "number" ? value : DAEMON_LAYOUT[key];
}

/**
 * Where a pad's window sits at rest, as the daemon lays it out (`geometry.halves()`): `size` times the Deck pad,
 * shrunk to fit its half and square in mm; `center_y` clamped so it stays on the screen; `side` its place in the
 * free space of its half, from the outer edge, mirrored for the left pad.
 */
export function homeRect(settings: Settings, side: Side, panel: Panel): Rect {
  const half = panel.width / 2;
  const length = padLength(layoutValue(settings, side, "size"), panel);
  const offset = layoutValue(settings, side, "side") * (half - length);
  const x = side === "left" ? offset : panel.width - offset - length;
  const centerY = Math.min(
    Math.max(layoutValue(settings, side, "center_y") * panel.height, length / 2),
    panel.height - length / 2,
  );
  return {
    x: x / panel.width,
    y: (centerY - length / 2) / panel.height,
    width: length / panel.width,
    height: length / panel.height,
  };
}
