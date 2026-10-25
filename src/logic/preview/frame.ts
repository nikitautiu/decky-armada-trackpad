import { padChoice, type Side } from "../presets";
import type { Settings } from "../wire";
import { homeRect, type Panel, type Point, type Rect } from "./geometry";
import { behaviourOf, contactPoint, land, moveTouch, type PadBehaviour, type Touch } from "./motion";
import { type Key, padScript, type Script } from "./scenarios";

/** A pad's window as drawn: dashed for a float anchor, solid for fixed. */
export type PadWindow = { readonly side: Side; readonly rect: Rect; readonly dashed: boolean };

/** Where a new touch would start a pad, tinted in its colour. */
export type StartArea = { readonly side: Side; readonly rect: Rect };

/** Where the pad is touched; `held` while a tap-and-drag holds the tap output. */
export type PadContact = { readonly side: Side; readonly at: Point; readonly held: boolean };

/** A tap's ripple, `progress` from 0 as the tap lifts to 1 as it fades. */
export type Ripple = { readonly side: Side; readonly at: Point; readonly progress: number };

/** What the preview draws at one moment, in screen fractions, and the lines under it. */
export type Frame = {
  readonly areas: readonly StartArea[];
  /** The dashed centre line between the halves, shown while each half starts its own pad. */
  readonly midline: boolean;
  /** A fixed pad's home window, while its window has moved away from it. */
  readonly ghosts: readonly Rect[];
  readonly windows: readonly PadWindow[];
  /** The finger, while it is down. */
  readonly finger: Point | null;
  readonly contact: PadContact | null;
  readonly ripple: Ripple | null;
  /** The pad whose demo plays and its choice, such as "Right pad · Swipe". */
  readonly heading: string | null;
  readonly caption: string;
};

const BOTH_OFF: Frame = {
  areas: [],
  midline: false,
  ghosts: [],
  windows: [],
  finger: null,
  contact: null,
  ripple: null,
  heading: null,
  caption: "Both pads off: the whole screen stays touch",
};

// The demo is stepped at this interval, so edge modes that depend on the path (follow, recenter) see it move.
const SIM_STEP_S = 0.01;

// How long a window takes to glide home after a lift; the daemon places it again only at the next landing, but
// a jump would be hard to follow.
const RETURN_S = 0.5;

const RIPPLE_S = 0.5;

// The right pad's demo plays first.
const LOOP_ORDER: readonly Side[] = ["right", "left"];

const SCREEN: Rect = { x: 0, y: 0, width: 1, height: 1 };

const HALF: Readonly<Record<Side, Rect>> = {
  left: { x: 0, y: 0, width: 0.5, height: 1 },
  right: { x: 0.5, y: 0, width: 0.5, height: 1 },
};

type Pad = { readonly side: Side; readonly home: Rect; readonly behaviour: PadBehaviour };

/** A pad between touches, gliding home from `from` since `since`, or touched. */
type Track =
  | { readonly kind: "idle"; readonly from: Rect; readonly since: number }
  | { readonly kind: "touching"; readonly touch: Touch };

type PadState = { readonly pad: Pad; readonly track: Track };

/** The pads at one moment, and the one the finger is down on. */
type Sim = { readonly pads: readonly PadState[]; readonly owner: Side | null };

function padsOn(settings: Settings, panel: Panel): readonly Pad[] {
  return LOOP_ORDER.filter((side) => padChoice(settings, side) !== "off").map((side) => ({
    side,
    home: homeRect(settings, side, panel),
    behaviour: behaviourOf(settings, side, panel),
  }));
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/** The key in effect at `t`, and the finger there: on its way from that key to the next. */
function sample(script: Script, t: number): { readonly key: Key; readonly finger: Point } {
  const { keys } = script;
  let index = 0;
  while (index < keys.length - 1 && (keys[index + 1]?.t ?? Number.POSITIVE_INFINITY) <= t) index += 1;
  const key = keys[index];
  // Sound: a script always has keys, since its edge and other-half steps always have moves.
  if (key === undefined) throw new Error("a pad script has no keys");
  const next = keys[index + 1] ?? key;
  const progress = next.t > key.t ? Math.min(1, (t - key.t) / (next.t - key.t)) : 0;
  return { key, finger: { x: lerp(key.at.x, next.at.x, progress), y: lerp(key.at.y, next.at.y, progress) } };
}

function isDown(key: Key): boolean {
  return key.contact === "down" || key.contact === "held";
}

function windowAt(state: PadState, t: number): Rect {
  const { track, pad } = state;
  if (track.kind === "touching") return track.touch.window;
  const progress = (t - track.since) / RETURN_S;
  if (progress >= 1) return pad.home;
  return {
    ...pad.home,
    x: lerp(track.from.x, pad.home.x, progress),
    y: lerp(track.from.y, pad.home.y, progress),
  };
}

/** The pad a landing starts: with both pads idle the one of its half (the centre line is the right's), else the one on. */
function ownerOf(pads: readonly PadState[], finger: Point): Side | null {
  if (pads.length === 2) return finger.x >= 0.5 ? "right" : "left";
  return pads[0]?.pad.side ?? null;
}

function withTrack(sim: Sim, side: Side, owner: Side | null, track: (state: PadState) => Track): Sim {
  return {
    owner,
    pads: sim.pads.map((state) => (state.pad.side === side ? { ...state, track: track(state) } : state)),
  };
}

/** The pads one moment on: a landing places a window, a move applies the edges, a lift lets the window go home. */
function advance(sim: Sim, script: Script, t: number): Sim {
  const { key, finger } = sample(script, t);
  const { owner } = sim;
  if (!isDown(key)) {
    if (owner === null) return sim;
    return withTrack(sim, owner, null, (state) => ({ kind: "idle", from: windowAt(state, t), since: t }));
  }
  if (owner === null) {
    const side = ownerOf(sim.pads, finger);
    if (side === null) return sim;
    return withTrack(sim, side, side, ({ pad }) => ({
      kind: "touching",
      touch: land(pad.behaviour, pad.home, finger),
    }));
  }
  return withTrack(sim, owner, owner, ({ pad, track }) =>
    track.kind === "touching" ? { kind: "touching", touch: moveTouch(pad.behaviour, track.touch, finger) } : track,
  );
}

/** Both pads idle at home, as each script starts. */
function atRest(pads: readonly Pad[]): Sim {
  return { owner: null, pads: pads.map((pad) => ({ pad, track: { kind: "idle", from: pad.home, since: 0 } })) };
}

/** The pads at `t` into `script`, stepped from its start. */
function simulate(pads: readonly Pad[], script: Script, t: number): Sim {
  let sim = atRest(pads);
  for (let step = 1; step * SIM_STEP_S < t; step += 1) sim = advance(sim, script, step * SIM_STEP_S);
  return advance(sim, script, t);
}

/** Each half starts its own pad while both are idle; the whole screen starts the other pad while one is busy or off. */
function startAreas(pads: readonly Pad[], owner: Side | null): readonly StartArea[] {
  if (owner !== null) return pads.filter((pad) => pad.side !== owner).map((pad) => ({ side: pad.side, rect: SCREEN }));
  if (pads.length === 1) return pads.map((pad) => ({ side: pad.side, rect: SCREEN }));
  return pads.map((pad) => ({ side: pad.side, rect: HALF[pad.side] }));
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function contactOf(sim: Sim, key: Key, finger: Point): PadContact | null {
  const state = sim.pads.find(({ pad }) => pad.side === sim.owner);
  if (state === undefined || state.track.kind !== "touching") return null;
  const at = contactPoint(state.track.touch, finger);
  return at === null ? null : { side: state.pad.side, at, held: key.contact === "held" };
}

function rippleAt(script: Script, t: number): Ripple | null {
  const tap = script.keys.filter((key) => key.contact === "tap" && key.t <= t).pop();
  if (tap === undefined || t - tap.t >= RIPPLE_S) return null;
  return { side: script.side, at: tap.at, progress: (t - tap.t) / RIPPLE_S };
}

/** `t` folded into a loop of `total` seconds. */
function loopTime(t: number, total: number): number {
  // `%` is exact, so a time within the first loop stays exactly as it is and lands on its keys.
  const folded = t % total;
  return folded < 0 ? folded + total : folded;
}

/** The script playing at `t` of the loop, and how far into it. */
function playing(scripts: readonly Script[], t: number): { readonly script: Script; readonly t: number } | null {
  const total = scripts.reduce((sum, script) => sum + script.duration, 0);
  let local = loopTime(t, total);
  for (const script of scripts) {
    if (local < script.duration) return { script, t: local };
    local -= script.duration;
  }
  return null;
}

/** What the pads in `sim` look like at `t` into `script`. */
function drawn(pads: readonly Pad[], script: Script, sim: Sim, t: number): Frame {
  const { key, finger } = sample(script, t);
  const windows = sim.pads.map((state) => ({ state, rect: windowAt(state, t) }));
  return {
    areas: startAreas(pads, sim.owner),
    midline: sim.owner === null && pads.length === 2,
    ghosts: windows
      .filter(({ state, rect }) => state.pad.behaviour.anchor === "fixed" && !sameRect(rect, state.pad.home))
      .map(({ state }) => state.pad.home),
    windows: windows.map(({ state, rect }) => ({
      side: state.pad.side,
      rect,
      dashed: state.pad.behaviour.anchor === "float",
    })),
    finger: isDown(key) ? finger : null,
    contact: contactOf(sim, key, finger),
    ripple: rippleAt(script, t),
    heading: script.heading,
    caption: key.caption,
  };
}

/**
 * The preview at `t` seconds into its loop: the right pad's demo, then the left pad's, skipping a pad that is
 * off; a still screen when both are.
 *
 * It steps the demo from the start of the playing script, so the panel draws from {@link precompute} instead; this
 * is the direct computation the precomputed loop is held to.
 */
export function frame(settings: Settings, t: number, panel: Panel): Frame {
  const pads = padsOn(settings, panel);
  const now = playing(
    pads.map((pad) => padScript(settings, pad.side, panel)),
    t,
  );
  if (now === null) return BOTH_OFF;
  return drawn(pads, now.script, simulate(pads, now.script, now.t), now.t);
}

/** One pad's demo, sampled every {@link PreviewLoop.interval} seconds. */
type Segment = { readonly duration: number; readonly frames: readonly Frame[] };

/** The whole loop of a settings snapshot, sampled once so each frame drawn is a lookup. */
export type PreviewLoop = {
  /** Seconds between samples. */
  readonly interval: number;
  /** The pads' demos in the order they play; none when both pads are off. */
  readonly segments: readonly Segment[];
};

// A sample every 40 ms (25 per second), smooth enough for the preview, on the simulation's steps.
const STEPS_PER_SAMPLE = 4;

// A time on a sample must not fall to the sample before it through rounding in the division.
const ON_SAMPLE = 1e-9;

function segment(pads: readonly Pad[], script: Script): Segment {
  const frames: Frame[] = [];
  let sim = atRest(pads);
  for (let step = 0; step * SIM_STEP_S < script.duration; step += 1) {
    const t = step * SIM_STEP_S;
    sim = advance(sim, script, t);
    if (step % STEPS_PER_SAMPLE === 0) frames.push(drawn(pads, script, sim, t));
  }
  return { duration: script.duration, frames };
}

/** The loop {@link frame} draws for `settings` on `panel`, stepped once and sampled every 40 ms. */
export function precompute(settings: Settings, panel: Panel): PreviewLoop {
  const pads = padsOn(settings, panel);
  return {
    interval: STEPS_PER_SAMPLE * SIM_STEP_S,
    segments: pads.map((pad) => segment(pads, padScript(settings, pad.side, panel))),
  };
}

/** The sample of `loop` shown at `t` seconds into it: the latest one at or before `t`, looping. */
export function frameAt(loop: PreviewLoop, t: number): Frame {
  const total = loop.segments.reduce((sum, { duration }) => sum + duration, 0);
  if (total === 0) return BOTH_OFF;
  let local = loopTime(t, total);
  for (const { duration, frames } of loop.segments) {
    if (local < duration) {
      const index = Math.min(Math.floor(local / loop.interval + ON_SAMPLE), frames.length - 1);
      return frames[index] ?? BOTH_OFF;
    }
    local -= duration;
  }
  return BOTH_OFF;
}
