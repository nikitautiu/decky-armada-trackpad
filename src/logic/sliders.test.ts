import { describe, expect, it } from "vitest";
import type { Panel } from "./preview/geometry";
import {
  DRAG_WINDOW,
  dragWindowLabel,
  heightLabel,
  type Lookup,
  notchLabels,
  type SliderSpec,
  sideLabel,
  sizeAndPosition,
  sizeLabel,
} from "./sliders";

const NOVA: Panel = { width: 91, height: 68 };

const spec = (key: string): SliderSpec => {
  const found = sizeAndPosition(NOVA).find((slider) => slider.key === key);
  if (found === undefined) throw new Error(`no slider ${key}`);
  return found;
};

/** A lookup of `values`, 0 for any other key. */
const lookup =
  (values: Readonly<Record<string, number>>): Lookup =>
  (key) =>
    values[key] ?? 0;

describe("slider values", () => {
  it.each<[number, string]>([
    [1, "1.00×"],
    [0.3, "0.30×"],
    [1.05, "1.05×"],
    [2, "2.00×"],
  ])("shows size %s as %s", (size, expected) => {
    expect(sizeLabel(size)).toBe(expected);
  });

  it.each<[number, string]>([
    [0, "Top"],
    [0.35, "35%"],
    [0.5, "Middle"],
    [0.7, "70%"],
    [1, "Bottom"],
  ])("shows height %s as %s", (centerY, expected) => {
    expect(heightLabel(centerY)).toBe(expected);
  });

  it.each<[number, string]>([
    [0, "Edge"],
    [0.45, "45%"],
    [1, "Center"],
  ])("shows inward %s as %s", (side, expected) => {
    expect(sideLabel(side)).toBe(expected);
  });
});

describe("sizeAndPosition", () => {
  it("lists the three sliders in panel order", () => {
    expect(sizeAndPosition(NOVA).map((slider) => [slider.key, slider.label])).toEqual([
      ["size", "Size"],
      ["center_y", "Vertical position"],
      ["side", "Horizontal position"],
    ]);
  });

  it.each<[string, number, number, number]>([
    ["size", 0, 2, 1 / 14],
    ["center_y", 0, 1, 0.05],
    ["side", 0, 1, 0.05],
  ])("moves %s from %s to %s in steps of %s", (key, min, max, step) => {
    expect(spec(key)).toMatchObject({ min, max, step });
  });

  it("describes each end with its own label", () => {
    expect(sizeAndPosition(NOVA).map((slider) => [slider.describe(slider.min), slider.describe(slider.max)])).toEqual([
      ["0.30×", "Max"],
      ["Top", "Bottom"],
      ["Edge", "Center"],
    ]);
  });

  it.each<[number, string]>([
    [1, "Steam Deck"],
    [1.5, "1.20×"],
    [13 / 14, "0.95×"],
  ])("describes size position %s as %s", (position, expected) => {
    expect(spec("size").describe(position)).toBe(expected);
  });
});

describe("the Size slider", () => {
  it.each<[number, number]>([
    [0.3, 0],
    [1, 1],
    [1.4, 2],
    [2, 2],
  ])("shows size %s at position %s", (size, position) => {
    expect(spec("size").read(lookup({ size, center_y: 0.5 }))).toBeCloseTo(position, 9);
  });

  it("writes the size with the center_y that keeps the pad's height", () => {
    const flushTop = lookup({ size: 1, center_y: 0.239 });
    expect(spec("size").write(2, flushTop)).toEqual({ size: 1.4, center_y: 0.3346 });
  });

  it("keeps a pad in the middle there at any size", () => {
    expect(spec("size").write(0, lookup({ size: 1, center_y: 0.5 }))).toEqual({ size: 0.3, center_y: 0.5 });
  });
});

describe("the Vertical position slider", () => {
  it.each<[number, number, number]>([
    [1, 0.239, 0],
    [1, 0.5, 0.5],
    [1, 0, 0],
    [1.4, 0.6654, 1],
  ])("at size %s shows center_y %s at position %s", (size, centerY, position) => {
    expect(spec("center_y").read(lookup({ size, center_y: centerY }))).toBeCloseTo(position, 3);
  });

  it("writes center_y for the pad's size", () => {
    expect(spec("center_y").write(1, lookup({ size: 1 }))).toEqual({ center_y: 0.761 });
  });
});

describe("the Horizontal position slider", () => {
  it("shows and writes side as it is", () => {
    expect(spec("side").read(lookup({ side: 0.35 }))).toBe(0.35);
    expect(spec("side").write(0.4, lookup({}))).toEqual({ side: 0.4 });
  });
});

describe("notchLabels", () => {
  it.each<[string, string, string]>([
    ["size", "0.3×", "Max"],
    ["center_y", "Top", "Bottom"],
    ["side", "Edge", "Center"],
  ])("labels the ends of %s, %s and %s, with an unlabelled middle notch", (key, min, max) => {
    const slider = spec(key);
    expect(slider.notchCount).toBe(3);
    expect(notchLabels(slider)).toEqual([
      { notchIndex: 0, label: min, value: slider.min },
      { notchIndex: 2, label: max, value: slider.max },
    ]);
  });
});

describe("DRAG_WINDOW", () => {
  it("writes the shared tap_drag_ms from 80 to 300 ms in steps of 10", () => {
    expect(DRAG_WINDOW).toMatchObject({ key: "tap_drag_ms", label: "Drag window", min: 80, max: 300, step: 10 });
  });

  it.each<[number, string]>([
    [80, "80 ms"],
    [200, "200 ms"],
    [50, "50 ms"],
  ])("shows %s as %s, even outside the slider's range", (value, expected) => {
    expect(dragWindowLabel(value)).toBe(expected);
    expect(DRAG_WINDOW.describe(value)).toBe(expected);
  });

  it("labels the ends 80 ms and 300 ms", () => {
    expect(notchLabels(DRAG_WINDOW)).toEqual([
      { notchIndex: 0, label: "80 ms", value: 80 },
      { notchIndex: 1, label: "300 ms", value: 300 },
    ]);
  });
});
