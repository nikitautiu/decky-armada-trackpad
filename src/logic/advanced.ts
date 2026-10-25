import { edgeMode, effective, padChoice, type Side } from "./presets";
import type { Settings } from "./wire";

/** One entry of a dropdown: the value written and what the user reads. */
export type Choice = { readonly value: string; readonly label: string };

/** A dropdown entry with a short line under its name in the open list, saying what it does. */
export type DescribedChoice = Choice & { readonly description: string };

/** The pad window's anchors. */
export const ANCHOR_CHOICES: readonly DescribedChoice[] = [
  { value: "fixed", label: "Elastic", description: "Shifts to reach a touch outside it, then springs back" },
  { value: "float", label: "Centered", description: "Centers on your finger" },
];

/** The edge modes; one sets all four edges of a pad. */
export const EDGE_CHOICES: readonly DescribedChoice[] = [
  { value: "clamp", label: "Clamp", description: "Stops at the rim" },
  { value: "follow", label: "Follow", description: "Moves with your finger" },
  { value: "release", label: "Release", description: "Lifts past the edge" },
  { value: "recenter", label: "Recenter", description: "Recenters under your finger" },
];

const MIXED_EDGES: DescribedChoice = { value: "mixed", label: "Mixed", description: "Edges differ" };

/** What a tap can press: the pad's own click, or a Deck button or trigger. */
export const TAP_OUTPUT_CHOICES: readonly Choice[] = [
  { value: "pad", label: "Pad click" },
  ...["a", "b", "x", "y", "l1", "r1", "l3", "r3", "l4", "l5", "r4", "r5"].map((value) => ({
    value,
    label: value.toUpperCase(),
  })),
  { value: "l2_soft", label: "L2 soft" },
  { value: "l2_full", label: "L2 full" },
  { value: "r2_soft", label: "R2 soft" },
  { value: "r2_full", label: "R2 full" },
  { value: "view", label: "View" },
  { value: "menu", label: "Menu" },
  { value: "steam", label: "Steam" },
  { value: "qam", label: "QAM" },
];

/**
 * The keys the toggle key can be set to, as X keysyms.
 *
 * A short list instead of a key capture: Steam Input sends its bound keys to the game, never to Steam's own UI,
 * so a capture there could not see them.
 */
export const TOGGLE_KEY_CHOICES: readonly Choice[] = [
  { value: "Insert", label: "Insert" },
  { value: "Home", label: "Home" },
  { value: "End", label: "End" },
  { value: "Prior", label: "Page Up" },
  { value: "Next", label: "Page Down" },
  { value: "Delete", label: "Delete" },
  { value: "Pause", label: "Pause" },
  { value: "none", label: "None" },
];

/**
 * `choices`, plus `current` at the end when its value is not one of them, so a dropdown can show a value it
 * doesn't offer (such as a key set with the CLI). Pass the result's picks through {@link listedValue}.
 */
export function choicesWith<C extends Choice>(choices: readonly C[], current: C): readonly C[] {
  return choices.some((choice) => choice.value === current.value) ? choices : [...choices, current];
}

/** The Start dropdown's entries, plus the pad's anchor when it is not one of them. */
export function anchorChoices(anchor: string): readonly DescribedChoice[] {
  return choicesWith(ANCHOR_CHOICES, { value: anchor, label: anchor, description: "" });
}

/** The Edges dropdown's entries, plus Mixed or the pad's edge mode when it is not one of them. */
export function edgeChoices(edges: string): readonly DescribedChoice[] {
  return choicesWith(
    EDGE_CHOICES,
    edges === MIXED_EDGES.value ? MIXED_EDGES : { value: edges, label: edges, description: "" },
  );
}

/** The Toggle key dropdown's entries, plus the current key when it is not one of them (such as one set with the CLI). */
export function toggleKeyChoices(key: string): readonly Choice[] {
  return choicesWith(TOGGLE_KEY_CHOICES, { value: key, label: key });
}

/** What a closed dropdown shows for `value`: its entry's label, else the value itself. */
export function choiceLabel(choices: readonly Choice[], value: string): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

/** The picked value when it is one of `choices`, else `null` (an entry shown only for display). */
export function listedValue(choices: readonly Choice[], value: unknown): string | null {
  return choices.find((choice) => choice.value === value)?.value ?? null;
}

/** What the Advanced view shows for one pad. */
export type PadModel = {
  /** The matching preset ("Preset: Pad"), or "Custom". */
  readonly chip: string;
  readonly anchor: string;
  /** One edge mode, or `"mixed"`. */
  readonly edges: string;
  readonly tap: boolean;
  /** Tap-and-drag as shown: off while tap is off, since it needs a tap. */
  readonly drag: boolean;
  readonly tapOutput: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The values a pad uses, its overrides over the shared settings. */
export function padModel(settings: Settings, side: Side): PadModel {
  const choice = padChoice(settings, side);
  const tap = effective(settings, side, "tap") === true;
  return {
    chip: choice === "custom" ? "Custom" : `Preset: ${choice.charAt(0).toUpperCase()}${choice.slice(1)}`,
    anchor: text(effective(settings, side, "anchor")),
    edges: edgeMode(settings, side),
    tap,
    drag: tap && effective(settings, side, "tap_drag") === true,
    tapOutput: text(effective(settings, side, "tap_output")),
  };
}

/** One of a pad's Tap buttons: the pad key it flips (`tap` writes `<side>.tap`) and how it shows. */
export type TapToggle = {
  readonly key: "tap" | "tap_drag";
  readonly label: string;
  readonly pressed: boolean;
  readonly disabled: boolean;
};

/** A pad's Click and Drag buttons; Drag is disabled while tap is off, since a drag starts with a tap. */
export function tapToggles(pad: PadModel): readonly TapToggle[] {
  return [
    { key: "tap", label: "Click", pressed: pad.tap, disabled: false },
    { key: "tap_drag", label: "Drag", pressed: pad.drag, disabled: !pad.tap },
  ];
}

const CHORD_ORDER = ["l1", "r1", "l2", "r2", "l3", "r3", "l4", "r4", "l5", "r5"];

/** Where a chord button sorts: its place in {@link CHORD_ORDER}, else after all of them. */
function chordRank(button: string): number {
  const index = CHORD_ORDER.indexOf(button);
  return index === -1 ? CHORD_ORDER.length : index;
}

/**
 * A daemon chord such as `l1+l3+r1+r3`, as the buttons read: `L1+R1+L3+R3`. Known buttons come in a fixed
 * order, any others after them in the order the daemon gave.
 */
export function chordLabel(chord: string): string {
  return chord
    .split("+")
    .map((button) => button.trim().toLowerCase())
    .map((button, position) => ({ button, position }))
    .sort((a, b) => chordRank(a.button) - chordRank(b.button) || a.position - b.position)
    .map(({ button }) => button.toUpperCase())
    .join("+");
}

/** A toggle key's X keysym as the Toggle key dropdown names it (`Prior` reads `Page Up`), else the keysym. */
export function toggleKeyLabel(key: string): string {
  return TOGGLE_KEY_CHOICES.find((choice) => choice.value === key)?.label ?? key;
}

/** The controller chord switch's description, from the daemon's `status.toggle_chord`. */
export function chordDescription(chord: string): string {
  return chord === "none" ? "Off" : chordLabel(chord);
}

/** The toggle settings of the profile being edited. */
export type ToggleModel = {
  /** The toggle key's X keysym, `none`, or empty when the daemon reports none. */
  readonly key: string;
  readonly chord: boolean;
};

/** The toggle settings the Toggle group shows. */
export function toggleModel(settings: Settings): ToggleModel {
  return { key: text(settings.toggle_key), chord: settings.toggle_chord === true };
}
