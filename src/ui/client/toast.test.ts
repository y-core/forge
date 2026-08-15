import { describe, expect, it } from "bun:test";
import { fakeTree } from "./test-dom";
import { dismissToast } from "./toast";

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
