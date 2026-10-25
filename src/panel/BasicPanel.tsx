import { ButtonItem, Focusable, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import type { ReactNode } from "react";
import { check, setDefault, setGameProfile, setSettings, setTrackpads } from "../backend";
import { resetAllChanges } from "../logic/defaults";
import { peerSeparator, SECTION_BREAK } from "../logic/layout";
import { type PadChoice, type Preset, padChoice, padChoiceChanges, type Side } from "../logic/presets";
import { panelOf } from "../logic/preview/geometry";
import { sizeAndPosition } from "../logic/sliders";
import {
  type Connected,
  defaultDescription,
  padOptions,
  pickedChoice,
  profileLine,
  recheckDescription,
  SIDE_NAME,
  trackpadsDescription,
} from "../logic/view";
import { useSnapshot } from "../state";
import { AdvancedView } from "./AdvancedView";
import { Collapsible } from "./Collapsible";
import { CompactDropdown, DropdownPair } from "./CompactDropdown";
import { DaemonIssueView } from "./DaemonIssueView";
import { Header } from "./Header";
import { swallowBack, useBackGuard, useDebouncedEdit, usePanelView } from "./hooks";
import { InspectView } from "./InspectView";
import { OfflineView } from "./OfflineView";
import { PadsHeading } from "./PadsHeading";
import { PreviewRow } from "./PreviewModal";
import { ProfileLineRow } from "./ProfileLineRow";
import { ResetRow } from "./ResetDialog";
import { SettingSlider } from "./SettingSlider";
import { OpenViewRow } from "./SubView";
import type { Change, Changes, Run } from "./types";

const SWITCH_DEBOUNCE_MS = 250;

type SectionProps = { readonly snapshot: Connected; readonly run: Run };

/** The running game's Trackpads, and Check again while pad mode is unavailable, in a game or not. */
function TrackpadsSection({ snapshot, run }: SectionProps): ReactNode {
  const { status, sessionOn } = snapshot;
  if (sessionOn === null && status.available) return null;
  return (
    <PanelSection>
      {sessionOn !== null && <TrackpadsRow snapshot={snapshot} sessionOn={sessionOn} run={run} />}
      {!status.available && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            bottomSeparator={SECTION_BREAK}
            description={recheckDescription(snapshot)}
            onClick={() => void run(check())}
          >
            Check again
          </ButtonItem>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

function TrackpadsRow({ snapshot, sessionOn, run }: SectionProps & { readonly sessionOn: boolean }): ReactNode {
  const { status } = snapshot;
  // The game's state, not the live mode: with the QAM in front the pads are off, and the switch shows what the game
  // gets when it is in front again.
  const [on, editOn] = useDebouncedEdit(sessionOn, SWITCH_DEBOUNCE_MS, (value) => run(setTrackpads(value)));
  return (
    <PanelSectionRow>
      <ToggleField
        label="Trackpads"
        // The section break before the profile, unless Check again follows and carries it.
        bottomSeparator={status.available ? SECTION_BREAK : "none"}
        description={trackpadsDescription(status)}
        checked={on}
        disabled={!status.available}
        onChange={editOn}
      />
    </PanelSectionRow>
  );
}

/** The profile in use: its line, the running game's per-game switch, and its default. */
function ProfileSection({ snapshot, run }: SectionProps): ReactNode {
  const [on, editOn] = useDebouncedEdit(snapshot.defaultOn, SWITCH_DEBOUNCE_MS, (value) => run(setDefault(value)));
  return (
    <PanelSection>
      <ProfileLineRow line={profileLine(snapshot)} />
      {snapshot.game !== null && (
        <PanelSectionRow>
          <ToggleField
            label="Use per-game profile"
            bottomSeparator="none"
            checked={snapshot.gameProfile}
            // While it is off the global profile is shown, so the reset changes turn a copy of it into defaults.
            onChange={(enabled) =>
              void run(setGameProfile(enabled, resetAllChanges(snapshot.settings, snapshot.defaults)))
            }
          />
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ToggleField
          label="Start with trackpads on"
          bottomSeparator={SECTION_BREAK}
          description={defaultDescription(snapshot)}
          checked={on}
          onChange={editOn}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}

type PadSelectorProps = {
  readonly side: Side;
  readonly snapshot: Connected;
  /** Writes a picked choice; settles once the reply has been taken in. */
  readonly onPick: (side: Side, choice: Preset | "off") => Promise<void>;
};

function PadSelector({ side, snapshot, onPick }: PadSelectorProps): ReactNode {
  const choice: PadChoice = padChoice(snapshot.settings, side);
  return (
    <CompactDropdown
      label={SIDE_NAME[side]}
      focusId={`pad.${side}`}
      choices={padOptions(choice)}
      selected={choice}
      onPick={(value) => {
        const picked = pickedChoice(value);
        return picked === null ? Promise.resolve() : onPick(side, picked);
      }}
    />
  );
}

function ConnectedPanel({ snapshot, run }: { readonly snapshot: Connected; readonly run: Run }): ReactNode {
  const { view, open, back } = usePanelView();
  // Bound to this render's profile, so an edit lands in the profile the user saw.
  const change: Change = (changes: Changes) => run(setSettings(changes, snapshot.profile));
  // Without a panel size there is nothing to lay the pads out on, so the sliders are left out.
  const panel = panelOf(snapshot.settings);
  const sliders = panel === null ? [] : sizeAndPosition(panel);
  const pick = (side: Side, choice: Preset | "off"): Promise<void> =>
    change(padChoiceChanges(snapshot.settings, side, choice));
  if (view === "inspect") return <InspectView snapshot={snapshot} onBack={back} />;
  if (view === "advanced") {
    return <AdvancedView snapshot={snapshot} change={change} onInspect={() => open("inspect")} onBack={back} />;
  }
  return (
    <>
      <Header snapshot={snapshot} />
      <TrackpadsSection snapshot={snapshot} run={run} />
      <ProfileSection snapshot={snapshot} run={run} />
      <PanelSection>
        <PadsHeading />
        <DropdownPair separator="standard">
          <PadSelector side="left" snapshot={snapshot} onPick={pick} />
          <PadSelector side="right" snapshot={snapshot} onPick={pick} />
        </DropdownPair>
        {sliders.length > 0 && (
          <Collapsible id="size-and-position" label="Size and position" bottomSeparator="standard">
            {sliders.map((spec, index) => (
              <SettingSlider
                key={spec.key}
                spec={spec}
                snapshot={snapshot}
                change={change}
                separator={peerSeparator(index, sliders.length, "standard")}
              />
            ))}
          </Collapsible>
        )}
        <PreviewRow settings={snapshot.settings} bottomSeparator="standard" />
        <OpenViewRow view="advanced" bottomSeparator="standard" onOpen={() => open("advanced")}>
          Advanced
        </OpenViewRow>
        <ResetRow target="all" snapshot={snapshot} change={change}>
          Reset to defaults
        </ResetRow>
      </PanelSection>
    </>
  );
}

/** The quick access panel: nothing until the first snapshot, then the offline, daemon issue or connected view. */
export function BasicPanel(): ReactNode {
  const [snapshot, accept] = useSnapshot();
  // Steam UI workaround: the B press that closed a modal reaches the panel again, where it would close the plugin.
  const guarding = useBackGuard();
  if (snapshot === null) return null;
  if (snapshot.kind === "offline") return <OfflineView snapshot={snapshot} />;
  if (snapshot.kind === "incompatible" || snapshot.kind === "unsupported")
    return <DaemonIssueView snapshot={snapshot} />;
  const run: Run = (call) =>
    call.then(accept, (error: unknown) => console.error("Touch Trackpad: a backend call failed", error));
  return (
    <Focusable {...(guarding ? { onCancelButton: swallowBack } : {})}>
      <ConnectedPanel snapshot={snapshot} run={run} />
    </Focusable>
  );
}
