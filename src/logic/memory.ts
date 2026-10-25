/** A value kept outside React, so it outlives the component that shows it. */
export type Memory<T> = {
  readonly get: () => T;
  readonly set: (value: T) => void;
  /** Back to the initial value. */
  readonly reset: () => void;
};

/** A {@link Memory} that starts at `initial`. */
export function createMemory<T>(initial: T): Memory<T> {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
    reset: () => {
      value = initial;
    },
  };
}

/** Whether `memory` holds `value`; if so it is taken, and the memory then holds `null`. */
export function claim<T>(memory: Memory<T | null>, value: T): boolean {
  if (memory.get() !== value) return false;
  memory.set(null);
  return true;
}
