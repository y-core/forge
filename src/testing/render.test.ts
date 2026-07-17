import { describe, expect, it } from "bun:test";
import { createElement as el } from "../jsx/element";
import { render } from "./render";

describe("render", () => {
  it("renders an element to its exact HTML string", async () => {
    expect(await render(el("div", { children: "hello" }))).toBe("<div>hello</div>");
  });

  it("escapes HTML entities in text", async () => {
    expect(await render(el("span", { children: "A&B" }))).toBe("<span>A&amp;B</span>");
  });

  it("returns a plain string type", async () => {
    const out = await render(el("br", null));
    expect(typeof out).toBe("string");
    expect(out).toBe("<br>");
  });
});
