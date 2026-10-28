import { chordLabel, type DescribedChoice, toggleKeyLabel } from "./advanced";
import { defaultValue } from "./defaults";
import type { PadChoice, Preset, Side } from "./presets";
import type { Snapshot, Status } from "./wire";

/** A snapshot from a connected daemon. */
export type Connected = Extract<Snapshot, { readonly kind: "connected" }>;

/** A snapshot without a daemon. */
export type Offline = Extract<Snapshot, { readonly kind: "offline" }>;

/** A snapshot of a daemon of another protocol, which the backend leaves alone. */
export type Incompatible = Extract<Snapshot, { readonly kind: "incompatible" }>;

/** A snapshot of a daemon on an unsupported device, which the backend leaves alone. */
export type Unsupported = Extract<Snapshot, { readonly kind: "unsupported" }>;

/** The preview's line when the daemon reports no panel size, so the pads can't be drawn. */
export const NO_PANEL_SIZE = "The trackpad daemon reports no screen size, so there is nothing to preview.";

/** A pad's name in labels and headings. */
export const SIDE_NAME: Readonly<Record<Side, string>> = { left: "Left", right: "Right" };

/** One entry of a pad's selector. */
export type PadOption = DescribedChoice & { readonly value: PadChoice };

const PAD_OPTIONS: Readonly<Record<PadChoice, PadOption>> = {
  off: { value: "off", label: "Off", description: "The other pad can start anywhere" },
  pad: { value: "pad", label: "Pad", description: "Fixed spot, stops at the edges" },
  radial: { value: "radial", label: "Radial", description: "Centers where you touch, stops at the edges" },
  swipe: { value: "swipe", label: "Swipe", description: "Fixed spot, recenters under your finger past an edge" },
  stick: { value: "stick", label: "Stick", description: "Fixed spot, follows your finger past an edge" },
  custom: { value: "custom", label: "Custom", description: "Set in Advanced" },
};

const PICKABLE: readonly (Preset | "off")[] = ["off", "pad", "radial", "swipe", "stick"];

const NONE = "none";

/**
 * Whether the panel title shows the red dot: while the daemon is down, incompatible or unsupported, never before the
 * first snapshot.
 */
export function showsOfflineDot(snapshot: Snapshot | null): boolean {
  return snapshot !== null && snapshot.kind !== "connected";
}

/** What the panel shows: the main rows, the Advanced view, or the Inspect view opened from Advanced. */
export type PanelView = "main" | "advanced" | "inspect";

/** Where B (or the back row) leads from `view`. */
export function backFrom(view: PanelView): PanelView {
  return view === "inspect" ? "advanced" : "main";
}

/** The Trackpads switch's description: the toggle key and the controller chord, such as `Insert · L1+R1+L3+R3`. */
export function toggleHint(status: Status): string {
  const ways = [
    status.toggle_key === NONE ? null : toggleKeyLabel(status.toggle_key),
    status.toggle_chord === NONE ? null : chordLabel(status.toggle_chord),
  ].filter((way) => way !== null);
  return ways.length === 0 ? "No toggle key or chord set" : ways.join(" · ");
}

/** The Trackpads switch's description: the toggle hint, or while pad mode is unavailable the daemon's reason as is. */
export function trackpadsDescription(status: Status): string {
  return status.available ? toggleHint(status) : status.reason;
}

/** Check again's description: the daemon's reason when no Trackpads row carries it, as without a game. */
export function recheckDescription(snapshot: Connected): string | null {
  return snapshot.sessionOn === null ? snapshot.status.reason : null;
}

/** Which profile the panel edits, for the line above the per-game switch: the reported game's, or the global one. */
export type ProfileLine =
  | { readonly kind: "global" }
  | {
      readonly kind: "game";
      readonly appid: number;
      /** The game's name, or `app <appid>` when Steam gives none; never empty. */
      readonly name: string;
    };

/** The profile line for `snapshot`. */
export function profileLine(snapshot: Connected): ProfileLine {
  const game = snapshot.game;
  if (game === null || snapshot.profile !== `game:${game.appid}`) return { kind: "global" };
  return { kind: "game", appid: game.appid, name: game.name === "" ? `app ${game.appid}` : game.name };
}

/** The entries of a pad's selector; Custom is listed only while it is the current choice, to show it. */
export function padOptions(current: PadChoice): readonly PadOption[] {
  const choices: readonly PadChoice[] = current === "custom" ? [...PICKABLE, "custom"] : PICKABLE;
  return choices.map((value) => PAD_OPTIONS[value]);
}

/** What a pad's selector shows for `choice`, such as "Swipe". */
export function padChoiceLabel(choice: PadChoice): string {
  return PAD_OPTIONS[choice].label;
}

/** The choice a selector entry stands for, or `null` for one that can't be written (Custom). */
export function pickedChoice(value: unknown): Preset | "off" | null {
  return PICKABLE.find((choice) => choice === value) ?? null;
}

/** A numeric setting for a slider: the daemon's value, else its default ({@link defaultValue}), else 0. */
export function numberSetting(snapshot: Connected, key: string): number {
  const value = snapshot.settings[key];
  if (typeof value === "number") return value;
  const fallback = defaultValue(snapshot.defaults, key);
  return typeof fallback === "number" ? fallback : 0;
}

/** A slider value rounded to its step, without the float noise of the slider's arithmetic. */
export function stepped(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}
