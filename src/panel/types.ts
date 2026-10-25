import type { SettingValue } from "../logic/wire";

/** Sends a callable and takes its returned snapshot in; never rejects. */
export type Run = (call: Promise<unknown>) => Promise<void>;

/** Settings to write, by wire key. */
export type Changes = Readonly<Record<string, SettingValue>>;

/** Writes `changes` to the profile the panel showed when the user made the edit. */
export type Change = (changes: Changes) => Promise<void>;
