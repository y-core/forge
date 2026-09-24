import { describe, expect, it } from "bun:test";

import { render } from "../testing/render";
import { Fragment as ElementFragment, isValidElement } from "./element";
import { Fragment, jsxDEV } from "./jsx-dev-runtime";
import { jsx } from "./jsx-runtime";

describe("jsxDEV", () => {
  it("produces a branded element carrying type, props and key", () => {
    const el = jsxDEV("div", { id: "x" }, "k") as unknown as Record<string, unknown>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe("div");
    expect(el.props).toEqual({ id: "x" });
    expect(el.key).toBe("k");
  });

  it("leaves the key undefined when the transform omits it", () => {
    expect((jsxDEV("div", {}) as unknown as Record<string, unknown>).key).toBe(undefined);
  });

  it("produces the same element shape as the production factory", () => {
    expect(jsxDEV("div", { id: "x" }, "k")).toEqual(jsx("div", { id: "x" }, "k"));
  });

  it("accepts a component function as its type and renders it", async () => {
    const Comp = (props: { name: string }) => jsxDEV("p", { children: props.name });
    expect(await render(jsxDEV(Comp as never, { name: "Ada & Co" }))).toBe("<p>Ada &amp; Co</p>");
  });

  it("renders an element with children exactly as the escaped markup", async () => {
    expect(await render(jsxDEV("a", { href: "/x", children: "Terms & <Conditions>" }))).toBe('<a href="/x">Terms &amp; &lt;Conditions&gt;</a>');
  });
});

describe("Fragment", () => {
  it("re-exports the runtime's own Fragment by reference, which is how renderToString detects it", () => {
    expect(Fragment).toBe(ElementFragment);
  });

  it("renders its children without a wrapper", async () => {
    expect(await render(jsxDEV(Fragment as never, { children: [jsxDEV("b", { children: "a" }), "&"] }))).toBe("<b>a</b>&amp;");
  });
});
