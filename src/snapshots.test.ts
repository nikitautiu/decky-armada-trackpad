import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptSnapshot, currentSnapshot, subscribeSnapshot } from "./snapshots";

// Decky's event bus is the boundary. Like Decky, `addEventListener` registers and returns a wrapper of the
// callback, so only that wrapper removes it.
const registered = vi.hoisted(() => new Set<(...args: unknown[]) => unknown>());

vi.mock("@decky/api", () => ({
  addEventListener: (_event: string, listener: (...args: unknown[]) => unknown) => {
    const wrapper = (...args: unknown[]): unknown => listener(...args);
    registered.add(wrapper);
    return wrapper;
  },
  removeEventListener: (_event: string, listener: (...args: unknown[]) => unknown) => {
    registered.delete(listener);
  },
  callable: () => () => new Promise(() => undefined),
}));

afterEach(() => {
  registered.clear();
});

describe("subscribeSnapshot", () => {
  it("leaves no state listener after repeated subscribe and unsubscribe", () => {
    for (let round = 0; round < 3; round += 1) {
      const unsubscribe = subscribeSnapshot(() => undefined);
      expect(registered.size).toBe(1);
      unsubscribe();
    }
    expect(registered.size).toBe(0);
  });

  it("shares one listener between subscribers and removes it after the last one leaves", () => {
    const first = subscribeSnapshot(() => undefined);
    const second = subscribeSnapshot(() => undefined);
    expect(registered.size).toBe(1);
    first();
    expect(registered.size).toBe(1);
    second();
    expect(registered.size).toBe(0);
  });

  it("ignores a second unsubscribe of the same subscriber", () => {
    const first = subscribeSnapshot(() => undefined);
    const second = subscribeSnapshot(() => undefined);
    first();
    first();
    expect(registered.size).toBe(1);
    second();
  });
});

describe("acceptSnapshot with a setting of a shape the panel can't show", () => {
  const withOdd = (key: string) => ({
    connected: true,
    status: {
      mode: "off",
      available: true,
      reason: "",
      device: "retroid-pocket-nova",
      toggle_key: "Insert",
      toggle_chord: "none",
      version: "0.1",
      instance: "1",
      inputplumber_version: "0.62.2",
    },
    settings: { pads: "both", [key]: { apps: {} } },
    defaults: { pads: "both" },
    profile: "global",
    game: null,
    game_profile: false,
    in_game: false,
    default_on: false,
    session_on: null,
    error: null,
    store_warning: null,
  });

  let unsubscribe: () => void = () => undefined;
  let warn = vi.spyOn(console, "warn");

  beforeEach(() => {
    unsubscribe = subscribeSnapshot(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  // Each test uses its own keys: the plugin warns once per key for as long as it is loaded.
  it("takes the snapshot in without the setting", () => {
    acceptSnapshot(withOdd("first_odd"));
    expect(currentSnapshot()).toMatchObject({ kind: "connected", settings: { pads: "both" } });
  });

  it("warns once per key, however many snapshots carry it", () => {
    acceptSnapshot(withOdd("second_odd"));
    acceptSnapshot(withOdd("second_odd"));
    acceptSnapshot(withOdd("third_odd"));
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("second_odd"),
      expect.stringContaining("third_odd"),
    ]);
  });
});

describe("currentSnapshot", () => {
  const OFFLINE = {
    connected: false,
    profile: "global",
    game: null,
    error: "no daemon",
    daemon_issue: null,
  };

  it("is null before any snapshot", () => {
    const unsubscribe = subscribeSnapshot(() => undefined);
    expect(currentSnapshot()).toBeNull();
    unsubscribe();
  });

  it("returns the accepted snapshot, so a remounted panel starts from it", () => {
    const unsubscribe = subscribeSnapshot(() => undefined);
    acceptSnapshot(OFFLINE);
    expect(currentSnapshot()).toEqual({ kind: "offline", profile: "global", game: null, error: "no daemon" });
    unsubscribe();
  });

  it("is null again after the last subscriber leaves", () => {
    const unsubscribe = subscribeSnapshot(() => undefined);
    acceptSnapshot(OFFLINE);
    unsubscribe();
    expect(currentSnapshot()).toBeNull();
  });
});
