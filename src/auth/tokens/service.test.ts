import { describe, expect, it } from "bun:test";

import { bytesToHex, sha256 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS, AUTH_ACCESS_TOKEN_USE_INTERVAL_MS } from "../config";
import { AuthStoreError } from "../errors";
import type { AccessTokenStore, AuthAccessToken, AuthAccessTokenInput } from "../types";
import { formatAccessToken } from "./codec";
import { createAccessTokenService } from "./service";

const AT = 1_700_000_000_000;
const DAY_MS = 86_400_000;
const USER_ID = "01a08574-257c-71bd-8eb7-f399ec130d31";

interface StoredToken {
  readonly record: AuthAccessToken;
  readonly input: AuthAccessTokenInput;
}

interface FakeTokenStore {
  readonly store: AccessTokenStore;
  readonly rows: StoredToken[];
  readonly calls: string[];
  readonly uses: [string, number, number][];
}

/** An array-backed `AccessTokenStore` that keeps every call made against it; `fail` names the methods that answer an outage. */
function fakeTokenStore(fail: readonly (keyof AccessTokenStore)[] = [], recordUse = true): FakeTokenStore {
  const rows: StoredToken[] = [];
  const calls: string[] = [];
  const uses: [string, number, number][] = [];
  const outage = (operation: string) => Promise.resolve(err(new AuthStoreError("unavailable", operation)));
  const store: AccessTokenStore = {
    create(input, at) {
      calls.push("create");
      if (fail.includes("create")) return Promise.resolve(err(new AuthStoreError("conflict", "accessTokens.create", { constraint: "x" })));
      const record: AuthAccessToken = {
        id: `t${rows.length + 1}`,
        userId: input.userId,
        label: input.label,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: at,
      };
      rows.push({ record, input });
      return Promise.resolve(ok(record));
    },
    findByHash(tokenHash) {
      calls.push("findByHash");
      if (fail.includes("findByHash")) return outage("accessTokens.findByHash");
      const found = rows.find((row) => bytesToHex(row.input.tokenHash) === bytesToHex(tokenHash));
      return Promise.resolve(ok(found?.record ?? null));
    },
    listByUser(userId) {
      calls.push("listByUser");
      return Promise.resolve(ok(rows.filter((row) => row.record.userId === userId).map((row) => row.record)));
    },
    recordUse(id, at, intervalMs) {
      calls.push("recordUse");
      uses.push([id, at, intervalMs]);
      if (fail.includes("recordUse")) return outage("accessTokens.recordUse");
      return Promise.resolve(ok(recordUse));
    },
    revoke(id, userId, at) {
      calls.push(`revoke ${id} ${userId} ${at}`);
      return Promise.resolve(ok(true));
    },
  };
  return { store, rows, calls, uses };
}

const SCOPES = ["notes:read", "notes:write"] as const;

function serviceOver(fake: FakeTokenStore, overrides: { maxLifetimeMs?: number | null; useIntervalMs?: number } = {}) {
  return createAccessTokenService({ store: fake.store, prefix: "nt_", scopes: SCOPES, ...overrides });
}

async function issued(fake: FakeTokenStore, scopes: readonly (typeof SCOPES)[number][] = ["notes:read"], expiresAt: number | null = AT + DAY_MS) {
  const outcome = await serviceOver(fake).issue({ userId: USER_ID, label: "CLI", scopes, expiresAt }, AT);
  if (!outcome.ok) throw new Error(`issue failed: ${String(outcome.error)}`);
  return outcome.data;
}

/** Replaces the stored record for the first row, as a revocation or a schema change would have left it. */
function rewriteFirst(fake: FakeTokenStore, change: Partial<AuthAccessToken>): void {
  const [row] = fake.rows;
  if (row === undefined) throw new Error("no row to rewrite");
  fake.rows[0] = { ...row, record: { ...row.record, ...change } };
}

describe("createAccessTokenService — construction", () => {
  const build = (options: Record<string, unknown>) => () =>
    createAccessTokenService({ store: fakeTokenStore().store, prefix: "nt_", scopes: SCOPES, ...options } as never);

  it("throws on a prefix a scanner cannot key on", () => {
    expect(build({ prefix: "NT_" })).toThrow('createAccessTokenService: prefix "NT_" must match');
  });

  it("throws on an empty, duplicated or unsayable scope list", () => {
    expect(build({ scopes: [] })).toThrow("createAccessTokenService: scopes is empty");
    expect(build({ scopes: ["notes:read", "notes:read"] })).toThrow('scope "notes:read" is listed more than once');
    for (const scope of ["notes read", 'notes"read', "notes\\read"]) {
      expect(build({ scopes: [scope] })).toThrow(`scope "${scope}" cannot be written in a WWW-Authenticate header`);
    }
  });

  it("throws on a lifetime under a minute or not whole, and on a negative use interval", () => {
    expect(build({ maxLifetimeMs: 59_999 })).toThrow("maxLifetimeMs is 59999, below the 60000-millisecond floor");
    expect(build({ maxLifetimeMs: 1.5 })).toThrow("maxLifetimeMs is 1.5, which is not a whole number");
    expect(build({ useIntervalMs: -1 })).toThrow("useIntervalMs is -1, below the 0-millisecond floor");
  });
});

describe("createAccessTokenService — issue", () => {
  it("returns a token in the wire shape and stores only its SHA-256", async () => {
    const fake = fakeTokenStore();
    const { token } = await issued(fake);
    expect(token).toMatch(/^nt_[A-Z2-7]{46}$/);
    const stored = fake.rows[0]?.input;
    expect(stored?.tokenHash).toEqual(await sha256(token));
    expect(JSON.stringify({ ...stored, tokenHash: bytesToHex(stored?.tokenHash ?? new Uint8Array()) })).not.toContain(token.slice(3));
  });

  it("stores the scopes deduplicated and sorted", async () => {
    const fake = fakeTokenStore();
    const { accessToken } = await issued(fake, ["notes:write", "notes:read", "notes:write"]);
    expect(fake.rows[0]?.input.scopes).toEqual(["notes:read", "notes:write"]);
    expect(accessToken.scopes).toEqual(["notes:read", "notes:write"]);
  });

  it("refuses no scope, a scope outside the configured set, and a missing expiry while one is bound", async () => {
    const service = serviceOver(fakeTokenStore());
    const input = { userId: USER_ID, label: "CLI", expiresAt: AT + DAY_MS };
    expect(await service.issue({ ...input, scopes: [] }, AT)).toEqual({ ok: false, error: "no-scope" });
    expect(await service.issue({ ...input, scopes: ["admin" as "notes:read"] }, AT)).toEqual({ ok: false, error: "scope-unknown" });
    expect(await service.issue({ ...input, scopes: ["notes:read"], expiresAt: null }, AT)).toEqual({ ok: false, error: "expiry-required" });
  });

  it("refuses an expiry that is not after now, past the ceiling, or not a whole number, and admits one at the ceiling", async () => {
    const service = serviceOver(fakeTokenStore());
    const issueAt = (expiresAt: number) => service.issue({ userId: USER_ID, label: "CLI", scopes: ["notes:read"], expiresAt }, AT);
    for (const expiresAt of [AT, AT - 1, AT + AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS + 1, Number.NaN]) {
      expect(`${expiresAt}: ${JSON.stringify(await issueAt(expiresAt))}`).toBe(`${expiresAt}: {"ok":false,"error":"expiry-out-of-range"}`);
    }
    expect((await issueAt(AT + AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS)).ok).toBe(true);
  });

  it("admits a token with no expiry only once the ceiling is lifted", async () => {
    const outcome = await serviceOver(fakeTokenStore(), { maxLifetimeMs: null }).issue(
      { userId: USER_ID, label: "CLI", scopes: ["notes:read"], expiresAt: null },
      AT,
    );
    expect(outcome.ok && outcome.data.accessToken.expiresAt).toBeNull();
  });

  it("returns the store's conflict rather than a token", async () => {
    const outcome = await serviceOver(fakeTokenStore(["create"])).issue(
      { userId: USER_ID, label: "CLI", scopes: ["notes:read"], expiresAt: AT + DAY_MS },
      AT,
    );
    expect(!outcome.ok && outcome.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createAccessTokenService — verify", () => {
  it("refuses a malformed or checksum-mismatched token without asking the store", async () => {
    const fake = fakeTokenStore();
    const service = serviceOver(fake);
    const token = formatAccessToken("nt_", new Uint8Array(24));
    const mismatched = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await service.verify("nt_short", AT)).toEqual({ ok: false, error: "malformed" });
    expect(await service.verify(mismatched, AT)).toEqual({ ok: false, error: "checksum-mismatch" });
    expect(fake.calls).toEqual([]);
  });

  it("refuses a well-formed token the store does not hold as unknown", async () => {
    expect(await serviceOver(fakeTokenStore()).verify(formatAccessToken("nt_", new Uint8Array(24)), AT)).toEqual({ ok: false, error: "unknown" });
  });

  it("refuses a revoked token", async () => {
    const fake = fakeTokenStore();
    const { token } = await issued(fake);
    rewriteFirst(fake, { revokedAt: AT + 1 });
    expect(await serviceOver(fake).verify(token, AT + 2)).toEqual({ ok: false, error: "revoked" });
  });

  it("refuses a token from the instant it expires, and admits it the millisecond before", async () => {
    const fake = fakeTokenStore();
    const { token } = await issued(fake);
    expect(await serviceOver(fake).verify(token, AT + DAY_MS)).toEqual({ ok: false, error: "expired" });
    expect((await serviceOver(fake).verify(token, AT + DAY_MS - 1)).ok).toBe(true);
  });

  it("refuses a token missing a required scope, and admits one holding it", async () => {
    const fake = fakeTokenStore();
    const { token } = await issued(fake, ["notes:read"]);
    expect(await serviceOver(fake).verify(token, AT, ["notes:write"])).toEqual({ ok: false, error: "insufficient-scope" });
    expect((await serviceOver(fake).verify(token, AT, ["notes:read"])).ok).toBe(true);
  });

  it("surfaces a lookup failure and a use-stamp failure as the store's error", async () => {
    const failing = fakeTokenStore(["findByHash"]);
    const lookup = await serviceOver(failing).verify(formatAccessToken("nt_", new Uint8Array(24)), AT);
    expect(!lookup.ok && lookup.error).toBeInstanceOf(AuthStoreError);

    const fake = fakeTokenStore(["recordUse"]);
    const { token } = await issued(fake);
    const stamp = await serviceOver(fake).verify(token, AT);
    expect(!stamp.ok && stamp.error).toBeInstanceOf(AuthStoreError);
  });

  it("stamps the use with the token id, the clock and the configured interval, and admits a throttled stamp", async () => {
    const fake = fakeTokenStore([], false);
    const { token, accessToken } = await issued(fake);
    expect((await serviceOver(fake).verify(token, AT + 5)).ok).toBe(true);
    expect((await serviceOver(fake, { useIntervalMs: 30_000 }).verify(token, AT + 6)).ok).toBe(true);
    expect(fake.uses).toEqual([
      [accessToken.id, AT + 5, AUTH_ACCESS_TOKEN_USE_INTERVAL_MS],
      [accessToken.id, AT + 6, 30_000],
    ]);
  });

  it("drops a stored scope the service is no longer configured with", async () => {
    const fake = fakeTokenStore();
    const { token } = await issued(fake);
    rewriteFirst(fake, { scopes: ["notes:read", "notes:delete"] });
    const outcome = await serviceOver(fake).verify(token, AT);
    expect(outcome.ok && outcome.data.scopes).toEqual(["notes:read"]);
  });

  it("throws when asked to require a scope outside the configured set", async () => {
    const service = serviceOver(fakeTokenStore());
    await expect(service.verify("nt_x", AT, ["admin" as "notes:read"])).rejects.toThrow('verify was asked for scope "admin"');
  });
});

describe("createAccessTokenService — list and revoke", () => {
  it("lists the owner's tokens with scopes narrowed to the configured set", async () => {
    const fake = fakeTokenStore();
    await issued(fake);
    rewriteFirst(fake, { scopes: ["notes:read", "notes:delete"] });
    const listed = await serviceOver(fake).list(USER_ID);
    expect(listed.ok && listed.data.map((token) => token.scopes)).toEqual([["notes:read"]]);
  });

  it("passes the owner through to the store's revoke", async () => {
    const fake = fakeTokenStore();
    expect(await serviceOver(fake).revoke("t1", USER_ID, AT)).toEqual({ ok: true, data: true });
    expect(fake.calls).toEqual([`revoke t1 ${USER_ID} ${AT}`]);
  });
});
