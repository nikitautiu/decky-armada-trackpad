import { PanelSectionRow, SliderField, type SliderFieldProps } from "@decky/ui";
import type { FC, ReactNode } from "react";
import type { Separator } from "../logic/layout";
import { notchLabels, type SliderSpec } from "../logic/sliders";
import { type Connected, numberSetting, stepped } from "../logic/view";
import { useDebouncedEdit } from "./hooks";
import type { Change } from "./types";

const SLIDER_DEBOUNCE_MS = 300;

/** {@link SliderField}'s props, plus Steam's own `renderValue`. Steam UI workaround: @decky/ui doesn't declare it. */
type ValueSliderProps = SliderFieldProps & { readonly renderValue: (value: number) => string };

/**
 * Steam's `SliderField` with `renderValue`: with `showValue` it puts the label at the left and the rendered value
 * at the right of the same line, as Frame Limit does. Steam's slider reads the prop (seen in its source on the
 * Nova); a component that takes fewer props accepts these too, so no cast is needed.
 */
const ValueSlider: FC<ValueSliderProps> = SliderField;

/** Props of {@link SettingSlider}. */
export type SettingSliderProps = {
  readonly spec: SliderSpec;
  readonly snapshot: Connected;
  readonly change: Change;
  /** The line under it: thin between the sliders, none after the last. */
  readonly separator: Separator;
  /** A line under the label, such as which pads the setting affects. */
  readonly description?: string;
};

/** A row with the slider of `spec`, writing its changes through `change` once the user pauses. */
export function SettingSlider({ spec, snapshot, change, separator, description }: SettingSliderProps): ReactNode {
  const setting = (key: string): number => numberSetting(snapshot, key);
  const [value, edit] = useDebouncedEdit(spec.read(setting), SLIDER_DEBOUNCE_MS, (next) =>
    change(spec.write(next, setting)),
  );
  return (
    <PanelSectionRow>
      <ValueSlider
        label={spec.label}
        description={description}
        showValue
        renderValue={spec.describe}
        // Steam UI workaround: not indented, since in the Quick Access menu Steam gives a slider's control a minimum
        // width of 270 px, which fills the panel, so any indent pushes the track and its end labels past the right
        // edge.
        bottomSeparator={separator}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        notchCount={spec.notchCount}
        notchLabels={[...notchLabels(spec)]}
        notchTicksVisible
        onChange={(next) => edit(stepped(next, spec.step))}
      />
    </PanelSectionRow>
  );
}
