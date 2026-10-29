import { describe, expect, it } from "bun:test";

import { APPEARANCES, PRESENTATION_ATTRS, presentationAttrs, TONES } from "./vocabulary";

describe("presentationAttrs", () => {
  it("emits every axis it was given, and nothing for one it was not", () => {
    expect(presentationAttrs({ tone: "primary", appearance: "soft", size: "md" })).toEqual({
      "data-tone": "primary",
      "data-appearance": "soft",
      "data-size": "md",
    });

    expect(presentationAttrs({})).toEqual({});
    expect(presentationAttrs({ tone: "primary" })).toEqual({ "data-tone": "primary" });
  });

  it("round-trips every declared tone and appearance", () => {
    expect(TONES.map((tone) => presentationAttrs({ tone })["data-tone"])).toEqual([...TONES]);
    expect(APPEARANCES.map((appearance) => presentationAttrs({ appearance })["data-appearance"])).toEqual([...APPEARANCES]);
  });

  it("writes exactly the attribute names the declaration carries", () => {
    const emitted = Object.keys(presentationAttrs({ tone: "neutral", appearance: "solid", size: "sm" }));

    expect(emitted.sort()).toEqual([...Object.values(PRESENTATION_ATTRS)].sort());
  });
});
