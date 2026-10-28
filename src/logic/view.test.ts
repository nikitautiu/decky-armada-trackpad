import { describe, expect, it } from "vitest";
import {
  backFrom,
  type Connected,
  numberSetting,
  type PanelView,
  padChoiceLabel,
  padOptions,
  pickedChoice,
  profileLine,
  recheckDescription,
  showsOfflineDot,
  stepped,
  toggleHint,
  trackpadsDescription,
} from "./view";
import type { Settings, Status } from "./wire";

const four = (mode: string): string[] => [mode, mode, mode, mode];

const STATUS: Status = {
  mode: "off",
  available: true,
  reason: "",
  device: "retroid-pocket-nova",
  toggle_key: "Insert",
  toggle_chord: "l1+l3+r1+r3",
  version: "1.0",
  instance: "abc",
  inputplumber_version: "0.62.2",
};

const SETTINGS: Settings = {
  pads: "both",
  size: 1,
  anchor: "fixed",
  edges: four("clamp"),
  tap: true,
  tap_output: "pad",
  "right.anchor": null,
  "right.edges": null,
  "right.tap": null,
  "right.tap_output": null,
  "left.anchor": null,
  "left.edges": null,
  "left.tap": null,
  "left.tap_output": null,
};

const connected = (extra: Partial<Connected> = {}): Connected => ({
  kind: "connected",
  status: STATUS,
  settings: SETTINGS,
  defaults: SETTINGS,
  profile: "global",
  game: null,
  gameProfile: false,
  inGame: false,
  defaultOn: false,
  sessionOn: null,
  error: null,
  storeWarning: null,
  ...extra,
});

const BALATRO = { appid: 2379780, name: "Balatro" };

describe("showsOfflineDot", () => {
  it("shows the dot without a daemon", () => {
    expect(showsOfflineDot({ kind: "offline", profile: "global", game: null, error: null })).toBe(true);
  });

  it("shows the dot for a daemon the plugin can't work with", () => {
    expect(showsOfflineDot({ kind: "incompatible", update: "daemon", daemonVersion: "0.1.0" })).toBe(true);
  });

  it("shows the dot on an unsupported device", () => {
    expect(showsOfflineDot({ kind: "unsupported", daemonVersion: "0.2.0", reason: "device not supported: X" })).toBe(
      true,
    );
  });

  it.each<[string, Connected | null]>([
    ["connected", connected()],
    ["before the first snapshot", null],
  ])("shows no dot when %s", (_case, snapshot) => {
    expect(showsOfflineDot(snapshot)).toBe(false);
  });
});

describe("backFrom", () => {
  it.each<[PanelView, PanelView]>([
    ["inspect", "advanced"],
    ["advanced", "main"],
    ["main", "main"],
  ])("goes back from %s to %s", (view, expected) => {
    expect(backFrom(view)).toBe(expected);
  });
});

describe("toggleHint", () => {
  it.each<[string, string, string]>([
    ["Insert", "l1+l3+r1+r3", "Insert · L1+R1+L3+R3"],
    ["none", "l1+l3+r1+r3", "L1+R1+L3+R3"],
    ["Home", "none", "Home"],
    ["Prior", "l1+r1", "Page Up · L1+R1"],
    ["F12", "none", "F12"],
    ["none", "none", "No toggle key or chord set"],
  ])("shows key %s and chord %s as %s", (toggle_key, toggle_chord, expected) => {
    expect(toggleHint({ ...STATUS, toggle_key, toggle_chord })).toBe(expected);
  });
});

describe("profileLine", () => {
  it("names the global profile when it is in use", () => {
    expect(profileLine(connected({ game: BALATRO }))).toEqual({ kind: "global" });
  });

  it("names the game when its profile is in use", () => {
    expect(profileLine(connected({ game: BALATRO, profile: "game:2379780", gameProfile: true }))).toEqual({
      kind: "game",
      appid: 2379780,
      name: "Balatro",
    });
  });

  it("falls back to the app id when the game has no name", () => {
    const game = { appid: 2379780, name: "" };
    expect(profileLine(connected({ game, profile: "game:2379780", gameProfile: true }))).toEqual({
      kind: "game",
      appid: 2379780,
      name: "app 2379780",
    });
  });

  it("names the global profile while no game runs", () => {
    expect(profileLine(connected())).toEqual({ kind: "global" });
  });
});

describe("padOptions", () => {
  it("lists off and the four presets, each with what it does", () => {
    expect(padOptions("pad")).toEqual([
      { value: "off", label: "Off", description: "The other pad can start anywhere" },
      { value: "pad", label: "Pad", description: "Fixed spot, stops at the edges" },
      { value: "radial", label: "Radial", description: "Centers where you touch, stops at the edges" },
      { value: "swipe", label: "Swipe", description: "Fixed spot, recenters under your finger past an edge" },
      { value: "stick", label: "Stick", description: "Fixed spot, follows your finger past an edge" },
    ]);
  });

  it("adds Custom last when the settings match no preset", () => {
    expect(padOptions("custom").slice(-1)).toEqual([
      { value: "custom", label: "Custom", description: "Set in Advanced" },
    ]);
  });

  it("leaves Custom out while a preset or off is chosen", () => {
    expect(padOptions("off").map((option) => option.value)).not.toContain("custom");
  });
});

describe("padChoiceLabel", () => {
  it.each([
    ["swipe", "Swipe"],
    ["custom", "Custom"],
    ["off", "Off"],
  ] as const)("names %s as its selector entry does", (choice, label) => {
    expect(padChoiceLabel(choice)).toBe(label);
  });
});

describe("pickedChoice", () => {
  it.each<[unknown, string | null]>([
    ["off", "off"],
    ["swipe", "swipe"],
    ["custom", null],
    ["other", null],
    [3, null],
  ])("turns %s into %s", (value, expected) => {
    expect(pickedChoice(value)).toBe(expected);
  });
});

describe("numberSetting", () => {
  it("reads the daemon's value", () => {
    expect(numberSetting(connected({ settings: { ...SETTINGS, size: 1.5 } }), "size")).toBe(1.5);
  });

  it("falls back to the default when the value is not a number", () => {
    expect(numberSetting(connected({ settings: { ...SETTINGS, size: null } }), "size")).toBe(1);
  });

  it("falls back to the plugin default over the daemon's", () => {
    expect(numberSetting(connected({ defaults: { ...SETTINGS, side: 0 } }), "side")).toBe(0.2);
  });

  it("falls back to 0 when neither is a number", () => {
    expect(numberSetting(connected(), "center_y")).toBe(0);
  });
});

describe("stepped", () => {
  it.each<[number, number, number]>([
    [0.30000000000000004, 0.05, 0.3],
    [0.7499999, 0.05, 0.75],
    [1.02, 0.05, 1],
    [0, 0.05, 0],
  ])("rounds %s to the step %s as %s", (value, step, expected) => {
    expect(stepped(value, step)).toBe(expected);
  });
});

describe("where pad mode is unavailable", () => {
  const UNSUPPORTED: Status = { ...STATUS, available: false, reason: "composite 'Armada Trackpad Left' not found" };

  it("shows the daemon's reason as it is under Trackpads", () => {
    expect(trackpadsDescription(UNSUPPORTED)).toBe("composite 'Armada Trackpad Left' not found");
  });

  it("shows the toggle hint under Trackpads while pad mode is available", () => {
    expect(trackpadsDescription(STATUS)).toBe(toggleHint(STATUS));
  });

  it("shows the daemon's reason as it is under Check again without a running game", () => {
    expect(recheckDescription(connected({ status: UNSUPPORTED }))).toBe("composite 'Armada Trackpad Left' not found");
  });

  it("leaves Check again without a description while Trackpads carries the reason", () => {
    expect(recheckDescription(connected({ status: UNSUPPORTED, game: BALATRO, sessionOn: false }))).toBeNull();
  });
});
