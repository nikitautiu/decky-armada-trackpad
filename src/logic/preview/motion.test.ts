import { describe, expect, it } from "vitest";
import type { Settings } from "../wire";
import type { Panel, Point, Rect } from "./geometry";
import { behaviourOf, contactPoint, land, moveTouch, type PadBehaviour } from "./motion";

// A home window of 0.2 x 0.25 at (0.6, 0.3), so its edges are at x 0.6 and 0.8, y 0.3 and 0.55.
const HOME: Rect = { x: 0.6, y: 0.3, width: 0.2, height: 0.25 };

const behaviour = (extra: Partial<PadBehaviour> = {}): PadBehaviour => ({
  anchor: "fixed",
  edges: "clamp",
  keepInside: false,
  grace: { x: 0.02, y: 0.03 },
  ...extra,
});

function expectPoint(actual: Point | null, expected: Point): void {
  expect(actual?.x).toBeCloseTo(expected.x, 12);
  expect(actual?.y).toBeCloseTo(expected.y, 12);
}

function expectWindowAt(actual: Rect, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 12);
  expect(actual.y).toBeCloseTo(y, 12);
  expect(actual.width).toBe(HOME.width);
  expect(actual.height).toBe(HOME.height);
}

describe("land", () => {
  it("keeps a fixed window home when the finger lands inside it", () => {
    expect(land(behaviour(), HOME, { x: 0.7, y: 0.4 })).toEqual({ window: HOME, lifted: false });
  });

  it("shifts a fixed window just enough that a landing outside is on its nearest corner", () => {
    expectWindowAt(land(behaviour(), HOME, { x: 0.5, y: 0.1 }).window, 0.5, 0.1);
    expectWindowAt(land(behaviour(), HOME, { x: 0.9, y: 0.7 }).window, 0.7, 0.45);
  });

  it("shifts a fixed window on one axis when the landing is outside on that axis only", () => {
    expectWindowAt(land(behaviour(), HOME, { x: 0.7, y: 0.1 }).window, 0.6, 0.1);
  });

  it("centres a float window on the landing", () => {
    expectWindowAt(land(behaviour({ anchor: "float" }), HOME, { x: 0.5, y: 0.2 }).window, 0.4, 0.075);
  });

  it("keeps a float window on the screen when keepInside is set", () => {
    const touch = land(behaviour({ anchor: "float", keepInside: true }), HOME, { x: 0.95, y: 0.05 });
    expectWindowAt(touch.window, 0.8, 0);
  });

  it("lets a float window hang off the screen by default", () => {
    expectWindowAt(land(behaviour({ anchor: "float" }), HOME, { x: 0.95, y: 0.05 }).window, 0.85, -0.075);
  });
});

describe("moveTouch", () => {
  const home = { window: HOME, lifted: false };
  // 0.1 past the inner (left) edge: beyond the grace of 0.02.
  const pastLeft: Point = { x: 0.5, y: 0.4 };

  it.each(["clamp", "mixed"] as const)("holds the window under %s edges", (edges) => {
    expect(moveTouch(behaviour({ edges }), home, pastLeft)).toEqual(home);
  });

  it("moves the window with the finger under follow, so the finger stays on its edge", () => {
    expectWindowAt(moveTouch(behaviour({ edges: "follow" }), home, pastLeft).window, 0.5, 0.3);
  });

  it("leaves a followed window where it went when the finger comes back", () => {
    const followed = moveTouch(behaviour({ edges: "follow" }), home, pastLeft);
    expectWindowAt(moveTouch(behaviour({ edges: "follow" }), followed, { x: 0.6, y: 0.4 }).window, 0.5, 0.3);
  });

  it("lifts the pad under release once the finger is past the grace", () => {
    expect(moveTouch(behaviour({ edges: "release" }), home, pastLeft)).toEqual({ window: HOME, lifted: true });
  });

  it("keeps the pad down under release while the finger is within the grace", () => {
    expect(moveTouch(behaviour({ edges: "release" }), home, { x: 0.59, y: 0.57 })).toEqual(home);
  });

  it("touches again under release only when the finger is back on the window", () => {
    const lifted = { window: HOME, lifted: true };
    expect(moveTouch(behaviour({ edges: "release" }), lifted, { x: 0.59, y: 0.4 })).toEqual(lifted);
    expect(moveTouch(behaviour({ edges: "release" }), lifted, { x: 0.65, y: 0.4 })).toEqual(home);
  });

  it("recentres the window on the finger under recenter, whatever the anchor", () => {
    expectWindowAt(moveTouch(behaviour({ edges: "recenter" }), home, pastLeft).window, 0.4, 0.275);
  });

  it("keeps a recentred window on the screen when keepInside is set", () => {
    const touch = moveTouch(behaviour({ edges: "recenter", keepInside: true }), home, { x: 0.05, y: 0.4 });
    expectWindowAt(touch.window, 0, 0.275);
  });
});

describe("contactPoint", () => {
  it("is the finger, clamped onto the window", () => {
    expectPoint(contactPoint({ window: HOME, lifted: false }, { x: 0.5, y: 0.6 }), { x: 0.6, y: 0.55 });
    expectPoint(contactPoint({ window: HOME, lifted: false }, { x: 0.7, y: 0.4 }), { x: 0.7, y: 0.4 });
  });

  it("is null while the pad is lifted", () => {
    expect(contactPoint({ window: HOME, lifted: true }, { x: 0.5, y: 0.6 })).toBeNull();
  });
});

describe("behaviourOf", () => {
  const four = (mode: string): string[] => [mode, mode, mode, mode];
  const panel: Panel = { width: 100, height: 50 };
  const settings: Settings = {
    anchor: "fixed",
    edges: four("clamp"),
    edge_grace_mm: 2,
    float_keep_inside: false,
    "right.anchor": "float",
    "right.edges": four("recenter"),
    "left.edges": ["clamp", "follow", "clamp", "clamp"],
    "left.float_keep_inside": true,
  };

  it("reads a side's anchor and edge mode, its overrides first", () => {
    expect(behaviourOf(settings, "right", panel)).toMatchObject({
      anchor: "float",
      edges: "recenter",
      keepInside: false,
    });
  });

  it("calls differing edges mixed", () => {
    expect(behaviourOf(settings, "left", panel)).toMatchObject({ anchor: "fixed", edges: "mixed", keepInside: true });
  });

  it("converts the edge grace to screen fractions per axis", () => {
    expect(behaviourOf(settings, "right", panel).grace).toEqual({ x: 0.02, y: 0.04 });
  });
});
