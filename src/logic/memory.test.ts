import { describe, expect, it } from "vitest";
import { claim, createMemory } from "./memory";

describe("createMemory", () => {
  it("starts with the initial value", () => {
    expect(createMemory("main").get()).toBe("main");
  });

  it("keeps a set value for the next reader, such as a remounted panel", () => {
    const memory = createMemory("main");
    memory.set("advanced");
    expect(memory.get()).toBe("advanced");
  });

  it("returns to the initial value when reset", () => {
    const memory = createMemory("main");
    memory.set("inspect");
    memory.reset();
    expect(memory.get()).toBe("main");
  });
});

describe("claim", () => {
  it("takes a held value once, so focus returns to a dropdown only on the first mount after its list", () => {
    const memory = createMemory<string | null>("right.anchor");
    expect(claim(memory, "right.anchor")).toBe(true);
    expect(memory.get()).toBeNull();
    expect(claim(memory, "right.anchor")).toBe(false);
  });

  it("leaves a value held for another claimant", () => {
    const memory = createMemory<string | null>("right.anchor");
    expect(claim(memory, "left.anchor")).toBe(false);
    expect(memory.get()).toBe("right.anchor");
  });
});
