import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackGame } from "./game";

// Steam's router is the boundary: outside Steam the real module finds nothing to wrap.
vi.mock("@decky/ui", () => ({ Router: { MainRunningApp: { appid: 2379780, display_name: "Balatro" } } }));

const BALATRO = 2379780;
const POLL_MS = 250;

/** A `SteamUIStore` that runs `appid`. */
const store = (appid = BALATRO): unknown => ({ MainRunningAppID: appid });

/** A `SteamUIStore` whose getter throws, as a renamed or torn-down Steam internal can. */
const throwingStore = (): unknown => ({
  get MainRunningAppID(): never {
    throw new Error("gone");
  },
});

/** A reporter that records every call, in order, and settles as `outcome` says. */
const recorder = (outcome: () => Promise<unknown> = () => Promise.resolve()) => {
  const calls: string[] = [];
  const report = (appid: number, name: string): Promise<unknown> => {
    calls.push(`${appid} ${name}`);
    return outcome();
  };
  return { calls, report };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  globalThis.SteamUIStore = store();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.SteamUIStore = undefined;
});

describe("trackGame reports", () => {
  it("reports the running game on the first tick, and only once while it runs", async () => {
    const { calls, report } = recorder();
    const stop = trackGame(report);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(calls).toEqual([`${BALATRO} Balatro`]);
    stop();
  });

  it("reports the game's exit", async () => {
    const { calls, report } = recorder();
    const stop = trackGame(report);
    await vi.advanceTimersByTimeAsync(0);
    globalThis.SteamUIStore = store(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual([`${BALATRO} Balatro`, "0 "]);
    stop();
  });

  it("retries a report that failed on the next tick", async () => {
    let failures = 1;
    const { calls, report } = recorder(() =>
      failures-- > 0 ? Promise.reject(new Error("not ready")) : Promise.resolve(),
    );
    const stop = trackGame(report);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(calls).toEqual([`${BALATRO} Balatro`, `${BALATRO} Balatro`]);
    stop();
  });

  it("sends one report at a time, then the change seen meanwhile", async () => {
    let release: () => void = () => undefined;
    let held = true;
    const { calls, report } = recorder(() =>
      held ? new Promise((resolve) => (release = () => resolve(undefined))) : Promise.resolve(),
    );
    const stop = trackGame(report);
    globalThis.SteamUIStore = store(0);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls).toEqual([`${BALATRO} Balatro`]);
    held = false;
    release();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual([`${BALATRO} Balatro`, "0 "]);
    stop();
  });

  it("reports nothing on a tick whose Steam getter throws", async () => {
    const { calls, report } = recorder();
    const stop = trackGame(report);
    await vi.advanceTimersByTimeAsync(0);
    globalThis.SteamUIStore = throwingStore();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(calls).toEqual([`${BALATRO} Balatro`]);
    stop();
  });
});

describe("trackGame stop", () => {
  it("stops polling", async () => {
    const { calls, report } = recorder();
    const stop = trackGame(report);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    globalThis.SteamUIStore = store(0);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(calls).toEqual([`${BALATRO} Balatro`]);
  });
});
