import { describe, expect, it } from "bun:test";

import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { err, ok } from "../../result/result";
import { uuidv7 } from "../../storage/db/uuid";
import { AuthStoreError } from "../errors";
import { fakeFactorCaller } from "../factors/factors.fixture";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorCaller, AuthFactorChallenge, ImplicitFactorService } from "../factors/types";
import type { AuthFactor, AuthUser, AuthUserInput, FactorStore, UserStore } from "../types";
import { createSignupFlow } from "./signup";
import type { AuthIssueOutcome } from "./types";
import type { AuthSignupOptions } from "./types";

const EMAIL = "  New.Person@Example.COM  ";
const EMAIL_KEY = "new.person@example.com";
const AT = 1_700_000_000_000;

const NO_FACTOR_ROWS: FactorStore = {
  listByUser: () => Promise.resolve(ok([] as readonly AuthFactor[])),
  find: () => Promise.resolve(ok(null)),
  listConfirmedKinds: () => Promise.resolve(ok([])),
  enrol: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol"))),
  confirm: () => Promise.resolve(ok(true)),
  countAttempt: () => Promise.resolve(ok(null)),
  recordVerification: () => Promise.resolve(ok(true)),
  replaceSecret: () => Promise.resolve(ok(true)),
  countSecretsNotUnder: () => Promise.resolve(ok(0)),
  remove: () => Promise.resolve(ok("changed" as const)),
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
    claimEmailChange: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
  };
  return { store, rows, created };
}

const OTP_TTL_MS = 600_000;

function fakeDeferral() {
  const scheduled: Promise<AuthIssueOutcome>[] = [];
  return { defer: (work: Promise<unknown>) => void scheduled.push(work as Promise<AuthIssueOutcome>), scheduled };
}

function scene(seed: readonly AuthUser[] = [], options: { conflict?: boolean } = {}, overrides: Partial<AuthSignupOptions> = {}) {
  const challenged: string[] = [];
  const callers: AuthFactorCaller[] = [];
  const primary: ImplicitFactorService<"email-otp"> = {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { stepUp: true },
    challengeTtlMs: OTP_TTL_MS,
    codeDigits: 6,
    codePeriodSeconds: null,
    reissueAfterMs: null,
    createChallenge: (userId, at, caller) => {
      challenged.push(userId);
      callers.push(caller);
      return Promise.resolve(ok({ kind: "email-otp", expiresAt: at + 1_000 } as AuthFactorChallenge));
    },
    verifyChallenge: () => Promise.resolve(err("unrecognised" as const)),
    listEnrolments: () => Promise.resolve(ok([])),
  };
  const users = fakeUsers(seed, options);
  const deferral = fakeDeferral();
  const flow = createSignupFlow({
    users: users.store,
    factors: createFactorRegistry(NO_FACTOR_ROWS, { primary }),
    defer: deferral.defer,
    ...overrides,
  });
  return { flow, users, deferral, challenged, callers };
}

function capturingLogger() {
  const records: { level: string; message: string; data: Record<string, unknown> | undefined }[] = [];
  const logger = createLogger("auth/flows", {
    channels: [{ write: (record: LogRecord) => void records.push({ level: record.level, message: record.message, data: record.data }) }],
  });
  return { logger, records };
}

async function settle(scheduled: readonly Promise<AuthIssueOutcome>[]): Promise<readonly AuthIssueOutcome[]> {
  return Promise.all(scheduled);
}

describe("createSignupFlow — anti-enumeration on request", () => {
  it("answers a registered address and a new one with the identical value", async () => {
    const fresh = scene();
    const taken = scene([userRow()]);
    expect(fresh.flow.request(EMAIL, AT, fakeFactorCaller())).toEqual(taken.flow.request(EMAIL, AT, fakeFactorCaller()));
    await settle([...fresh.deferral.scheduled, ...taken.deferral.scheduled]);
  });

  it("schedules deferred work on both branches, and reads nothing about the address first", async () => {
    for (const [name, built] of [
      ["new", scene()],
      ["registered", scene([userRow()])],
    ] as const) {
      built.flow.request(EMAIL, AT, fakeFactorCaller());
      expect(`${name}: ${built.deferral.scheduled.length} ${built.users.created.length} ${built.challenged.length}`).toBe(`${name}: 1 0 0`);
      expect(`${name}: ${(await settle(built.deferral.scheduled)).join()}`).toBe(`${name}: challenged`);
    }
  });

  it("creates the account on the new branch and challenges it, trimming and normalising the address", async () => {
    const fresh = scene();
    fresh.flow.request(EMAIL, AT, fakeFactorCaller());
    await settle(fresh.deferral.scheduled);
    expect(fresh.users.created).toEqual([{ email: "New.Person@Example.COM", emailKey: EMAIL_KEY }]);
    expect(fresh.challenged).toHaveLength(1);
  });

  it("challenges a registered address rather than refusing it, and creates no second account", async () => {
    const existing = userRow();
    const taken = scene([existing]);
    taken.flow.request(EMAIL, AT, fakeFactorCaller());
    expect(await settle(taken.deferral.scheduled)).toEqual(["challenged"]);
    expect(taken.users.created).toEqual([]);
    expect(taken.challenged).toEqual([existing.id]);
  });

  it("keeps a store failure inside the deferred work, never in what the caller is told", async () => {
    const broken = scene([], { conflict: true });
    expect(broken.flow.request(EMAIL, AT, fakeFactorCaller())).toEqual({ kind: "email-otp", expiresAt: AT + 600_000 });
    expect(await settle(broken.deferral.scheduled)).toEqual(["unavailable"]);
    expect(broken.challenged).toEqual([]);
  });

  it("names the primary factor and its window, so a caller can say what to expect", () => {
    expect(scene().flow.request(EMAIL, AT, fakeFactorCaller())).toEqual({ kind: "email-otp", expiresAt: AT + 600_000 });
  });
});

describe("createSignupFlow — the browser a code is bound to", () => {
  it("issues the code to the caller it was given, on the new-address branch and the registered one alike", async () => {
    const fresh = scene();
    fresh.flow.request(EMAIL, AT, fakeFactorCaller("browser-a"));
    await settle(fresh.deferral.scheduled);
    const registered = scene([userRow()]);
    registered.flow.request(EMAIL, AT, fakeFactorCaller("browser-b"));
    await settle(registered.deferral.scheduled);
    expect([...fresh.callers, ...registered.callers]).toEqual([fakeFactorCaller("browser-a"), fakeFactorCaller("browser-b")]);
  });
});

describe("createSignupFlow — the challenge lifetime it reports", () => {
  it("reports the lifetime the primary factor enforces, and has none of its own to disagree with it", () => {
    expect(scene().flow.request(EMAIL, AT, fakeFactorCaller())).toEqual({ kind: "email-otp", expiresAt: AT + OTP_TTL_MS });
  });
});

describe("createSignupFlow — a store failure returned inside the deferred work", () => {
  const readFailure = new AuthStoreError("unavailable", "users.findByEmailKey");
  const writeFailure = new AuthStoreError("unavailable", "users.create");

  for (const { name, failure, users } of [
    {
      name: "the address lookup",
      failure: readFailure,
      users: (store: UserStore): UserStore => ({ ...store, findByEmailKey: () => Promise.resolve(err(readFailure)) }),
    },
    {
      name: "the account insert",
      failure: writeFailure,
      users: (store: UserStore): UserStore => ({ ...store, create: () => Promise.resolve(err(writeFailure)) }),
    },
  ]) {
    it(`logs the outage and creates no account when ${name} fails`, async () => {
      const captured = capturingLogger();
      const backing = fakeUsers([]);
      const built = scene([], {}, { users: users(backing.store), logger: captured.logger });
      expect(built.flow.request(EMAIL, AT, fakeFactorCaller())).toEqual({ kind: "email-otp", expiresAt: AT + OTP_TTL_MS });
      expect(await settle(built.deferral.scheduled)).toEqual(["unavailable"]);
      expect({ rows: backing.rows, challenged: built.challenged, records: captured.records }).toEqual({
        rows: [],
        challenged: [],
        records: [
          {
            level: "error",
            message: "auth.signup.issue.failed",
            data: { error: { type: "AuthStoreError", detail: failure.message, stack: failure.stack } },
          },
        ],
      });
    });
  }
});

describe("createSignupFlow — an insert that loses a race for the address", () => {
  it("challenges the account the other insert wrote, and logs no outage", async () => {
    const captured = capturingLogger();
    const winner = userRow();
    let lookups = 0;
    const backing = fakeUsers([], { conflict: true });
    const racing: UserStore = { ...backing.store, findByEmailKey: () => Promise.resolve(ok(lookups++ === 0 ? null : winner)) };
    const built = scene([], {}, { users: racing, logger: captured.logger });
    built.flow.request(EMAIL, AT, fakeFactorCaller());
    expect(await settle(built.deferral.scheduled)).toEqual(["challenged"]);
    expect({ lookups, challenged: built.challenged, records: captured.records }).toEqual({ lookups: 2, challenged: [winner.id], records: [] });
  });

  it("logs the re-read's failure as the outage, and challenges nobody, when the lookup after the conflict fails", async () => {
    const captured = capturingLogger();
    const reread = new AuthStoreError("unavailable", "users.findByEmailKey");
    let lookups = 0;
    const backing = fakeUsers([], { conflict: true });
    const racing: UserStore = { ...backing.store, findByEmailKey: () => Promise.resolve(lookups++ === 0 ? ok(null) : err(reread)) };
    const built = scene([], {}, { users: racing, logger: captured.logger });
    built.flow.request(EMAIL, AT, fakeFactorCaller());
    expect(await settle(built.deferral.scheduled)).toEqual(["unavailable"]);
    expect({ lookups, inserts: backing.created.length, challenged: built.challenged, records: captured.records }).toEqual({
      lookups: 2,
      inserts: 1,
      challenged: [],
      records: [
        {
          level: "error",
          message: "auth.signup.issue.failed",
          data: { error: { type: "AuthStoreError", detail: reread.message, stack: reread.stack } },
        },
      ],
    });
  });

  it("logs the conflict itself, and challenges nobody, when the lookup after it still finds no account", async () => {
    const captured = capturingLogger();
    const conflict = new AuthStoreError("conflict", "users.create", { constraint: "auth_users.email_key" });
    const losing: UserStore = { ...fakeUsers([]).store, create: () => Promise.resolve(err(conflict)) };
    const built = scene([], {}, { users: losing, logger: captured.logger });
    built.flow.request(EMAIL, AT, fakeFactorCaller());
    expect(await settle(built.deferral.scheduled)).toEqual(["unavailable"]);
    expect({ challenged: built.challenged, records: captured.records }).toEqual({
      challenged: [],
      records: [
        {
          level: "error",
          message: "auth.signup.issue.failed",
          data: { error: { type: "AuthStoreError", detail: conflict.message, stack: conflict.stack } },
        },
      ],
    });
  });
});

describe("createSignupFlow — a throw inside the deferred work", () => {
  const outage = new Error("D1 connection reset");
  const brokenUsers: UserStore = { ...fakeUsers([]).store, findByEmailKey: () => Promise.reject(outage) };
  const brokenPrimary: ImplicitFactorService<"email-otp"> = {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { stepUp: true },
    challengeTtlMs: OTP_TTL_MS,
    codeDigits: 6,
    codePeriodSeconds: null,
    reissueAfterMs: null,
    createChallenge: () => Promise.reject(outage),
    verifyChallenge: () => Promise.resolve(err("unrecognised" as const)),
    listEnrolments: () => Promise.resolve(ok([])),
  };

  for (const { name, overrides } of [
    { name: "the user store rejects", overrides: { users: brokenUsers } },
    { name: "the primary factor rejects", overrides: { factors: createFactorRegistry(NO_FACTOR_ROWS, { primary: brokenPrimary }) } },
  ] satisfies { name: string; overrides: Partial<AuthSignupOptions> }[]) {
    it(`settles to unavailable and logs the error when ${name}`, async () => {
      const captured = capturingLogger();
      const built = scene([], {}, { ...overrides, logger: captured.logger });
      expect(built.flow.request(EMAIL, AT, fakeFactorCaller())).toEqual({ kind: "email-otp", expiresAt: AT + OTP_TTL_MS });
      expect(await settle(built.deferral.scheduled)).toEqual(["unavailable"]);
      expect(captured.records).toEqual([
        {
          level: "error",
          message: "auth.signup.issue.failed",
          data: { error: { type: "Error", detail: "D1 connection reset", stack: outage.stack } },
        },
      ]);
    });
  }
});
