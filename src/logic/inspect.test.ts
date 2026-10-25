import { describe, expect, it } from "vitest";
import { INSPECT_GROUPS, inspectRows, inspectText, overridesNote, statusRows, wireKey } from "./inspect";
import type { Settings, Status } from "./wire";

const four = (mode: string): string[] => [mode, mode, mode, mode];

const DEFAULTS: Settings = {
  pads: "both",
  size: 1,
  panel_mm: [91, 68],
  edges: four("clamp"),
  tap: true,
  "right.anchor": null,
  "right.edges": null,
};

const row = (rows: ReturnType<typeof inspectRows>, group: string, key: string) =>
  rows.find((r) => r.group === group && r.key === key);

describe("inspectRows", () => {
  it("marks pads right as changed against the default both", () => {
    const rows = inspectRows({ ...DEFAULTS, pads: "right" }, DEFAULTS);
    expect(row(rows, "shared", "pads")).toEqual({ group: "shared", key: "pads", value: "right", changed: true });
    expect(row(rows, "shared", "size")?.changed).toBe(false);
  });

  it("formats edges as one mode when all four match, else comma-joined", () => {
    const mixed = { ...DEFAULTS, edges: ["clamp", "release", "clamp", "clamp"] };
    expect(row(inspectRows(DEFAULTS, DEFAULTS), "shared", "edges")?.value).toBe("clamp");
    expect(row(inspectRows(mixed, DEFAULTS), "shared", "edges")).toMatchObject({
      value: "clamp, release, clamp, clamp",
      changed: true,
    });
  });

  it("formats panel_mm as width x height", () => {
    expect(row(inspectRows(DEFAULTS, DEFAULTS), "shared", "panel_mm")?.value).toBe("91x68");
  });

  it("lists side overrides only when not null, in their group", () => {
    const settings = { ...DEFAULTS, "right.anchor": "float", "right.edges": four("recenter") };
    const rows = inspectRows(settings, DEFAULTS);
    expect(row(rows, "right", "anchor")).toEqual({ group: "right", key: "anchor", value: "float", changed: true });
    expect(row(rows, "right", "edges")?.value).toBe("recenter");
    expect(rows.some((r) => r.group === "left")).toBe(false);
  });

  it("formats booleans and numbers", () => {
    const rows = inspectRows({ ...DEFAULTS, tap: false, size: 1.5 }, DEFAULTS);
    expect(row(rows, "shared", "tap")).toMatchObject({ value: "false", changed: true });
    expect(row(rows, "shared", "size")).toMatchObject({ value: "1.5", changed: true });
  });

  it("marks a key without a default as changed", () => {
    expect(row(inspectRows({ extra: "x" }, {}), "shared", "extra")?.changed).toBe(true);
  });
});

const STATUS: Status = {
  mode: "on",
  available: true,
  reason: "",
  device: "retroid-pocket-nova",
  toggle_key: "Insert",
  toggle_chord: "l1+l3+r1+r3",
  version: "0.4.1",
  instance: "4eea7756e9346454",
  inputplumber_version: "0.62.2",
};

describe("statusRows", () => {
  it("lists the mode, device, version, InputPlumber version and instance", () => {
    expect(statusRows(STATUS)).toEqual([
      { key: "mode", value: "on" },
      { key: "device", value: "retroid-pocket-nova" },
      { key: "version", value: "0.4.1" },
      { key: "inputplumber_version", value: "0.62.2" },
      { key: "instance", value: "4eea7756e9346454" },
    ]);
  });

  it("shows an InputPlumber version the daemon can't read as unknown", () => {
    const rows = statusRows({ ...STATUS, inputplumber_version: null });
    expect(rows.find((row) => row.key === "inputplumber_version")?.value).toBe("unknown");
  });
});

describe("wireKey", () => {
  it("puts the side back on an override", () => {
    expect(wireKey({ group: "right", key: "tap_output", value: "r5", changed: true })).toBe("right.tap_output");
  });

  it("leaves a shared key as it is", () => {
    expect(wireKey({ group: "shared", key: "size", value: "1", changed: false })).toBe("size");
  });
});

describe("inspectText", () => {
  it("lists the status, then every row, as key = value lines with full wire keys", () => {
    const settings = { ...DEFAULTS, "right.edges": four("release") };
    expect(inspectText(STATUS, inspectRows(settings, DEFAULTS))).toBe(
      [
        "mode = on",
        "device = retroid-pocket-nova",
        "version = 0.4.1",
        "inputplumber_version = 0.62.2",
        "instance = 4eea7756e9346454",
        "pads = both",
        "size = 1",
        "panel_mm = 91x68",
        "edges = clamp",
        "tap = true",
        "right.edges = release",
      ].join("\n"),
    );
  });
});

describe("INSPECT_GROUPS", () => {
  it("names the groups for the user", () => {
    expect(INSPECT_GROUPS).toEqual({ shared: "General", right: "Right pad only", left: "Left pad only" });
  });
});

describe("overridesNote", () => {
  it("says the pad uses the general settings when it has none of its own", () => {
    expect(overridesNote(0)).toBe("Uses the general settings");
  });

  it("says everything else comes from the general settings after the pad's own", () => {
    expect(overridesNote(2)).toBe("Everything else as in General");
  });
});
