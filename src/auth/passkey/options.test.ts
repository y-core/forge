import { describe, expect, it } from "bun:test";

import { base64urlDecode, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { fakeKV } from "../../testing/fakes";
import { AUTH_PASSKEY_CHALLENGE_MIN_BYTES, AUTH_PASSKEY_TTL_MAX_SECONDS, AUTH_PASSKEY_TTL_MIN_SECONDS } from "../config";
import { AuthStoreError } from "../errors";
import { createChallengeStore } from "../stores/challenges";
import type { AuthChallenge, AuthCredential, ChallengeStore, CredentialStore } from "../types";
import { createPasskeyRegistrationOptions, createPasskeyRequestOptions, passkeyChallengeKey } from "./options";
import type { PasskeyCeremonyOptions } from "./options";

const USER_ID = uuidv7();
const SESSION = "sess-42";

function credential(credentialId: string, transports: readonly string[] = []): AuthCredential {
  return {
    id: uuidv7(),
    userId: USER_ID,
    credentialId,
    publicKey: new Uint8Array([1]),
    algorithm: -7,
    signCount: 0,
    transports,
    backupEligible: false,
    backedUp: false,
    label: null,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function credentialStore(existing: readonly AuthCredential[]): CredentialStore {
  return {
    listByUser: () => Promise.resolve(ok(existing)),
    findByCredentialId: () => Promise.resolve(ok(null)),
    create: () => Promise.resolve(err(new AuthStoreError("unavailable", "credentials.create"))),
    recordUse: () => Promise.resolve(ok(true)),
    relabel: () => Promise.resolve(ok(true)),
    removeForUser: () => Promise.resolve(ok(true)),
  };
}

function recordingChallenges(): ChallengeStore & { puts: { key: string; challenge: AuthChallenge; ttl: number }[] } {
  const inner = createChallengeStore(fakeKV());
  const puts: { key: string; challenge: AuthChallenge; ttl: number }[] = [];
  return {
    puts,
    put: (key, challenge, ttl) => {
      puts.push({ key, challenge, ttl });
      return inner.put(key, challenge, ttl);
    },
    take: (key) => inner.take(key),
  };
}

function ceremony(
  overrides: Partial<PasskeyCeremonyOptions> = {},
): PasskeyCeremonyOptions & { challenges: ReturnType<typeof recordingChallenges> } {
  return { rpId: "example.test", rpName: "Example", credentials: credentialStore([]), ...overrides, challenges: recordingChallenges() };
}

const SUBJECT = { userId: USER_ID, userHandle: "dXNlci1oYW5kbGU", name: "aurora@example.test", displayName: "Aurora", sessionId: SESSION };

describe("createPasskeyRegistrationOptions", () => {
  it("emits the whole options object field for field", async () => {
    const options = ceremony();
    const built = await createPasskeyRegistrationOptions(options, SUBJECT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data).toEqual({
      rp: { id: "example.test", name: "Example" },
      user: { id: "dXNlci1oYW5kbGU", name: "aurora@example.test", displayName: "Aurora" },
      challenge: built.data.challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 300_000,
      attestation: "none",
      excludeCredentials: [],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  });

  it("advertises exactly [-7, -257] by default", async () => {
    const built = await createPasskeyRegistrationOptions(ceremony(), SUBJECT);
    expect(built.ok && built.data.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ]);
  });

  it("advertises exactly [-8, -7, -257] when Ed25519 is opted into", async () => {
    const built = await createPasskeyRegistrationOptions(ceremony({ algorithms: [-8, -7, -257] }), SUBJECT);
    expect(built.ok && built.data.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -8 },
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ]);
  });

  it("asks for no attestation, whatever else is configured", async () => {
    const built = await createPasskeyRegistrationOptions(ceremony({ userVerification: "required", residentKey: "required" }), SUBJECT);
    expect(built.ok && built.data.attestation).toBe("none");
    expect(built.ok && built.data.authenticatorSelection).toEqual({ residentKey: "required", userVerification: "required" });
  });

  it("excludes exactly the credentials the user already has, transports included", async () => {
    const options = ceremony({ credentials: credentialStore([credential("Y3JlZC1h", ["internal"]), credential("Y3JlZC1i")]) });
    const built = await createPasskeyRegistrationOptions(options, SUBJECT);
    expect(built.ok && built.data.excludeCredentials).toEqual([
      { type: "public-key", id: "Y3JlZC1h", transports: ["internal"] },
      { type: "public-key", id: "Y3JlZC1i" },
    ]);
  });

  it("stores the challenge under the session-bound key with the configured lifetime", async () => {
    const options = ceremony({ ttlSeconds: 120 });
    const built = await createPasskeyRegistrationOptions(options, SUBJECT);
    expect(options.challenges.puts).toEqual([
      {
        key: `passkey:register:${SESSION}`,
        challenge: { challenge: built.ok ? built.data.challenge : "", sessionId: SESSION, userId: USER_ID },
        ttl: 120,
      },
    ]);
    expect(built.ok && built.data.timeout).toBe(120_000);
  });

  it("generates a fresh 32-byte challenge each time", async () => {
    const first = await createPasskeyRegistrationOptions(ceremony(), SUBJECT);
    const second = await createPasskeyRegistrationOptions(ceremony(), SUBJECT);
    expect(first.ok && base64urlDecode(first.data.challenge).byteLength).toBe(32);
    expect(first.ok && second.ok && first.data.challenge).not.toBe(second.ok && second.data.challenge);
  });

  it("passes a credential-store failure straight through", async () => {
    const failing: CredentialStore = {
      ...credentialStore([]),
      listByUser: () => Promise.resolve(err(new AuthStoreError("unavailable", "credentials.listByUser"))),
    };
    const built = await createPasskeyRegistrationOptions(ceremony({ credentials: failing }), SUBJECT);
    expect(built.ok).toBe(false);
    expect(built.ok === false && built.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createPasskeyRequestOptions", () => {
  it("emits the whole options object field for field", async () => {
    const options = ceremony();
    const built = await createPasskeyRequestOptions(options, { sessionId: SESSION, userId: USER_ID });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data).toEqual({
      rpId: "example.test",
      challenge: built.data.challenge,
      timeout: 300_000,
      userVerification: "preferred",
      allowCredentials: [],
    });
  });

  it("allows exactly the user's credentials when a user is named", async () => {
    const options = ceremony({ credentials: credentialStore([credential("Y3JlZC1h", ["hybrid", "internal"])]) });
    const built = await createPasskeyRequestOptions(options, { sessionId: SESSION, userId: USER_ID });
    expect(built.ok && built.data.allowCredentials).toEqual([{ type: "public-key", id: "Y3JlZC1h", transports: ["hybrid", "internal"] }]);
  });

  it("allows nothing and names no user for a discoverable sign-in", async () => {
    const options = ceremony({ credentials: credentialStore([credential("Y3JlZC1h")]) });
    const built = await createPasskeyRequestOptions(options, { sessionId: SESSION });
    expect(built.ok && built.data.allowCredentials).toEqual([]);
    expect(options.challenges.puts[0]?.challenge).toEqual({ challenge: built.ok ? built.data.challenge : "", sessionId: SESSION });
  });

  it("stores under a key distinct from the registration ceremony's", async () => {
    const options = ceremony();
    await createPasskeyRequestOptions(options, { sessionId: SESSION, userId: USER_ID });
    expect(options.challenges.puts[0]?.key).toBe(`passkey:authenticate:${SESSION}`);
    expect(passkeyChallengeKey("authenticate", SESSION)).not.toBe(passkeyChallengeKey("register", SESSION));
  });

  it("honours the configured user verification", async () => {
    const built = await createPasskeyRequestOptions(ceremony({ userVerification: "required" }), { sessionId: SESSION });
    expect(built.ok && built.data.userVerification).toBe("required");
  });

  it("passes a challenge-store failure straight through", async () => {
    const failing: ChallengeStore = {
      put: () => Promise.resolve(err(new AuthStoreError("unavailable", "challenges.put"))),
      take: () => Promise.resolve(ok(null)),
    };
    const built = await createPasskeyRequestOptions({ ...ceremony(), challenges: failing } as PasskeyCeremonyOptions, { sessionId: SESSION });
    expect(built.ok).toBe(false);
  });
});

describe("the challenge floor both builders hold", () => {
  const FLOOR = "challengeBytes is 4, below the 16-byte floor — the floor WebAuthn states for a ceremony challenge.";
  const REGISTRATION = `createPasskeyRegistrationOptions: ${FLOOR}`;
  const REQUEST = `createPasskeyRequestOptions: ${FLOOR}`;

  it("refuses a registration ceremony configured below the floor, naming the builder that was called", async () => {
    await expect(createPasskeyRegistrationOptions(ceremony({ challengeBytes: 4 }), SUBJECT)).rejects.toThrow(REGISTRATION);
  });

  it("refuses an authentication ceremony configured below the floor, naming the builder that was called", async () => {
    await expect(createPasskeyRequestOptions(ceremony({ challengeBytes: 4 }), { sessionId: SESSION })).rejects.toThrow(REQUEST);
  });

  it("accepts the floor itself, at the byte length it was asked for", async () => {
    const built = await createPasskeyRequestOptions(ceremony({ challengeBytes: AUTH_PASSKEY_CHALLENGE_MIN_BYTES }), { sessionId: SESSION });
    expect(built.ok && base64urlDecode(built.data.challenge).byteLength).toBe(AUTH_PASSKEY_CHALLENGE_MIN_BYTES);
  });
});

describe("the ceremony lifetime range both builders hold", () => {
  const BELOW_REGISTRATION = `createPasskeyRegistrationOptions: ttlSeconds is 1, below the ${AUTH_PASSKEY_TTL_MIN_SECONDS}-second floor`;
  const BELOW_REQUEST = `createPasskeyRequestOptions: ttlSeconds is 1, below the ${AUTH_PASSKEY_TTL_MIN_SECONDS}-second floor`;
  const ABOVE_REGISTRATION = `createPasskeyRegistrationOptions: ttlSeconds is 86400, above the ${AUTH_PASSKEY_TTL_MAX_SECONDS}-second ceiling`;
  const ABOVE_REQUEST = `createPasskeyRequestOptions: ttlSeconds is 86400, above the ${AUTH_PASSKEY_TTL_MAX_SECONDS}-second ceiling`;

  it("refuses a registration ceremony configured below the floor", async () => {
    await expect(createPasskeyRegistrationOptions(ceremony({ ttlSeconds: 1 }), SUBJECT)).rejects.toThrow(BELOW_REGISTRATION);
  });

  it("refuses an authentication ceremony configured below the floor", async () => {
    await expect(createPasskeyRequestOptions(ceremony({ ttlSeconds: 1 }), { sessionId: SESSION })).rejects.toThrow(BELOW_REQUEST);
  });

  it("refuses a registration ceremony configured above the ceiling", async () => {
    await expect(createPasskeyRegistrationOptions(ceremony({ ttlSeconds: 86_400 }), SUBJECT)).rejects.toThrow(ABOVE_REGISTRATION);
  });

  it("refuses an authentication ceremony configured above the ceiling", async () => {
    await expect(createPasskeyRequestOptions(ceremony({ ttlSeconds: 86_400 }), { sessionId: SESSION })).rejects.toThrow(ABOVE_REQUEST);
  });

  // Both bounds themselves are usable, so the comparison is `<` and `>` and not `<=` and `>=`.
  it("accepts the floor and the ceiling themselves, spending each on the store TTL and the browser timeout", async () => {
    for (const seconds of [AUTH_PASSKEY_TTL_MIN_SECONDS, AUTH_PASSKEY_TTL_MAX_SECONDS]) {
      const options = ceremony({ ttlSeconds: seconds });
      const built = await createPasskeyRequestOptions(options, { sessionId: SESSION });
      expect(`${seconds}: ${built.ok ? built.data.timeout : "refused"}`).toBe(`${seconds}: ${seconds * 1000}`);
      expect(options.challenges.puts[0]?.ttl).toBe(seconds);
    }
  });
});
