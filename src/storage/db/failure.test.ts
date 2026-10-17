import { describe, expect, it } from "bun:test";

import { classifyD1Error, D1Failure } from "./failure";
import type { D1Constraint, D1FailureKind } from "./types";

// The constraint and limit texts are what local workerd D1 answered (spike-261016-46/50); the rest are
// the strings Cloudflare's "Debug D1" page lists.
const TABLE: [string, D1FailureKind, D1Constraint?][] = [
  [
    "D1_ERROR: UNIQUE constraint failed: p.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)",
    "constraint",
    { rule: "unique", name: "p.id" },
  ],
  [
    "D1_ERROR: UNIQUE constraint failed: auth_users.email_key: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    "constraint",
    { rule: "unique", name: "auth_users.email_key" },
  ],
  [
    "D1_ERROR: NOT NULL constraint failed: c.p: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)",
    "constraint",
    { rule: "not-null", name: "c.p" },
  ],
  [
    "D1_ERROR: CHECK constraint failed: x > 0: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)",
    "constraint",
    { rule: "check", name: "x > 0" },
  ],
  [
    "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
    "constraint",
    { rule: "foreign-key", name: null },
  ],
  ["D1_ERROR: Network connection lost.", "transient"],
  ["D1_ERROR: Internal error while starting up D1 DB storage caused object to be reset.", "transient"],
  ["D1_ERROR: Internal error in D1 DB storage caused object to be reset.", "transient"],
  ["D1_ERROR: D1 DB reset because its code was updated.", "transient"],
  ["D1_ERROR: Replica disconnected from primary.", "transient"],
  ["D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.", "transient"],
  ["D1_ERROR: Can't read from request stream because client disconnected.", "transient"],
  ["D1_ERROR: D1 DB is overloaded. Requests queued for too long.", "overloaded"],
  ["D1_ERROR: D1 DB is overloaded. Too many requests queued.", "overloaded"],
  ["D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.", "timeout"],
  ["D1_ERROR: D1 DB's isolate exceeded its memory limit and was reset.", "limit"],
  ["D1_ERROR: D1 DB exceeded its CPU time limit and was reset.", "limit"],
  ["D1_ERROR: statement too long: SQLITE_TOOBIG", "limit"],
  ["D1_ERROR: too many SQL variables at offset 207: SQLITE_ERROR", "limit"],
  ["D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR", "limit"],
  ["D1_ERROR: Exceeded maximum DB size.", "limit"],
  ["D1_ERROR: no such column: nope at offset 7: SQLITE_ERROR", "unavailable"],
  ["D1_ERROR: integer overflow: SQLITE_ERROR", "unavailable"],
  ["something nobody has seen before", "unavailable"],
];

describe("classifyD1Error()", () => {
  for (const [message, kind, constraint] of TABLE) {
    it(`classes "${message}" as ${kind}`, () => {
      const thrown = new Error(message);
      const failure = classifyD1Error(thrown);
      expect([failure.kind, failure.constraint, failure.message, failure.cause]).toEqual([kind, constraint, message, thrown]);
    });
  }

  it("classes the overflow as guard only when the call carried a guard, rewording it", () => {
    const failure = classifyD1Error(new Error("D1_ERROR: integer overflow: SQLITE_ERROR"), { guarded: true });
    expect([failure.kind, failure.message]).toEqual(["guard", "a guarded statement in this batch wrote no row, so the batch was rolled back"]);
  });

  it("reads a non-Error throw as its string", () => {
    expect(classifyD1Error("D1_ERROR: Network connection lost.").kind).toBe("transient");
  });

  it("records the attempts it is told, defaulting to one", () => {
    expect([classifyD1Error(new Error("x")).attempts, classifyD1Error(new Error("x"), { attempts: 4 }).attempts]).toEqual([1, 4]);
  });

  it("returns a D1Failure it is handed unchanged", () => {
    const failure = new D1Failure("limit", "too big", { attempts: 2 });
    expect(classifyD1Error(failure, { attempts: 9 })).toBe(failure);
  });
});

describe("D1Failure", () => {
  it("is an Error named D1Failure", () => {
    const failure = new D1Failure("timeout", "slow");
    expect([failure instanceof Error, failure.name, failure.kind, failure.constraint, failure.attempts]).toEqual([
      true,
      "D1Failure",
      "timeout",
      undefined,
      1,
    ]);
  });
});
