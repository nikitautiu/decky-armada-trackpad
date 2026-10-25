import { describe, expect, it } from "vitest";
import type { Side } from "../presets";
import type { Settings } from "../wire";
import { homeRect, type Panel, panelOf, type Rect } from "./geometry";

const PANEL: Panel = { width: 91, height: 68 };

const LAYOUT: Settings = { size: 1, center_y: 0.5, side: 0 };

const LEFT_AT_DEFAULTS: Rect = { x: 0, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 };

// Computed by the daemon's own `geometry.halves()` on the Nova's 91 x 68 mm panel, each window divided by the panel
// size: `halves((91.0, 68.0), {side: PadSpec(...)})` in armada-trackpad-daemon.
const DAEMON: readonly [string, Settings, Side, Rect][] = [
  [
    "defaults, right",
    {},
    "right",
    { x: 0.6428571428571429, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  ["defaults, left", {}, "left", LEFT_AT_DEFAULTS],
  [
    "side 0.05, right",
    { side: 0.05 },
    "right",
    { x: 0.6357142857142857, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "side 0.05, left",
    { side: 0.05 },
    "left",
    { x: 0.0071428571428571435, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "side 1, right",
    { side: 1 },
    "right",
    { x: 0.5, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "side 1, left",
    { side: 1 },
    "left",
    { x: 0.14285714285714285, y: 0.2610294117647059, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "size 2 shrinks to its half",
    { size: 2 },
    "right",
    { x: 0.5, y: 0.16544117647058823, width: 0.5, height: 0.6691176470588235 },
  ],
  [
    "center_y 0 is clamped to the top",
    { center_y: 0 },
    "left",
    { x: 0, y: 0, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "center_y 1 is clamped to the bottom",
    { center_y: 1 },
    "right",
    { x: 0.6428571428571429, y: 0.5220588235294118, width: 0.35714285714285715, height: 0.47794117647058826 },
  ],
  [
    "size 2, center_y 1, side 0.05",
    { size: 2, center_y: 1, side: 0.05 },
    "left",
    { x: 0, y: 0.33088235294117646, width: 0.5, height: 0.6691176470588235 },
  ],
  [
    "size 1.2, center_y 0.2, side 0.3",
    { size: 1.2, center_y: 0.2, side: 0.3 },
    "right",
    { x: 0.5499999999999999, y: 0, width: 0.42857142857142855, height: 0.5735294117647058 },
  ],
];

function expectRect(actual: Rect, expected: Rect): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.width).toBeCloseTo(expected.width, 12);
  expect(actual.height).toBeCloseTo(expected.height, 12);
}

describe("homeRect", () => {
  it.each(DAEMON)("matches the daemon's layout: %s", (_, extra, side, expected) => {
    expectRect(homeRect({ ...LAYOUT, ...extra }, side, PANEL), expected);
  });

  it("uses a side's own override over the shared value", () => {
    const settings: Settings = { ...LAYOUT, "right.size": 2, "right.side": null };
    expectRect(homeRect(settings, "right", PANEL), {
      x: 0.5,
      y: 0.16544117647058823,
      width: 0.5,
      height: 0.6691176470588235,
    });
    expectRect(homeRect(settings, "left", PANEL), LEFT_AT_DEFAULTS);
  });

  it("keeps the pad square in mm on another panel", () => {
    const rect = homeRect(LAYOUT, "right", { width: 130, height: 65 });
    expect(rect.width * 130).toBeCloseTo(32.5, 12);
    expect(rect.height * 65).toBeCloseTo(32.5, 12);
  });
});

describe("panelOf", () => {
  it("reads panel_mm", () => {
    expect(panelOf({ panel_mm: [130, 65] })).toEqual({ width: 130, height: 65 });
  });

  it.each<[string, Settings]>([
    ["missing", {}],
    ["not two numbers", { panel_mm: ["91", "68"] }],
    ["not positive", { panel_mm: [0, 68] }],
  ])("is null when panel_mm is %s", (_, settings) => {
    expect(panelOf(settings)).toBeNull();
  });
});
