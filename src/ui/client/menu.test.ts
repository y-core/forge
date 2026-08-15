import { describe, expect, it } from "bun:test";
import { checkMenuItem } from "./menu";
import { type FakeElement, fakeTree } from "./test-dom";

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
