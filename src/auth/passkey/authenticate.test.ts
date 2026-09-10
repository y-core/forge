import { beforeAll, describe, expect, it } from "bun:test";

import { base64urlEncode, uuidv7 } from "../../crypto/mod";
import { ok } from "../../result/result";
import type { AuthAlgorithm, AuthChallenge, AuthCredential, AuthUser, ChallengeStore, CredentialStore, UserStore } from "../types";
import { verifyPasskeyAuthentication } from "./authenticate";
import { PASSKEY_FLAG, createPasskeyKeyPair, fakeClientData, fakePasskeyAssertion } from "./fixture";
import type { PasskeyAuthenticationVerifyOptions } from "./types";
import type { PasskeyKeyPair } from "./types";

const RP_ID = "example.com";
const ORIGIN = "https://example.com";
const SESSION_ID = "session-1";
const USER_ID = uuidv7();
const CREDENTIAL_ROW_ID = uuidv7();
const CREDENTIAL_ID = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
const CHALLENGE = base64urlEncode(new Uint8Array(32).fill(3));
const CHALLENGE_KEY = `passkey:authenticate:${SESSION_ID}`;
const HANDLE = new Uint8Array(64).fill(0x5a) as Uint8Array<ArrayBuffer>;
const AT = 1_700_000_000_000;

const KEYS: Partial<Record<AuthAlgorithm, PasskeyKeyPair>> = {};

beforeAll(async () => {
  for (const algorithm of [-7, -8, -257] as const) KEYS[algorithm] = await createPasskeyKeyPair(algorithm);
});

function keyFor(algorithm: AuthAlgorithm): PasskeyKeyPair {
  const key = KEYS[algorithm];
  if (!key) throw new Error(`no fixture key for ${algorithm}`);
  return key;
}

function fakeChallenges(seed: AuthChallenge | null = { challenge: CHALLENGE, sessionId: SESSION_ID }) {
  const entries = new Map<string, AuthChallenge>(seed ? [[CHALLENGE_KEY, seed]] : []);
  const store: ChallengeStore = {
    put: (key, challenge) => {
      entries.set(key, challenge);
      return Promise.resolve(ok());
    },
    take: (key) => {
      const held = entries.get(key) ?? null;
      entries.delete(key);
      return Promise.resolve(ok(held));
    },
  };
  return { store, entries };
}

function credentialRow(overrides: Partial<AuthCredential> = {}): AuthCredential {
  return {
    id: CREDENTIAL_ROW_ID,
    userId: USER_ID,
    credentialId: CREDENTIAL_ID,
    publicKey: keyFor(-7).cosePublicKey,
    algorithm: -7,
    signCount: 0,
    transports: [],
    backupEligible: false,
    backedUp: false,
    label: null,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface RecordedUse {
  id: string;
  signCount: number;
  backedUp: boolean;
  at: number;
}

function fakeCredentials(row: AuthCredential | null) {
  const uses: RecordedUse[] = [];
  // The read answers from the row as it was, and the write from the row as it is. That is the
  // difference the store's conditional statement exists to cover: two requests may both read the
  // same stale counter, and only one of them may write.
  let stored = row;
  const store: CredentialStore = {
    listByUser: () => Promise.resolve(ok(row ? [row] : [])),
    findByCredentialId: (credentialId) => Promise.resolve(ok(row && row.credentialId === credentialId ? row : null)),
    create: () => Promise.reject(new Error("not used")),
    recordUse: (id, signCount, backedUp, at) => {
      const current = stored;
      if (!current || current.id !== id) return Promise.resolve(ok(false));
      if (!(current.signCount < signCount || (current.signCount === 0 && signCount === 0))) return Promise.resolve(ok(false));
      stored = { ...current, signCount, backedUp, lastUsedAt: at };
      uses.push({ id, signCount, backedUp, at });
      return Promise.resolve(ok(true));
    },
    relabel: () => Promise.resolve(ok(true)),
    removeForUser: () => Promise.resolve(ok(true)),
  };
  return { store, uses, current: () => stored };
}

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "person@example.com",
    emailKey: "person@example.com",
    emailVerifiedAt: 1_600_000_000_000,
    webauthnId: HANDLE,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeUsers(rows: readonly AuthUser[]) {
  const store: UserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    findByEmailKey: () => Promise.resolve(ok(null)),
    findByWebAuthnId: (webauthnId) =>
      Promise.resolve(ok(rows.find((row) => row.webauthnId !== null && base64urlEncode(row.webauthnId) === base64urlEncode(webauthnId)) ?? null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
  };
  return store;
}

function verifyOptions(
  challenges: ChallengeStore,
  credentials: CredentialStore,
  users: UserStore,
  overrides: Partial<PasskeyAuthenticationVerifyOptions> = {},
): PasskeyAuthenticationVerifyOptions {
  return { rpId: RP_ID, origin: ORIGIN, challenges, credentials, users, ...overrides };
}

const base = () => ({ rpId: RP_ID, origin: ORIGIN, challenge: CHALLENGE, credentialId: CREDENTIAL_ID });

describe("verifyPasskeyAuthentication — a signature per algorithm", () => {
  it("accepts an assertion signed over `authenticatorData ‖ SHA-256(clientDataJSON)` for -7, -8 and -257", async () => {
    for (const algorithm of [-7, -8, -257] as const) {
      const key = keyFor(algorithm);
      const credentials = fakeCredentials(credentialRow({ publicKey: key.cosePublicKey, algorithm, signCount: 4 }));
      const assertion = await fakePasskeyAssertion({ ...base(), key, signCount: 5 });
      const outcome = await verifyPasskeyAuthentication(
        verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
        { sessionId: SESSION_ID, credential: assertion },
        AT,
      );
      expect(`${algorithm}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${algorithm}: accepted`);
      expect(credentials.uses).toEqual([{ id: CREDENTIAL_ROW_ID, signCount: 5, backedUp: false, at: AT }]);
    }
  });

  it("refuses a signature made over anything other than that concatenation", async () => {
    const credentials = fakeCredentials(credentialRow());
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 5, signOver: new Uint8Array([1, 2, 3, 4]) });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "unrecognised" });
    expect(credentials.uses).toEqual([]);
  });

  it("refuses a signature made by another credential's key", async () => {
    const credentials = fakeCredentials(credentialRow({ publicKey: keyFor(-7).cosePublicKey }));
    const stranger = await createPasskeyKeyPair(-7);
    const assertion = await fakePasskeyAssertion({ ...base(), key: stranger, signCount: 5 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("verifyPasskeyAuthentication — the surface a caller sees", () => {
  // The falsifiable criterion for this unit: a response that distinguishes these two answers
  // whether a given credential is registered here, to anyone who can post one.
  it("answers an unknown credential id and a bad signature with the same reason", async () => {
    const unknown = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, fakeCredentials(null).store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: await fakePasskeyAssertion({ ...base(), key: keyFor(-7) }) },
      AT,
    );
    const forged = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, fakeCredentials(credentialRow()).store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signOver: new Uint8Array([9]) }) },
      AT,
    );
    expect(unknown).toEqual(forged);
    expect(unknown).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("verifyPasskeyAuthentication — the sign count", () => {
  it("accepts a counter strictly above the stored one and records only the presented value", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 41 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 42 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome.ok).toBe(true);
    expect(credentials.uses).toEqual([{ id: CREDENTIAL_ROW_ID, signCount: 42, backedUp: false, at: AT }]);
  });

  it("refuses a counter equal to the stored one and one below it, writing nothing", async () => {
    for (const presented of [41, 40, 0]) {
      const credentials = fakeCredentials(credentialRow({ signCount: 41 }));
      const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: presented });
      const outcome = await verifyPasskeyAuthentication(
        verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
        { sessionId: SESSION_ID, credential: assertion },
        AT,
      );
      expect(`${presented}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${presented}: sign-count-reused`);
      expect(credentials.uses).toEqual([]);
    }
  });

  // Both takes succeed because KV's `take` is a read followed by a delete, so a captured assertion
  // resubmitted inside the consistency window reaches the counter check against the same stale row.
  // The second write is what has to refuse, and it can only refuse in the statement.
  it("refuses a captured assertion replayed against the same stored row, leaving the counter as the first use left it", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 41 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 42 });
    const replay = () =>
      verifyPasskeyAuthentication(
        verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
        { sessionId: SESSION_ID, credential: assertion },
        AT,
      );

    expect((await replay()).ok).toBe(true);
    expect(await replay()).toEqual({ ok: false, error: "sign-count-reused" });
    expect(credentials.uses).toEqual([{ id: CREDENTIAL_ROW_ID, signCount: 42, backedUp: false, at: AT }]);
    expect(credentials.current()?.signCount).toBe(42);
  });

  // The statement's other `ok(false)`: the row is gone rather than advanced. It is deliberately
  // folded into the same reason, so the collapse is pinned here rather than left incidental.
  it("answers a credential deleted between the read and the write with the same reason", async () => {
    const present = fakeCredentials(credentialRow({ signCount: 41 }));
    const deleted = fakeCredentials(null);
    // The read reaches the row and the write does not: the deletion lands between them.
    const store: CredentialStore = { ...present.store, recordUse: deleted.store.recordUse };
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 42 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "sign-count-reused" });
    expect(present.uses).toEqual([]);
    expect(deleted.uses).toEqual([]);
  });

  it("skips the check entirely when the stored and presented counters are both zero", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 0 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 0 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome.ok).toBe(true);
    expect(credentials.uses).toEqual([{ id: CREDENTIAL_ROW_ID, signCount: 0, backedUp: false, at: AT }]);
  });
});

describe("verifyPasskeyAuthentication — the backup flags", () => {
  it("writes the presented backup state on every success, so a synced key stops reading as local", async () => {
    const credentials = fakeCredentials(credentialRow({ backupEligible: true, backedUp: false, signCount: 1 }));
    const assertion = await fakePasskeyAssertion({
      ...base(),
      key: keyFor(-7),
      flags: PASSKEY_FLAG.up | PASSKEY_FLAG.uv | PASSKEY_FLAG.be | PASSKEY_FLAG.bs,
      signCount: 2,
    });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome.ok && outcome.data.backedUp).toBe(true);
    expect(credentials.uses).toEqual([{ id: CREDENTIAL_ROW_ID, signCount: 2, backedUp: true, at: AT }]);
  });

  // WebAuthn L3 §6.1.3 fixes BE for the life of a credential, so a changed one is an authenticator
  // misreporting its own state — the same thing an impossible BE/BS pair is, and the same refusal.
  it("refuses an assertion whose backup eligibility differs from the enrolled credential's, writing nothing", async () => {
    const credentials = fakeCredentials(credentialRow({ backupEligible: false, signCount: 1 }));
    const assertion = await fakePasskeyAssertion({
      ...base(),
      key: keyFor(-7),
      flags: PASSKEY_FLAG.up | PASSKEY_FLAG.uv | PASSKEY_FLAG.be,
      signCount: 2,
    });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "invalid-backup-state" });
    expect(credentials.uses).toEqual([]);
  });
});

describe("verifyPasskeyAuthentication — resolving the user", () => {
  it("resolves the account from the authenticator's own handle, decoded once before the lookup", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2, userHandle: base64urlEncode(HANDLE) });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome.ok && outcome.data.user.id).toBe(USER_ID);
  });

  it("refuses a handle naming an account the credential does not belong to", async () => {
    const other = userRow({ id: uuidv7(), webauthnId: new Uint8Array(64).fill(0x7f) as Uint8Array<ArrayBuffer> });
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const assertion = await fakePasskeyAssertion({
      ...base(),
      key: keyFor(-7),
      signCount: 2,
      userHandle: base64urlEncode(other.webauthnId ?? new Uint8Array(0)),
    });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow(), other])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "unrecognised" });
  });

  it("refuses an unverified account, however its credential row came to exist", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow({ emailVerifiedAt: null })])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "account-unverified" });
    expect(credentials.uses).toEqual([]);
  });

  // Deactivation is an access-revocation control: an operator who disables an account and watches
  // the user keep signing in has been told the control worked when it did not.
  it("refuses a deactivated account under a reason of its own, writing nothing", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, credentials.store, fakeUsers([userRow({ deactivatedAt: 1_650_000_000_000 })])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "account-deactivated" });
    expect(credentials.uses).toEqual([]);
  });

  it("keeps deactivation and unverified apart, so a log names which guard fired", async () => {
    const rows: readonly { user: AuthUser; reason: string }[] = [
      { user: userRow({ deactivatedAt: 1_650_000_000_000 }), reason: "account-deactivated" },
      { user: userRow({ emailVerifiedAt: null }), reason: "account-unverified" },
      { user: userRow({ deactivatedAt: 1_650_000_000_000, emailVerifiedAt: null }), reason: "account-deactivated" },
    ];
    for (const row of rows) {
      const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });
      const outcome = await verifyPasskeyAuthentication(
        verifyOptions(fakeChallenges().store, fakeCredentials(credentialRow({ signCount: 1 })).store, fakeUsers([row.user])),
        { sessionId: SESSION_ID, credential: assertion },
        AT,
      );
      expect(`${row.reason}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${row.reason}: ${row.reason}`);
    }
  });

  it("refuses when the challenge was bound to a different user than the ceremony resolved", async () => {
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });
    const challenges = fakeChallenges({ challenge: CHALLENGE, sessionId: SESSION_ID, userId: uuidv7() });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(challenges.store, credentials.store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("verifyPasskeyAuthentication — the ceremony bindings", () => {
  it("refuses a missing challenge, another session's challenge, and mismatched client data", async () => {
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });
    const missing = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges(null).store, fakeCredentials(credentialRow()).store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(missing).toEqual({ ok: false, error: "challenge-not-found" });

    const foreign = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges({ challenge: CHALLENGE, sessionId: "other" }).store, fakeCredentials(credentialRow()).store, fakeUsers([])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(foreign).toEqual({ ok: false, error: "session-mismatch" });

    const crossOrigin = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, fakeCredentials(credentialRow()).store, fakeUsers([userRow()])),
      {
        sessionId: SESSION_ID,
        credential: {
          ...assertion,
          response: {
            ...assertion.response,
            clientDataJSON: base64urlEncode(fakeClientData({ type: "webauthn.get", challenge: CHALLENGE, origin: "https://evil.test" })),
          },
        },
      },
      AT,
    );
    expect(crossOrigin).toEqual({ ok: false, error: "origin-mismatch" });
  });

  it("refuses authenticator data whose relying-party hash is another deployment's", async () => {
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), rpId: "evil.test", signCount: 2 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, fakeCredentials(credentialRow()).store, fakeUsers([userRow()])),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "rp-id-mismatch" });
  });

  it("refuses an unverified gesture when the deployment requires one", async () => {
    const assertion = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), flags: PASSKEY_FLAG.up, signCount: 2 });
    const outcome = await verifyPasskeyAuthentication(
      verifyOptions(fakeChallenges().store, fakeCredentials(credentialRow()).store, fakeUsers([userRow()]), { requireUserVerification: true }),
      { sessionId: SESSION_ID, credential: assertion },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "user-not-verified" });
  });

  it("drops the challenge on the failure path, so a retry with it cannot pass", async () => {
    const challenges = fakeChallenges();
    const credentials = fakeCredentials(credentialRow({ signCount: 1 }));
    const forged = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2, signOver: new Uint8Array([0]) });
    const valid = await fakePasskeyAssertion({ ...base(), key: keyFor(-7), signCount: 2 });

    expect(
      await verifyPasskeyAuthentication(
        verifyOptions(challenges.store, credentials.store, fakeUsers([userRow()])),
        { sessionId: SESSION_ID, credential: forged },
        AT,
      ),
    ).toEqual({ ok: false, error: "unrecognised" });
    expect(challenges.entries.size).toBe(0);

    expect(
      await verifyPasskeyAuthentication(
        verifyOptions(challenges.store, credentials.store, fakeUsers([userRow()])),
        { sessionId: SESSION_ID, credential: valid },
        AT,
      ),
    ).toEqual({ ok: false, error: "challenge-not-found" });
  });
});
