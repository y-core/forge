import { describe, expect, it } from "bun:test";

import { programmaticStop, removeRehomingFocus } from "./dismiss";
import { fakeTree } from "./dom.fixture";

/** A panel holding a button, beside a sibling that can take focus after the panel goes. */
function tree() {
  const { doc, el } = fakeTree();
  const panel = el("DIV", { id: "panel" });
  const inside = el("BUTTON", { id: "inside" });
  const elsewhere = el("BUTTON", { id: "elsewhere" });
  panel.append(inside);
  doc.root.append(panel, elsewhere);
  return { doc, panel, inside, elsewhere };
}

describe("removeRehomingFocus", () => {
  it("removes the element and focuses what the rehome names, when the element held focus", () => {
    const { doc, panel, inside, elsewhere } = tree();
    inside.focus();

    removeRehomingFocus(panel as never, () => elsewhere as never);

    expect({ removed: doc.root.querySelector("#panel"), focused: doc.activeElement?.id }).toEqual({ removed: null, focused: "elsewhere" });
  });

  it("never asks for a rehome when focus was somewhere else entirely", () => {
    const { doc, panel, elsewhere } = tree();
    elsewhere.focus();
    let asked = false;

    removeRehomingFocus(panel as never, () => {
      asked = true;
      return null;
    });

    expect({ asked, focused: doc.activeElement?.id }).toEqual({ asked: false, focused: "elsewhere" });
  });

  it("still removes the element when the rehome names nothing to focus", () => {
    const { doc, panel, inside } = tree();
    inside.focus();

    removeRehomingFocus(panel as never, () => null);

    expect(doc.root.querySelector("#panel")).toBe(null);
  });
});

describe("programmaticStop", () => {
  it("lets focus in without adding a Tab stop, and answers the element it was given", () => {
    const { panel } = tree();

    const returned = programmaticStop(panel as never);

    expect({ same: returned === (panel as never), tabindex: panel.getAttribute("tabindex") }).toEqual({ same: true, tabindex: "-1" });
  });
});
