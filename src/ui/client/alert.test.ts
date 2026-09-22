import { describe, expect, it } from "bun:test";

import { dismissAlert } from "./alert";
import { fakeTree } from "./dom.fixture";

/** A dismissible alert inside a region, with the dismiss button that holds focus. */
function alert() {
  const { doc, el } = fakeTree();
  const region = el("SECTION", { id: "region" });
  const root = el("DIV", { "data-slot": "alert", id: "alert" });
  const close = el("BUTTON", { "data-slot": "alert-dismiss", id: "close" });
  root.append(close);
  region.append(root);
  doc.root.append(region);
  return { doc, region, root, close };
}

describe("dismissAlert", () => {
  it("removes the alert", () => {
    const { doc, root } = alert();

    dismissAlert(root as never);

    expect(doc.root.querySelector("#alert")).toBe(null);
  });

  it("moves focus to the element that contained it rather than dropping it, and makes that a stop", () => {
    const { doc, region, root, close } = alert();
    close.focus();

    dismissAlert(root as never);

    expect({ focused: doc.activeElement?.id, tabindex: region.getAttribute("tabindex") }).toEqual({ focused: "region", tabindex: "-1" });
  });

  // The rehome exists to keep the reader's route through the page, so it must not spend a stop the
  // page already had: a scroll region or skip-link landing made focusable keeps its own tabindex.
  it("takes no existing tab stop out of the page when the container was already one", () => {
    const { doc, region, root, close } = alert();
    region.setAttribute("tabindex", "0");
    close.focus();

    dismissAlert(root as never);

    expect({ focused: doc.activeElement?.id, tabindex: region.getAttribute("tabindex") }).toEqual({ focused: "region", tabindex: "0" });
  });

  // A page-level alert has no wrapper to land on, and focus falls to `<body>` on the removal anyway
  // — so making `<body>` a stop would leave an attribute behind for no gain the reader can feel.
  it("makes no tab stop of <body> when the alert is parented straight to it", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "alert", id: "alert" });
    const close = el("BUTTON", { "data-slot": "alert-dismiss", id: "close" });
    root.append(close);
    doc.body.append(root);
    close.focus();

    dismissAlert(root as never);

    expect(doc.body.getAttribute("tabindex")).toBe(null);
  });

  it("leaves focus where the user put it when the alert was not holding it", () => {
    const { doc, region, root } = alert();
    region.focus();

    dismissAlert(root as never);

    expect({ focused: doc.activeElement?.id, tabindex: region.getAttribute("tabindex") }).toEqual({ focused: "region", tabindex: null });
  });
});
