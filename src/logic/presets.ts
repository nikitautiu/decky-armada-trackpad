import type { Settings, SettingValue } from "./wire";

/** A pad side. */
export type Side = "left" | "right";

/** A named combination of anchor and edge mode. */
export type Preset = "pad" | "radial" | "swipe" | "stick";

/** What a side's selector shows: a preset, off, or settings that match no preset. */
export type PadChoice = Preset | "off" | "custom";

/** The anchor and edge mode each preset stands for; the daemon knows only the two settings, so the plugin owns this table. */
export const PRESETS: Readonly<Record<Preset, { anchor: "fixed" | "float"; edges: string }>> = {
  pad: { anchor: "fixed", edges: "clamp" },
  radial: { anchor: "float", edges: "clamp" },
  swipe: { anchor: "fixed", edges: "recenter" },
  stick: { anchor: "fixed", edges: "follow" },
};

// Sound: PRESETS is typed Record<Preset, ...>, so its keys are exactly the Preset names.
const PRESET_NAMES = Object.keys(PRESETS) as readonly Preset[];

/** The value a side uses for `key`: its `<side>.<key>` override unless null, else the shared value. */
export function effective(settings: Settings, side: Side, key: string): SettingValue {
  return settings[`${side}.${key}`] ?? settings[key] ?? null;
}

/**
 * The single edge mode of a side, or `"mixed"` when its four edges differ (or are not edge modes).
 */
export function edgeMode(settings: Settings, side: Side): string | "mixed" {
  const edges = effective(settings, side, "edges");
  if (typeof edges === "string") return edges;
  if (Array.isArray(edges) && edges.length > 0 && edges.every((edge) => edge === edges[0])) {
    const first = edges[0];
    if (typeof first === "string") return first;
  }
  return "mixed";
}

function enabledSides(settings: Settings): ReadonlySet<Side> {
  switch (settings.pads) {
    case "both":
      return new Set<Side>(["left", "right"]);
    case "left":
      return new Set<Side>(["left"]);
    case "right":
      return new Set<Side>(["right"]);
    default:
      return new Set<Side>();
  }
}

function padsValue(sides: ReadonlySet<Side>): string {
  if (sides.has("left") && sides.has("right")) return "both";
  if (sides.has("left")) return "left";
  if (sides.has("right")) return "right";
  return "none";
}

/** What a side's selector shows. */
export function padChoice(settings: Settings, side: Side): PadChoice {
  if (!enabledSides(settings).has(side)) return "off";
  const anchor = effective(settings, side, "anchor");
  const edges = edgeMode(settings, side);
  return PRESET_NAMES.find((name) => PRESETS[name].anchor === anchor && PRESETS[name].edges === edges) ?? "custom";
}

/**
 * The settings to write when the user picks `choice` for `side`.
 *
 * A preset also enables the side, since choosing one on a disabled side would otherwise have no effect.
 */
export function padChoiceChanges(settings: Settings, side: Side, choice: Preset | "off"): Record<string, SettingValue> {
  const sides = new Set(enabledSides(settings));
  if (choice === "off") {
    sides.delete(side);
    return { pads: padsValue(sides) };
  }
  sides.add(side);
  const { anchor, edges } = PRESETS[choice];
  return { pads: padsValue(sides), [`${side}.anchor`]: anchor, [`${side}.edges`]: edges };
}
