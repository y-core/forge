// `fakeD1` answers what it is told to answer, so three questions about D1 stay open until the real
// runtime is asked: whether it accepts and enforces `STRICT`, what a mid-batch failure leaves
// behind, and what shape a BLOB column reads back as. `src/auth/schema.sql` is posted to the
// fixture rather than imported by it, so what runs is the file a consumer would apply.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

const CONFIG = new URL("../fixtures/auth-d1/wrangler.jsonc", import.meta.url).pathname;
const SCHEMA = readFileSync(new URL("../../src/auth/schema.sql", import.meta.url).pathname, "utf8");

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer({ config: CONFIG, readyPath: "/guards" });
  // The fixture's database outlives the run that made it, so a table from an older `schema.sql`
  // would answer `IF NOT EXISTS` with its old columns and fail the index over a new one.
  await fetch(`${server.origin}/reset`, { method: "POST" });
}, 200_000);

afterAll(() => {
  server?.stop();
});

function get(path: string): Promise<Record<string, unknown>> {
  return fetch(`${server.origin}${path}`).then((res) => res.json() as Promise<Record<string, unknown>>);
}

describe("src/auth/schema.sql against real D1", () => {
  it("applies every statement in the shipped DDL without one failure", async () => {
    const applied = (await fetch(`${server.origin}/apply`, { method: "POST", body: SCHEMA }).then((res) => res.json())) as {
      failures: number;
      outcomes: { statement: string; error: string | null }[];
    };
    expect(applied.outcomes.filter((outcome) => outcome.error !== null)).toEqual([]);
    expect(applied.failures).toBe(0);
  });

  it("is idempotent, because every statement is IF NOT EXISTS", async () => {
    const again = (await fetch(`${server.origin}/apply`, { method: "POST", body: SCHEMA }).then((res) => res.json())) as { failures: number };
    expect(again.failures).toBe(0);
  });
});

describe("D1 open question — STRICT tables", () => {
  it("accepts the STRICT keyword and enforces the column types it declares", async () => {
    const probe = await get("/strict");
    expect(probe.createError).toBeNull();
    // A `STRICT` table rejects a TEXT value in an INTEGER column; a plain one would store it.
    expect(probe.typeMismatchError).toEqual(expect.stringContaining("cannot store TEXT value in INTEGER column"));
  });
});

describe("D1 open question — batch() under a mid-batch failure", () => {
  it("rolls the whole batch back, so a later statement's failure undoes an earlier statement's write", async () => {
    const probe = await get("/batch");
    // Held exactly, because `storeError`'s regex is built around this text: the index name ends at
    // the colon before `SQLITE_CONSTRAINT`, which is what the fixture messages in the store specs copy.
    expect(probe.batchError).toBe("D1_ERROR: UNIQUE constraint failed: probe_batch.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)");
    // Nothing survives: `batch()` is one implicit transaction, which is what lets the admin delete
    // remove a user's children and the user together without a half-deleted account being possible.
    expect(probe.survivingRows).toEqual([]);
  });
});

// Every last-admin, replay and ownership guard in `src/auth/stores/` decides on `rowsWritten > 0`,
// which `createD1Client` reads as `meta.rows_written ?? meta.changes`. If a matched write reported
// zero, every one of those guards would invert and refuse the write it should have allowed.
describe("D1 open question — which field a write reports rows-affected in", () => {
  it("populates both fields, and agrees between them, so the client's fallback never has to choose", async () => {
    const probe = (await get("/rows-written")) as Record<string, { rows_written: number | null; changes: number | null; resolved: number }>;
    for (const [name, outcome] of Object.entries(probe)) {
      expect(`${name}: rows_written=${outcome.rows_written} changes=${outcome.changes}`).toBe(
        `${name}: rows_written=${outcome.changes} changes=${outcome.changes}`,
      );
      expect(outcome.rows_written).not.toBeNull();
    }
  });

  it("reports one for a write that matched and zero for one that did not, which is what every guard reads", async () => {
    const probe = (await get("/rows-written")) as Record<string, { resolved: number }>;
    expect({
      updateMatched: probe.updateMatched?.resolved,
      updateUnmatched: probe.updateUnmatched?.resolved,
      updateGuardRefused: probe.updateGuardRefused?.resolved,
      deleteMatched: probe.deleteMatched?.resolved,
      deleteUnmatched: probe.deleteUnmatched?.resolved,
    }).toEqual({ updateMatched: 1, updateUnmatched: 0, updateGuardRefused: 0, deleteMatched: 1, deleteUnmatched: 0 });
  });

  it("counts a matched row whose value did not change, so re-stamping a state is `changed` and not a refusal", async () => {
    // `setDeactivated` on an already-deactivated user, and `setAdmin(false)` on a non-admin, both
    // rest on this: the row matched the guard, so the write was allowed, whatever it wrote.
    const probe = (await get("/rows-written")) as Record<string, { resolved: number }>;
    expect(probe.updateNoOp?.resolved).toBe(1);
  });
});

// A fake answers a guard with whatever it was told to answer, so `src/auth/stores/*.test.ts` proves
// the statement's text and this proves the statement. The `/guards` route runs the shipped adapters
// against `schema.sql`: mutating `NOT_LAST_ADMIN` turns these red, and a fake's would stay green.
describe("the shipped store adapters against real D1", () => {
  let guards: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    guards = (await get("/guards")) as Record<string, Record<string, unknown>>;
  }, 60_000);

  it("lets exactly one of two concurrent demotions of the last two admins through", () => {
    expect(guards.lastAdmin).toEqual({ demotions: ["changed", "last-admin-demote"], adminsLeft: 1 });
  });

  it("demotes and deletes a deactivated admin, while still refusing the last one who could sign in", () => {
    expect(guards.deactivatedAdmin).toEqual({
      deactivateDave: "changed",
      deactivateGina: "changed",
      demoteDeactivated: "changed",
      removeDeactivated: "changed",
      demoteLastActive: "last-admin-demote",
      removeLastActive: "last-admin-delete",
    });
  });

  it("scopes every factor and credential write to its owner, spends the TOTP budget, refuses a replayed step, and clears every child table", () => {
    expect(guards.ownership).toEqual({
      removeByStranger: false,
      removeByOwner: true,
      // The attempt ceiling, decided by the statement: two guesses admitted, the third refused
      // before any code is compared, and a stranger's guess spending nothing of the owner's budget.
      // The count each guess reports is the count that guess wrote, straight out of `RETURNING`.
      spendFirst: 1,
      spendSecond: 2,
      spendRefused: null,
      spendByStranger: null,
      // The lockout is a window from the last admitted guess: refused a millisecond inside it,
      // admitted at its edge with the count reset to one rather than carried on from the cap.
      spendInsideWindow: null,
      spendAfterWindow: 1,
      spentAfterWindow: 1,
      // The sealed secret rides out of the spend, so no second `find` reads the row again.
      spentSecretCarried: 9,
      unlinkByStranger: false,
      unlinkByOwner: true,
      revokeSessions: true,
      // Monotonic: an earlier instant must not walk the barrier back and revive a refused session.
      revokeSessionsBackwards: false,
      advanceByStranger: false,
      advanceFirst: true,
      advanceReplay: false,
      spentAfterAdvance: 0,
      confirmByStranger: false,
      removeFactorByStranger: false,
      removeUser: "changed",
      // Only `frank` is left: the delete batch took the user and all four child rows together.
      leftBehind: { auth_credentials: 0, auth_factors: 0, auth_identity_links: 0, auth_otp_state: 0, auth_users: 1 },
    });
  });
});

// The whole reason the challenge and nonce stores left KV. A fake settles neither: both rest on the
// database serialising writers, which is exactly what a fake stands in for.
describe("the ephemeral stores against real D1", () => {
  let guards: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    guards = (await get("/guards")) as Record<string, Record<string, unknown>>;
  }, 60_000);

  it("hands one challenge to exactly one of three concurrent takes, and lets exactly one consume a nonce", () => {
    expect(guards.ephemera).toEqual({
      challengesTaken: 1,
      challengeValue: { challenge: "Y2hhbGxlbmdl", sessionId: "sess-1" },
      noncesWon: 1,
      // Expiry is the predicate on the read, not a row being gone: a challenge written already dead
      // is invisible while its row is still there, and the purge is what reclaims it.
      takeExpired: null,
      beforePurge: 1,
      challengesAfterPurge: 0,
      noncesAfterPurge: 1,
    });
  });

  it("refuses an over-long address at the CHECK, and calls it the caller's fault rather than an outage", () => {
    expect(guards.emailLength).toEqual({ refusedCode: "invalid", acceptedOk: true, rows: 1 });
  });
});

describe("D1 open question — the JavaScript shape of a BLOB column", () => {
  it("reads a BLOB back as a plain Array of byte values, with the bytes intact", async () => {
    // Exact, not one-of-three: `blobBytes` claims this is what the runtime measured, and a claim
    // held by an `||` over every branch it might take is not a measurement.
    const probe = await get("/blob");
    expect({ constructorName: probe.constructorName, isArray: probe.isArray, isArrayBuffer: probe.isArrayBuffer }).toEqual({
      constructorName: "Array",
      isArray: true,
      isArrayBuffer: false,
    });
    expect(probe.bytes).toEqual([1, 2, 3, 250, 251, 252]);
  });
});
