import { describe, expect, it } from "vitest";
import { failureText } from "./failure";

describe("failureText", () => {
  it("shows an Error's name and message", () => {
    expect(failureText(new TypeError("x is undefined"))).toBe("TypeError: x is undefined");
  });

  it("shows an Error without a message by its name", () => {
    expect(failureText(new RangeError())).toBe("RangeError");
  });

  it.each<[string, unknown, string]>([
    ["a string", "bad state", "bad state"],
    ["a number", 42, "42"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
  ])("shows a thrown %s as text", (_case, thrown, text) => {
    expect(failureText(thrown)).toBe(text);
  });
});
