import { describe, expect, it } from "bun:test";

import { APPEARANCES, PRESENTATION_ATTRS, presentationAttrs, TONES } from "./vocabulary";

describe("presentationAttrs", () => {
  it("emits every axis it was given, and nothing for one it was not", () => {
    expect(presentationAttrs({ tone: "primary", appearance: "soft", size: "md", state: "complete" })).toEqual({
      "data-tone": "primary",
      "data-appearance": "soft",
      "data-size": "md",
      "data-state": "complete",
    });

    expect(presentationAttrs({})).toEqual({});
    expect(presentationAttrs({ tone: "primary" })).toEqual({ "data-tone": "primary" });
  });

  // Unlike the boolean state hooks, these carry a *choice*: an omitted key emits nothing, but a key
  // present with a falsy-looking value still emits, because the value is the whole point.
  it("distinguishes an omitted axis from one whose value is an empty string", () => {
    expect(presentationAttrs({ state: "" })).toEqual({ "data-state": "" });
    expect(presentationAttrs({ state: undefined })).toEqual({});
  });

  it("round-trips every declared tone and appearance", () => {
    expect(TONES.map((tone) => presentationAttrs({ tone })["data-tone"])).toEqual([...TONES]);
    expect(APPEARANCES.map((appearance) => presentationAttrs({ appearance })["data-appearance"])).toEqual([...APPEARANCES]);
  });

  it("writes exactly the attribute names the declaration carries", () => {
    const emitted = Object.keys(presentationAttrs({ tone: "neutral", appearance: "solid", size: "sm", state: "x" }));

    expect(emitted.sort()).toEqual([...Object.values(PRESENTATION_ATTRS)].sort());
  });
});
