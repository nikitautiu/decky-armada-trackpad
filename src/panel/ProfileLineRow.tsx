import { PanelSectionRow } from "@decky/ui";
import { type ReactNode, useState } from "react";
import { gameIconUrl } from "../logic/gameIcon";
import type { ProfileLine } from "../logic/view";
import { PROFILE_LINE } from "./style";

const ICON_PX = 20;

/**
 * The game's small icon; nothing when Steam has none or it fails to load.
 *
 * Read on every render, which follows each snapshot, so an app store that wasn't ready when the panel opened
 * still gives the icon once it is; the read is two lookups in Steam's memory.
 */
function GameIcon({ appid }: { readonly appid: number }): ReactNode {
  const url = gameIconUrl(globalThis.appStore, appid);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === null || url === failedUrl) return null;
  return (
    <img
      src={url}
      alt=""
      width={ICON_PX}
      height={ICON_PX}
      style={{ flexShrink: 0, borderRadius: "2px" }}
      onError={() => setFailedUrl(url)}
    />
  );
}

/**
 * The profile the panel edits, like the line under Steam's Performance settings: the game's icon and name in
 * capitals for its own profile, plain text for the global one.
 */
export function ProfileLineRow({ line }: { readonly line: ProfileLine }): ReactNode {
  return (
    <PanelSectionRow>
      <div style={{ ...PROFILE_LINE, display: "flex", alignItems: "center", gap: "1ch" }}>
        {line.kind === "game" ? (
          <>
            <GameIcon appid={line.appid} />
            <span>
              Using <span style={{ textTransform: "uppercase" }}>{line.name}</span> profile
            </span>
          </>
        ) : (
          <span>Using global profile</span>
        )}
      </div>
    </PanelSectionRow>
  );
}
