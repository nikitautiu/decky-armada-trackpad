import { describe, expect, it } from "vitest";
import type { Side } from "../presets";
import type { Settings } from "../wire";
import { frame, frameAt, precompute } from "./frame";
import { homeRect, type Panel, type Rect } from "./geometry";
import { type Contact, type Key, padScript } from "./scenarios";

const four = (mode: string): string[] => [mode, mode, mode, mode];

/** The Nova's touch panel in mm. */
const PANEL: Panel = { width: 91, height: 68 };

/** Both pads on at the daemon's layout defaults: fixed clamp pads tapping R5 and L5, drag off. */
const BASE: Settings = {
  pads: "both",
  size: 1,
  center_y: 0.5,
  side: 0,
  anchor: "fixed",
  edges: four("clamp"),
  edge_grace_mm: 2,
  tap: true,
  tap_drag: false,
  "left.tap_output": "l5",
  "right.tap_output": "r5",
};

const settings = (extra: Settings = {}): Settings => ({ ...BASE, ...extra });

const HALF: Readonly<Record<Side, Rect>> = {
  left: { x: 0, y: 0, width: 0.5, height: 1 },
  right: { x: 0.5, y: 0, width: 0.5, height: 1 },
};

const SCREEN: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** The time of the `index`th key with `contact` in the step captioned `caption` of `side`'s script. */
function keyOf(values: Settings, side: Side, caption: string, contact: Contact, index = 0): Key {
  const key = padScript(values, side, PANEL).keys.filter((k) => k.caption === caption && k.contact === contact)[index];
  if (key === undefined) throw new Error(`no ${contact} key in "${caption}"`);
  return key;
}

const windowOf = (values: Settings, t: number, side: Side): Rect | undefined =>
  frame(values, t, PANEL).windows.find((window) => window.side === side)?.rect;

describe("frame: the loop", () => {
  it("plays the right pad's script, then the left pad's", () => {
    const right = padScript(BASE, "right", PANEL);
    expect(frame(BASE, 0, PANEL).heading).toBe("Right pad · Pad");
    expect(frame(BASE, right.duration + 0.01, PANEL).heading).toBe("Left pad · Pad");
  });

  it("starts over after both scripts", () => {
    const total = padScript(BASE, "right", PANEL).duration + padScript(BASE, "left", PANEL).duration;
    expect(frame(BASE, total + 1.3, PANEL)).toEqual(frame(BASE, 1.3, PANEL));
  });

  it("skips a pad that is off", () => {
    expect(frame(settings({ pads: "left" }), 0, PANEL).heading).toBe("Left pad · Pad");
    expect(frame(settings({ pads: "left" }), 0, PANEL).windows.map((window) => window.side)).toEqual(["left"]);
  });

  it("shows a still screen when both pads are off", () => {
    expect(frame(settings({ pads: "none" }), 3, PANEL)).toEqual({
      areas: [],
      midline: false,
      ghosts: [],
      windows: [],
      finger: null,
      contact: null,
      ripple: null,
      heading: null,
      caption: "Both pads off: the whole screen stays touch",
    });
  });
});

describe("frame: at rest", () => {
  it("draws each pad's home window, solid for fixed and dashed for float", () => {
    expect(frame(settings({ "left.anchor": "float" }), 0, PANEL).windows).toEqual([
      { side: "right", rect: homeRect(BASE, "right", PANEL), dashed: false },
      { side: "left", rect: homeRect(BASE, "left", PANEL), dashed: true },
    ]);
  });

  it("gives each pad its half, split by the midline, while both are idle", () => {
    const shown = frame(BASE, 0, PANEL);
    expect(shown.areas).toEqual([
      { side: "right", rect: HALF.right },
      { side: "left", rect: HALF.left },
    ]);
    expect(shown.midline).toBe(true);
  });

  it("gives the one pad that is on the whole screen, with no midline", () => {
    const shown = frame(settings({ pads: "right" }), 0, PANEL);
    expect(shown.areas).toEqual([{ side: "right", rect: SCREEN }]);
    expect(shown.midline).toBe(false);
  });
});

describe("frame: a tap", () => {
  it("ripples where the tap lifted, in the pad's colour", () => {
    const tap = keyOf(BASE, "right", "Tap: R5", "tap");
    expect(frame(BASE, tap.t + 0.1, PANEL).ripple).toEqual({
      side: "right",
      at: tap.at,
      progress: expect.closeTo(0.2, 9),
    });
    expect(frame(BASE, tap.t + 0.1, PANEL).finger).toBeNull();
  });

  it("holds the output while a tap-and-drag drags", () => {
    const values = settings({ tap_drag: true });
    const held = keyOf(values, "right", "Tap, then touch again and drag: holds R5", "held");
    expect(frame(values, held.t + 0.3, PANEL).contact).toMatchObject({ side: "right", held: true });
  });
});

describe("frame: past the inner edge", () => {
  const pastEdge = (edges: string, caption: string, index = 0): { values: Settings; t: number } => {
    const values = settings({ edges: four(edges) });
    return { values, t: keyOf(values, "right", caption, "down", index).t };
  };

  it("holds a clamp pad's contact on the rim while its window stays home", () => {
    const { values, t } = pastEdge("clamp", "Past an edge: held at the rim", 1);
    const shown = frame(values, t, PANEL);
    const home = homeRect(BASE, "right", PANEL);
    expect(shown.finger?.x).toBeLessThan(home.x);
    expect(shown.contact?.at.x).toBeCloseTo(home.x, 12);
    expect(shown.windows[0]?.rect).toEqual(home);
    expect(shown.ghosts).toEqual([]);
  });

  it("moves a follow pad's window with the finger and leaves a ghost at home", () => {
    const { values, t } = pastEdge("follow", "Past an edge: the window follows your finger", 1);
    const shown = frame(values, t, PANEL);
    expect(shown.windows[0]?.rect.x).toBeCloseTo(shown.finger?.x ?? Number.NaN, 12);
    expect(shown.ghosts).toEqual([homeRect(BASE, "right", PANEL)]);
  });

  it("lifts a release pad past the grace and touches again back on the window", () => {
    const caption = "Past an edge: the pad lifts until you come back";
    const { values, t } = pastEdge("release", caption, 1);
    expect(frame(values, t, PANEL).contact).toBeNull();
    expect(frame(values, t, PANEL).finger).not.toBeNull();
    expect(frame(values, keyOf(values, "right", caption, "down", 3).t, PANEL).contact).not.toBeNull();
  });

  it("lifts a release pad whose grace is wider than the usual drag past the edge", () => {
    // A 0.5 pad is 16.25 mm, so a 10 mm grace is about 0.6 pads.
    const values = settings({ edges: four("release"), size: 0.5, edge_grace_mm: 10 });
    const past = keyOf(values, "right", "Past an edge: the pad lifts until you come back", "down", 1);
    expect(frame(values, past.t, PANEL).contact).toBeNull();
  });

  it("recentres a recenter pad's window on the finger, more than once", () => {
    const { values, t } = pastEdge("recenter", "Past an edge: the window recenters and keeps going", 1);
    const shown = frame(values, t, PANEL);
    const window = shown.windows[0]?.rect;
    const home = homeRect(BASE, "right", PANEL);
    expect(window?.x).toBeLessThan(home.x - home.width);
    expect(shown.contact?.at).toEqual(shown.finger);
  });

  it("takes the other pad's start area to the whole screen while this pad is busy", () => {
    const { values, t } = pastEdge("clamp", "Past an edge: held at the rim", 1);
    expect(frame(values, t, PANEL).areas).toEqual([{ side: "left", rect: SCREEN }]);
    expect(frame(values, t, PANEL).midline).toBe(false);
  });
});

describe("frame: landing", () => {
  it("shifts a fixed window just enough to reach a landing outside it", () => {
    const landing = keyOf(BASE, "right", "Land outside: the window shifts just enough to reach it", "down");
    const shown = frame(BASE, landing.t, PANEL);
    expect(shown.windows[0]?.rect.y).toBeCloseTo(landing.at.y, 12);
    expect(shown.contact?.at).toEqual(landing.at);
    expect(shown.ghosts).toEqual([homeRect(BASE, "right", PANEL)]);
  });

  it("centres a float window on the landing, with no ghost", () => {
    const values = settings({ anchor: "float" });
    const landing = keyOf(values, "right", "Touch anywhere in the right half: the window centers on it", "down");
    const window = windowOf(values, landing.t, "right");
    expect((window?.x ?? 0) + (window?.width ?? 0) / 2).toBeCloseTo(landing.at.x, 12);
    expect((window?.y ?? 0) + (window?.height ?? 0) / 2).toBeCloseTo(landing.at.y, 12);
    expect(frame(values, landing.t, PANEL).ghosts).toEqual([]);
  });

  it("brings the window home after the finger lifts", () => {
    const caption = "Land outside: the window shifts just enough to reach it";
    const lift = keyOf(BASE, "right", caption, "up", 1);
    expect(windowOf(BASE, lift.t + 0.25, "right")?.y).toBeLessThan(homeRect(BASE, "right", PANEL).y);
    expect(windowOf(BASE, lift.t + 0.6, "right")).toEqual(homeRect(BASE, "right", PANEL));
  });
});

describe("frame: the other half", () => {
  it("lets the other pad take a touch in its half while both are idle", () => {
    const caption = "Left half while both pads are idle: the left pad takes it";
    const landing = keyOf(BASE, "right", caption, "down");
    expect(frame(BASE, landing.t + 0.2, PANEL).contact?.side).toBe("left");
    expect(frame(BASE, landing.t + 0.2, PANEL).heading).toBe("Right pad · Pad");
  });

  it("starts this pad from the other half while the other pad is off", () => {
    const values = settings({ pads: "right" });
    const caption = "Left pad off: the whole screen starts the right pad";
    const landing = keyOf(values, "right", caption, "down");
    const shown = frame(values, landing.t, PANEL);
    expect(shown.contact?.side).toBe("right");
    expect(shown.windows[0]?.rect.x).toBeCloseTo(landing.at.x, 12);
  });
});

describe("precompute", () => {
  // The loop's samples sit every 40 ms, on the 10 ms steps the frame is simulated at.
  const sampleTimes = (duration: number): number[] => {
    const times: number[] = [];
    for (let step = 0; step * 0.01 < duration; step += 4) times.push(step * 0.01);
    return times;
  };

  it.each<[string, Side, Settings]>([
    ["a clamp pad", "right", {}],
    ["a follow pad with drag", "right", { edges: four("follow"), tap_drag: true }],
    ["a release pad", "right", { edges: four("release") }],
    ["a float recenter pad", "right", { edges: four("recenter"), anchor: "float" }],
    ["the left pad alone, mixed edges", "left", { pads: "left", edges: ["clamp", "follow", "clamp", "clamp"] }],
  ])("samples the loop as frame() draws it: %s", (_, side, extra) => {
    const values = settings(extra);
    const loop = precompute(values, PANEL);
    for (const t of sampleTimes(padScript(values, side, PANEL).duration)) {
      expect(frameAt(loop, t)).toEqual(frame(values, t, PANEL));
    }
  });

  it("shows a sample until the next one", () => {
    const loop = precompute(BASE, PANEL);
    expect(frameAt(loop, 1.23)).toEqual(frameAt(loop, 1.2));
  });

  it("plays the left pad's samples after the right pad's, then starts over", () => {
    const loop = precompute(BASE, PANEL);
    const right = padScript(BASE, "right", PANEL).duration;
    const total = right + padScript(BASE, "left", PANEL).duration;
    expect(frameAt(loop, right + 0.1).heading).toBe("Left pad · Pad");
    expect(frameAt(loop, total + 1.3)).toEqual(frameAt(loop, 1.3));
  });

  it("is the still screen when both pads are off", () => {
    expect(frameAt(precompute(settings({ pads: "none" }), PANEL), 3)).toEqual(
      frame(settings({ pads: "none" }), 3, PANEL),
    );
  });
});
