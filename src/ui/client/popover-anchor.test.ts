import { describe, expect, it } from "bun:test";

import { fakeTree } from "./dom.fixture";
import { axis, clamp, openPopoverAt } from "./popover-anchor";

describe("clamp", () => {
  it("passes a value already inside the range through", () => {
    expect(clamp(50, 8, 392)).toBe(50);
  });

  it("pins to each bound in turn", () => {
    expect(clamp(2, 8, 392)).toBe(8);
    expect(clamp(500, 8, 392)).toBe(392);
  });

  it("resolves an inverted range to its high bound", () => {
    expect(clamp(5, 10, 2)).toBe(2);
  });
});

describe("axis", () => {
  it("leaves a point that fits where it is", () => {
    expect(axis(50, 100, 500, 8, false)).toBe(50);
  });

  it("holds the popup off each viewport edge by the margin", () => {
    expect(axis(2, 100, 500, 8, false)).toBe(8);
    expect(axis(450, 100, 500, 8, false)).toBe(392);
  });

  it("keeps a popup larger than the viewport at the margin, not off the opposite edge", () => {
    // `extent - size - margin` is -208 here; without `Math.max(margin, …)` the clamp's high bound
    // sits below its low one and the panel is placed off screen entirely.
    expect(axis(100, 500, 300, 8, false)).toBe(8);
  });

  it("opens away from the point when the popup would not fit after it", () => {
    expect(axis(450, 100, 500, 8, true)).toBe(350);
  });

  it("declines the flip when there is no room before the point either", () => {
    expect(axis(450, 500, 500, 8, true)).toBe(8);
  });

  it("clamps instead of flipping when flip is off", () => {
    expect(axis(450, 100, 500, 8, false)).toBe(392);
  });
});

// The deferred arm is the only listener this module leaves outside the element, and it sits on the
// document in capture phase — so a disposer that stopped removing it would leak one per right-click.
describe("openPopoverAt — the deferred arm", () => {
  function panel() {
    const { doc, el } = fakeTree();
    const popup = el("DIV", { popover: "auto" });
    doc.root.append(popup);
    return { doc, popup };
  }

  const armed = (doc: { listeners: Map<string, unknown[]> }): number => doc.listeners.get("pointerup")?.length ?? 0;

  it("arms one capture listener on the document when the show is deferred", () => {
    const { doc, popup } = panel();

    openPopoverAt(popup as never, 10, 20, { afterPointerUp: true });

    expect(armed(doc)).toBe(1);
  });

  it("removes that listener when the returned disposer cancels the arm", () => {
    const { doc, popup } = panel();

    openPopoverAt(popup as never, 10, 20, { afterPointerUp: true })();

    expect(armed(doc)).toBe(0);
  });

  it("supersedes an earlier arm rather than stacking a second one on the document", () => {
    const { doc, popup } = panel();

    openPopoverAt(popup as never, 10, 20, { afterPointerUp: true });
    const second = openPopoverAt(popup as never, 30, 40, { afterPointerUp: true });

    expect(armed(doc)).toBe(1);
    second();
    expect(armed(doc)).toBe(0);
  });
});
