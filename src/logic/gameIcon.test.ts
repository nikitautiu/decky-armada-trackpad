import { describe, expect, it } from "vitest";
import { gameIconUrl } from "./gameIcon";

const APPID = 2379780;
const HASH = "b6018068070ab0e23561694c11f7950dd6f4c752";
const STEAM_URL = `https://shared.steamstatic.com/community_assets/images/apps/${APPID}/${HASH}.jpg`;

/** A stand-in for Steam's `appStore` that knows one app. */
const store = (overview: unknown, iconUrl?: (app: unknown) => unknown): unknown => ({
  GetAppOverviewByAppID: (appid: number) => (appid === APPID ? overview : null),
  ...(iconUrl === undefined ? {} : { GetIconURLForApp: iconUrl }),
});

describe("gameIconUrl", () => {
  it("takes the URL Steam's own UI uses for the app", () => {
    const overview = { icon_hash: HASH };
    expect(
      gameIconUrl(
        store(overview, (app) => (app === overview ? STEAM_URL : null)),
        APPID,
      ),
    ).toBe(STEAM_URL);
  });

  it("accepts an inline image, as Steam gives for a non-Steam shortcut", () => {
    expect(
      gameIconUrl(
        store({}, () => "data:image/png;base64,AAAA"),
        APPID,
      ),
    ).toBe("data:image/png;base64,AAAA");
  });

  it("builds the community icon URL from the hash when Steam offers no URL", () => {
    expect(gameIconUrl(store({ icon_hash: HASH }), APPID)).toBe(STEAM_URL);
  });

  it.each<[string, unknown]>([
    ["a script URL", "javascript:alert(1)"],
    ["plain http", "http://example.com/icon.jpg"],
    ["an empty string", ""],
    ["a number", 3],
  ])("ignores %s from Steam and falls back to the hash", (_name, url) => {
    expect(
      gameIconUrl(
        store({ icon_hash: HASH }, () => url),
        APPID,
      ),
    ).toBe(STEAM_URL);
  });

  it.each<[string, unknown, number]>([
    ["no store", undefined, APPID],
    ["a store without the lookup", {}, APPID],
    ["an app Steam doesn't know", store({ icon_hash: HASH }), APPID + 1],
  ])("gives no icon for %s", (_name, appStore, appid) => {
    expect(gameIconUrl(appStore, appid)).toBeNull();
  });

  it.each<[string, unknown]>([
    ["no hash", {}],
    ["a hash that isn't hex", { icon_hash: "../../evil" }],
    ["an empty hash", { icon_hash: "" }],
  ])("gives no icon for an app with %s", (_name, overview) => {
    expect(gameIconUrl(store(overview), APPID)).toBeNull();
  });

  it("gives no icon when Steam's lookup throws", () => {
    const throwing = {
      GetAppOverviewByAppID: () => {
        throw new Error("not ready");
      },
    };
    expect(gameIconUrl(throwing, APPID)).toBeNull();
  });
});
