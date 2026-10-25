import {
  DialogButton,
  DropdownItem,
  Field,
  Focusable,
  gamepadDialogClasses,
  PanelSection,
  PanelSectionRow,
  Toggle,
} from "@decky/ui";
import { type ReactNode, useState } from "react";
import {
  ANCHOR_CHOICES,
  anchorChoices,
  type Choice,
  choicesWith,
  chordDescription,
  EDGE_CHOICES,
  edgeChoices,
  listedValue,
  type PadModel,
  padModel,
  TAP_OUTPUT_CHOICES,
  type TapToggle,
  TOGGLE_KEY_CHOICES,
  tapToggles,
  toggleKeyChoices,
  toggleModel,
} from "../logic/advanced";
import { SECTION_BREAK } from "../logic/layout";
import { padChoice, type Side } from "../logic/presets";
import { DRAG_WINDOW } from "../logic/sliders";
import { type Connected, SIDE_NAME } from "../logic/view";
import { CompactDropdown, DropdownPair, PairCell } from "./CompactDropdown";
import { DropdownFocus } from "./DropdownFocus";
import { Header } from "./Header";
import { usePick } from "./hooks";
import { ChordIcon, TapIcon, TapOutputIcon, ToggleKeyIcon } from "./icons";
import { ResetRow } from "./ResetDialog";
import { SettingSlider } from "./SettingSlider";
import { SubHeader } from "./SubHeader";
import { OpenViewRow, SubView } from "./SubView";
import { MUTED, NOTE, tapButtonStyle } from "./style";
import type { Change } from "./types";

/** Props of {@link AdvancedView}. */
export type AdvancedViewProps = {
  readonly snapshot: Connected;
  /** Writes to the profile this render shows. */
  readonly change: Change;
  /** Opens the read-only settings view. */
  readonly onInspect: () => void;
  /** Returns to the panel. */
  readonly onBack: () => void;
};

type ChoiceRowProps = {
  readonly label: string;
  /** Unique among the panel's dropdowns, such as the setting key it writes; focus returns here after its list. */
  readonly focusId: string;
  /** What the dropdown offers; picks of entries outside it are ignored. */
  readonly choices: readonly Choice[];
  /** What it shows, which may be an entry outside `choices`. */
  readonly shown: readonly Choice[];
  /** The snapshot's value; a pick shows instead until its write settles. */
  readonly selected: string;
  readonly disabled?: boolean;
  /** A line icon before the label, as on Steam's sub-rows. */
  readonly icon?: ReactNode;
  /** Writes a picked entry of `choices` other than the one shown; settles once the reply has been taken in. */
  readonly onPick: (value: string) => Promise<void>;
};

/** Writes `value` when it is one of `choices`; an entry shown only for display writes nothing. */
function writeListed(
  choices: readonly Choice[],
  value: string,
  write: (listed: string) => Promise<void>,
): Promise<void> {
  const listed = listedValue(choices, value);
  return listed === null ? Promise.resolve() : write(listed);
}

function ChoiceRow({
  label,
  focusId,
  choices,
  shown,
  selected,
  disabled = false,
  icon,
  onPick,
}: ChoiceRowProps): ReactNode {
  const [value, pick] = usePick(focusId, selected, (picked) => writeListed(choices, picked, onPick));
  return (
    <PanelSectionRow>
      <DropdownFocus focusId={focusId}>
        {(opened) => (
          <DropdownItem
            label={label}
            icon={icon}
            onMenuOpened={opened}
            rgOptions={shown.map((choice) => ({ data: choice.value, label: choice.label }))}
            selectedOption={value}
            disabled={disabled}
            bottomSeparator="standard"
            onChange={(option) => pick(option.data)}
          />
        )}
      </DropdownFocus>
    </PanelSectionRow>
  );
}

type TapRowProps = {
  readonly pad: PadModel;
  readonly onToggle: (key: string, on: boolean) => Promise<void>;
};

// Steam UI workaround: Steam's own row-button look (as on "Reset right pad") has a 160 px minimum width, too wide for
// two buttons in a row; `NoMinWidth` lifts it.
const TAP_BUTTON_CLASS = `${gamepadDialogClasses.Button} ${gamepadDialogClasses.NoMinWidth}`;

/**
 * "Tap" with its Click and Drag buttons side by side, each pressed while its setting is on, sharing the row's
 * width.
 *
 * Steam UI workaround: the focused button is tracked here because a pressed button's inline blue would hide Steam's
 * focus colour.
 */
function TapRow({ pad, onToggle }: TapRowProps): ReactNode {
  const [focused, setFocused] = useState<TapToggle["key"] | null>(null);
  return (
    <PanelSectionRow>
      <Field label="Tap" icon={<TapIcon />} childrenContainerWidth="max" bottomSeparator="standard">
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", width: "100%" }}>
          {tapToggles(pad).map((toggle) => (
            // Steam UI workaround: Steam's navigation focuses the button itself and React passes the focus up, so a
            // group around each button (as around each dropdown of a pair) is where the button's focus can be seen.
            <Focusable
              key={toggle.key}
              style={{ flex: "1 1 0", minWidth: 0 }}
              onFocus={() => setFocused(toggle.key)}
              onBlur={() => setFocused(null)}
            >
              <DialogButton
                className={TAP_BUTTON_CLASS}
                aria-pressed={toggle.pressed}
                disabled={toggle.disabled}
                style={tapButtonStyle(toggle.pressed, focused === toggle.key)}
                onClick={() => void onToggle(toggle.key, !toggle.pressed)}
              >
                {toggle.label}
              </DialogButton>
            </Focusable>
          ))}
        </Focusable>
      </Field>
    </PanelSectionRow>
  );
}

type PadSettingsProps = {
  readonly side: Side;
  readonly snapshot: Connected;
  readonly change: Change;
};

/** Writes `changes` unless there are none, as after a reset of settings already at their defaults. */
function PadSettings({ side, snapshot, change }: PadSettingsProps): ReactNode {
  const { settings } = snapshot;
  const title = `${SIDE_NAME[side]} pad`;
  if (padChoice(settings, side) === "off") {
    return (
      <PanelSection>
        <SubHeader title={title} chip={{ text: "Off", tone: "neutral" }} endsSection />
      </PanelSection>
    );
  }
  const pad = padModel(settings, side);
  const set = (key: string, value: string | boolean): Promise<void> => change({ [`${side}.${key}`]: value });
  return (
    <PanelSection>
      <SubHeader title={title} chip={{ text: pad.chip, tone: "accent" }} />
      <DropdownPair separator="standard">
        <CompactDropdown
          label="Start"
          focusId={`${side}.anchor`}
          choices={anchorChoices(pad.anchor)}
          selected={pad.anchor}
          onPick={(value) => writeListed(ANCHOR_CHOICES, value, (anchor) => set("anchor", anchor))}
        />
        <CompactDropdown
          label="Edges"
          focusId={`${side}.edges`}
          choices={edgeChoices(pad.edges)}
          selected={pad.edges}
          onPick={(value) => writeListed(EDGE_CHOICES, value, (mode) => set("edges", mode))}
        />
      </DropdownPair>
      <TapRow pad={pad} onToggle={set} />
      {pad.drag && (
        <SettingSlider
          spec={DRAG_WINDOW}
          snapshot={snapshot}
          change={change}
          separator="standard"
          description="Both pads"
        />
      )}
      <ChoiceRow
        label="Tap sends"
        icon={<TapOutputIcon />}
        focusId={`${side}.tap_output`}
        choices={TAP_OUTPUT_CHOICES}
        shown={choicesWith(TAP_OUTPUT_CHOICES, { value: pad.tapOutput, label: pad.tapOutput })}
        selected={pad.tapOutput}
        disabled={!pad.tap}
        onPick={(output) => set("tap_output", output)}
      />
      <ResetRow target={side} snapshot={snapshot} change={change} bottomSeparator={SECTION_BREAK}>
        Reset {side} pad
      </ResetRow>
    </PanelSection>
  );
}

function ToggleSettings({ snapshot, change }: { readonly snapshot: Connected; readonly change: Change }): ReactNode {
  const toggle = toggleModel(snapshot.settings);
  return (
    <PanelSection>
      <SubHeader title="Toggle" />
      <DropdownPair separator={SECTION_BREAK}>
        <CompactDropdown
          label="Toggle key"
          icon={<ToggleKeyIcon size={16} />}
          focusId="toggle_key"
          choices={toggleKeyChoices(toggle.key)}
          selected={toggle.key}
          onPick={(value) => writeListed(TOGGLE_KEY_CHOICES, value, (key) => change({ toggle_key: key }))}
        />
        <PairCell label="Chord" icon={<ChordIcon size={16} />}>
          <Toggle value={toggle.chord} onChange={(on) => void change({ toggle_chord: on })} />
          <div style={{ ...NOTE, ...MUTED }}>{chordDescription(snapshot.status.toggle_chord)}</div>
        </PairCell>
      </DropdownPair>
    </PanelSection>
  );
}

/**
 * The Advanced view: each pad's settings, the toggle settings and the daemon actions, each a section of its own.
 *
 * Thin lines part the settings inside a section, and a section break line ends each section before the next
 * heading, as on Steam's Performance tab.
 */
export function AdvancedView({ snapshot, change, onInspect, onBack }: AdvancedViewProps): ReactNode {
  return (
    <SubView title="Advanced" onBack={onBack}>
      <Header snapshot={snapshot} />
      <PadSettings side="right" snapshot={snapshot} change={change} />
      <PadSettings side="left" snapshot={snapshot} change={change} />
      <ToggleSettings snapshot={snapshot} change={change} />
      <PanelSection>
        <SubHeader title="Daemon" />
        <OpenViewRow view="inspect" bottomSeparator="standard" onOpen={onInspect}>
          All daemon settings
        </OpenViewRow>
        <ResetRow target="all" snapshot={snapshot} change={change}>
          Reset to defaults
        </ResetRow>
      </PanelSection>
    </SubView>
  );
}
