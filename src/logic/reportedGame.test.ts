import { describe, expect, it } from "vitest";
import { gameReport, type ReportedGame, readLibraryGame, readReportedGame, readRunningGame } from "./reportedGame";

const BALATRO = 2379780;
const PORTAL = 620;
const NO_GAME: ReportedGame = { appid: 0, name: "", running: false };

const running = (extra: Partial<ReportedGame> = {}): ReportedGame => ({
  appid: BALATRO,
  name: "Balatro",
  running: true,
  ...extra,
});

const browsed = (extra: Partial<ReportedGame> = {}): ReportedGame => ({
  appid: PORTAL,
  name: "Portal 2",
  running: false,
  ...extra,
});

/** A fake `SteamUIStore` that runs `appid` and shows the page at `route`. */
const store = (appid: unknown, route: unknown = "/library/home"): unknown => ({
  MainRunningAppID: appid,
  m_WindowStore: { GamepadUIMainWindowInstance: { m_history: { location: { pathname: route } } } },
});

/** A fake `appStore` that names Portal 2, as `name` when given. */
const appStore = (name: unknown = "Portal 2"): unknown => ({
  GetAppOverviewByAppID: (appid: number) => (appid === PORTAL ? { display_name: name } : null),
});

describe("readRunningGame", () => {
  it("reads the running game and its name", () => {
    const app = { appid: String(BALATRO), display_name: "Balatro" };
    expect(readRunningGame(store(BALATRO), app)).toEqual(running());
  });

  it("reports no game when Steam runs none", () => {
    expect(readRunningGame(store(0), undefined)).toEqual(NO_GAME);
  });

  it("falls back to the main running app for the app id", () => {
    expect(readRunningGame(undefined, { appid: BALATRO, display_name: "Balatro" })).toEqual(running());
  });

  it("leaves the name empty when the main running app is another game", () => {
    expect(readRunningGame(store(BALATRO), { appid: 10, display_name: "Other" })).toEqual(running({ name: "" }));
  });

  it("cuts a name longer than the backend accepts", () => {
    const app = { appid: BALATRO, display_name: "x".repeat(200) };
    expect(readRunningGame(store(BALATRO), app).name).toBe("x".repeat(128));
  });

  it.each<[string, unknown]>([
    ["negative", -1],
    ["fractional", 1.5],
    ["too large", 2 ** 32],
    ["not a number", "abc"],
  ])("treats a %s app id as no game", (_case, appid) => {
    expect(readRunningGame(store(appid), undefined).appid).toBe(0);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a number", 42],
    ["an empty object", {}],
  ])("reads no game from a store that is %s", (_case, value) => {
    expect(readRunningGame(value, null)).toEqual(NO_GAME);
  });
});

describe("readLibraryGame", () => {
  it.each<[string, string]>([
    ["a game's page", `/library/app/${PORTAL}`],
    ["a tab of a game's page", `/library/app/${PORTAL}/tab/activity`],
  ])("reads the game of %s, with its name from the library", (_case, route) => {
    expect(readLibraryGame(store(0, route), appStore())).toEqual(browsed());
  });

  it.each<[string, unknown]>([
    ["the library home", "/library/home"],
    ["the store", "/steamweb"],
    ["an app route without an id", "/library/app/"],
    ["an app id with letters", "/library/app/62x0"],
    ["an app id that is too large", `/library/app/${2 ** 32}`],
    ["a route under another path", `/settings/library/app/${PORTAL}`],
    ["no route", undefined],
  ])("reads no game on %s", (_case, route) => {
    expect(readLibraryGame(store(0, route), appStore())).toEqual(NO_GAME);
  });

  it.each<[string, unknown]>([
    ["no app store", undefined],
    ["an app store that doesn't know the game", { GetAppOverviewByAppID: () => null }],
    ["a name that is not a string", appStore(42)],
  ])("leaves the name empty with %s", (_case, apps) => {
    expect(readLibraryGame(store(0, `/library/app/${PORTAL}`), apps)).toEqual(browsed({ name: "" }));
  });

  it.each<[string, unknown, unknown]>([
    [
      "the route",
      {
        get m_WindowStore(): never {
          throw new Error("gone");
        },
      },
      appStore(),
    ],
    [
      "the name",
      store(0, `/library/app/${PORTAL}`),
      {
        GetAppOverviewByAppID: () => {
          throw new Error("loading");
        },
      },
    ],
  ])("reads no game when a Steam getter for %s throws", (_case, steamUIStore, apps) => {
    expect(readLibraryGame(steamUIStore, apps)).toEqual(NO_GAME);
  });

  it("cuts a name longer than the backend accepts", () => {
    const game = readLibraryGame(store(0, `/library/app/${PORTAL}`), appStore("x".repeat(200)));
    expect(game.name).toBe("x".repeat(128));
  });
});

describe("readReportedGame", () => {
  it("reads the running game, even on another game's page", () => {
    const app = { appid: BALATRO, display_name: "Balatro" };
    expect(readReportedGame(store(BALATRO, `/library/app/${PORTAL}`), app, appStore())).toEqual(running());
  });

  it("reads the library page's game when no game runs", () => {
    expect(readReportedGame(store(0, `/library/app/${PORTAL}`), undefined, appStore())).toEqual(browsed());
  });

  it("reports a game's exit even when the library page can't be read", () => {
    const apps = {
      GetAppOverviewByAppID: () => {
        throw new Error("loading");
      },
    };
    expect(readReportedGame(store(0, `/library/app/${PORTAL}`), undefined, apps)).toEqual(NO_GAME);
  });

  it("reads no game with none running and no game's page open", () => {
    expect(readReportedGame(store(0), undefined, appStore())).toEqual(NO_GAME);
  });
});

describe("gameReport", () => {
  it("reports the game when nothing was taken in yet", () => {
    expect(gameReport(null, running())).toEqual(running());
  });

  it("reports nothing when the backend already holds the game", () => {
    expect(gameReport(running(), running())).toBeNull();
  });

  it.each<[string, ReportedGame]>([
    ["the game exits", NO_GAME],
    ["another game starts", running({ appid: 10, name: "Other" })],
    ["the name arrives later", running()],
    ["the game exits to its page", running({ name: "", running: false })],
  ])("reports the game again when %s", (_case, reading) => {
    expect(gameReport(running({ name: "" }), reading)).toEqual(reading);
  });

  it.each<[string, ReportedGame | null]>([
    ["nothing was taken in yet", null],
    ["a game was taken in", running()],
  ])("reports nothing on an unreadable tick when %s", (_case, reported) => {
    expect(gameReport(reported, null)).toBeNull();
  });
});
