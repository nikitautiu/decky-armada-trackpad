import { describe, expect, it } from "vitest";
import { ANCHOR_CHOICES, choiceLabel, EDGE_CHOICES } from "./advanced";
import { PAD_HELP } from "./help";
import { PRESETS } from "./presets";
import { padOptions } from "./view";

const topic = (title: string) => PAD_HELP.find((entry) => entry.title === title);

describe("PAD_HELP", () => {
  it("explains presets, anchors and edges, in that order", () => {
    expect(PAD_HELP.map((entry) => entry.title)).toEqual(["Presets", "Start", "Edges"]);
  });

  it("gives each topic a one-line summary", () => {
    for (const entry of PAD_HELP) expect(entry.summary).toMatch(/^[^\n]+\.$/);
  });

  it("names each preset with its anchor and edges, then Off", () => {
    expect(topic("Presets")?.entries.map((entry) => entry.label)).toEqual([
      "Pad (Elastic, Clamp)",
      "Radial (Centered, Clamp)",
      "Swipe (Elastic, Recenter)",
      "Stick (Elastic, Follow)",
      "Off",
    ]);
  });

  it("describes the presets with the pad selector's lines, with Off last", () => {
    const options = padOptions("off");
    const off = options.filter((option) => option.value === "off");
    const presets = options.filter((option) => option.value !== "off");
    expect(topic("Presets")?.entries.map((entry) => entry.description)).toEqual(
      [...presets, ...off].map((option) => option.description),
    );
  });

  it.each(Object.entries(PRESETS))("labels %s from the presets table", (name, { anchor, edges }) => {
    const label = `${choiceLabel(padOptions("off"), name)} (${choiceLabel(ANCHOR_CHOICES, anchor)}, ${choiceLabel(EDGE_CHOICES, edges)})`;
    expect(topic("Presets")?.entries.map((entry) => entry.label)).toContain(label);
  });

  it("uses no em dashes", () => {
    expect(JSON.stringify(PAD_HELP)).not.toContain("\u2014");
  });

  it.each([
    ["Start", ANCHOR_CHOICES],
    ["Edges", EDGE_CHOICES],
  ])("uses the %s dropdown's own lines", (title, choices) => {
    expect(topic(title)?.entries).toEqual(choices.map(({ label, description }) => ({ label, description })));
  });
});
