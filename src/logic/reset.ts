import type { Side } from "./presets";
import type { ProfileLine } from "./view";

/** What a reset covers: the whole profile in use, or one of its pads. */
export type ResetTarget = "all" | Side;

/** The confirmation a reset asks for before it writes anything. */
export type ResetPrompt = { readonly title: string; readonly question: string };

/** The confirmation for resetting `target` of the profile `line` names, such as "the Balatro profile". */
export function resetPrompt(line: ProfileLine, target: ResetTarget): ResetPrompt {
  const profile = `the ${line.kind === "global" ? "global" : line.name} profile`;
  const what = target === "all" ? profile : `the ${target} pad of ${profile}`;
  return {
    title: target === "all" ? "Reset to defaults?" : `Reset ${target} pad?`,
    question: `Are you sure you want to reset ${what} to the default settings?`,
  };
}
