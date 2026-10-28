import { callMethod, field } from "./steamObjects";

/**
 * The game the backend takes in: the running game, else the game whose library page is open. App id `0`, an empty
 * name and `running` false mean neither.
 */
export type ReportedGame = {
  readonly appid: number;
  /** The display name, empty when Steam has not named the game yet. */
  readonly name: string;
  /** Whether the game runs; a game only browsed in the library has a profile but no Trackpads state. */
  readonly running: boolean;
};

const NO_GAME: ReportedGame = { appid: 0, name: "", running: false };
const MAX_APPID = 2 ** 32 - 1;
// The backend rejects longer names, which would leave the game unreported.
const MAX_NAME = 128;
// Steam UI workaround: no API tells which page Steam shows; the route of a game's library page (and of its tabs)
// carries its app id, and the main window keeps that route while the Quick Access menu is open over it.
const LIBRARY_PAGE = /^\/library\/app\/(\d+)(?:\/|$)/;

function appIdOf(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= 0 && number <= MAX_APPID ? number : null;
}

function nameOf(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_NAME) : "";
}

/**
 * Read the running game from Steam's undocumented frontend objects.
 *
 * @param steamUIStore - `SteamUIStore`, of any shape; it gives the app id.
 * @param mainRunningApp - `Router.MainRunningApp`, of any shape; it names the game.
 */
export function readRunningGame(steamUIStore: unknown, mainRunningApp: unknown): ReportedGame {
  const mainAppId = appIdOf(field(mainRunningApp, "appid"));
  const appid = appIdOf(field(steamUIStore, "MainRunningAppID")) ?? mainAppId ?? 0;
  if (appid === 0) return NO_GAME;
  const name = mainAppId === appid ? nameOf(field(mainRunningApp, "display_name")) : "";
  return { appid, name, running: true };
}

/**
 * Read the game whose library page Steam's main window shows, from Steam's undocumented frontend objects; no game
 * when they can't be read.
 *
 * @param steamUIStore - `SteamUIStore`, of any shape; its main window's route names the page.
 * @param appStore - Steam's `appStore`, of any shape; it names the game.
 */
export function readLibraryGame(steamUIStore: unknown, appStore: unknown): ReportedGame {
  try {
    const window = field(field(steamUIStore, "m_WindowStore"), "GamepadUIMainWindowInstance");
    const route = field(field(field(window, "m_history"), "location"), "pathname");
    const page = typeof route === "string" ? LIBRARY_PAGE.exec(route) : null;
    const appid = appIdOf(page?.[1]) ?? 0;
    if (appid === 0) return NO_GAME;
    const name = nameOf(field(callMethod(appStore, "GetAppOverviewByAppID", appid), "display_name"));
    return { appid, name, running: false };
  } catch {
    // Steam UI workaround: a getter in Steam's stores threw, as the library's can while it loads. Unlike the running
    // game, this read must not make the tick unreadable: that would hold back the report of a game that just exited.
    return NO_GAME;
  }
}

/**
 * Read the game the backend takes in: the running game, else the game whose library page is open, as the
 * Performance tab picks the game its per-game profile is for.
 *
 * @param steamUIStore - As for {@link readRunningGame} and {@link readLibraryGame}.
 * @param mainRunningApp - As for {@link readRunningGame}.
 * @param appStore - As for {@link readLibraryGame}.
 */
export function readReportedGame(steamUIStore: unknown, mainRunningApp: unknown, appStore: unknown): ReportedGame {
  const runningGame = readRunningGame(steamUIStore, mainRunningApp);
  return runningGame.appid !== 0 ? runningGame : readLibraryGame(steamUIStore, appStore);
}

/**
 * The game to report after one reading, or `null` when the backend already holds it.
 *
 * @param reported - What the backend has taken in, `null` before the first report went through.
 * @param reading - This tick's reading, or `null` when Steam's objects could not be read. Nothing is reported
 *   then: a guessed game would switch the backend's profile.
 */
export function gameReport(reported: ReportedGame | null, reading: ReportedGame | null): ReportedGame | null {
  if (reading === null) return null;
  if (
    reported !== null &&
    reported.appid === reading.appid &&
    reported.name === reading.name &&
    reported.running === reading.running
  ) {
    return null;
  }
  return reading;
}
