import { callMethod } from "./steamObjects";

// Steam UI workaround: where Steam's own UI loads a Steam game's small icon from, as `appStore.GetIconURLForApp`
// returns it on the Nova; no API documents it.
const COMMUNITY_ICONS = "https://shared.steamstatic.com/community_assets/images/apps";
const ICON_HASH = /^[0-9a-f]{40}$/;
// An icon from Steam's CDN, or an inline image as Steam gives for a non-Steam shortcut; nothing that could run.
const USABLE_URL = /^(https:\/\/|data:image\/)/;

function usableUrl(value: unknown): string | null {
  return typeof value === "string" && USABLE_URL.test(value) ? value : null;
}

/**
 * The URL of a game's small icon, as Steam's own UI shows it, or `null` when Steam doesn't offer one.
 *
 * @param appStore - Steam's undocumented `appStore` global, of any shape; nothing it holds or throws escapes.
 */
export function gameIconUrl(appStore: unknown, appid: number): string | null {
  try {
    const overview = callMethod(appStore, "GetAppOverviewByAppID", appid);
    if (typeof overview !== "object" || overview === null) return null;
    const steamUrl = usableUrl(callMethod(appStore, "GetIconURLForApp", overview));
    if (steamUrl !== null) return steamUrl;
    const hash: unknown = Reflect.get(overview, "icon_hash");
    return typeof hash === "string" && ICON_HASH.test(hash) ? `${COMMUNITY_ICONS}/${appid}/${hash}.jpg` : null;
  } catch {
    // Steam UI workaround: a getter in Steam's store threw, as it can while the library loads: the line goes without an
    // icon.
    return null;
  }
}
