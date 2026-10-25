import { describe, expect, it } from "vitest";
import { BACK_GUARD_MS, backGuardLeft } from "./backGuard";

describe("backGuardLeft", () => {
  it("guards for the whole window right after a modal closes", () => {
    expect(backGuardLeft(1000, 1000)).toBe(BACK_GUARD_MS);
  });

  it("guards for what is left of the window", () => {
    expect(backGuardLeft(1000, 1300)).toBe(BACK_GUARD_MS - 300);
  });

  it.each([0, 1])("stops guarding once the window is over (+%i ms)", (past) => {
    expect(backGuardLeft(1000, 1000 + BACK_GUARD_MS + past)).toBe(0);
  });

  it("does not guard when no modal has closed", () => {
    expect(backGuardLeft(null, 1000)).toBe(0);
  });
});
