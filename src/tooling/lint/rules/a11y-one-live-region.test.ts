import { describe, expect, it } from "bun:test";

import { attribute, container, element, identifier, literal, runRule, spread } from "../lint.fixture.ts";
import { a11yOneLiveRegion } from "./a11y-one-live-region.ts";

const live = (value: Parameters<typeof attribute>[1]) => element("div", attribute("aria-live", value));
const role = (value: Parameters<typeof attribute>[1]) => element("p", attribute("role", value));

describe("a11y-one-live-region", () => {
  it("reports a second live region, whatever politeness it claims", () => {
    for (const value of ["polite", "assertive"]) {
      expect(runRule(a11yOneLiveRegion, live(literal(value)))[0]).toContain(`\`aria-live="${value}"\` opens a second live region`);
    }
  });

  it("reports each role that implies a live region", () => {
    for (const value of ["alert", "status", "log"]) {
      expect(runRule(a11yOneLiveRegion, role(literal(value)))[0]).toContain(`\`role="${value}"\` opens a second live region`);
    }
  });

  it("names `announce()` and `<Announcer />` as the route, for a role and an `aria-live` alike", () => {
    for (const message of [...runRule(a11yOneLiveRegion, role(literal("status"))), ...runRule(a11yOneLiveRegion, live(literal("polite")))]) {
      expect(message).toContain("`announce()`");
      expect(message).toContain("`<Announcer />`");
    }
  });

  it("reports a live role stated as a string inside braces", () => {
    expect(runRule(a11yOneLiveRegion, role(container(literal("alert"))))[0]).toContain('`role="alert"` opens a second live region');
  });

  it("leaves a role that opens no live region alone", () => {
    expect(runRule(a11yOneLiveRegion, role(literal("button")))).toEqual([]);
  });

  it("leaves a role resolved at render time alone", () => {
    expect(runRule(a11yOneLiveRegion, role(container(identifier("role"))))).toEqual([]);
  });

  it("leaves `off` alone — it announces nothing, so it opens no region", () => {
    expect(runRule(a11yOneLiveRegion, live(literal("off")))).toEqual([]);
  });

  it('leaves a live role alone when `aria-live="off"` switches its region off', () => {
    expect(runRule(a11yOneLiveRegion, element("div", attribute("role", literal("status")), attribute("aria-live", literal("off"))))).toEqual([]);
  });

  it("leaves a live role alone when its `aria-live` is resolved at render time, and may be `off`", () => {
    expect(
      runRule(a11yOneLiveRegion, element("div", attribute("role", literal("status")), attribute("aria-live", container(identifier("politeness"))))),
    ).toEqual([]);
  });

  it("reports an element that is live by both its role and its `aria-live` once", () => {
    const messages = runRule(a11yOneLiveRegion, element("div", attribute("role", literal("status")), attribute("aria-live", literal("polite"))));

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('`aria-live="polite"` opens a second live region');
  });

  it("leaves a value resolved at render time alone", () => {
    expect(runRule(a11yOneLiveRegion, live(container(identifier("politeness"))))).toEqual([]);
  });

  it("reports a bare `<output>`, which is an implicit status region, and routes it to `announce()`", () => {
    const messages = runRule(a11yOneLiveRegion, element("output"));

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('`<output>` is an implicit `role="status"`');
    expect(messages[0]).toContain("`announce()`");
  });

  it('leaves an `<output>` alone when `aria-live="off"` switches its region off', () => {
    expect(runRule(a11yOneLiveRegion, element("output", attribute("aria-live", literal("off"))))).toEqual([]);
  });

  it("leaves an `<output>` alone when an explicit role replaces its implicit status", () => {
    expect(runRule(a11yOneLiveRegion, element("output", attribute("role", literal("img"))))).toEqual([]);
  });

  it("reports an `<output>` given a live role once, by that role", () => {
    const messages = runRule(a11yOneLiveRegion, element("output", attribute("role", literal("alert"))));

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('`role="alert"` opens a second live region');
  });

  it("leaves an `<output>` alone when a spread may supply its `aria-live` at render time", () => {
    expect(runRule(a11yOneLiveRegion, element("output", spread("props")))).toEqual([]);
  });

  it("leaves an element carrying no `aria-live` alone", () => {
    expect(runRule(a11yOneLiveRegion, element("div"))).toEqual([]);
  });
});
