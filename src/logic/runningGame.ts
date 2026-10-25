/** The game Steam runs, as the backend takes it in: app id `0` and an empty name when none runs. */
export type RunningGame = {
  readonly appid: number;
  /** The display name, empty when Steam has not named the game yet. */
  readonly name: string;
};

const MAX_APPID = 2 ** 32 - 1;
// The backend rejects longer names, which would leave the game unreported.
const MAX_NAME = 128;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function appIdOf(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= 0 && number <= MAX_APPID ? number : null;
}

/**
 * Read the {@link RunningGame} from Steam's undocumented frontend objects.
 *
 * @param steamUIStore - `SteamUIStore`, of any shape; it gives the app id.
 * @param mainRunningApp - `Router.MainRunningApp`, of any shape; it names the game.
 */
export function readRunningGame(steamUIStore: unknown, mainRunningApp: unknown): RunningGame {
  const mainAppId = appIdOf(field(mainRunningApp, "appid"));
  const appid = appIdOf(field(steamUIStore, "MainRunningAppID")) ?? mainAppId ?? 0;
  const name = field(mainRunningApp, "display_name");
  return {
    appid,
    name: appid !== 0 && mainAppId === appid && typeof name === "string" ? name.slice(0, MAX_NAME) : "",
  };
}

/**
 * The game to report after one reading, or `null` when the backend already holds it.
 *
 * @param reported - What the backend has taken in, `null` before the first report went through.
 * @param reading - This tick's reading, or `null` when Steam's objects could not be read. Nothing is reported
 *   then: a guessed game would switch the backend's profile.
 */
export function gameReport(reported: RunningGame | null, reading: RunningGame | null): RunningGame | null {
  if (reading === null) return null;
  if (reported !== null && reported.appid === reading.appid && reported.name === reading.name) return null;
  return reading;
}
