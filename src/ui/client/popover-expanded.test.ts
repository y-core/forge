import { describe, expect, it } from "bun:test";
import { mountExpandedState, mountExpandedStates } from "./popover-expanded";
import { FakeEvent, fakeTree } from "./test-dom";

/** A popup with `count` invokers pointing at it, plus one pointing somewhere else. */
function scene(popupId = "p") {
  const { doc, el } = fakeTree();
  const popup = el("DIV", { id: popupId, popover: "auto" });
  const invoker = el("BUTTON", { "aria-controls": popupId, "aria-expanded": "false", id: "invoker" });
  const other = el("BUTTON", { "aria-controls": "elsewhere", "aria-expanded": "false", id: "other" });
  doc.root.append(popup, invoker, other);
  return { doc, popup, invoker, other };
}

const toggle = (state: "open" | "closed") => new FakeEvent("toggle", { newState: state });

describe("mountExpandedState", () => {
  it("flips every invoker naming the popup when it opens, and back when it closes", () => {
    const { popup, invoker } = scene();
    mountExpandedState(popup as never);

    popup.dispatchEvent(toggle("open"));
    expect(invoker.getAttribute("aria-expanded")).toBe("true");

    popup.dispatchEvent(toggle("closed"));
    expect(invoker.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves an invoker naming a different popup alone", () => {
    const { popup, other } = scene();
    mountExpandedState(popup as never);

    popup.dispatchEvent(toggle("open"));

    expect(other.getAttribute("aria-expanded")).toBe("false");
  });

  it("acts on beforetoggle too, so the attribute lands in the click's own event", () => {
    const { popup, invoker } = scene();
    mountExpandedState(popup as never);

    popup.dispatchEvent(new FakeEvent("beforetoggle", { newState: "open" }));

    expect(invoker.getAttribute("aria-expanded")).toBe("true");
  });

  it("does nothing for a popup with no id, which no invoker could name", () => {
    const { doc, el } = fakeTree();
    const popup = el("DIV", { popover: "auto" });
    const invoker = el("BUTTON", { "aria-controls": "", "aria-expanded": "false" });
    doc.root.append(popup, invoker);

    mountExpandedState(popup as never);
    popup.dispatchEvent(toggle("open"));

    expect(invoker.getAttribute("aria-expanded")).toBe("false");
  });

  it("stops writing once disposed", () => {
    const { popup, invoker } = scene();
    mountExpandedState(popup as never)();

    popup.dispatchEvent(toggle("open"));

    expect(invoker.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("mountExpandedStates", () => {
  it("mounts every popover inside the root, and the root itself when it is one", () => {
    const { doc, el } = fakeTree();
    const rail = el("NAV");
    const first = el("DIV", { id: "f1", popover: "auto" });
    const second = el("DIV", { id: "f2", popover: "auto" });
    const a = el("BUTTON", { "aria-controls": "f1", "aria-expanded": "false" });
    const b = el("BUTTON", { "aria-controls": "f2", "aria-expanded": "false" });
    rail.append(a, first, b, second);
    doc.root.append(rail);

    mountExpandedStates(rail as never);
    first.dispatchEvent(toggle("open"));
    second.dispatchEvent(toggle("open"));

    expect([a.getAttribute("aria-expanded"), b.getAttribute("aria-expanded")]).toEqual(["true", "true"]);
  });

  it("skips a root that carries no popover attribute of its own", () => {
    const { doc, el } = fakeTree();
    const rail = el("NAV", { id: "rail" });
    doc.root.append(rail);

    // No throw, and nothing mounted: the disposer is still callable.
    expect(() => mountExpandedStates(rail as never)()).not.toThrow();
  });
});
