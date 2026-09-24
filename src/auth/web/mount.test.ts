import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { pageShell } from "../../app/shell";
import type { AppContext } from "../../context/types";
import { csrfProtection, importCsrfKey } from "../../form/csrf";
import { err, ok } from "../../result/result";
import { createAnonymousSession } from "../../session/anonymous";
import { sessionCtx } from "../../session/session";
import { createD1Client } from "../../storage/db/client";
import type { D1DatabaseLike } from "../../storage/db/types";
import type { KVNamespace } from "../../storage/kv/types";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { nullLogger } from "../../testing/context";
import { fakeKV } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import type { FakeAuthUser } from "../../testing/types";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorService } from "../factors/types";
import { createSigninFlow } from "../flows/signin";
import { createSignupFlow } from "../flows/signup";
import { importAuthKeyRing } from "../keys/ring";
import {
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";
import { createChallengeStore } from "../stores/challenges";
import { createCredentialStore } from "../stores/credentials";
import { createFactorStore } from "../stores/factors";
import { createUserStore } from "../stores/users";
import type { AuthFactor, AuthFactorKind, AuthUser, FactorStore, NonceStore, OtpStateStore, UserStore } from "../types";
import { createAuthGuards, requireAuth } from "./guards";
import { authEnrolmentPaths, authPaths } from "./paths";
import { registerAccount, registerAdmin, registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthRequestServices, AuthWebOptions } from "./types";
import { attrsOf, fakeAuthIcon, fakeAuthServices, fakeFactorService } from "./web.fixture";

// This file is the mount AUTH_MOUNTING.md §1 describes, written out with no ellipsis and no free
// variable, so the documented wiring is held to the real signatures by the compiler.

/** Exactly the bindings a Worker mounting auth declares. */
interface MountEnv extends Record<string, unknown> {
  readonly DB: D1DatabaseLike;
  readonly KV: KVNamespace;
  readonly SESSION_SECRET: string;
  readonly CSRF_SECRET: string;
}

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");

const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

/** Every store this request runs against, built from the bindings the request carries. */
function requestStores(c: AppContext<MountEnv>) {
  const db = createD1Client(c.env.DB as never);
  const enrolments = createFactorStore(db);
  return {
    users: createUserStore(db),
    credentials: createCredentialStore(db),
    enrolments,
    challenges: createChallengeStore(createD1Client(c.env.DB as never)),
    // The offered services are stubbed: assembling the real ones needs a key ring and a mailer, which
    // are the consumer's own domain wiring and not the mount this file is about.
    factors: createFactorRegistry(enrolments, {
      offered: [
        { service: fakeFactorService("email-otp"), role: "primary" },
        { service: fakeFactorService("passkey"), role: "second", requirement: "mandatory" },
      ],
    }),
  };
}

/** The registry the enrolment guards read, built from this request's bindings like every other store. */
function factorRegistryFor(c: AppContext<MountEnv>) {
  return requestStores(c).factors;
}

/** The per-request services every loader and action runs against. */
function resolveServices(c: AppContext<MountEnv>): AuthRequestServices {
  const stores = requestStores(c);
  return fakeAuthServices({ users: stores.users, credentials: stores.credentials, enrolments: stores.enrolments, factors: stores.factors });
}

const options: AuthWebOptions<MountEnv> = { resolveServices, paths, icon: fakeAuthIcon };

// The one departure from a real mount: the guard's resolver records the env it was handed, so the
// per-request lifetime this file exists to hold is asserted and not merely typed.
const guardEnvs: MountEnv[] = [];

/** The whole mount, in the order AUTH_MOUNTING.md §1 gives it. */
function mount(): Forge<MountEnv> {
  const app = new Forge<MountEnv>(nullLogger);
  app.setShell(pageShell({ stylesheet: "/assets/app.css", script: "/assets/auth.js" }));

  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<MountEnv>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.KV }),
    // `globals`, never `before`: the resolver reads the session, which the chain publishes ahead of
    // this slot and not ahead of that one.
    globals: [
      csrfProtection({ secret: (c) => importCsrfKey((c as AppContext<MountEnv>).env.CSRF_SECRET), subject: (c) => sessionCtx.getOptional(c)?.id }),
    ],
    guards: createAuthGuards<MountEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: {
        users: (c) => {
          guardEnvs.push(c.env);
          return createUserStore(createD1Client(c.env.DB as never));
        },
        signinPath: paths.auth.signin(),
      },
      enrolment: {
        factors: (c) => factorRegistryFor(c),
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
      },
      origin: { allowedOrigins: ["http://localhost"] },
    }),
  });

  registerAuth(app, authMap, options);
  registerAccount(app, accountMap, options);
  registerAdmin(app, adminMap, options);
  return app;
}

const ADA = "018f0000-0000-7000-8000-000000000001";

function env(users: readonly FakeAuthUser[] = []): MountEnv {
  return { DB: fakeAuthD1(users), KV: fakeKV(), SESSION_SECRET: "s".repeat(48), CSRF_SECRET: "c".repeat(64) };
}

describe("the AUTH_MOUNTING.md §1 mount, compiled", () => {
  it("serves the sign-in page as a complete document, through the shell the app registered", async () => {
    const res = await mount().request("/auth/signin", {}, env());
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html><html")).toBe(true);
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Sign in");
    expect(attrsOf(html, 'rel="stylesheet"')).toEqual({ rel: "stylesheet", href: "/assets/app.css" });
    expect(attrsOf(html, 'type="module"')).toEqual({ type: "module", src: "/assets/auth.js" });
  });

  it("sends an anonymous request for a guarded page to sign-in, carrying its return-to", async () => {
    const res = await mount().request("/account/passkeys", {}, env());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/signin?next=%2Faccount%2Fpasskeys");
  });

  // The GET is what writes the cookie: without it the POST arrives with a new anonymous id, and the
  // token's subject can never match.
  it("lets an anonymous visitor on a fresh profile complete the sign-up POST", async () => {
    const app = mount();
    const bindings = env();

    const page = await app.request("/auth/signup", {}, bindings);
    expect(page.status).toBe(200);
    const html = await page.text();
    const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? "";
    expect(token).not.toBe("");

    const cookie = page.headers.getSetCookie().find((c) => c.startsWith("__session="));
    expect(cookie).toBeDefined();

    const body = new URLSearchParams({ email: "ada@example.com", _csrf: token });
    const res = await app.request(
      "/auth/signup",
      {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie: cookie!.split(";")[0]! },
        body: body.toString(),
      },
      bindings,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("refuses a cross-origin POST to the sign-in endpoint", async () => {
    const res = await mount().request("/auth/signin", { method: "POST", headers: { origin: "https://evil.example.com" } }, env());
    expect(res.status).toBe(403);
  });

  // A store captured at bootstrap is captured before any `env` exists, so these are the assertions
  // that the guards read the bindings of the request instead.
  it("builds the guard's user store from the bindings of the request being guarded", async () => {
    const app = mount();
    const first = env([{ id: ADA, email: "ada@example.com" }]);
    const second = env();
    guardEnvs.length = 0;

    await app.request("/account/passkeys", {}, first);
    await app.request("/account/passkeys", {}, second);

    // One app instance, two `env` objects, one resolver call each carrying its own request's DB —
    // which is precisely what a module-level latch cannot express.
    expect(guardEnvs).toHaveLength(2);
    expect(guardEnvs[0]).toBe(first);
    expect(guardEnvs[1]).toBe(second);
  });
});

// The falsifier for everything below: no test here sets `authCtx`, so an identity on `/auth/verify`
// can only have come from the guard chain.

const CODE = "123456";

/** Accounts the flows can actually add to, since a sign-up that writes nowhere cannot be signed in to. */
function memoryUsers(): UserStore {
  const rows: AuthUser[] = [];
  return {
    findById: async (id) => ok(rows.find((row) => row.id === id) ?? null),
    findByEmailKey: async (emailKey) => ok(rows.find((row) => row.emailKey === emailKey) ?? null),
    findByWebAuthnId: async () => ok(null),
    create: async (input, at) => {
      const row: AuthUser = {
        id: `018f0000-0000-7000-8000-${String(rows.length + 1).padStart(12, "0")}`,
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
      rows.push(row);
      return ok(row);
    },
    setWebAuthnIdIfAbsent: async () => ok(null),
    markEmailVerified: async (id, at) => {
      const row = rows.find((held) => held.id === id);
      if (row) rows[rows.indexOf(row)] = { ...row, emailVerifiedAt: at, updatedAt: at };
      return ok(row !== undefined);
    },
    changeEmail: async () => ok(true),
    revokeSessions: async () => ok(true),
  };
}

/** Enrolment rows an enrolment ceremony can actually confirm, so the demand changes as the drive-through proceeds. */
function memoryFactors(): FactorStore {
  const rows: AuthFactor[] = [];
  return {
    listByUser: async (userId) => ok(rows.filter((row) => row.userId === userId)),
    find: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    findEnrolled: async (userId, kinds) => ok(rows.filter((row) => row.userId === userId && kinds.includes(row.kind))),
    enrol: async (input, at) => {
      const row: AuthFactor = {
        id: `f${rows.length + 1}`,
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
      rows.push(row);
      return ok(row);
    },
    confirm: async (id, _userId, at) => {
      const row = rows.find((held) => held.id === id);
      if (row) rows[rows.indexOf(row)] = { ...row, confirmedAt: at, updatedAt: at };
      return ok(row !== undefined);
    },
    unconfirm: async (id, _userId, at) => {
      const row = rows.find((held) => held.id === id);
      if (row) rows[rows.indexOf(row)] = { ...row, confirmedAt: null, failedAttempts: 0, updatedAt: at };
      return ok(row !== undefined);
    },
    countAttempt: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    recordVerification: async () => ok(true),
    countSecretsNotUnder: async () => ok(0),
    remove: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return ok(index >= 0);
    },
  };
}

// The ceremonies are stubbed and the mount is not: what this file is evidence about is the wiring
// between the guard chain, the routes and the actions, never the cryptography under a factor.
/** A factor service that accepts `CODE` and records its enrolment in `store`. */
function driveableFactor<kind extends AuthFactorKind>(kind: kind, store: FactorStore): AuthFactorService<kind> {
  const base = {
    kind,
    capabilities: { stepUp: true },
    challengeTtlMs: 600_000,
    codeDigits: kind === "passkey" ? null : 6,
    codePeriodSeconds: null,
    reissueAfterMs: kind === "email-otp" ? 60_000 : null,
    createChallenge: async () => ok({ kind, expiresAt: 9_999_999 }),
    verifyChallenge: async (userId: string, presented: string, at: number) =>
      presented.includes(CODE) ? ok({ kind, userId, verifiedAt: at }) : err("unrecognised" as const),
    listEnrolments: async (userId: string) => {
      const found = await store.find(userId, kind);
      return found.ok ? ok(found.data ? [found.data] : []) : err(found.error);
    },
  };
  if (kind === "email-otp") return { ...base, enrolment: "implicit" };
  return {
    ...base,
    enrolment: "explicit",
    beginEnrolment: async (userId: string, at: number) => {
      const held = await store.find(userId, kind);
      if (!held.ok) return err("unavailable" as const);
      if (!held.data) await store.enrol({ userId, kind, confirmedAt: null }, at);
      return ok({ kind, expiresAt: 9_999_999, options: { secret: "JBSWY3DP", uri: `otpauth://totp/${kind}` } });
    },
    completeEnrolment: async (userId: string, presented: string, at: number) => {
      if (!presented.includes(CODE)) return err("unrecognised" as const);
      const held = await store.find(userId, kind);
      if (!held.ok) return err("unavailable" as const);
      let row = held.data;
      if (row === null) {
        const created = await store.enrol({ userId, kind, confirmedAt: null }, at);
        if (!created.ok) return err("unavailable" as const);
        row = created.data;
      }
      await store.confirm(row.id, userId, at);
      return ok({ ...row, confirmedAt: at });
    },
  };
}

/** The whole mount again, this time over stores a drive-through can change. */
function flowMount(stepUp: AuthFactorKind): { readonly app: Forge<MountEnv>; readonly settle: () => Promise<void> } {
  const users = memoryUsers();
  const enrolments = memoryFactors();
  const pending: Promise<unknown>[] = [];
  const defer = (work: Promise<unknown>) => void pending.push(work.catch(() => undefined));

  const factors = createFactorRegistry(enrolments, {
    offered: [
      { service: driveableFactor("email-otp", enrolments), role: "primary" },
      { service: driveableFactor(stepUp, enrolments), role: "second", requirement: "mandatory" },
    ],
  });

  // The decoy branch spends these; the mount drive-through never reaches it, so an in-memory pair
  // that reports success is all it needs.
  const otpState: OtpStateStore = {
    issue: () => Promise.resolve(ok(true)),
    countAttempt: () => Promise.resolve(ok(null)),
    read: () => Promise.resolve(ok(null)),
    discard: () => Promise.resolve(ok()),
    clear: () => Promise.resolve(ok()),
  };
  const nonces: NonceStore = { markConsumed: () => Promise.resolve(ok(true)) };

  const flowOptions: AuthWebOptions<MountEnv> = {
    ...options,
    resolveServices: async () => {
      const ring = await importAuthKeyRing(["d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65"]);
      return fakeAuthServices({
        users,
        enrolments,
        factors,
        signin: createSigninFlow({ keys: ring, users, state: otpState, nonces, factors, defer }),
        signup: createSignupFlow({ users, factors, defer }),
      });
    },
  };

  const app = new Forge<MountEnv>(nullLogger);
  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<MountEnv>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.KV }),
    globals: [
      csrfProtection({ secret: (c) => importCsrfKey((c as AppContext<MountEnv>).env.CSRF_SECRET), subject: (c) => sessionCtx.getOptional(c)?.id }),
    ],
    guards: createAuthGuards<MountEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: { users: () => users, signinPath: paths.auth.signin() },
      enrolment: {
        factors: () => factors,
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
      },
      origin: { allowedOrigins: ["http://localhost"] },
    }),
  });

  registerAuth(app, authMap, flowOptions);
  registerAccount(app, accountMap, flowOptions);
  registerAdmin(app, adminMap, flowOptions);

  // A consumer's own page, guarded with `requireAuth` alone. Every shipped group lists an enrolment
  // guard beside it, so this is the only place the guard's own step-up enforcement is observable.
  app.use(
    "/app/*",
    requireAuth<MountEnv>({ users: () => users, signinPath: paths.auth.signin(), factors: () => factors, stepUpPath: paths.auth.verify.show() }),
  );
  mapHandler(app, "GET", "/app/dashboard", () => new Response("dashboard"));

  return {
    app,
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

/** One visitor keeping their cookie across requests, which is the only way a session-bound token verifies. */
function visitor(mounted: ReturnType<typeof flowMount>, bindings: MountEnv) {
  let cookie = "";

  function keep(res: Response): Response {
    const set = res.headers.getSetCookie().find((value) => value.startsWith("__session="));
    if (set !== undefined) cookie = set.split(";")[0] ?? cookie;
    return res;
  }

  async function get(path: string): Promise<Response> {
    const res = keep(await mounted.app.request(path, { headers: cookie === "" ? {} : { cookie } }, bindings));
    await mounted.settle();
    return res;
  }

  /** Posts one of the page's forms, to its own action and with its own token, as a browser would. */
  async function form(url: string, fields: Record<string, string>, posts?: string): Promise<Response> {
    const page = await get(url);
    // A page may render more than one form, and the resend is the second: `posts` picks which.
    const path = posts ?? new URL(url, "http://localhost").pathname;
    const html = await page.text();
    // The rendered action rather than the page path: the return-to the guard minted travels on it,
    // and a test that posts to the path instead proves nothing about whether it survives.
    const block =
      html.split("<form").find((part) => new URL(/action="([^"]*)"/.exec(part)?.[1] ?? "/", "http://localhost").pathname === path) ?? "";
    const action = (/action="([^"]*)"/.exec(block)?.[1] ?? path).replaceAll("&amp;", "&");
    const token = /name="_csrf" value="([^"]+)"/.exec(block)?.[1] ?? "";
    const body = new URLSearchParams({ ...fields, _csrf: token });
    const res = keep(
      await mounted.app.request(
        action,
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie },
          body: body.toString(),
        },
        bindings,
      ),
    );
    await mounted.settle();
    return res;
  }

  /** The ceremony pair a browser controller would drive, read off the page's own contract attributes. */
  async function ceremony(page: string): Promise<Response> {
    const html = await (await get(page)).text();
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? "";
    const post = async (path: string, token: string, payload: unknown) =>
      keep(
        await mounted.app.request(
          path,
          {
            method: "POST",
            headers: { origin: "http://localhost", "content-type": "application/json", "x-csrf-token": token, cookie },
            body: JSON.stringify(payload),
          },
          bindings,
        ),
      );

    await post(attr(PASSKEY_OPTIONS_PATH_ATTR), attr(PASSKEY_OPTIONS_TOKEN_ATTR), { mode: attr(PASSKEY_MODE_ATTR) });
    const res = await post(attr(PASSKEY_VERIFY_PATH_ATTR), attr(PASSKEY_VERIFY_TOKEN_ATTR), {
      credential: { id: CODE, response: { clientDataJSON: CODE } },
    });
    await mounted.settle();
    return res;
  }

  return { get, form, ceremony };
}

describe("a second factor, driven through the mount", () => {
  for (const stepUp of ["totp-app", "passkey"] as const) {
    it(`carries a visitor from sign-up to a guarded page with ${stepUp} as the second factor, without a loop`, async () => {
      const mounted = flowMount(stepUp);
      const ada = visitor(mounted, env());

      // Sign up, then answer the emailed code. The policy is `always`, so a correct sign-in ends
      // owing an enrolment rather than settled.
      expect((await ada.form("/auth/signup", { email: "ada@example.com" })).headers.get("location")).toBe("/auth/verify");
      const signedIn = await ada.form("/auth/verify", { code: CODE });
      expect(signedIn.status).toBe(303);
      const enrolAt = stepUp === "totp-app" ? "/auth/enrol/totp" : "/auth/enrol/passkey";
      expect(signedIn.headers.get("location")).toBe(enrolAt);

      // The mark cannot have been carried over a sign-in, so the guarded page is still refused.
      expect((await ada.get("/account/factors")).headers.get("location")).toBe(enrolAt);

      // Enrol the factor the demand actually names.
      const enrolled = stepUp === "totp-app" ? await ada.form(enrolAt, { code: CODE }) : await ada.ceremony(enrolAt);
      expect(enrolled.status).toBe(stepUp === "totp-app" ? 303 : 200);

      // Now the demand is the step-up the enrolment was for, and the verify page can satisfy it —
      // which is unreachable unless the group's `resolve-auth` guard put an identity on the request.
      expect((await ada.get("/account/factors")).headers.get("location")).toBe("/auth/verify");
      const stepped = stepUp === "totp-app" ? await ada.form("/auth/verify", { code: CODE }) : await ada.ceremony("/auth/verify");
      expect(stepped.status).toBe(stepUp === "totp-app" ? 303 : 200);

      const settled = await ada.get("/account/factors");
      expect(settled.status).toBe(200);
      expect(/<title>([^<]*)<\/title>/.exec(await settled.text())?.[1]).toBe("Sign-in methods");
    });
  }

  // `requireAuth` mints the return-to on the redirect it sends an anonymous visitor away with, and
  // every later leg of the flow has to carry it or the last one has nothing to honour.
  it("returns a signed-in visitor to the page they were refused, not to the settled page", async () => {
    const mounted = flowMount("totp-app");
    const bindings = env();

    const ada = visitor(mounted, bindings);
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });

    const returning = visitor(mounted, bindings);
    const refused = await returning.get("/app/dashboard");
    expect(refused.headers.get("location")).toBe("/auth/signin?next=%2Fapp%2Fdashboard");

    const started = await returning.form(refused.headers.get("location") ?? "", { email: "ada@example.com" });
    expect(started.headers.get("location")).toBe("/auth/verify?next=%2Fapp%2Fdashboard");

    const signedIn = await returning.form(started.headers.get("location") ?? "", { code: CODE });
    expect(signedIn.headers.get("location")).toBe("/auth/verify?next=%2Fapp%2Fdashboard");

    const stepped = await returning.form(signedIn.headers.get("location") ?? "", { code: CODE });
    expect(stepped.headers.get("location")).toBe("/app/dashboard");
  });

  // The branch a visitor takes when the first code never arrived: it reloads the same page, so it
  // has to carry the return-to like every other leg or the flow settles somewhere else.
  it("keeps the return-to across a resend", async () => {
    const mounted = flowMount("totp-app");
    const bindings = env();

    const ada = visitor(mounted, bindings);
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });

    const returning = visitor(mounted, bindings);
    const refused = await returning.get("/app/dashboard");
    const started = await returning.form(refused.headers.get("location") ?? "", { email: "ada@example.com" });
    expect(started.headers.get("location")).toBe("/auth/verify?next=%2Fapp%2Fdashboard");

    const resent = await returning.form(started.headers.get("location") ?? "", {}, "/auth/verify/resend");
    expect(resent.headers.get("location")).toBe("/auth/verify?next=%2Fapp%2Fdashboard&resent");

    const signedIn = await returning.form(resent.headers.get("location") ?? "", { code: CODE });
    const stepped = await returning.form(signedIn.headers.get("location") ?? "", { code: CODE });
    expect(stepped.headers.get("location")).toBe("/app/dashboard");
  });

  // The sign-in path, not the sign-up path: an account whose second factor is already confirmed
  // completes its primary factor and owes a step-up, and `requireAuth` is on its own there.
  it("refuses a `requireAuth`-only page to a session that signed in and ignored the step-up it owes", async () => {
    const mounted = flowMount("totp-app");
    const bindings = env();

    // Ada enrols, so the account the second visitor signs into has a confirmed mandatory factor.
    const ada = visitor(mounted, bindings);
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });

    const returning = visitor(mounted, bindings);
    expect((await returning.form("/auth/signin", { email: "ada@example.com" })).headers.get("location")).toBe("/auth/verify");
    const signedIn = await returning.form("/auth/verify", { code: CODE });
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe("/auth/verify");

    // The redirect is ignored, which is the whole attack: the session is established and the second
    // factor is not proved, so the consumer's own page must not be served.
    const refused = await returning.get("/app/dashboard");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe("/auth/verify");

    expect(await (await returning.get("/app/dashboard")).text()).not.toContain("dashboard");
  });

  it("presents the verify page as a step-up rather than a sign-in once a session owes one", async () => {
    const mounted = flowMount("totp-app");
    const ada = visitor(mounted, env());

    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });

    // `totp-app` is never the primary factor, so naming it is proof the page read an identity off
    // the request: the sign-in branch could only ever have offered `email-otp`.
    const page = await (await ada.get("/auth/verify")).text();
    expect(page).toContain("Enter the current code from your authenticator app.");
  });
});
