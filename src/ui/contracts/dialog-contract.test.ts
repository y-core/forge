import { describe, expect, it } from "bun:test";

import { dialogNameAttrs } from "./dialog-contract";

describe("dialogNameAttrs", () => {
  it("derives the reference from the root's id when the caller named nothing", () => {
    expect(dialogNameAttrs("confirm", {})).toEqual({ "aria-labelledby": "confirm-title" });
  });

  it("takes a caller's own reference instead, so the derived one never competes with it", () => {
    expect(dialogNameAttrs("confirm", { labelledby: "filters-trigger" })).toEqual({ "aria-labelledby": "filters-trigger" });
  });

  it("names a literal label on the root, which `dialog` accepts as an author-supplied name", () => {
    expect(dialogNameAttrs("confirm", { label: "Filters" })).toEqual({ "aria-label": "Filters" });
  });

  it("prefers a reference over a literal, since only the reference tracks text the page already shows", () => {
    expect(dialogNameAttrs("confirm", { label: "Filters", labelledby: "filters-trigger" })).toEqual({ "aria-labelledby": "filters-trigger" });
  });
});
