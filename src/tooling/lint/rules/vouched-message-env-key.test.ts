import { describe, expect, it } from "bun:test";

import { callOn, identifier, interpolated, literal, member, runRule, template } from "../lint.fixture.ts";
import { vouchedMessageEnvKey } from "./vouched-message-env-key.ts";

const message = (key: string) =>
  `[forge-vouched-message-env-key] \`safeCheck\` message names \`${key}\`, an env key — name the requirement, since the consuming app picks the key and the \`<field>:\` prefix already locates it`;

const safeCheck = (text: ReturnType<typeof literal>) => callOn(identifier("safeCheck"), identifier("requirement"), text);

describe("vouched-message-env-key", () => {
  it("reports a string message naming an env key", () => {
    expect(runRule(vouchedMessageEnvKey, safeCheck(literal("SITE_ORIGIN must use https")))).toEqual([message("SITE_ORIGIN")]);
  });

  it("reports an env key in a template message's literal text", () => {
    expect(runRule(vouchedMessageEnvKey, safeCheck(template("set CSRF_SECRET to 64 hex characters")))).toEqual([message("CSRF_SECRET")]);
  });

  it("leaves a message naming the requirement alone", () => {
    expect(runRule(vouchedMessageEnvKey, safeCheck(literal("must use https")))).toEqual([]);
    expect(runRule(vouchedMessageEnvKey, safeCheck(template("each whsec_ followed by base64")))).toEqual([]);
  });

  it("leaves an interpolated name alone, since only the literal text is the author's spelling", () => {
    const named = interpolated(["", " must be ", ""], [identifier("name"), identifier("label")]);
    expect(runRule(vouchedMessageEnvKey, safeCheck(named))).toEqual([]);
  });

  it("leaves another callee and a method named safeCheck alone", () => {
    expect(runRule(vouchedMessageEnvKey, callOn(identifier("check"), identifier("f"), literal("SITE_ORIGIN must use https")))).toEqual([]);
    expect(runRule(vouchedMessageEnvKey, callOn(member(identifier("v"), "safeCheck"), identifier("f"), literal("SITE_ORIGIN")))).toEqual([]);
  });
});
