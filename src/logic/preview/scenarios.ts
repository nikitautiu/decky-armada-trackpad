import { choiceLabel, padModel, TAP_OUTPUT_CHOICES } from "../advanced";
import { padChoice, type Side } from "../presets";
import { padChoiceLabel, SIDE_NAME } from "../view";
import type { Settings } from "../wire";
import { homeRect, type Panel, type Point, type Rect } from "./geometry";
import { behaviourOf, type Edges, type PadBehaviour } from "./motion";

/**
 * What the finger does from a key on: `up` hovers, `down` touches, `tap` lifts as a tap (a ripple starts), `held`
 * touches with the tap output held by a tap-and-drag.
 */
export type Contact = "up" | "down" | "tap" | "held";

/** One keyframe of the finger; between two keys it moves in a straight line. */
export type Key = {
  /** Seconds from the start of the script. */
  readonly t: number;
  /** Where the finger is, in screen fractions. */
  readonly at: Point;
  readonly contact: Contact;
  /** What the step this key belongs to shows. */
  readonly caption: string;
};

/** One pad's demo: its keys, played from 0 to `duration` seconds. */
export type Script = {
  readonly side: Side;
  /** The pad and its choice, such as "Right pad · Swipe". */
  readonly heading: string;
  readonly keys: readonly Key[];
  readonly duration: number;
};

const OTHER: Readonly<Record<Side, Side>> = { left: "right", right: "left" };

const EDGE_CAPTION: Readonly<Record<Edges, string>> = {
  clamp: "Past an edge: held at the rim",
  follow: "Past an edge: the window follows your finger",
  release: "Past an edge: the pad lifts until you come back",
  recenter: "Past an edge: the window recenters and keeps going",
  mixed: "Custom edges",
};

// A point of a drag, `after` seconds after the one before, `across` pads from the inner edge (negative: past it) and
// `down` pads from the top edge.
type PathPoint = readonly [after: number, across: number, down: number];

// How far past the inner edge the drag goes, in pads, and how far beyond its grace a release drag goes.
const DRAG_PAST = 0.4;
const PAST_GRACE = 0.1;

/**
 * The finger's path past the inner edge for each edge mode. A release drag goes past the grace (`grace`, in pads),
 * so the pad lifts however wide the grace is; the recenter path is long enough to recentre more than once.
 */
function edgePath(edges: Edges, grace: number): readonly PathPoint[] {
  switch (edges) {
    case "clamp":
    case "mixed":
      return [
        [1.2, -DRAG_PAST, 0.5],
        [0.5, -DRAG_PAST, 0.5],
      ];
    case "follow":
      return [
        [1.5, -0.6, 0.5],
        [0.3, -0.6, 0.5],
      ];
    case "release": {
      const past = Math.max(DRAG_PAST, grace + PAST_GRACE);
      return [
        [1, -past, 0.5],
        [0.5, -past, 0.5],
        [0.8, 0.3, 0.5],
      ];
    }
    case "recenter":
      return [[2, -1.2, 0.5]];
  }
}

// Pauses that make each move readable: before a landing, the length of a tap, before a lift, and after each step,
// long enough for a window to be seen going home.
const HOVER_S = 0.4;
const TAP_S = 0.15;
const LIFT_S = 0.1;
const REST_S = 0.8;

// How far a finger moves into the window after a landing, in pads, which keeps it inside a window that just
// reached it.
const NUDGE = 0.3;

// The narrowest gap beside a window, in screen fractions, that a landing outside it is shown in.
const MIN_GAP = 0.04;

// The finger stays this far inside the screen, so it is drawn whole.
const SCREEN_MARGIN = 0.02;

type Move = { readonly after: number; readonly at: Point; readonly contact: Contact };

type Step = { readonly caption: string; readonly moves: readonly Move[] };

/** A pad's geometry and the points the script uses on it. */
type PadLayout = {
  readonly side: Side;
  readonly home: Rect;
  readonly behaviour: PadBehaviour;
  /** A point at `across` pads from the inner edge (negative: past it) and `down` pads from the top edge. */
  readonly at: (across: number, down: number) => Point;
};

function onScreen(point: Point): Point {
  const clamp = (value: number): number => Math.min(Math.max(value, SCREEN_MARGIN), 1 - SCREEN_MARGIN);
  return { x: clamp(point.x), y: clamp(point.y) };
}

function padLayout(settings: Settings, side: Side, panel: Panel): PadLayout {
  const home = homeRect(settings, side, panel);
  // The inner edge is the one towards the centre line: the left edge of the right pad, the right edge of the left.
  const x = (across: number): number =>
    side === "right" ? home.x + across * home.width : home.x + (1 - across) * home.width;
  return {
    side,
    home,
    behaviour: behaviourOf(settings, side, panel),
    at: (across, down) => onScreen({ x: x(across), y: home.y + down * home.height }),
  };
}

/** `point` moved {@link NUDGE} pads towards the pad's centre on each axis where it is off the centre. */
function nudged(pad: PadLayout, point: Point): Point {
  const centre = pad.at(0.5, 0.5);
  const towards = (from: number, to: number, size: number): number => from + Math.sign(to - from) * NUDGE * size;
  return onScreen({ x: towards(point.x, centre.x, pad.home.width), y: towards(point.y, centre.y, pad.home.height) });
}

/** The finger moves over to `start` while up, lands, drags through `path`, and lifts where it ends. */
function stroke(start: Point, path: readonly Move[]): readonly Move[] {
  const end = path[path.length - 1]?.at ?? start;
  return [
    { after: 0, at: start, contact: "up" },
    { after: HOVER_S, at: start, contact: "down" },
    ...path,
    { after: LIFT_S, at: end, contact: "up" },
  ];
}

function tapSteps(settings: Settings, pad: PadLayout): readonly Step[] {
  const model = padModel(settings, pad.side);
  if (!model.tap) return [];
  const output = choiceLabel(TAP_OUTPUT_CHOICES, model.tapOutput);
  const centre = pad.at(0.5, 0.5);
  const tap: readonly Move[] = [
    { after: 0, at: centre, contact: "up" },
    { after: HOVER_S, at: centre, contact: "down" },
    { after: TAP_S, at: centre, contact: "tap" },
  ];
  const steps: Step[] = [{ caption: `Tap: ${output}`, moves: tap }];
  if (model.drag) {
    const end = pad.at(0.8, 0.3);
    steps.push({
      caption: `Tap, then touch again and drag: holds ${output}`,
      moves: [
        ...tap,
        { after: TAP_S, at: centre, contact: "held" },
        { after: 0.9, at: end, contact: "held" },
        { after: LIFT_S, at: end, contact: "up" },
      ],
    });
  }
  return steps;
}

/**
 * A point in the pad's half beside its home window, on each axis with room for one (towards the centre line before
 * the outer edge); `null` when there is none.
 */
function outsideLanding(pad: PadLayout): Point | null {
  const { home, side } = pad;
  const innerGap = side === "right" ? home.x - 0.5 : 0.5 - (home.x + home.width);
  const outerGap = side === "right" ? 1 - (home.x + home.width) : home.x;
  const above = home.y;
  const below = 1 - (home.y + home.height);
  const inGap = pad.at(0.3, 0.3);
  const inner = 0.5 + (side === "right" ? innerGap : -innerGap) / 2;
  const outer = side === "right" ? 1 - outerGap / 2 : outerGap / 2;
  const x = innerGap >= MIN_GAP ? inner : outerGap >= MIN_GAP ? outer : null;
  const y = Math.max(above, below) >= MIN_GAP ? (above >= below ? above / 2 : 1 - below / 2) : null;
  if (x === null && y === null) return null;
  return { x: x ?? inGap.x, y: y ?? inGap.y };
}

function landingSteps(settings: Settings, pad: PadLayout): readonly Step[] {
  const landingMoves = (start: Point): readonly Move[] =>
    stroke(start, [{ after: 0.9, at: nudged(pad, start), contact: "down" }]);
  if (pad.behaviour.anchor === "fixed") {
    const start = outsideLanding(pad);
    if (start === null) return [];
    return [{ caption: "Land outside: the window shifts just enough to reach it", moves: landingMoves(start) }];
  }
  const where = isOn(settings, OTHER[pad.side]) ? ` in the ${pad.side} half` : "";
  return [{ caption: `Touch anywhere${where}: the window centers on it`, moves: landingMoves(pad.at(0.25, 0.25)) }];
}

function edgeStep(pad: PadLayout): Step {
  const { edges, grace } = pad.behaviour;
  const path = edgePath(edges, grace.x / pad.home.width).map(
    ([after, across, down]): Move => ({ after, at: pad.at(across, down), contact: "down" }),
  );
  return { caption: EDGE_CAPTION[edges], moves: stroke(pad.at(0.5, 0.5), path) };
}

function otherHalfStep(settings: Settings, pad: PadLayout, panel: Panel): Step {
  const other = OTHER[pad.side];
  if (isOn(settings, other)) {
    const otherPad = padLayout(settings, other, panel);
    return {
      caption: `${SIDE_NAME[other]} half while both pads are idle: the ${other} pad takes it`,
      moves: stroke(otherPad.at(0.35, 0.4), [{ after: 0.8, at: otherPad.at(0.6, 0.6), contact: "down" }]),
    };
  }
  const centre = pad.at(0.5, 0.5);
  // This pad's centre mirrored: where the other pad would sit, across the screen from this pad's window.
  const start = onScreen({ x: 1 - centre.x, y: centre.y });
  return {
    caption: `${SIDE_NAME[other]} pad off: the whole screen starts the ${pad.side} pad`,
    moves: stroke(start, [{ after: 0.8, at: nudged(pad, start), contact: "down" }]),
  };
}

function isOn(settings: Settings, side: Side): boolean {
  return padChoice(settings, side) !== "off";
}

/** The steps' moves laid end to end, each step followed by a rest. */
function timeline(steps: readonly Step[]): Pick<Script, "keys" | "duration"> {
  const keys: Key[] = [];
  let t = 0;
  for (const step of steps) {
    for (const move of step.moves) {
      t += move.after;
      keys.push({ t, at: move.at, contact: move.contact, caption: step.caption });
    }
    t += REST_S;
  }
  return { keys, duration: t };
}

/**
 * A pad's demo, drawn from its settings: a tap with its output (and a tap-and-drag when Drag is on), a landing by
 * its anchor, a drag past its inner edge by its edge mode, and a touch in the other half. The left pad's is the
 * right pad's mirrored.
 */
export function padScript(settings: Settings, side: Side, panel: Panel): Script {
  const pad = padLayout(settings, side, panel);
  const steps = [
    ...tapSteps(settings, pad),
    ...landingSteps(settings, pad),
    edgeStep(pad),
    otherHalfStep(settings, pad, panel),
  ];
  return { side, heading: `${SIDE_NAME[side]} pad · ${padChoiceLabel(padChoice(settings, side))}`, ...timeline(steps) };
}
