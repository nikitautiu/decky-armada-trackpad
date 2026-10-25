import { describe, expect, it, vi } from "vitest";
import { parseCommandResult, parseUnit, parseSnapshot as parseWith } from "./wire";

/** Parse with the dropped-setting reports ignored. */
const parseSnapshot = (payload: unknown) => parseWith(payload, () => undefined);

const STATUS = {
  mode: "on",
  available: true,
  reason: "",
  device: "retroid-pocket-nova",
  toggle_key: "Insert",
  toggle_chord: "l1+l3+r1+r3",
  version: "0.1",
  instance: "4eea7756e9346454",
  inputplumber_version: "0.62.2",
};

const PAYLOAD = {
  connected: true,
  status: STATUS,
  settings: { pads: "both", size: 1.0, "left.anchor": null, edges: ["clamp", "clamp", "clamp", "clamp"], tap: true },
  defaults: { pads: "both", size: 1.0, panel_mm: [91.0, 68.0] },
  profile: "game:2379780",
  game: { appid: 2379780, name: "Balatro" },
  game_profile: true,
  in_game: true,
  default_on: false,
  session_on: true,
  error: null,
  store_warning: "slow disk",
};

describe("parseSnapshot", () => {
  it("maps the connected payload to the camelCase type", () => {
    expect(parseSnapshot(PAYLOAD)).toEqual({
      kind: "connected",
      status: {
        mode: "on",
        available: true,
        reason: "",
        device: "retroid-pocket-nova",
        toggle_key: "Insert",
        toggle_chord: "l1+l3+r1+r3",
        version: "0.1",
        instance: "4eea7756e9346454",
        inputplumber_version: "0.62.2",
      },
      settings: PAYLOAD.settings,
      defaults: PAYLOAD.defaults,
      profile: "game:2379780",
      game: { appid: 2379780, name: "Balatro" },
      gameProfile: true,
      inGame: true,
      defaultOn: false,
      sessionOn: true,
      error: null,
      storeWarning: "slow disk",
    });
  });

  const DISCONNECTED = { connected: false, profile: "global", game: null, error: null };

  it("maps a disconnected payload without a daemon issue to offline", () => {
    const payload = { ...DISCONNECTED, error: "no daemon", daemon_issue: null };
    expect(parseSnapshot(payload)).toEqual({ kind: "offline", profile: "global", game: null, error: "no daemon" });
  });

  it("rejects a disconnected payload without daemon_issue", () => {
    expect(parseSnapshot(DISCONNECTED)).toBeNull();
  });

  it.each([
    ["update_daemon", "daemon"],
    ["update_plugin", "plugin"],
  ])("maps a daemon issue %s to incompatible, naming the side to update", (kind, update) => {
    const payload = { ...DISCONNECTED, daemon_issue: { kind, version: "0.1.0" } };
    expect(parseSnapshot(payload)).toEqual({ kind: "incompatible", update, daemonVersion: "0.1.0" });
  });

  it("maps an unsupported device to unsupported, with the daemon's reason", () => {
    const issue = { kind: "unsupported_device", version: "0.2.0", reason: "device not supported: AYN Odin 2" };
    expect(parseSnapshot({ ...DISCONNECTED, daemon_issue: issue })).toEqual({
      kind: "unsupported",
      daemonVersion: "0.2.0",
      reason: "device not supported: AYN Odin 2",
    });
  });

  it.each([
    ["an unknown kind", { kind: "update_both", version: "0.1.0" }],
    ["an unsupported device without a reason", { kind: "unsupported_device", version: "0.2.0" }],
    ["no version", { kind: "update_daemon" }],
    ["a version that is not a string", { kind: "update_daemon", version: 1 }],
  ])("rejects a daemon issue with %s", (_case, issue) => {
    expect(parseSnapshot({ ...DISCONNECTED, daemon_issue: issue })).toBeNull();
  });

  it("accepts a null inputplumber_version", () => {
    const snapshot = parseSnapshot({ ...PAYLOAD, status: { ...STATUS, inputplumber_version: null } });
    expect(snapshot).toMatchObject({ kind: "connected", status: { inputplumber_version: null } });
  });

  it("keeps the daemon's reason for an unsupported device as it is", () => {
    const status = { ...STATUS, available: false, reason: "device not supported: AYN Odin 2" };
    const snapshot = parseSnapshot({ ...PAYLOAD, status });
    expect(snapshot).toMatchObject({ kind: "connected", status: { reason: "device not supported: AYN Odin 2" } });
  });

  it("takes the game's state from session_on, not the live mode", () => {
    const snapshot = parseSnapshot({ ...PAYLOAD, status: { ...STATUS, mode: "off" }, session_on: true });
    expect(snapshot).toMatchObject({ kind: "connected", sessionOn: true });
  });

  it("reads a null session_on as no running game, keeping the default", () => {
    const snapshot = parseSnapshot({ ...PAYLOAD, game: null, default_on: true, session_on: null });
    expect(snapshot).toMatchObject({ kind: "connected", game: null, defaultOn: true, sessionOn: null });
  });

  it.each([
    ["an empty object", {}],
    ["a non-object", "state"],
    ["null", null],
    ["connected as a string", { ...PAYLOAD, connected: "yes" }],
    ["settings that are not an object", { ...PAYLOAD, settings: ["pads"] }],
    ["null defaults while connected", { ...PAYLOAD, defaults: null }],
    ["a null status while connected", { ...PAYLOAD, status: null }],
    ["a status missing a field", { ...PAYLOAD, status: { ...STATUS, mode: undefined } }],
    ["a status field of the wrong type", { ...PAYLOAD, status: { ...STATUS, available: "yes" } }],
    ["a status without device", { ...PAYLOAD, status: { ...STATUS, device: undefined } }],
    ["a status without inputplumber_version", { ...PAYLOAD, status: { ...STATUS, inputplumber_version: undefined } }],
    ["a numeric inputplumber_version", { ...PAYLOAD, status: { ...STATUS, inputplumber_version: 62 } }],
    ["a malformed game", { ...PAYLOAD, game: { appid: "x", name: "Balatro" } }],
    ["default_on of the wrong type", { ...PAYLOAD, default_on: "no" }],
    ["a null default_on", { ...PAYLOAD, default_on: null }],
    ["session_on of the wrong type", { ...PAYLOAD, session_on: 1 }],
    ["a missing session_on", { ...PAYLOAD, session_on: undefined }],
    ["a missing profile", { ...PAYLOAD, profile: undefined }],
  ])("returns null for %s", (_label, payload) => {
    expect(parseSnapshot(payload)).toBeNull();
  });

  it("allows panel_mm as a list of numbers", () => {
    const snapshot = parseSnapshot(PAYLOAD);
    expect(snapshot?.kind === "connected" && snapshot.defaults.panel_mm).toEqual([91, 68]);
  });
});

describe("parseSnapshot with a setting of a shape the panel can't show", () => {
  const FOCUS_MODES = { apps: { "769": "off" }, default: "keep" };

  it.each<[string, unknown]>([
    ["an object", FOCUS_MODES],
    ["a mixed list", ["clamp", 1]],
    ["a list of lists", [[1]]],
  ])("leaves out a setting holding %s and keeps the rest", (_case, value) => {
    const snapshot = parseSnapshot({ ...PAYLOAD, settings: { ...PAYLOAD.settings, odd: value } });
    expect(snapshot).toMatchObject({ kind: "connected", settings: PAYLOAD.settings });
    expect(snapshot?.kind === "connected" && "odd" in snapshot.settings).toBe(false);
  });

  it("names each left-out key, in settings and in defaults", () => {
    const dropped = vi.fn();
    parseWith(
      { ...PAYLOAD, settings: { ...PAYLOAD.settings, focus_modes: FOCUS_MODES }, defaults: { odd: {} } },
      dropped,
    );
    expect(dropped.mock.calls).toEqual([["focus_modes"], ["odd"]]);
  });
});

describe("parseCommandResult", () => {
  it("reads ok and the output", () => {
    expect(parseCommandResult({ ok: false, output: "Failed to start" })).toEqual({
      ok: false,
      output: "Failed to start",
    });
  });

  it("cuts the output at the backend's 16 KiB cap", () => {
    expect(parseCommandResult({ ok: true, output: "x".repeat(20000) })?.output).toHaveLength(16 * 1024);
  });

  it.each<[string, unknown]>([
    ["not an object", "ok"],
    ["missing ok", { output: "" }],
    ["a non-string output", { ok: true, output: 3 }],
  ])("is null for a payload that is %s", (_case, payload) => {
    expect(parseCommandResult(payload)).toBeNull();
  });
});

describe("parseUnit", () => {
  it.each([true, false, null])("reads installed %s", (installed) => {
    expect(parseUnit({ installed })).toBe(installed);
  });

  it.each([{}, { installed: "yes" }, null, "installed"])("reads %j as unknown", (value) => {
    expect(parseUnit(value)).toBeNull();
  });
});
