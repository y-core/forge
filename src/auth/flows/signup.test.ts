import { describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { type AuthFactorChallenge, type ImplicitFactorService, createFactorRegistry } from "../factors/registry";
import type { AuthFactor, AuthUser, AuthUserInput, FactorStore, UserStore } from "../types";
import type { AuthIssueOutcome } from "./decoy";
import { type AuthSignupOptions, createSignupFlow } from "./signup";

const EMAIL = "  New.Person@Example.COM  ";
const EMAIL_KEY = "new.person@example.com";
const AT = 1_700_000_000_000;

const NO_FACTOR_ROWS: FactorStore = {
  listByUser: () => Promise.resolve(ok([] as readonly AuthFactor[])),
  find: () => Promise.resolve(ok(null)),
  findEnrolled: () => Promise.resolve(ok([])),
  enrol: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol"))),
  confirm: () => Promise.resolve(ok(true)),
  countAttempt: () => Promise.resolve(ok(true)),
  advanceCounter: () => Promise.resolve(ok(true)),
  remove: () => Promise.resolve(ok(true)),
};

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: uuidv7(),
    email: "new.person@example.com",
    emailKey: EMAIL_KEY,
    emailVerifiedAt: null,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeUsers(seed: readonly AuthUser[], options: { conflict?: boolean } = {}) {
  const rows = [...seed];
  const created: AuthUserInput[] = [];
  const store: UserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    findByEmailKey: (emailKey) => Promise.resolve(ok(rows.find((row) => row.emailKey === emailKey) ?? null)),
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: (input, at) => {
      created.push(input);
      if (options.conflict) return Promise.resolve(err(new AuthStoreError("conflict", "users.create", { constraint: "auth_users.email_key" })));
      const row = userRow({ id: uuidv7(), email: input.email, emailKey: input.emailKey, createdAt: at, updatedAt: at });
      rows.push(row);
      return Promise.resolve(ok(row));
    },
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
  };
  return { store, rows, created };
}

/** The lifetime the primary factor enforces, which is now the only source of a reported expiry. */
const OTP_TTL_MS = 600_000;

function fakeDeferral() {
  const scheduled: Promise<AuthIssueOutcome>[] = [];
  return { defer: (work: Promise<AuthIssueOutcome>) => void scheduled.push(work), scheduled };
}

function scene(seed: readonly AuthUser[] = [], options: { conflict?: boolean } = {}, overrides: Partial<AuthSignupOptions> = {}) {
  const challenged: string[] = [];
  const primary: ImplicitFactorService = {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { primary: true, stepUp: true },
    challengeTtlMs: OTP_TTL_MS,
    codeDigits: 6,
    reissueAfterMs: null,
    createChallenge: (userId, at) => {
      challenged.push(userId);
      return Promise.resolve(ok({ kind: "email-otp", expiresAt: at + 1_000 } as AuthFactorChallenge));
    },
    verifyChallenge: () => Promise.resolve(err("unrecognised" as const)),
    listEnrolments: () => Promise.resolve(ok([])),
  };
  const users = fakeUsers(seed, options);
  const deferral = fakeDeferral();
  const flow = createSignupFlow({
    users: users.store,
    factors: createFactorRegistry(NO_FACTOR_ROWS, { offered: [primary], policy: { mode: "single" } }),
    defer: deferral.defer,
    ...overrides,
  });
  return { flow, users, deferral, challenged };
}

async function settle(scheduled: readonly Promise<AuthIssueOutcome>[]): Promise<readonly AuthIssueOutcome[]> {
  return Promise.all(scheduled);
}

describe("createSignupFlow — anti-enumeration on request", () => {
  it("answers a registered address and a new one with the identical value", async () => {
    const fresh = scene();
    const taken = scene([userRow()]);
    expect(fresh.flow.request(EMAIL, AT)).toEqual(taken.flow.request(EMAIL, AT));
    await settle([...fresh.deferral.scheduled, ...taken.deferral.scheduled]);
  });

  // Both branches hand one promise to the same deferral, so the lookup, the insert and the delivery
  // are all off the caller's clock; deleting either call reintroduces the latency tell.
  it("schedules deferred work on both branches, and reads nothing about the address first", async () => {
    for (const [name, built] of [
      ["new", scene()],
      ["registered", scene([userRow()])],
    ] as const) {
      built.flow.request(EMAIL, AT);
      expect(`${name}: ${built.deferral.scheduled.length} ${built.users.created.length} ${built.challenged.length}`).toBe(`${name}: 1 0 0`);
      expect(`${name}: ${(await settle(built.deferral.scheduled)).join()}`).toBe(`${name}: challenged`);
    }
  });

  it("creates the account on the new branch and challenges it, trimming and normalising the address", async () => {
    const fresh = scene();
    fresh.flow.request(EMAIL, AT);
    await settle(fresh.deferral.scheduled);
    expect(fresh.users.created).toEqual([{ email: "New.Person@Example.COM", emailKey: EMAIL_KEY }]);
    expect(fresh.challenged).toHaveLength(1);
  });

  // A code sent to the mailbox's own owner is harmless; "that address is taken" is not.
  it("challenges a registered address rather than refusing it, and creates no second account", async () => {
    const existing = userRow();
    const taken = scene([existing]);
    taken.flow.request(EMAIL, AT);
    expect(await settle(taken.deferral.scheduled)).toEqual(["challenged"]);
    expect(taken.users.created).toEqual([]);
    expect(taken.challenged).toEqual([existing.id]);
  });

  it("keeps a store failure inside the deferred work, never in what the caller is told", async () => {
    const broken = scene([], { conflict: true });
    expect(broken.flow.request(EMAIL, AT)).toEqual({ kind: "email-otp", expiresAt: AT + 600_000 });
    expect(await settle(broken.deferral.scheduled)).toEqual(["unavailable"]);
    expect(broken.challenged).toEqual([]);
  });

  it("names the primary factor and its window, so a caller can say what to expect", () => {
    expect(scene().flow.request(EMAIL, AT)).toEqual({ kind: "email-otp", expiresAt: AT + 600_000 });
  });
});

describe("createSignupFlow — the challenge lifetime it reports", () => {
  // The defect this closes: the flow carried a `challengeTtlMs` of its own, so a deployment could
  // configure the factor's real lifetime and the number the page shows to different values.
  it("reports the lifetime the primary factor enforces, and has none of its own to disagree with it", () => {
    expect(scene().flow.request(EMAIL, AT)).toEqual({ kind: "email-otp", expiresAt: AT + OTP_TTL_MS });
  });
});
