import { callable } from "@decky/api";
import type { SettingValue } from "./logic/wire";

// Every snapshot-returning callable yields `unknown`: `parseSnapshot` (via `useSnapshot`) narrows it in one place.

/** The current snapshot. */
export const getState = callable<[], unknown>("get_state");

/** Turn the pads on or off in the game in use until it exits; the daemon applies it while the game is in front. */
export const setTrackpads = callable<[on: boolean], unknown>("set_trackpads");

/** Save whether games of the profile in use start with the pads on; the game in use follows it. */
export const setDefault = callable<[on: boolean], unknown>("set_default");

/** Change settings in `profile` (`"global"` or `"game:<appid>"`); dropped if the profile changed meanwhile. */
export const setSettings = callable<[changes: Readonly<Record<string, SettingValue>>, profile: string], unknown>(
  "set_settings",
);

/**
 * Use the running game's own profile, or the global one. A profile created now starts from the global settings
 * with `initial` applied; a game that already has one keeps its settings.
 */
export const setGameProfile = callable<[enabled: boolean, initial: Readonly<Record<string, SettingValue>>], unknown>(
  "set_game_profile",
);

/** Report the running game; an app id of 0 means none. */
export const setCurrentGame = callable<[appid: number, name: string], unknown>("set_current_game");

/** Ask the daemon to re-check its wiring and availability. */
export const check = callable<[], unknown>("check");

/** Start the daemon's user service; returns `{ ok, output }`. */
export const startDaemon = callable<[], unknown>("start_daemon");

/** The daemon unit's status from the user manager; returns `{ ok, output }`. */
export const readStatus = callable<[], unknown>("read_status");

/** Whether the daemon is installed: `{installed: boolean | null}`. */
export const readUnit = callable<[], unknown>("read_unit");
