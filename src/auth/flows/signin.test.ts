import { beforeAll, describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AuthStoreError } from "../errors";
import { createFactorRegistry } from "../factors/registry";
import type {
  AuthFactorChallenge,
  AuthFactorOffer,
  AuthFactorReason,
  AuthFactorRequirement,
  AuthFactorVerified,
  EnrollableFactorService,
} from "../factors/types";
import type { ImplicitFactorService } from "../factors/types";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthFactor, AuthKeyRing, AuthUser, FactorStore, NonceStore, OtpStateStore, UserStore } from "../types";
import { createSigninFlow, redactSigninReason } from "./signin";
import type { AuthIssueOutcome } from "./types";
import type { AuthSigninOptions, AuthSigninReason } from "./types";

const USER_ID = uuidv7();
const EMAIL = "Person@Example.COM";
const EMAIL_KEY = "person@example.com";
const AT = 1_700_000_000_000;

let ring: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["e7ae715d21b12b5421420dbb7636a3a37ff40dc73df25691a57fb38cf9fa25a2"]);
});

interface FactorSpy {
  challenged: string[];
  verified: string[];
  verdict?: Result<AuthFactorVerified, AuthFactorReason>;
}

/** The lifetime the primary factor enforces, which is now the only source of a reported expiry. */
const OTP_TTL_MS = 600_000;

function implicitFactor(
  spy: FactorSpy,
  verdict: Result<AuthFactorVerified, AuthFactorReason> = ok({ kind: "email-otp", userId: USER_ID, verifiedAt: AT }),
): ImplicitFactorService {
  return {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { primary: true, stepUp: true },
    challengeTtlMs: OTP_TTL_MS,
    codeDigits: 6,
    codePeriodSeconds: null,
    reissueAfterMs: null,
    createChallenge: (userId, at) => {
      spy.challenged.push(userId);
      return Promise.resolve(ok({ kind: "email-otp", expiresAt: at + 1_000 } as AuthFactorChallenge));
    },
    verifyChallenge: (userId) => {
      spy.verified.push(userId);
      return Promise.resolve(verdict);
    },
    listEnrolments: () => Promise.resolve(ok([])),
  };
}

function totpFactor(spy: FactorSpy): EnrollableFactorService {
  return {
    kind: "totp-app",
    enrolment: "explicit",
    capabilities: { primary: false, stepUp: true },
    challengeTtlMs: 30_000,
    codeDigits: 6,
    codePeriodSeconds: null,
    reissueAfterMs: null,
    createChallenge: (userId, at) => {
      spy.challenged.push(userId);
      return Promise.resolve(ok({ kind: "totp-app", expiresAt: at + 30_000 } as AuthFactorChallenge));
    },
    verifyChallenge: (userId) => {
      spy.verified.push(userId);
      return Promise.resolve(spy.verdict ?? ok({ kind: "totp-app", userId, verifiedAt: AT }));
    },
    beginEnrolment: () => Promise.resolve(err("unrecognised" as const)),
    completeEnrolment: () => Promise.resolve(err("unrecognised" as const)),
    listEnrolments: () => Promise.resolve(ok([])),
  };
}

function fakeFactorStore(enrolled: readonly AuthFactor[] = []): FactorStore {
  return {
    listByUser: () => Promise.resolve(ok(enrolled)),
    find: () => Promise.resolve(ok(null)),
    findEnrolled: (_userId, kinds) => Promise.resolve(ok(enrolled.filter((row) => kinds.includes(row.kind)))),
    enrol: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol"))),
    confirm: () => Promise.resolve(ok(true)),
    countAttempt: (userId, kind) => Promise.resolve(ok(enrolled.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    advanceCounter: () => Promise.resolve(ok(true)),
    remove: () => Promise.resolve(ok(true)),
  };
}

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "person@example.com",
    emailKey: EMAIL_KEY,
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

function fakeUsers(rows: readonly AuthUser[]) {
  const held = [...rows];
  const verifiedAt: number[] = [];
  const reads: string[] = [];
  const store: UserStore = {
    findById: (id) => {
      reads.push("findById");
      return Promise.resolve(ok(held.find((row) => row.id === id) ?? null));
    },
    findByEmailKey: (emailKey) => {
      reads.push("findByEmailKey");
      return Promise.resolve(ok(held.find((row) => row.emailKey === emailKey) ?? null));
    },
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: (_id, at) => {
      verifiedAt.push(at);
      return Promise.resolve(ok(true));
    },
    changeEmail: () => Promise.resolve(ok(true)),
    revokeSessions: async () => ok(true),
  };
  return { store, verifiedAt, reads };
}

/** The two ephemeral stores the decoy spends, recording nothing but that they were reachable. */
function decoyStores(): { state: OtpStateStore; nonces: NonceStore } {
  return {
    state: {
      issue: () => Promise.resolve(ok(true)),
      countAttempt: () => Promise.resolve(ok(null)),
      read: () => Promise.resolve(ok(null)),
      discard: () => Promise.resolve(ok()),
      clear: () => Promise.resolve(ok()),
    },
    nonces: { markConsumed: () => Promise.resolve(ok(true)) },
  };
}

function fakeDeferral() {
  const scheduled: Promise<AuthIssueOutcome>[] = [];
  return { defer: (work: Promise<AuthIssueOutcome>) => void scheduled.push(work), scheduled };
}

interface Scene {
  users: ReturnType<typeof fakeUsers>;
  deferral: ReturnType<typeof fakeDeferral>;
  primary: FactorSpy;
  stepUp: FactorSpy;
}

function flow(
  world: Scene,
  second: AuthFactorRequirement | "none" = "none",
  enrolled: readonly AuthFactor[] = [],
  verdict?: Result<AuthFactorVerified, AuthFactorReason>,
  overrides: Partial<AuthSigninOptions> = {},
) {
  const primary = { service: implicitFactor(world.primary, verdict), role: "primary" } as const;
  const offered: AuthFactorOffer[] =
    second === "none" ? [primary] : [primary, { service: totpFactor(world.stepUp), role: "second", requirement: second }];
  const options: AuthSigninOptions = {
    keys: ring,
    users: world.users.store,
    ...decoyStores(),
    factors: createFactorRegistry(fakeFactorStore(enrolled), { offered }),
    defer: world.deferral.defer,
    ...overrides,
  };
  return createSigninFlow(options);
}

function scene(users: readonly AuthUser[] = [userRow()]): Scene {
  return { users: fakeUsers(users), deferral: fakeDeferral(), primary: { challenged: [], verified: [] }, stepUp: { challenged: [], verified: [] } };
}

function factorRow(kind: AuthFactor["kind"], confirmedAt: number | null): AuthFactor {
  return { id: uuidv7(), userId: USER_ID, kind, secret: null, lastCounter: null, failedAttempts: 0, confirmedAt, createdAt: 1, updatedAt: 1 };
}

describe("createSigninFlow — anti-enumeration on complete", () => {
  const DEACTIVATED = userRow({ deactivatedAt: 1_650_000_000_000 });

  /** What one `complete` cost: the reads it made of the user store, and whether it reached the factor. */
  async function work(world: Scene, email: string) {
    const outcome = await flow(world, "none", [], err("unrecognised" as const)).complete(email, "000000", AT);
    return { reads: world.users.reads, verified: world.primary.verified.length, outcome };
  }

  // The falsifiable criterion for this fix. `request` has had a decoy since the first unit and
  // `complete` had none, so the branch with no account returned after a single lookup while the
  // branch with one went on to open a sealed token — a latency answer to the question the
  // response refuses to answer. Deleting `verifyAuthDecoy` turns this red.
  it("performs the same reads on the unknown, deactivated and known branches", async () => {
    const unknown = await work(scene([]), "nobody@example.com");
    const deactivated = await work(scene([DEACTIVATED]), EMAIL);
    const known = await work(scene(), EMAIL);

    expect(unknown.reads).toEqual(["findByEmailKey", "findById"]);
    expect(deactivated.reads).toEqual(["findByEmailKey", "findById"]);
    // The known branch's second read is the factor's own, against the code it was handed.
    expect(known.reads).toEqual(["findByEmailKey"]);
    expect(known.verified).toBe(1);
    expect(unknown.reads.length + unknown.verified).toBe(known.reads.length + known.verified);
    expect(deactivated.reads.length + deactivated.verified).toBe(known.reads.length + known.verified);
  });

  it("reaches no factor on either refusing branch, so nothing is spent against a code that does not exist", async () => {
    expect((await work(scene([]), "nobody@example.com")).verified).toBe(0);
    expect((await work(scene([DEACTIVATED]), EMAIL)).verified).toBe(0);
  });

  it("still answers each branch with its own operator reason, which the redaction folds", async () => {
    const unknown = await work(scene([]), "nobody@example.com");
    const deactivated = await work(scene([DEACTIVATED]), EMAIL);
    expect(unknown.outcome).toEqual({ ok: false, error: "unrecognised" });
    expect(deactivated.outcome).toEqual({ ok: false, error: "deactivated" });
    expect(redactSigninReason("deactivated")).toBe(redactSigninReason("unrecognised"));
  });

  // The defect this closes: a throttled known address answered `too-many-attempts` where an unknown
  // one answered `unrecognised`, and `redactSigninReason` renders those as two different notices —
  // so the difference reached the rendered page and named the address as one this deployment knows.
  it("answers a throttled known address exactly as it answers an unknown one", async () => {
    const throttled = await flow(scene(), "none", [], err("too-many-attempts" as const)).complete(EMAIL, "000000", AT);
    const tooSoon = await flow(scene(), "none", [], err("too-soon" as const)).complete(EMAIL, "000000", AT);
    const unknown = await work(scene([]), "nobody@example.com");

    expect(throttled).toEqual({ ok: false, error: "unrecognised" });
    expect(tooSoon).toEqual({ ok: false, error: "unrecognised" });
    expect(throttled).toEqual(unknown.outcome);
  });

  it("carries every other refusal through unfolded, so an operator still reads the true reason", async () => {
    const expired = await flow(scene(), "none", [], err("expired" as const)).complete(EMAIL, "000000", AT);
    expect(expired).toEqual({ ok: false, error: "expired" });
  });
});

// The caller is already identified here — the session names them — so a throttle tells an attacker
// nothing they do not already have, and folding it would cost an operator the true reason for free.
describe("createSigninFlow — the step-up path keeps the true reason", () => {
  it("answers `too-many-attempts` from stepUp rather than the primary path's folded refusal", async () => {
    const world = scene();
    const signin = flow(world, "mandatory", [factorRow("totp-app", 1)]);
    world.stepUp.verdict = err("too-many-attempts" as const);
    expect(await signin.stepUp(USER_ID, "totp-app", "000000", AT)).toEqual({ ok: false, error: "too-many-attempts" });
  });
});

describe("createSigninFlow — anti-enumeration on request", () => {
  it("answers a registered address and an unknown one with the identical value", async () => {
    const known = scene();
    const unknown = scene([]);
    expect(flow(known).request(EMAIL, AT)).toEqual(flow(unknown).request("nobody@example.com", AT));
    await Promise.all([...known.deferral.scheduled, ...unknown.deferral.scheduled]);
  });

  // The falsifiable criterion for this unit. Deleting the "pointless" decoy branch — the one that
  // looks like it does nothing for an address nobody has — turns this assertion red.
  it("schedules deferred work on the unknown-address branch too, and that work is the decoy", async () => {
    const unknown = scene([]);
    flow(unknown).request("nobody@example.com", AT);
    expect(unknown.deferral.scheduled).toHaveLength(1);
    expect(await (unknown.deferral.scheduled[0] as Promise<AuthIssueOutcome>)).toBe("decoyed");
    expect(unknown.primary.challenged).toEqual([]);
  });

  it("schedules a real challenge on the known-address branch, off the caller's clock", async () => {
    const known = scene();
    known.deferral.scheduled.length = 0;
    flow(known).request(EMAIL, AT);
    expect(known.deferral.scheduled).toHaveLength(1);
    // Nothing has been challenged yet: the work was handed over, not awaited.
    expect(known.primary.challenged).toEqual([]);
    expect(await (known.deferral.scheduled[0] as Promise<AuthIssueOutcome>)).toBe("challenged");
    expect(known.primary.challenged).toEqual([USER_ID]);
  });

  it("folds a case-different spelling of one mailbox onto the same account", async () => {
    const known = scene();
    flow(known).request("PERSON@EXAMPLE.COM", AT);
    expect(await (known.deferral.scheduled[0] as Promise<AuthIssueOutcome>)).toBe("challenged");
  });

  it("reports a store outage to the deferred work, never to the caller", async () => {
    const broken = scene();
    broken.users.store.findByEmailKey = () => Promise.resolve(err(new AuthStoreError("unavailable", "users.findByEmailKey")));
    const answered = flow(broken).request(EMAIL, AT);
    expect(answered).toEqual({ kind: "email-otp", expiresAt: AT + 600_000 });
    expect(await (broken.deferral.scheduled[0] as Promise<AuthIssueOutcome>)).toBe("unavailable");
  });
});

describe("createSigninFlow — completing a sign-in", () => {
  it("refuses an unknown address without touching the factor", async () => {
    const unknown = scene([]);
    expect(await flow(unknown).complete("nobody@example.com", "123456", AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(unknown.primary.verified).toEqual([]);
  });

  it("passes the factor's own refusal straight through, except the two that name the address", async () => {
    const known = scene();
    const refused = await flow(known, "none", [], err("expired")).complete(EMAIL, "123456", AT);
    expect(refused).toEqual({ ok: false, error: "expired" });
  });

  it("marks the address verified on the first pass of an implicit primary factor", async () => {
    const known = scene([userRow({ emailVerifiedAt: null })]);
    const outcome = await flow(known).complete(EMAIL, "123456", AT);
    expect(known.users.verifiedAt).toEqual([AT]);
    expect(outcome.ok && outcome.data.user.emailVerifiedAt).toBe(AT);
  });

  it("does not re-mark an address that is already verified", async () => {
    const known = scene();
    await flow(known).complete(EMAIL, "123456", AT);
    expect(known.users.verifiedAt).toEqual([]);
  });
});

describe("createSigninFlow — the second-factor requirement", () => {
  it("completes where no second factor is offered", async () => {
    const outcome = await flow(scene()).complete(EMAIL, "123456", AT);
    expect(outcome.ok && outcome.data.resolution).toEqual({ status: "satisfied" });
  });

  it("answers `enrolment-required` as a success under `mandatory` with nothing enrolled", async () => {
    const outcome = await flow(scene(), "mandatory").complete(EMAIL, "123456", AT);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.data.resolution).toEqual({ status: "enrolment-required", kinds: ["totp-app"] });
  });

  it("completes under `optional` with nothing enrolled, and demands a step-up once one is", async () => {
    const empty = await flow(scene(), "optional").complete(EMAIL, "123456", AT);
    expect(empty.ok && empty.data.resolution).toEqual({ status: "satisfied" });

    const held = await flow(scene(), "optional", [factorRow("totp-app", 5_000)]).complete(EMAIL, "123456", AT);
    expect(held.ok && held.data.resolution).toEqual({ status: "step-up-required", kinds: ["totp-app"] });
  });

  it("derives the roles off the row it loaded, so `mandatoryForRoles` binds an admin and nobody else", async () => {
    const second: AuthFactorRequirement = { mandatoryForRoles: ["admin"] };
    const matched = await flow(scene([userRow({ isAdmin: true })]), second).complete(EMAIL, "123456", AT);
    expect(matched.ok && matched.data.resolution).toEqual({ status: "enrolment-required", kinds: ["totp-app"] });

    const other = await flow(scene(), second).complete(EMAIL, "123456", AT);
    expect(other.ok && other.data.resolution).toEqual({ status: "satisfied" });
  });
});

describe("createSigninFlow — a deactivated account", () => {
  const deactivated = () => scene([userRow({ deactivatedAt: 1_650_000_000_000 })]);

  it("refuses to complete a sign-in, without ever reaching the factor", async () => {
    const closed = deactivated();
    expect(await flow(closed).complete(EMAIL, "123456", AT)).toEqual({ ok: false, error: "deactivated" });
    expect(closed.primary.verified).toEqual([]);
  });

  it("refuses to issue or to verify a step-up", async () => {
    const closed = deactivated();
    const built = flow(closed, "optional");
    expect(await built.requestStepUp(USER_ID, "totp-app", AT)).toEqual({ ok: false, error: "deactivated" });
    expect(await built.stepUp(USER_ID, "totp-app", "123456", AT)).toEqual({ ok: false, error: "deactivated" });
    expect(closed.stepUp.challenged).toEqual([]);
    expect(closed.stepUp.verified).toEqual([]);
  });

  it("still issues the deferred challenge, because refusing it early would name the account", async () => {
    const closed = deactivated();
    flow(closed).request(EMAIL, AT);
    expect(await (closed.deferral.scheduled[0] as Promise<AuthIssueOutcome>)).toBe("challenged");
  });
});

describe("createSigninFlow — the step-up entry points", () => {
  it("issues and verifies a step-up for an active account", async () => {
    const open = scene();
    const built = flow(open, "optional");
    expect(await built.requestStepUp(USER_ID, "totp-app", AT)).toEqual({ ok: true, data: { kind: "totp-app", expiresAt: AT + 30_000 } });
    expect(await built.stepUp(USER_ID, "totp-app", "123456", AT)).toEqual({
      ok: true,
      data: { kind: "totp-app", userId: USER_ID, verifiedAt: AT },
    });
  });

  it("refuses a kind that is not an offered step-up, including the primary factor itself", async () => {
    const built = flow(scene(), "optional");
    expect(await built.stepUp(USER_ID, "email-otp", "123456", AT)).toEqual({ ok: false, error: "not-enrolled" });
    expect(await built.stepUp(USER_ID, "passkey", "123456", AT)).toEqual({ ok: false, error: "not-enrolled" });
  });

  it("refuses a user the store does not hold", async () => {
    const built = flow(scene([]), "optional");
    expect(await built.stepUp(USER_ID, "totp-app", "123456", AT)).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("redactSigninReason", () => {
  // Separate in the reason union for the operator's log, identical in anything a visitor sees.
  it("folds a deactivated account onto the answer an unknown address gets", () => {
    expect(redactSigninReason("deactivated")).toBe(redactSigninReason("unrecognised"));
    expect(redactSigninReason("deactivated")).toBe("unrecognised");
  });

  it("collapses every membership-revealing reason and keeps only throttling and outage apart", () => {
    const rows: readonly [AuthSigninReason, string][] = [
      ["deactivated", "unrecognised"],
      ["expired", "unrecognised"],
      ["consumed", "unrecognised"],
      ["already-enrolled", "unrecognised"],
      ["not-enrolled", "unrecognised"],
      ["unrecognised", "unrecognised"],
      ["too-many-attempts", "throttled"],
      ["too-soon", "throttled"],
      ["unavailable", "unavailable"],
    ];
    for (const [reason, notice] of rows) expect(`${reason}: ${redactSigninReason(reason)}`).toBe(`${reason}: ${notice}`);
  });
});

describe("createSigninFlow — the challenge lifetime it reports", () => {
  // The defect this closes: the flow carried a `challengeTtlMs` of its own, so a deployment could
  // configure the factor's real lifetime and the number the page shows to different values.
  it("reports the lifetime the primary factor enforces, and has no lifetime of its own to disagree with it", () => {
    const world = scene();
    const registry = flow(world).request("person@example.com", AT);
    expect(registry).toEqual({ kind: "email-otp", expiresAt: AT + OTP_TTL_MS });
  });

  it("moves with the factor, so the two cannot be configured apart", () => {
    const world = scene();
    const brief: ImplicitFactorService = { ...implicitFactor(world.primary), challengeTtlMs: 90_000 };
    const options: AuthSigninOptions = {
      keys: ring,
      users: world.users.store,
      ...decoyStores(),
      factors: createFactorRegistry(fakeFactorStore([]), { offered: [{ service: brief, role: "primary" }] }),
      defer: world.deferral.defer,
    };
    expect(createSigninFlow(options).request("person@example.com", AT)).toEqual({ kind: "email-otp", expiresAt: AT + 90_000 });
  });
});
