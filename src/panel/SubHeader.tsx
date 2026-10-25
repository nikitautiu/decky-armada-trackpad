import { PanelSectionRow, quickAccessControlsClasses } from "@decky/ui";
import type { ReactNode } from "react";
import { CHIP, CHIP_NEUTRAL, SECTION_LINE, SECTION_TITLE } from "./style";

/** A chip beside a heading: `accent` for a setting in use (such as the preset), `neutral` for one that is off. */
export type HeaderChip = { readonly text: string; readonly tone: "accent" | "neutral" };

/** Props of {@link SubHeader}. */
export type SubHeaderProps = {
  readonly title: string;
  readonly chip?: HeaderChip;
  /** Whether the heading is all its section holds, so the section break line goes under it. */
  readonly endsSection?: boolean;
};

/**
 * The heading that starts a section, in the style of Steam's own section titles, with an optional chip on the right.
 *
 * For a heading that needs no chip, a titled `PanelSection` is the plainer choice.
 */
export function SubHeader({ title, chip, endsSection = false }: SubHeaderProps): ReactNode {
  return (
    <PanelSectionRow>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div className={quickAccessControlsClasses.PanelSectionTitle} style={{ ...SECTION_TITLE, flexGrow: 1 }}>
          {title}
        </div>
        {chip !== undefined && <div style={chip.tone === "accent" ? CHIP : CHIP_NEUTRAL}>{chip.text}</div>}
      </div>
      {endsSection && <div style={SECTION_LINE} />}
    </PanelSectionRow>
  );
}
