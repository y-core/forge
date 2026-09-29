import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import { Route } from "@remix-run/fetch-router/routes";
import type { RouteMap } from "@remix-run/fetch-router/routes";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import type { AppContext } from "../../context/types";
import { base32Decode, totpCode } from "../../crypto/mod";
import { csrfProtection, importCsrfKey, mintCsrf } from "../../form/csrf";
import { requestLog } from "../../logging/request-logger";
import type { Logger } from "../../logging/types";
import { err, ok } from "../../result/result";
import { createAnonymousSession } from "../../session/anonymous";
import { sessionCtx } from "../../session/session";
import type { KVNamespace } from "../../storage/kv/types";
import { nullLogger } from "../../testing/context";
import { fakeKV } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import { createRecoveryCodeFactor } from "../factors/recovery-code";
import { createFactorRegistry } from "../factors/registry";
import { createTotpAppFactor } from "../factors/totp-app";
import type { AuthFactorRegistry, AuthFactorRequirement, AuthFactorResolution, AuthFactorService } from "../factors/types";
import { createSigninFlow } from "../flows/signin";
import { createSignupFlow } from "../flows/signup";
import { importAuthKeyRing } from "../keys/ring";
import type {
  AuthFactor,
  AuthFactorKind,
  AuthKeyRing,
  AuthUser,
  FactorStore,
  NonceStore,
  OtpStateStore,
  RecoveryCodeStore,
  UserStore,
} from "../types";
import { createAuthGuards, requireAuth } from "./guards";
import { authCtx } from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { registerAccount, registerAdmin, registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthWebOptions } from "./types";
import { attrOf, elementsOf, fakeAdminUserStore, fakeAuthCredentialStore, fakeAuthIcon, fakeAuthServices, textOf } from "./web.fixture";

interface ResilienceEnv extends Record<string, unknown> {
  readonly KV: KVNamespace;
  readonly SESSION_SECRET: string;
  readonly CSRF_SECRET: string;
}

const ORIGIN = "http://localhost";
const EMAIL_CODE = "123456";
const RING_ROOTS = [
  "d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65",
  "5be0c6a7d93f14e8a20b7c61f5d9e3a48b17c02e6f94a1d3c85b2e70f9a6d41c",
];
const SESSION_SECRETS = ["Sw8eR3tY6uI1oP4aS7dF2gH5jK9lZ0xC3vB6nM1qW4eR7tY", "Qa1zWs2xEd3cRf4vTg5bYh6nUj7mIk8oLp9Za0Xs1Cd2Vf3"];
const CSRF_SECRETS = [
  "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d",
  "1f0e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
];
const MEMBER_PAGE = "/app/member";
const PROTECTED_PREFIXES = ["/account", "/admin", "/auth/enrol", MEMBER_PAGE];

const UNUSABLE_NOTICE = "This sign-in method can&#39;t be checked right now. Choose another method below.";
const UNRECOGNISED_NOTICE = "That did not match. Ask for a new code and try again.";

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");
const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

interface HeldCode {
  readonly userId: string;
  readonly hash: string;
  staged: boolean;
  usedAt: number | null;
}

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Users, factor rows and recovery codes in one place, so every store over them sees every other's writes. */
function memoryAuth() {
  const users: AuthUser[] = [];
  let factors: AuthFactor[] = [];
  let codes: HeldCode[] = [];
  const lastAttemptAt = new Map<string, number>();

  const patch = (id: string, change: Partial<AuthFactor>) => {
    factors = factors.map((row) => (row.id === id ? { ...row, ...change } : row));
  };
  const patchUser = (id: string, change: Partial<AuthUser>) => {
    const index = users.findIndex((user) => user.id === id);
    if (index >= 0) users[index] = { ...(users[index] as AuthUser), ...change };
    return index >= 0;
  };
  const recoverable = (userId: string) =>
    factors.some((row) => row.userId === userId && (row.kind === "totp-app" || row.kind === "passkey") && row.confirmedAt !== null);

  const userStore: UserStore = {
    findById: async (id) => ok(users.find((user) => user.id === id) ?? null),
    findByEmailKey: async (emailKey) => ok(users.find((user) => user.emailKey === emailKey) ?? null),
    findByWebAuthnId: async () => ok(null),
    create: async (input, at) => {
      const user: AuthUser = {
        id: `018f0000-0000-7000-8000-${String(users.length + 1).padStart(12, "0")}`,
        email: input.email,
        emailKey: input.emailKey,
        emailVerifiedAt: null,
        webauthnId: null,
        isAdmin: false,
        deactivatedAt: null,
        sessionsInvalidBefore: null,
        createdAt: at,
        updatedAt: at,
      };
      users.push(user);
      return ok(user);
    },
    setWebAuthnIdIfAbsent: async () => ok(null),
    markEmailVerified: async (id, at) => ok(patchUser(id, { emailVerifiedAt: at })),
    changeEmail: async () => ok(true),
    revokeSessions: async (id, at) => {
      const barrier = users.find((user) => user.id === id)?.sessionsInvalidBefore ?? null;
      return ok(barrier !== null && barrier >= at ? false : patchUser(id, { sessionsInvalidBefore: at }));
    },
  };

  const factorStore: FactorStore = {
    listByUser: async (userId) => ok(factors.filter((row) => row.userId === userId)),
    find: async (userId, kind) => ok(factors.find((row) => row.userId === userId && row.kind === kind) ?? null),
    findEnrolled: async (userId, kinds) => ok(factors.filter((row) => row.userId === userId && kinds.includes(row.kind))),
    enrol: async (input, at) => {
      const row: AuthFactor = {
        id: `f${factors.length + 1}-${at}`,
        userId: input.userId,
        kind: input.kind,
        secret: input.secret ?? null,
        lastCounter: null,
        failedAttempts: 0,
        lastVerifiedAt: null,
        confirmedAt: input.confirmedAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      factors.push(row);
      return ok(row);
    },
    confirm: async (id, userId, at) => {
      const held = factors.some((row) => row.id === id && row.userId === userId);
      if (held) patch(id, { confirmedAt: at, updatedAt: at });
      return ok(held);
    },
    countAttempt: async (userId, kind, maxAttempts, at, lockoutMs) => {
      const row = factors.find((held) => held.userId === userId && held.kind === kind);
      if (row === undefined) return ok(null);
      const lapsed = (lastAttemptAt.get(row.id) ?? 0) <= at - lockoutMs;
      if (row.failedAttempts >= maxAttempts && !lapsed) return ok(null);
      lastAttemptAt.set(row.id, at);
      patch(row.id, { failedAttempts: row.failedAttempts >= maxAttempts ? 1 : row.failedAttempts + 1, updatedAt: at });
      return ok(factors.find((held) => held.id === row.id) ?? null);
    },
    recordVerification: async (id, userId, counter, at, secret) => {
      const row = factors.find((held) => held.id === id && held.userId === userId);
      if (row === undefined || (row.lastCounter !== null && counter <= row.lastCounter)) return ok(false);
      patch(id, { lastCounter: counter, failedAttempts: 0, lastVerifiedAt: at, updatedAt: at, ...(secret === undefined ? {} : { secret }) });
      return ok(true);
    },
    countSecretsNotUnder: async () => ok(0),
    remove: async (id, userId) => {
      const held = factors.some((row) => row.id === id && row.userId === userId);
      factors = factors.filter((row) => !(row.id === id && row.userId === userId));
      if (!recoverable(userId)) {
        codes = codes.filter((code) => code.userId !== userId);
        factors = factors.filter((row) => !(row.userId === userId && row.kind === "recovery-code"));
      }
      return ok(held);
    },
  };

  const codeStore: RecoveryCodeStore = {
    stage: async (userId, hashes) => {
      codes = [
        ...codes.filter((code) => !(code.userId === userId && code.staged)),
        ...hashes.map((hash) => ({ userId, hash: hex(hash), staged: true, usedAt: null })),
      ];
      return ok(undefined);
    },
    holdsStaged: async (userId, hash) => ok(codes.some((code) => code.userId === userId && code.staged && code.hash === hex(hash))),
    commit: async (userId, factorId, at) => {
      codes = codes.filter((code) => !(code.userId === userId && !code.staged));
      for (const code of codes) if (code.userId === userId) code.staged = false;
      const row = factors.find((held) => held.id === factorId);
      patch(factorId, { confirmedAt: row?.confirmedAt ?? at, failedAttempts: 0, updatedAt: at });
      return ok(undefined);
    },
    consume: async (userId, factorId, hash, at) => {
      const code = codes.find((held) => held.userId === userId && !held.staged && held.usedAt === null && held.hash === hex(hash));
      if (code === undefined) return ok(false);
      code.usedAt = at;
      patch(factorId, { failedAttempts: 0 });
      return ok(true);
    },
    remaining: async (userId) => ok(codes.filter((code) => code.userId === userId && !code.staged && code.usedAt === null).length),
  };

  const adminStore = fakeAdminUserStore([], {
    findById: async (id) => ok(users.find((user) => user.id.toLowerCase() === id.toLowerCase()) ?? null),
    resetFactors: async (id, at) => {
      if (!users.some((user) => user.id === id)) return ok("not-found" as const);
      factors = factors.filter((row) => row.userId !== id);
      codes = codes.filter((code) => code.userId !== id);
      patchUser(id, { sessionsInvalidBefore: at });
      return ok("changed" as const);
    },
  });

  return {
    userStore,
    factorStore,
    codeStore,
    adminStore,
    patchUser,
    factor: (userId: string, kind: AuthFactorKind) => {
      const row = factors.find((held) => held.userId === userId && held.kind === kind);
      return row === undefined ? null : { ...row };
    },
    patchFactor: patch,
    dropFactor: (userId: string, kind: AuthFactorKind) => {
      factors = factors.filter((row) => !(row.userId === userId && row.kind === kind));
    },
    codesOf: (userId: string) => codes.filter((code) => code.userId === userId).map((code) => ({ ...code })),
    secondFactorHolders: () => new Set(factors.filter((row) => row.kind !== "email-otp" && row.confirmedAt !== null).map((row) => row.userId)),
  };
}

/** The email-OTP primary, stubbed to accept `EMAIL_CODE`: the mailbox is not what this file is about. */
function emailCodeFactor(): AuthFactorService<"email-otp"> {
  return {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { stepUp: true },
    challengeTtlMs: 600_000,
    codeDigits: 6,
    codePeriodSeconds: null,
    reissueAfterMs: 60_000,
    createChallenge: async (_userId, at) => ok({ kind: "email-otp", expiresAt: at + 600_000 }),
    verifyChallenge: async (userId, presented, at) =>
      presented === EMAIL_CODE ? ok({ kind: "email-otp", userId, verifiedAt: at }) : err("unrecognised" as const),
    listEnrolments: async () => ok([]),
  };
}

/** The whole mount over real TOTP and recovery-code factors, with every secret swappable between requests. */
async function harness(totpRequirement: AuthFactorRequirement, stepUpMaxAgeMs?: number) {
  const store = memoryAuth();
  const clock = { now: 1_750_000_000_000 };
  const pending: Promise<unknown>[] = [];
  const defer = (work: Promise<unknown>) => void pending.push(work.catch(() => undefined));
  const audit = { served: 0, violations: [] as string[] };
  const warnings: [string, Record<string, unknown> | undefined][] = [];
  let ring: AuthKeyRing = await importAuthKeyRing([RING_ROOTS[0] as string]);
  let bindings: ResilienceEnv = { KV: fakeKV(), SESSION_SECRET: SESSION_SECRETS[0] as string, CSRF_SECRET: CSRF_SECRETS[0] as string };

  const logger: Logger = { ...nullLogger, warn: (message, data) => void warnings.push([message, data]), child: () => logger };
  const otpState: OtpStateStore = {
    issue: () => Promise.resolve(ok(true)),
    countAttempt: () => Promise.resolve(ok(null)),
    read: () => Promise.resolve(ok(null)),
    discard: () => Promise.resolve(ok()),
    clear: () => Promise.resolve(ok()),
  };
  const nonces: NonceStore = { markConsumed: () => Promise.resolve(ok(true)) };

  function registry(): AuthFactorRegistry {
    const built = createFactorRegistry(store.factorStore, {
      offered: [
        { service: emailCodeFactor(), role: "primary" },
        {
          service: createTotpAppFactor({ keys: ring, factors: store.factorStore, issuer: "Forge", account: (userId) => userId }),
          role: "second",
          requirement: totpRequirement,
        },
        { service: createRecoveryCodeFactor({ factors: store.factorStore, codes: store.codeStore }), role: "second", requirement: "optional" },
      ],
    });
    return {
      ...built,
      resolve: async (userId, context) => {
        const resolved = await built.resolve(userId, context);
        if (resolved.ok && resolved.data.status === "satisfied" && store.secondFactorHolders().has(userId)) {
          audit.violations.push(`resolve answered satisfied for ${userId}, who holds a confirmed second factor`);
        }
        return resolved;
      },
    };
  }

  const options: AuthWebOptions<ResilienceEnv> = {
    resolveServices: () => {
      const factors = registry();
      return fakeAuthServices({
        users: store.userStore,
        credentials: fakeAuthCredentialStore([]),
        factors,
        enrolments: store.factorStore,
        signin: createSigninFlow({ keys: ring, users: store.userStore, state: otpState, nonces, factors, defer }),
        signup: createSignupFlow({ users: store.userStore, factors, defer }),
        admin: store.adminStore,
      });
    },
    paths,
    icon: fakeAuthIcon,
    settledPath: paths.account.factors(),
    now: () => clock.now,
  };

  const invariant: Middleware = async (context, next) => {
    const holders = store.secondFactorHolders();
    requestLog.set(context, logger);
    const res = await next();
    const path = context.url.pathname;
    if (res.status >= 200 && res.status < 300 && PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      audit.served += 1;
      const identity = authCtx.getOptional(context);
      if (identity === undefined) audit.violations.push(`${context.method} ${path} was served with no identity`);
      else if (identity.stepUpAt === null && holders.has(identity.userId)) {
        audit.violations.push(`${context.method} ${path} was served to ${identity.email} on email alone`);
      }
    }
    return res;
  };

  const window = stepUpMaxAgeMs === undefined ? {} : { stepUpMaxAgeMs };
  const memberGuard = requireAuth<ResilienceEnv>({
    users: () => store.userStore,
    signinPath: paths.auth.signin(),
    factors: () => registry(),
    stepUpPath: paths.auth.verify.show(),
    now: () => clock.now,
    ...window,
  });

  const app = new Forge<ResilienceEnv>(nullLogger);
  applyMiddlewareChain<ResilienceEnv>(app, {
    before: [invariant],
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<ResilienceEnv>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.KV }),
    globals: [
      csrfProtection({
        secret: (c) => importCsrfKey((c as AppContext<ResilienceEnv>).env.CSRF_SECRET),
        subject: (c) => sessionCtx.getOptional(c)?.id,
      }),
    ],
    guards: [
      ...createAuthGuards<ResilienceEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { users: () => store.userStore, signinPath: paths.auth.signin(), now: () => clock.now },
        enrolment: {
          factors: () => registry(),
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.factors(),
          now: () => clock.now,
          ...window,
        },
        origin: { allowedOrigins: [ORIGIN] },
      }),
      { paths: [MEMBER_PAGE], guards: [memberGuard] },
    ],
  });
  registerAuth(app, authMap, options);
  registerAccount(app, accountMap, options);
  registerAdmin(app, adminMap, options);
  mapHandler(app, "GET", MEMBER_PAGE, () => new Response("member data"));
  mapHandler(app, "GET", "/csrf-token", async (context) => new Response(await mintCsrf(context, context.url.searchParams.get("path") ?? "")));

  return {
    store,
    audit,
    warnings,
    registry,
    clock,
    replaceRing: async () => {
      ring = await importAuthKeyRing([RING_ROOTS[1] as string]);
    },
    replaceSessionSecret: () => {
      bindings = { ...bindings, SESSION_SECRET: SESSION_SECRETS[1] as string };
    },
    replaceCsrfSecret: () => {
      bindings = { ...bindings, CSRF_SECRET: CSRF_SECRETS[1] as string };
    },
    request: async (path: string, init: RequestInit) => {
      clock.now += 1_000;
      const res = await app.request(path, init, bindings);
      await Promise.all(pending.splice(0));
      return res;
    },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** The action and CSRF token of the form in `html` posting to `path`, as a browser would read them. */
function formOf(html: string, path: string): { readonly action: string; readonly token: string } {
  const block = html.split("<form").find((part) => new URL(/action="([^"]*)"/.exec(part)?.[1] ?? "/", ORIGIN).pathname === path) ?? "";
  return {
    action: (/action="([^"]*)"/.exec(block)?.[1] ?? path).replaceAll("&amp;", "&"),
    token: /name="_csrf" value="([^"]+)"/.exec(block)?.[1] ?? "",
  };
}

/** One browser, keeping its session cookie across requests, with the invariant asserted after every one. */
function visitor(h: Harness) {
  let cookie = "";

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(cookie === "" ? {} : { cookie }) };
    const res = await h.request(path, { ...init, headers });
    const set = res.headers.getSetCookie().find((value) => value.startsWith("__Host-session="));
    if (set !== undefined) cookie = set.split(";")[0] ?? cookie;
    expect(h.audit.violations).toEqual([]);
    return res;
  }

  function post(action: string, fields: Record<string, string>, token: string): Promise<Response> {
    const body = new URLSearchParams({ ...fields, _csrf: token }).toString();
    return send(action, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body });
  }

  function submit(html: string, path: string, fields: Record<string, string>): Promise<Response> {
    const { action, token } = formOf(html, path);
    return post(action, fields, token);
  }

  async function form(url: string, fields: Record<string, string>): Promise<Response> {
    const html = await (await send(url)).text();
    return submit(html, new URL(url, ORIGIN).pathname, fields);
  }

  async function remove(page: string, path: string): Promise<Response> {
    const html = await (await send(page)).text();
    const block = html.split("<form").find((part) => part.includes(`hx-delete="${path}"`)) ?? "";
    const headers = JSON.parse((/hx-headers="([^"]*)"/.exec(block)?.[1] ?? "{}").replaceAll("&quot;", '"')) as Record<string, string>;
    return send(path, { method: "DELETE", headers: { ...headers, origin: ORIGIN } });
  }

  async function forged(path: string, fields: Record<string, string>): Promise<Response> {
    const token = await (await send(`/csrf-token?path=${encodeURIComponent(path)}`)).text();
    return post(path, fields, token);
  }

  return { get: (path: string) => send(path), post, submit, form, remove, forged };
}

type Visitor = ReturnType<typeof visitor>;

/** The current code of the authenticator holding `secret`, one step on from the last so no code is ever replayed. */
async function authenticator(h: Harness, secret: string): Promise<string> {
  h.clock.now += 30_000;
  return totpCode(base32Decode(secret), Math.floor(h.clock.now / 1000));
}

const locationOf = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

/** The destructive notice a refused verification renders. */
function noticeOf(html: string): string {
  return textOf(html, "div", 'data-slot="alert-description"');
}

/** Every picker link on the verify page, as `[href, label]`. */
function choicesOf(html: string): [string, string][] {
  return elementsOf(html, "a", 'data-ref="verify-choice"').map((link) => [
    attrOf(link, 'data-ref="verify-choice"', "href"),
    textOf(link, "a", "href"),
  ]);
}

/** The codes a generate response shows, once. */
function issuedCodesOf(html: string): string[] {
  return textOf(html, "pre", 'data-ref="recovery-codes"')
    .split("\n")
    .filter((code) => code !== "");
}

/** Signs `email` in on the emailed code alone, answering where the sign-in sent the session next. */
async function signIn(v: Visitor, email: string, from = "/auth/signin"): Promise<{ status: number; location: string | null }> {
  const started = await v.form(from, { email });
  return locationOf(await v.form(started.headers.get("location") ?? "", { code: EMAIL_CODE }));
}

interface Enrolled {
  readonly userId: string;
  readonly secret: string;
  readonly codes: readonly string[];
  readonly v: Visitor;
}

/** A user who signed up, enrolled TOTP, stepped up with it and — unless `codes` is false — confirmed a set of recovery codes. */
async function enrolled(h: Harness, email: string, codes = true): Promise<Enrolled> {
  const v = visitor(h);
  await v.form("/auth/signup", { email });
  const signedIn = locationOf(await v.form("/auth/verify", { code: EMAIL_CODE }));
  const page = signedIn.location === "/auth/enrol/totp" ? "/auth/enrol/totp" : "/account/totp";
  const html = await (await v.get(page)).text();
  const secret = textOf(html, "code", 'data-ref="totp-secret"');
  await v.submit(html, page, { code: await authenticator(h, secret) });
  const stepped = locationOf(await v.form("/auth/verify", { code: await authenticator(h, secret) }));
  expect(stepped).toEqual({ status: 303, location: "/account/recovery-codes" });

  const found = await h.store.userStore.findByEmailKey(email);
  const id = found.ok && found.data !== null ? found.data.id : "";
  if (!codes) return { userId: id, secret, codes: [], v };

  const generated = await v.form("/account/recovery-codes", {});
  const issued = issuedCodesOf(await generated.clone().text());
  await v.submit(await generated.text(), "/account/recovery-codes/confirm", { code: issued[0] ?? "" });
  return { userId: id, secret, codes: issued, v };
}

const stepUp = (kinds: AuthFactorKind[]): AuthFactorResolution => ({ status: "step-up-required", kinds });

describe("the failure matrix: a lost value never locks an account out, and never lets it in on less", () => {
  it("replaced auth ring — TOTP is unusable at no cost, a recovery code repairs, and re-enrolling sends the user to new codes", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    await h.replaceRing();

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    const before = h.store.factor(ada.userId, "totp-app");
    const refused = await v.form("/auth/verify", { code: await authenticator(h, ada.secret) });
    const refusedHtml = await refused.text();
    expect({ status: refused.status, notice: noticeOf(refusedHtml), choices: choicesOf(refusedHtml) }).toEqual({
      status: 422,
      notice: UNUSABLE_NOTICE,
      choices: [["/auth/verify?factor=recovery-code", "Use a recovery code instead"]],
    });
    expect(h.store.factor(ada.userId, "totp-app")).toEqual(before);
    expect(h.warnings).toEqual([["auth.factor.unusable", { kind: "totp-app" }]]);

    const recovered = await v.form("/auth/verify?factor=recovery-code", { code: ada.codes[1] ?? "" });
    expect(locationOf(recovered)).toEqual({ status: 303, location: "/account/factors?recovered=1" });
    const repair = await v.get("/account/factors?recovered=1");
    expect({ status: repair.status, notice: noticeOf(await repair.text()) }).toEqual({
      status: 200,
      notice:
        "You have 9 unused codes left. If your authenticator app or passkey no longer works, remove it below and add it again, then generate a new set of codes.",
    });

    expect(locationOf(await v.remove("/account/totp", "/account/totp"))).toEqual({ status: 303, location: "/account/totp" });
    expect(locationOf(await v.get("/account/totp"))).toEqual({ status: 303, location: "/auth/enrol/totp" });
    const enrolPage = await (await v.get("/auth/enrol/totp")).text();
    const secret = textOf(enrolPage, "code", 'data-ref="totp-secret"');
    const reenrolled = await v.submit(enrolPage, "/auth/enrol/totp", { code: await authenticator(h, secret) });
    expect(locationOf(reenrolled)).toEqual({ status: 303, location: "/auth/verify" });
    const verified = await v.form("/auth/verify", { code: await authenticator(h, secret) });
    expect(locationOf(verified)).toEqual({ status: 303, location: "/account/recovery-codes" });

    const generated = await v.form("/account/recovery-codes", {});
    expect({ status: generated.status, cache: generated.headers.get("cache-control") }).toEqual({ status: 200, cache: "no-store" });
    const fresh = issuedCodesOf(await generated.clone().text());
    const confirmed = await v.submit(await generated.text(), "/account/recovery-codes/confirm", { code: fresh[3] ?? "" });
    expect(locationOf(confirmed)).toEqual({ status: 303, location: "/account/factors" });

    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app", "recovery-code"])));
    const again = visitor(h);
    expect(await signIn(again, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    expect(locationOf(await again.form("/auth/verify", { code: await authenticator(h, secret) }))).toEqual({
      status: 303,
      location: "/account/factors",
    });
    expect(h.audit.served).toBeGreaterThan(0);
  });

  it("corrupted TOTP frame under an optional TOTP — never satisfied on email alone, and repaired through a code", async () => {
    const h = await harness("optional");
    const ada = await enrolled(h, "ada@example.com");
    const sealed = h.store.factor(ada.userId, "totp-app")?.secret ?? new Uint8Array(0);
    const corrupted = new Uint8Array(sealed);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
    h.store.patchFactor(h.store.factor(ada.userId, "totp-app")?.id ?? "", { secret: corrupted });

    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app", "recovery-code"])));
    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    const before = h.store.factor(ada.userId, "totp-app");
    const refused = await v.form("/auth/verify", { code: await authenticator(h, ada.secret) });
    expect({ status: refused.status, notice: noticeOf(await refused.text()) }).toEqual({ status: 422, notice: UNUSABLE_NOTICE });
    expect(h.store.factor(ada.userId, "totp-app")).toEqual(before);
    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app", "recovery-code"])));
    expect(locationOf(await v.get("/account/factors"))).toEqual({ status: 303, location: "/auth/verify" });

    const recovered = await v.form("/auth/verify?factor=recovery-code", { code: ada.codes[2] ?? "" });
    expect(locationOf(recovered)).toEqual({ status: 303, location: "/account/factors?recovered=1" });
    expect(locationOf(await v.remove("/account/totp", "/account/totp"))).toEqual({ status: 303, location: "/account/totp" });
    const enrolPage = await (await v.get("/account/totp")).text();
    const secret = textOf(enrolPage, "code", 'data-ref="totp-secret"');
    const reenrolled = await v.submit(enrolPage, "/account/totp", { code: await authenticator(h, secret) });
    expect(locationOf(reenrolled)).toEqual({ status: 303, location: "/account/recovery-codes" });

    const generated = await v.form("/account/recovery-codes", {});
    const fresh = issuedCodesOf(await generated.clone().text());
    expect(locationOf(await v.submit(await generated.text(), "/account/recovery-codes/confirm", { code: fresh[0] ?? "" }))).toEqual({
      status: 303,
      location: "/account/factors",
    });
    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app", "recovery-code"])));
    expect(h.audit.served).toBeGreaterThan(0);
  });

  it("corrupted TOTP frame on an account holding no codes — step-up still owed, and no page served on email alone", async () => {
    const h = await harness("optional");
    const ada = await enrolled(h, "ada@example.com", false);
    const row = h.store.factor(ada.userId, "totp-app");
    const corrupted = new Uint8Array(row?.secret ?? new Uint8Array(0));
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    h.store.patchFactor(row?.id ?? "", { secret: corrupted });

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    const refused = await v.form("/auth/verify", { code: await authenticator(h, ada.secret) });
    const html = await refused.text();
    expect({ status: refused.status, notice: noticeOf(html), choices: choicesOf(html) }).toEqual({
      status: 422,
      notice: UNUSABLE_NOTICE,
      choices: [],
    });
    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app"])));
    expect(locationOf(await v.get("/account/factors"))).toEqual({ status: 303, location: "/auth/verify" });
  });

  it("purged TOTP under a mandatory TOTP — the user steps up by code before the enrol page is reachable", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    h.store.dropFactor(ada.userId, "totp-app");

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    expect(locationOf(await v.get("/auth/enrol/totp"))).toEqual({ status: 303, location: "/auth/verify" });
    expect(locationOf(await v.forged("/auth/enrol/totp", { code: "000000" }))).toEqual({ status: 303, location: "/auth/verify" });
    expect(h.store.factor(ada.userId, "totp-app")).toBeNull();

    const verify = await (await v.get("/auth/verify")).text();
    expect(textOf(verify, "div", 'data-slot="card-description"')).toBe("Enter one of your recovery codes.");
    const recovered = await v.submit(verify, "/auth/verify", { code: ada.codes[4] ?? "" });
    expect(locationOf(recovered)).toEqual({ status: 303, location: "/account/factors?recovered=1" });
    expect(locationOf(await v.get("/account/factors?recovered=1"))).toEqual({ status: 303, location: "/auth/enrol/totp" });

    const enrolPage = await v.get("/auth/enrol/totp");
    expect(enrolPage.status).toBe(200);
    const enrolHtml = await enrolPage.text();
    const secret = textOf(enrolHtml, "code", 'data-ref="totp-secret"');
    expect(locationOf(await v.submit(enrolHtml, "/auth/enrol/totp", { code: await authenticator(h, secret) }))).toEqual({
      status: 303,
      location: "/auth/verify",
    });
    expect(locationOf(await v.form("/auth/verify", { code: await authenticator(h, secret) }))).toEqual({
      status: 303,
      location: "/account/factors",
    });
    expect((await v.get("/account/factors")).status).toBe(200);
  });

  it("purged TOTP under a mandatory TOTP — a page behind `requireAuth` alone refuses the email-only session until it steps up", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    h.store.dropFactor(ada.userId, "totp-app");

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    expect(locationOf(await v.get(MEMBER_PAGE))).toEqual({ status: 303, location: "/auth/verify" });

    const recovered = await v.form("/auth/verify", { code: ada.codes[6] ?? "" });
    expect(locationOf(recovered)).toEqual({ status: 303, location: "/account/factors?recovered=1" });
    const admitted = await v.get(MEMBER_PAGE);
    expect({ status: admitted.status, body: await admitted.text() }).toEqual({ status: 200, body: "member data" });
  });

  it("purged TOTP behind a stale step-up — verify asks for the held factor again, and the enrol page opens once it is proved", async () => {
    const h = await harness("mandatory", 60_000);
    const ada = await enrolled(h, "ada@example.com");
    h.store.dropFactor(ada.userId, "totp-app");
    h.clock.now += 120_000;

    expect(locationOf(await ada.v.get("/auth/enrol/totp"))).toEqual({ status: 303, location: "/auth/verify" });
    const verify = await ada.v.get("/auth/verify");
    const verifyHtml = await verify.text();
    expect({ status: verify.status, prompt: textOf(verifyHtml, "div", 'data-slot="card-description"') }).toEqual({
      status: 200,
      prompt: "Enter one of your recovery codes.",
    });

    const recovered = await ada.v.submit(verifyHtml, "/auth/verify", { code: ada.codes[7] ?? "" });
    expect(locationOf(recovered)).toEqual({ status: 303, location: "/account/factors?recovered=1" });
    expect(locationOf(await ada.v.get("/account/factors?recovered=1"))).toEqual({ status: 303, location: "/auth/enrol/totp" });
    expect((await ada.v.get("/auth/enrol/totp")).status).toBe(200);
  });

  it("replaced session secret — the visitor is signed out, and signs back in with email and TOTP", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    expect((await ada.v.get("/account/factors")).status).toBe(200);

    h.replaceSessionSecret();
    const refused = await ada.v.get("/account/factors");
    expect(locationOf(refused)).toEqual({ status: 302, location: "/auth/signin?next=%2Faccount%2Ffactors" });

    expect(await signIn(ada.v, "ada@example.com", refused.headers.get("location") ?? "")).toEqual({
      status: 303,
      location: "/auth/verify?next=%2Faccount%2Ffactors",
    });
    expect(locationOf(await ada.v.get("/account/factors"))).toEqual({ status: 303, location: "/auth/verify" });
    const stepped = await ada.v.form("/auth/verify?next=%2Faccount%2Ffactors", { code: await authenticator(h, ada.secret) });
    expect(locationOf(stepped)).toEqual({ status: 303, location: "/account/factors" });
    expect((await ada.v.get("/account/factors")).status).toBe(200);
  });

  it("replaced CSRF secret — a form minted before the swap is refused, and the reloaded one submits", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });

    const stale = await (await v.get("/auth/verify")).text();
    const code = await authenticator(h, ada.secret);
    h.replaceCsrfSecret();
    expect((await v.submit(stale, "/auth/verify", { code })).status).toBe(403);
    expect(locationOf(await v.get("/account/factors"))).toEqual({ status: 303, location: "/auth/verify" });

    expect(locationOf(await v.form("/auth/verify", { code }))).toEqual({ status: 303, location: "/account/factors" });
    expect((await v.get("/account/factors")).status).toBe(200);
  });

  it("replaced ring with every code spent — nothing steps the user up, and only an admin reset reopens the account", async () => {
    const h = await harness("mandatory");
    const ada = await enrolled(h, "ada@example.com");
    for (const code of ada.codes) {
      expect(locationOf(await ada.v.form("/auth/verify?factor=recovery-code", { code }))).toEqual({
        status: 303,
        location: "/account/factors?recovered=1",
      });
    }
    await h.replaceRing();

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    const totp = await v.form("/auth/verify", { code: await authenticator(h, ada.secret) });
    expect({ status: totp.status, notice: noticeOf(await totp.text()) }).toEqual({ status: 422, notice: UNUSABLE_NOTICE });
    const spent = await v.form("/auth/verify?factor=recovery-code", { code: ada.codes[0] ?? "" });
    expect({ status: spent.status, notice: noticeOf(await spent.text()) }).toEqual({ status: 422, notice: UNRECOGNISED_NOTICE });
    expect(locationOf(await v.get("/account/factors"))).toEqual({ status: 303, location: "/auth/verify" });
    expect(locationOf(await v.get("/auth/enrol/totp"))).toEqual({ status: 303, location: "/auth/verify" });
    expect(await h.registry().resolve(ada.userId)).toEqual(ok(stepUp(["totp-app", "recovery-code"])));

    const root = await enrolled(h, "root@example.com");
    h.store.patchUser(root.userId, { isAdmin: true });
    const reset = `/admin/users/${ada.userId}/factors/reset`;
    const panel = await (await root.v.get(`/admin/users/${ada.userId}/factors`)).text();
    expect(locationOf(await root.v.submit(panel, reset, {}))).toEqual({ status: 303, location: `/admin/users/${ada.userId}/factors` });

    expect(locationOf(await v.get("/account/factors"))).toEqual({ status: 302, location: "/auth/signin?next=%2Faccount%2Ffactors" });
    const back = visitor(h);
    expect(await signIn(back, "ada@example.com")).toEqual({ status: 303, location: "/auth/enrol/totp" });
    const enrolHtml = await (await back.get("/auth/enrol/totp")).text();
    const secret = textOf(enrolHtml, "code", 'data-ref="totp-secret"');
    expect(locationOf(await back.submit(enrolHtml, "/auth/enrol/totp", { code: await authenticator(h, secret) }))).toEqual({
      status: 303,
      location: "/auth/verify",
    });
    expect(locationOf(await back.form("/auth/verify", { code: await authenticator(h, secret) }))).toEqual({
      status: 303,
      location: "/account/recovery-codes",
    });
  });

  it("an email-only session holding a confirmed second factor is issued no codes and reaches no account or enrol page", async () => {
    const h = await harness("optional");
    const ada = await enrolled(h, "ada@example.com");
    const codesBefore = h.store.codesOf(ada.userId);

    const v = visitor(h);
    expect(await signIn(v, "ada@example.com")).toEqual({ status: 303, location: "/auth/verify" });
    const generate = await v.forged("/account/recovery-codes", {});
    const confirm = await v.forged("/account/recovery-codes/confirm", { code: ada.codes[5] ?? "" });
    expect([locationOf(generate), locationOf(confirm)]).toEqual([
      { status: 303, location: "/auth/verify" },
      { status: 303, location: "/auth/verify" },
    ]);
    expect(h.store.codesOf(ada.userId)).toEqual(codesBefore);

    const pages = [...getLeaves(accountMap), ...getLeaves(authMap.enrol as RouteMap)];
    const answers: [string, { status: number; location: string | null }][] = [];
    for (const page of pages) answers.push([page, locationOf(await v.get(page))]);
    expect(answers).toEqual(pages.map((page) => [page, { status: 303, location: "/auth/verify" }]));
  });

  it("a session whose account holds no authenticator is refused codes outright, and nothing is staged", async () => {
    const h = await harness("optional");
    const v = visitor(h);
    await v.form("/auth/signup", { email: "bob@example.com" });
    expect(locationOf(await v.form("/auth/verify", { code: EMAIL_CODE }))).toEqual({ status: 303, location: "/account/factors" });
    const found = await h.store.userStore.findByEmailKey("bob@example.com");
    const bob = found.ok && found.data !== null ? found.data.id : "";

    const generate = await v.forged("/account/recovery-codes", {});
    const confirm = await v.forged("/account/recovery-codes/confirm", { code: "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA" });
    expect([generate.status, confirm.status, h.store.codesOf(bob)]).toEqual([409, 409, []]);
    expect(h.store.factor(bob, "recovery-code")).toBeNull();
  });
});

/** Every GET leaf directly in `routes`, as the href a browser would request. */
function getLeaves(routes: RouteMap): string[] {
  return Object.values(routes)
    .filter((leaf): leaf is Route => leaf instanceof Route && leaf.method === "GET")
    .map((leaf) => (leaf.href as (params: Record<string, string>) => string)({ id: "c1" }));
}
