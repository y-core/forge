import { describe, expect, it } from "bun:test";

import { hxAttrs } from "./htmx-attrs";
import type { HxAttrsProps } from "./types";

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

  it("maps disable → hx-disable", () => {
    expect(hxAttrs({ disable: "this" })).toEqual({ "hx-disable": "this" });
  });

  it("never emits hx-params, even for a stray params prop", () => {
    const stray = { params: "*", get: "/a" } as unknown as HxAttrsProps;
    expect(hxAttrs(stray)).toEqual({ "hx-get": "/a" });
  });

  it("maps pushUrl → hx-push-url", () => {
    expect(hxAttrs({ pushUrl: "/new-url" })).toEqual({ "hx-push-url": "/new-url" });
  });

  it("maps replaceUrl → hx-replace-url", () => {
    expect(hxAttrs({ replaceUrl: "/current" })).toEqual({ "hx-replace-url": "/current" });
  });

  it("boost true → hx-boost:inherited=true (string)", () => {
    expect(hxAttrs({ boost: true })).toEqual({ "hx-boost:inherited": "true" });
  });

  it("boost false → hx-boost:inherited=false (string, not omitted)", () => {
    expect(hxAttrs({ boost: false })).toEqual({ "hx-boost:inherited": "false" });
  });

  it("boost undefined → omitted", () => {
    const attrs = hxAttrs({});
    expect(attrs).not.toHaveProperty("hx-boost:inherited");
    expect(attrs).not.toHaveProperty("hx-boost");
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
