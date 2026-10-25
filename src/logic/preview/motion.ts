import { edgeMode, effective, type Side } from "../presets";
import type { Settings } from "../wire";
import type { Panel, Point, Rect } from "./geometry";

/** Where a pad's window sits when a finger lands. */
export type Anchor = "fixed" | "float";

/** A pad's edge mode, or `"mixed"` when its four edges differ; the preview moves a mixed pad as clamp. */
export type Edges = "clamp" | "follow" | "release" | "recenter" | "mixed";

const EDGE_MODES: readonly Edges[] = ["clamp", "follow", "release", "recenter"];

/** How a pad turns a finger into a window and a contact. */
export type PadBehaviour = {
  readonly anchor: Anchor;
  readonly edges: Edges;
  /** `float_keep_inside`: a floating or recentred window is held on the screen. */
  readonly keepInside: boolean;
  /** How far past a release edge the finger may go before the pad lifts, in screen fractions per axis. */
  readonly grace: Point;
};

/** A finger down on a pad: the window it moves in, and whether an edge holds the pad lifted. */
export type Touch = { readonly window: Rect; readonly lifted: boolean };

// The daemon's default `edge_grace_mm`, for a settings object that lacks it.
const DEFAULT_GRACE_MM = 2;

/** A side's anchor, edge mode, `float_keep_inside` and edge grace, its overrides over the shared settings. */
export function behaviourOf(settings: Settings, side: Side, panel: Panel): PadBehaviour {
  const edges = edgeMode(settings, side);
  const graceMm = effective(settings, side, "edge_grace_mm");
  const grace = typeof graceMm === "number" ? graceMm : DEFAULT_GRACE_MM;
  return {
    anchor: effective(settings, side, "anchor") === "float" ? "float" : "fixed",
    edges: EDGE_MODES.find((mode) => mode === edges) ?? "mixed",
    keepInside: effective(settings, side, "float_keep_inside") === true,
    grace: { x: grace / panel.width, y: grace / panel.height },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The offset that brings `position` onto the span `start`..`start + length`, moving `start` as little as it can. */
function reach(start: number, length: number, position: number): number {
  if (position < start) return position;
  if (position > start + length) return position - length;
  return start;
}

function centredOn(behaviour: PadBehaviour, window: Rect, finger: Point): Rect {
  const x = finger.x - window.width / 2;
  const y = finger.y - window.height / 2;
  if (!behaviour.keepInside) return { ...window, x, y };
  return { ...window, x: clamp(x, 0, 1 - window.width), y: clamp(y, 0, 1 - window.height) };
}

function reaching(window: Rect, finger: Point): Rect {
  return { ...window, x: reach(window.x, window.width, finger.x), y: reach(window.y, window.height, finger.y) };
}

/** How far `position` is past the span `start`..`start + length`; zero within it. */
function past(start: number, length: number, position: number): number {
  return Math.max(start - position, position - (start + length), 0);
}

function inside(window: Rect, finger: Point): boolean {
  return past(window.x, window.width, finger.x) === 0 && past(window.y, window.height, finger.y) === 0;
}

function released(behaviour: PadBehaviour, touch: Touch, finger: Point): boolean {
  // A lifted pad touches again only once the finger is back on the window, not as soon as it is within the grace.
  if (touch.lifted) return !inside(touch.window, finger);
  const { window } = touch;
  return (
    past(window.x, window.width, finger.x) > behaviour.grace.x ||
    past(window.y, window.height, finger.y) > behaviour.grace.y
  );
}

/**
 * The touch a landing starts: a fixed window shifted from `home` just enough to reach the finger, or a float
 * window centred on it.
 */
export function land(behaviour: PadBehaviour, home: Rect, finger: Point): Touch {
  const window = behaviour.anchor === "float" ? centredOn(behaviour, home, finger) : reaching(home, finger);
  return { window, lifted: false };
}

/** The touch after the finger moves to `finger`, by the pad's edge mode. */
export function moveTouch(behaviour: PadBehaviour, touch: Touch, finger: Point): Touch {
  switch (behaviour.edges) {
    case "clamp":
    case "mixed":
      return touch;
    case "follow":
      return { window: reaching(touch.window, finger), lifted: false };
    case "release":
      return { window: touch.window, lifted: released(behaviour, touch, finger) };
    case "recenter":
      return inside(touch.window, finger)
        ? touch
        : { window: centredOn(behaviour, touch.window, finger), lifted: false };
  }
}

/** Where the pad is touched: the finger clamped onto the window, or `null` while the pad is lifted. */
export function contactPoint(touch: Touch, finger: Point): Point | null {
  if (touch.lifted) return null;
  const { window } = touch;
  return {
    x: clamp(finger.x, window.x, window.x + window.width),
    y: clamp(finger.y, window.y, window.y + window.height),
  };
}
