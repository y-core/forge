// `fakeD1` answers what it is told to answer, so these questions stay open until real D1 is asked;
// `src/auth/schema.sql` is posted rather than imported, so what runs is the build a consumer takes.
import { readFileSync } from "node:fs";

import { createAdminUserStore } from "../../src/auth/stores/admin-users";
import { createD1Client } from "../../src/storage/db/client";
import { uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import type { TestD1 } from "../../src/testing/d1";
import { openAuthD1, signedUp, tokenHash } from "./auth-d1.fixture";
import { expect, harnessTest } from "./harness.fixture";

const test = harnessTest({ config: new URL("../fixtures/auth-d1/wrangler.jsonc", import.meta.url).pathname });
const SCHEMA = readFileSync(new URL("../../src/auth/schema.sql", import.meta.url).pathname, "utf-8");

function get(origin: string, path: string): Promise<Record<string, unknown>> {
  return fetch(`${origin}${path}`).then((res) => res.json() as Promise<Record<string, unknown>>);
}

test.describe("src/auth/schema.sql against real D1", () => {
  test("applies every statement in the shipped DDL without one failure", async ({ served }) => {
    const applied = (await fetch(`${served.origin}/apply`, { method: "POST", body: SCHEMA }).then((res) => res.json())) as {
      failures: number;
      outcomes: { statement: string; error: string | null }[];
    };
    expect(applied.outcomes.filter((outcome) => outcome.error !== null)).toEqual([]);
    expect(applied.failures).toBe(0);
  });

  test("is idempotent, because every statement is IF NOT EXISTS", async ({ served }) => {
    const again = (await fetch(`${served.origin}/apply`, { method: "POST", body: SCHEMA }).then((res) => res.json())) as { failures: number };
    expect(again.failures).toBe(0);
  });
});

test.describe("D1 open question — STRICT tables", () => {
  test("accepts the STRICT keyword and enforces the column types it declares", async ({ served }) => {
    const probe = await get(served.origin, "/strict");
    expect(probe.createError).toBeNull();
    // A `STRICT` table rejects a TEXT value in an INTEGER column; a plain one would store it.
    expect(probe.typeMismatchError).toEqual(expect.stringContaining("cannot store TEXT value in INTEGER column"));
  });
});

test.describe("D1 open question — batch() under a mid-batch failure", () => {
  test("rolls the whole batch back, so a later statement's failure undoes an earlier statement's write", async ({ served }) => {
    const probe = await get(served.origin, "/batch");
    // Held exactly, because `storeError`'s regex is built around this text: the index name ends at
    // the colon before `SQLITE_CONSTRAINT`, which is what the fixture messages in the store specs copy.
    expect(probe.batchError).toBe("D1_ERROR: UNIQUE constraint failed: probe_batch.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)");
    expect(probe.survivingRows).toEqual([]);
  });
});

test.describe("D1 open question — foreign keys with no PRAGMA set", () => {
  test("refuses an orphan, ignores PRAGMA foreign_keys = OFF, and fires ON DELETE CASCADE", async ({ served }) => {
    const probe = await get(served.origin, "/foreign-keys");
    expect(probe.orphanError).toEqual(expect.stringContaining("FOREIGN KEY constraint failed"));
    expect(probe.orphanAfterOffError).toEqual(expect.stringContaining("FOREIGN KEY constraint failed"));
    expect(probe.foreignKeysAfterOff).toBe(1);
    expect(probe.childrenLeft).toBe(0);
  });
});

// Every guard in `src/auth/stores/` decides on `rowsWritten > 0`, so a matched write reporting zero
// would invert each one and refuse the write it should have allowed.
test.describe("D1 open question — which field a write reports rows-affected in", () => {
  test("populates both fields, and agrees between them, so the client's fallback never has to choose", async ({ served }) => {
    const probe = (await get(served.origin, "/rows-written")) as Record<
      string,
      { rows_written: number | null; changes: number | null; resolved: number }
    >;
    for (const [name, outcome] of Object.entries(probe)) {
      expect(`${name}: rows_written=${outcome.rows_written} changes=${outcome.changes}`).toBe(
        `${name}: rows_written=${outcome.changes} changes=${outcome.changes}`,
      );
      expect(outcome.rows_written).not.toBeNull();
    }
  });

  test("reports one for a write that matched and zero for one that did not, which is what every guard reads", async ({ served }) => {
    const probe = (await get(served.origin, "/rows-written")) as Record<string, { resolved: number }>;
    expect({
      updateMatched: probe.updateMatched?.resolved,
      updateUnmatched: probe.updateUnmatched?.resolved,
      updateGuardRefused: probe.updateGuardRefused?.resolved,
      deleteMatched: probe.deleteMatched?.resolved,
      deleteUnmatched: probe.deleteUnmatched?.resolved,
    }).toEqual({ updateMatched: 1, updateUnmatched: 0, updateGuardRefused: 0, deleteMatched: 1, deleteUnmatched: 0 });
  });

  test("counts a matched row whose value did not change, so re-stamping a state is `changed` and not a refusal", async ({ served }) => {
    // `setAdmin(false)` on a non-admin rests on this: the row matched the guard, so the write was
    // allowed, whatever it wrote.
    const probe = (await get(served.origin, "/rows-written")) as Record<string, { resolved: number }>;
    expect(probe.updateNoOp?.resolved).toBe(1);
  });
});

// `src/auth/stores/*.test.ts` proves each statement's text against a fake; this proves the statement,
// so mutating `NOT_LAST_ADMIN` turns these red where a fake's would stay green.
test.describe("the shipped store adapters against real D1", () => {
  let guards: Record<string, Record<string, unknown>>;

  test.beforeAll(async ({ served }) => {
    guards = (await get(served.origin, "/guards")) as Record<string, Record<string, unknown>>;
  });

  test("lets exactly one of two concurrent demotions of the last two admins through", () => {
    expect(guards.lastAdmin).toEqual({ demotions: ["changed", "last-admin-demote"], adminsLeft: 1 });
  });

  test("lets exactly one of two concurrent first-admin claims through against an empty deployment", () => {
    expect(guards.firstAdmin).toEqual({ claims: ["admin-exists", "changed"], adminsAfter: 1 });
  });

  test("demotes and deletes a deactivated admin, while still refusing the last one who could sign in", () => {
    expect(guards.deactivatedAdmin).toEqual({
      deactivateDave: "changed",
      deactivateGina: "changed",
      demoteDeactivated: "changed",
      removeDeactivated: "changed",
      demoteLastActive: "last-admin-demote",
      removeLastActive: "last-admin-delete",
    });
  });

  test("scopes every factor and credential write to its owner, spends the TOTP budget, refuses a replayed step, and clears every child table", () => {
    expect(guards.ownership).toEqual({
      removeByStranger: "not-found",
      removeByOwner: "changed",
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
      advanceByStranger: false,
      advanceFirst: true,
      advanceReplay: false,
      spentAfterAdvance: 0,
      confirmByStranger: false,
      removeFactorByStranger: "not-found",
      removeUser: "changed",
      // Only `frank` is left: the delete batch took the user and every child row together.
      leftBehind: {
        auth_access_tokens: 0,
        auth_credentials: 0,
        auth_factors: 0,
        auth_identity_links: 0,
        auth_otp_state: 0,
        auth_recovery_codes: 0,
        auth_users: 1,
      },
    });
  });

  test("refuses a duplicate hash, throttles a use stamp to its interval, scopes revocation to the owner, and hides a deactivated owner's token", () => {
    expect(guards.accessTokens).toEqual({
      duplicate: { code: "conflict", constraint: "auth_access_tokens.token_hash" },
      useFirst: true,
      useInsideInterval: false,
      useAtEdge: true,
      revokeByStranger: false,
      revokeByOwner: true,
      revokeAgain: false,
      foundWhileDeactivated: null,
      foundAfterReactivation: true,
    });
  });

  test("spends a live code once, never a staged or a stranger's, swaps sets on commit, and leaves no code behind a removed factor or a reset", () => {
    expect(guards.recoveryCodes).toEqual({
      confirmedAt: 1_700_000_000_002,
      consumeFirst: true,
      attemptsAfterFirst: 0,
      consumeReplay: false,
      // A code already spent clears no guesses: only the call that stamped it resets the counter.
      attemptsAfterReplay: 1,
      consumeByStranger: false,
      consumeStaged: false,
      heldStaged: true,
      heldStagedByStranger: false,
      remainingBeforeCommit: 1,
      remainingAfterCommit: 2,
      consumeRetired: false,
      consumeSwapped: true,
      removeLastTotp: "changed",
      codesAfterRemove: 0,
      codeFactorsAfterRemove: 0,
      resetFactors: "changed",
      leftAfterReset: { auth_credentials: 0, auth_factors: 0, auth_recovery_codes: 0, auth_sessions: 0 },
    });
  });

  test("revokes at the reset instant every token the user still held, keeps an earlier revocation's instant, and leaves another user's tokens live", () => {
    expect(guards.resetTokens?.revokedAt).toEqual({
      rae: { cli: 1_700_000_000_020, ci: 1_700_000_000_020, retired: 1_700_000_000_001 },
      sam: { "sam-cli": null },
    });
  });

  test("has requireBearer refuse a token it admitted before its owner's factor reset, while another user's token still passes", () => {
    expect({
      resetFactors: guards.resetTokens?.resetFactors,
      before: guards.resetTokens?.bearerBeforeReset,
      after: guards.resetTokens?.bearerAfterReset,
      stranger: guards.resetTokens?.bearerStrangerAfterReset,
    }).toEqual({ resetFactors: "changed", before: "200 null", after: '401 Bearer error="invalid_token"', stranger: "200 null" });
  });

  test("refuses to delete a user an app table still references, keeping every child row, and deletes once the reference is cleared", () => {
    expect(guards.referenced).toEqual({
      refused: "referenced",
      userKept: 1,
      factorKept: 1,
      unknownOwnerCode: "reference",
      afterClearing: "changed",
    });
  });

  test("lets exactly one of two concurrent removals of a mandatory passkey through, and with the app mandatory refuses the app while the optional passkey goes", () => {
    expect({ passkeyPair: guards.secondFactorFloor?.passkeyPair, totpAndPasskey: guards.secondFactorFloor?.totpAndPasskey }).toEqual({
      passkeyPair: ["changed", "second-factor-required"],
      totpAndPasskey: { totp: "second-factor-required", passkey: "changed" },
    });
    expect({ pia: guards.secondFactorFloor?.piaLeft, quinn: guards.secondFactorFloor?.quinnLeft }).toEqual({
      pia: { credentials: 1, secondFactors: 1, removedEvents: 1, sessions: 0 },
      quinn: { secondFactors: 1, kinds: ["totp-app"], credentials: 0, removedEvents: 1, sessions: 0 },
    });
  });

  test("refuses a mandatory app without an event or a revoked session, still removes a pending app, and lets an admin reset clear a user at the minimum", () => {
    expect(guards.secondFactorFloor).toMatchObject({
      lastRefused: "second-factor-required",
      rheaAfterRefusal: { secondFactors: 1, removedEvents: 0, sessions: 1 },
      resetAtMinimum: "changed",
      rheaAfterReset: { secondFactors: 0, removedEvents: 0, sessions: 0 },
      pendingRemoved: "changed",
      saulLeft: { secondFactors: 1, removedEvents: 0, sessions: 0 },
    });
  });

  test("lets a user's last optional passkey go, recording the removal and revoking their other sessions", () => {
    expect({ removed: guards.secondFactorFloor?.lastOptionalPasskey, left: guards.secondFactorFloor?.tessLeft }).toEqual({
      removed: "changed",
      left: { credentials: 0, secondFactors: 0, removedEvents: 1, sessions: 0 },
    });
  });

  test("refuses a user's last mandatory passkey without an event, a revoked session or a dropped credential", () => {
    expect({ refused: guards.secondFactorFloor?.lastPasskeyRefused, left: guards.secondFactorFloor?.ivyLeft }).toEqual({
      refused: "second-factor-required",
      left: { credentials: 1, secondFactors: 1, removedEvents: 0, sessions: 1 },
    });
  });

  test("counts a passkey only while its factor row is confirmed, so an app beside an unconfirmed passkey is the last second factor", () => {
    expect({ outcomes: guards.secondFactorFloor?.unconfirmedPasskey, left: guards.secondFactorFloor?.umaLeft }).toEqual({
      outcomes: { totpRemoval: "second-factor-required", passkeyRemoval: "changed" },
      left: { credentials: 0, secondFactors: 1, removedEvents: 1, sessions: 0 },
    });
  });

  test("lets an optional kind go and refuses a mandatory one, whatever else the user holds", () => {
    expect({ outcomes: guards.secondFactorFloor?.kindOutsideFloor, left: guards.secondFactorFloor?.vicLeft }).toEqual({
      outcomes: {
        passkeyUnderPasskeyFloor: "second-factor-required",
        totpUnderTotpFloor: "second-factor-required",
        passkeyUnderTotpFloor: "changed",
        totpUnderPasskeyFloor: "changed",
      },
      left: { credentials: 0, secondFactors: 0, removedEvents: 2, sessions: 0 },
    });
  });

  test("keeps a stale TOTP row whose owner could step up with nothing else, purges one beside a confirmed passkey or unused codes, and counts what it kept", () => {
    expect(guards.staleTotpPurge).toMatchObject({
      report: { purged: 3, kept: 4 },
      totpOnly: { totp: true, codes: 0 },
      withPasskey: { totp: false, codes: 0 },
      withCodes: { totp: false, codes: 1 },
      unconfirmedPasskey: { totp: true, codes: 0 },
      stagedCodes: { totp: true, codes: 0 },
      fresh: { totp: true, codes: 0 },
    });
  });

  test("keeps a stale TOTP row whose owner has spent every recovery code, and drops a never-confirmed one nobody steps up with", () => {
    expect({ usedCodes: guards.staleTotpPurge?.usedCodes, pendingTotp: guards.staleTotpPurge?.pendingTotp }).toEqual({
      usedCodes: { spent: true, totp: true, codes: 0 },
      pendingTotp: { totp: false, codes: 0 },
    });
  });

  test("refuses a second authenticator-app row for one user, so no stale row can sit beside a fresh one", () => {
    expect(guards.staleTotpPurge?.secondTotp).toBe("conflict");
  });

  test("removes a pending app that is a user's only factor row, recording no event and revoking no session", () => {
    expect({ outcome: guards.secondFactorFloor?.onlyPendingRemoved, left: guards.secondFactorFloor?.wadeLeft }).toEqual({
      outcome: "changed",
      left: { factors: 0, secondFactors: 0, removedEvents: 0, sessions: 1 },
    });
  });
});

// The whole reason the challenge and nonce stores left KV. A fake settles neither: both rest on the
// database serialising writers, which is exactly what a fake stands in for.
test.describe("the ephemeral stores against real D1", () => {
  let guards: Record<string, Record<string, unknown>>;

  test.beforeAll(async ({ served }) => {
    guards = (await get(served.origin, "/guards")) as Record<string, Record<string, unknown>>;
  });

  test("hands one challenge to exactly one of three concurrent takes, and lets exactly one consume a nonce", () => {
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

  test("refuses an over-long address at the CHECK, and calls it the caller's fault rather than an outage", () => {
    expect(guards.emailLength).toEqual({ refusedCode: "invalid", acceptedOk: true, rows: 1 });
  });
});

// A guarded `UPDATE` matching nothing commits the batch; an appended fragment can abort it only if
// `changes()` carries between statements and an expression can raise outside a trigger.
test.describe("D1 open question — a rows-written guard inside batch()", () => {
  let probe: Record<string, unknown>;

  test.beforeAll(async ({ served }) => {
    probe = await get(served.origin, "/changes");
  });

  test("reports the previous statement's count through changes() in the next statement of the batch", () => {
    expect({ matched: probe.changesAfterMatched, unmatched: probe.changesAfterUnmatched }).toEqual({ matched: 1, unmatched: 0 });
  });

  test("raises a runtime error from abs() of the minimum int64, the one scalar that can fail outside a trigger", () => {
    expect(probe.overflowError).toBe("D1_ERROR: integer overflow: SQLITE_ERROR");
  });

  test("aborts and rolls back the whole batch when the guard sees zero rows written", () => {
    expect(probe.guardAbortError).toBe("D1_ERROR: integer overflow: SQLITE_ERROR");
    expect(probe.afterAbort).toEqual([1]);
  });

  test("lets the batch commit when the guarded write matched", () => {
    expect(probe.guardPassError).toBeNull();
    expect(probe.afterPass).toEqual([1, 3]);
  });
});

test.describe("D1 open question — the JavaScript shape of a BLOB column", () => {
  test("reads a BLOB back as a plain Array of byte values, with the bytes intact", async ({ served }) => {
    // Exact, not one-of-three: `blobBytes` claims this is what the runtime measured, and a claim
    // held by an `||` over every branch it might take is not a measurement.
    const probe = await get(served.origin, "/blob");
    expect({ constructorName: probe.constructorName, isArray: probe.isArray, isArrayBuffer: probe.isArrayBuffer }).toEqual({
      constructorName: "Array",
      isArray: true,
      isArrayBuffer: false,
    });
    expect(probe.bytes).toEqual([1, 2, 3, 250, 251, 252]);
  });
});

test.describe("adminUsers.remove and the schema's cascade, on a private real D1", () => {
  const CHILDREN = [
    "auth_access_tokens",
    "auth_credentials",
    "auth_factors",
    "auth_identity_links",
    "auth_otp_state",
    "auth_recovery_codes",
    "auth_security_events",
    "auth_sessions",
  ] as const;
  let d1: TestD1;

  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.beforeAll(async () => {
    d1 = await openAuthD1();
  });

  test.afterAll(async () => {
    await d1?.dispose();
  });

  test.beforeEach(() => d1.reset());

  /** One row in every auth table that references `auth_users`, owned by `userId`. */
  async function withEveryChild(userId: string): Promise<void> {
    const owner = uuidToBytes(userId);
    const id = () => uuidToBytes(uuidv7());
    await d1.binding.batch([
      d1.binding
        .prepare("INSERT INTO auth_access_tokens (id, user_id, token_hash, label, scopes, created_at) VALUES (?, ?, ?, 'cli', '[]', 1)")
        .bind(id(), owner, tokenHash()),
      d1.binding
        .prepare(
          "INSERT INTO auth_credentials (id, user_id, credential_id, public_key, algorithm, created_at, updated_at) VALUES (?, ?, ?, ?, -7, 1, 1)",
        )
        .bind(id(), owner, `credential-${uuidv7()}`, new Uint8Array(65)),
      d1.binding.prepare("INSERT INTO auth_factors (id, user_id, kind, created_at, updated_at) VALUES (?, ?, 'passkey', 1, 1)").bind(id(), owner),
      d1.binding
        .prepare("INSERT INTO auth_identity_links (id, user_id, provider, subject, created_at, updated_at) VALUES (?, ?, 'github', ?, 1, 1)")
        .bind(id(), owner, uuidv7()),
      d1.binding.prepare("INSERT INTO auth_otp_state (user_id, token, issued_at, expires_at) VALUES (?, 'otp', 1, 2)").bind(owner),
      d1.binding.prepare("INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, 1)").bind(id(), owner, tokenHash()),
      d1.binding.prepare("INSERT INTO auth_security_events (id, user_id, type, at) VALUES (?, ?, 'signed-in', 1)").bind(id(), owner),
      d1.binding
        .prepare("INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, id, last_seen_at) VALUES (?, ?, 1, 2, ?, 1)")
        .bind(tokenHash(), owner, id()),
    ]);
  }

  async function heldBy(userId: string): Promise<Record<string, number>> {
    const owner = uuidToBytes(userId);
    const counted: Record<string, number> = {};
    for (const table of ["auth_users", ...CHILDREN]) {
      const column = table === "auth_users" ? "id" : "user_id";
      const row = await d1.binding.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).bind(owner).first<{ n: number }>();
      counted[table] = row?.n ?? -1;
    }
    return counted;
  }

  const every = (n: number) => Object.fromEntries(["auth_users", ...CHILDREN].map((table) => [table, n]));

  test("deletes a member and leaves no row of theirs in any child table, while the last admin keeps every row", async () => {
    const member = await signedUp(d1, 1, { verifiedAt: 1 });
    const admin = await signedUp(d1, 1, { verifiedAt: 1, isAdmin: true });
    await withEveryChild(member);
    await withEveryChild(admin);
    const outcome = await createAdminUserStore(createD1Client(d1.binding)).remove(member);
    expect({ outcome, member: await heldBy(member), admin: await heldBy(admin) }).toEqual({
      outcome: { ok: true, data: "changed" },
      member: every(0),
      admin: every(1),
    });
  });

  test("refuses to delete the last admin who could sign in, and leaves that admin's row in every child table", async () => {
    const admin = await signedUp(d1, 1, { verifiedAt: 1, isAdmin: true });
    await withEveryChild(admin);
    const outcome = await createAdminUserStore(createD1Client(d1.binding)).remove(admin);
    expect({ outcome, admin: await heldBy(admin) }).toEqual({ outcome: { ok: true, data: "last-admin-delete" }, admin: every(1) });
  });

  test("answers referenced when an app key's SET NULL over a STRICT primary key refuses the member's deletion, and leaves every row of theirs", async () => {
    await d1.binding.prepare("CREATE TABLE app_devices (sid BLOB PRIMARY KEY REFERENCES auth_users (id) ON DELETE SET NULL) STRICT").run();
    const member = await signedUp(d1, 1, { verifiedAt: 1 });
    await withEveryChild(member);
    await d1.binding.prepare("INSERT INTO app_devices (sid) VALUES (?)").bind(uuidToBytes(member)).run();
    const outcome = await createAdminUserStore(createD1Client(d1.binding)).remove(member);
    const [device] = await d1.rows<{ n: number }>("SELECT count(*) AS n FROM app_devices WHERE sid IS NOT NULL");
    expect({ outcome, member: await heldBy(member), device: device?.n }).toEqual({
      outcome: { ok: true, data: "referenced" },
      member: every(1),
      device: 1,
    });
  });
});
