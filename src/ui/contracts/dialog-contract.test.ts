import { describe, expect, it } from "bun:test";

import { dialogNameAttrs } from "./dialog-contract";

describe("dialogNameAttrs", () => {
  it("derives the reference from the root's id on the caller's `titled` assertion", () => {
    expect(dialogNameAttrs("confirm", { titled: true })).toEqual({ "aria-labelledby": "confirm-title" });
  });

  it("names nothing at all where the caller asserted nothing, rather than an IDREF that resolves to nothing", () => {
    expect(dialogNameAttrs("confirm", {})).toEqual({});
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
