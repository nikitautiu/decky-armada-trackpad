import { PanelSectionRow } from "@decky/ui";
import { type ReactNode, useState } from "react";
import { gameIconUrl } from "../logic/gameIcon";
import type { ProfileLine } from "../logic/view";
import { PROFILE_LINE } from "./style";

// The icon size, the gap after it and the margin below the line match the line under Steam's Performance settings.
const ICON_PX = 16;
// One line, cut with an ellipsis like the Performance tab's, so a long name never changes the line's height.
const ONE_LINE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } as const;

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
      {/* The icon's height as the minimum, so switching between a game's line and the global one keeps it; the
      margin keeps the icon off the focus highlight of the row below, as in the Performance tab. */}
      <div
        style={{
          ...PROFILE_LINE,
          display: "flex",
          alignItems: "center",
          gap: "11px",
          minHeight: `${ICON_PX}px`,
          marginBottom: "3px",
        }}
      >
        {line.kind === "game" ? (
          <>
            <GameIcon appid={line.appid} />
            <span style={ONE_LINE}>
              Using <span style={{ textTransform: "uppercase" }}>{line.name}</span> profile
            </span>
          </>
        ) : (
          <span style={ONE_LINE}>Using global profile</span>
        )}
      </div>
    </PanelSectionRow>
  );
}
