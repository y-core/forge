import { describe, expect, it } from "bun:test";
import { type FakeElement, FakeEvent, fakeTree } from "./test-dom";
import { mountTooltip } from "./tooltip";

/** A tooltip whose content records show/hide calls, since a fake has no top layer. */
function tooltip() {
  const { doc, el } = fakeTree();
  const root = el("DIV", { "data-slot": "tooltip" });
  const trigger = el("BUTTON", { "data-slot": "tooltip-trigger", "aria-describedby": "tip" }) as FakeElement & {
    matches: (selector: string) => boolean;
  };
  const content = el("DIV", { "data-slot": "tooltip-content", id: "tip" }) as FakeElement & {
    calls: string[];
    showPopover: () => void;
    hidePopover: () => void;
  };
  content.calls = [];
  content.showPopover = () => content.calls.push("show");
  content.hidePopover = () => content.calls.push("hide");
  root.append(trigger, content);
  doc.root.append(root);
  return { doc, win: doc.defaultView, root, trigger, content };
}

const pointer = (el: FakeElement, type: string, pointerType = "mouse") => el.dispatchEvent(new FakeEvent(type, { pointerType }));

describe("mountTooltip", () => {
  it("stamps the mounted marker, which is what retires the CSS-only fallback", () => {
    const { root } = tooltip();

    mountTooltip(root as never);

    expect(root.hasAttribute("data-tooltip-mounted")).toBe(true);
  });

  it("clears the marker on dispose, so the no-script fallback returns", () => {
    const { root } = tooltip();

    mountTooltip(root as never)();

    expect(root.hasAttribute("data-tooltip-mounted")).toBe(false);
  });

  it("shows after the delay when the pointer enters the trigger", () => {
    const { root, trigger, content, win } = tooltip();
    mountTooltip(root as never);

    pointer(trigger, "pointerenter");
    expect(content.calls).toEqual([]);

    win.flush();
    expect(content.calls).toEqual(["show"]);
  });

  // WCAG 2.1 SC 1.4.13: entering the content must cancel the hide the trigger's leave armed.
  it("stays open when the pointer travels from the trigger onto the content", () => {
    const { root, trigger, content, win } = tooltip();
    mountTooltip(root as never);

    pointer(trigger, "pointerenter");
    win.flush();
    content.calls.length = 0;

    pointer(trigger, "pointerleave");
    pointer(content, "pointerenter");
    win.flush();

    expect(content.calls).toEqual(["show"]);
  });

  it("hides when the pointer leaves the content too", () => {
    const { root, content, win } = tooltip();
    mountTooltip(root as never);

    pointer(content, "pointerleave");
    win.flush();

    expect(content.calls).toEqual(["hide"]);
  });

  it("ignores a touch pointerleave, which fires as the finger lifts from the tap that opened it", () => {
    const { root, trigger, content, win } = tooltip();
    mountTooltip(root as never);

    pointer(trigger, "pointerdown", "touch");
    win.flush();
    expect(content.calls).toEqual(["show"]);

    pointer(trigger, "pointerleave", "touch");
    win.flush();

    expect(content.calls).toEqual(["show"]);
  });

  it("shows on keyboard focus, and only when the focus is visible", () => {
    const { root, trigger, content, win } = tooltip();
    // Additive, not a replacement: the mount finds the trigger through `matches` too, so a wholesale
    // override would leave the controller with nothing to bind to.
    const real = trigger.matches.bind(trigger);
    trigger.matches = (selector: string) => (selector === ":focus-visible" ? true : real(selector));
    mountTooltip(root as never);

    trigger.dispatchEvent(new FakeEvent("focusin"));
    win.flush();

    expect(content.calls).toEqual(["show"]);
  });

  it("does not show for a mouse click that focuses without :focus-visible", () => {
    const { root, trigger, content, win } = tooltip();
    const real = trigger.matches.bind(trigger);
    trigger.matches = (selector: string) => (selector === ":focus-visible" ? false : real(selector));
    mountTooltip(root as never);

    trigger.dispatchEvent(new FakeEvent("focusin"));
    win.flush();

    expect(content.calls).toEqual([]);
  });

  it("stops listening once disposed", () => {
    const { root, trigger, content, win } = tooltip();
    mountTooltip(root as never)();

    pointer(trigger, "pointerenter");
    win.flush();

    expect(content.calls).toEqual([]);
  });

  it("does nothing at all when aria-describedby resolves to no content", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "tooltip" });
    root.append(el("BUTTON", { "data-slot": "tooltip-trigger", "aria-describedby": "missing" }));
    doc.root.append(root);

    expect(() => mountTooltip(root as never)()).not.toThrow();
    expect(root.hasAttribute("data-tooltip-mounted")).toBe(false);
  });
});
