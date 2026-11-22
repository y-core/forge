import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { pageShell } from "../../app/shell";
import type { MiddlewareGuardGroup } from "../../app/types";
import { contextVar } from "../../context/accessor";
import type { AppContext, RefuseHook } from "../../context/types";
import { getAppContext } from "../../context/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import { parseKeyRingSecrets } from "../../crypto/keyring/secrets";
import { signKeyRingValue, verifyKeyRingValue } from "../../crypto/keyring/signature";
import { mintCsrf } from "../../form/csrf";
import { err, ok } from "../../result/result";
import type { RateLimit } from "../../security/types";
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
import { AUTH_SESSION_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorService, AuthIdentifyingFactorService, AuthSecondFactorKind, AuthSecondFactorService } from "../factors/types";
import { createSigninFlow } from "../flows/signin";
import { createSignupFlow } from "../flows/signup";
import { importAuthKeyRing, resolveAuthServices } from "../keys/ring";
import { decodeAuthToken, encodeAuthToken } from "../keys/token";
import type { AuthOptions } from "../keys/types";
import {
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";
import { SITE_DATA_CSRF_HEADER_ATTR, SITE_DATA_PATH_ATTR, SITE_DATA_SCOPE, SITE_DATA_TOKEN_ATTR } from "../site-data-contract";
import { createAdminUserStore } from "../stores/admin-users";
import { createChallengeStore } from "../stores/challenges";
import { createCredentialStore } from "../stores/credentials";
import { createFactorStore } from "../stores/factors";
import { createAuthSessionStore } from "../stores/sessions";
import { createUserStore } from "../stores/users";
import type {
  AuthCredential,
  AuthFactor,
  AuthFactorKind,
  AuthSessionStore,
  AuthUser,
  CredentialStore,
  FactorStore,
  NonceStore,
  OtpStateStore,
  UserStore,
} from "../types";
import { AUTH_FORM_MAX_BYTES } from "./actions";
import { registerApproval } from "./approval";
import { createAuthGuards, requireAuth, resolveAuth } from "./guards";
import { authCtx } from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { registerAccount, registerAdmin, registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import { authRequestServices } from "./services";
import type { AuthGuardChainOptions, AuthRequestServices, AuthRequestServicesResolver, AuthWebOptions } from "./types";
import {
  attrOf,
  attrsOf,
  elementsOf,
  FAKE_APPROVAL_CODE,
  FAKE_RATE_LIMITS,
  fakeApproval,
  fakeLimiterContribution,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthIcon,
  fakeAuthServices,
  fakeAuthSessionStore,
  fakeAuthSigninFlow,
  fakeFactorRegistry,
  fakeSecondFactorOffering,
  textOf,
} from "./web.fixture";

/** Exactly the bindings a Worker mounting auth declares. */
interface MountEnv extends Record<string, unknown> {
  readonly DB: D1DatabaseLike;
  readonly KV: KVNamespace;
  readonly SESSION_SECRET: string;
  readonly CSRF_SECRET: string;
  readonly LIMITER?: RateLimit;
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
    sessions: createAuthSessionStore(db),
    credentials: createCredentialStore(db),
    enrolments,
    challenges: createChallengeStore(createD1Client(c.env.DB as never)),
    factors: fakeFactorRegistry(["passkey"], ["passkey"], enrolments),
  };
}

/** `build` as the services resolver the guards and the pages share, built once per request as `authRequestServices` builds its own. */
function perRequestServices(
  build: (c: AppContext<MountEnv>) => AuthRequestServices | Promise<AuthRequestServices>,
): AuthRequestServicesResolver<MountEnv> {
  const memo = contextVar<Promise<AuthRequestServices>>("mount.services");
  const resolve = (c: AppContext<MountEnv>): Promise<AuthRequestServices> => {
    const held = memo.getOptional(c);
    if (held !== undefined) return held;
    const building = Promise.resolve(build(c));
    memo.set(c, building);
    return building;
  };
  return Object.assign(resolve, {
    sessions: async (c: AppContext<MountEnv>) => (await resolve(c)).sessions,
    absoluteLifetimeMs: AUTH_SESSION_MAX_MS,
  });
}

/** The per-request services every guard, loader and action runs against. */
const services = perRequestServices((c) => {
  const stores = requestStores(c);
  return fakeAuthServices({
    users: stores.users,
    sessions: stores.sessions,
    credentials: stores.credentials,
    enrolments: stores.enrolments,
    factors: stores.factors,
  });
});

/** The registry the enrolment guards read, the one this request's services hold. */
async function factorRegistryFor(c: AppContext<MountEnv>) {
  return (await services(c)).factors;
}

const options: AuthWebOptions<MountEnv> = { resolveServices: services, paths, icon: fakeAuthIcon };

/** The app's admin-only page answers a non-administrator; every other refusal is declined to the chain's hook, else forge's default. */
const adminPage: RefuseHook<MountEnv> = (_c, refusal) =>
  refusal.guard === "admin"
    ? new Response("<p>Administrators only.</p>", { status: refusal.status, headers: { "content-type": "text/html; charset=utf-8" } })
    : undefined;

/** What an app adds around the auth mount: its own guard groups ahead of auth's, and per-group limits. */
interface MountExtras {
  readonly guards?: readonly MiddlewareGuardGroup<MountEnv>[];
  readonly rateLimit?: AuthGuardChainOptions<MountEnv>["rateLimit"];
  readonly trustCfHeaders?: boolean;
  readonly onRefuse?: RefuseHook<MountEnv>;
  readonly authRefuse?: RefuseHook<MountEnv> | null;
  readonly csrfMaxBytes?: number;
  readonly csrfExclude?: readonly string[];
}

/** The whole mount, in the order AUTH_MOUNTING.md §1 gives it. */
function mount(mounted: AuthWebOptions<MountEnv> = options, extras: MountExtras = {}): Forge<MountEnv> {
  const app = new Forge<MountEnv>(nullLogger);
  app.setShell(pageShell({ stylesheet: "/assets/app.css", script: "/assets/auth.js" }));

  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    ...(extras.trustCfHeaders === undefined ? {} : { trustCfHeaders: extras.trustCfHeaders }),
    rateLimits: FAKE_RATE_LIMITS,
    session: createAnonymousSession<MountEnv>({ ring: (bindings) => importKeyRing([bindings.SESSION_SECRET]), storage: "cookie" }),
    csrf: {
      ring: (bindings) => importKeyRing([bindings.CSRF_SECRET]),
      subject: "session",
      ...(extras.csrfMaxBytes === undefined ? {} : { maxBytes: extras.csrfMaxBytes }),
      ...(extras.csrfExclude === undefined ? {} : { exclude: extras.csrfExclude }),
    },
    ...(extras.onRefuse === undefined ? {} : { onRefuse: extras.onRefuse }),
    guards: [...(extras.guards ?? [])],
    contributions: [
      fakeLimiterContribution,
      createAuthGuards<MountEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { services, signinPath: paths.auth.signin() },
        enrolment: {
          factors: (c) => factorRegistryFor(c),
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.passkeys(),
        },
        origin: { allowedOrigins: ["http://localhost"] },
        ...(extras.authRefuse === null ? {} : { onRefuse: extras.authRefuse ?? adminPage }),
        ...(extras.rateLimit === undefined ? {} : { rateLimit: extras.rateLimit }),
      }),
    ],
  });

  registerAuth(app, authMap, mounted);
  registerAccount(app, accountMap, mounted);
  registerAdmin(app, adminMap, mounted);
  return app;
}

function env(users: readonly FakeAuthUser[] = []): MountEnv {
  return {
    DB: fakeAuthD1(users),
    KV: fakeKV(),
    SESSION_SECRET: "c15f22e5e9af45d15e1068ac2186b479735f5c60e4fc302f8916ab67aaf6b2c6",
    CSRF_SECRET: "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d",
  };
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

  it("lets an anonymous visitor on a fresh profile complete the sign-up POST", async () => {
    const app = mount();
    const bindings = env();

    const page = await app.request("/auth/signup", {}, bindings);
    expect(page.status).toBe(200);
    const html = await page.text();
    const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? "";
    expect(token).not.toBe("");

    const cookie = page.headers.getSetCookie().find((c) => c.startsWith("__Host-session="));
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

  it("answers a sign-in POST over the auth form cap at 413 with the policy's cap raised to 1 MiB, and admits a normal one", async () => {
    const app = mount(options, { csrfMaxBytes: 1 << 20 });
    const bindings = env();
    const page = await app.request("/auth/signin", {}, bindings);
    const token = (await page.text()).match(/name="_csrf" value="([^"]+)"/)?.[1] ?? "";
    const cookie =
      page.headers
        .getSetCookie()
        .find((c) => c.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";
    const signin = (fields: Record<string, string>) =>
      app.request(
        "/auth/signin",
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie },
          body: new URLSearchParams({ email: "ada@example.com", _csrf: token, ...fields }).toString(),
        },
        bindings,
      );

    const oversize = await signin({ padding: "x".repeat(AUTH_FORM_MAX_BYTES) });
    const normal = await signin({});
    expect({ oversize: oversize.status, normal: [normal.status, normal.headers.get("location")] }).toEqual({
      oversize: 413,
      normal: [303, "/auth/verify"],
    });
  });

  it("answers sign-in under a 1 MiB policy by size: admitted to 100 KiB, the form's 413 past it, the policy's plain 413 past 1 MiB, starting no sign-in when refused", async () => {
    const requested: string[] = [];
    const recording = perRequestServices((c) => {
      const stores = requestStores(c);
      const signin = fakeAuthSigninFlow({ request: (email, at) => (requested.push(email), { kind: "email-otp", expiresAt: at }) });
      return fakeAuthServices({ ...stores, signin });
    });
    const app = mount({ ...options, resolveServices: recording }, { csrfMaxBytes: 1024 * 1024 });
    const bindings = env();
    const page = await app.request("/auth/signin", {}, bindings);
    const token = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";
    const cookie =
      page.headers
        .getSetCookie()
        .find((set) => set.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";

    /** Posts a valid sign-in padded to exactly `bytes` in a second `_csrf` field, which the policy reads past and the action drops. */
    async function signinOf(bytes: number) {
      const prefix = `${new URLSearchParams({ email: "ada@example.com", _csrf: token }).toString()}&_csrf=`;
      const res = await app.request(
        "/auth/signin",
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie },
          body: `${prefix}${"x".repeat(bytes - prefix.length)}`,
        },
        bindings,
      );
      const html = await res.text();
      return {
        status: res.status,
        location: res.headers.get("location"),
        error: textOf(html, "p", 'data-slot="field-error"'),
        body: res.headers.get("content-type")?.startsWith("text/html") === true ? "html" : html,
        requested: requested.splice(0),
      };
    }

    expect({
      atFormCap: await signinOf(100 * 1024),
      pastFormCap: await signinOf(100 * 1024 + 1),
      pastPolicyCap: await signinOf(1024 * 1024 + 1),
    }).toEqual({
      atFormCap: { status: 303, location: "/auth/verify", error: "", body: "", requested: ["ada@example.com"] },
      pastFormCap: { status: 413, location: null, error: "That form was too large to read. Please try again.", body: "html", requested: [] },
      pastPolicyCap: { status: 413, location: null, error: "", body: "Payload Too Large", requested: [] },
    });
  });

  it("refuses a cross-origin POST to the sign-in endpoint", async () => {
    const res = await mount().request("/auth/signin", { method: "POST", headers: { origin: "https://evil.example.com" } }, env());
    expect(res.status).toBe(403);
  });

  it("refuses a cross-origin sign-in POST without reading its body", async () => {
    let bodyRead = false;
    const body = new ReadableStream(
      {
        pull() {
          bodyRead = true;
          throw new Error("the body of a cross-origin POST was read");
        },
      },
      { highWaterMark: 0 },
    );
    const res = await mount().request(
      "/auth/signin",
      {
        method: "POST",
        headers: { origin: "https://evil.example.com", "content-type": "application/x-www-form-urlencoded" },
        body,
        duplex: "half",
      } as RequestInit,
      env(),
    );

    expect({ status: res.status, body: await res.text(), bodyRead }).toEqual({ status: 403, body: "Forbidden", bodyRead: false });
  });

  it("answers an anonymous ceremony POST whose JSON body carries no token header a 400 problem+json, and the 401 JSON only once it carries a valid one", async () => {
    const ceremonyPath = "/auth/enrol/passkey/register/finish";
    const app = mount();
    mapHandler(app, "GET", "/test/mint", async (c) => new Response(await mintCsrf(c, ceremonyPath)));
    const bindings = env();
    const minted = await app.request("/test/mint", {}, bindings);
    const cookie =
      minted.headers
        .getSetCookie()
        .find((value) => value.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";
    const token = await minted.text();
    const post = (headers: Record<string, string>) =>
      app.request(
        ceremonyPath,
        { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", cookie, ...headers }, body: "{}" },
        bindings,
      );

    const tokenless = await post({});
    const tokened = await post({ "x-csrf-token": token });

    expect({
      tokenless: [tokenless.status, tokenless.headers.get("content-type"), await tokenless.json()],
      tokened: [tokened.status, await tokened.json()],
    }).toEqual({
      tokenless: [400, "application/problem+json; charset=utf-8", { type: "about:blank", title: "Bad Request", status: 400 }],
      tokened: [401, { error: "Not signed in." }],
    });
  });
});

describe("the AUTH_MOUNTING.md §1 mount under a csrf exclude reaching into auth's route maps", () => {
  const refusalOf = (route: string, entry: string) =>
    new Error(
      `applyMiddlewareChain: contribution 1's guard group \`/auth/signin, /auth/signup, /auth/signout, /auth/signout/site-data\`'s route \`${route}\` mints a CSRF token, but the csrf policy's exclude entry \`${entry}\` skips it — narrow the entry so it leaves the route covered.`,
    );

  for (const { name, exclude, route, entry } of [
    { name: "the sign-out confirm page", exclude: ["/public/*", "/auth/signout"], route: "/auth/signout", entry: "/auth/signout" },
    { name: "the whole auth map, at its first leaf", exclude: ["/public/*", "/auth/*"], route: "/auth/signin", entry: "/auth/*" },
    {
      name: "a nested ceremony leaf of registerAuth",
      exclude: ["/auth/verify/passkey/finish"],
      route: "/auth/verify/passkey/finish",
      entry: "/auth/verify/passkey/finish",
    },
    {
      name: "one leaf of registerAccount",
      exclude: ["/public/*", "/account/recovery-codes/confirm"],
      route: "/account/recovery-codes/confirm",
      entry: "/account/recovery-codes/confirm",
    },
    {
      name: "a param leaf of registerAccount",
      exclude: ["/account/passkeys/:id/edit"],
      route: "/account/passkeys/id/edit",
      entry: "/account/passkeys/:id/edit",
    },
    {
      name: "the elevation page registerAdmin maps outside the users group",
      exclude: ["/admin/elevate"],
      route: "/admin/elevate",
      entry: "/admin/elevate",
    },
    {
      name: "a param leaf of registerAdmin",
      exclude: ["/admin/users/:id/factors/reset"],
      route: "/admin/users/id/factors/reset",
      entry: "/admin/users/:id/factors/reset",
    },
  ]) {
    it(`throws at registration on an exclude covering ${name}, naming the route and the entry`, () => {
      expect(() => mount(options, { csrfExclude: exclude })).toThrow(refusalOf(route, entry));
    });
  }

  it("mounts under an exclude beside the auth maps, and its sign-out confirm page mints a token the sign-out accepts", async () => {
    const app = mount(options, { csrfExclude: ["/public/*", "/authority/*", "/accounts", "/admin"] });
    const bindings = env();
    const confirm = await app.request("/auth/signout", {}, bindings);
    const html = await confirm.text();
    const cookie =
      confirm.headers
        .getSetCookie()
        .find((value) => value.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";
    const signout = await app.request(
      "/auth/signout",
      {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie },
        body: new URLSearchParams({ _csrf: attrOf(html, 'name="_csrf"', "value") }).toString(),
      },
      bindings,
    );

    expect({
      confirm: { status: confirm.status, title: /<title>([^<]*)<\/title>/.exec(html)?.[1] },
      signout: { status: signout.status, location: signout.headers.get("location") },
    }).toEqual({ confirm: { status: 200, title: "Sign out" }, signout: { status: 303, location: "/auth/signin" } });
  });
});

describe("the auth guard table under an app's overlapping `/account/*` group, with a csrf policy (BOUNDARIES §2c)", () => {
  const ceremonyPath = "/account/passkeys/register/begin";
  const unlimitedGroups = {
    auth: false,
    "auth.verify": false,
    "auth.verify.ceremony": false,
    "auth.enrol": false,
    "auth.enrol.ceremony": false,
    account: false,
    "admin.users": false,
    "admin.elevate": false,
  } as const;

  function ceremonyWorld(allowed = true) {
    const events: string[] = [];
    const counter: RateLimit = {
      limit: async ({ key }) => {
        events.push(`limit:${key}`);
        return { success: allowed };
      },
    };
    const slice: MiddlewareGuardGroup<MountEnv> = {
      paths: ["/account/*"],
      guards: [
        async (_context, next) => {
          events.push("slice-guard");
          return next();
        },
      ],
    };
    const app = mount(options, {
      guards: [slice],
      rateLimit: { ...unlimitedGroups, "account.passkeyCeremony": { binding: "LIMITER" } },
      trustCfHeaders: true,
    });
    mapHandler(app, "GET", "/test/mint", async (c) => new Response(await mintCsrf(c, ceremonyPath)));
    return { app, events, counter };
  }

  async function signedOutPost(world: ReturnType<typeof ceremonyWorld>, token: (minted: string) => string) {
    const bindings = { ...env(), LIMITER: world.counter };
    const minted = await world.app.request("/test/mint", {}, bindings);
    const cookie =
      minted.headers
        .getSetCookie()
        .find((value) => value.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";
    const csrf = token(await minted.text());
    const res = await world.app.request(
      ceremonyPath,
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
          "x-csrf-token": csrf,
          cookie,
        },
        body: "{}",
      },
      bindings,
    );
    return { status: res.status, body: await res.text(), events: world.events };
  }

  it("consults the passkey ceremony's limiter, then refuses a signed-out client's forged token 403 before any guard can answer 401", async () => {
    const res = await signedOutPost(ceremonyWorld(), () => "forged.token");
    expect({ ...res, body: JSON.parse(res.body) }).toEqual({
      status: 403,
      body: { type: "about:blank", title: "Forbidden", status: 403 },
      events: ["limit:203.0.113.7"],
    });
  });

  it("answers an over-limit ceremony POST a 429 problem+json before CSRF reads its forged token", async () => {
    const res = await signedOutPost(ceremonyWorld(false), () => "forged.token");
    expect({ ...res, body: JSON.parse(res.body) }).toEqual({
      status: 429,
      body: { type: "about:blank", title: "Too Many Requests", status: 429 },
      events: ["limit:203.0.113.7"],
    });
  });

  it("runs both groups' guards after verifying a valid token, so a signed-out client gets the 401 JSON", async () => {
    const res = await signedOutPost(ceremonyWorld(), (minted) => minted);
    expect({ status: res.status, body: JSON.parse(res.body), events: res.events }).toEqual({
      status: 401,
      body: { error: "Not signed in." },
      events: ["limit:203.0.113.7", "slice-guard"],
    });
  });
});

const CODE = "123456";

/** An in-memory user store the flows can add accounts to. */
function memoryUsers(): UserStore & { readonly rows: readonly AuthUser[] } {
  const rows: AuthUser[] = [];
  return {
    rows,
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
    claimEmailChange: () => Promise.resolve(ok(true)),
    changeEmail: async () => ok(true),
  };
}

/** An in-memory factor store whose rows an enrolment ceremony can confirm. */
function memoryFactors(): FactorStore {
  const rows: AuthFactor[] = [];
  return {
    listByUser: async (userId) => ok(rows.filter((row) => row.userId === userId)),
    find: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    listConfirmedKinds: async (userId, kinds) =>
      ok(rows.filter((row) => row.userId === userId && kinds.includes(row.kind) && row.confirmedAt !== null).map((row) => row.kind)),
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
    countAttempt: async (userId, kind) => ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null),
    recordVerification: async () => ok(true),
    replaceSecret: async () => ok(true),
    countSecretsNotUnder: async () => ok(0),
    remove: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return index >= 0 ? ok("changed" as const) : ok("not-found" as const);
    },
  };
}

/** A credential store over `credentials` whose rename and remove change the rows the next list reads, and whose last remove drops the passkey row in `enrolments`. */
function memoryCredentials(credentials: AuthCredential[], enrolments: FactorStore): CredentialStore {
  const owned = (id: string, userId: string) => credentials.findIndex((held) => held.id === id && held.userId === userId);
  return {
    ...fakeAuthCredentialStore(credentials),
    relabel: async (id, userId, label, at) => {
      const index = owned(id, userId);
      const row = credentials[index];
      if (row !== undefined) credentials[index] = { ...row, label, updatedAt: at };
      return ok(row !== undefined);
    },
    removeForUser: async (id, userId, at, origin) => {
      const index = owned(id, userId);
      if (index >= 0) credentials.splice(index, 1);
      const factor = await enrolments.find(userId, "passkey");
      if (factor.ok && factor.data !== null && !credentials.some((held) => held.userId === userId)) {
        await enrolments.remove(factor.data.id, userId, at, origin, []);
      }
      return index >= 0 ? ok("changed" as const) : ok("not-found" as const);
    },
  };
}

/** A factor service that accepts `CODE` and records its enrolment in `store`, and a passkey's in `credentials` under the name it carried. */
function driveableFactor<kind extends AuthFactorKind>(kind: kind, store: FactorStore, credentials: AuthCredential[] = []): AuthFactorService<kind> {
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
      await store.confirm(row.id, userId, at, { keep: null });
      if (kind === "passkey") {
        const { nickname } = JSON.parse(presented) as { nickname: string | null };
        credentials.push(fakeAuthCredential({ id: `c${credentials.length + 1}`, userId, label: nickname, createdAt: at, updatedAt: at }));
      }
      return ok({ ...row, confirmedAt: at });
    },
  };
}

/** The whole mount again, this time over stores a drive-through can change and a clock it can move; `passkey` offers a passkey beside `stepUp`, which is required where given, and `signOut` and `signoutClearsSiteData` are the mount's sign-out mode. */
function flowMount(
  stepUp: AuthSecondFactorKind | null,
  {
    passkey = false,
    signOut,
    signoutClearsSiteData,
  }: { readonly passkey?: boolean; readonly signOut?: AuthWebOptions["signOut"]; readonly signoutClearsSiteData?: boolean | undefined } = {},
): { readonly app: Forge<MountEnv>; readonly settle: () => Promise<void>; readonly advance: (ms: number) => void } {
  const users = memoryUsers();
  const sessions = fakeAuthSessionStore(users.rows);
  const enrolments = memoryFactors();
  const credentials: AuthCredential[] = [];
  let clock = 1_750_000_000_000;
  const now = () => clock;
  const pending: Promise<unknown>[] = [];
  const defer = (work: Promise<unknown>) => void pending.push(work.catch(() => undefined));

  const kinds: readonly AuthSecondFactorKind[] = [...(stepUp === null ? [] : [stepUp]), ...(passkey ? (["passkey"] as const) : [])];
  const seconds = kinds.map((kind) => driveableFactor(kind, enrolments, credentials) as AuthSecondFactorService);
  const primary = driveableFactor("email-otp", enrolments) as AuthIdentifyingFactorService;
  const factors = createFactorRegistry(
    enrolments,
    seconds.length === 0 ? { primary } : { primary, second: fakeSecondFactorOffering(seconds, stepUp === null ? [] : [stepUp]) },
  );

  const otpState: OtpStateStore = {
    issue: () => Promise.resolve(ok(true)),
    countAttempt: () => Promise.resolve(ok(null)),
    read: () => Promise.resolve(ok(null)),
    discard: () => Promise.resolve(ok()),
    clear: () => Promise.resolve(ok()),
  };
  const nonces: NonceStore = { markConsumed: () => Promise.resolve(ok(true)) };

  const flowServices = perRequestServices(async () => {
    const ring = await importAuthKeyRing(["d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65"]);
    return fakeAuthServices({
      users,
      sessions,
      credentials: memoryCredentials(credentials, enrolments),
      enrolments,
      factors,
      signin: createSigninFlow({ keys: ring, users, state: otpState, nonces, factors, defer }),
      signup: createSignupFlow({ users, factors, defer }),
    });
  });
  const flowOptions: AuthWebOptions<MountEnv> = { ...options, now, resolveServices: flowServices, signOut, signoutClearsSiteData };

  const app = new Forge<MountEnv>(nullLogger);
  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<MountEnv>({ ring: (bindings) => importKeyRing([bindings.SESSION_SECRET]), storage: "cookie" }),
    csrf: { ring: (bindings) => importKeyRing([bindings.CSRF_SECRET]), subject: "session" },
    contributions: [
      createAuthGuards<MountEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { services: flowServices, signinPath: paths.auth.signin(), now },
        enrolment: {
          factors: () => factors,
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.passkeys(),
          now,
        },
        origin: { allowedOrigins: ["http://localhost"] },
        onRefuse: adminPage,
      }),
    ],
  });

  registerAuth(app, authMap, flowOptions);
  registerAccount(app, accountMap, flowOptions);
  registerAdmin(app, adminMap, flowOptions);

  app.use(
    "/app/*",
    requireAuth<MountEnv>({
      services: flowServices,
      signinPath: paths.auth.signin(),
      factors: () => factors,
      stepUpPath: paths.auth.verify.show(),
      now,
    }),
  );
  mapHandler(app, "GET", "/app/dashboard", () => new Response("dashboard"));

  return {
    app,
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** One visitor keeping their cookies across requests, as a browser does: what a response sets is kept, and what it expires is dropped. */
function visitor(mounted: ReturnType<typeof flowMount>, bindings: MountEnv) {
  const jar = new Map<string, string>();
  let cookie = "";

  function keep(res: Response): Response {
    for (const set of res.headers.getSetCookie()) {
      const [pair = ""] = set.split(";");
      const at = pair.indexOf("=");
      const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
      if (/;\s*max-age=0\b/i.test(set) || value === "") jar.delete(name);
      else jar.set(name, value);
    }
    cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    return res;
  }

  /** The cookie names the visitor holds. */
  const holds = (): readonly string[] => [...jar.keys()];

  async function get(path: string): Promise<Response> {
    const res = keep(await mounted.app.request(path, { headers: cookie === "" ? {} : { cookie } }, bindings));
    await mounted.settle();
    return res;
  }

  /** The action and token of the page's form posting to `actionPath`, as the page rendered them. */
  async function formOf(url: string, actionPath?: string): Promise<{ readonly action: string; readonly token: string }> {
    const page = await get(url);
    const path = actionPath ?? new URL(url, "http://localhost").pathname;
    const html = await page.text();
    // The rendered action rather than the page path: the return-to the guard minted travels on it,
    // and a test that posts to the path instead proves nothing about whether it survives.
    const block =
      html.split("<form").find((part) => new URL(/action="([^"]*)"/.exec(part)?.[1] ?? "/", "http://localhost").pathname === path) ?? "";
    const action = (/action="([^"]*)"/.exec(block)?.[1] ?? path).replaceAll("&amp;", "&");
    const token = /name="_csrf" value="([^"]+)"/.exec(block)?.[1] ?? "";
    return { action, token };
  }

  /** Posts `fields` as a same-origin form, carrying the visitor's cookie. */
  async function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
    const res = keep(
      await mounted.app.request(
        path,
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie, ...headers },
          body: new URLSearchParams(fields).toString(),
        },
        bindings,
      ),
    );
    await mounted.settle();
    return res;
  }

  /** Posts one of the page's forms, to its own action and with its own token, as a browser would. */
  async function form(url: string, fields: Record<string, string>, actionPath?: string): Promise<Response> {
    const { action, token } = await formOf(url, actionPath);
    return post(action, { ...fields, _csrf: token });
  }

  /** Posts `payload` as JSON with `token` in the header, as the browser controller does. */
  async function json(path: string, token: string, payload: unknown): Promise<Response> {
    return keep(
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
  }

  /** The ceremony calls a page's contract attributes promise, each ready to post whenever the visitor gets to it. */
  async function contract(page: string) {
    const html = await (await get(page)).text();
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? "";
    const [beginPath, beginToken, mode] = [attr(PASSKEY_OPTIONS_PATH_ATTR), attr(PASSKEY_OPTIONS_TOKEN_ATTR), attr(PASSKEY_MODE_ATTR)];
    const [finishPath, finishToken] = [attr(PASSKEY_VERIFY_PATH_ATTR), attr(PASSKEY_VERIFY_TOKEN_ATTR)];
    return {
      begin: () => json(beginPath, beginToken, { mode }),
      finish: (nickname?: string) => json(finishPath, finishToken, { credential: { id: CODE, response: { clientDataJSON: CODE } }, nickname }),
    };
  }

  /** The ceremony pair a browser controller would drive, read off the page's own contract attributes. */
  async function ceremony(page: string, nickname?: string): Promise<Response> {
    const held = await contract(page);
    await held.begin();
    const res = await held.finish(nickname);
    await mounted.settle();
    return res;
  }

  /** Sends the htmx write a page's form carries for `method`, to its own path and with the token from its own `hx-headers`. */
  async function hx(formHtml: string, method: "PATCH" | "DELETE", fields: Record<string, string> = {}): Promise<Response> {
    const headers = JSON.parse(attrOf(formHtml, 'data-slot="form"', "hx-headers").replaceAll("&quot;", '"')) as Record<string, string>;
    const res = keep(
      await mounted.app.request(
        attrOf(formHtml, 'data-slot="form"', `hx-${method.toLowerCase()}`),
        {
          method,
          headers: { ...headers, origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", "HX-Request": "true", cookie },
          body: new URLSearchParams(fields).toString(),
        },
        bindings,
      ),
    );
    await mounted.settle();
    return res;
  }

  /** Posts the storage clear a page's site-data scope asks for, to its own path with its own token, as the browser controller does. */
  async function beacon(html: string): Promise<Response> {
    const scope = `data-scope="${SITE_DATA_SCOPE}"`;
    const res = keep(
      await mounted.app.request(
        attrOf(html, scope, SITE_DATA_PATH_ATTR),
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            [attrOf(html, scope, SITE_DATA_CSRF_HEADER_ATTR)]: attrOf(html, scope, SITE_DATA_TOKEN_ATTR),
            cookie,
          },
        },
        bindings,
      ),
    );
    await mounted.settle();
    return res;
  }

  return { get, formOf, post, form, contract, ceremony, hx, beacon, holds };
}

describe("the auth groups' refusal hooks, driven through the mount (FORGE_ERRORS.md §3e)", () => {
  const CEREMONIES = ["/auth/verify/passkey/begin", "/auth/enrol/passkey/register/begin", "/account/passkeys/register/begin"];
  const PROBLEM = "application/problem+json; charset=utf-8";
  const unlimited = {
    auth: false,
    "auth.verify": false,
    "auth.verify.ceremony": false,
    "auth.enrol": false,
    "auth.enrol.ceremony": false,
    account: false,
    "account.passkeyCeremony": false,
    "admin.users": false,
    "admin.elevate": false,
  } as const;

  const htmlRefuse: RefuseHook<MountEnv> = (_c, refusal) =>
    new Response("<p>refused</p>", { status: refusal.status, headers: { "content-type": "text/html; charset=utf-8" } });
  const chainRefuse: RefuseHook<MountEnv> = (c, refusal) =>
    new Response(`chain refused ${c.url.pathname}`, { status: refusal.status, headers: { "content-type": "text/plain; charset=utf-8" } });

  function jsonPost(app: Forge<MountEnv>, path: string, bindings: MountEnv) {
    return app.request(
      path,
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
          "x-csrf-token": "forged.token",
        },
        body: "{}",
      },
      bindings,
    );
  }

  function formPost(app: Forge<MountEnv>, path: string, bindings: MountEnv, fields: Record<string, string>, cookie = "") {
    return app.request(
      path,
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": "203.0.113.7",
          ...(cookie === "" ? {} : { cookie }),
        },
        body: new URLSearchParams(fields).toString(),
      },
      bindings,
    );
  }

  async function answerOf(res: Response) {
    const type = res.headers.get("content-type");
    return { status: res.status, type, body: type === PROBLEM ? await res.json() : await res.text() };
  }

  it("answers a CSRF refusal on every JSON ceremony group with a 403 problem+json carrying no reason, though the auth groups were handed an HTML hook", async () => {
    const app = mount(options, { authRefuse: htmlRefuse });
    const bindings = env();

    const ceremonies = await Promise.all(CEREMONIES.map(async (path) => ({ path, ...(await answerOf(await jsonPost(app, path, bindings))) })));
    const signin = await answerOf(await formPost(app, "/auth/signin", bindings, { email: "ada@example.com", _csrf: "forged.token" }));

    expect({ ceremonies, signin }).toEqual({
      ceremonies: CEREMONIES.map((path) => ({ path, status: 403, type: PROBLEM, body: { type: "about:blank", title: "Forbidden", status: 403 } })),
      signin: { status: 403, type: "text/html; charset=utf-8", body: "<p>refused</p>" },
    });
  });

  it.each([
    {
      name: "an over-limit 429",
      counter: { limit: async () => ({ success: false }) } satisfies RateLimit,
      status: 429,
      title: "Too Many Requests",
    },
    {
      name: "a failed limiter's 503",
      counter: {
        limit: async () => {
          throw new Error("limiter down");
        },
      } satisfies RateLimit,
      status: 503,
      title: "Service Unavailable",
    },
  ])(
    "answers $name on every JSON ceremony group as problem+json carrying no reason, though the auth groups were handed an HTML hook",
    async ({ counter, status, title }) => {
      const limited = { binding: "LIMITER" };
      const app = mount(options, {
        authRefuse: htmlRefuse,
        rateLimit: {
          ...unlimited,
          auth: limited,
          "auth.verify.ceremony": limited,
          "auth.enrol.ceremony": limited,
          "account.passkeyCeremony": limited,
        },
        trustCfHeaders: true,
      });
      const bindings = { ...env(), LIMITER: counter };

      const ceremonies = await Promise.all(CEREMONIES.map(async (path) => ({ path, ...(await answerOf(await jsonPost(app, path, bindings))) })));
      const signin = await answerOf(await formPost(app, "/auth/signin", bindings, { email: "ada@example.com" }));

      expect({ ceremonies, signin }).toEqual({
        ceremonies: CEREMONIES.map((path) => ({ path, status, type: PROBLEM, body: { type: "about:blank", title, status } })),
        signin: { status, type: "text/html; charset=utf-8", body: "<p>refused</p>" },
      });
    },
  );

  it("sends a CSRF-refused sign-out POST to the confirm page when the auth groups were handed no hook, while the JSON groups still answer problem+json", async () => {
    const app = mount(options, { onRefuse: chainRefuse, authRefuse: null });
    const bindings = env();

    const signoutRes = await formPost(app, "/auth/signout", bindings, {});
    const signout = { ...(await answerOf(signoutRes)), location: signoutRes.headers.get("location") };
    const ceremony = await answerOf(await jsonPost(app, "/auth/verify/passkey/begin", bindings));

    expect({ signout, ceremony }).toEqual({
      signout: { status: 303, type: null, body: "", location: "/auth/signout" },
      ceremony: { status: 403, type: PROBLEM, body: { type: "about:blank", title: "Forbidden", status: 403 } },
    });
  });

  it("sends a CSRF-refused sign-out POST to the confirm page, while a POST no auth group covers is answered by the chain's hook", async () => {
    const app = mount(options, { onRefuse: chainRefuse });
    const ran: string[] = [];
    mapHandler(app, "POST", "/contact", (c) => {
      ran.push(c.url.pathname);
      return new Response("sent");
    });
    const bindings = env();
    const confirm = await app.request("/auth/signout", {}, bindings);
    const cookie =
      confirm.headers
        .getSetCookie()
        .find((value) => value.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";

    const signout = await formPost(app, "/auth/signout", bindings, {}, cookie);
    const contact = await formPost(app, "/contact", bindings, { message: "hello" }, cookie);

    expect({
      cookie: cookie !== "",
      signout: { status: signout.status, location: signout.headers.get("location"), body: await signout.text() },
      contact: { status: contact.status, location: contact.headers.get("location"), body: await contact.text() },
      ran,
    }).toEqual({
      cookie: true,
      signout: { status: 303, location: "/auth/signout", body: "" },
      contact: { status: 403, location: null, body: "chain refused /contact" },
      ran: [],
    });
  });

  it("passes an auth-group origin refusal the documented hook declines to the chain's hook, else to forge's plain-text default", async () => {
    const crossSite = { method: "POST", headers: { origin: "https://evil.example.com" } };

    const chained = await answerOf(await mount(options, { onRefuse: chainRefuse }).request("/auth/signin", crossSite, env()));
    const unhooked = await answerOf(await mount().request("/auth/signin", crossSite, env()));

    expect({ chained, unhooked }).toEqual({
      chained: { status: 403, type: "text/plain; charset=utf-8", body: "chain refused /auth/signin" },
      unhooked: { status: 403, type: null, body: "Forbidden" },
    });
  });

  it("keeps Retry-After on an over-limit 429 the documented hook declines", async () => {
    const app = mount(options, { rateLimit: { ...unlimited, auth: { binding: "LIMITER" } }, trustCfHeaders: true });
    const bindings = { ...env(), LIMITER: { limit: async () => ({ success: false }) } satisfies RateLimit };

    const res = await formPost(app, "/auth/signin", bindings, { email: "ada@example.com" });

    expect({ ...(await answerOf(res)), retryAfter: res.headers.get("retry-after") }).toEqual({
      status: 429,
      type: null,
      body: "Too many requests. Please try again later.",
      retryAfter: String(FAKE_RATE_LIMITS.LIMITER.period),
    });
  });

  it("passes a CSRF-refused sign-in POST the documented hook declines to the chain's hook, else to forge's plain-text default", async () => {
    const forged = { email: "ada@example.com", _csrf: "forged.token" };

    const chained = await answerOf(await formPost(mount(options, { onRefuse: chainRefuse }), "/auth/signin", env(), forged));
    const unhooked = await answerOf(await formPost(mount(), "/auth/signin", env(), forged));

    expect({ chained, unhooked }).toEqual({
      chained: { status: 403, type: "text/plain; charset=utf-8", body: "chain refused /auth/signin" },
      unhooked: { status: 403, type: null, body: "Forbidden" },
    });
  });

  it("answers the 503 of an absent limiter binding the documented hook declines with the chain's hook, else forge's default without Retry-After", async () => {
    const limited = { rateLimit: { ...unlimited, auth: { binding: "LIMITER" } }, trustCfHeaders: true };

    const chainedRes = await formPost(mount(options, { ...limited, onRefuse: chainRefuse }), "/auth/signin", env(), { email: "ada@example.com" });
    const unhookedRes = await formPost(mount(options, limited), "/auth/signin", env(), { email: "ada@example.com" });

    expect({
      chained: { ...(await answerOf(chainedRes)), retryAfter: chainedRes.headers.get("retry-after") },
      unhooked: { ...(await answerOf(unhookedRes)), retryAfter: unhookedRes.headers.get("retry-after") },
    }).toEqual({
      chained: { status: 503, type: "text/plain; charset=utf-8", body: "chain refused /auth/signin", retryAfter: null },
      unhooked: { status: 503, type: null, body: "Service Unavailable", retryAfter: null },
    });
  });
});

describe("a second factor, driven through the mount", () => {
  for (const stepUp of ["totp-app", "passkey"] as const) {
    it(`carries a visitor from sign-up to a guarded page with ${stepUp} as the second factor, without a loop`, async () => {
      const mounted = flowMount(stepUp);
      const ada = visitor(mounted, env());

      expect((await ada.form("/auth/signup", { email: "ada@example.com" })).headers.get("location")).toBe("/auth/verify");
      const signedIn = await ada.form("/auth/verify", { code: CODE });
      expect(signedIn.status).toBe(303);
      const enrolAt = stepUp === "totp-app" ? "/auth/enrol/totp" : "/auth/enrol/passkey";
      expect(signedIn.headers.get("location")).toBe(enrolAt);

      expect((await ada.get("/account/factors")).headers.get("location")).toBe(enrolAt);

      const enrolled = stepUp === "totp-app" ? await ada.form(enrolAt, { code: CODE }) : await ada.ceremony(enrolAt);
      expect(enrolled.status).toBe(stepUp === "totp-app" ? 303 : 200);

      expect((await ada.get("/account/factors")).headers.get("location")).toBe("/auth/verify");
      const stepped = stepUp === "totp-app" ? await ada.form("/auth/verify", { code: CODE }) : await ada.ceremony("/auth/verify");
      expect(stepped.status).toBe(stepUp === "totp-app" ? 303 : 200);

      const settled = await ada.get("/account/factors");
      expect(settled.status).toBe(200);
      expect(/<title>([^<]*)<\/title>/.exec(await settled.text())?.[1]).toBe("Factors");
    });
  }

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
    expect(stepped.headers.get("location")).toBe("/account/recovery-codes?next=%2Fapp%2Fdashboard");
  });

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
    expect(resent.headers.get("location")?.replace(/&resent=\d+$/, "&resent=<ms>")).toBe("/auth/verify?next=%2Fapp%2Fdashboard&resent=<ms>");

    const signedIn = await returning.form(resent.headers.get("location") ?? "", { code: CODE });
    const stepped = await returning.form(signedIn.headers.get("location") ?? "", { code: CODE });
    expect(stepped.headers.get("location")).toBe("/account/recovery-codes?next=%2Fapp%2Fdashboard");
  });

  it("refuses a `requireAuth`-only page to a session that signed in and ignored the step-up it owes", async () => {
    const mounted = flowMount("totp-app");
    const bindings = env();

    const ada = visitor(mounted, bindings);
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });

    const returning = visitor(mounted, bindings);
    expect((await returning.form("/auth/signin", { email: "ada@example.com" })).headers.get("location")).toBe("/auth/verify");
    const signedIn = await returning.form("/auth/verify", { code: CODE });
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe("/auth/verify");

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

    const page = await (await ada.get("/auth/verify")).text();
    expect(textOf(page, "div", 'data-slot="card-description"')).toBe("Enter the current code from your authenticator app.");
  });
});

describe("a sign-out whose token aged past the policy's day, driven through the mount", () => {
  const MINUTE = 60_000;
  const DAY = 24 * 60 * MINUTE;
  const DASHBOARD = [200, null] as const;
  const SIGNED_OUT = [302, "/auth/signin?next=%2Fapp%2Fdashboard"] as const;

  let restore: (() => void)[] = [];
  afterEach(() => {
    for (const undo of restore) undo();
    restore = [];
  });

  /** Holds `Date.now`, which the CSRF policy reads, at the real time it was called; returns the setter. */
  function holdClock(): (ms: number) => void {
    const start = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(start);
    restore.push(() => clock.mockRestore());
    return (ms) => clock.mockReturnValue(start + ms);
  }

  function answerOf(res: Response): readonly [number, string | null] {
    return [res.status, res.headers.get("location")];
  }

  /** Ada, signed up, enrolled and stepped up, so the guarded dashboard serves her. */
  async function signedInAda() {
    const ada = visitor(flowMount("totp-app"), env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });
    await ada.form("/auth/verify", { code: CODE });
    expect(answerOf(await ada.get("/app/dashboard"))).toEqual(DASHBOARD);
    return ada;
  }

  it("sends a sign-out a minute past a day to the confirm page, keeps the session, and signs out from that page's form", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(DAY + MINUTE);

    const refused = answerOf(await ada.post("/auth/signout", { _csrf: token }));
    const kept = answerOf(await ada.get("/app/dashboard"));
    const confirm = await ada.get("/auth/signout");
    const confirmPage = { status: confirm.status, title: /<title>([^<]*)<\/title>/.exec(await confirm.text())?.[1] };
    const signedOut = answerOf(await ada.form("/auth/signout", {}));
    const after = answerOf(await ada.get("/app/dashboard"));

    expect({ refused, kept, confirmPage, signedOut, after }).toEqual({
      refused: [303, "/auth/signout"],
      kept: DASHBOARD,
      confirmPage: { status: 200, title: "Sign out" },
      signedOut: [303, "/auth/signin"],
      after: SIGNED_OUT,
    });
  });

  it("signs out directly a minute short of a day", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(DAY - MINUTE);

    const signedOut = answerOf(await ada.post("/auth/signout", { _csrf: token }));
    const after = answerOf(await ada.get("/app/dashboard"));

    expect({ signedOut, after }).toEqual({ signedOut: [303, "/auth/signin"], after: SIGNED_OUT });
  });

  it("answers an htmx sign-out a minute past a day with a 204 carrying HX-Redirect to the confirm page, and keeps the session", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(DAY + MINUTE);

    const res = await ada.post("/auth/signout", { _csrf: token }, { "HX-Request": "true" });
    const refused = { status: res.status, location: res.headers.get("location"), hxRedirect: res.headers.get("hx-redirect") };
    const kept = answerOf(await ada.get("/app/dashboard"));

    expect({ refused, kept }).toEqual({ refused: { status: 204, location: null, hxRedirect: "/auth/signout" }, kept: DASHBOARD });
  });

  it("answers a non-administrator's GET of an admin page with the documented hook's page", async () => {
    const ada = await signedInAda();

    const res = await ada.get("/admin/users");

    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "<p>Administrators only.</p>" });
  });

  it("never ends a session on a GET of the sign-out path", async () => {
    const ada = await signedInAda();

    const page = await ada.get("/auth/signout");
    const kept = answerOf(await ada.get("/app/dashboard"));

    expect({ status: page.status, kept }).toEqual({ status: 200, kept: DASHBOARD });
  });

  it("still refuses a stale or missing token on a POST other than the sign-out at 403", async () => {
    const mounted = flowMount("totp-app");
    const anonymous = visitor(mounted, env());
    const advance = holdClock();
    const { token } = await anonymous.formOf("/auth/signin");
    advance(DAY + MINUTE);

    const stale = await anonymous.post("/auth/signin", { email: "ada@example.com", _csrf: token });
    const missing = await anonymous.post("/auth/signin", { email: "ada@example.com" });

    expect([
      { status: stale.status, body: await stale.text() },
      { status: missing.status, body: await missing.text() },
    ]).toEqual([
      { status: 403, body: "Forbidden" },
      { status: 403, body: "Forbidden" },
    ]);
  });
});

describe("a sign-out, driven through the mount", () => {
  const CLEARED = "__Host-session=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure";

  interface CartView {
    readonly cart: string | null;
    readonly id: string;
    readonly token: string;
  }

  /** Ada signed up and in on a mount signing out in `signOut`'s mode, holding a cart the app set and a sign-in token minted before she signs out. */
  async function signedInWithCart(signOut?: AuthWebOptions["signOut"], signoutClearsSiteData?: boolean) {
    const mounted = flowMount(null, { signOut, signoutClearsSiteData });
    mapHandler(mounted.app, "GET", "/cart", async (c) => {
      const session = sessionCtx.get(c);
      const add = c.url.searchParams.get("add");
      if (add !== null) session.set("cart", add);
      return Response.json({ cart: session.get("cart") ?? null, id: session.id, token: await mintCsrf(c, "/auth/signin") });
    });
    const ada = visitor(mounted, env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    const cart = async (query = ""): Promise<CartView> => (await (await ada.get(`/cart${query}`)).json()) as CartView;
    const before = await cart("?add=3+books");
    const dashboard = (await ada.get("/app/dashboard")).status;
    return { ada, cart, before, dashboard };
  }

  async function signinWith(ada: ReturnType<typeof visitor>, token: string) {
    const res = await ada.post("/auth/signin", { email: "ada@example.com", _csrf: token });
    return { status: res.status, location: res.headers.get("location") };
  }

  it("destroys the session: the response clears the cookie and the cart set before it is gone", async () => {
    const { ada, cart, before, dashboard } = await signedInWithCart();

    const res = await ada.form("/auth/signout", {});
    const after = await cart();

    expect({
      dashboard,
      before: before.cart,
      signedOut: [res.status, res.headers.get("location")],
      cookie: res.headers.getSetCookie().filter((header) => header.startsWith("__Host-session=")),
      after: after.cart,
      dashboardAfter: (await ada.get("/app/dashboard")).status,
    }).toEqual({ dashboard: 200, before: "3 books", signedOut: [303, "/auth/signin"], cookie: [CLEARED], after: null, dashboardAfter: 302 });
  });

  it("with keepVisitorData, keeps the cart set before it under a new session id, and signs the visitor out", async () => {
    const { ada, cart, before, dashboard } = await signedInWithCart({ keepVisitorData: true });

    const res = await ada.form("/auth/signout", {});
    const after = await cart();

    expect({
      dashboard,
      signedOut: [res.status, res.headers.get("location")],
      cleared: res.headers.getSetCookie().includes(CLEARED),
      after: after.cart,
      rotated: after.id !== before.id,
      dashboardAfter: (await ada.get("/app/dashboard")).status,
    }).toEqual({ dashboard: 200, signedOut: [303, "/auth/signin"], cleared: false, after: "3 books", rotated: true, dashboardAfter: 302 });
  });

  for (const [mode, signOut] of [
    ["by default", undefined],
    ["with keepVisitorData", { keepVisitorData: true } as const],
  ] as const) {
    it(`refuses a session-bound token minted before the sign-out once it has run, ${mode}, while one minted after it passes`, async () => {
      const { ada, cart, before } = await signedInWithCart(signOut);

      await ada.form("/auth/signout", {});
      const stale = await signinWith(ada, before.token);
      const fresh = await signinWith(ada, (await cart()).token);

      expect({ stale, fresh }).toEqual({ stale: { status: 403, location: null }, fresh: { status: 303, location: "/auth/verify" } });
    });
  }
});

describe("a sign-out clearing site data, driven through the mount", () => {
  const OWED = "__Host-auth-site-data-owed";
  const MARKED = `${OWED}=MQ==; HttpOnly; Max-Age=300; Path=/; SameSite=Lax; Secure`;
  const UNMARKED = `${OWED}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure`;
  const SCOPE = 'data-scope="auth-site-data"';

  /** Ada signed up and in on a mount clearing site data on sign-out, in `signOut`'s mode. */
  async function signedIn(signOut?: AuthWebOptions["signOut"]) {
    const mounted = flowMount(null, { signOut, signoutClearsSiteData: true });
    const ada = visitor(mounted, env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    return ada;
  }

  const owedOf = (res: Response) => res.headers.getSetCookie().filter((header) => header.startsWith(`${OWED}=`));
  const answerOf = (res: Response) => ({ status: res.status, clear: res.headers.get("clear-site-data"), owed: owedOf(res) });

  for (const [mode, signOut, owed] of [
    ["by default", undefined, [MARKED]],
    ["with keepVisitorData", { keepVisitorData: true } as const, []],
  ] as const) {
    it(`answers the sign-out with only the cache clear, ${mode}`, async () => {
      const ada = await signedIn(signOut);

      const navigation = answerOf(await ada.form("/auth/signout", {}));

      expect(navigation).toEqual({ status: 303, clear: '"cache"', owed: [...owed] });
    });

    it(`answers an htmx sign-out with only the cache clear, ${mode}`, async () => {
      const ada = await signedIn(signOut);
      const { token } = await ada.formOf("/auth/signout");

      const res = await ada.post("/auth/signout", { _csrf: token }, { "HX-Request": "true" });

      expect({ ...answerOf(res), hxRedirect: res.headers.get("hx-redirect") }).toEqual({
        status: 204,
        clear: '"cache"',
        owed: [...owed],
        hxRedirect: "/auth/signin",
      });
    });

    it(`renders the beacon on the next auth page, clears storage once on its post, and renders it no more, ${mode}`, async () => {
      const ada = await signedIn(signOut);
      await ada.form("/auth/signout", {});

      const owing = await (await ada.get("/auth/signin")).text();
      const first = await ada.beacon(owing);
      const held = ada.holds().includes(OWED);
      const second = await ada.beacon(owing);
      const after = await (await ada.get("/auth/signin")).text();

      expect({
        beacon: attrOf(owing, SCOPE, "data-site-data-path"),
        first: answerOf(first),
        held,
        second: answerOf(second),
        beaconAfter: elementsOf(after, "div", SCOPE).length,
      }).toEqual({
        beacon: "/auth/signout/site-data",
        first: { status: 204, clear: '"storage"', owed: owed.length === 0 ? [] : [UNMARKED] },
        held: false,
        second: { status: 204, clear: null, owed: [] },
        beaconAfter: 0,
      });
    });
  }

  it("by default, carries the owed clear on the mark alone: the page after it renders on a fresh session", async () => {
    const ada = await signedIn();

    const res = await ada.form("/auth/signout", {});
    const held = ada.holds();
    const page = await (await ada.get("/auth/signin")).text();

    expect({
      session: res.headers.getSetCookie().filter((header) => header.startsWith("__Host-session=")),
      held,
      beacon: elementsOf(page, "div", SCOPE).length,
    }).toEqual({ session: ["__Host-session=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure"], held: [OWED], beacon: 1 });
  });

  it("wipes nothing for a visitor who never signed out, whether they follow a link to the endpoint or post to it with a token minted for it", async () => {
    const mounted = flowMount(null, { signoutClearsSiteData: true });
    mapHandler(mounted.app, "GET", "/mint", async (c) => new Response(await mintCsrf(c, "/auth/signout/site-data")));
    const stranger = visitor(mounted, env());
    const page = await (await stranger.get("/auth/signin")).text();
    const token = await (await stranger.get("/mint")).text();

    const link = await stranger.get("/auth/signout/site-data");
    const posted = await stranger.post("/auth/signout/site-data", {}, { "x-csrf-token": token });

    expect({
      beacon: elementsOf(page, "div", SCOPE).length,
      link: { clear: link.headers.get("clear-site-data"), owed: owedOf(link) },
      posted: answerOf(posted),
    }).toEqual({ beacon: 0, link: { clear: null, owed: [] }, posted: { status: 204, clear: null, owed: [] } });
  });

  it("expires the mark when the visitor signs in again before the beacon ran", async () => {
    const ada = await signedIn();
    await ada.form("/auth/signout", {});

    await ada.form("/auth/signin", { email: "ada@example.com" });
    const verified = await ada.form("/auth/verify", { code: CODE });

    expect({ owed: owedOf(verified), held: ada.holds().includes(OWED) }).toEqual({ owed: [UNMARKED], held: false });
  });

  it("queues no mark expiry on a sign-in by a visitor who carries no mark", async () => {
    const mounted = flowMount(null, { signoutClearsSiteData: true });
    const ada = visitor(mounted, env());
    await ada.form("/auth/signup", { email: "ada@example.com" });

    const verified = await ada.form("/auth/verify", { code: CODE });

    expect({ status: verified.status, owed: owedOf(verified) }).toEqual({ status: 303, owed: [] });
  });
});

describe("adding a passkey from the account pages, driven through the mount", () => {
  const FRESH_STEP_UP_MS = 15 * 60_000;
  const STALE = { status: 403, body: { error: "This change needs a fresh verification." } };

  /** A visitor who signed up, enrolled the required authenticator app and proved it, so they owe nothing. */
  async function settled(mounted: ReturnType<typeof flowMount>) {
    const ada = visitor(mounted, env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });
    await ada.form("/auth/verify", { code: CODE });
    expect((await ada.get("/account/factors")).status).toBe(200);
    return ada;
  }

  const labelsOn = async (ada: ReturnType<typeof visitor>) => {
    const html = await (await ada.get("/account/passkeys")).text();
    return elementsOf(html, "span", 'data-ref="credential-label"').map((span) => textOf(span, "span", 'data-ref="credential-label"'));
  };

  it("lets a settled visitor with a fresh step-up follow the list's enrol link, finish the ceremony, and see the passkey listed", async () => {
    const ada = await settled(flowMount("totp-app", { passkey: true }));

    const enrolAt = attrOf(await (await ada.get("/account/passkeys")).text(), 'data-ref="passkey-enrol"', "href");
    expect(enrolAt).toBe("/account/passkeys/new");
    expect((await ada.get(enrolAt)).status).toBe(200);

    const finished = await ada.ceremony(enrolAt, "Work laptop");
    expect({ status: finished.status, body: await finished.json() }).toEqual({ status: 200, body: { redirect: "/account/recovery-codes" } });
    expect(await labelsOn(ada)).toEqual(["Work laptop"]);
  });

  it("sends a stale step-up from the enrolment page to verify, and serves the page once it is proved again", async () => {
    const mounted = flowMount("totp-app", { passkey: true });
    const ada = await settled(mounted);
    mounted.advance(FRESH_STEP_UP_MS);

    const refused = await ada.get("/account/passkeys/new");
    expect({ status: refused.status, location: refused.headers.get("location") }).toEqual({
      status: 302,
      location: "/auth/verify?next=%2Faccount%2Fpasskeys%2Fnew",
    });

    await ada.form(refused.headers.get("location") ?? "", { code: CODE });
    expect((await ada.get("/account/passkeys/new")).status).toBe(200);
  });

  it("refuses both ceremony calls once the step-up goes stale after the page was opened, and lists no passkey", async () => {
    const mounted = flowMount("totp-app", { passkey: true });
    const ada = await settled(mounted);
    const held = await ada.contract("/account/passkeys/new");
    mounted.advance(FRESH_STEP_UP_MS);

    const begun = await held.begin();
    expect({ status: begun.status, body: await begun.json() }).toEqual(STALE);
    const finished = await held.finish("Work laptop");
    expect({ status: finished.status, body: await finished.json() }).toEqual(STALE);
    expect(await labelsOn(ada)).toEqual([]);
  });

  it("still sends a visitor who owes a passkey enrolment to the pending route, not the account page", async () => {
    const ada = visitor(flowMount("passkey"), env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });

    const refused = await ada.get("/account/passkeys/new");
    expect({ status: refused.status, location: refused.headers.get("location") }).toEqual({ status: 303, location: "/auth/enrol/passkey" });
  });
});

describe("managing several passkeys from the account list, driven through the mount", () => {
  /** A visitor who signed up and settled on the authenticator app, then enrolled one passkey per name in `labels`. */
  async function holding(labels: readonly string[]) {
    const ada = visitor(flowMount("totp-app", { passkey: true }), env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });
    await ada.form("/auth/verify", { code: CODE });
    for (const label of labels) expect((await ada.ceremony("/account/passkeys/new", label)).status).toBe(200);
    return ada;
  }

  const listOf = async (ada: ReturnType<typeof visitor>) => (await ada.get("/account/passkeys")).text();

  const labelsIn = (html: string) =>
    elementsOf(html, "span", 'data-ref="credential-label"').map((span) => textOf(span, "span", 'data-ref="credential-label"'));

  it("removes the second row with that row's own token and leaves the first", async () => {
    const ada = await holding(["Work laptop", "Phone"]);
    const [, second] = elementsOf(await listOf(ada), "li", 'data-ref="credential"');

    const res = await ada.hx(second ?? "", "DELETE");

    expect({ status: res.status, left: labelsIn(await listOf(ada)) }).toEqual({ status: 200, left: ["Work laptop"] });
  });

  it("refuses the second row's remove at 403 when it carries the first row's token or none, and keeps both", async () => {
    const ada = await holding(["Work laptop", "Phone"]);
    const [first = "", second = ""] = elementsOf(await listOf(ada), "li", 'data-ref="credential"');
    const secondPath = attrOf(second, 'data-slot="form"', "hx-delete");

    const borrowed = await ada.hx(first.replace(/hx-delete="[^"]*"/, `hx-delete="${secondPath}"`), "DELETE");
    const tokenless = await ada.hx(second.replace(/hx-headers="[^"]*"/, 'hx-headers="{}"'), "DELETE");

    expect({
      borrowed: { status: borrowed.status, body: await borrowed.text() },
      tokenless: { status: tokenless.status, body: await tokenless.text() },
      left: labelsIn(await listOf(ada)),
    }).toEqual({ borrowed: { status: 403, body: "Forbidden" }, tokenless: { status: 403, body: "Forbidden" }, left: ["Work laptop", "Phone"] });
  });

  it("answers each remove with the list as it now stands, prompting once one passkey is left and not once none is", async () => {
    const ada = await holding(["Work laptop", "Phone"]);
    const removeLast = async () => {
      const rows = elementsOf(await listOf(ada), "li", 'data-ref="credential"');
      const html = await (await ada.hx(rows.at(-1) ?? "", "DELETE")).text();
      return { labels: labelsIn(html), prompt: attrOf(html, 'data-ref="passkey-backup-enrol"', "href") };
    };

    expect([await removeLast(), await removeLast()]).toEqual([
      { labels: ["Work laptop"], prompt: "/account/passkeys/new" },
      { labels: [], prompt: "" },
    ]);
  });

  it("renames a passkey through the edit page's PATCH form, and the list shows the new name", async () => {
    const ada = await holding(["Work laptop", "Phone"]);
    const editAt = attrOf(await listOf(ada), 'data-ref="credential-rename"', "href");

    const res = await ada.hx(await (await ada.get(editAt)).text(), "PATCH", { label: "Home desktop" });

    expect({ status: res.status, labels: labelsIn(await listOf(ada)) }).toEqual({ status: 200, labels: ["Home desktop", "Phone"] });
  });

  it("prompts for a backup passkey, linking to enrolment, only while the visitor holds exactly one", async () => {
    const prompts = async (labels: readonly string[]) => attrOf(await listOf(await holding(labels)), 'data-ref="passkey-backup-enrol"', "href");

    expect([await prompts([]), await prompts(["Work laptop"]), await prompts(["Work laptop", "Phone"])]).toEqual(["", "/account/passkeys/new", ""]);
  });
});

describe("removing the last passkey, driven through the mount", () => {
  /** Signs up, enrols one passkey on `enrolAt`, removes it from the list, then signs in from a second browser and answers where the code sent it. */
  async function signInAfterRemoval(mounted: ReturnType<typeof flowMount>, enrolAt: string): Promise<string | null> {
    const bindings = env();
    const ada = visitor(mounted, bindings);
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    expect((await ada.ceremony(enrolAt, "Work laptop")).status).toBe(200);
    if (enrolAt === "/auth/enrol/passkey") expect((await ada.ceremony("/auth/verify")).status).toBe(200);
    const [row = ""] = elementsOf(await (await ada.get("/account/passkeys")).text(), "li", 'data-ref="credential"');
    expect((await ada.hx(row, "DELETE")).status).toBe(200);

    const returning = visitor(mounted, bindings);
    await returning.form("/auth/signin", { email: "ada@example.com" });
    return (await returning.form("/auth/verify", { code: CODE })).headers.get("location");
  }

  it("signs the user in on email alone where the passkey is optional and no recovery code was kept, owing no passkey step-up", async () => {
    expect(await signInAfterRemoval(flowMount(null, { passkey: true }), "/account/passkeys/new")).toBe("/account/passkeys");
  });

  it("sends the user to enrol again where the factor is mandatory, rather than to a step-up nothing can answer", async () => {
    expect(await signInAfterRemoval(flowMount("passkey"), "/auth/enrol/passkey")).toBe("/auth/enrol/passkey");
  });
});

describe("the session list, driven through the mount", () => {
  /** Ada signed up, enrolled and proved the authenticator app in one browser, and signed in and stepped up in another. */
  async function twoBrowsers() {
    const mounted = flowMount("totp-app");
    const ada = visitor(mounted, env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    await ada.form("/auth/verify", { code: CODE });
    await ada.form("/auth/enrol/totp", { code: CODE });
    await ada.form("/auth/verify", { code: CODE });
    const other = visitor(mounted, env());
    await other.form("/auth/signin", { email: "ada@example.com" });
    await other.form("/auth/verify", { code: CODE });
    await other.form("/auth/verify", { code: CODE });
    expect([(await ada.get("/account/sessions")).status, (await other.get("/account/sessions")).status]).toEqual([200, 200]);
    return { ada, other };
  }

  const rowsOn = async (who: ReturnType<typeof visitor>) => {
    const html = await (await who.get("/account/sessions")).text();
    return elementsOf(html, "li", 'data-ref="session"').map((row) => row.includes('data-ref="session-current"'));
  };

  it("lists both browsers with only the reading one marked, and signs out everywhere else, leaving only the current session", async () => {
    const { ada, other } = await twoBrowsers();
    const listed = await rowsOn(ada);

    const res = await ada.form("/account/sessions", {}, "/account/sessions/revoke-others");

    expect({
      listed: listed.toSorted(),
      answer: { status: res.status, location: res.headers.get("location") },
      left: await rowsOn(ada),
      other: (await other.get("/account/sessions")).headers.get("location"),
    }).toEqual({
      listed: [false, true],
      answer: { status: 303, location: "/account/sessions" },
      left: [true],
      other: "/auth/signin?next=%2Faccount%2Fsessions",
    });
  });

  it("signs out the one other browser a row's form names, with the token the page minted once for every row", async () => {
    const { ada, other } = await twoBrowsers();
    const html = await (await ada.get("/account/sessions")).text();
    const row = elementsOf(html, "li", 'data-ref="session"').find((held) => !held.includes('data-ref="session-current"')) ?? "";
    const session = /name="session" value="([^"]+)"/.exec(row)?.[1] ?? "";

    const res = await ada.form("/account/sessions", { session }, "/account/sessions/revoke");

    expect({ status: res.status, left: await rowsOn(ada), other: (await other.get("/account/sessions")).headers.get("location") }).toEqual({
      status: 303,
      left: [true],
      other: "/auth/signin?next=%2Faccount%2Fsessions",
    });
  });
});

describe("the mount with Turnstile on the sign-in form", () => {
  const guarded: AuthWebOptions<MountEnv> = {
    ...options,
    turnstile: {
      keys: () => ({ siteKey: "site-key-public", secretKey: "secret-key-private" }),
      verify: () => ({ expectedHostname: "localhost" }),
      flows: ["signin"],
    },
  };

  let savedFetch: typeof globalThis.fetch | undefined;

  afterEach(() => {
    if (savedFetch !== undefined) globalThis.fetch = savedFetch;
    savedFetch = undefined;
  });

  it("shows the widget, refuses a POST without a token at 422, and admits a solved one", async () => {
    const sent: unknown[] = [];
    savedFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ success: true, hostname: "localhost", action: "auth-signin" }));
    }) as typeof globalThis.fetch;
    const app = mount(guarded);
    const bindings = env();

    const page = await app.request("/auth/signin", {}, bindings);
    const html = await page.text();
    const token = attrOf(html, 'name="_csrf"', "value");
    const cookie =
      page.headers
        .getSetCookie()
        .find((c) => c.startsWith("__Host-session="))
        ?.split(";")[0] ?? "";
    const post = (fields: Record<string, string>) =>
      app.request(
        "/auth/signin",
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", cookie },
          body: new URLSearchParams({ email: "ada@example.com", _csrf: token, ...fields }).toString(),
        },
        bindings,
      );
    const widget = attrsOf(html, 'data-scope="turnstile"');

    const refused = await post({});
    const admitted = await post({ "cf-turnstile-response": "solved" });

    expect({
      widget: { sitekey: widget["data-sitekey"], action: widget["data-action"] },
      refused: refused.status,
      admitted: { status: admitted.status, location: admitted.headers.get("location") },
      sent,
    }).toEqual({
      widget: { sitekey: "site-key-public", action: "auth-signin" },
      refused: 422,
      admitted: { status: 303, location: "/auth/verify" },
      sent: [{ secret: "secret-key-private", response: "solved" }],
    });
  });
});

const ROOT_ID = "018f0000-0000-7000-8000-0000000000a1";
const ADA_ID = "018f0000-0000-7000-8000-0000000000b2";
const HYBRID_ACCOUNTS: readonly FakeAuthUser[] = [
  { id: ROOT_ID, email: "root@example.com", isAdmin: true },
  { id: ADA_ID, email: "ada@example.com" },
];

/** The services of a deployment whose only factor is the emailed code, which any address answers with `CODE`, its session store built by `sessionStore`. */
function hybridServicesOver(
  sessionStore: (c: AppContext<MountEnv>) => AuthSessionStore = (c) => createAuthSessionStore(createD1Client(c.env.DB as never)),
): AuthRequestServicesResolver<MountEnv> {
  return perRequestServices((c) => {
    const db = createD1Client(c.env.DB as never);
    const users = createUserStore(db);
    const enrolments = createFactorStore(db);
    return fakeAuthServices({
      users,
      sessions: sessionStore(c),
      enrolments,
      factors: fakeFactorRegistry([], [], enrolments),
      signin: fakeAuthSigninFlow({
        complete: async (email, presented) => {
          const found = await users.findByEmailKey(email.toLowerCase());
          if (presented !== CODE || !found.ok || found.data === null) return err("unrecognised" as const);
          return ok({ user: found.data, kind: "email-otp" as const, resolution: { status: "satisfied" as const } });
        },
      }),
      admin: createAdminUserStore(db),
    });
  });
}

/** One session middleware for every path, an anonymous funnel page at `/fica` outside every auth group, and the approval prompt. */
function hybridMount(storage: "cookie" | "kv", hybridServices: AuthRequestServicesResolver<MountEnv> = hybridServicesOver()): Forge<MountEnv> {
  const app = new Forge<MountEnv>(nullLogger);
  const ring = (bindings: MountEnv) => importKeyRing([bindings.SESSION_SECRET]);
  const hybridOptions: AuthWebOptions<MountEnv> = { resolveServices: hybridServices, paths, icon: fakeAuthIcon };
  const approval = fakeApproval({ origin: { allowedOrigins: ["http://localhost"] } });
  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    rateLimits: FAKE_RATE_LIMITS,
    session:
      storage === "cookie"
        ? createAnonymousSession<MountEnv>({ ring, storage: "cookie" })
        : createAnonymousSession<MountEnv>({ ring, kv: (bindings) => bindings.KV }),
    csrf: { ring: (bindings) => importKeyRing([bindings.CSRF_SECRET]), subject: "session" },
    globals: [resolveAuth<MountEnv>({ services: hybridServices })],
    contributions: [
      createAuthGuards<MountEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { services: hybridServices, signinPath: paths.auth.signin() },
        enrolment: {
          factors: async (c) => (await hybridServices(c)).factors,
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.passkeys(),
        },
        origin: { allowedOrigins: ["http://localhost"] },
        onRefuse: adminPage,
      }),
      approval.contribution,
      fakeLimiterContribution,
    ],
  });
  registerAuth(app, authMap, hybridOptions);
  registerAccount(app, accountMap, hybridOptions);
  registerAdmin(app, adminMap, hybridOptions);
  registerApproval(app, approval);
  mapHandler(app, "GET", "/fica", (context) => new Response(authCtx.getOptional(context)?.email ?? "anonymous"));
  return app;
}

/** A KV binding counting every call made on it, by method. */
function countingKV(): { readonly kv: KVNamespace; readonly calls: string[] } {
  const calls: string[] = [];
  const kv = fakeKV();
  return {
    calls,
    kv: new Proxy(kv, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (value as (...held: unknown[]) => unknown).apply(target, args);
        };
      },
    }),
  };
}

/** The bindings of one deployment over `HYBRID_ACCOUNTS`, with what each binding was asked. */
function hybridEnv() {
  const db = fakeAuthD1(HYBRID_ACCOUNTS);
  const counted = countingKV();
  const bindings: MountEnv = { ...env(), DB: db, KV: counted.kv, LIMITER: { limit: async () => ({ success: true }) } };
  return {
    bindings,
    kvCalls: counted.calls,
    d1Calls: db.calls,
    d1Writes: () => db.calls.filter((call) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(call.sql)).map((call) => call.sql.trim().split(/\s+/)[0]),
  };
}

/** One browser over the hybrid mount, keeping its cookie, and reading each form's own token as a browser would. */
function browser(app: Forge<MountEnv>, bindings: MountEnv) {
  let cookie = "";
  const cookies: string[] = [];

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(cookie === "" ? {} : { cookie }) };
    const res = await app.request(path, { ...init, headers }, bindings);
    const set = res.headers.getSetCookie().find((value) => value.startsWith("__Host-session="));
    if (set !== undefined) {
      cookie = set.split(";")[0] ?? cookie;
      cookies.push(cookie);
    }
    return res;
  }

  async function form(url: string, fields: Record<string, string>): Promise<Response> {
    const html = await (await send(url)).text();
    const path = new URL(url, "http://localhost").pathname;
    const block =
      html.split("<form").find((part) => new URL(/action="([^"]*)"/.exec(part)?.[1] ?? "/", "http://localhost").pathname === path) ?? "";
    const action = (/action="([^"]*)"/.exec(block)?.[1] ?? path).replaceAll("&amp;", "&");
    const token = /name="_csrf" value="([^"]+)"/.exec(block)?.[1] ?? "";
    return send(action, {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, _csrf: token }).toString(),
    });
  }

  /** Submits the admin edit form for `id` as its `hx-patch` sends it, with the token from its `hx-headers`. */
  async function editAccount(id: string, fields: { role: string; status: string }): Promise<Response> {
    const html = await (await send(`/admin/users/${id}/edit`)).text();
    const headers = JSON.parse(attrOf(html, 'data-slot="form"', "hx-headers").replaceAll("&quot;", '"')) as Record<string, string>;
    return send(attrOf(html, 'data-slot="form"', "hx-patch"), {
      method: "PATCH",
      headers: { ...headers, origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", "HX-Request": "true" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async function signIn(email: string): Promise<Response> {
    const started = await form("/auth/signin", { email });
    return form(started.headers.get("location") ?? "", { code: CODE });
  }

  return { get: (path: string) => send(path), form, editAccount, signIn, holding: () => cookie, cookies };
}

describe("one session mount serving a funnel and a signed-in area", () => {
  for (const storage of ["cookie", "kv"] as const) {
    it(`keeps a signed-in visitor's identity on a page outside every auth group, under ${storage} storage`, async () => {
      const { bindings } = hybridEnv();
      const app = hybridMount(storage);
      const ada = browser(app, bindings);

      const before = await (await ada.get("/fica")).text();
      const signedIn = await ada.signIn("ada@example.com");
      const funnel = await ada.get("/fica");
      const account = await ada.get("/account/factors");

      expect({
        before,
        signedIn: [signedIn.status, signedIn.headers.get("location")],
        funnel: [funnel.status, await funnel.text()],
        account: account.status,
      }).toEqual({ before: "anonymous", signedIn: [303, "/account/passkeys"], funnel: [200, "ada@example.com"], account: 200 });
    });

    it(`serves the same funnel page anonymously to another browser on the same mount, under ${storage} storage`, async () => {
      const { bindings } = hybridEnv();
      const app = hybridMount(storage);
      await browser(app, bindings).signIn("ada@example.com");
      const stranger = await browser(app, bindings).get("/fica");
      expect([stranger.status, await stranger.text()]).toEqual([200, "anonymous"]);
    });
  }
});

describe("what an anonymous visitor costs the deployment", () => {
  it('writes neither KV nor D1 for any anonymous request under `storage: "cookie"`, starting a sign-in and presenting an approval included', async () => {
    const { bindings, kvCalls, d1Writes } = hybridEnv();
    const stranger = browser(hybridMount("cookie"), bindings);

    const answers = [
      (await stranger.get("/fica")).status,
      (await stranger.get("/auth/signin")).status,
      (await stranger.get("/account/factors")).status,
      (await stranger.form("/auth/signin", { email: "ada@example.com" })).status,
      (await stranger.form("/approve", { code: FAKE_APPROVAL_CODE })).status,
    ];

    expect({ answers, kvCalls, d1Writes: d1Writes() }).toEqual({ answers: [200, 200, 302, 303, 303], kvCalls: [], d1Writes: [] });
  });

  for (const storage of ["cookie", "kv"] as const) {
    it(`makes no KV call, no D1 call and sets no cookie on an anonymous page view, under ${storage} storage`, async () => {
      const { bindings, kvCalls, d1Calls } = hybridEnv();
      const stranger = browser(hybridMount(storage), bindings);

      const funnel = await stranger.get("/fica");
      const guarded = await stranger.get("/account/factors");

      expect({ answers: [funnel.status, guarded.status, guarded.headers.get("location")], kvCalls, d1Calls, cookies: stranger.cookies }).toEqual({
        answers: [200, 302, "/auth/signin?next=%2Faccount%2Ffactors"],
        kvCalls: [],
        d1Calls: [],
        cookies: [],
      });
    });
  }
});

describe("an anonymous view of a page carrying a form", () => {
  for (const storage of ["cookie", "kv"] as const) {
    it(`writes no KV and calls no D1 for the sign-in page, under ${storage} storage`, async () => {
      const { bindings, kvCalls, d1Calls } = hybridEnv();
      const page = await browser(hybridMount(storage), bindings).get("/auth/signin");
      expect({ status: page.status, kvWrites: kvCalls.filter((call) => call === "put" || call === "delete"), d1Calls }).toEqual({
        status: 200,
        kvWrites: [],
        d1Calls: [],
      });
    });
  }
});

describe("deactivating a signed-in account from the admin page", () => {
  it("leaves the account's next request anonymous, and reactivating it revives no session, not even from a copied cookie", async () => {
    const { bindings } = hybridEnv();
    const app = hybridMount("cookie");
    const ada = browser(app, bindings);
    const root = browser(app, bindings);
    await ada.signIn("ada@example.com");
    await root.signIn("root@example.com");
    const before = await (await ada.get("/fica")).text();
    const copied = ada.holding();
    const replay = async () => (await app.request("/fica", { headers: { cookie: copied } }, bindings)).text();

    const deactivated = await root.editAccount(ADA_ID, { role: "member", status: "deactivated" });
    const afterDeactivation = await (await ada.get("/fica")).text();
    const refused = await ada.get("/account/factors");
    const reactivated = await root.editAccount(ADA_ID, { role: "member", status: "active" });
    const afterReactivation = await (await ada.get("/fica")).text();
    const copiedAfterReactivation = await replay();

    expect({
      before,
      deactivated: deactivated.status,
      afterDeactivation,
      refused: [refused.status, refused.headers.get("location")],
      reactivated: reactivated.status,
      afterReactivation,
      copiedAfterReactivation,
      rootStill: await (await root.get("/fica")).text(),
    }).toEqual({
      before: "ada@example.com",
      deactivated: 200,
      afterDeactivation: "anonymous",
      refused: [302, "/auth/signin?next=%2Faccount%2Ffactors"],
      reactivated: 200,
      afterReactivation: "anonymous",
      copiedAfterReactivation: "anonymous",
      rootStill: "root@example.com",
    });
  });
});

describe('the auth session stores one request builds, under `storage: "cookie"`', () => {
  /** A session-store factory recording the method and path of the request each store it builds was built for. */
  function countingSessionStores() {
    const built: string[] = [];
    const factory = (c: AppContext<MountEnv>): AuthSessionStore => {
      built.push(`${c.method.toUpperCase()} ${c.url.pathname}`);
      return createAuthSessionStore(createD1Client(c.env.DB as never));
    };
    return { built, factory };
  }

  async function signedInOverCountedStores(email: string) {
    const { bindings } = hybridEnv();
    const stores = countingSessionStores();
    const who = browser(hybridMount("cookie", hybridServicesOver(stores.factory)), bindings);
    await who.signIn(email);
    stores.built.length = 0;
    return { who, built: stores.built };
  }

  it("builds one for a signed-in guarded account page, though the global resolver, the group's guards and the page all read it", async () => {
    const { who, built } = await signedInOverCountedStores("ada@example.com");

    const page = await who.get(paths.account.factors());

    expect({ status: page.status, built }).toEqual({ status: 200, built: [`GET ${paths.account.factors()}`] });
  });

  it("builds one for the guarded admin edit page and one for the PATCH action its form sends", async () => {
    const { who, built } = await signedInOverCountedStores("root@example.com");

    const saved = await who.editAccount(ADA_ID, { role: "member", status: "active" });

    expect({ status: saved.status, built }).toEqual({
      status: 200,
      built: [`GET ${paths.admin.users.edit({ id: ADA_ID })}`, `PATCH ${paths.admin.users.update({ id: ADA_ID })}`],
    });
  });
});

describe("a mandatory app beside an optional passkey, driven through the mount", () => {
  const answerOf = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

  it("sends a sign-up owing the mandatory app straight to its page, with no choice page in between", async () => {
    const ada = visitor(flowMount("totp-app", { passkey: true }), env());
    await ada.form("/auth/signup", { email: "ada@example.com" });
    const signedIn = await ada.form("/auth/verify", { code: CODE });
    expect({ signedIn: answerOf(signedIn), choice: (await ada.get("/auth/enrol")).status }).toEqual({
      signedIn: { status: 303, location: "/auth/enrol/totp" },
      choice: 404,
    });
  });
});

/** Auth session stores over the deployment's D1, every call answering `unavailable` while `outage.down` is set and recording its method in `outage.asked`. */
function switchableSessionStores() {
  const outage = { down: false, asked: [] as string[] };
  const factory = (c: AppContext<MountEnv>): AuthSessionStore => {
    const live = createAuthSessionStore(createD1Client(c.env.DB as never));
    return new Proxy(live, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if (!outage.down) return (value as (...held: unknown[]) => unknown).apply(target, args);
          outage.asked.push(String(prop));
          return err(new AuthStoreError("unavailable", String(prop)));
        };
      },
    });
  };
  return { outage, factory };
}

describe("the chain's session slot with the auth session store down (ROUTING_AND_MIDDLEWARE.md §3h)", () => {
  const answerOf = async (res: Response) => ({ status: res.status, location: res.headers.get("location"), body: await res.text() });

  it("serves a public page resolved anonymous, and sends a guarded one to sign-in, for a session holding no sign-in token", async () => {
    const { bindings } = hybridEnv();
    const stores = switchableSessionStores();
    const stranger = browser(hybridMount("cookie", hybridServicesOver(stores.factory)), bindings);
    const started = await stranger.form("/auth/signin", { email: "ada@example.com" });
    stores.outage.down = true;

    const funnel = await stranger.get("/fica");
    const guarded = await stranger.get(paths.account.factors());

    expect({
      started: {
        status: started.status,
        location: started.headers.get("location"),
        holdsSession: stranger.holding().startsWith("__Host-session="),
      },
      funnel: await answerOf(funnel),
      guarded: { status: guarded.status, location: guarded.headers.get("location") },
      asked: stores.outage.asked,
    }).toEqual({
      started: { status: 303, location: "/auth/verify", holdsSession: true },
      funnel: { status: 200, location: null, body: "anonymous" },
      guarded: { status: 302, location: "/auth/signin?next=%2Faccount%2Ffactors" },
      asked: [],
    });
  });

  it("answers 503 and never anonymous for a session holding a sign-in token, on a guarded and an unguarded path, and keeps it signed in", async () => {
    const { bindings } = hybridEnv();
    const stores = switchableSessionStores();
    const ada = browser(hybridMount("cookie", hybridServicesOver(stores.factory)), bindings);
    const signedIn = await ada.signIn("ada@example.com");
    stores.outage.down = true;

    const guarded = await answerOf(await ada.get(paths.account.factors()));
    const unguarded = await answerOf(await ada.get("/fica"));
    const asked = [...stores.outage.asked];
    stores.outage.down = false;
    const recovered = await answerOf(await ada.get("/fica"));

    expect({ signedIn: signedIn.status, guarded, unguarded, asked, recovered }).toEqual({
      signedIn: 303,
      guarded: { status: 503, location: null, body: "Service Unavailable" },
      unguarded: { status: 503, location: null, body: "Service Unavailable" },
      asked: ["resolve", "resolve"],
      recovered: { status: 200, location: null, body: "ada@example.com" },
    });
  });
});

/** A deployment's four key rings, each its own comma-joined, newest-first variable. */
interface RingEnv extends Record<string, unknown> {
  readonly DB: D1DatabaseLike;
  readonly SESSION_SECRETS: string;
  readonly CSRF_SECRETS: string;
  readonly AUTH_SECRETS: string;
  readonly APP_SECRETS: string;
}

type RingName = "session" | "csrf" | "auth" | "app";

const RING_VARIABLES = { session: "SESSION_SECRETS", csrf: "CSRF_SECRETS", auth: "AUTH_SECRETS", app: "APP_SECRETS" } as const;

const ORIGINAL_SECRETS: Record<RingName, string> = {
  session: "5d6c903ecd93afeb252bd967607746db2fdcb8551be0bd2eb1c13cc48f5ad64d",
  csrf: "16bbbb8bec48e45d6c0c9a55314bdf3afc6067371bce0f0c10c07e1395db59d8",
  auth: "ca1dfb40c29137a0ce6f91119eacab27a497b024825fc2fefcc179a61ede6ba4",
  app: "9d9311636c953143a3974810bb9960e78d0b85a4665b0ba987a57da7fe2dba9a",
};

const ROTATED_IN_SECRETS: Record<RingName, string> = {
  session: "de8c1410a5bfca985d3eb9ef1d723a35db511d765a5974f65aa769fcb613ccf3",
  csrf: "8fe0223c389a0b1eddd1d735f1a273ef783b434ed35a9272272ef0f53abd5f70",
  auth: "721f269bd8e3c55d4d5df4c9e133222594a539bb9c32703b55833d2f05ed39e2",
  app: "68851b07f2eed85cd75ace9f8e6e037361987729f2ada674d923d2c5405a6ef7",
};

const appRingOf = (secrets: string) => importKeyRing(parseKeyRingSecrets(secrets));
const RING_AUTH: AuthOptions<RingEnv> = { ring: (bindings: RingEnv) => importAuthKeyRing(parseKeyRingSecrets(bindings.AUTH_SECRETS)) };
const RECEIPT = { purpose: "receipt", value: "order-42" };

function ringEnv(): RingEnv {
  return {
    DB: fakeAuthD1([]),
    SESSION_SECRETS: ORIGINAL_SECRETS.session,
    CSRF_SECRETS: ORIGINAL_SECRETS.csrf,
    AUTH_SECRETS: ORIGINAL_SECRETS.auth,
    APP_SECRETS: ORIGINAL_SECRETS.app,
  };
}

function rotated(bindings: RingEnv, ring: RingName): RingEnv {
  const variable = RING_VARIABLES[ring];
  return { ...bindings, [variable]: `${ROTATED_IN_SECRETS[ring]},${bindings[variable]}` };
}

/** The auth mount under four independent rings, with a route minting and a route checking a value under each. */
function ringMount(): Forge<RingEnv> {
  const app = new Forge<RingEnv>(nullLogger);
  const ringServices = authRequestServices<RingEnv>({
    auth: RING_AUTH,
    db: (c) => createD1Client(c.env.DB as never),
    notifier: () => ({ send: async () => ok() }),
    defer: () => () => undefined,
    confirmUrl: (_c, token) => token,
  });
  applyMiddlewareChain<RingEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<RingEnv>({ ring: (bindings) => appRingOf(bindings.SESSION_SECRETS), storage: "cookie" }),
    csrf: { ring: (bindings) => appRingOf(bindings.CSRF_SECRETS), subject: "session" },
    guards: [{ paths: ["/submit"], origin: { allowedOrigins: ["http://localhost"] } }],
    contributions: [
      createAuthGuards<RingEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { services: ringServices, signinPath: paths.auth.signin() },
        enrolment: {
          factors: async (c) => (await ringServices(c)).factors,
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.passkeys(),
        },
        origin: { allowedOrigins: ["http://localhost"] },
      }),
    ],
  });
  mapHandler(app, "GET", "/note", (context) => {
    const session = sessionCtx.get(context);
    const note = context.url.searchParams.get("set");
    if (note !== null) session.set("note", note);
    return new Response(String(session.get("note") ?? "none"));
  });
  mapHandler(app, "GET", "/csrf-token", async (context) => new Response(await mintCsrf(context, "/submit")));
  mapHandler(app, "POST", "/submit", () => new Response("submitted"));
  mapHandler(app, "GET", "/auth-token", async (context) => {
    const { keys } = await resolveAuthServices(context, RING_AUTH);
    return new Response(await encodeAuthToken(keys, "identity", "ada", 600_000));
  });
  mapHandler(app, "GET", "/auth-token/check", async (context) => {
    const { keys } = await resolveAuthServices(context, RING_AUTH);
    const decoded = await decodeAuthToken(keys, "identity", context.url.searchParams.get("token") ?? "");
    return new Response(decoded.ok ? "authentic" : decoded.error);
  });
  mapHandler(app, "GET", "/receipt", async (context) => {
    const ring = await appRingOf(getAppContext<RingEnv>(context).env.APP_SECRETS);
    return new Response(await signKeyRingValue(ring, RECEIPT));
  });
  mapHandler(app, "GET", "/receipt/check", async (context) => {
    const ring = await appRingOf(getAppContext<RingEnv>(context).env.APP_SECRETS);
    return new Response(await verifyKeyRingValue(ring, RECEIPT, context.url.searchParams.get("signature") ?? ""));
  });
  return app;
}

interface RingArtifacts {
  readonly cookie: string;
  readonly csrf: string;
  readonly auth: string;
  readonly app: string;
}

/** A session cookie noting `note`, and a CSRF token, an auth token and an app signature, each minted under `bindings`, the token bound to the session `held` names. */
async function mintUnder(app: Forge<RingEnv>, bindings: RingEnv, note: string, held?: string): Promise<RingArtifacts> {
  const noted = await app.request(`/note?set=${note}`, held === undefined ? {} : { headers: { cookie: held } }, bindings);
  const cookie =
    noted.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-session="))
      ?.split(";")[0] ?? "";
  const text = async (path: string) => (await app.request(path, { headers: { cookie: held ?? cookie } }, bindings)).text();
  return { cookie, csrf: await text("/csrf-token"), auth: await text("/auth-token"), app: await text("/receipt") };
}

/** What `bindings` makes of each artifact: the note its session holds, the answer to a submission carrying its token from `csrfCookie`'s session, and each verdict. */
async function verdictsUnder(app: Forge<RingEnv>, bindings: RingEnv, artifacts: RingArtifacts, csrfCookie: string) {
  const text = async (path: string, init: RequestInit = {}) => (await app.request(path, init, bindings)).text();
  const submitted = await app.request(
    "/submit",
    {
      method: "POST",
      headers: { cookie: csrfCookie, origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: artifacts.csrf }).toString(),
    },
    bindings,
  );
  return {
    session: await text("/note", { headers: { cookie: artifacts.cookie } }),
    csrf: `${submitted.status} ${await submitted.text()}`,
    auth: await text(`/auth-token/check?token=${encodeURIComponent(artifacts.auth)}`),
    app: await text(`/receipt/check?signature=${encodeURIComponent(artifacts.app)}`),
  };
}

describe("the session, CSRF, auth and app rings rotate independently through the chain (ROUTING_AND_MIDDLEWARE.md §3h)", () => {
  const REFUSED_UNDER_ORIGINAL: Record<RingName, Partial<Record<RingName, string>>> = {
    session: { session: "none" },
    csrf: { csrf: "403 Forbidden" },
    auth: { auth: "unknown-key" },
    app: { app: "no-key" },
  };

  for (const ring of ["session", "csrf", "auth", "app"] as const) {
    it(`keeps every ring's existing cookie and tokens verifying after the ${ring} ring rotates, and signs under the new ${ring} secret alone`, async () => {
      const app = ringMount();
      const original = ringEnv();
      const rotation = rotated(original, ring);

      const before = await mintUnder(app, original, "before");
      const after = await mintUnder(app, rotation, "after", before.cookie);

      expect({
        beforeUnderRotation: await verdictsUnder(app, rotation, before, before.cookie),
        afterUnderOriginal: await verdictsUnder(app, original, after, before.cookie),
      }).toEqual({
        beforeUnderRotation: { session: "before", csrf: "200 submitted", auth: "authentic", app: "verified" },
        afterUnderOriginal: { session: "after", csrf: "200 submitted", auth: "authentic", app: "verified", ...REFUSED_UNDER_ORIGINAL[ring] },
      });
    });
  }

  it("refuses a CSRF token minted under the session ring's secret, so the policy never reads the session's ring", async () => {
    const app = ringMount();
    const original = ringEnv();
    const sharing = { ...original, CSRF_SECRETS: original.SESSION_SECRETS };

    const minted = await mintUnder(app, sharing, "shared");

    expect(await verdictsUnder(app, original, minted, minted.cookie)).toEqual({
      session: "shared",
      csrf: "403 Forbidden",
      auth: "authentic",
      app: "verified",
    });
  });
});
