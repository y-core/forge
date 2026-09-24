import { describe, expect, it } from "bun:test";

import { LOG_REDACTED } from "./log-clone";
import { applyLogRedaction, DEFAULT_LOG_REDACTION, defineLogRedaction, normalizeLogKey } from "./redact";
import { serializeError } from "./serialize-error";

function masked(data: Record<string, unknown>): Record<string, unknown> {
  return applyLogRedaction(data, DEFAULT_LOG_REDACTION);
}

describe("normalizeLogKey", () => {
  const cases: [string, string][] = [
    ["email", "email"],
    ["userEmail", "useremail"],
    ["user_email", "useremail"],
    ["USER-EMAIL", "useremail"],
    ["Set-Cookie", "setcookie"],
  ];

  for (const [input, expected] of cases) {
    it(`reduces ${input} to ${expected}`, () => {
      expect(normalizeLogKey(input)).toBe(expected);
    });
  }
});

describe("DEFAULT_LOG_REDACTION — one case per BOUNDARIES.md §4a field class", () => {
  const cases: [string, string][] = [
    ["email addresses", "email"],
    ["display names", "displayName"],
    ["passwords", "password"],
    ["keys", "apiKey"],
    ["tokens", "token"],
    ["secrets", "secret"],
    ["request body content", "body"],
    ["credential headers", "authorization"],
    ["cookies", "cookie"],
    ["session identifiers", "sessionId"],
  ];

  for (const [klass, key] of cases) {
    it(`masks ${klass} at \`${key}\``, () => {
      expect(masked({ [key]: "live" })).toStrictEqual({ [key]: LOG_REDACTED });
    });
  }
});

describe("DEFAULT_LOG_REDACTION — substring matching over a normalized key", () => {
  const spellings = ["email", "emailAddress", "user_email", "USER-EMAIL", "userEmail", "EmailAddress"];

  for (const key of spellings) {
    it(`masks \`${key}\``, () => {
      expect(masked({ [key]: "a@b.test" })).toStrictEqual({ [key]: LOG_REDACTED });
    });
  }

  it("masks the over-captured `tokenCount`, which the allow hatch is what pays for", () => {
    expect(masked({ tokenCount: 3 })).toStrictEqual({ tokenCount: LOG_REDACTED });
  });

  it("masks the over-captured `emailVerifiedAt`, likewise", () => {
    expect(masked({ emailVerifiedAt: "2026-05-31" })).toStrictEqual({ emailVerifiedAt: LOG_REDACTED });
  });
});

describe("DEFAULT_LOG_REDACTION — the stems deliberately absent from the set", () => {
  it("keeps `hostname` and `filename`, which a bare `name` stem would have taken with it", () => {
    expect(masked({ hostname: "app.example.com", filename: "a.ts" })).toStrictEqual({ hostname: "app.example.com", filename: "a.ts" });
  });

  it("keeps a `message`, because masking every error message is log destruction rather than redaction", () => {
    expect(masked({ message: "boom" })).toStrictEqual({ message: "boom" });
  });

  it("keeps `mailer` and `mailbox`, which a `mail` stem would have taken for no coverage `email` misses", () => {
    expect(masked({ mailer: "ses", mailbox: "inbox" })).toStrictEqual({ mailer: "ses", mailbox: "inbox" });
  });

  it("keeps `pinnedAt`, which a `pin` stem would have taken", () => {
    expect(masked({ pinnedAt: "2026-05-31" })).toStrictEqual({ pinnedAt: "2026-05-31" });
  });

  it("keeps an opaque `userId`, the affordance §4a directs an application to log instead", () => {
    expect(masked({ userId: "u_1" })).toStrictEqual({ userId: "u_1" });
  });

  it("keeps a KV `key`, which only the compound key stems match", () => {
    expect(masked({ key: "session||1" })).toStrictEqual({ key: "session||1" });
  });
});

describe("an application's `also` over its own `name` and `message` fields", () => {
  it("masks both, and leaves the error record they no longer collide with", () => {
    const thrown = new TypeError("x.y is not a function");
    const policy = defineLogRedaction({ also: ["name", "message"] });

    const result = applyLogRedaction({ name: "Jane Example", message: "hello", error: serializeError(thrown) }, policy);

    expect(result).toStrictEqual({
      name: LOG_REDACTED,
      message: LOG_REDACTED,
      error: { type: "TypeError", detail: "x.y is not a function", stack: thrown.stack },
    });
  });
});

describe("DEFAULT_LOG_REDACTION — the mask never derives from its value", () => {
  it("produces the same output for a 1-character and a 64-character value", () => {
    const short = masked({ password: "a" });
    const long = masked({ password: "a".repeat(64) });
    expect(short.password).toBe(long.password as string);
    expect(short.password).toBe(LOG_REDACTED);
  });
});

describe("applyLogRedaction — nesting and containers", () => {
  it("reaches a nested key", () => {
    expect(masked({ user: { email: "a@b.test", id: "u_1" } })).toStrictEqual({ user: { email: LOG_REDACTED, id: "u_1" } });
  });

  it("reaches a key inside an array element", () => {
    expect(masked({ users: [{ email: "a@b.test" }] })).toStrictEqual({ users: [{ email: LOG_REDACTED }] });
  });

  it("masks a whole array whose own key matches", () => {
    expect(masked({ emails: ["a@b.test", "c@d.test"] })).toStrictEqual({ emails: LOG_REDACTED });
  });

  it("masks a Map and a Set held under a matching key", () => {
    expect(masked({ tokens: new Map([["a", 1]]), secrets: new Set(["x"]) })).toStrictEqual({ tokens: LOG_REDACTED, secrets: LOG_REDACTED });
  });

  it("walks into a Map's values under a key the policy keeps", () => {
    expect(masked({ rows: new Map([["a", { email: "a@b.test" }]]) })).toStrictEqual({
      rows: { type: "Map", entries: [["a", { email: LOG_REDACTED }]] },
    });
  });

  it("redacts a cyclic graph and marks the back-reference", () => {
    const node: Record<string, unknown> = { email: "a@b.test" };
    node.self = node;
    expect(masked(node)).toStrictEqual({ email: LOG_REDACTED, self: "[circular]" });
  });

  it("renders a Date as its ISO instant and a URL as origin and path", () => {
    expect(masked({ at: new Date("2026-05-31T10:00:00.000Z"), to: new URL("https://a.test/p?token=S") })).toStrictEqual({
      at: "2026-05-31T10:00:00.000Z",
      to: "https://a.test/p",
    });
  });

  it("leaves the caller's object unmutated", () => {
    const data = { email: "a@b.test", user: { email: "c@d.test" } };
    masked(data);
    expect(data).toStrictEqual({ email: "a@b.test", user: { email: "c@d.test" } });
  });
});

describe("defineLogRedaction — mode", () => {
  it("defaults to mask, so a suppressed field is distinguishable from an absent one", () => {
    expect(defineLogRedaction().mode).toBe("mask");
  });

  it("deletes the key under `remove`", () => {
    const data = applyLogRedaction({ email: "a@b.test", id: "u_1" }, defineLogRedaction({ mode: "remove" }));
    expect("email" in data).toBe(false);
    expect(data).toStrictEqual({ id: "u_1" });
  });
});

describe("defineLogRedaction — also and allow", () => {
  it("adds a stem through `also`", () => {
    const policy = defineLogRedaction({ also: ["invoice"] });
    expect(applyLogRedaction({ invoiceId: "inv_1" }, policy)).toStrictEqual({ invoiceId: LOG_REDACTED });
  });

  it("matches an `also` stem with the same normalization the built-in set gets", () => {
    const policy = defineLogRedaction({ also: ["tenant-ref"] });
    expect(applyLogRedaction({ tenantRef: "t_1" }, policy)).toStrictEqual({ tenantRef: LOG_REDACTED });
  });

  it("lets a built-in stem back out through `allow`", () => {
    const policy = defineLogRedaction({ allow: ["tokencount"] });
    expect(applyLogRedaction({ tokenCount: 3, token: "live" }, policy)).toStrictEqual({ tokenCount: 3, token: LOG_REDACTED });
  });

  it("gives `allow` the decision over a consumer's own `also`", () => {
    const policy = defineLogRedaction({ also: ["ref"], allow: ["traceref"] });
    expect(applyLogRedaction({ traceRef: "t_1", ownerRef: "o_1" }, policy)).toStrictEqual({ traceRef: "t_1", ownerRef: LOG_REDACTED });
  });

  it("treats a stem's `.` as a literal, so `a.b` does not match `axb`", () => {
    const policy = defineLogRedaction({ also: ["a.b"] });
    expect(applyLogRedaction({ axb: "live", "a.b": "live" }, policy)).toStrictEqual({ axb: "live", "a.b": LOG_REDACTED });
  });

  it("treats an `allow` that matches nothing as a no-op rather than a throw at construction", () => {
    expect(() => defineLogRedaction({ allow: ["nothingmatchesthis"] })).not.toThrow();
    expect(applyLogRedaction({ email: "a@b.test" }, defineLogRedaction({ allow: ["nothingmatchesthis"] }))).toStrictEqual({ email: LOG_REDACTED });
  });

  it("keeps the built-in set when `also` is empty", () => {
    expect(applyLogRedaction({ email: "a@b.test" }, defineLogRedaction({ also: [] }))).toStrictEqual({ email: LOG_REDACTED });
  });

  it("ignores an empty stem rather than compiling an alternation that matches every key", () => {
    const policy = defineLogRedaction({ also: [""] });
    expect(applyLogRedaction({ id: "u_1" }, policy)).toStrictEqual({ id: "u_1" });
  });

  it("ignores a separator-only `allow`, which would otherwise normalize to nothing and keep every key", () => {
    const policy = defineLogRedaction({ allow: ["-"] });
    expect(applyLogRedaction({ email: "a@b.test", password: "x" }, policy)).toStrictEqual({ email: LOG_REDACTED, password: LOG_REDACTED });
  });

  it("ignores a separator-only `also`, which would otherwise mask every key", () => {
    const policy = defineLogRedaction({ also: ["_"] });
    expect(applyLogRedaction({ id: "u_1", status: 200 }, policy)).toStrictEqual({ id: "u_1", status: 200 });
  });
});
