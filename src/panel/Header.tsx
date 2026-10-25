import { PanelSection, PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import type { Connected, Offline } from "../logic/view";
import { BAD, NOTE, WARN } from "./style";

/** The lines under the title: the last error and any store warning; nothing when neither is set. */
export function Header({ snapshot }: { readonly snapshot: Offline | Connected }): ReactNode {
  const storeWarning = snapshot.kind === "connected" ? snapshot.storeWarning : null;
  if (snapshot.error === null && storeWarning === null) return null;
  return (
    <PanelSection>
      {snapshot.error !== null && (
        <PanelSectionRow>
          <div style={{ ...NOTE, color: BAD }}>{snapshot.error}</div>
        </PanelSectionRow>
      )}
      {storeWarning !== null && (
        <PanelSectionRow>
          <div style={{ ...NOTE, color: WARN }}>{storeWarning}</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}
