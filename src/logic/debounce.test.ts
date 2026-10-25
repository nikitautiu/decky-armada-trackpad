import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "./debounce";

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends only the last of three pushes, 250 ms after the last", () => {
    const send = vi.fn();
    const debouncer = createDebouncer<number>(250, send);
    debouncer.push(1);
    vi.advanceTimersByTime(120);
    debouncer.push(2);
    vi.advanceTimersByTime(80);
    debouncer.push(3);
    vi.advanceTimersByTime(249);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(3);
  });

  it("drops a pending value on cancel", () => {
    const send = vi.fn();
    const debouncer = createDebouncer<string>(100, send);
    debouncer.push("a");
    debouncer.cancel();
    vi.advanceTimersByTime(500);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends again after a quiet period", () => {
    const send = vi.fn();
    const debouncer = createDebouncer<number>(100, send);
    debouncer.push(1);
    vi.advanceTimersByTime(100);
    debouncer.push(2);
    vi.advanceTimersByTime(100);
    expect(send.mock.calls).toEqual([[1], [2]]);
  });
});
