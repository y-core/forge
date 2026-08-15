import { describe, expect, it } from "bun:test";
import { TURNSTILE } from "../contracts/turnstile-contract";
import { fakeTree } from "./test-dom";
import { findWidget, hasApi } from "./turnstile";

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
