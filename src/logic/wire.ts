/** A value of one daemon setting as it travels on the wire. */
export type SettingValue = null | boolean | number | string | readonly string[] | readonly number[];

/** The daemon settings, keyed by wire name (`size`, `right.anchor`, ...). */
export type Settings = Readonly<Record<string, SettingValue>>;

/** The daemon status fields the panel uses. */
export type Status = {
  readonly mode: string;
  readonly available: boolean;
  readonly reason: string;
  /** The daemon's device profile id, such as `retroid-pocket-nova`. */
  readonly device: string;
  readonly toggle_key: string;
  readonly toggle_chord: string;
  readonly version: string;
  readonly instance: string;
  /** The InputPlumber version the daemon found, or `null` when it can't read one. */
  readonly inputplumber_version: string | null;
};

/** The game the backend currently tracks. */
export type Game = { readonly appid: number; readonly name: string };

/** Which side the user updates when the daemon and the plugin speak different protocols. */
export type UpdateSide = "daemon" | "plugin";

/** What the backend knows right now: no daemon, a daemon the plugin can't work with, or the daemon's full state. */
export type Snapshot =
  | {
      readonly kind: "offline";
      readonly profile: string;
      readonly game: Game | null;
      readonly error: string | null;
    }
  | {
      /** A reachable daemon of another protocol than the plugin's; the backend syncs nothing with it. */
      readonly kind: "incompatible";
      readonly update: UpdateSide;
      /** The version the daemon reports, or "unknown" when it reports none. */
      readonly daemonVersion: string;
    }
  | {
      /** A reachable daemon on hardware it has no device profile for; it refuses everything but its status. */
      readonly kind: "unsupported";
      /** The version the daemon reports, or "unknown" when it reports none. */
      readonly daemonVersion: string;
      /** The daemon's reason, which names the hardware it found. */
      readonly reason: string;
    }
  | {
      readonly kind: "connected";
      readonly status: Status;
      readonly settings: Settings;
      readonly defaults: Settings;
      readonly profile: string;
      readonly game: Game | null;
      readonly gameProfile: boolean;
      /** The daemon reports a game in front, not Steam's own UI. */
      readonly inGame: boolean;
      /** Start with trackpads on: the default saved in the profile in use, which a game starts from. */
      readonly defaultOn: boolean;
      /** Trackpads: whether the pads are on in the game in use right now; `null` while no game runs. */
      readonly sessionOn: boolean | null;
      readonly error: string | null;
      readonly storeWarning: string | null;
    };

type Obj = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingValue(value: unknown): value is SettingValue {
  if (value === null) return true;
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string") || value.every((item) => typeof item === "number");
  }
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

/** Told the key of a setting whose value has a shape the panel can't show; the snapshot leaves that key out. */
export type OnDroppedSetting = (key: string) => void;

// A key of an unknown shape is left out, not fatal: one new daemon setting must not blank the whole panel.
function parseSettings(value: unknown, onDropped: OnDroppedSetting): Settings | null {
  if (!isObject(value)) return null;
  const result: Record<string, SettingValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSettingValue(item)) result[key] = item;
    else onDropped(key);
  }
  return result;
}

function parseStatus(value: unknown): Status | null {
  if (!isObject(value)) return null;
  const { mode, available, reason, device, toggle_key, toggle_chord, version, instance } = value;
  const inputplumber_version = nullableString(value.inputplumber_version);
  if (
    typeof mode !== "string" ||
    typeof available !== "boolean" ||
    typeof reason !== "string" ||
    typeof device !== "string" ||
    typeof toggle_key !== "string" ||
    typeof toggle_chord !== "string" ||
    typeof version !== "string" ||
    typeof instance !== "string" ||
    inputplumber_version === undefined
  ) {
    return null;
  }
  return { mode, available, reason, device, toggle_key, toggle_chord, version, instance, inputplumber_version };
}

/** The result is `undefined` for a malformed game, so that `null` can mean "no game". */
function parseGame(value: unknown): Game | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || typeof value.appid !== "number" || typeof value.name !== "string") return undefined;
  return { appid: value.appid, name: value.name };
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function updateSide(kind: unknown): UpdateSide | null {
  if (kind === "update_daemon") return "daemon";
  if (kind === "update_plugin") return "plugin";
  return null;
}

/** The disconnected snapshot for the backend's `daemon_issue`; `null` for one of another shape. */
function disconnected(issue: unknown, offline: Snapshot): Snapshot | null {
  if (issue === null) return offline;
  if (!isObject(issue) || typeof issue.version !== "string") return null;
  if (issue.kind === "unsupported_device") {
    return typeof issue.reason === "string"
      ? { kind: "unsupported", daemonVersion: issue.version, reason: issue.reason }
      : null;
  }
  const update = updateSide(issue.kind);
  return update === null ? null : { kind: "incompatible", update, daemonVersion: issue.version };
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  return value === null || typeof value === "boolean" ? value : undefined;
}

/**
 * Narrow a backend payload (event `state` or a callable's return value) to a {@link Snapshot}.
 *
 * @param onDropped - Called for each setting or default left out for its value's shape.
 * @returns `null` when the payload has any other shape error.
 */
export function parseSnapshot(value: unknown, onDropped: OnDroppedSetting): Snapshot | null {
  if (!isObject(value)) return null;
  const { connected, profile } = value;
  const game = parseGame(value.game);
  const error = nullableString(value.error);
  if (typeof connected !== "boolean" || typeof profile !== "string" || game === undefined || error === undefined) {
    return null;
  }
  if (!connected) return disconnected(value.daemon_issue, { kind: "offline", profile, game, error });

  const status = parseStatus(value.status);
  const settings = parseSettings(value.settings, onDropped);
  const defaults = parseSettings(value.defaults, onDropped);
  const storeWarning = nullableString(value.store_warning);
  const sessionOn = nullableBoolean(value.session_on);
  const { game_profile: gameProfile, in_game: inGame, default_on: defaultOn } = value;
  if (
    status === null ||
    settings === null ||
    defaults === null ||
    storeWarning === undefined ||
    typeof gameProfile !== "boolean" ||
    typeof inGame !== "boolean" ||
    typeof defaultOn !== "boolean" ||
    sessionOn === undefined
  ) {
    return null;
  }
  return {
    kind: "connected",
    status,
    settings,
    defaults,
    profile,
    game,
    gameProfile,
    inGame,
    defaultOn,
    sessionOn,
    error,
    storeWarning,
  };
}

/** Whether the daemon is installed, from `read_unit`'s reply; `null` when unknown or of another shape. */
export function parseUnit(value: unknown): boolean | null {
  return isObject(value) && typeof value.installed === "boolean" ? value.installed : null;
}

/** The outcome of a service command (`start_daemon`, `read_status`). */
export type CommandResult = { readonly ok: boolean; readonly output: string };

// The backend keeps 16 KiB of a command's output; a longer string is not from it, so it is cut, not shown whole.
const MAX_OUTPUT = 16 * 1024;

/**
 * Narrow a service command's return value to a {@link CommandResult}.
 *
 * @returns `null` when the payload has any shape error.
 */
export function parseCommandResult(value: unknown): CommandResult | null {
  if (!isObject(value) || typeof value.ok !== "boolean" || typeof value.output !== "string") return null;
  return { ok: value.ok, output: value.output.slice(0, MAX_OUTPUT) };
}
