import { describe, expect, it } from "bun:test";

import { LABEL_DEFAULTS, STEP_STATE_LABELS } from "./labels";

// An empty or space-padded default renders `aria-label=""` or a name with a stray edge — an unnamed
// landmark that every downstream assertion on the rendered markup still passes over.
describe("the default label tables", () => {
  it("holds a name in every slot, none of it empty or edged with space", () => {
    for (const value of [...Object.values(LABEL_DEFAULTS), ...Object.values(STEP_STATE_LABELS)]) {
      expect(value).not.toBe("");
      expect(value).toBe(value.trim());
    }
  });

  it("keys alphabetically, so a new site inserts without a judgement call", () => {
    expect(Object.keys(LABEL_DEFAULTS)).toEqual([...Object.keys(LABEL_DEFAULTS)].sort());
  });

  it("names every step state, which is what makes an indexed read total", () => {
    expect(Object.keys(STEP_STATE_LABELS)).toEqual(["complete", "current", "upcoming"]);
  });
});
