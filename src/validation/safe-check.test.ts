import { describe, expect, it } from "bun:test";

import { describeValidationIssue } from "./format-issues";
import { parseEnv } from "./parse-env";
import { safeCheck, vouchedMessage } from "./safe-check";
import { v } from "./validation";

const longEnough = (value: string): boolean => value.length > 3;

function firstIssue(schema: v.GenericSchema, input: unknown): v.BaseIssue<unknown> {
  const result = v.safeParse(schema, input, { abortEarly: true });
  if (result.success) throw new Error("expected schema to fail for this input");
  const [issue] = result.issues;
  if (issue === undefined) throw new Error("expected at least one issue");
  return issue;
}

describe("safeCheck", () => {
  it("validates exactly as `v.check` does, accepting what the requirement accepts", () => {
    expect(v.safeParse(v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")), "abcd").success).toBe(true);
  });

  it("rejects what the requirement rejects", () => {
    expect(v.safeParse(v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")), "ab").success).toBe(false);
  });

  it("keeps the message on the issue itself, as `v.check` would", () => {
    expect(firstIssue(v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")), "ab").message).toBe(
      "must be longer than three characters",
    );
  });
});

describe("vouchedMessage", () => {
  it("returns the message registered for the requirement the issue carries", () => {
    expect(vouchedMessage(firstIssue(v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")), "ab"))).toBe(
      "must be longer than three characters",
    );
  });

  it("returns undefined for a plain `v.check`, whose message nothing vouched for", () => {
    expect(
      vouchedMessage(
        firstIssue(
          v.pipe(
            v.string(),
            v.check((value) => value.length > 3, "rejected hunter2secret"),
          ),
          "ab",
        ),
      ),
    ).toBeUndefined();
  });

  // The registration is keyed by the predicate, so a plain `v.check` reusing a vouched one still
  // resolves to the vouched message — the safe direction, and the reason this is stated as a test.
  it("resolves a plain `v.check` that reuses a vouched requirement to the vouched message", () => {
    safeCheck(longEnough, "must be longer than three characters");

    expect(vouchedMessage(firstIssue(v.pipe(v.string(), v.check(longEnough, "rejected hunter2secret")), "ab"))).toBe(
      "must be longer than three characters",
    );
  });

  it("returns undefined for an issue carrying no requirement at all", () => {
    expect(vouchedMessage(firstIssue(v.string(), 42))).toBeUndefined();
  });
});

describe("the env refusal", () => {
  it("surfaces a vouched message verbatim, which is the only thing telling two checks apart", () => {
    const schema = v.object({ SITE_ORIGIN: v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")) });

    expect(() => parseEnv(schema, { SITE_ORIGIN: "ab" })).toThrow(
      new Error("Invalid environment: SITE_ORIGIN: must be longer than three characters"),
    );
  });

  it("still renders an unvouched check as the bare type, so an interpolated value cannot leak", () => {
    const schema = v.object({
      API_KEY: v.pipe(
        v.string(),
        v.check((value) => value.startsWith("sk_live_"), "rejected sk_test_hunter2"),
      ),
    });

    expect(() => parseEnv(schema, { API_KEY: "sk_test_hunter2" })).toThrow(new Error("Invalid environment: API_KEY: check"));
  });

  it("reports a missing value as missing rather than as the requirement it never reached", () => {
    const schema = v.object({ SITE_ORIGIN: v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")) });

    expect(() => parseEnv(schema, {})).toThrow(new Error("Invalid environment: SITE_ORIGIN: missing"));
  });

  it("leaves the form-facing description alone — that one names the field and nothing else", () => {
    const schema = v.object({ token: v.pipe(v.string(), safeCheck(longEnough, "must be longer than three characters")) });

    expect(describeValidationIssue(firstIssue(schema, { token: "ab" }))).toBe("token");
  });
});
