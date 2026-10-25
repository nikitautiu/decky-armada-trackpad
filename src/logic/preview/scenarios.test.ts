import { describe, expect, it } from "vitest";
import type { Side } from "../presets";
import type { Settings } from "../wire";
import { homeRect, type Panel, type Point, type Rect } from "./geometry";
import { type Key, padScript } from "./scenarios";

const four = (mode: string): string[] => [mode, mode, mode, mode];

/** The Nova's touch panel in mm. */
const PANEL: Panel = { width: 91, height: 68 };

/** Both pads on, laid out at the daemon's defaults, a fixed clamp pad tapping R5 with drag off. */
const BASE: Settings = {
  pads: "both",
  size: 1,
  center_y: 0.5,
  side: 0,
  anchor: "fixed",
  edges: four("clamp"),
  tap: true,
  tap_drag: false,
  tap_output: "r5",
};

const settings = (extra: Settings = {}): Settings => ({ ...BASE, ...extra });

const captions = (keys: readonly Key[]): string[] => [...new Set(keys.map((key) => key.caption))];

const stepKeys = (keys: readonly Key[], caption: string): Key[] => keys.filter((key) => key.caption === caption);

const firstDown = (keys: readonly Key[]): Key | undefined => keys.find((key) => key.contact === "down");

function inside(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

describe("padScript: the edge step", () => {
  it.each([
    ["clamp", "Past an edge: held at the rim"],
    ["follow", "Past an edge: the window follows your finger"],
    ["release", "Past an edge: the pad lifts until you come back"],
    ["recenter", "Past an edge: the window recenters and keeps going"],
  ])("shows %s edges with its own caption", (mode, caption) => {
    expect(captions(padScript(settings({ edges: four(mode) }), "right", PANEL).keys)).toContain(caption);
  });

  it("plays mixed edges as the clamp script, captioned Custom edges", () => {
    const mixed = padScript(settings({ edges: ["clamp", "follow", "clamp", "clamp"] }), "right", PANEL).keys;
    const clamp = padScript(settings(), "right", PANEL).keys;
    expect(stepKeys(mixed, "Custom edges").map((key) => key.at)).toEqual(
      stepKeys(clamp, "Past an edge: held at the rim").map((key) => key.at),
    );
  });

  it("drags past the pad's inner edge", () => {
    const keys = stepKeys(padScript(settings(), "right", PANEL).keys, "Past an edge: held at the rim");
    const home = homeRect(BASE, "right", PANEL);
    expect(Math.min(...keys.map((key) => key.at.x))).toBeLessThan(home.x);
  });

  it("is the same for either anchor", () => {
    const caption = "Past an edge: the window recenters and keeps going";
    const fixed = padScript(settings({ edges: four("recenter") }), "right", PANEL).keys;
    const float = padScript(settings({ edges: four("recenter"), anchor: "float" }), "right", PANEL).keys;
    expect(stepKeys(float, caption).map(({ at, contact }) => ({ at, contact }))).toEqual(
      stepKeys(fixed, caption).map(({ at, contact }) => ({ at, contact })),
    );
  });
});

describe("padScript: the landing step", () => {
  const FIXED = "Land outside: the window shifts just enough to reach it";

  it("lands a fixed pad outside its home window", () => {
    const landing = firstDown(stepKeys(padScript(settings(), "right", PANEL).keys, FIXED));
    expect(landing).toBeDefined();
    expect(inside(homeRect(BASE, "right", PANEL), landing?.at ?? { x: 0.75, y: 0.5 })).toBe(false);
  });

  it("lands a float pad off its centre, in its half while the other pad is on", () => {
    const caption = "Touch anywhere in the right half: the window centers on it";
    const keys = padScript(settings({ anchor: "float" }), "right", PANEL).keys;
    expect(captions(keys)).not.toContain(FIXED);
    expect(firstDown(stepKeys(keys, caption))?.at.x).toBeGreaterThan(0.5);
  });

  it("says anywhere for a float pad when the other pad is off", () => {
    const keys = padScript(settings({ anchor: "float", pads: "right" }), "right", PANEL).keys;
    expect(captions(keys)).toContain("Touch anywhere: the window centers on it");
  });

  it("lands beside the outer edge when that is the only room in the half", () => {
    // On a 130 x 30 mm panel a pad is 30 mm, the full height, and side 1 puts it against the centre line.
    const values = settings({ side: 1 });
    const wide: Panel = { width: 130, height: 30 };
    const landing = firstDown(stepKeys(padScript(values, "right", wide).keys, FIXED));
    const home = homeRect(values, "right", wide);
    expect(landing?.at.x).toBeGreaterThan(home.x + home.width);
  });

  it("is left out for a fixed pad with no room outside it in its half", () => {
    const keys = padScript(settings(), "right", { width: 65, height: 32.5 }).keys;
    expect(captions(keys)).not.toContain(FIXED);
  });
});

describe("padScript: taps", () => {
  it.each([
    ["r5", "Tap: R5"],
    ["pad", "Tap: Pad click"],
    ["l2_soft", "Tap: L2 soft"],
  ])("taps with the side's output %s", (output, caption) => {
    const keys = padScript(settings({ "right.tap_output": output }), "right", PANEL).keys;
    expect(captions(keys)[0]).toBe(caption);
    expect(stepKeys(keys, caption).some((key) => key.contact === "tap")).toBe(true);
  });

  it("adds a held drag after the tap when drag is on", () => {
    const caption = "Tap, then touch again and drag: holds R5";
    const keys = padScript(settings({ tap_drag: true }), "right", PANEL).keys;
    expect(captions(keys).slice(0, 2)).toEqual(["Tap: R5", caption]);
    expect(stepKeys(keys, caption).some((key) => key.contact === "held")).toBe(true);
  });

  it("taps nothing when tap is off, even with drag on", () => {
    const keys = padScript(settings({ tap: false, tap_drag: true }), "right", PANEL).keys;
    expect(keys.some((key) => key.contact === "tap" || key.contact === "held")).toBe(false);
  });
});

describe("padScript: the other half", () => {
  it("lands in the other pad's half while it is on", () => {
    const caption = "Left half while both pads are idle: the left pad takes it";
    const landing = firstDown(stepKeys(padScript(settings(), "right", PANEL).keys, caption));
    expect(landing?.at.x).toBeLessThan(0.5);
  });

  it("lands in the other half for this pad when the other pad is off", () => {
    const caption = "Right pad off: the whole screen starts the left pad";
    const landing = firstDown(stepKeys(padScript(settings({ pads: "left" }), "left", PANEL).keys, caption));
    expect(landing?.at.x).toBeGreaterThan(0.5);
  });
});

describe("padScript: the whole script", () => {
  it.each<[Side, Settings, string]>([
    ["right", {}, "Right pad · Pad"],
    ["right", { "right.edges": four("recenter") }, "Right pad · Swipe"],
    ["left", { anchor: "float" }, "Left pad · Radial"],
    ["left", { edges: four("release") }, "Left pad · Custom"],
  ])("is headed by the %s pad's choice", (side, extra, heading) => {
    expect(padScript(settings(extra), side, PANEL).heading).toBe(heading);
  });

  it("mirrors the left pad's script", () => {
    const right = padScript(settings({ tap_drag: true }), "right", PANEL).keys;
    const left = padScript(settings({ tap_drag: true }), "left", PANEL).keys;
    expect(left.map((key) => key.t)).toEqual(right.map((key) => key.t));
    left.forEach((key, index) => {
      expect(key.at.x).toBeCloseTo(1 - (right[index]?.at.x ?? Number.NaN), 12);
      expect(key.at.y).toBeCloseTo(right[index]?.at.y ?? Number.NaN, 12);
    });
  });

  it.each<[string, Settings]>([
    ["defaults", {}],
    ["a big pad at the centre line, swiping", { size: 2, side: 1, edges: four("recenter") }],
    ["a small pad at the bottom, following", { size: 0.3, center_y: 1, edges: four("follow"), anchor: "float" }],
  ])("keeps the finger on the screen and its keys in order: %s", (_, extra) => {
    const script = padScript(settings({ tap_drag: true, ...extra }), "right", PANEL);
    for (const key of script.keys) {
      expect(inside({ x: 0, y: 0, width: 1, height: 1 }, key.at)).toBe(true);
    }
    const times = script.keys.map((key) => key.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(script.duration).toBeGreaterThan(times[times.length - 1] ?? Number.POSITIVE_INFINITY);
  });
});
