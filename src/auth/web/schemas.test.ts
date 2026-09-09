import { describe, expect, it } from "bun:test";

import { describeValidationIssue, v } from "../../validation/mod";
import {
  authAdminElevateSchema,
  authAdminSearchSchema,
  authAdminUserSchema,
  authEmailChangeSchema,
  authPasskeyLabelSchema,
  authSigninSchema,
  authSignupSchema,
  authTotpEnrolSchema,
  authVerifySchema,
} from "./schemas";

/** The field each issue names, in issue order — `describeValidationIssue` reports the name and nothing else. */
function fieldsRejected(schema: v.GenericSchema, input: unknown): string[] {
  const parsed = v.safeParse(schema, input);
  return parsed.success ? [] : parsed.issues.map(describeValidationIssue);
}

function output<T>(schema: v.GenericSchema<unknown, T>, input: unknown): T {
  const parsed = v.safeParse(schema, input);
  if (!parsed.success) throw new Error(`expected a valid payload, got issues on: ${parsed.issues.map(describeValidationIssue).join(", ")}`);
  return parsed.output;
}

describe("authSigninSchema", () => {
  it("accepts an address and trims it", () => {
    expect(output(authSigninSchema(), { email: "  ada@example.com  " })).toEqual({ email: "ada@example.com" });
  });

  it("rejects a malformed address", () => {
    expect(fieldsRejected(authSigninSchema(), { email: "ada" })).toEqual(["email"]);
  });

  it("rejects an address past the RFC 5321 path limit", () => {
    expect(fieldsRejected(authSigninSchema(), { email: `${"a".repeat(250)}@example.com` })).toEqual(["email"]);
  });

  it("rejects a missing address", () => {
    expect(fieldsRejected(authSigninSchema(), {})).toEqual(["email"]);
  });

  it("rejects an undeclared field, because the entries bag carries no prototype", () => {
    expect(fieldsRejected(authSigninSchema(), { email: "ada@example.com", isAdmin: "true" })).toEqual(["isAdmin"]);
  });
});

describe("authSignupSchema", () => {
  it("accepts an address", () => {
    expect(output(authSignupSchema(), { email: "ada@example.com" })).toEqual({ email: "ada@example.com" });
  });

  it("rejects a malformed address", () => {
    expect(fieldsRejected(authSignupSchema(), { email: "@example.com" })).toEqual(["email"]);
  });
});

describe("authVerifySchema", () => {
  it("accepts a six-digit code and strips cosmetic separators", () => {
    expect(output(authVerifySchema(), { code: "123 456" })).toEqual({ code: "123456" });
  });

  it("rejects a short code", () => {
    expect(fieldsRejected(authVerifySchema(), { code: "12345" })).toEqual(["code"]);
  });

  it("rejects a long code", () => {
    expect(fieldsRejected(authVerifySchema(), { code: "1234567" })).toEqual(["code"]);
  });
});

describe("authEmailChangeSchema", () => {
  it("accepts an address", () => {
    expect(output(authEmailChangeSchema(), { email: "grace@example.com" })).toEqual({ email: "grace@example.com" });
  });

  it("rejects a malformed address", () => {
    expect(fieldsRejected(authEmailChangeSchema(), { email: "grace@" })).toEqual(["email"]);
  });
});

describe("authPasskeyLabelSchema", () => {
  it("accepts a label and trims it", () => {
    expect(output(authPasskeyLabelSchema(), { label: " YubiKey 5 " })).toEqual({ label: "YubiKey 5" });
  });

  it("rejects a label past the length ceiling", () => {
    expect(fieldsRejected(authPasskeyLabelSchema(), { label: "k".repeat(65) })).toEqual(["label"]);
  });

  it("rejects a non-string label", () => {
    expect(fieldsRejected(authPasskeyLabelSchema(), { label: 7 })).toEqual(["label"]);
  });

  // The store models an unnamed credential as `null`, so a blank field clears the name rather than
  // writing an empty string as a third state.
  it("folds a blank label to the absence the store already models", () => {
    expect(output(authPasskeyLabelSchema(), { label: "   " })).toEqual({ label: null });
    expect(output(authPasskeyLabelSchema(), { label: "" })).toEqual({ label: null });
  });
});

describe("authTotpEnrolSchema", () => {
  it("accepts a six-digit code", () => {
    expect(output(authTotpEnrolSchema(), { code: "654321" })).toEqual({ code: "654321" });
  });

  it("accepts the ten-digit ceiling RFC 4226 allows", () => {
    expect(output(authTotpEnrolSchema(), { code: "0123456789" })).toEqual({ code: "0123456789" });
  });

  it("rejects a five-digit code", () => {
    expect(fieldsRejected(authTotpEnrolSchema(), { code: "12345" })).toEqual(["code"]);
  });

  it("rejects an eleven-digit code", () => {
    expect(fieldsRejected(authTotpEnrolSchema(), { code: "01234567890" })).toEqual(["code"]);
  });
});

describe("authAdminUserSchema", () => {
  it("accepts a role and a status", () => {
    expect(output(authAdminUserSchema(), { role: "admin", status: "active" })).toEqual({ role: "admin", status: "active" });
  });

  it("rejects a role outside the closed choice", () => {
    expect(fieldsRejected(authAdminUserSchema(), { role: "superuser", status: "active" })).toEqual(["role"]);
  });

  it("rejects a status outside the closed choice", () => {
    expect(fieldsRejected(authAdminUserSchema(), { role: "member", status: "banned" })).toEqual(["status"]);
  });
});

describe("authAdminElevateSchema", () => {
  it("accepts the explicit confirmation", () => {
    expect(output(authAdminElevateSchema(), { confirm: "yes" })).toEqual({ confirm: "yes" });
  });

  it("rejects any other value, so a stray submit cannot mint an administrator", () => {
    expect(fieldsRejected(authAdminElevateSchema(), { confirm: "on" })).toEqual(["confirm"]);
  });

  it("rejects a missing confirmation", () => {
    expect(fieldsRejected(authAdminElevateSchema(), {})).toEqual(["confirm"]);
  });
});

describe("authAdminSearchSchema", () => {
  it("accepts an empty query", () => {
    expect(output(authAdminSearchSchema(), {})).toEqual({ q: undefined, after: undefined });
  });

  it("accepts a term and a cursor", () => {
    const cursor = "01a08574-257c-71bd-8eb7-f399ec130d3b";
    expect(output(authAdminSearchSchema(), { q: "ada", after: cursor })).toEqual({ q: "ada", after: cursor });
  });

  it("rejects a term past the length ceiling", () => {
    expect(fieldsRejected(authAdminSearchSchema(), { q: "a".repeat(201) })).toEqual(["q"]);
  });

  // The cursor is a user id and reaches the store as one, so a crafted value is refused at the edge
  // rather than relied on to be answered as "no such page" further in.
  it("rejects a cursor that is not a canonical user id", () => {
    for (const after of ["u9", "01a08574257c71bd8eb7f399ec130d3b", "01a08574-257c-71bd-8eb7-f399ec130d3b'"]) {
      expect(fieldsRejected(authAdminSearchSchema(), { after })).toEqual(["after"]);
    }
  });
});
