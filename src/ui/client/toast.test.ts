import { describe, expect, it } from "bun:test";

import { ANNOUNCER_REGION_SLOTS } from "../contracts/announcer-contract";
import { announce } from "./announce";
import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { dismissToast, mountToastAnnouncements, scheduleToastDismissal } from "./toast";

/** A container holding `count` toasts, each with a dismiss button, plus the focus helpers. */
function container(count: number) {
  const { doc, el } = fakeTree();
  const region = el("SECTION", { "data-slot": "toast-container" });
  doc.root.append(region);

  const toasts = Array.from({ length: count }, (_, i) => {
    const toast = el("DIV", { "data-slot": "toast", id: `t${i}` });
    toast.append(el("BUTTON", { "data-slot": "toast-close", id: `close${i}` }));
    region.append(toast);
    return toast;
  });

  return { doc, region, toasts, close: (i: number) => toasts[i]?.querySelector("[data-slot~='toast-close']") ?? null };
}

describe("dismissToast", () => {
  it("removes the toast", () => {
    const { region, toasts } = container(2);

    dismissToast(toasts[0] as never);

    expect(region.children.map((child) => child.id)).toEqual(["t1"]);
  });

  it("moves focus to a surviving toast's dismiss button when the removed one held it", () => {
    const { doc, toasts, close } = container(2);
    close(0)?.focus();

    dismissToast(toasts[0] as never);

    expect(doc.activeElement?.id).toBe("close1");
  });

  it("falls back to the region itself, made focusable, when no toast survives", () => {
    const { doc, region, toasts, close } = container(1);
    close(0)?.focus();

    dismissToast(toasts[0] as never);

    expect(doc.activeElement).toBe(region);
    // Programmatic-only: the region must not become a tab stop for everyone else.
    expect(region.tabIndex).toBe(-1);
  });

  it("leaves focus alone when the toast that goes did not hold it", () => {
    const { doc, toasts, close } = container(2);
    close(1)?.focus();

    dismissToast(toasts[0] as never);

    expect(doc.activeElement?.id).toBe("close1");
  });

  it("removes a toast that is outside any container without touching focus", () => {
    const { doc, el } = fakeTree();
    const loose = el("DIV", { "data-slot": "toast", id: "loose" });
    doc.root.append(loose);
    const elsewhere = el("BUTTON", { id: "elsewhere" });
    doc.root.append(elsewhere);
    elsewhere.focus();

    dismissToast(loose as never);

    expect(doc.root.children.map((child) => child.id)).toEqual(["elsewhere"]);
    expect(doc.activeElement?.id).toBe("elsewhere");
  });
});

/** A page with an `<Announcer />` and an empty toast container, and a builder for a titled toast. */
function announcedStack() {
  const { doc, el } = fakeTree();
  const polite = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.polite });
  const region = el("SECTION", { "data-slot": "toast-container" });
  doc.root.append(el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.assertive }), polite, region);
  const toast = (title: string, description?: string): FakeElement => {
    const body = el("DIV", { "data-slot": "toast-body" });
    const titled = el("DIV", { "data-slot": "toast-title" });
    titled.textContent = title;
    body.append(titled);
    if (description !== undefined) {
      const described = el("DIV", { "data-slot": "toast-description" });
      described.textContent = description;
      body.append(described);
    }
    return el("DIV", { "data-slot": "toast" }).append(body);
  };
  return { win: doc.defaultView, polite, region, toast, el, within: doc as unknown as Node };
}

/** The messages the polite region holds now, one per node. */
const heldBy = (region: FakeElement): string[] => region.children.map((node) => node.textContent);

describe("mountToastAnnouncements", () => {
  it("announces the toasts already present, as a flash rendered after a redirect is", () => {
    const { win, polite, region, toast } = announcedStack();
    region.append(toast("Saved", "Your changes are live"), toast("Invite sent"));

    mountToastAnnouncements(region as never);
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved Your changes are live Invite sent"]);
  });

  it("stays silent for an empty container, leaving any other pending message alone", () => {
    const { win, region } = announcedStack();

    mountToastAnnouncements(region as never);

    expect(win.timers.size).toBe(0);
  });

  it("announces a toast inserted later, found inside the wrapper an out-of-band swap delivers", () => {
    const { win, polite, region, toast, el } = announcedStack();
    win.observeMutations();
    mountToastAnnouncements(region as never);

    win.observers[0]?.deliver(el("DIV").append(toast("Deleted")));
    win.flush();

    expect(heldBy(polite)).toEqual(["Deleted"]);
  });

  it("announces a toast whose body holds bare text by that text", () => {
    const { win, polite, region, el } = announcedStack();
    const body = el("DIV", { "data-slot": "toast-body" });
    body.textContent = "Link copied";
    region.append(el("DIV", { "data-slot": "toast" }).append(body));

    mountToastAnnouncements(region as never);
    win.flush();

    expect(heldBy(polite)).toEqual(["Link copied"]);
  });

  it("says nothing for an insertion that holds no toast", () => {
    const { win, region, el } = announcedStack();
    win.observeMutations();
    mountToastAnnouncements(region as never);

    win.observers[0]?.deliver(el("DIV", { "data-slot": "toast-close" }));

    expect(win.timers.size).toBe(0);
  });

  it("announces a second identical toast, because each one is a separate event", () => {
    const { win, polite, region, toast } = announcedStack();
    win.observeMutations();
    mountToastAnnouncements(region as never);
    const spoken: string[] = [];
    const append = polite.append.bind(polite);
    polite.append = (...nodes: FakeElement[]) => {
      spoken.push(...nodes.map((node) => node.textContent));
      return append(...nodes);
    };

    win.observers[0]?.deliver(toast("Saved"));
    win.flush();
    win.observers[0]?.deliver(toast("Saved"));
    win.flush();

    expect(spoken).toEqual(["Saved", "Saved"]);
  });

  it("speaks both of two toasts inserted by separate swaps within the settle", () => {
    const { win, polite, region, toast } = announcedStack();
    win.observeMutations();
    mountToastAnnouncements(region as never);

    win.observers[0]?.deliver(toast("Saved"));
    win.observers[0]?.deliver(toast("Invite sent"));
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved", "Invite sent"]);
  });

  it("keeps a pending toast when the app announces on the default channel", () => {
    const { win, polite, region, toast, within } = announcedStack();
    win.observeMutations();
    mountToastAnnouncements(region as never);

    win.observers[0]?.deliver(toast("Saved"));
    announce("Row 3 selected", { within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved", "Row 3 selected"]);
  });

  it("stops observing once disposed", () => {
    const { win, polite, region, toast } = announcedStack();
    win.observeMutations();
    const dispose = mountToastAnnouncements(region as never);

    dispose();
    win.observers[0]?.deliver(toast("Late"));
    win.flush();

    expect({ connected: win.observers[0]?.connected, held: heldBy(polite) }).toEqual({ connected: false, held: [] });
  });

  it("still announces the toasts present in a realm with no MutationObserver", () => {
    const { win, polite, region, toast } = announcedStack();
    region.append(toast("Saved"));

    const dispose = mountToastAnnouncements(region as never);
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved"]);
    expect(dispose).not.toThrow();
  });
});

describe("dismissToast — beside a fading toast", () => {
  it("passes over an inert toast's dismiss button and falls back to the region", () => {
    const { doc, region, toasts, close } = container(2);
    (toasts[1] as FakeElement).inert = true;
    close(0)?.focus();

    dismissToast(toasts[0] as never);

    expect(doc.activeElement).toBe(region);
  });
});

describe("scheduleToastDismissal", () => {
  /** One timed toast, with a sibling outside it for focus to move to. */
  function timed(ms = 1000) {
    const { doc, region, toasts } = container(1);
    const toast = toasts[0] as FakeElement;
    const outside = doc.createElement("BUTTON");
    doc.root.append(outside);
    const dispose = scheduleToastDismissal(toast as never, ms);
    return { win: doc.defaultView, region, toast, outside, dispose, present: () => region.children.includes(toast) };
  }

  const PAUSES = [
    {
      reason: "the pointer",
      pause: ({ toast }: ReturnType<typeof timed>) => toast.dispatchEvent(new FakeEvent("pointerenter")),
      resume: ({ toast }: ReturnType<typeof timed>) => toast.dispatchEvent(new FakeEvent("pointerleave")),
    },
    {
      reason: "focus",
      pause: ({ toast }: ReturnType<typeof timed>) => toast.dispatchEvent(new FakeEvent("focusin")),
      resume: ({ toast, outside }: ReturnType<typeof timed>) => toast.dispatchEvent(new FakeEvent("focusout", { relatedTarget: outside })),
    },
    {
      reason: "a blurred window",
      pause: ({ win }: ReturnType<typeof timed>) => win.dispatchEvent(new FakeEvent("blur")),
      resume: ({ win }: ReturnType<typeof timed>) => win.dispatchEvent(new FakeEvent("focus")),
    },
  ];

  it("dismisses the toast once its duration has run", () => {
    const toast = timed(1000);

    toast.win.advance(999);
    const before = toast.present();
    toast.win.advance(1);

    expect({ before, after: toast.present() }).toEqual({ before: true, after: false });
  });

  for (const { reason, pause, resume } of PAUSES) {
    it(`holds while ${reason} pauses it, then runs only the time that was left`, () => {
      const toast = timed(1000);
      toast.win.advance(400);
      pause(toast);
      toast.win.advance(5000);
      const held = toast.present();

      resume(toast);
      toast.win.advance(599);
      const beforeRemaining = toast.present();
      toast.win.advance(1);

      expect({ held, beforeRemaining, after: toast.present() }).toEqual({ held: true, beforeRemaining: true, after: false });
    });
  }

  it("resumes only once every reason to pause has gone", () => {
    const toast = timed(1000);
    toast.toast.dispatchEvent(new FakeEvent("pointerenter"));
    toast.win.dispatchEvent(new FakeEvent("blur"));

    toast.toast.dispatchEvent(new FakeEvent("pointerleave"));
    toast.win.advance(5000);
    const stillBlurred = toast.present();
    toast.win.dispatchEvent(new FakeEvent("focus"));
    toast.win.advance(1000);

    expect({ stillBlurred, after: toast.present() }).toEqual({ stillBlurred: true, after: false });
  });

  it("stays paused while focus moves between nodes inside the toast", () => {
    const toast = timed(1000);
    const inside = toast.toast.querySelector("[data-slot~='toast-close']");
    toast.toast.dispatchEvent(new FakeEvent("focusin"));

    toast.toast.dispatchEvent(new FakeEvent("focusout", { relatedTarget: inside }));
    toast.win.advance(5000);

    expect(toast.present()).toBe(true);
  });

  it("stops listening and never dismisses once disposed", () => {
    const toast = timed(1000);
    toast.dispose();

    toast.win.advance(5000);

    expect({ present: toast.present(), windowListeners: [...toast.win.listeners.values()].flat().length }).toEqual({
      present: true,
      windowListeners: 0,
    });
  });
});
