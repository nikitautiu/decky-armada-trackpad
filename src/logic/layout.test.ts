import { describe, expect, it } from "vitest";
import { peerSeparator, type Separator } from "./layout";

describe("peerSeparator", () => {
  it.each<[number, number, Separator]>([
    [0, 3, "standard"],
    [1, 3, "standard"],
    [2, 3, "none"],
    [0, 1, "none"],
  ])("puts a thin line under row %s of %s peers only when another follows", (index, count, expected) => {
    expect(peerSeparator(index, count)).toBe(expected);
  });

  it("ends the last row with the given line, such as a section break", () => {
    expect(peerSeparator(2, 3, "thick")).toBe("thick");
  });

  it("keeps thin lines between the rows when the last one ends a section", () => {
    expect(peerSeparator(1, 3, "thick")).toBe("standard");
  });
});
