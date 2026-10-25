import { staticClasses } from "@decky/ui";
import type { ReactNode } from "react";
import { showsOfflineDot } from "../logic/view";
import { useSnapshot } from "../state";
import { BAD } from "./style";

const OFFLINE = "Offline";

/** The plugin's title, with a red dot while the daemon is down; a working daemon needs no mark. */
export function Title(): ReactNode {
  const [snapshot] = useSnapshot();
  return (
    <div className={staticClasses.Title} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      Touch Trackpad
      {showsOfflineDot(snapshot) && (
        <span
          role="img"
          aria-label={OFFLINE}
          title={OFFLINE}
          style={{ flexShrink: 0, width: "8px", height: "8px", borderRadius: "4px", background: BAD }}
        />
      )}
    </div>
  );
}
