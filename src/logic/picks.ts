/** A dropdown entry picked by the user, waiting for its write to settle. */
export type PendingPick = { readonly value: string };

/**
 * The dropdowns' pending picks by focus id.
 *
 * Steam UI workaround: kept outside React so a pick outlives the panel's remount when the dropdown's list closes.
 */
export type PendingPicks = {
  readonly get: (id: string) => PendingPick | null;
  /**
   * Takes `value` as dropdown `id`'s pick, replacing an earlier one.
   *
   * @returns The pick, to hand to {@link PendingPicks.settle} once its write settles.
   */
  readonly pick: (id: string, value: string) => PendingPick;
  /** Drops `pick` once its write settles, unless a later pick on the same dropdown replaced it. */
  readonly settle: (id: string, pick: PendingPick) => void;
  /**
   * Calls `listener` whenever any dropdown's pick changes.
   *
   * @returns Unsubscribes.
   */
  readonly subscribe: (listener: () => void) => () => void;
};

/** An empty {@link PendingPicks}. */
export function createPendingPicks(): PendingPicks {
  const picks = new Map<string, PendingPick>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    get: (id) => picks.get(id) ?? null,
    pick: (id, value) => {
      // A fresh object per pick, so a settle can tell its own pick from a later one of the same value.
      const pick = { value };
      picks.set(id, pick);
      notify();
      return pick;
    },
    settle: (id, pick) => {
      if (picks.get(id) !== pick) return;
      picks.delete(id);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** What a dropdown shows: its pending pick, else `selected`, the snapshot's value. */
export function shownValue(pending: PendingPick | null, selected: string): string {
  return pending === null ? selected : pending.value;
}
