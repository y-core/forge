import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { pageShell } from "../../app/shell";
import type { AppContext } from "../../context/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import { csrfProtection } from "../../form/csrf";
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
import type { AuthFactorService, AuthIdentifyingFactorService, AuthSecondFactorKind, AuthSecondFactorService } from "../factors/types";
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
  AuthUser,
  CredentialStore,
  FactorStore,
  NonceStore,
  OtpStateStore,
  UserStore,
} from "../types";
import { authCsrfRefusal } from "./actions";
import { registerApproval } from "./approval";
import { createAuthGuards, requireAuth, resolveAuth } from "./guards";
import { authCtx } from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { registerAccount, registerAdmin, registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthRequestServices, AuthWebOptions } from "./types";
import {
  attrOf,
  attrsOf,
  elementsOf,
  FAKE_APPROVAL_CODE,
  fakeApproval,
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

/** The registry the enrolment guards read, built from this request's bindings like every other store. */
function factorRegistryFor(c: AppContext<MountEnv>) {
  return requestStores(c).factors;
}

/** The per-request services every loader and action runs against. */
function resolveServices(c: AppContext<MountEnv>): AuthRequestServices {
  const stores = requestStores(c);
  return fakeAuthServices({
    users: stores.users,
    sessions: stores.sessions,
    credentials: stores.credentials,
    enrolments: stores.enrolments,
    factors: stores.factors,
  });
}

const options: AuthWebOptions<MountEnv> = { resolveServices, paths, icon: fakeAuthIcon };

/** The whole mount, in the order AUTH_MOUNTING.md §1 gives it. */
function mount(mounted: AuthWebOptions<MountEnv> = options): Forge<MountEnv> {
  const app = new Forge<MountEnv>(nullLogger);
  app.setShell(pageShell({ stylesheet: "/assets/app.css", script: "/assets/auth.js" }));

  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<MountEnv>({ ring: (c) => importKeyRing([c.env.SESSION_SECRET]), kv: (c) => c.env.KV }),
    // `globals`, never `before`: the resolver reads the session, which the chain publishes ahead of
    // this slot and not ahead of that one.
    globals: [
      csrfProtection({
        ring: (c) => importKeyRing([(c as AppContext<MountEnv>).env.CSRF_SECRET]),
        subject: (c) => sessionCtx.getOptional(c)?.id,
        onForbidden: authCsrfRefusal(paths.auth),
      }),
    ],
    guards: createAuthGuards<MountEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: { sessions: (c) => createAuthSessionStore(createD1Client(c.env.DB as never)), signinPath: paths.auth.signin() },
      enrolment: {
        factors: (c) => factorRegistryFor(c),
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
      },
      origin: { allowedOrigins: ["http://localhost"] },
    }),
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

  it("refuses a cross-origin POST to the sign-in endpoint", async () => {
    const res = await mount().request("/auth/signin", { method: "POST", headers: { origin: "https://evil.example.com" } }, env());
    expect(res.status).toBe(403);
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

/** The whole mount again, this time over stores a drive-through can change and a clock it can move; `passkey` offers a passkey beside `stepUp`, which is required where given. */
function flowMount(
  stepUp: AuthSecondFactorKind | null,
  { passkey = false }: { readonly passkey?: boolean } = {},
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

  const flowOptions: AuthWebOptions<MountEnv> = {
    ...options,
    now,
    resolveServices: async () => {
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
    },
  };

  const app = new Forge<MountEnv>(nullLogger);
  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session: createAnonymousSession<MountEnv>({ ring: (c) => importKeyRing([c.env.SESSION_SECRET]), kv: (c) => c.env.KV }),
    globals: [
      csrfProtection({
        ring: (c) => importKeyRing([(c as AppContext<MountEnv>).env.CSRF_SECRET]),
        subject: (c) => sessionCtx.getOptional(c)?.id,
        onForbidden: authCsrfRefusal(paths.auth),
      }),
    ],
    guards: createAuthGuards<MountEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: { sessions: () => sessions, signinPath: paths.auth.signin(), now },
      enrolment: {
        factors: () => factors,
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
        now,
      },
      origin: { allowedOrigins: ["http://localhost"] },
    }),
  });

  registerAuth(app, authMap, flowOptions);
  registerAccount(app, accountMap, flowOptions);
  registerAdmin(app, adminMap, flowOptions);

  app.use(
    "/app/*",
    requireAuth<MountEnv>({
      sessions: () => sessions,
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

/** One visitor keeping their cookie across requests. */
function visitor(mounted: ReturnType<typeof flowMount>, bindings: MountEnv) {
  let cookie = "";

  function keep(res: Response): Response {
    const set = res.headers.getSetCookie().find((value) => value.startsWith("__Host-session="));
    if (set !== undefined) cookie = set.split(";")[0] ?? cookie;
    return res;
  }

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

  return { get, formOf, post, form, contract, ceremony, hx };
}

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
    expect(resent.headers.get("location")).toMatch(/^\/auth\/verify\?next=%2Fapp%2Fdashboard&resent=\d+$/);

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
    expect(page).toContain("Enter the current code from your authenticator app.");
  });
});

describe("a sign-out whose token aged past the guard's hour, driven through the mount", () => {
  const MINUTE = 60_000;
  const DASHBOARD = [200, null] as const;
  const SIGNED_OUT = [302, "/auth/signin?next=%2Fapp%2Fdashboard"] as const;

  let restore: (() => void)[] = [];
  afterEach(() => {
    for (const undo of restore) undo();
    restore = [];
  });

  /** Holds `Date.now`, which `csrfProtection` reads, at the real time it was called; returns the setter. */
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

  it("sends a sign-out at +61 minutes to the confirm page, keeps the session, and signs out from that page's form", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(61 * MINUTE);

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

  it("signs out directly at +59 minutes", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(59 * MINUTE);

    const signedOut = answerOf(await ada.post("/auth/signout", { _csrf: token }));
    const after = answerOf(await ada.get("/app/dashboard"));

    expect({ signedOut, after }).toEqual({ signedOut: [303, "/auth/signin"], after: SIGNED_OUT });
  });

  it("answers an htmx sign-out at +61 minutes with a 204 carrying HX-Redirect to the confirm page, and keeps the session", async () => {
    const ada = await signedInAda();
    const advance = holdClock();
    const { token } = await ada.formOf("/auth/signout");
    advance(61 * MINUTE);

    const res = await ada.post("/auth/signout", { _csrf: token }, { "HX-Request": "true" });
    const refused = { status: res.status, location: res.headers.get("location"), hxRedirect: res.headers.get("hx-redirect") };
    const kept = answerOf(await ada.get("/app/dashboard"));

    expect({ refused, kept }).toEqual({ refused: { status: 204, location: null, hxRedirect: "/auth/signout" }, kept: DASHBOARD });
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
    advance(61 * MINUTE);

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

/** The services of a deployment whose only factor is the emailed code, which any address answers with `CODE`. */
function hybridServices(c: AppContext<MountEnv>): AuthRequestServices {
  const db = createD1Client(c.env.DB as never);
  const users = createUserStore(db);
  const enrolments = createFactorStore(db);
  return fakeAuthServices({
    users,
    sessions: createAuthSessionStore(db),
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
}

/** One session middleware for every path, an anonymous funnel page at `/fica` outside every auth group, and the approval prompt. */
function hybridMount(storage: "cookie" | "kv"): Forge<MountEnv> {
  const app = new Forge<MountEnv>(nullLogger);
  const ring = (c: AppContext<MountEnv>) => importKeyRing([c.env.SESSION_SECRET]);
  const sessions = (c: AppContext<MountEnv>) => createAuthSessionStore(createD1Client(c.env.DB as never));
  const hybridOptions: AuthWebOptions<MountEnv> = { resolveServices: hybridServices, paths, icon: fakeAuthIcon };
  applyMiddlewareChain<MountEnv>(app, {
    securityHeaders: { styleSrc: ["'self'"], scriptSrc: ["'self'"] },
    session:
      storage === "cookie"
        ? createAnonymousSession<MountEnv>({ ring, storage: "cookie" })
        : createAnonymousSession<MountEnv>({ ring, kv: (c) => c.env.KV }),
    globals: [
      csrfProtection({
        ring: (c) => importKeyRing([(c as AppContext<MountEnv>).env.CSRF_SECRET]),
        subject: (c) => sessionCtx.getOptional(c)?.id,
        onForbidden: authCsrfRefusal(paths.auth),
      }),
      resolveAuth<MountEnv>({ sessions }),
    ],
    guards: createAuthGuards<MountEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: { sessions, signinPath: paths.auth.signin() },
      enrolment: {
        factors: (c) => hybridServices(c).factors,
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
      },
      origin: { allowedOrigins: ["http://localhost"] },
    }),
  });
  registerAuth(app, authMap, hybridOptions);
  registerAccount(app, accountMap, hybridOptions);
  registerAdmin(app, adminMap, hybridOptions);
  registerApproval(app, fakeApproval({ origin: { allowedOrigins: ["http://localhost"] } }));
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
  const bindings: MountEnv = { ...env(), DB: db, KV: counted.kv };
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
