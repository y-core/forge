import { beforeAll, describe, expect, it } from "bun:test";

import { base64urlEncode, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AUTH_PASSKEY_TTL_MAX_SECONDS, AUTH_PASSKEY_TTL_MIN_SECONDS, AUTH_PASSKEY_TTL_SECONDS } from "../config";
import { AuthStoreError } from "../errors";
import { PASSKEY_FLAG, createPasskeyKeyPair, fakePasskeyAssertion, fakePasskeyRegistration } from "../passkey/fixture";
import type { PasskeyKeyPair } from "../passkey/types";
import type {
  AuthChallenge,
  AuthCredential,
  AuthCredentialInput,
  AuthFactor,
  AuthUser,
  ChallengeStore,
  CredentialStore,
  FactorStore,
  UserStore,
} from "../types";
import { createPasskeyFactor } from "./passkey";
import type { PasskeyFactorOptions, PasskeyFactorRole } from "./types";

const RP_ID = "example.com";
const ORIGIN = "https://example.com";
const SESSION_ID = "session-1";
const USER_ID = uuidv7();
const CREDENTIAL_ID = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]) as Uint8Array<ArrayBuffer>;
const HANDLE = new Uint8Array(64).fill(0x33) as Uint8Array<ArrayBuffer>;
const AT = 1_700_000_000_000;

let ES256: PasskeyKeyPair;

beforeAll(async () => {
  ES256 = await createPasskeyKeyPair(-7);
});

function fakeChallenges() {
  const entries = new Map<string, AuthChallenge>();
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

function fakeCredentials(seed: readonly AuthCredential[] = []) {
  const rows = [...seed];
  const store: CredentialStore = {
    listByUser: (userId) => Promise.resolve(ok(rows.filter((row) => row.userId === userId))),
    findByCredentialId: (credentialId) => Promise.resolve(ok(rows.find((row) => row.credentialId === credentialId) ?? null)),
    create: (input: AuthCredentialInput, at) => {
      const row: AuthCredential = {
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
      rows.push(row);
      return Promise.resolve(ok(row));
    },
    recordUse: () => Promise.resolve(ok(true)),
    relabel: () => Promise.resolve(ok(true)),
    removeForUser: () => Promise.resolve(ok(true)),
  };
  return { store, rows };
}

function fakeFactors() {
  const rows: AuthFactor[] = [];
  const store: FactorStore = {
    listByUser: (userId) => Promise.resolve(ok(rows.filter((row) => row.userId === userId))),
    find: (userId, kind) => Promise.resolve(ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    findEnrolled: (userId, kinds) => Promise.resolve(ok(rows.filter((row) => row.userId === userId && kinds.includes(row.kind)))),
    enrol: (input, at) => {
      const row: AuthFactor = {
        id: uuidv7(),
        userId: input.userId,
        kind: input.kind,
        secret: input.secret ?? null,
        lastCounter: null,
        confirmedAt: input.confirmedAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      rows.push(row);
      return Promise.resolve(ok(row));
    },
    confirm: (id, _userId, at) => {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, confirmedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
    countAttempt: () => Promise.resolve(ok(true)),
    advanceCounter: () => Promise.resolve(ok(true)),
    remove: () => Promise.resolve(ok(true)),
  };
  return { store, rows };
}

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "person@example.com",
    emailKey: "person@example.com",
    emailVerifiedAt: 1_600_000_000_000,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeUsers(seed: readonly AuthUser[]) {
  const rows = [...seed];
  const minted: Uint8Array<ArrayBuffer>[] = [];
  const store: UserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    findByEmailKey: () => Promise.resolve(ok(null)),
    findByWebAuthnId: (webauthnId) =>
      Promise.resolve(ok(rows.find((row) => row.webauthnId !== null && base64urlEncode(row.webauthnId) === base64urlEncode(webauthnId)) ?? null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: (id, webauthnId, at) => {
      minted.push(webauthnId);
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(null));
      if (row.webauthnId === null) rows[index] = { ...row, webauthnId, updatedAt: at };
      return Promise.resolve(ok(rows[index] ?? null));
    },
    markEmailVerified: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
  };
  return { store, rows, minted };
}

interface World {
  challenges: ReturnType<typeof fakeChallenges>;
  credentials: ReturnType<typeof fakeCredentials>;
  factors: ReturnType<typeof fakeFactors>;
  users: ReturnType<typeof fakeUsers>;
}

function world(users: readonly AuthUser[] = [userRow()], credentials: readonly AuthCredential[] = []): World {
  return { challenges: fakeChallenges(), credentials: fakeCredentials(credentials), factors: fakeFactors(), users: fakeUsers(users) };
}

function build(scene: World, role: PasskeyFactorRole = "step-up") {
  const options: PasskeyFactorOptions = {
    rpId: RP_ID,
    rpName: "Forge Demo",
    origin: ORIGIN,
    sessionId: SESSION_ID,
    role,
    users: scene.users.store,
    factors: scene.factors.store,
    credentials: scene.credentials.store,
    challenges: scene.challenges.store,
    subject: () => ({ name: "person@example.com", displayName: "A Person" }),
  };
  return createPasskeyFactor(options);
}

function issuedChallenge(scene: World, ceremony: "register" | "authenticate"): string {
  const held = scene.challenges.entries.get(`passkey:${ceremony}:${SESSION_ID}`);
  if (!held) throw new Error(`no ${ceremony} challenge was stored`);
  return held.challenge;
}

/** Enrols one credential through the real registration ceremony and returns its base64url id. */
async function enrol(scene: World, nickname?: string): Promise<string> {
  const completed = await offer(scene, nickname);
  if (!completed.ok) throw new Error(`completion refused: ${completed.error}`);
  return base64urlEncode(CREDENTIAL_ID);
}

/** Runs the registration ceremony to its finish and returns whatever the factor answered. */
async function offer(scene: World, nickname?: string) {
  const begun = await build(scene).beginEnrolment(USER_ID, AT);
  if (!begun.ok) throw new Error(`enrolment refused: ${begun.error}`);
  const credential = await fakePasskeyRegistration({
    key: ES256,
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: issuedChallenge(scene, "register"),
    credentialId: CREDENTIAL_ID,
  });
  return build(scene).completeEnrolment(USER_ID, JSON.stringify({ credential, nickname }), AT);
}

describe("createPasskeyFactor — the contract it implements", () => {
  it("identifies and steps up, and enrols through a ceremony of its own", () => {
    const service = build(world());
    expect(service.kind).toBe("passkey");
    expect(service.enrolment).toBe("explicit");
    expect(service.capabilities).toEqual({ primary: true, stepUp: true });
  });
});

describe("createPasskeyFactor — the user-verification matrix", () => {
  // A step-up exists to demand a fresh human gesture; as the primary factor `required` would only
  // lock out authenticators that cannot do it.
  it("asks for `required` as a step-up and `preferred` as the primary factor, in both ceremonies", async () => {
    for (const [role, expected] of [
      ["step-up", "required"],
      ["primary", "preferred"],
    ] as const) {
      const scene = world();
      const enrolment = await build(scene, role).beginEnrolment(USER_ID, AT);
      const request = await build(scene, role).createChallenge(USER_ID, AT);
      const registration = enrolment.ok ? (enrolment.data.options as { authenticatorSelection: { userVerification: string } }) : undefined;
      const assertion = request.ok ? (request.data.options as { userVerification: string }) : undefined;
      expect(`${role}: ${registration?.authenticatorSelection.userVerification} ${assertion?.userVerification}`).toBe(
        `${role}: ${expected} ${expected}`,
      );
    }
  });
});

describe("createPasskeyFactor — enrolment", () => {
  it("mints a 64-byte user handle on the first enrolment and reuses it on the next", async () => {
    const scene = world();
    await build(scene).beginEnrolment(USER_ID, AT);
    expect(scene.users.minted).toHaveLength(1);
    expect(scene.users.minted[0]?.byteLength).toBe(64);
    const handle = scene.users.rows[0]?.webauthnId;

    await build(scene).beginEnrolment(USER_ID, AT);
    expect(scene.users.minted).toHaveLength(1);
    expect(scene.users.rows[0]?.webauthnId).toBe(handle as Uint8Array<ArrayBuffer>);
  });

  it("offers the handle the account already carries, base64url, as the ceremony's user id", async () => {
    const scene = world([userRow({ webauthnId: HANDLE })]);
    const begun = await build(scene).beginEnrolment(USER_ID, AT);
    expect(begun.ok && (begun.data.options as { user: { id: string } }).user.id).toBe(base64urlEncode(HANDLE));
    expect(scene.users.minted).toHaveLength(0);
  });

  it("refuses an enrolment for a user the store does not hold", async () => {
    expect(await build(world([])).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("writes the credential and a confirmed factor row, because the ceremony is the confirmation", async () => {
    const scene = world();
    await enrol(scene);
    expect(scene.credentials.rows.map((row) => row.credentialId)).toEqual([base64urlEncode(CREDENTIAL_ID)]);
    expect(scene.factors.rows.map((row) => `${row.kind}:${row.confirmedAt}`)).toEqual([`passkey:${AT}`]);
  });

  it("keeps exactly one factor row when a second credential is enrolled", async () => {
    const scene = world();
    await enrol(scene);
    const begun = await build(scene).beginEnrolment(USER_ID, AT);
    expect(begun.ok).toBe(true);
    const second = await fakePasskeyRegistration({
      key: ES256,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: issuedChallenge(scene, "register"),
      credentialId: new Uint8Array([1, 1, 1, 1]) as Uint8Array<ArrayBuffer>,
    });
    expect((await build(scene).completeEnrolment(USER_ID, JSON.stringify({ credential: second }), AT + 1)).ok).toBe(true);
    expect(scene.factors.rows).toHaveLength(1);
    expect(scene.credentials.rows).toHaveLength(2);
  });

  it("reports a spent challenge as `expired` and unparseable JSON as `unrecognised`", async () => {
    const scene = world();
    const credential = await fakePasskeyRegistration({ key: ES256, rpId: RP_ID, origin: ORIGIN, challenge: "c", credentialId: CREDENTIAL_ID });
    expect(await build(scene).completeEnrolment(USER_ID, JSON.stringify({ credential }), AT)).toEqual({ ok: false, error: "expired" });
    expect(await build(scene).completeEnrolment(USER_ID, "not json", AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(await build(scene).completeEnrolment(USER_ID, JSON.stringify({ credential: { id: "x", response: {} } }), AT)).toEqual({
      ok: false,
      error: "unrecognised",
    });
  });
});

// The name the visitor typed at enrolment, which the enrol-finish endpoint forwards in this
// factor's own payload rather than through a parameter every factor would have to carry.
describe("createPasskeyFactor — the nickname a ceremony carries", () => {
  it("stores the credential under the name the ceremony carried", async () => {
    const scene = world();
    await enrol(scene, "Work laptop");
    expect(scene.credentials.rows.map((row) => row.label)).toEqual(["Work laptop"]);
  });

  it("stores no name at all when the ceremony carried none, and none for a blank one", async () => {
    for (const nickname of [undefined, "   "]) {
      const scene = world();
      await enrol(scene, nickname);
      expect(scene.credentials.rows.map((row) => row.label)).toEqual([null]);
    }
  });

  it("refuses a name past the 64-character bound the store is held to", async () => {
    const scene = world();
    expect(await offer(scene, "x".repeat(65))).toEqual({ ok: false, error: "unrecognised" });
    expect(scene.credentials.rows).toHaveLength(0);
  });
});

describe("createPasskeyFactor — verification", () => {
  it("accepts an assertion the enrolled credential signed, and names the user it establishes", async () => {
    const scene = world();
    const credentialId = await enrol(scene);
    const challenge = await build(scene).createChallenge(USER_ID, AT);
    expect(challenge.ok && challenge.data.kind).toBe("passkey");

    const assertion = await fakePasskeyAssertion({
      key: ES256,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: issuedChallenge(scene, "authenticate"),
      credentialId,
      signCount: 1,
    });
    expect(await build(scene).verifyChallenge(USER_ID, JSON.stringify(assertion), AT)).toEqual({
      ok: true,
      data: { kind: "passkey", userId: USER_ID, verifiedAt: AT },
    });
  });

  it("refuses an assertion whose credential belongs to another user", async () => {
    const scene = world();
    const credentialId = await enrol(scene);
    await build(scene).createChallenge(USER_ID, AT);
    const assertion = await fakePasskeyAssertion({
      key: ES256,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: issuedChallenge(scene, "authenticate"),
      credentialId,
      signCount: 1,
    });
    expect(await build(scene).verifyChallenge(uuidv7(), JSON.stringify(assertion), AT)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("refuses an assertion with no user-verified flag, because a step-up demands the gesture", async () => {
    const scene = world();
    const credentialId = await enrol(scene);
    await build(scene).createChallenge(USER_ID, AT);
    const assertion = await fakePasskeyAssertion({
      key: ES256,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: issuedChallenge(scene, "authenticate"),
      credentialId,
      flags: PASSKEY_FLAG.up,
      signCount: 1,
    });
    expect(await build(scene).verifyChallenge(USER_ID, JSON.stringify(assertion), AT)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("reports a spent challenge as `expired`", async () => {
    const scene = world();
    const credentialId = await enrol(scene);
    const assertion = await fakePasskeyAssertion({ key: ES256, rpId: RP_ID, origin: ORIGIN, challenge: "c", credentialId, signCount: 1 });
    expect(await build(scene).verifyChallenge(USER_ID, JSON.stringify(assertion), AT)).toEqual({ ok: false, error: "expired" });
  });
});

describe("createPasskeyFactor — listing and store failures", () => {
  it("lists the one factor row this kind owns", async () => {
    const scene = world();
    expect(await build(scene).listEnrolments(USER_ID)).toEqual({ ok: true, data: [] });
    await enrol(scene);
    const listed = await build(scene).listEnrolments(USER_ID);
    expect(listed.ok && listed.data.map((row) => row.kind)).toEqual(["passkey"]);
  });

  it("reports an I/O failure as `unavailable`, never as a refused ceremony", async () => {
    const scene = world();
    const broken: UserStore = { ...scene.users.store, findById: () => Promise.resolve(err(new AuthStoreError("unavailable", "users.findById"))) };
    const service = createPasskeyFactor({
      rpId: RP_ID,
      rpName: "Forge Demo",
      origin: ORIGIN,
      sessionId: SESSION_ID,
      role: "step-up",
      users: broken,
      factors: scene.factors.store,
      credentials: scene.credentials.store,
      challenges: scene.challenges.store,
      subject: () => ({ name: "person@example.com", displayName: "A Person" }),
    });
    expect(await service.beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("createPasskeyFactor — the ceremony lifetime it holds at construction", () => {
  function factory(ttlSeconds?: number) {
    const scene = world();
    return () =>
      createPasskeyFactor({
        rpId: RP_ID,
        rpName: "Forge Demo",
        origin: ORIGIN,
        sessionId: SESSION_ID,
        role: "step-up",
        users: scene.users.store,
        factors: scene.factors.store,
        credentials: scene.credentials.store,
        challenges: scene.challenges.store,
        subject: () => ({ name: "person@example.com", displayName: "A Person" }),
        ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      });
  }

  it("refuses a lifetime below the floor, naming the factory and not a ceremony builder", () => {
    expect(factory(1)).toThrow(
      `createPasskeyFactor: ttlSeconds is 1, below the ${AUTH_PASSKEY_TTL_MIN_SECONDS}-second floor — the shortest expiration the challenge store accepts, and less time than an authenticator prompt takes to answer.`,
    );
  });

  it("refuses a lifetime above the ceiling", () => {
    expect(factory(86_400)).toThrow(
      `createPasskeyFactor: ttlSeconds is 86400, above the ${AUTH_PASSKEY_TTL_MAX_SECONDS}-second ceiling — a replayable ceremony challenge must not stay live longer than an emailed code.`,
    );
  });

  it("refuses a fraction the challenge store would refuse later and elsewhere", () => {
    expect(factory(120.5)).toThrow("createPasskeyFactor: ttlSeconds is 120.5, which is not a whole number.");
  });

  it("accepts both bounds themselves", () => {
    expect(factory(AUTH_PASSKEY_TTL_MIN_SECONDS)).not.toThrow();
    expect(factory(AUTH_PASSKEY_TTL_MAX_SECONDS)).not.toThrow();
  });

  it("spends the default on the browser timeout when no lifetime was configured", async () => {
    const scene = world();
    expect(factory()).not.toThrow();
    const begun = await build(scene).createChallenge(USER_ID, AT);
    expect(begun.ok && (begun.data.options as { timeout: number }).timeout).toBe(AUTH_PASSKEY_TTL_SECONDS * 1000);
  });

  it("throws in the wiring frame itself, so no ceremony is ever reached to refuse one", () => {
    const scene = world();
    const wire = () =>
      createPasskeyFactor({
        rpId: RP_ID,
        rpName: "Forge Demo",
        origin: ORIGIN,
        sessionId: SESSION_ID,
        role: "step-up",
        users: scene.users.store,
        factors: scene.factors.store,
        credentials: scene.credentials.store,
        challenges: scene.challenges.store,
        subject: () => ({ name: "person@example.com", displayName: "A Person" }),
        ttlSeconds: 1,
      });
    expect(wire).toThrow(Error);
    expect(scene.challenges.entries.size).toBe(0);
  });
});
