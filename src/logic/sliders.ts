import { centerYOf, heightOf, sizeAt, sizePosition } from "./placement";
import type { Panel } from "./preview/geometry";
import type { Settings } from "./wire";

/** A label under one of a slider's notches; the shape Steam's `SliderField` takes. */
export type NotchLabel = { readonly notchIndex: number; readonly label: string; readonly value: number };

/** A numeric setting by key, defaults filled in. */
export type Lookup = (key: string) => number;

/**
 * One slider, laid out like Steam's Frame Limit. The slider moves through positions from `min` to `max`, which
 * `read` and `write` convert from and to the settings.
 */
export type SliderSpec = {
  /** The setting it shows. */
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Notches spread evenly from `min` to `max`; only the two at the ends are labelled. */
  readonly notchCount: number;
  readonly minLabel: string;
  readonly maxLabel: string;
  /** The position as shown at the right of the label. */
  readonly describe: (position: number) => string;
  /** The slider's position for the settings. */
  readonly read: (setting: Lookup) => number;
  /** The setting changes that move the slider to `position`. */
  readonly write: (position: number, setting: Lookup) => Settings;
};

/** A slider whose position is the setting `key` itself. */
function direct(key: string): Pick<SliderSpec, "key" | "read" | "write"> {
  return { key, read: (setting) => setting(key), write: (position) => ({ [key]: position }) };
}

const STEP = 0.05;

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The Drag window slider's value: the milliseconds, as the daemon reports them even outside the slider's range. */
export function dragWindowLabel(milliseconds: number): string {
  return `${milliseconds} ms`;
}

/** The Size slider's value: the multiple of the Deck's pad size. */
export function sizeLabel(size: number): string {
  return `${size.toFixed(2)}×`;
}

/** The Vertical position slider's value: a place name at the top, middle and bottom, else how far down it sits. */
export function heightLabel(height: number): string {
  if (height === 0) return "Top";
  if (height === 0.5) return "Middle";
  if (height === 1) return "Bottom";
  return percent(height);
}

/** The Horizontal position slider's value: a place name at either end, else how far in it sits. */
export function sideLabel(side: number): string {
  if (side === 0) return "Edge";
  if (side === 1) return "Center";
  return percent(side);
}

/**
 * The Size and position sliders on `panel`, in panel order. Size runs from 0.3× through the Deck's pad on the middle
 * notch, shown as "Steam Deck", to the largest pad that fits. Vertical and Horizontal position are percentages
 * of the room the pad has to move in, so each end is flush with the screen's edge or centre line at any size;
 * Horizontal's is the daemon's own `side`.
 */
export function sizeAndPosition(panel: Panel): readonly SliderSpec[] {
  const height = (setting: Lookup): number => heightOf(setting("center_y"), setting("size"), panel);
  return [
    {
      key: "size",
      label: "Size",
      min: 0,
      max: 2,
      // 14 steps a half: 0.05× each up to the Deck's pad.
      step: 1 / 14,
      notchCount: 3,
      minLabel: "0.3×",
      maxLabel: "Max",
      describe: (position) => {
        if (position >= 2) return "Max";
        const size = sizeAt(position, panel);
        return size === 1 ? "Steam Deck" : sizeLabel(size);
      },
      read: (setting) => sizePosition(setting("size"), panel),
      // The pad keeps its vertical position: a new size moves its centre.
      write: (position, setting) => {
        const size = sizeAt(position, panel);
        return { size, center_y: centerYOf(height(setting), size, panel) };
      },
    },
    {
      key: "center_y",
      label: "Vertical position",
      min: 0,
      max: 1,
      step: STEP,
      notchCount: 3,
      minLabel: "Top",
      maxLabel: "Bottom",
      describe: heightLabel,
      read: height,
      write: (position, setting) => ({ center_y: centerYOf(position, setting("size"), panel) }),
    },
    {
      ...direct("side"),
      label: "Horizontal position",
      min: 0,
      max: 1,
      step: STEP,
      notchCount: 3,
      minLabel: "Edge",
      maxLabel: "Center",
      describe: sideLabel,
    },
  ];
}

/**
 * How long a tap waits for a drag to start. The daemon shares it between both pads, so it has no per-pad key.
 * Shown under a pad's Tap row while that pad's Drag is on.
 */
export const DRAG_WINDOW: SliderSpec = {
  ...direct("tap_drag_ms"),
  label: "Drag window",
  min: 80,
  max: 300,
  step: 10,
  notchCount: 2,
  minLabel: "80 ms",
  maxLabel: "300 ms",
  describe: dragWindowLabel,
};

/** The min and max labels under a slider's end notches. */
export function notchLabels(spec: SliderSpec): readonly NotchLabel[] {
  return [
    { notchIndex: 0, label: spec.minLabel, value: spec.min },
    { notchIndex: spec.notchCount - 1, label: spec.maxLabel, value: spec.max },
  ];
}
