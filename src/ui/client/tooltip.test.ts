import { describe, expect, it } from "bun:test";

import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { mountTooltip } from "./tooltip";

function tooltip(reference: Record<string, string> = { "aria-describedby": "tip" }) {
  const { doc, el } = fakeTree();
  const root = el("DIV", { "data-slot": "tooltip" });
  const trigger = el("BUTTON", { "data-slot": "tooltip-trigger", ...reference }) as FakeElement & { matches: (selector: string) => boolean };
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

  it("shows in either kind, whichever ARIA reference the trigger carries", () => {
    const kinds = [
      { kind: "description", reference: { "aria-describedby": "tip" } },
      { kind: "label", reference: { "aria-labelledby": "tip" } },
    ];

    const actual = kinds.map(({ kind, reference }) => {
      const { root, trigger, content, win } = tooltip(reference);
      mountTooltip(root as never);
      pointer(trigger, "pointerenter");
      win.flush();
      return { kind, mounted: root.hasAttribute("data-tooltip-mounted"), calls: content.calls };
    });

    expect(actual).toEqual(kinds.map(({ kind }) => ({ kind, mounted: true, calls: ["show"] })));
  });

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

  it("arms no timer for any pointer event on the trigger or the content once disposed", () => {
    const { root, trigger, content, win } = tooltip();
    mountTooltip(root as never)();

    pointer(trigger, "pointerenter");
    pointer(trigger, "pointerdown", "touch");
    pointer(trigger, "pointerleave");
    pointer(content, "pointerenter");
    pointer(content, "pointerleave");
    const armed = win.timers.size;
    win.flush();

    expect({ armed, calls: content.calls }).toEqual({ armed: 0, calls: [] });
  });

  it("clears an armed show timer on dispose, so a pending tooltip never opens", () => {
    const { root, trigger, content, win } = tooltip();
    const dispose = mountTooltip(root as never);

    pointer(trigger, "pointerenter");
    expect(win.timers.size).toBe(1);
    dispose();
    win.flush();

    expect({ pending: win.timers.size, calls: content.calls }).toEqual({ pending: 0, calls: [] });
  });

  it("removes every listener it put on the trigger and the content", () => {
    const { root, trigger, content } = tooltip();

    mountTooltip(root as never)();

    const counts = (el: FakeElement) => [...el.listeners.values()].reduce((total, list) => total + list.length, 0);
    expect({ trigger: counts(trigger), content: counts(content) }).toEqual({ trigger: 0, content: 0 });
  });

  it("does nothing at all when the root holds no content", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "tooltip" });
    root.append(el("BUTTON", { "data-slot": "tooltip-trigger" }));
    doc.root.append(root);

    expect(() => mountTooltip(root as never)()).not.toThrow();
    expect(root.hasAttribute("data-tooltip-mounted")).toBe(false);
  });
});

describe("mountTooltip — the warm window", () => {
  /** Two mounted tooltips on one fresh window, whose popover calls fire `toggle` as the platform's do. */
  function pair() {
    const { doc, el } = fakeTree();
    const tip = (id: string) => {
      const root = el("DIV", { "data-slot": "tooltip" });
      const trigger = el("BUTTON", { "data-slot": "tooltip-trigger", "aria-describedby": id });
      const content = el("DIV", { "data-slot": "tooltip-content", id }) as FakeElement & {
        instantAtHide: boolean[];
        open: boolean;
        showPopover: () => void;
        hidePopover: () => void;
      };
      content.instantAtHide = [];
      content.open = false;
      const real = content.matches.bind(content);
      content.matches = (selector: string) => (selector === ":popover-open" ? content.open : real(selector));
      content.showPopover = () => {
        content.open = true;
        content.dispatchEvent(new FakeEvent("toggle", { newState: "open" }));
      };
      content.hidePopover = () => {
        content.instantAtHide.push(content.hasAttribute("data-instant"));
        content.open = false;
        content.dispatchEvent(new FakeEvent("toggle", { newState: "closed" }));
      };
      root.append(trigger, content);
      doc.root.append(root);
      const detach = () => {
        root.remove();
        content.open = false;
      };
      const disconnect = () => root.remove();
      return { trigger, content, detach, disconnect, dispose: mountTooltip(root as never) };
    };
    const win = doc.defaultView;
    const lastDelay = () => [...win.delays.values()].at(-1);
    return { win, a: tip("a"), b: tip("b"), lastDelay };
  }

  function openThenClose({ win, a }: ReturnType<typeof pair>): void {
    pointer(a.trigger, "pointerenter");
    win.advance(400);
    pointer(a.trigger, "pointerleave");
    win.advance(100);
  }

  it("opens the next tip at once, marked data-instant, inside the window after one closes", () => {
    const tips = pair();
    openThenClose(tips);

    tips.win.advance(299);
    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 0, instant: true });
  });

  it("waits the full delay, unmarked, once the window has cooled", () => {
    const tips = pair();
    openThenClose(tips);

    tips.win.advance(300);
    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 400, instant: false });
  });

  it("opens at once while another tip is still open", () => {
    const tips = pair();
    pointer(tips.a.trigger, "pointerenter");
    tips.win.advance(400);

    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 0, instant: true });
  });

  it("clears the marker before hiding, so an instant tip still fades out", () => {
    const tips = pair();
    openThenClose(tips);
    pointer(tips.b.trigger, "pointerenter");
    tips.win.advance(0);

    pointer(tips.b.trigger, "pointerleave");
    tips.win.advance(100);

    expect({ atHide: tips.b.content.instantAtHide, after: tips.b.content.hasAttribute("data-instant") }).toEqual({ atHide: [false], after: false });
  });

  it("ends the window when the tip that armed it is disposed", () => {
    const tips = pair();
    openThenClose(tips);

    tips.a.dispose();
    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 400, instant: false });
  });

  it("waits the full delay after a showing tip is removed, which the platform hides without a toggle", () => {
    const tips = pair();
    pointer(tips.a.trigger, "pointerenter");
    tips.win.advance(400);

    tips.a.detach();
    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 400, instant: false });
  });

  it("waits the full delay after a showing tip leaves the document, even while it still matches :popover-open", () => {
    const tips = pair();
    pointer(tips.a.trigger, "pointerenter");
    tips.win.advance(400);

    tips.a.disconnect();
    pointer(tips.b.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.b.content.hasAttribute("data-instant") }).toEqual({ delay: 400, instant: false });
  });

  it("starts cold on a fresh window", () => {
    const tips = pair();

    pointer(tips.a.trigger, "pointerenter");

    expect({ delay: tips.lastDelay(), instant: tips.a.content.hasAttribute("data-instant") }).toEqual({ delay: 400, instant: false });
  });
});
