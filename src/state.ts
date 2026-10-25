import { useEffect, useState } from "react";
import type { Snapshot } from "./logic/wire";
import { type AcceptSnapshot, acceptSnapshot, currentSnapshot, subscribeSnapshot } from "./snapshots";

/**
 * The backend's latest snapshot, `null` until the first one arrives; a remount starts from the one already held.
 *
 * The returned `accept` takes callable results too, since a rejected request reports its `error` only in its
 * return value.
 */
export function useSnapshot(): readonly [Snapshot | null, AcceptSnapshot] {
  // Steam UI workaround: from the cached snapshot, so a panel that Decky mounts again (as after a dropdown's list) has
  // no empty first frame; the subscription's first delivery comes only after the first render.
  const [snapshot, setSnapshot] = useState(currentSnapshot);
  useEffect(() => subscribeSnapshot(setSnapshot), []);
  return [snapshot, acceptSnapshot];
}
