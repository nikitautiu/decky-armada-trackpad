import { Dropdown, Field, Focusable, PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import { type Choice, choiceLabel } from "../logic/advanced";
import type { Separator } from "../logic/layout";
import { DropdownFocus } from "./DropdownFocus";
import { usePick } from "./hooks";
import { MUTED, NOTE } from "./style";

/** An entry, with an optional line under its name in the open list. */
type OptionChoice = Choice & { readonly description?: string };

function OptionLabel({ choice }: { readonly choice: OptionChoice }): ReactNode {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "2px", whiteSpace: "normal", textAlign: "left" }}>
      <span>{choice.label}</span>
      {choice.description !== undefined && <span style={{ ...NOTE, ...MUTED }}>{choice.description}</span>}
    </span>
  );
}

/** Props of {@link CompactDropdown}. */
export type CompactDropdownProps = {
  /** The small label above the dropdown. */
  readonly label: string;
  /** Unique among the panel's dropdowns, such as the setting key it writes; focus returns here after its list. */
  readonly focusId: string;
  /** The entries, each shown in the open list, with its description under its name when it has one. */
  readonly choices: readonly OptionChoice[];
  /** The snapshot's value; a pick shows instead until its write settles. */
  readonly selected: string;
  /**
   * Gets a picked entry's value other than the one shown, not checked against what can be written: the caller
   * narrows it to that.
   * Settles once the write's reply has been taken in, at once when it writes nothing.
   */
  readonly onPick: (value: string) => Promise<void>;
  /** A small line icon before the label, as on Steam's sub-rows. */
  readonly icon?: ReactNode;
};

/** Props of {@link PairCell}. */
export type PairCellProps = {
  readonly label: string;
  /** A small line icon before the label, as on Steam's sub-rows. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
};

/** Half a row: a small label, after its icon if it has one, above whatever `children` is. */
export function PairCell({ label, icon, children }: PairCellProps): ReactNode {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ ...NOTE, ...MUTED, display: "flex", alignItems: "center", gap: "6px" }}>
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

/** A dropdown that takes half a row: a small label above, the closed button showing only the chosen name. */
export function CompactDropdown({ label, focusId, choices, selected, onPick, icon }: CompactDropdownProps): ReactNode {
  const [value, pick] = usePick(focusId, selected, onPick);
  return (
    <PairCell label={label} icon={icon}>
      <DropdownFocus focusId={focusId}>
        {(opened) => (
          <Dropdown
            rgOptions={choices.map((choice) => ({ data: choice.value, label: <OptionLabel choice={choice} /> }))}
            selectedOption={value}
            // The button would otherwise show the open list's two-line entry, description included.
            renderButtonValue={() => choiceLabel(choices, value)}
            onMenuOpened={opened}
            onChange={(option) => pick(option.data)}
          />
        )}
      </DropdownFocus>
    </PairCell>
  );
}

/** Props of {@link DropdownPair}. */
export type DropdownPairProps = {
  /** The line under the row. */
  readonly separator: Separator;
  readonly children: ReactNode;
};

/**
 * Two cells ({@link PairCell}, such as a {@link CompactDropdown}) side by side; left and right on the D-pad move
 * between them.
 *
 * A `Field` without a label, so the row has Steam's own padding and separator line; it isn't highlighted itself,
 * since focus is always on one of its two cells.
 */
export function DropdownPair({ separator, children }: DropdownPairProps): ReactNode {
  return (
    <PanelSectionRow>
      <Field
        childrenLayout="below"
        childrenContainerWidth="max"
        padding="standard"
        bottomSeparator={separator}
        highlightOnFocus={false}
      >
        <Focusable flow-children="row" style={{ display: "flex", gap: "10px" }}>
          {children}
        </Focusable>
      </Field>
    </PanelSectionRow>
  );
}
