import { describe, expect, it } from "vitest";
import { edgeMode, effective, PRESETS, type Preset, padChoice, padChoiceChanges } from "./presets";
import type { Settings } from "./wire";

const four = (mode: string): string[] => [mode, mode, mode, mode];

const base = (extra: Settings = {}): Settings => ({
  pads: "both",
  anchor: "fixed",
  edges: four("clamp"),
  "left.anchor": null,
  "right.anchor": null,
  "left.edges": null,
  "right.edges": null,
  ...extra,
});

describe("effective", () => {
  it("returns the shared value when the side override is null", () => {
    expect(effective(base(), "right", "anchor")).toBe("fixed");
  });

  it("returns the side override when set", () => {
    expect(effective(base({ "right.anchor": "float" }), "right", "anchor")).toBe("float");
  });

  it("returns the shared value when the side key is absent", () => {
    expect(effective({ anchor: "float" }, "left", "anchor")).toBe("float");
  });

  it("returns null when neither exists", () => {
    expect(effective({}, "left", "anchor")).toBeNull();
  });
});

describe("padChoice", () => {
  it.each<[Preset, string, string]>([
    ["pad", "fixed", "clamp"],
    ["radial", "float", "clamp"],
    ["swipe", "fixed", "recenter"],
    ["stick", "fixed", "follow"],
  ])("detects %s", (preset, anchor, edges) => {
    expect(PRESETS[preset]).toEqual({ anchor, edges });
    expect(padChoice(base({ anchor, edges: four(edges) }), "left")).toBe(preset);
  });

  it("shows custom for float with recenter edges", () => {
    expect(padChoice(base({ anchor: "float", edges: four("recenter") }), "left")).toBe("custom");
  });

  it("shows custom for fixed with release edges", () => {
    expect(padChoice(base({ edges: four("release") }), "left")).toBe("custom");
  });

  it("shows custom when the four edges differ", () => {
    expect(padChoice(base({ edges: ["clamp", "clamp", "release", "clamp"] }), "left")).toBe("custom");
  });

  it("shows off for a side missing from pads", () => {
    expect(padChoice(base({ pads: "left" }), "right")).toBe("off");
    expect(padChoice(base({ pads: "none" }), "left")).toBe("off");
  });

  it("lets a right override win over the shared anchor", () => {
    const settings = base({ "right.anchor": "float" });
    expect(padChoice(settings, "right")).toBe("radial");
    expect(padChoice(settings, "left")).toBe("pad");
  });

  it("accepts a single edge mode string", () => {
    expect(padChoice(base({ edges: "clamp" }), "left")).toBe("pad");
  });
});

describe("padChoiceChanges", () => {
  it.each([
    ["both", "left"],
    ["right", "none"],
  ])("removes the right side from pads %s giving %s", (pads, expected) => {
    expect(padChoiceChanges(base({ pads }), "right", "off")).toEqual({ pads: expected });
  });

  it("removes the left side from both", () => {
    expect(padChoiceChanges(base(), "left", "off")).toEqual({ pads: "right" });
  });

  it("adds the side and writes the preset's anchor and edges", () => {
    expect(padChoiceChanges(base({ pads: "left" }), "right", "swipe")).toEqual({
      pads: "both",
      "right.anchor": "fixed",
      "right.edges": "recenter",
    });
  });

  it("enables a side from none", () => {
    expect(padChoiceChanges(base({ pads: "none" }), "left", "stick")).toEqual({
      pads: "left",
      "left.anchor": "fixed",
      "left.edges": "follow",
    });
  });

  it("keeps pads unchanged for a preset on an enabled side", () => {
    expect(padChoiceChanges(base(), "left", "pad")).toEqual({
      pads: "both",
      "left.anchor": "fixed",
      "left.edges": "clamp",
    });
  });

  it.each<Preset>(["pad", "radial", "swipe", "stick"])("never writes a preset key for %s", (preset) => {
    const keys = Object.keys(padChoiceChanges(base(), "left", preset));
    expect(keys.some((key) => key.endsWith("preset"))).toBe(false);
  });
});

describe("edgeMode", () => {
  it("returns the mode when all four match", () => {
    expect(edgeMode(base(), "left")).toBe("clamp");
  });

  it("returns mixed when they differ", () => {
    expect(edgeMode(base({ "left.edges": ["clamp", "release", "clamp", "clamp"] }), "left")).toBe("mixed");
  });

  it("returns a single string mode as is", () => {
    expect(edgeMode(base({ edges: "follow" }), "right")).toBe("follow");
  });
});
