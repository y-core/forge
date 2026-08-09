import { describe, expect, it } from "bun:test";
import { type ScopeAttrsProps, scopeAttrs } from "./scope-attrs";

describe("scopeAttrs", () => {
  it("maps each on<Event> prop to its data-on-<event> attribute", () => {
    expect(scopeAttrs({ onClick: "a", onInput: "b" })).toEqual({ "data-on-click": "a", "data-on-input": "b" });
  });

  it("supports all four delegated events", () => {
    expect(scopeAttrs({ onClick: "c", onInput: "i", onChange: "h", onSubmit: "s" })).toEqual({
      "data-on-click": "c",
      "data-on-input": "i",
      "data-on-change": "h",
      "data-on-submit": "s",
    });
  });

  it("omits undefined props (e.g. a spread-in string | undefined value)", () => {
    const props: ScopeAttrsProps = { onClick: "a" };
    (props as Record<string, string | undefined>).onInput = undefined;
    expect(scopeAttrs(props)).toEqual({ "data-on-click": "a" });
  });

  it("omits empty-string props", () => {
    expect(scopeAttrs({ onClick: "", onChange: "go" })).toEqual({ "data-on-change": "go" });
  });

  it("returns an empty object when no props are set", () => {
    expect(scopeAttrs({})).toEqual({});
  });
});
