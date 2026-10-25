import type { CSSProperties } from "react";
import type { Side } from "../logic/presets";

// Steam's own `--gp*` colours, with fallbacks for a build that doesn't define them.

/** Secondary text. */
export const MUTED: CSSProperties = { color: "var(--gpSystemLightGrey, #8B929A)" };

/** Text that matters least, such as "everything else inherits". */
export const FAINT: CSSProperties = { color: "var(--gpSystemGrey, #67707B)" };

/** The offline status dot and error messages. */
export const BAD = "var(--gpColor-Red, #D94126)";

/** Warnings that leave the panel usable. */
export const WARN = "var(--gpColor-Yellow, #FFC82C)";

/**
 * A section heading, as Steam's Quick Access section titles look (read from its CSS on the Nova): capitals,
 * semi-bold, letter-spaced. Inline, since @decky/ui's `staticClasses.PanelSectionTitle` is undefined on this
 * Steam build and a class alone would leave the heading in plain text.
 */
export const SECTION_TITLE: CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "22px",
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: "rgba(255, 255, 255, 0.7)",
  paddingBottom: "8px",
};

/** A small explanatory line under a row. */
export const NOTE: CSSProperties = { fontSize: "12px", lineHeight: "17px" };

/** The "Using … profile" line, in the size and grey of the one under Steam's Performance settings. */
export const PROFILE_LINE: CSSProperties = { fontSize: "12px", lineHeight: "16px", color: "#B8BCBF" };

/** A value that differs from the device default. */
export const CHANGED = "var(--gpColor-LightBlue, #B3DFFF)";

/** The small pill beside a group heading, such as "Pad preset". */
export const CHIP: CSSProperties = {
  fontSize: "12px",
  padding: "3px 8px",
  borderRadius: "10px",
  background: "var(--gpBackground-LightSoft, #3b5a7280)",
  color: CHANGED,
};

/** {@link CHIP} for a setting that is off, such as an off pad: neutral grey instead of the accent. */
export const CHIP_NEUTRAL: CSSProperties = {
  ...CHIP,
  background: "var(--gpSystemDarkGrey, #3D4450)",
  color: "var(--gpSystemLightGrey, #8B929A)",
};

/** A section break drawn by hand, for a section with no row to carry it: Steam's thick row separator. */
export const SECTION_LINE: CSSProperties = { height: "1.5px", background: "rgba(255, 255, 255, 0.1)" };

/** Keys, values and command output. */
export const MONO: CSSProperties = { fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, monospace", fontSize: "13px" };

/** The offline notice's red box: the red of `BAD` at 22 %, as plain rgba so an older CEF can't drop it. */
export const ALERT: CSSProperties = {
  padding: "0 12px",
  borderRadius: "6px",
  background: "rgba(217, 65, 38, 0.22)",
};

/**
 * A Click or Drag button inside its share of the row, over Steam's own row-button class: unpressed it keeps
 * Steam's grey, white-on-focus and dimmed-when-disabled look.
 *
 * Pressed, it is filled with Steam's blue, which hides Steam's focus colour; a focused pressed button is
 * brightened and ringed in white instead, so the D-pad position stays visible.
 */
export function tapButtonStyle(pressed: boolean, focused: boolean): CSSProperties {
  const fill: CSSProperties = { width: "100%", minWidth: 0, padding: "10px 8px" };
  if (!pressed) return fill;
  const on: CSSProperties = { ...fill, background: "var(--gpColor-Blue, #1A9FFF)", color: "#ffffff" };
  return focused ? { ...on, filter: "brightness(1.2)", boxShadow: "inset 0 0 0 2px #ffffff" } : on;
}

/** Each pad's colour in the preview: Steam's blue for the right pad, its dusty blue for the left. */
export const PAD_COLOR: Readonly<Record<Side, string>> = {
  right: "var(--gpColor-Blue, #1A9FFF)",
  left: "var(--gpColor-DustyBlue, #417A9B)",
};

/** The preview's screen. */
export const SCREEN_FILL = "var(--gpSystemDarkestGrey, #0E141B)";

/** The outline of the preview's screen. */
export const SCREEN_LINE = "var(--gpSystemDarkGrey, #3D4450)";

/** The finger in the preview, drawn white so it shows over every pad colour. */
export const FINGER = "#ffffff";

/** A fixed pad's home in the preview while its window is away from it. */
export const GHOST_LINE = "var(--gpSystemGrey, #67707B)";

/** The preview's centre line between the halves. */
export const MIDLINE = "var(--gpSystemLightGrey, #8B929A)";
