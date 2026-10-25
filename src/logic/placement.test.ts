import { describe, expect, it } from "vitest";
import { centerYOf, heightOf, MIN_SIZE, maxSize, sizeAt, sizePosition } from "./placement";
import { homeRect, type Panel } from "./preview/geometry";

const NOVA: Panel = { width: 91, height: 68 };
// A screen whose half is wider than it is tall: the largest pad runs from top to bottom.
const WIDE: Panel = { width: 160, height: 60 };
// A screen too small for the Deck's 32.5 mm pad.
const TINY: Panel = { width: 50, height: 40 };

describe("maxSize", () => {
  it.each<[string, Panel, number]>([
    ["edge to middle on the Nova", NOVA, 1.4],
    ["top to bottom on a wide screen", WIDE, 60 / 32.5],
    ["never below the Deck's pad", TINY, 1],
  ])("is the largest square that fits a half: %s", (_name, panel, expected) => {
    expect(maxSize(panel)).toBeCloseTo(expected, 9);
  });
});

describe("sizeAt", () => {
  it.each<[number, number]>([
    [0, MIN_SIZE],
    [0.5, 0.65],
    [1, 1],
    [1.5, 1.2],
    [2, 1.4],
  ])("puts position %s at %s×: 0.3× to 1× over the first half, 1× to the largest over the second", (position, size) => {
    expect(sizeAt(position, NOVA)).toBe(size);
  });

  it("steps the first half by 0.05× over 14 steps", () => {
    expect(sizeAt(1 / 14, NOVA)).toBe(0.35);
  });
});

describe("sizePosition", () => {
  it.each<[number, number]>([
    [0.3, 0],
    [0.65, 0.5],
    [1, 1],
    [1.2, 1.5],
    [1.4, 2],
  ])("puts %s× at position %s", (size, position) => {
    expect(sizePosition(size, NOVA)).toBeCloseTo(position, 9);
  });

  it.each<[number, number]>([
    [2, 2],
    [3, 2],
    [0.1, 0],
  ])("holds %s× at the slider's end, %s", (size, position) => {
    expect(sizePosition(size, NOVA)).toBe(position);
  });

  it("puts every size above the Deck's pad at the end on a screen too small for it", () => {
    expect(sizePosition(1.2, TINY)).toBe(2);
  });
});

describe("heightOf and centerYOf", () => {
  it.each<[number, number]>([
    [0.5, 0.5],
    [16.25 / 68, 0],
    [51.75 / 68, 1],
  ])("reads center_y %s at 1× as height %s", (centerY, height) => {
    expect(heightOf(centerY, 1, NOVA)).toBeCloseTo(height, 9);
  });

  it.each<[number, number]>([
    [0, 0],
    [0.1, 0],
    [1, 1],
  ])("reads center_y %s, clamped by the daemon, as height %s", (centerY, height) => {
    expect(heightOf(centerY, 1, NOVA)).toBe(height);
  });

  it("reads the middle when the pad fills the screen's height", () => {
    expect(heightOf(0.2, 2, WIDE)).toBe(0.5);
  });

  it.each<[number, number]>([
    [0, 0.239],
    [0.5, 0.5],
    [1, 0.761],
  ])("writes height %s at 1× as center_y %s", (height, centerY) => {
    expect(centerYOf(height, 1, NOVA)).toBe(centerY);
  });

  it.each<[number, number]>([
    [0.3, 0],
    [1, 0],
    [1.4, 0],
    [2, 0],
    [0.3, 1],
    [1, 1],
    [1.4, 1],
  ])("puts the pad at %s× flush with the edge for height %s, as the daemon lays it out", (size, height) => {
    const rect = homeRect({ size, center_y: centerYOf(height, size, NOVA) }, "right", NOVA);
    expect(height === 0 ? rect.y : rect.y + rect.height).toBeCloseTo(height, 3);
  });

  it.each<[number, number]>([
    [0, 0.3],
    [0, 1],
    [0, 1.4],
    [0.25, 0.65],
    [0.5, 1],
    [0.8, 0.65],
    [1, 1],
    [1, 1.4],
  ])("reads back height %s it wrote at %s× exactly, despite center_y's rounding", (height, size) => {
    expect(heightOf(centerYOf(height, size, NOVA), size, NOVA)).toBe(height);
  });
});
