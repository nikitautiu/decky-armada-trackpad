import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import {
  INSPECT_GROUPS,
  type InspectRow,
  inspectRows,
  inspectText,
  overridesNote,
  statusRows,
  wireKey,
} from "../logic/inspect";
import { peerSeparator, type Separator } from "../logic/layout";
import type { Connected } from "../logic/view";
import { copyText } from "./clipboard";
import { SubView } from "./SubView";
import { CHANGED, FAINT, MONO, MUTED, NOTE } from "./style";

/** Props of {@link InspectView}. */
export type InspectViewProps = {
  readonly snapshot: Connected;
  /** Returns to the Advanced view. */
  readonly onBack: () => void;
};

type Line = { readonly key: string; readonly value: string; readonly changed: boolean };

/**
 * One key and value; focusable, so the D-pad steps through the list and the menu scrolls along.
 *
 * Standard padding, like every other row. Steam UI workaround: Steam's compact padding drops the row's side inset, so
 * the key and value would run to the panel's edges.
 */
function LineRow({ line, separator }: { readonly line: Line; readonly separator: Separator }): ReactNode {
  return (
    <PanelSectionRow>
      <Field
        focusable
        highlightOnFocus
        bottomSeparator={separator}
        label={<span style={{ ...MONO, ...MUTED }}>{line.key}</span>}
      >
        <span style={{ ...MONO, ...(line.changed ? { color: CHANGED } : {}) }}>{line.value}</span>
      </Field>
    </PanelSectionRow>
  );
}

type GroupProps = { readonly title: string; readonly lines: readonly Line[]; readonly note?: string };

function Group({ title, lines, note }: GroupProps): ReactNode {
  return (
    <PanelSection title={title}>
      {lines.map((line, index) => (
        <LineRow key={line.key} line={line} separator={peerSeparator(index, lines.length)} />
      ))}
      {note !== undefined && (
        <PanelSectionRow>
          <div style={{ ...MONO, ...FAINT }}>{note}</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

function lines(rows: readonly InspectRow[], group: InspectRow["group"]): readonly Line[] {
  return rows.filter((row) => row.group === group).map((row) => ({ ...row, key: wireKey(row) }));
}

async function copy(text: string, target: Document): Promise<void> {
  const copied = await copyText(text, target);
  toaster.toast({ title: "Daemon settings", body: copied ? "Copied as text." : "Could not copy to the clipboard." });
}

/** The daemon's status and every setting, read-only; changed values are highlighted. */
export function InspectView({ snapshot, onBack }: InspectViewProps): ReactNode {
  const rows = inspectRows(snapshot.settings, snapshot.defaults);
  const right = lines(rows, "right");
  const left = lines(rows, "left");
  return (
    <SubView title="Daemon settings" onBack={onBack}>
      <PanelSection>
        <PanelSectionRow>
          <div style={{ ...NOTE, ...MUTED }}>
            Read-only, exactly as the daemon reports them. <b style={{ color: CHANGED }}>Blue</b> values differ from the
            device default.
          </div>
        </PanelSectionRow>
      </PanelSection>
      <Group title="Status" lines={statusRows(snapshot.status).map((row) => ({ ...row, changed: false }))} />
      <Group title={INSPECT_GROUPS.shared} lines={lines(rows, "shared")} />
      <Group title={INSPECT_GROUPS.right} lines={right} note={overridesNote(right.length)} />
      <Group title={INSPECT_GROUPS.left} lines={left} note={overridesNote(left.length)} />
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            bottomSeparator="none"
            onClick={(event) => void copy(inspectText(snapshot.status, rows), event.view?.document ?? document)}
          >
            Copy as text
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </SubView>
  );
}
