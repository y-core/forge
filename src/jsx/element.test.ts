import { describe, expect, it } from "bun:test";

import { render } from "../testing/render";
import { cloneElement, createElement, Fragment, isValidElement } from "./element";
import type { JSXElement } from "./types";

describe("Fragment", () => {
  it("returns null — renderToString detects it by reference rather than calling it", () => {
    expect(Fragment({ children: "ignored" })).toBe(null);
  });

  it("renders its children with no wrapper element", async () => {
    const el = createElement(Fragment, { children: [createElement("b", { children: "a" }), createElement("i", { children: "b" })] });
    expect(await render(el)).toBe("<b>a</b><i>b</i>");
  });
});

describe("createElement", () => {
  it("carries the tag, props and key it was given", () => {
    const el = createElement("div", { id: "x" }, "k") as unknown as Record<string, unknown>;
    expect(el.type).toBe("div");
    expect(el.props).toEqual({ id: "x" });
    expect(el.key).toBe("k");
  });

  it("substitutes an empty props object for null props", () => {
    const el = createElement("br", null) as unknown as Record<string, unknown>;
    expect(el.props).toEqual({});
    expect(el.key).toBe(undefined);
  });

  it("accepts a component function as its type", () => {
    const Comp = (): JSXElement => createElement("p", { children: "hi" });
    const el = createElement(Comp, {}) as unknown as Record<string, unknown>;
    expect(el.type).toBe(Comp);
  });

  it("escapes an interpolated child when rendered", async () => {
    expect(await render(createElement("td", { children: "O'Brien & <Associates>" }))).toBe("<td>O&#39;Brien &amp; &lt;Associates&gt;</td>");
  });
});

describe("isValidElement", () => {
  it("accepts an element this runtime created", () => {
    expect(isValidElement(createElement("div", null))).toBe(true);
  });

  it("rejects a hand-written object carrying the same string-keyed shape", () => {
    expect(isValidElement({ type: "div", props: {} })).toBe(false);
  });

  it("rejects a JSON round-trip of a real element, whose symbol brand does not survive", () => {
    const forged: unknown = JSON.parse(JSON.stringify(createElement("div", { id: "x" })));
    expect(isValidElement(forged)).toBe(false);
  });

  it("rejects a payload spelling the brand as a string key", () => {
    // The brand is a Symbol, so this string key is the closest an attacker-supplied JSON body can get.
    expect(isValidElement({ type: "div", props: {}, "forge.jsx": true })).toBe(false);
  });

  it("rejects null, undefined, a string, a number and an array", () => {
    for (const value of [null, undefined, "div", 1, []]) {
      expect(isValidElement(value)).toBe(false);
    }
  });
});

describe("cloneElement", () => {
  it("shallow-merges the extra props over the originals", () => {
    const clone = cloneElement(createElement("div", { id: "a", class: "c" }), { id: "b" }) as unknown as Record<string, unknown>;
    expect(clone.props).toEqual({ id: "b", class: "c" });
  });

  it("leaves the source element untouched", () => {
    const original = createElement("div", { id: "a" });
    cloneElement(original, { id: "b" });
    expect((original as unknown as Record<string, unknown>).props).toEqual({ id: "a" });
  });

  it("keeps the brand, so the clone is still a valid element", () => {
    expect(isValidElement(cloneElement(createElement("div", { id: "a" }), { id: "b" }))).toBe(true);
  });

  it("preserves type and key when no props are supplied", () => {
    const clone = cloneElement(createElement("span", { id: "a" }, "k")) as unknown as Record<string, unknown>;
    expect(clone.type).toBe("span");
    expect(clone.key).toBe("k");
    expect(clone.props).toEqual({ id: "a" });
  });

  it("renders the merged props", async () => {
    expect(await render(cloneElement(createElement("div", { id: "a", children: "t" }), { id: "b" }))).toBe('<div id="b">t</div>');
  });
});
