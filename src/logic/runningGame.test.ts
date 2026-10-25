import { describe, expect, it } from "vitest";
import { gameReport, type RunningGame, readRunningGame } from "./runningGame";

const BALATRO = 2379780;
const NO_GAME: RunningGame = { appid: 0, name: "" };

const running = (extra: Partial<RunningGame> = {}): RunningGame => ({ appid: BALATRO, name: "Balatro", ...extra });

/** A fake `SteamUIStore` with the one field the running game is read from. */
const store = (appid: unknown): unknown => ({ MainRunningAppID: appid });

describe("readRunningGame", () => {
  it("reads the running game and its name", () => {
    const app = { appid: String(BALATRO), display_name: "Balatro" };
    expect(readRunningGame(store(BALATRO), app)).toEqual(running());
  });

  it("reports no game when Steam runs none", () => {
    expect(readRunningGame(store(0), undefined)).toEqual(NO_GAME);
  });

  it("falls back to the main running app for the app id", () => {
    expect(readRunningGame(undefined, { appid: BALATRO, display_name: "Balatro" })).toEqual(running());
  });

  it("leaves the name empty when the main running app is another game", () => {
    expect(readRunningGame(store(BALATRO), { appid: 10, display_name: "Other" })).toEqual(running({ name: "" }));
  });

  it("cuts a name longer than the backend accepts", () => {
    const app = { appid: BALATRO, display_name: "x".repeat(200) };
    expect(readRunningGame(store(BALATRO), app).name).toBe("x".repeat(128));
  });

  it.each<[string, unknown]>([
    ["negative", -1],
    ["fractional", 1.5],
    ["too large", 2 ** 32],
    ["not a number", "abc"],
  ])("treats a %s app id as no game", (_case, appid) => {
    expect(readRunningGame(store(appid), undefined).appid).toBe(0);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a number", 42],
    ["an empty object", {}],
  ])("reads no game from a store that is %s", (_case, value) => {
    expect(readRunningGame(value, null)).toEqual(NO_GAME);
  });
});

describe("gameReport", () => {
  it("reports the game when nothing was taken in yet", () => {
    expect(gameReport(null, running())).toEqual(running());
  });

  it("reports nothing when the backend already holds the game", () => {
    expect(gameReport(running(), running())).toBeNull();
  });

  it.each<[string, RunningGame]>([
    ["the game exits", NO_GAME],
    ["another game starts", running({ appid: 10, name: "Other" })],
    ["the name arrives later", running()],
  ])("reports the game again when %s", (_case, reading) => {
    expect(gameReport(running({ name: "" }), reading)).toEqual(reading);
  });

  it.each<[string, RunningGame | null]>([
    ["nothing was taken in yet", null],
    ["a game was taken in", running()],
  ])("reports nothing on an unreadable tick when %s", (_case, reported) => {
    expect(gameReport(reported, null)).toBeNull();
  });
});
