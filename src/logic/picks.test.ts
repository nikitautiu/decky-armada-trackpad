import { describe, expect, it, vi } from "vitest";
import { createPendingPicks, shownValue } from "./picks";

describe("shownValue", () => {
  it("shows the snapshot's value when no pick is pending", () => {
    expect(shownValue(null, "swipe")).toBe("swipe");
  });

  it("shows a pending pick instead of the snapshot's value", () => {
    const picks = createPendingPicks();
    picks.pick("pad.right", "stick");
    expect(shownValue(picks.get("pad.right"), "swipe")).toBe("stick");
  });
});

describe("createPendingPicks", () => {
  it("holds nothing for a dropdown never picked", () => {
    expect(createPendingPicks().get("pad.right")).toBeNull();
  });

  it("clears a pick when its write settles", () => {
    const picks = createPendingPicks();
    const pick = picks.pick("pad.right", "stick");
    picks.settle("pad.right", pick);
    expect(picks.get("pad.right")).toBeNull();
  });

  it("keeps a later pick when an earlier pick's write settles", () => {
    const picks = createPendingPicks();
    const earlier = picks.pick("pad.right", "stick");
    picks.pick("pad.right", "pad");
    picks.settle("pad.right", earlier);
    expect(picks.get("pad.right")?.value).toBe("pad");
  });

  it("keeps each dropdown's pick apart", () => {
    const picks = createPendingPicks();
    const right = picks.pick("pad.right", "stick");
    picks.pick("pad.left", "off");
    picks.settle("pad.right", right);
    expect(picks.get("pad.right")).toBeNull();
    expect(picks.get("pad.left")?.value).toBe("off");
  });

  it("tells listeners about a pick and its settle, so a remounted dropdown shows both", () => {
    const picks = createPendingPicks();
    const seen: (string | null)[] = [];
    picks.subscribe(() => seen.push(picks.get("pad.right")?.value ?? null));
    const pick = picks.pick("pad.right", "stick");
    picks.settle("pad.right", pick);
    expect(seen).toEqual(["stick", null]);
  });

  it("does not tell listeners about a superseded pick's settle, which changes nothing", () => {
    const picks = createPendingPicks();
    const earlier = picks.pick("pad.right", "stick");
    picks.pick("pad.right", "pad");
    const listener = vi.fn();
    picks.subscribe(listener);
    picks.settle("pad.right", earlier);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling a listener once it unsubscribes", () => {
    const picks = createPendingPicks();
    const listener = vi.fn();
    const unsubscribe = picks.subscribe(listener);
    unsubscribe();
    picks.pick("pad.right", "stick");
    expect(listener).not.toHaveBeenCalled();
  });
});
