import { PanelSection, PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import { incompatibleNotice, unsupportedNotice } from "../logic/offline";
import type { Incompatible, Unsupported } from "../logic/view";
import { AlertNotice } from "./AlertNotice";

/**
 * The panel while the backend leaves a reachable daemon alone: what to update for another protocol, or that the
 * device isn't supported. Nothing else, since nothing is synced.
 */
export function DaemonIssueView({ snapshot }: { readonly snapshot: Incompatible | Unsupported }): ReactNode {
  const notice =
    snapshot.kind === "incompatible"
      ? incompatibleNotice(snapshot.update, snapshot.daemonVersion)
      : unsupportedNotice(snapshot.daemonVersion, snapshot.reason);
  return (
    <PanelSection>
      <PanelSectionRow>
        <AlertNotice notice={notice} />
      </PanelSectionRow>
    </PanelSection>
  );
}
