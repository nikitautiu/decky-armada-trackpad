import { describe, expect, it } from "vitest";
import {
  ANCHOR_CHOICES,
  anchorChoices,
  choiceLabel,
  choicesWith,
  chordDescription,
  chordLabel,
  EDGE_CHOICES,
  edgeChoices,
  listedValue,
  padModel,
  TAP_OUTPUT_CHOICES,
  TOGGLE_KEY_CHOICES,
  tapToggles,
  toggleKeyChoices,
  toggleKeyLabel,
  toggleModel,
} from "./advanced";
import type { Settings } from "./wire";

const four = (mode: string): string[] => [mode, mode, mode, mode];

/** The daemon's defaults for the keys the Advanced view reads, both pads on, no overrides set. */
const SETTINGS: Settings = {
  pads: "both",
  panel_mm: [91, 68],
  anchor: "fixed",
  edges: four("clamp"),
  tap: true,
  tap_drag: false,
  tap_output: "pad",
  toggle_key: "Insert",
  toggle_chord: true,
  "right.anchor": null,
  "right.edges": null,
  "right.tap": null,
  "right.tap_drag": null,
  "right.tap_output": null,
  "left.anchor": null,
  "left.tap_output": null,
};

describe("choicesWith", () => {
  it("lists the choices alone when the current value is one of them", () => {
    expect(choicesWith(TOGGLE_KEY_CHOICES, { value: "Home", label: "Home" })).toBe(TOGGLE_KEY_CHOICES);
  });

  it("adds the current entry at the end when it is not listed", () => {
    expect(choicesWith(TOGGLE_KEY_CHOICES, { value: "F12", label: "F12" })).toEqual([
      ...TOGGLE_KEY_CHOICES,
      { value: "F12", label: "F12" },
    ]);
  });
});

describe("anchorChoices", () => {
  it("lists the two anchors alone when the pad uses one of them", () => {
    expect(anchorChoices("float")).toBe(ANCHOR_CHOICES);
  });

  it("adds an unlisted anchor, named by itself without a description", () => {
    expect(anchorChoices("sticky").slice(-1)).toEqual([{ value: "sticky", label: "sticky", description: "" }]);
  });
});

describe("edgeChoices", () => {
  it("lists the four edge modes alone when the pad uses one of them", () => {
    expect(edgeChoices("release")).toBe(EDGE_CHOICES);
  });

  it("adds Mixed when the four edges differ", () => {
    expect(edgeChoices("mixed").slice(-1)).toEqual([{ value: "mixed", label: "Mixed", description: "Edges differ" }]);
  });

  it("adds an unlisted edge mode, named by itself without a description", () => {
    expect(edgeChoices("wrap").slice(-1)).toEqual([{ value: "wrap", label: "wrap", description: "" }]);
  });
});

describe("choiceLabel", () => {
  it("names a listed value by its label", () => {
    expect(choiceLabel(EDGE_CHOICES, "recenter")).toBe("Recenter");
  });

  it("names an unlisted value by itself", () => {
    expect(choiceLabel(EDGE_CHOICES, "wrap")).toBe("wrap");
  });
});

describe("listedValue", () => {
  it("returns a listed value", () => {
    expect(listedValue(TAP_OUTPUT_CHOICES, "r5")).toBe("r5");
  });

  it.each<[string, unknown]>([
    ["an unlisted value shown only for display", "F12"],
    ["a non-string", 3],
  ])("returns null for %s", (_case, value) => {
    expect(listedValue(TOGGLE_KEY_CHOICES, value)).toBeNull();
  });
});

describe("choice lists", () => {
  it("offers exactly the listed toggle keys, with readable labels", () => {
    expect(TOGGLE_KEY_CHOICES).toEqual([
      { value: "Insert", label: "Insert" },
      { value: "Home", label: "Home" },
      { value: "End", label: "End" },
      { value: "Prior", label: "Page Up" },
      { value: "Next", label: "Page Down" },
      { value: "Delete", label: "Delete" },
      { value: "Pause", label: "Pause" },
      { value: "none", label: "None" },
    ]);
  });

  it("offers every tap output, the pad's own click first", () => {
    expect(TAP_OUTPUT_CHOICES.map((choice) => choice.value)).toEqual([
      ...["pad", "a", "b", "x", "y", "l1", "r1", "l3", "r3", "l4", "l5", "r4", "r5"],
      ...["l2_soft", "l2_full", "r2_soft", "r2_full", "view", "menu", "steam", "qam"],
    ]);
    expect(TAP_OUTPUT_CHOICES[0]).toEqual({ value: "pad", label: "Pad click" });
    expect(TAP_OUTPUT_CHOICES.find((choice) => choice.value === "l2_soft")?.label).toBe("L2 soft");
  });

  it("offers the two anchors, each with what it does", () => {
    expect(ANCHOR_CHOICES).toEqual([
      { value: "fixed", label: "Elastic", description: "Shifts to reach a touch outside it, then springs back" },
      { value: "float", label: "Centered", description: "Centers on your finger" },
    ]);
  });

  it("offers the four edge modes, each with what it does", () => {
    expect(EDGE_CHOICES).toEqual([
      { value: "clamp", label: "Clamp", description: "Stops at the rim" },
      { value: "follow", label: "Follow", description: "Moves with your finger" },
      { value: "release", label: "Release", description: "Lifts past the edge" },
      { value: "recenter", label: "Recenter", description: "Recenters under your finger" },
    ]);
  });
});

describe("padModel", () => {
  it("shows the shared values and the matching preset when the pad has no overrides", () => {
    expect(padModel(SETTINGS, "right")).toEqual({
      chip: "Preset: Pad",
      anchor: "fixed",
      edges: "clamp",
      tap: true,
      drag: false,
      tapOutput: "pad",
    });
  });

  it("shows the pad's own overrides", () => {
    const settings = {
      ...SETTINGS,
      "right.anchor": "float",
      "right.edges": four("clamp"),
      "right.tap_output": "r5",
    };
    expect(padModel(settings, "right")).toMatchObject({
      chip: "Preset: Radial",
      anchor: "float",
      edges: "clamp",
      tapOutput: "r5",
    });
  });

  it("shows Custom when no preset matches", () => {
    expect(padModel({ ...SETTINGS, "right.edges": four("release") }, "right").chip).toBe("Custom");
  });

  it("shows mixed edges when the four differ", () => {
    const settings = { ...SETTINGS, "right.edges": ["clamp", "release", "clamp", "clamp"] };
    expect(padModel(settings, "right").edges).toBe("mixed");
  });

  it("shows drag off while tap is off, whatever tap_drag says", () => {
    const settings = { ...SETTINGS, "right.tap": false, "right.tap_drag": true };
    expect(padModel(settings, "right")).toMatchObject({ tap: false, drag: false });
  });

  it("shows drag on while tap is on and tap_drag is set", () => {
    expect(padModel({ ...SETTINGS, tap_drag: true }, "right").drag).toBe(true);
  });
});

describe("tapToggles", () => {
  const pad = (tap: boolean, drag: boolean) => padModel({ ...SETTINGS, tap, tap_drag: drag }, "right");

  it("offers Click and Drag, writing the pad's tap and tap_drag", () => {
    expect(tapToggles(pad(true, false)).map((toggle) => [toggle.label, toggle.key])).toEqual([
      ["Click", "tap"],
      ["Drag", "tap_drag"],
    ]);
  });

  it.each<[boolean, boolean, boolean[]]>([
    [true, false, [true, false]],
    [true, true, [true, true]],
    [false, true, [false, false]],
  ])("presses them for tap %s and tap_drag %s", (tap, drag, pressed) => {
    expect(tapToggles(pad(tap, drag)).map((toggle) => toggle.pressed)).toEqual(pressed);
  });

  it("enables both while tap is on", () => {
    expect(tapToggles(pad(true, false)).map((toggle) => toggle.disabled)).toEqual([false, false]);
  });

  it("disables Drag while tap is off, since a drag starts with a tap", () => {
    expect(tapToggles(pad(false, false)).map((toggle) => toggle.disabled)).toEqual([false, true]);
  });
});

describe("toggleKeyLabel", () => {
  it.each<[string, string]>([
    ["Insert", "Insert"],
    ["Prior", "Page Up"],
    ["F12", "F12"],
  ])("names the keysym %s as %s", (key, label) => {
    expect(toggleKeyLabel(key)).toBe(label);
  });
});

describe("chordLabel", () => {
  it("reads the daemon's chord as the buttons are labelled", () => {
    expect(chordLabel("l1 + r3")).toBe("L1+R3");
  });

  it("puts the shoulders first, in the buttons' fixed order", () => {
    expect(chordLabel("l1+l3+r1+r3")).toBe("L1+R1+L3+R3");
    expect(chordLabel("r5+l2+l4+r2")).toBe("L2+R2+L4+R5");
  });

  it("keeps buttons it does not know after the known ones, in their original order", () => {
    expect(chordLabel("steam+r1+qam+l1")).toBe("L1+R1+STEAM+QAM");
  });
});

describe("chordDescription", () => {
  it("shows the device's chord while it is on", () => {
    expect(chordDescription("l1+l3+r1+r3")).toBe("L1+R1+L3+R3");
  });

  it("says the chord is off when the daemon reports none", () => {
    expect(chordDescription("none")).toBe("Off");
  });
});

describe("toggleModel", () => {
  it("reads the profile's toggle key and chord switch", () => {
    expect(toggleModel({ ...SETTINGS, toggle_key: "Home", toggle_chord: false })).toEqual({
      key: "Home",
      chord: false,
    });
  });

  it("shows no key and the chord off when the daemon reports neither", () => {
    expect(toggleModel({ pads: "both" })).toEqual({ key: "", chord: false });
  });
});

describe("toggleKeyChoices", () => {
  it("offers the listed keys alone when the current key is one of them", () => {
    expect(toggleKeyChoices("Home")).toBe(TOGGLE_KEY_CHOICES);
  });

  it("adds a key set outside the list as a last entry", () => {
    expect(toggleKeyChoices("F12")).toEqual([...TOGGLE_KEY_CHOICES, { value: "F12", label: "F12" }]);
  });
});
