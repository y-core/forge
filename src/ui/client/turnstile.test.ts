import { describe, expect, it } from "bun:test";

import { TURNSTILE } from "../contracts/turnstile-contract";
import { FakeElement, fakeTree } from "./test-dom";
import { findWidget, hasApi, restoreFocus } from "./turnstile";

const win = (turnstile?: unknown) => ({ turnstile }) as unknown as Window;

describe("hasApi", () => {
  it("is true only for an object that can actually render", () => {
    expect(hasApi(win({ render: () => "widget-1" }))).toBe(true);
  });

  it("is false when nothing has been assigned", () => {
    expect(hasApi(win())).toBe(false);
  });

  it("is false for an element the DOM exposed under the name", () => {
    // Any element with `id="turnstile"` becomes `window.turnstile`, and a truthiness test would
    // take it for the API and try to render into it.
    const { el } = fakeTree();
    expect(hasApi(win(el("DIV", { id: "turnstile" })))).toBe(false);
  });

  it("is false when render is present but is not callable", () => {
    expect(hasApi(win({ render: "yes" }))).toBe(false);
  });
});

describe("findWidget", () => {
  it("reports the root when the root is itself the widget", () => {
    const { el } = fakeTree();
    const root = el("DIV", { "data-ref": TURNSTILE.widget });
    expect(findWidget(root as unknown as HTMLElement)).toBe(root as unknown as HTMLElement);
  });

  it("reports a widget below the root", () => {
    const { el } = fakeTree();
    const root = el();
    const widget = el("DIV", { "data-ref": TURNSTILE.widget });
    root.append(el(), widget);
    expect(findWidget(root as unknown as HTMLElement)).toBe(widget as unknown as HTMLElement);
  });

  it("reports null when the tree holds no widget", () => {
    const { el } = fakeTree();
    const root = el();
    root.append(el("DIV", { "data-ref": TURNSTILE.fallback }));
    expect(findWidget(root as unknown as HTMLElement)).toBe(null);
  });
});

describe("restoreFocus", () => {
  /** A focused field, a widget container, and the frame the widget renders into it. */
  const scene = () => {
    const { doc, el } = fakeTree();
    const field = el("INPUT");
    const container = el();
    const frame = el("IFRAME");
    container.append(frame);
    doc.body.append(field, container);
    field.focus();
    return { doc, el, field, container, frame };
  };

  const restore = (container: FakeElement, previous: FakeElement | null) =>
    restoreFocus(container as unknown as HTMLElement, previous as unknown as Element | null);

  it("puts focus back on the field the widget took it from", () => {
    const { doc, field, container, frame } = scene();
    frame.focus();

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("puts focus back when the widget dropped focus onto the body", () => {
    const { doc, field, container } = scene();
    doc.body.focus();

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("puts focus back when the document reports no focused element at all", () => {
    const { doc, field, container } = scene();
    doc.activeElement = null;

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("reports no action when focus is on the body and nothing held it before", () => {
    const { doc, container } = scene();
    doc.body.focus();

    expect(restore(container, null)).toBe(false);
    expect(doc.activeElement).toBe(doc.body);
  });

  it("leaves focus alone when the user moved it to a real element outside the widget", () => {
    const { doc, el, field, container } = scene();
    const elsewhere = el("INPUT");
    doc.body.append(elsewhere);
    elsewhere.focus();

    expect(restore(container, field)).toBe(false);
    expect(doc.activeElement).toBe(elsewhere);
  });

  it("reports no action when focus never moved off the field", () => {
    const { doc, field, container } = scene();

    expect(restore(container, field)).toBe(false);
    expect(doc.activeElement).toBe(field);
  });

  it("leaves focus alone when the field it came from is no longer connected", () => {
    const { doc, container, frame } = scene();
    // Built outside the tree rather than removed from it: the fake reports connectedness from its
    // parent and document, and `remove()` clears only the parent.
    const gone = new FakeElement("INPUT");
    frame.focus();

    expect(restore(container, gone)).toBe(false);
    expect(doc.activeElement).toBe(frame);
    expect(gone.focused).toBe(false);
  });

  it("leaves the widget focused when nothing held focus before it rendered", () => {
    const { doc, container, frame } = scene();
    doc.activeElement = null;
    frame.focus();

    expect(restore(container, null)).toBe(false);
    expect(doc.activeElement).toBe(frame);
  });
});
