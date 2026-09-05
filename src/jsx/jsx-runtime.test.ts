import { describe, expect, it } from "bun:test";

import { render } from "../testing/render";
import { Fragment as ElementFragment, isValidElement } from "./element";
import { Fragment, jsx, jsxs } from "./jsx-runtime";

describe("jsx", () => {
  it("produces a branded element carrying type, props and key", () => {
    const el = jsx("div", { id: "x" }, "k") as unknown as Record<string, unknown>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe("div");
    expect(el.props).toEqual({ id: "x" });
    expect(el.key).toBe("k");
  });

  it("leaves the key undefined when the transform omits it", () => {
    expect((jsx("div", {}) as unknown as Record<string, unknown>).key).toBe(undefined);
  });

  it("accepts a component function as its type and renders it", async () => {
    const Comp = (props: { name: string }) => jsx("p", { children: props.name });
    expect(await render(jsx(Comp as never, { name: "Ada & Co" }))).toBe("<p>Ada &amp; Co</p>");
  });

  it("renders an element with children exactly as the escaped markup", async () => {
    expect(await render(jsx("a", { href: "/x", children: "Terms & <Conditions>" }))).toBe('<a href="/x">Terms &amp; &lt;Conditions&gt;</a>');
  });
});

describe("jsxs", () => {
  it("is the same function as jsx — the multi-child form needs no separate behaviour", () => {
    expect(jsxs).toBe(jsx);
  });

  it("renders a multi-child element", async () => {
    expect(await render(jsxs("ul", { children: [jsx("li", { children: "a" }), jsx("li", { children: "b" })] }))).toBe(
      "<ul><li>a</li><li>b</li></ul>",
    );
  });
});

describe("Fragment", () => {
  it("re-exports the runtime's own Fragment by reference, which is how renderToString detects it", () => {
    expect(Fragment).toBe(ElementFragment);
  });

  it("renders its children without a wrapper", async () => {
    expect(await render(jsx(Fragment as never, { children: [jsx("b", { children: "a" }), "&"] }))).toBe("<b>a</b>&amp;");
  });
});
