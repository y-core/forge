import { describe, expect, it } from "bun:test";

import { URL_SCHEME_CASES } from "../../http/escape.fixture";
import {
  BIND_ATTR_ATTR,
  BIND_TEXT_ATTR,
  bindAttrAttr,
  bindTextAttr,
  isBindAttrRefused,
  parseBindAttr,
  safeBindAttrValue,
  URL_BOUND_ATTRS,
} from "./bind-contract";

describe("bindTextAttr / bindAttrAttr", () => {
  it("builds the text binding attribute", () => {
    expect(bindTextAttr("count")).toEqual({ [BIND_TEXT_ATTR]: "count" });
  });

  it("builds the attribute binding as an attribute:field pair", () => {
    expect(bindAttrAttr("href", "profileUrl")).toEqual({ [BIND_ATTR_ATTR]: "href:profileUrl" });
  });

  it("throws on a bare handler name", () => {
    expect(() => bindAttrAttr("onclick", "action")).toThrow(/may not be bound to a signal/);
  });

  it("throws on a mixed-case handler name", () => {
    expect(() => bindAttrAttr("OnError", "action")).toThrow(/may not be bound to a signal/);
  });

  it("throws on srcdoc", () => {
    expect(() => bindAttrAttr("srcdoc", "bio")).toThrow(/may not be bound to a signal/);
  });

  it("throws on style", () => {
    expect(() => bindAttrAttr("style", "theme")).toThrow(/may not be bound to a signal/);
  });

  it("throws on every hx-on spelling, where the signal would supply the script htmx runs", () => {
    for (const attribute of ["hx-on:click", "hx-on-click", "data-hx-on:click", "data-hx-on-click"]) {
      expect(() => bindAttrAttr(attribute, "handler")).toThrow(/may not be bound to a signal/);
    }
  });
});

describe("isBindAttrRefused", () => {
  it("refuses a bare handler name in any casing", () => {
    expect(isBindAttrRefused("onclick")).toBe(true);
    expect(isBindAttrRefused("ONCLICK")).toBe(true);
    expect(isBindAttrRefused("onerror")).toBe(true);
  });

  it("refuses srcdoc in any casing", () => {
    expect(isBindAttrRefused("srcdoc")).toBe(true);
    expect(isBindAttrRefused("SrcDoc")).toBe(true);
  });

  // The SSR renderer drops `style` under the shipped `style-src 'self'`, so a binding that wrote one
  // in the browser is markup the renderer would never have emitted.
  it("refuses style in any casing, which the renderer drops rather than emits", () => {
    expect(isBindAttrRefused("style")).toBe(true);
    expect(isBindAttrRefused("STYLE")).toBe(true);
  });

  // `HTMX.md` §7b ratifies `hx-on:*` in the renderer, where a developer typed the whole attribute;
  // here the signal supplies the body. htmx compiles all four spellings, so the colon alone leaks.
  it("refuses every hx-on spelling htmx compiles, in any casing, although the renderer admits it", () => {
    expect(isBindAttrRefused("hx-on:click")).toBe(true);
    expect(isBindAttrRefused("hx-on-click")).toBe(true);
    expect(isBindAttrRefused("data-hx-on:click")).toBe(true);
    expect(isBindAttrRefused("data-hx-on-click")).toBe(true);
    expect(isBindAttrRefused("HX-ON-CLICK")).toBe(true);
  });

  it("admits the htmx attributes that carry no script body", () => {
    expect(isBindAttrRefused("hx-swap")).toBe(false);
    expect(isBindAttrRefused("data-hx-get")).toBe(false);
  });

  it("admits ordinary attributes, including one whose name merely contains a handler's letters", () => {
    expect(isBindAttrRefused("href")).toBe(false);
    expect(isBindAttrRefused("data-online")).toBe(false);
  });
});

describe("safeBindAttrValue", () => {
  // Read from the renderer rather than restated, so an attribute added to one side and not the other
  // fails here instead of leaving the client write weaker than the server write of the same name.
  it("holds exactly the attributes the JSX renderer sanitizes", async () => {
    const { URL_ATTRS } = await import("../../jsx/render-to-string");
    expect([...URL_BOUND_ATTRS].sort()).toEqual([...URL_ATTRS].sort());
  });

  // The shared table `src/http/escape.test.ts` asserts against `safeUrl`: `ui/contracts` is a leaf
  // and may not import `http`, so this is what stops this copy of the rule drifting from that one.
  it("applies the shared scheme rule to href for every case in the table", () => {
    for (const { input, expected } of URL_SCHEME_CASES) {
      expect(safeBindAttrValue("href", input)).toBe(expected);
    }
  });

  it("neutralizes a javascript: scheme on every URL-bound attribute", () => {
    for (const attribute of URL_BOUND_ATTRS) {
      expect(safeBindAttrValue(attribute, "javascript:alert(1)")).toBe("#");
    }
  });

  it("neutralizes a javascript: scheme on a mixed-case attribute name", () => {
    expect(safeBindAttrValue("HREF", "javascript:alert(1)")).toBe("#");
  });

  it("leaves a non-URL attribute value untouched", () => {
    expect(safeBindAttrValue("title", "javascript:alert(1)")).toBe("javascript:alert(1)");
  });

  it("leaves every hx-* value untouched — `#` would be a live same-origin request (docs/HTMX.md §7a)", () => {
    expect(safeBindAttrValue("hx-get", "javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(safeBindAttrValue("hx-push-url", "javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("parseBindAttr", () => {
  it("splits an attribute:field pair", () => {
    expect(parseBindAttr("href:profileUrl")).toEqual({ attribute: "href", field: "profileUrl" });
  });

  it("splits on the last colon, so a namespaced attribute survives", () => {
    expect(parseBindAttr("xlink:href:target")).toEqual({ attribute: "xlink:href", field: "target" });
  });

  it("returns null for a value with no colon, a leading colon, or a trailing colon", () => {
    expect(parseBindAttr("href")).toBeNull();
    expect(parseBindAttr(":field")).toBeNull();
    expect(parseBindAttr("href:")).toBeNull();
  });
});
