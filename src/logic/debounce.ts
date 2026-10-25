/** A trailing-edge debouncer: only the last pushed value is sent. */
export type Debouncer<T> = { push(value: T): void; cancel(): void };

/**
 * Create a debouncer that calls `send` with the last pushed value, `delayMs` after the last push.
 *
 * `cancel` drops a pending value.
 */
export function createDebouncer<T>(delayMs: number, send: (value: T) => void): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    push(value: T): void {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        send(value);
      }, delayMs);
    },
    cancel,
  };
}
