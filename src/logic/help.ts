import { ANCHOR_CHOICES, choiceLabel, type DescribedChoice, EDGE_CHOICES } from "./advanced";
import { PRESETS } from "./presets";
import { type PadOption, padOptions } from "./view";

/** One named choice and what it does. */
export type HelpEntry = { readonly label: string; readonly description: string };

/** One concept of the pads help: a summary line, then its choices. */
export type HelpTopic = { readonly title: string; readonly summary: string; readonly entries: readonly HelpEntry[] };

function entries(choices: readonly DescribedChoice[]): readonly HelpEntry[] {
  return choices.map(({ label, description }) => ({ label, description }));
}

/** A preset's line, its name followed by the anchor and edges it sets, such as `Pad (Elastic, Clamp)`. */
function presetEntry({ value, label, description }: PadOption): HelpEntry {
  if (value === "off" || value === "custom") return { label, description };
  const { anchor, edges } = PRESETS[value];
  return {
    label: `${label} (${choiceLabel(ANCHOR_CHOICES, anchor)}, ${choiceLabel(EDGE_CHOICES, edges)})`,
    description,
  };
}

const CHOICES = padOptions("off");

/**
 * What the (i) on the Pads heading explains, built from the dropdowns' entries and the presets table so the two
 * never drift apart. Off comes after the presets, since it is the absence of one.
 */
export const PAD_HELP: readonly HelpTopic[] = [
  {
    title: "Presets",
    summary: "A preset sets the pad's start and edges in one pick.",
    entries: [
      ...CHOICES.filter((choice) => choice.value !== "off"),
      ...CHOICES.filter((choice) => choice.value === "off"),
    ].map(presetEntry),
  },
  {
    title: "Start",
    summary: "Where the pad sits when you touch the screen.",
    entries: entries(ANCHOR_CHOICES),
  },
  {
    title: "Edges",
    summary: "What the pad does when your finger reaches its edge.",
    entries: entries(EDGE_CHOICES),
  },
];
