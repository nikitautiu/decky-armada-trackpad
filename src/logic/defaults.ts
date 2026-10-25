import { PRESETS, type Preset, type Side } from "./presets";
import type { Settings, SettingValue } from "./wire";

/** Every edge of a pad in one mode, as the daemon reports a pad's edges back. */
function allEdges(mode: string): readonly string[] {
  return [mode, mode, mode, mode];
}

function presetSettings(side: Side, preset: Preset): Settings {
  const { anchor, edges } = PRESETS[preset];
  return { [`${side}.anchor`]: anchor, [`${side}.edges`]: allEdges(edges) };
}

/**
 * The plugin's own defaults, over the daemon's: the left pad is a Pad, the right a Swipe with tap-and-drag, each 20%
 * in from the screen's edge (Horizontal position), and a tap waits only 120 ms for a drag. Taps press the pad click,
 * the daemon's tap output. The presets are the plugin's, written as anchor and edges.
 */
export const PLUGIN_DEFAULTS: Settings = {
  pads: "both",
  side: 0.2,
  tap_drag_ms: 120,
  ...presetSettings("left", "pad"),
  ...presetSettings("right", "swipe"),
  "right.tap": true,
  "right.tap_drag": true,
};

// Never written by the plugin: the daemon owns the first two, and the panel offers no way to set keeping a floating
// window on the screen, so a reset leaves it as it is.
const UNMANAGED: ReadonlySet<string> = new Set([
  "panel_mm",
  "log_level",
  "float_keep_inside",
  "left.float_keep_inside",
  "right.float_keep_inside",
]);

// Only own keys count, so a key such as `toString` never reads the object's prototype.
function ownValue(settings: Settings, key: string): SettingValue | undefined {
  return Object.keys(settings).includes(key) ? settings[key] : undefined;
}

/** The default of `key`: the plugin's when it sets one, else the daemon's from `daemonDefaults`, else null. */
export function defaultValue(daemonDefaults: Settings, key: string): SettingValue {
  return ownValue(PLUGIN_DEFAULTS, key) ?? ownValue(daemonDefaults, key) ?? null;
}

function sameValue(a: SettingValue | undefined, b: SettingValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The changes that bring each of `keys` to `target(key)`, skipping unmanaged keys and those already there. */
function changesTo(settings: Settings, keys: readonly string[], target: (key: string) => SettingValue): Settings {
  const changes: Record<string, SettingValue> = {};
  for (const key of keys) {
    if (UNMANAGED.has(key)) continue;
    const value = target(key);
    if (!sameValue(settings[key], value)) changes[key] = value;
  }
  return changes;
}

/**
 * The one write that resets a pad: its plugin defaults (preset and tap output) set, its other overrides cleared so
 * it takes the shared settings. Only keys whose value changes are included.
 */
export function resetPadChanges(settings: Settings, side: Side): Settings {
  const keys = Object.keys(settings).filter((key) => key.startsWith(`${side}.`));
  return changesTo(settings, keys, (key) => ownValue(PLUGIN_DEFAULTS, key) ?? null);
}

/**
 * The one write that brings every setting the daemon reports to its default ({@link defaultValue}). Only keys whose
 * value changes are included.
 */
export function resetAllChanges(settings: Settings, daemonDefaults: Settings): Settings {
  return changesTo(settings, Object.keys(settings), (key) => defaultValue(daemonDefaults, key));
}
