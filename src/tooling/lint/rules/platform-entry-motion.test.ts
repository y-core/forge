import { describe, expect, it } from "bun:test";

import { call, literal, methodCall, other, runRule } from "../test-support.ts";
import { platformEntryMotion } from "./platform-entry-motion.ts";

const DETAIL =
  "a class added inside `requestAnimationFrame` to start an entry transition — declare it with `@starting-style` and `transition-behavior: allow-discrete` (forge-ui-platform-entry-motion — src/ui/design/reference/16-platform.md)";

describe("platform-entry-motion", () => {
  it("reports a class added inside `requestAnimationFrame`", () => {
    expect(runRule(platformEntryMotion, call("requestAnimationFrame", methodCall("el.classList.add", literal("open"))))).toEqual([DETAIL]);
  });

  it("reports `.remove` and `.toggle` too", () => {
    for (const method of ["remove", "toggle"]) {
      expect(runRule(platformEntryMotion, call("requestAnimationFrame", methodCall(`el.classList.${method}`, literal("open"))))).toHaveLength(1);
    }
  });

  it("reports once per frame callback, however many classes it touches", () => {
    const frame = call("requestAnimationFrame", methodCall("el.classList.add", literal("a")), methodCall("el.classList.remove", literal("b")));

    expect(runRule(platformEntryMotion, frame)).toHaveLength(1);
  });

  it("reaches a call nested deeper inside the callback", () => {
    const frame = call("requestAnimationFrame", other("ArrowFunctionExpression", call("setTimeout", methodCall("el.classList.add", literal("a")))));

    expect(runRule(platformEntryMotion, frame)).toHaveLength(1);
  });

  it("leaves a class change outside a frame callback alone", () => {
    expect(runRule(platformEntryMotion, methodCall("el.classList.add", literal("open")))).toEqual([]);
  });

  it("leaves a frame callback that touches no class alone", () => {
    expect(runRule(platformEntryMotion, call("requestAnimationFrame", methodCall("el.style.setProperty", literal("--x"))))).toEqual([]);
  });

  it("leaves an `add` that is not on a `classList` alone", () => {
    expect(runRule(platformEntryMotion, call("requestAnimationFrame", methodCall("set.items.add", literal("x"))))).toEqual([]);
  });
});
