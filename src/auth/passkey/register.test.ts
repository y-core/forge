import { beforeAll, describe, expect, it } from "bun:test";

import { base64urlEncode, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import type { AuthChallenge, AuthCredential, AuthCredentialInput, ChallengeStore, CredentialStore } from "../types";
import { PASSKEY_FLAG, ceremonyCborEncode, createPasskeyKeyPair, fakeClientData, fakePasskeyRegistration } from "./fixture";
import { verifyPasskeyRegistration } from "./register";
import type { CeremonyCborValue, PasskeyKeyPair } from "./types";
import type { PasskeyRegistrationVerifyOptions } from "./types";

const RP_ID = "example.com";
const ORIGIN = "https://example.com";
const SESSION_ID = "session-1";
const USER_ID = uuidv7();
const CHALLENGE = base64urlEncode(new Uint8Array(32).fill(9));
const CREDENTIAL_ID = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11]);
const CHALLENGE_KEY = `passkey:register:${SESSION_ID}`;
const AT = 1_700_000_000_000;

let ES256: PasskeyKeyPair;
let RS256: PasskeyKeyPair;

beforeAll(async () => {
  ES256 = await createPasskeyKeyPair(-7);
  RS256 = await createPasskeyKeyPair(-257);
});

function fakeChallenges(seed: AuthChallenge | null = { challenge: CHALLENGE, sessionId: SESSION_ID, userId: USER_ID }) {
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

function credentialRow(input: AuthCredentialInput, at: number): AuthCredential {
  return {
    id: uuidv7(),
    userId: input.userId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    algorithm: input.algorithm,
    signCount: input.signCount,
    transports: input.transports ?? [],
    backupEligible: input.backupEligible ?? false,
    backedUp: input.backedUp ?? false,
    label: input.label ?? null,
    lastUsedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function fakeCredentials(options: { conflict?: boolean } = {}) {
  const created: AuthCredentialInput[] = [];
  const store: CredentialStore = {
    listByUser: () => Promise.resolve(ok([])),
    findByCredentialId: () => Promise.resolve(ok(null)),
    create: (input, at) => {
      if (options.conflict) {
        return Promise.resolve(err(new AuthStoreError("conflict", "credentials.create", { constraint: "auth_credentials.credential_id" })));
      }
      created.push(input);
      return Promise.resolve(ok(credentialRow(input, at)));
    },
    recordUse: () => Promise.resolve(ok(true)),
    relabel: () => Promise.resolve(ok(true)),
    removeForUser: () => Promise.resolve(ok(true)),
  };
  return { store, created };
}

function verifyOptions(
  challenges: ChallengeStore,
  credentials: CredentialStore,
  overrides: Partial<PasskeyRegistrationVerifyOptions> = {},
): PasskeyRegistrationVerifyOptions {
  return { rpId: RP_ID, origin: ORIGIN, challenges, credentials, ...overrides };
}

const base = () => ({ rpId: RP_ID, origin: ORIGIN, challenge: CHALLENGE, credentialId: CREDENTIAL_ID });

describe("verifyPasskeyRegistration — a ceremony that passes", () => {
  it("stores exactly the credential row the attested data describes", async () => {
    const challenges = fakeChallenges();
    const credentials = fakeCredentials();
    const credential = await fakePasskeyRegistration({
      ...base(),
      key: ES256,
      flags: PASSKEY_FLAG.up | PASSKEY_FLAG.uv | PASSKEY_FLAG.at | PASSKEY_FLAG.be | PASSKEY_FLAG.bs,
      signCount: 7,
      transports: ["internal", "hybrid"],
    });

    const outcome = await verifyPasskeyRegistration(
      verifyOptions(challenges.store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential, label: "Phone" },
      AT,
    );

    expect(outcome.ok).toBe(true);
    expect(credentials.created).toEqual([
      {
        userId: USER_ID,
        credentialId: base64urlEncode(CREDENTIAL_ID),
        publicKey: ES256.cosePublicKey,
        algorithm: -7,
        signCount: 7,
        transports: ["internal", "hybrid"],
        backupEligible: true,
        backedUp: true,
        label: "Phone",
      },
    ]);
  });

  it("stores an RS256 credential when the algorithm list admits it", async () => {
    const credentials = fakeCredentials();
    const credential = await fakePasskeyRegistration({ ...base(), key: RS256 });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome.ok).toBe(true);
    expect(credentials.created[0]?.algorithm).toBe(-257);
  });

  it("refuses a client `id` that disagrees with the attested credential id, storing nothing", async () => {
    const credentials = fakeCredentials();
    const built = await fakePasskeyRegistration({ ...base(), key: ES256 });
    const presented = { ...built, id: "an-id-the-client-chose" };
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: presented },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "credential-id-mismatch" });
    expect(credentials.created).toEqual([]);
  });

  it("enrols the attested credential id when the client reports the same one", async () => {
    const credentials = fakeCredentials();
    const credential = await fakePasskeyRegistration({ ...base(), key: ES256 });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome.ok).toBe(true);
    expect(credential.id).toBe(base64urlEncode(CREDENTIAL_ID));
    expect(credentials.created[0]?.credentialId).toBe(base64urlEncode(CREDENTIAL_ID));
  });
});

describe("verifyPasskeyRegistration — the attestation format", () => {
  it("refuses every format other than the exact string `none`", async () => {
    for (const fmt of ["packed", "tpm", "android-key", "apple", "None", "none "]) {
      const credential = await fakePasskeyRegistration({ ...base(), key: ES256, fmt });
      const outcome = await verifyPasskeyRegistration(
        verifyOptions(fakeChallenges().store, fakeCredentials().store),
        { sessionId: SESSION_ID, userId: USER_ID, credential },
        AT,
      );
      expect(`${fmt}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${fmt}: unsupported-attestation`);
    }
  });

  it("refuses a populated attStmt under `none` rather than ignoring it", async () => {
    const credential = await fakePasskeyRegistration({ ...base(), key: ES256, attStmt: new Map<string, number>([["alg", -7]]) as never });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials().store),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "attestation-not-empty" });
  });

  it("refuses bytes trailing the attestation object, which no check would ever read", async () => {
    const credential = await fakePasskeyRegistration({ ...base(), key: ES256, trailing: new Uint8Array([0x01, 0x02]) });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials().store),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses an attestation object that is not decodable CBOR at all", async () => {
    const built = await fakePasskeyRegistration({ ...base(), key: ES256 });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials().store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: { ...built, response: { ...built.response, attestationObject: "ff" } } },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "malformed" });
  });
});

describe("verifyPasskeyRegistration — the algorithm list", () => {
  it("refuses an algorithm outside the configured set, whatever the key is", async () => {
    const credential = await fakePasskeyRegistration({ ...base(), key: RS256 });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials().store, { algorithms: [-7] }),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "unsupported-algorithm" });
  });
});

describe("verifyPasskeyRegistration — the ceremony bindings", () => {
  it("refuses a session with no stored challenge", async () => {
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges(null).store, fakeCredentials().store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: await fakePasskeyRegistration({ ...base(), key: ES256 }) },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "challenge-not-found" });
  });

  it("refuses a challenge issued to another session, and one issued to another user", async () => {
    const rows: readonly { seed: AuthChallenge; reason: string }[] = [
      { seed: { challenge: CHALLENGE, sessionId: "other", userId: USER_ID }, reason: "session-mismatch" },
      { seed: { challenge: CHALLENGE, sessionId: SESSION_ID, userId: uuidv7() }, reason: "subject-mismatch" },
      { seed: { challenge: CHALLENGE, sessionId: SESSION_ID }, reason: "subject-mismatch" },
    ];
    for (const row of rows) {
      const outcome = await verifyPasskeyRegistration(
        verifyOptions(fakeChallenges(row.seed).store, fakeCredentials().store),
        { sessionId: SESSION_ID, userId: USER_ID, credential: await fakePasskeyRegistration({ ...base(), key: ES256 }) },
        AT,
      );
      expect(`${row.reason}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${row.reason}: ${row.reason}`);
    }
  });

  it("refuses client data from another origin, another challenge or the wrong ceremony", async () => {
    const rows: readonly { fields: { type: string; challenge: string; origin: string }; reason: string }[] = [
      { fields: { type: "webauthn.create", challenge: CHALLENGE, origin: "https://example.com.evil.test" }, reason: "origin-mismatch" },
      { fields: { type: "webauthn.create", challenge: "another-challenge", origin: ORIGIN }, reason: "challenge-mismatch" },
      { fields: { type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN }, reason: "type-mismatch" },
    ];
    for (const row of rows) {
      const built = await fakePasskeyRegistration({ ...base(), key: ES256 });
      const outcome = await verifyPasskeyRegistration(
        verifyOptions(fakeChallenges().store, fakeCredentials().store),
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          credential: { ...built, response: { ...built.response, clientDataJSON: base64urlEncode(fakeClientData(row.fields)) } },
        },
        AT,
      );
      expect(`${row.reason}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${row.reason}: ${row.reason}`);
    }
  });

  it("refuses authenticator data minted for another relying party, and one with no user present", async () => {
    const rows: readonly { fixture: { rpId?: string; flags?: number }; reason: string }[] = [
      { fixture: { rpId: "evil.test" }, reason: "rp-id-mismatch" },
      { fixture: { flags: PASSKEY_FLAG.at }, reason: "user-not-present" },
    ];
    for (const row of rows) {
      const credential = await fakePasskeyRegistration({ ...base(), key: ES256, ...row.fixture });
      const outcome = await verifyPasskeyRegistration(
        verifyOptions(fakeChallenges().store, fakeCredentials().store),
        { sessionId: SESSION_ID, userId: USER_ID, credential },
        AT,
      );
      expect(`${row.reason}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${row.reason}: ${row.reason}`);
    }
  });

  it("refuses an unverified user when the deployment requires verification", async () => {
    const credential = await fakePasskeyRegistration({ ...base(), key: ES256, flags: PASSKEY_FLAG.up | PASSKEY_FLAG.at });
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials().store, { requireUserVerification: true }),
      { sessionId: SESSION_ID, userId: USER_ID, credential },
      AT,
    );
    expect(outcome).toEqual({ ok: false, error: "user-not-verified" });
  });
});

describe("verifyPasskeyRegistration — a credential id already registered", () => {
  it("surfaces the store's conflict as the AuthStoreError it was", async () => {
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, fakeCredentials({ conflict: true }).store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: await fakePasskeyRegistration({ ...base(), key: ES256 }) },
      AT,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("the conflict was accepted");
    expect(outcome.error).toBeInstanceOf(AuthStoreError);
    expect((outcome.error as AuthStoreError).code).toBe("conflict");
  });
});

describe("verifyPasskeyRegistration — the challenge on the failure path", () => {
  // The whole point of `take` being read-and-delete: a verifier that consumed the challenge only on
  // success would leave one challenge open to unlimited attempts.
  it("drops the challenge when the ceremony fails, so an immediate retry with it cannot pass", async () => {
    const challenges = fakeChallenges();
    const credentials = fakeCredentials();
    const rejected = await fakePasskeyRegistration({ ...base(), key: ES256, fmt: "packed" });
    const valid = await fakePasskeyRegistration({ ...base(), key: ES256 });

    const first = await verifyPasskeyRegistration(
      verifyOptions(challenges.store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: rejected },
      AT,
    );
    expect(first).toEqual({ ok: false, error: "unsupported-attestation" });
    expect(challenges.entries.size).toBe(0);

    const retry = await verifyPasskeyRegistration(
      verifyOptions(challenges.store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: valid },
      AT,
    );
    expect(retry).toEqual({ ok: false, error: "challenge-not-found" });
    expect(credentials.created).toEqual([]);
  });

  it("drops it on a store failure too, because the take precedes every check", async () => {
    const challenges = fakeChallenges();
    await verifyPasskeyRegistration(
      verifyOptions(challenges.store, fakeCredentials({ conflict: true }).store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: await fakePasskeyRegistration({ ...base(), key: ES256 }) },
      AT,
    );
    expect(challenges.entries.size).toBe(0);
  });
});

describe("verifyPasskeyRegistration — a key no sign-in could ever use", () => {
  /** A ceremony fixture whose attested key is these bytes, since only the public half is read at registration. */
  function keyed(cosePublicKey: Uint8Array<ArrayBuffer>): PasskeyKeyPair {
    return { algorithm: -7, cosePublicKey, sign: () => Promise.reject(new Error("not used")) };
  }

  function coseEc2(x: Uint8Array<ArrayBuffer>, y: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return ceremonyCborEncode(
      new Map<CeremonyCborValue, CeremonyCborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    );
  }

  function coseRsa(modulus: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return ceremonyCborEncode(
      new Map<CeremonyCborValue, CeremonyCborValue>([
        [1, 3],
        [3, -257],
        [-1, modulus],
        [-2, new Uint8Array([1, 0, 1])],
      ]),
    );
  }

  async function registerWith(key: PasskeyKeyPair) {
    const credentials = fakeCredentials();
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, credentials.store),
      { sessionId: SESSION_ID, userId: USER_ID, credential: await fakePasskeyRegistration({ ...base(), key }) },
      AT,
    );
    return { outcome, created: credentials.created };
  }

  // The whole point of holding it here: the refusal a late import produces arrives at every sign-in
  // instead, on a credential the user cannot remove if it was the only one they enrolled.
  it("refuses a P-256 point that is not on the curve, storing nothing", async () => {
    const offCurve = keyed(coseEc2(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)));
    const { outcome, created } = await registerWith(offCurve);
    expect(outcome).toEqual({ ok: false, error: "unsupported-key" });
    expect(created).toEqual([]);
  });

  it("refuses an RSA modulus far below the size any signature under it would need", async () => {
    const { outcome, created } = await registerWith(keyed(coseRsa(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]))));
    expect(outcome).toEqual({ ok: false, error: "unsupported-key" });
    expect(created).toEqual([]);
  });
});

describe("verifyPasskeyRegistration — the bounds on what reaches the store", () => {
  async function register(overrides: { credentialId?: Uint8Array<ArrayBuffer>; label?: string; transports?: readonly string[] }) {
    const credentials = fakeCredentials();
    const outcome = await verifyPasskeyRegistration(
      verifyOptions(fakeChallenges().store, credentials.store),
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        credential: await fakePasskeyRegistration({
          ...base(),
          key: ES256,
          ...(overrides.credentialId ? { credentialId: overrides.credentialId } : {}),
          ...(overrides.transports ? { transports: overrides.transports } : {}),
        }),
        ...(overrides.label === undefined ? {} : { label: overrides.label }),
      },
      AT,
    );
    return { outcome, created: credentials.created };
  }

  // WebAuthn L3 §7.1 caps the id at 1023 bytes, and a zero-length one is still a usable lookup key.
  it("refuses a credential id of zero bytes and one past 1023", async () => {
    for (const length of [0, 1024]) {
      const { outcome, created } = await register({ credentialId: new Uint8Array(length).fill(7) as Uint8Array<ArrayBuffer> });
      expect(`${length}: ${outcome.ok ? "stored" : outcome.error}`).toBe(`${length}: malformed`);
      expect(created).toEqual([]);
    }
  });

  it("stores a credential id at the 1023-byte ceiling", async () => {
    const { outcome } = await register({ credentialId: new Uint8Array(1023).fill(7) as Uint8Array<ArrayBuffer> });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a label longer than the rename schema admits, so the store never sees one", async () => {
    expect((await register({ label: "x".repeat(65) })).outcome).toEqual({ ok: false, error: "malformed" });
    expect((await register({ label: "x".repeat(64) })).outcome.ok).toBe(true);
  });

  it("refuses a transport list longer than eight, and one entry longer than 32 characters", async () => {
    expect((await register({ transports: Array.from({ length: 9 }, () => "usb") })).outcome).toEqual({ ok: false, error: "malformed" });
    expect((await register({ transports: ["x".repeat(33)] })).outcome).toEqual({ ok: false, error: "malformed" });
    expect((await register({ transports: ["usb", "nfc"] })).created[0]?.transports).toEqual(["usb", "nfc"]);
  });
});
