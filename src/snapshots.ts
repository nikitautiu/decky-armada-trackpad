import { addEventListener, removeEventListener } from "@decky/api";
import { getState } from "./backend";
import { parseSnapshot, type Snapshot } from "./logic/wire";

/** Take a backend payload (a callable's return value or a `state` event) as the newest snapshot. */
export type AcceptSnapshot = (payload: unknown) => void;

// One subscription shared by the title and the panel, so both show the same snapshot and opening the plugin
// fetches it once.
const subscribers = new Set<(snapshot: Snapshot) => void>();
let latest: Snapshot | null = null;
// Steam UI workaround: the handle `addEventListener` returned, since Decky wraps the callback and only this removes it.
let stateListener: ((payload: unknown) => void) | null = null;

// Every snapshot carries the same settings, so a key the panel can't show is named once, not on every one.
const warnedKeys = new Set<string>();

function warnDroppedSetting(key: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(`Touch Trackpad: left out the setting ${key}, whose value the panel can't show`);
}

/** Take `payload` as the newest snapshot and hand it to every subscriber; malformed ones are dropped. */
export const acceptSnapshot: AcceptSnapshot = (payload) => {
  const parsed = parseSnapshot(payload, warnDroppedSetting);
  if (parsed === null) {
    console.warn("Touch Trackpad: ignored a malformed snapshot");
    return;
  }
  latest = parsed;
  for (const subscriber of subscribers) subscriber(parsed);
};

/**
 * The latest snapshot while anything is subscribed, else `null`. Steam UI workaround: a remounted panel starts from
 * it.
 */
export function currentSnapshot(): Snapshot | null {
  return latest;
}

/**
 * Hand `subscriber` every new snapshot, and the latest one at once if there is one.
 *
 * The first subscriber fetches the snapshot and starts following the `state` event; the last one to leave stops
 * it and drops the snapshot, so the next opening waits for a fresh one instead of showing an old one.
 *
 * @returns Unsubscribes; calling it again does nothing.
 */
export function subscribeSnapshot(subscriber: (snapshot: Snapshot) => void): () => void {
  subscribers.add(subscriber);
  if (stateListener === null) {
    stateListener = addEventListener<[unknown]>("state", acceptSnapshot);
    getState().then(acceptSnapshot, (error: unknown) => console.error("Touch Trackpad: get_state failed", error));
  } else if (latest !== null) {
    subscriber(latest);
  }
  return () => {
    if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
    if (stateListener !== null) removeEventListener("state", stateListener);
    stateListener = null;
    latest = null;
  };
}
