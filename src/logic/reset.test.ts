import { describe, expect, it } from "vitest";
import { resetPrompt } from "./reset";
import type { ProfileLine } from "./view";

const GLOBAL: ProfileLine = { kind: "global" };
const BALATRO: ProfileLine = { kind: "game", appid: 2379780, name: "Balatro" };

describe("resetPrompt", () => {
  it.each<[ProfileLine, string]>([
    [GLOBAL, "Are you sure you want to reset the global profile to the default settings?"],
    [BALATRO, "Are you sure you want to reset the Balatro profile to the default settings?"],
  ])("asks about the whole profile in use", (line, question) => {
    expect(resetPrompt(line, "all")).toEqual({ title: "Reset to defaults?", question });
  });

  it.each<[ProfileLine, "left" | "right", string, string]>([
    [GLOBAL, "left", "Reset left pad?", "the left pad of the global profile"],
    [BALATRO, "right", "Reset right pad?", "the right pad of the Balatro profile"],
  ])("asks about one pad of the profile in use", (line, side, title, what) => {
    expect(resetPrompt(line, side)).toEqual({
      title,
      question: `Are you sure you want to reset ${what} to the default settings?`,
    });
  });
});
