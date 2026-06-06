import { describe, expect, it } from "bun:test";
import { type HxAttrsProps, hxAttrs } from "./htmx-attrs";

describe("hxAttrs", () => {
  it("returns empty object for empty props", () => {
    expect(hxAttrs({})).toEqual({});
  });

  it("omits empty string scalars", () => {
    expect(hxAttrs({ get: "" })).toEqual({});
    expect(hxAttrs({ target: "" })).toEqual({});
  });

  it("omits undefined scalars", () => {
    const undefinedProps = { get: undefined, post: undefined } as unknown as HxAttrsProps;
    expect(hxAttrs(undefinedProps)).toEqual({});
  });

  it("maps get → hx-get", () => {
    expect(hxAttrs({ get: "/search" })).toEqual({ "hx-get": "/search" });
  });

  it("maps post → hx-post", () => {
    expect(hxAttrs({ post: "/submit" })).toEqual({ "hx-post": "/submit" });
  });

  it("maps put → hx-put", () => {
    expect(hxAttrs({ put: "/update" })).toEqual({ "hx-put": "/update" });
  });

  it("maps patch → hx-patch", () => {
    expect(hxAttrs({ patch: "/patch" })).toEqual({ "hx-patch": "/patch" });
  });

  it("maps delete → hx-delete", () => {
    expect(hxAttrs({ delete: "/remove" })).toEqual({ "hx-delete": "/remove" });
  });

  it("maps selectOob → hx-select-oob", () => {
    expect(hxAttrs({ selectOob: "#result" })).toEqual({ "hx-select-oob": "#result" });
  });

  it("maps disabledElt → hx-disabled-elt", () => {
    expect(hxAttrs({ disabledElt: "this" })).toEqual({ "hx-disabled-elt": "this" });
  });

  it("maps pushUrl → hx-push-url", () => {
    expect(hxAttrs({ pushUrl: "/new-url" })).toEqual({ "hx-push-url": "/new-url" });
  });

  it("maps replaceUrl → hx-replace-url", () => {
    expect(hxAttrs({ replaceUrl: "/current" })).toEqual({ "hx-replace-url": "/current" });
  });

  it("boost true → hx-boost=true (string)", () => {
    expect(hxAttrs({ boost: true })).toEqual({ "hx-boost": "true" });
  });

  it("boost false → hx-boost=false (string, not omitted)", () => {
    expect(hxAttrs({ boost: false })).toEqual({ "hx-boost": "false" });
  });

  it("boost undefined → omitted", () => {
    expect(hxAttrs({})).not.toHaveProperty("hx-boost");
  });

  it("values → hx-vals as JSON", () => {
    expect(hxAttrs({ values: { key: "val" } })).toEqual({ "hx-vals": '{"key":"val"}' });
  });

  it("empty values map → omitted", () => {
    expect(hxAttrs({ values: {} })).toEqual({});
  });

  it("headers → hx-headers as JSON", () => {
    expect(hxAttrs({ headers: { "X-Custom": "test" } })).toEqual({ "hx-headers": '{"X-Custom":"test"}' });
  });

  it("empty headers map → omitted", () => {
    expect(hxAttrs({ headers: {} })).toEqual({});
  });

  it("maps multiple scalar fields together", () => {
    const result = hxAttrs({ get: "/a", target: "#b", swap: "innerHTML", trigger: "click" });
    expect(result).toEqual({ "hx-get": "/a", "hx-target": "#b", "hx-swap": "innerHTML", "hx-trigger": "click" });
  });
});
