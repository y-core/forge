import { describe, expect, it } from "bun:test";
import "./register";
import { renderToString } from "./render-to-string";

// Proves that globalThis.React shim resolves to forge's runtime,
// covering the esbuild classic-fallback path: React.createElement / React.Fragment.

type ReactShim = { createElement: (...args: unknown[]) => unknown; Fragment: unknown };
const R = (globalThis as unknown as { React: ReactShim }).React;

describe("register — globalThis.React shim", () => {
  it("sets globalThis.React", () => {
    expect(R).toBeDefined();
    expect(typeof R.createElement).toBe("function");
    expect(R.Fragment).toBeDefined();
  });

  it("createElement produces a renderable element (single child)", async () => {
    const el = R.createElement("span", { class: "x" }, "hello");
    expect(String(await renderToString(el))).toBe('<span class="x">hello</span>');
  });

  it("createElement folds multiple children into an array", async () => {
    const el = R.createElement("div", null, "a", "b", "c");
    expect(String(await renderToString(el))).toBe("<div>abc</div>");
  });

  it("createElement with null props (void element)", async () => {
    const el = R.createElement("hr", null);
    expect(String(await renderToString(el))).toBe("<hr>");
  });

  it("Fragment renders children without a wrapper", async () => {
    const frag = R.createElement(R.Fragment, null, "x", "y");
    expect(String(await renderToString(frag))).toBe("xy");
  });
});
