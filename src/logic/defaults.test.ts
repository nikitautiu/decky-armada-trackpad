import { describe, expect, it } from "vitest";
import { defaultValue, PLUGIN_DEFAULTS, resetAllChanges, resetPadChanges } from "./defaults";
import { padChoice, type Side } from "./presets";
import type { Settings } from "./wire";

const four = (mode: string): string[] => [mode, mode, mode, mode];

/** The daemon's defaults: both pads Pad, the pad's own click, the window flush to the outer edge. */
const DAEMON_DEFAULTS: Settings = {
  pads: "both",
  size: 1,
  side: 0,
  anchor: "fixed",
  edges: four("clamp"),
  float_keep_inside: false,
  tap: true,
  tap_output: "pad",
  tap_drag_ms: 200,
  panel_mm: [91, 68],
  log_level: "info",
  "left.anchor": null,
  "left.edges": null,
  "left.size": null,
  "left.float_keep_inside": null,
  "left.tap_output": null,
  "left.tap": null,
  "left.tap_drag": null,
  "right.anchor": null,
  "right.edges": null,
  "right.size": null,
  "right.float_keep_inside": null,
  "right.tap_output": null,
  "right.tap": null,
  "right.tap_drag": null,
};

/** The daemon's settings once the plugin defaults are applied. */
const AT_PLUGIN_DEFAULTS: Settings = {
  ...DAEMON_DEFAULTS,
  side: 0.2,
  tap_drag_ms: 120,
  "left.anchor": "fixed",
  "left.edges": four("clamp"),
  "right.anchor": "fixed",
  "right.edges": four("recenter"),
  "right.tap": true,
  "right.tap_drag": true,
};

describe("PLUGIN_DEFAULTS", () => {
  it.each<[Side, string]>([
    ["left", "pad"],
    ["right", "swipe"],
  ])("gives the %s pad the %s preset", (side, preset) => {
    expect(padChoice({ ...DAEMON_DEFAULTS, ...PLUGIN_DEFAULTS }, side)).toBe(preset);
  });

  it.each<[string, string | number | boolean]>([
    ["pads", "both"],
    ["side", 0.2],
    ["tap_drag_ms", 120],
    ["right.tap", true],
    ["right.tap_drag", true],
  ])("sets %s to %s", (key, value) => {
    expect(PLUGIN_DEFAULTS[key]).toBe(value);
  });

  it("leaves both pads on the daemon's tap output, the pad click", () => {
    expect(defaultValue(DAEMON_DEFAULTS, "left.tap_output")).toBeNull();
    expect(defaultValue(DAEMON_DEFAULTS, "right.tap_output")).toBeNull();
    expect(defaultValue(DAEMON_DEFAULTS, "tap_output")).toBe("pad");
  });

  it("never sets a preset key, panel_mm, log_level or float_keep_inside", () => {
    expect(
      Object.keys(PLUGIN_DEFAULTS).filter((key) => /preset|panel_mm|log_level|float_keep_inside/.test(key)),
    ).toEqual([]);
  });
});

describe("defaultValue", () => {
  it("returns the plugin default over the daemon's", () => {
    expect(defaultValue(DAEMON_DEFAULTS, "side")).toBe(0.2);
  });

  it("returns the plugin's shorter drag window over the daemon's", () => {
    expect(defaultValue(DAEMON_DEFAULTS, "tap_drag_ms")).toBe(120);
  });

  it("returns the daemon's default for a key the plugin leaves alone", () => {
    expect(defaultValue(DAEMON_DEFAULTS, "size")).toBe(1);
  });

  it("returns null for a key neither has", () => {
    expect(defaultValue(DAEMON_DEFAULTS, "toString")).toBeNull();
  });
});

describe("resetPadChanges", () => {
  it("writes the pad's plugin defaults and clears its other overrides", () => {
    const settings: Settings = { ...DAEMON_DEFAULTS, "left.anchor": "float", "left.size": 1.5 };
    expect(resetPadChanges(settings, "left")).toEqual({
      "left.anchor": "fixed",
      "left.edges": four("clamp"),
      "left.size": null,
    });
  });

  it("gives the right pad the Swipe preset and tap with drag", () => {
    expect(resetPadChanges(DAEMON_DEFAULTS, "right")).toEqual({
      "right.anchor": "fixed",
      "right.edges": four("recenter"),
      "right.tap": true,
      "right.tap_drag": true,
    });
  });

  it("clears a button tap output back to the pad click", () => {
    expect(resetPadChanges({ ...AT_PLUGIN_DEFAULTS, "left.tap_output": "l5" }, "left")).toEqual({
      "left.tap_output": null,
    });
  });

  it("sends nothing when the pad is already at its defaults", () => {
    expect(resetPadChanges(AT_PLUGIN_DEFAULTS, "left")).toEqual({});
  });

  it("leaves the other pad and the shared settings alone", () => {
    const settings: Settings = { ...DAEMON_DEFAULTS, side: 0.5, "right.size": 1.5 };
    expect(Object.keys(resetPadChanges(settings, "left")).every((key) => key.startsWith("left."))).toBe(true);
  });

  it("never writes the pad's float_keep_inside", () => {
    expect(resetPadChanges({ ...AT_PLUGIN_DEFAULTS, "left.float_keep_inside": true }, "left")).toEqual({});
  });
});

describe("resetAllChanges", () => {
  it("brings every setting to the plugin default, else the daemon's", () => {
    const settings: Settings = { ...AT_PLUGIN_DEFAULTS, size: 1.5, side: 0.3, "right.anchor": "float" };
    expect(resetAllChanges(settings, DAEMON_DEFAULTS)).toEqual({ size: 1, side: 0.2, "right.anchor": "fixed" });
  });

  it("brings the drag window to 120 ms", () => {
    expect(resetAllChanges({ ...AT_PLUGIN_DEFAULTS, tap_drag_ms: 200 }, DAEMON_DEFAULTS)).toEqual({ tap_drag_ms: 120 });
  });

  it("starts both pads from the daemon's defaults: left Pad, right Swipe with drag", () => {
    expect(resetAllChanges(DAEMON_DEFAULTS, DAEMON_DEFAULTS)).toEqual({
      side: 0.2,
      tap_drag_ms: 120,
      "left.anchor": "fixed",
      "left.edges": four("clamp"),
      "right.anchor": "fixed",
      "right.edges": four("recenter"),
      "right.tap": true,
      "right.tap_drag": true,
    });
  });

  it("turns both pads back on", () => {
    expect(resetAllChanges({ ...AT_PLUGIN_DEFAULTS, pads: "left" }, DAEMON_DEFAULTS)).toEqual({ pads: "both" });
  });

  it("sends nothing when every setting is at its default", () => {
    expect(resetAllChanges(AT_PLUGIN_DEFAULTS, DAEMON_DEFAULTS)).toEqual({});
  });

  it.each(["panel_mm", "log_level", "float_keep_inside", "right.float_keep_inside"])("never writes %s", (key) => {
    const changes = resetAllChanges({ ...AT_PLUGIN_DEFAULTS, [key]: "changed" }, DAEMON_DEFAULTS);
    expect(changes).toEqual({});
  });

  it("clears a set override the daemon defaults to null", () => {
    expect(resetAllChanges({ ...AT_PLUGIN_DEFAULTS, "left.size": 0.5 }, DAEMON_DEFAULTS)).toEqual({
      "left.size": null,
    });
  });

  it("clears a key the daemon has no default for", () => {
    expect(resetAllChanges({ ...AT_PLUGIN_DEFAULTS, "left.tap_drag": true }, DAEMON_DEFAULTS)).toEqual({
      "left.tap_drag": null,
    });
  });
});
