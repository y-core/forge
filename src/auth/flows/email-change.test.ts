import { beforeAll, describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import { encodeAuthToken } from "../keys/token";
import type { AuthKeyRing, AuthMessage, AuthUser, NonceStore, UserStore } from "../types";
import { createEmailChangeFlow } from "./email-change";
import type { AuthIssueOutcome } from "./types";
import type { AuthEmailChangeOptions } from "./types";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const AT = 1_700_000_000_000;
const TTL_MS = 3_600_000;

let ring: AuthKeyRing;
let otherRing: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["0ebb4b947b8932ef8a3c1f23c024a2cdf4abcd964cc1d3d064e2c068e432f1cf"]);
  otherRing = await importAuthKeyRing(["101f3337ee51271b31e79987455885364eb5fe70e876ffaf48b6db5a18415800"]);
});

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "person@example.com",
    emailKey: "person@example.com",
    emailVerifiedAt: 1_600_000_000_000,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    sessionsInvalidBefore: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface EmailWrite {
  id: string;
  email: string;
  emailKey: string;
}

function fakeUsers(seed: readonly AuthUser[], options: { conflict?: boolean; unavailable?: boolean } = {}) {
  const rows = [...seed];
  const writes: EmailWrite[] = [];
  const verified: string[] = [];
  const revoked: { id: string; at: number }[] = [];
  const store: UserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    findByEmailKey: (emailKey) => Promise.resolve(ok(rows.find((row) => row.emailKey === emailKey) ?? null)),
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: (id) => {
      verified.push(id);
      return Promise.resolve(ok(true));
    },
    revokeSessions: (id, at) => {
      revoked.push({ id, at });
      return Promise.resolve(ok(true));
    },
    changeEmail: (id, email, emailKey, at) => {
      if (options.conflict) {
        return Promise.resolve(err(new AuthStoreError("conflict", "users.changeEmail", { constraint: "auth_users.email_key" })));
      }
      if (options.unavailable) return Promise.resolve(err(new AuthStoreError("unavailable", "users.changeEmail")));
      writes.push({ id, email, emailKey });
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, email, emailKey, emailVerifiedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
  };
  return { store, rows, writes, verified, revoked };
}

function fakeNonces() {
  const seen = new Set<string>();
  const store: NonceStore = {
    markConsumed: (key) => {
      if (seen.has(key)) return Promise.resolve(ok(false));
      seen.add(key);
      return Promise.resolve(ok(true));
    },
  };
  return { store, seen };
}

/** Delivery hangs until `release`, which is how a test can prove `request` did not wait for it. */
function fakeNotifier() {
  const sent: AuthMessage[] = [];
  let release: () => void = () => {};
  const delivered = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    notifier: {
      send: async (message: AuthMessage) => {
        sent.push(message);
        await delivered;
        return ok();
      },
    },
    sent,
    release,
  };
}

function scene(
  seed: readonly AuthUser[] = [userRow()],
  options: { conflict?: boolean; unavailable?: boolean } = {},
  overrides: Partial<AuthEmailChangeOptions> = {},
) {
  const users = fakeUsers(seed, options);
  const nonces = fakeNonces();
  const mail = fakeNotifier();
  const scheduled: Promise<AuthIssueOutcome>[] = [];
  const flow = createEmailChangeFlow({
    keys: ring,
    users: users.store,
    nonces: nonces.store,
    notifier: mail.notifier,
    defer: (work) => void scheduled.push(work),
    confirmUrl: (token) => `https://example.com/account/email/confirm?token=${token}`,
    ...overrides,
  });
  return { flow, users, nonces, mail, scheduled };
}

/** Lets the held delivery finish, then drains the deferred work the flow handed over. */
async function settle(built: ReturnType<typeof scene>): Promise<readonly AuthIssueOutcome[]> {
  built.mail.release();
  return Promise.all(built.scheduled);
}

function tokenOf(sent: readonly AuthMessage[]): string {
  const url = sent[0]?.url;
  if (!url) throw new Error("no confirmation mail was sent");
  return new URL(url).searchParams.get("token") ?? "";
}

describe("createEmailChangeFlow — requesting", () => {
  // The move is authorised by whoever owns the address the account already holds, not by whoever
  // holds the session: without this a stolen cookie moves the account to the thief's own inbox and
  // locks the owner out of the primary factor for good.
  it("mails the confirmation link to the address the account already holds, off the caller's clock", async () => {
    const built = scene();
    // Delivery is still hanging here, and `request` has already answered: the send is deferred work
    // and not part of what the caller waits for.
    const requested = await built.flow.request(USER_ID, "  New@Example.com  ", AT);
    expect(requested).toEqual({ ok: true, data: { expiresAt: AT + TTL_MS, sentTo: "person@example.com" } });
    expect(built.scheduled).toHaveLength(1);
    expect(await settle(built)).toEqual(["challenged"]);
    expect(built.mail.sent).toHaveLength(1);
    expect(built.mail.sent[0]?.to).toBe("person@example.com");
    expect(built.mail.sent[0]?.kind).toBe("email-change");
  });

  // An unverified address has proved nothing, so asking it to authorise the move would be asking
  // nobody. The new address is the only one there is to ask.
  it("falls back to the new address when the account's own is unverified, and says so", async () => {
    const built = scene([userRow({ emailVerifiedAt: null })]);
    const requested = await built.flow.request(USER_ID, "  New@Example.com  ", AT);
    expect(requested).toEqual({ ok: true, data: { expiresAt: AT + TTL_MS, sentTo: "New@Example.com" } });
    await settle(built);
    expect(built.mail.sent[0]?.to).toBe("New@Example.com");
  });

  // Telling a signed-in visitor that the address they typed is registered is the same enumeration
  // answer the sign-in flow refuses to give; the unique index refuses the write at confirmation.
  it("never looks the new address up, so it cannot report one as taken", async () => {
    const built = scene([userRow(), userRow({ id: OTHER_ID, email: "taken@example.com", emailKey: "taken@example.com" })]);
    const requested = await built.flow.request(USER_ID, "taken@example.com", AT);
    expect(requested).toEqual({ ok: true, data: { expiresAt: AT + TTL_MS, sentTo: "person@example.com" } });
  });

  it("refuses the address the account already holds, in any spelling", async () => {
    const built = scene();
    expect(await built.flow.request(USER_ID, "PERSON@example.com", AT)).toEqual({ ok: false, error: "unchanged" });
    expect(built.scheduled).toHaveLength(0);
  });

  it("refuses an unknown account and a deactivated one", async () => {
    expect(await scene([]).flow.request(USER_ID, "new@example.com", AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(await scene([userRow({ deactivatedAt: 1_650_000_000_000 })]).flow.request(USER_ID, "new@example.com", AT)).toEqual({
      ok: false,
      error: "deactivated",
    });
  });
});

describe("createEmailChangeFlow — confirming", () => {
  /** The `approve` link a verified account's own address received. */
  async function requested(built: ReturnType<typeof scene>, address = "new@example.com"): Promise<string> {
    await built.flow.request(USER_ID, address, AT);
    await settle(built);
    return tokenOf(built.mail.sent);
  }

  /** The `move` link the new address received once the old one approved. */
  async function approved(built: ReturnType<typeof scene>, address = "new@example.com"): Promise<string> {
    const approve = await requested(built, address);
    const forwarded = await built.flow.confirm(approve, AT + 500);
    if (!forwarded.ok || forwarded.data.status !== "forwarded") throw new Error("the approval was not forwarded");
    await Promise.all(built.scheduled);
    return tokenOf(built.mail.sent.slice(1));
  }

  // The defect this closes: the old address answered, and the row was stamped verified on a new
  // address that had answered nothing — a verified primary factor nobody had proved they could read.
  it("forwards an approved change to the new address, and moves the row only when that address answers", async () => {
    const built = scene();
    const approve = await requested(built, "New@Example.com");
    expect(built.mail.sent.map((message) => message.to)).toEqual(["person@example.com"]);

    const forwarded = await built.flow.confirm(approve, AT + 500);
    expect(forwarded).toEqual({ ok: true, data: { status: "forwarded", sentTo: "New@Example.com", expiresAt: AT + 500 + TTL_MS } });
    expect(built.users.writes).toEqual([]);
    expect(await Promise.all(built.scheduled)).toEqual(["challenged", "challenged"]);
    expect(built.mail.sent.map((message) => message.to)).toEqual(["person@example.com", "New@Example.com"]);

    const move = tokenOf(built.mail.sent.slice(1));
    expect(move).not.toBe(approve);
    const moved = await built.flow.confirm(move, AT + 1_000);
    expect(moved.ok && moved.data.status).toBe("moved");
    expect(moved.ok && moved.data.status === "moved" && moved.data.user.emailVerifiedAt).toBe(AT + 1_000);
    expect(built.users.writes).toEqual([{ id: USER_ID, email: "New@Example.com", emailKey: "new@example.com" }]);
    expect(built.users.verified).toEqual([]);
    expect(built.users.rows[0]?.emailVerifiedAt).toBe(AT + 1_000);
  });

  it("never moves the row on an approve token, whatever a caller does with it", async () => {
    const built = scene();
    const approve = await requested(built);
    await built.flow.confirm(approve, AT + 500);
    expect(await built.flow.confirm(approve, AT + 600)).toEqual({ ok: false, error: "consumed" });
    const forged = await encodeAuthToken(ring, "identity", `approve ${USER_ID} new@example.com`, TTL_MS, { now: AT });
    const outcome = await built.flow.confirm(forged, AT + 700);
    expect(outcome.ok && outcome.data.status).toBe("forwarded");
    expect(built.users.writes).toEqual([]);
  });

  // An unverified address has proved nothing, so there is no mailbox to ask for approval and the
  // one link goes straight to the new address as a `move`.
  it("moves an unverified account in one step, from the link its new address received", async () => {
    const built = scene([userRow({ emailVerifiedAt: null })]);
    const move = await requested(built, "new@example.com");
    const moved = await built.flow.confirm(move, AT + 1_000);
    expect(moved.ok && moved.data.status).toBe("moved");
    expect(built.mail.sent.map((message) => message.to)).toEqual(["new@example.com"]);
    expect(built.users.writes).toEqual([{ id: USER_ID, email: "new@example.com", emailKey: "new@example.com" }]);
  });

  it("refuses a padded spelling of a live token as unrecognised, never as consumed", async () => {
    const built = scene();
    const move = await approved(built);
    expect(await built.flow.confirm(`${move}=`, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
    expect((await built.flow.confirm(move, AT + 1_000)).ok).toBe(true);
  });

  // The address is inside the sealed payload, so there is no argument a caller could point at
  // another mailbox: a token issued for one address can only ever land that address.
  it("lands the token's own address, never another the caller might prefer", async () => {
    for (const address of ["one@example.com", "two@example.com"]) {
      const built = scene();
      const token = await approved(built, address);
      await built.flow.confirm(token, AT + 1_000);
      expect(`${address}: ${built.users.writes[0]?.email}`).toBe(`${address}: ${address}`);
    }
  });

  it("refuses a token whose payload was altered, and one sealed under another ring or purpose", async () => {
    const built = scene();
    const token = await requested(built);
    const flipped = `${token.slice(0, -2)}${token.slice(-2) === "AA" ? "AB" : "AA"}`;
    expect(await built.flow.confirm(flipped, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });

    const foreign = await encodeAuthToken(otherRing, "identity", `move ${USER_ID} evil@example.com`, TTL_MS, { now: AT });
    expect(await built.flow.confirm(foreign, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });

    const wrongPurpose = await encodeAuthToken(ring, "verify", `move ${USER_ID} evil@example.com`, TTL_MS, { now: AT });
    expect(await built.flow.confirm(wrongPurpose, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
    expect(built.users.writes).toEqual([]);
  });

  it("refuses the same move token a second time, so an intercepted link is spent once", async () => {
    const built = scene();
    const token = await approved(built);
    expect((await built.flow.confirm(token, AT + 1_000)).ok).toBe(true);
    expect(await built.flow.confirm(token, AT + 2_000)).toEqual({ ok: false, error: "consumed" });
    expect(built.users.writes).toHaveLength(1);
  });

  it("refuses a token past its window", async () => {
    const built = scene();
    const token = await requested(built);
    expect(await built.flow.confirm(token, AT + TTL_MS)).toEqual({ ok: false, error: "expired" });
  });

  it("names the user out of the token, so a link only ever moves the account it was issued for", async () => {
    const built = scene([userRow({ id: OTHER_ID, email: "other@example.com", emailKey: "other@example.com" })]);
    const token = await encodeAuthToken(ring, "identity", `move ${OTHER_ID} moved@example.com`, TTL_MS, { now: AT });
    const confirmed = await built.flow.confirm(token, AT + 1_000);
    expect(confirmed.ok && confirmed.data.status === "moved" && confirmed.data.user.id).toBe(OTHER_ID);
    expect(built.users.writes).toEqual([{ id: OTHER_ID, email: "moved@example.com", emailKey: "moved@example.com" }]);
  });

  // `request` deliberately never looks the address up, so reporting the index that caught it would
  // hand back at confirmation exactly the enumeration answer the request withheld.
  it("reports a collision with a registered address as the same refusal an unknown account gets", async () => {
    const built = scene([userRow()], { conflict: true });
    const token = await approved(built, "taken@example.com");
    expect(await built.flow.confirm(token, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("still surfaces a store outage as the store's own error, so a transient failure is not a refusal", async () => {
    const built = scene([userRow()], { unavailable: true });
    const token = await approved(built, "new@example.com");
    const confirmed = await built.flow.confirm(token, AT + 1_000);
    if (confirmed.ok) throw new Error("the outage was accepted");
    expect(confirmed.error).toBeInstanceOf(AuthStoreError);
    expect((confirmed.error as AuthStoreError).code).toBe("unavailable");
  });

  it("refuses a deactivated account at either stage, after spending the token rather than leaving it live", async () => {
    for (const stage of ["approve", "move"] as const) {
      const built = scene([userRow({ deactivatedAt: null })]);
      const token = stage === "approve" ? await requested(built) : await approved(built);
      built.users.rows[0] = userRow({ deactivatedAt: 1_650_000_000_000 });
      expect(await built.flow.confirm(token, AT + 1_000)).toEqual({ ok: false, error: "deactivated" });
      expect(built.nonces.seen.size).toBe(stage === "approve" ? 1 : 2);
      expect(built.users.writes).toEqual([]);
    }
  });

  it("refuses a payload with no stage, no address, or a stage it did not write", async () => {
    const built = scene();
    for (const payload of [USER_ID, `${USER_ID} new@example.com`, `move ${USER_ID}`, `move ${USER_ID} `, `verify ${USER_ID} new@example.com`]) {
      const malformed = await encodeAuthToken(ring, "identity", payload, TTL_MS, { now: AT });
      expect(`${payload}: ${JSON.stringify(await built.flow.confirm(malformed, AT + 1_000))}`).toBe(
        `${payload}: {"ok":false,"error":"unrecognised"}`,
      );
    }
  });
});

describe("createEmailChangeFlow — the link lifetime it holds at construction", () => {
  const FLOOR =
    "createEmailChangeFlow: ttlMs is 1000, below the 60000-millisecond floor — the shortest expiration the nonce store accepts, below which the link outlives its own replay guard.";
  const CEILING =
    "createEmailChangeFlow: ttlMs is 172800000, above the 86400000-millisecond ceiling — a change-of-address link that outlives a day is a standing takeover primitive.";

  it("refuses a lifetime below the nonce store's own floor", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 1_000 })).toThrow(FLOOR);
  });

  it("refuses a link that would stay live for longer than a day", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 172_800_000 })).toThrow(CEILING);
  });

  it("refuses a fraction", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 60_000.5 })).toThrow("createEmailChangeFlow: ttlMs is 60000.5, which is not a whole number.");
  });

  it("accepts both bounds themselves, and the knob omitted", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 60_000 })).not.toThrow();
    expect(() => scene([userRow()], {}, { ttlMs: 86_400_000 })).not.toThrow();
    expect(() => scene()).not.toThrow();
  });
});
