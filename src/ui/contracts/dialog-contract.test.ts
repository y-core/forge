import { describe, expect, it } from "bun:test";

import { dialogAlertAttrs, dialogNameAttrs } from "./dialog-contract";

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

describe("dialogAlertAttrs", () => {
  it("leaves the role and description unset and lets any click dismiss a root that raised neither flag", () => {
    expect(dialogAlertAttrs("confirm", {})).toEqual({ role: undefined, "aria-describedby": undefined, closedby: "any" });
  });

  it("announces an alert as an alertdialog that only an explicit close request dismisses", () => {
    expect(dialogAlertAttrs("confirm", { alert: true })).toEqual({ role: "alertdialog", "aria-describedby": undefined, closedby: "closerequest" });
  });

  it("points the description reference at the `.Description` derived from the root's own id", () => {
    expect(dialogAlertAttrs("confirm", { described: true })).toEqual({
      role: undefined,
      "aria-describedby": "confirm-description",
      closedby: "any",
    });
  });
});
