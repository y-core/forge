import { describe, expect, it } from "bun:test";

import { MENU_ITEM_SELECTOR } from "../contracts/menu-contract";
import { FakeElement, FakeEvent, fakeTree, installCssEscape } from "./dom.fixture";
import { checkMenuItem, mountMenu } from "./menu";

const MENU_ITEM_ROLES = [...MENU_ITEM_SELECTOR.matchAll(/\[role='([^']+)'\]/g)].map((match) => match[1] as string);

/** A popup with a checkbox row, two radio groups, and one ungrouped radio row. */
function menu() {
  const { doc, el } = fakeTree();
  const popup = el("DIV", { "data-slot": "menu-popup", role: "menu" });

  const check = el("BUTTON", { role: "menuitemcheckbox", "aria-checked": "false", id: "wrap" });

  const groupA = el("FIELDSET", { role: "group" });
  const small = el("BUTTON", { role: "menuitemradio", "aria-checked": "true", "data-checked": "", id: "sm" });
  const large = el("BUTTON", { role: "menuitemradio", "aria-checked": "false", id: "lg" });
  groupA.append(small, large);

  const groupB = el("FIELDSET", { role: "group" });
  const other = el("BUTTON", { role: "menuitemradio", "aria-checked": "true", "data-checked": "", id: "other" });
  groupB.append(other);

  const loose = el("BUTTON", { role: "menuitemradio", "aria-checked": "false", id: "loose" });

  popup.append(check, groupA, groupB, loose);
  doc.root.append(popup);
  return { doc, popup, check, small, large, other, loose };
}

const state = (el: FakeElement) => ({ aria: el.getAttribute("aria-checked"), data: el.hasAttribute("data-checked") });

describe("checkMenuItem", () => {
  it("refuses a row marked aria-disabled, which the ring keeps focusable", () => {
    const { popup, check } = menu();
    check.setAttribute("aria-disabled", "true");

    checkMenuItem(check as never, popup as never);

    expect(state(check)).toEqual({ aria: "false", data: false });
  });

  it("leaves a disabled radio row's checked sibling alone", () => {
    const { popup, small, large } = menu();
    large.setAttribute("aria-disabled", "true");

    checkMenuItem(large as never, popup as never);

    expect({ large: state(large), small: state(small) }).toEqual({ large: { aria: "false", data: false }, small: { aria: "true", data: true } });
  });

  it("flips a checkbox row's ARIA state and its styling hook together", () => {
    const { popup, check } = menu();

    checkMenuItem(check as never, popup as never);
    expect(state(check)).toEqual({ aria: "true", data: true });

    checkMenuItem(check as never, popup as never);
    expect(state(check)).toEqual({ aria: "false", data: false });
  });

  it("makes a radio row exclusive within its own group", () => {
    const { popup, small, large } = menu();

    checkMenuItem(large as never, popup as never);

    expect(state(large)).toEqual({ aria: "true", data: true });
    expect(state(small)).toEqual({ aria: "false", data: false });
  });

  it("leaves a radio row in a different group untouched", () => {
    const { popup, large, other } = menu();

    checkMenuItem(large as never, popup as never);

    expect(state(other)).toEqual({ aria: "true", data: true });
  });

  it("leaves the already-checked row checked when it is re-selected", () => {
    const { popup, small } = menu();

    checkMenuItem(small as never, popup as never);

    expect(state(small)).toEqual({ aria: "true", data: true });
  });

  it("falls back to the whole popup for a radio row in no group at all", () => {
    const { popup, loose, small, other } = menu();

    checkMenuItem(loose as never, popup as never);

    expect(state(loose)).toEqual({ aria: "true", data: true });
    // Scoped to the popup, so every radio row in it is cleared — including the grouped ones.
    expect(state(small)).toEqual({ aria: "false", data: false });
    expect(state(other)).toEqual({ aria: "false", data: false });
  });

  it("never reaches a group outside the scope it was given", () => {
    const { doc, el } = fakeTree();
    const outerForm = el("FIELDSET", { role: "group" });
    const stranger = el("BUTTON", { role: "menuitemradio", "aria-checked": "true", "data-checked": "", id: "stranger" });
    const popup = el("DIV", { "data-slot": "menu-popup" });
    const row = el("BUTTON", { role: "menuitemradio", "aria-checked": "false", id: "row" });
    popup.append(row);
    outerForm.append(stranger, popup);
    doc.root.append(outerForm);

    checkMenuItem(row as never, popup as never);

    expect(state(stranger)).toEqual({ aria: "true", data: true });
  });
});

describe("mountMenu", () => {
  /** One row per role `MENU_ITEM_SELECTOR` names, plus a separator the ring must not pick up. */
  function navigableMenu() {
    const { doc, el } = fakeTree();
    const popup = el("DIV", { "data-slot": "menu-popup", role: "menu" });
    const rows = MENU_ITEM_ROLES.map((role, i) => el("BUTTON", { role, id: `row-${i}` }));
    const separator = el("DIV", { role: "separator", id: "separator" });
    popup.append(...rows, separator);
    doc.root.append(popup);
    return { doc, popup, rows, separator };
  }

  it("navigates exactly the roles MENU_ITEM_SELECTOR names, and nothing else in the popup", () => {
    const { doc, popup, rows, separator } = navigableMenu();
    const dispose = mountMenu(popup as never);

    rows[0]?.focus();
    const visited = [doc.activeElement?.getAttribute("role") ?? null];
    for (let step = 1; step < rows.length; step += 1) {
      popup.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" }));
      visited.push(doc.activeElement?.getAttribute("role") ?? null);
    }
    dispose();

    expect({ visited: [...visited].sort(), separatorFocused: separator.focused }).toEqual({
      visited: [...MENU_ITEM_ROLES].sort(),
      separatorFocused: false,
    });
  });

  it("focuses the first row MENU_ITEM_SELECTOR matches when the popup opens", () => {
    const { doc, popup } = navigableMenu();
    const dispose = mountMenu(popup as never);

    popup.dispatchEvent(new FakeEvent("toggle", { newState: "open" }));
    const opened = doc.activeElement;
    dispose();

    expect({ id: opened?.id ?? null, role: opened?.getAttribute("role") ?? null }).toEqual({ id: "row-0", role: MENU_ITEM_ROLES[0] });
  });

  it("opens onto the first row the ring can reach, where focusing a disabled one would be a no-op", () => {
    const { doc, popup, rows } = navigableMenu();
    const first = rows[0];
    if (first) first.disabled = true;
    const dispose = mountMenu(popup as never);

    popup.dispatchEvent(new FakeEvent("toggle", { newState: "open" }));
    const opened = doc.activeElement;
    dispose();

    expect(opened?.id ?? null).toBe("row-1");
  });

  // `commandfor` makes the panel chain a graph rather than a tree, so it can cycle: the walk out of
  // it is capped, and these two prove the cap holds where the chain closes on itself.
  describe("mountMenu — a cyclic panel chain", () => {
    /** Panels wired so that following `commandfor` outward from the first never reaches a root. */
    function cycle(panels: string[]) {
      installCssEscape();
      const { doc, el } = fakeTree();
      const made = panels.map((id) => el("DIV", { "data-slot": "menu-popup", role: "menu", id }));
      made.forEach((panel, i) => {
        // The invoker naming the *previous* panel sits inside this one, so the chain closes.
        panel.append(el("BUTTON", { commandfor: panels[(i + panels.length - 1) % panels.length] ?? "", id: `open-${i}` }));
        doc.root.append(panel);
      });
      const outside = el("BUTTON", { id: "outside" });
      doc.root.append(outside);
      return { popup: made[0] as FakeElement, outside };
    }

    it("returns from a focusout where a panel's own invoker sits inside it", () => {
      const { popup, outside } = cycle(["solo"]);
      const dispose = mountMenu(popup as never);

      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: outside }));
      dispose();

      expect(popup.id).toBe("solo");
    });

    it("returns from a focusout where two panels name each other", () => {
      const { popup, outside } = cycle(["first", "second"]);
      const dispose = mountMenu(popup as never);

      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: outside }));
      dispose();

      expect(popup.id).toBe("first");
    });
  });

  describe("mountMenu — focus moving to the popup's own invoker", () => {
    const ON_TRIGGER = { clientX: 10, clientY: 10 };
    const OFF_TRIGGER = { clientX: 200, clientY: 200 };
    const OFF_VIEWPORT = { clientX: -5, clientY: -5 };

    /** An open popup, the trigger that names it, and a record of every `hidePopover()` call. */
    function openWithInvoker() {
      installCssEscape();
      const { doc, el } = fakeTree();
      const label = el("SPAN", { id: "label" });
      const trigger = el("BUTTON", { commandfor: "m", id: "trigger" });
      trigger.append(label);
      const popup = el("DIV", { "data-slot": "menu-popup", role: "menu", id: "m" });
      popup.append(el("BUTTON", { role: "menuitem", id: "row" }));
      const elsewhere = el("DIV", { id: "elsewhere" });
      doc.root.append(trigger, popup, elsewhere);
      Object.assign(doc, {
        elementFromPoint: (x: number, y: number) => {
          if (x === ON_TRIGGER.clientX && y === ON_TRIGGER.clientY) return label;
          if (x === OFF_TRIGGER.clientX && y === OFF_TRIGGER.clientY) return elsewhere;
          return null;
        },
      });
      const hides: string[] = [];
      Object.assign(popup, {
        matches: (selector: string) => selector === ":popover-open" || FakeElement.prototype.matches.call(popup, selector),
        hidePopover: () => hides.push(popup.id),
      });
      return { popup, trigger, elsewhere, hides, win: doc.defaultView };
    }

    it("leaves the menu open while the invoker is pressed, so its own toggle closes it", () => {
      const { popup, trigger, hides } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      dispose();

      expect(hides).toEqual([]);
    });

    it("closes the menu when focus reaches the invoker with no press, as Shift+Tab does", () => {
      const { popup, trigger, hides } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.dispatchEvent(new FakeEvent("pointerup", ON_TRIGGER));
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      dispose();

      expect(hides).toEqual(["m"]);
    });

    it("closes the menu at once, arming no timer, when a press on the invoker is released onto something else", () => {
      const { popup, trigger, elsewhere, hides, win } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      elsewhere.dispatchEvent(new FakeEvent("pointerup", OFF_TRIGGER));
      const pending = win.timers.size;
      dispose();

      expect({ hides, pending }).toEqual({ hides: ["m"], pending: 0 });
    });

    it("leaves the closing to the click when the press is released on the invoker", () => {
      const { popup, trigger, hides } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      trigger.dispatchEvent(new FakeEvent("pointerup", ON_TRIGGER));
      dispose();

      expect(hides).toEqual([]);
    });

    for (const [where, point] of [
      ["off it", OFF_TRIGGER],
      ["outside the viewport", OFF_VIEWPORT],
    ] as const) {
      it(`closes the menu once the task ends when a captured press on the invoker is released ${where} and no click follows`, () => {
        const { popup, trigger, hides, win } = openWithInvoker();
        const dispose = mountMenu(popup as never);

        trigger.dispatchEvent(new FakeEvent("pointerdown"));
        trigger.focus();
        popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
        trigger.dispatchEvent(new FakeEvent("pointerup", point));
        const beforeTimer = [...hides];
        win.flush();
        dispose();

        expect({ beforeTimer, afterTimer: hides }).toEqual({ beforeTimer: [], afterTimer: ["m"] });
      });

      it(`leaves the closing to the click when a captured press released ${where} still clicks the invoker`, () => {
        const { popup, trigger, hides, win } = openWithInvoker();
        const dispose = mountMenu(popup as never);

        trigger.dispatchEvent(new FakeEvent("pointerdown"));
        trigger.focus();
        popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
        trigger.dispatchEvent(new FakeEvent("pointerup", point));
        trigger.dispatchEvent(new FakeEvent("click"));
        win.flush();
        dispose();

        expect(hides).toEqual([]);
      });
    }

    it("still closes on a click that lands off the invoker after a captured release", () => {
      const { popup, trigger, elsewhere, hides, win } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      trigger.dispatchEvent(new FakeEvent("pointerup", OFF_TRIGGER));
      elsewhere.dispatchEvent(new FakeEvent("click"));
      win.flush();
      dispose();

      expect(hides).toEqual(["m"]);
    });

    it("drops a pending settle when a new press on the invoker starts before it runs", () => {
      const { popup, trigger, hides, win } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      trigger.dispatchEvent(new FakeEvent("pointerup", OFF_TRIGGER));
      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      win.flush();
      dispose();

      expect(hides).toEqual([]);
    });

    it("cancels a pending settle on dispose, so a swapped-out menu is never closed by a timer", () => {
      const { popup, trigger, hides, win } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      popup.dispatchEvent(new FakeEvent("focusout", { relatedTarget: trigger }));
      trigger.dispatchEvent(new FakeEvent("pointerup", OFF_TRIGGER));
      dispose();
      const pending = win.timers.size;
      win.flush();

      expect({ hides, pending }).toEqual({ hides: [], pending: 0 });
    });

    it("closes the menu when a press on the invoker is cancelled with focus left outside", () => {
      const { popup, trigger, hides } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      trigger.focus();
      trigger.dispatchEvent(new FakeEvent("pointercancel"));
      dispose();

      expect(hides).toEqual(["m"]);
    });

    it("leaves the menu open when a released press never moved focus out of it", () => {
      const { popup, trigger, hides } = openWithInvoker();
      const dispose = mountMenu(popup as never);

      (popup.children[0] as FakeElement).focus();
      trigger.dispatchEvent(new FakeEvent("pointerdown"));
      popup.dispatchEvent(new FakeEvent("pointerup"));
      dispose();

      expect(hides).toEqual([]);
    });
  });

  // A menu popup is swapped wholesale by HTMX, so a listener left behind accumulates one per swap.
  // The pass case dispatches *after* dispose: a removed listener and an inert one look alike otherwise.
  describe("mountMenu — disposing", () => {
    const count = (el: FakeElement, type: string): number => el.listeners.get(type)?.length ?? 0;

    // The roving focus controller adds its own keydown listener to the same popup, so the count is
    // what tells `disposeFocus()` apart from the removals beside it.
    it("listens for its own events and the roving ring's while mounted", () => {
      const { popup } = navigableMenu();

      mountMenu(popup as never);

      expect({ before: count(popup, "beforetoggle"), toggle: count(popup, "toggle"), keydown: count(popup, "keydown") }).toEqual({
        before: 1,
        toggle: 1,
        keydown: 2,
      });
    });

    it("removes all three on dispose", () => {
      const { popup } = navigableMenu();

      mountMenu(popup as never)();

      expect({ before: count(popup, "beforetoggle"), toggle: count(popup, "toggle"), keydown: count(popup, "keydown") }).toEqual({
        before: 0,
        toggle: 0,
        keydown: 0,
      });
    });

    it("removes its document-level pointer and click listeners on dispose", () => {
      const { doc, popup } = navigableMenu();
      const onDoc = () =>
        Object.fromEntries(["pointerdown", "pointerup", "pointercancel", "click"].map((type) => [type, doc.listeners.get(type)?.length ?? 0]));

      const dispose = mountMenu(popup as never);
      const mounted = onDoc();
      dispose();

      expect({ mounted, disposed: onDoc() }).toEqual({
        mounted: { pointerdown: 1, pointerup: 1, pointercancel: 1, click: 1 },
        disposed: { pointerdown: 0, pointerup: 0, pointercancel: 0, click: 0 },
      });
    });

    it("releases the roving focus too, so an opened popup no longer steals focus after disposal", () => {
      const { doc, popup } = navigableMenu();
      mountMenu(popup as never)();
      doc.activeElement = null;

      popup.dispatchEvent(new FakeEvent("toggle", { newState: "open" }));

      expect(doc.activeElement).toBe(null);
    });
  });
});
