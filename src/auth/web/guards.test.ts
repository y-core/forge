import { describe, expect, it, spyOn } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";
import { get, route } from "@remix-run/fetch-router/routes";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import type { MiddlewareContribution } from "../../app/types";
import { refuseHookCtx } from "../../context/refusal";
import { matchedRoutePattern } from "../../context/route-pattern";
import type { AppContext, Refusal, RefuseHook } from "../../context/types";
import { getAppContext } from "../../context/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import type { KeyRing } from "../../crypto/keyring/types";
import { bytesToHex } from "../../crypto/primitives/mod";
import { requestLog } from "../../logging/request-logger";
import { ok } from "../../result/result";
import { originProtection } from "../../security/cop";
import { routeKeySuffix } from "../../security/rate-limit";
import { createRefusalAnswer } from "../../security/refusal";
import { requestIdCtx } from "../../security/request-id";
import type { RateLimit, RateLimitOptions } from "../../security/types";
import { createAnonymousSession } from "../../session/anonymous";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { createD1Client } from "../../storage/db/client";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { createTestContext, nullLogger } from "../../testing/context";
import { captureLogs } from "../../testing/logs";
import { mapHandler } from "../../testing/route";
import { AUTH_FRESH_STEP_UP_MS, AUTH_SESSION_IDLE_MS, AUTH_SESSION_MAX_MS, AUTH_STEP_UP_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import type { AuthFactorRegistry, AuthFactorResolution } from "../factors/types";
import { importAuthKeyRing } from "../keys/ring";
import { squashSql } from "../stores/events.fixture";
import { createFactorStore } from "../stores/factors";
import { createAuthSessionStore } from "../stores/sessions";
import { formatAccessToken } from "../tokens/codec";
import { createAccessTokenService } from "../tokens/service";
import type { AccessTokenStore, AuthAccessToken, AuthFactorKind, AuthSessionRecord, AuthSessionStore, AuthUser } from "../types";
import {
  accessTokenCtx,
  approvalCode,
  authFreshStepUpWindow,
  createAuthGuards,
  requireAdmin,
  requireApproval,
  requireAuth,
  requireBearer,
  requireEnrolment,
  requireFreshStepUp,
  requirePendingEnrolment,
  resolveAuth,
  signApprovalCode,
  stepUpHolds,
} from "./guards";
import {
  APPROVAL_CODE_SESSION_KEY,
  APPROVAL_SESSION_KEY,
  authCtx,
  AUTH_SESSION_TOKEN_KEY,
  clearAuthSession,
  establishAuthSession,
  markApproval,
  markAuthStepUp,
  NO_SESSION,
} from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import { authRequestServices } from "./services";
import type { AuthGuardChainOptions, AuthIdentity, AuthRequestServicesResolver } from "./types";
import {
  approvedSession,
  FAKE_APPROVAL_CODE,
  FAKE_RATE_LIMITS,
  fakeApproval,
  fakeAuthServicesResolver,
  fakeAuthSessionStore,
  fakeFactorRegistry,
  fakeFactorStore,
  fakeLimiterContribution,
  fakeSessionCookie,
  fakeWebRing,
} from "./web.fixture";

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");
const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

function fakeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ada@example.com",
    emailKey: "ada@example.com",
    emailVerifiedAt: 1,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** The session rows every seeded session is created in and every `fakeSessions` store resolves from. */
const guardSessionRows = new Map<string, AuthSessionRecord & { readonly userId: string }>();

const guardSeeder = fakeAuthSessionStore([], guardSessionRows);

function fakeSessions(users: readonly AuthUser[]): Pick<AuthSessionStore, "resolve"> {
  return fakeAuthSessionStore(users, guardSessionRows);
}

const unavailableSessions: Pick<AuthSessionStore, "resolve"> = { resolve: async () => ({ ok: false, error: new Error("db down") as never }) };

type FakeRegistry = Pick<AuthFactorRegistry, "resolve">;

function fakeFactors(resolution: AuthFactorResolution): FakeRegistry {
  return { resolve: async () => ok(resolution) };
}

const unavailableFactors: FakeRegistry = { resolve: async () => ({ ok: false, error: new Error("kv down") as never }) };

/** A registry stub that answers one verdict and keeps every user id `resolve` was handed. */
function recordingFactors(resolution: AuthFactorResolution): FakeRegistry & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (userId) => {
      calls.push(userId);
      return ok(resolution);
    },
  };
}

/** The services resolver the guards take, its session store resolving through `sessions`. */
function servicesOver(sessions: Pick<AuthSessionStore, "resolve">): AuthRequestServicesResolver {
  return fakeAuthServicesResolver({ sessions: { ...fakeAuthSessionStore([]), resolve: (tokenHash, at) => sessions.resolve(tokenHash, at) } });
}

/** One already-built dependency as the per-request resolver the guards take. */
function perRequest<T>(value: T): () => T {
  return () => value;
}

const satisfied = perRequest(fakeFactors({ status: "satisfied" }));

const stepUpOwed = perRequest(fakeFactors({ status: "step-up-required", kinds: ["totp-app"] }));

const enrolment = { enrolmentPaths: authEnrolmentPaths(paths.auth), stepUpPath: paths.auth.verify.show(), settledPath: paths.account.passkeys() };

// `satisfied` by default, so a test about the identity says nothing about the factor policy: the
// tests that are about an owed step-up pass their own registry.
function guardOptions(sessions: Pick<AuthSessionStore, "resolve">, factors: () => FakeRegistry = satisfied) {
  return { services: servicesOver(sessions), signinPath: paths.auth.signin(), factors, stepUpPath: paths.auth.verify.show() };
}

interface SessionSeed {
  readonly userId?: string;
  readonly signedInAt?: number;
  readonly stepUpAt?: number;
  readonly stepUpKind?: AuthFactorKind;
}

/** A `Forge` app with session middleware, a seeded session, `guards`, and one handler per guarded path. */
function guardedApp(guards: readonly Parameters<Forge["use"]>[1][], seed: SessionSeed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
  app.use("*", async (context, next) => {
    const session = sessionCtx.get(context);
    if (seed.userId !== undefined) {
      const signedInAt = seed.signedInAt ?? Date.now();
      await establishAuthSession(session, guardSeeder, seed.userId, signedInAt, signedInAt, { kind: "email-otp" });
      if (seed.stepUpAt !== undefined) await markAuthStepUp(session, guardSeeder, seed.stepUpAt, seed.stepUpAt, seed.stepUpKind ?? "email-otp");
    }
    return next();
  });
  for (const guard of guards) app.use("*", guard);
  mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));
  mapHandler(app, "POST", "/account/passkeys", () => new Response("enrolled"));
  mapHandler(app, "POST", "/auth/enrol/passkey/register/finish", () => new Response("finished"));
  mapHandler(app, "GET", "/admin/users", () => new Response("users"));
  mapHandler(app, "GET", "/auth/enrol/passkey", () => new Response("enrol"));
  return app;
}

function publishRefuseHook(hook: RefuseHook): Parameters<Forge["use"]>[1] {
  return (context, next) => {
    refuseHookCtx.set(context, hook);
    return next();
  };
}

const locationOf = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

const hxAnswerOf = (res: Response) => ({ ...locationOf(res), redirect: res.headers.get("hx-redirect") });

/** The session values the response's own `Set-Cookie` carries, read back through the cookie that signed them. */
async function sessionOf(res: Response): Promise<Record<string, unknown>> {
  const pair =
    res.headers
      .getSetCookie()
      .find((header) => header.startsWith("__session="))
      ?.split(";")[0] ?? "";
  const decoded = JSON.parse((await fakeSessionCookie.parse(pair)) ?? "") as { d: [Record<string, unknown>, unknown] };
  return decoded.d[0];
}

describe("requireAuth", () => {
  it("redirects an anonymous request to the sign-in path with the return-to it came from", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/account/passkeys?tab=all");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/signin?next=%2Faccount%2Fpasskeys%3Ftab%3Dall");
  });

  it("records no return-to off a mutation, and answers 303 so the method is not replayed against the sign-in page", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/account/passkeys?tab=all", { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("navigates an anonymous htmx request to sign-in with HX-Redirect, which fetch cannot follow into the page", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/account/passkeys", { method: "DELETE", headers: { "HX-Request": "true" } });
    expect({ ...locationOf(res), redirect: res.headers.get("hx-redirect") }).toEqual({ status: 204, location: null, redirect: "/auth/signin" });
  });

  it("records the page an htmx GET was sent from as the return-to, not the fragment endpoint it asked", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/admin/users", {
      headers: { "HX-Request": "true", "HX-Current-URL": "http://localhost/account/passkeys?tab=all" },
    });
    expect(hxAnswerOf(res)).toEqual({ status: 204, location: null, redirect: "/auth/signin?next=%2Faccount%2Fpasskeys%3Ftab%3Dall" });
  });

  it("records the page an htmx mutation was sent from, which the visitor can arrive back at by GET", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/account/passkeys", {
      method: "POST",
      headers: { "HX-Request": "true", "HX-Current-URL": "http://localhost/admin/users" },
    });
    expect(hxAnswerOf(res)).toEqual({ status: 204, location: null, redirect: "/auth/signin?next=%2Fadmin%2Fusers" });
  });

  it("records no return-to off an htmx request whose current URL is missing, cross-origin or unparseable", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([])))]);
    const currents = [undefined, "https://evil.example/account/passkeys", "not a url"];
    const redirects = await Promise.all(
      currents.map(async (current) => {
        const headers: Record<string, string> = { "HX-Request": "true", ...(current === undefined ? {} : { "HX-Current-URL": current }) };
        return (await app.request("/account/passkeys", { headers })).headers.get("hx-redirect");
      }),
    );
    expect(redirects).toEqual(["/auth/signin", "/auth/signin", "/auth/signin"]);
  });

  it("refuses a `json` group with a body rather than a sign-in redirect a controller cannot read", async () => {
    const app = guardedApp([requireAuth({ ...guardOptions(fakeSessions([])), medium: "json" })]);
    const res = await app.request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "Not signed in." });
  });

  it("establishes the identity and continues for a signed-in user", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([fakeAuthUser()])))], { userId: "u1" });
    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  // The harness re-seeds the identity key on every request, so a second request would prove nothing:
  // the cookie this response sets is the whole record of what the denial did to the session.
  it("denies a deactivated user and sends back a session cookie carrying no identity", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeSessions([fakeAuthUser({ deactivatedAt: 99 })])))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(302);
    expect(await sessionOf(res)).toEqual({});
  });

  it("answers 503 when the session store is unavailable, keeping the session token so a transient outage signs nobody out", async () => {
    const app = guardedApp([requireAuth(guardOptions(unavailableSessions))], { userId: "u1", signedInAt: Date.now() });
    const res = await app.request("/account/passkeys");

    expect({ status: res.status, body: await res.text(), session: Object.keys(await sessionOf(res)) }).toEqual({
      status: 503,
      body: "Service Unavailable",
      session: [AUTH_SESSION_TOKEN_KEY],
    });
  });

  it("sends a session unused for the whole idle bound to sign in, and admits one used inside it", async () => {
    const users = fakeSessions([fakeAuthUser()]);
    const idle = guardedApp([requireAuth(guardOptions(users))], { userId: "u1", signedInAt: Date.now() - AUTH_SESSION_IDLE_MS - 1 });
    const active = guardedApp([requireAuth(guardOptions(users))], { userId: "u1", signedInAt: Date.now() - AUTH_SESSION_IDLE_MS + 60_000 });

    expect(locationOf(await idle.request("/account/passkeys"))).toEqual({ status: 302, location: "/auth/signin?next=%2Faccount%2Fpasskeys" });
    expect(await (await active.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("throws when no session middleware ran, rather than reading as a correct denial", async () => {
    const guard = requireAuth(guardOptions(fakeSessions([])));
    const context = new RequestContext(new Request("http://localhost/account/passkeys"));
    await expect(guard(context, async () => new Response("ok"))).rejects.toThrow(NO_SESSION);
  });
});

// `establishAuthSession` runs before the step-up is proved, so until `requireAuth` asks, a session
// that signed in and skipped `/verify` carries a full identity everywhere the enrolment guards are absent.
describe("requireAuth — the second factor a session still owes", () => {
  const users = fakeSessions([fakeAuthUser()]);

  it("sends a session owing a required second factor to the step-up page rather than admitting it", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, stepUpOwed))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("admits the same session once it has completed the step-up", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, stepUpOwed))], { userId: "u1", stepUpAt: Date.now() });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  // The mark is written by the request's own clock, so reading it against the wall clock makes an
  // injected clock's mark stale the instant it is written.
  it("measures the mark against the clock it was given, not the wall clock", async () => {
    const injected = Date.now() + 86_400_000;
    const options = { ...guardOptions(users, stepUpOwed), stepUpMaxAgeMs: 30_000, now: () => injected };
    const app = guardedApp([requireAuth(options)], { userId: "u1", signedInAt: injected, stepUpAt: injected });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("demands it again once the completed step-up is older than the configured lifetime", async () => {
    const options = { ...guardOptions(users, stepUpOwed), stepUpMaxAgeMs: 30_000 };
    const app = guardedApp([requireAuth(options)], { userId: "u1", stepUpAt: Date.now() - 60_000 });

    expect((await app.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });

  it("demands it again past 24 hours when no lifetime is configured, and admits a moment before", async () => {
    const at = Date.now();
    const options = { ...guardOptions(users, stepUpOwed), now: () => at };
    const stale = guardedApp([requireAuth(options)], { userId: "u1", stepUpAt: at - 86_400_000 - 1 });
    const held = guardedApp([requireAuth(options)], { userId: "u1", stepUpAt: at - 86_400_000 + 1 });

    expect((await stale.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
    expect(await (await held.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("lets a completed step-up last the session when the lifetime is `null`", async () => {
    const options = { ...guardOptions(users, stepUpOwed), stepUpMaxAgeMs: null };
    const app = guardedApp([requireAuth(options)], { userId: "u1", stepUpAt: Date.now() - AUTH_STEP_UP_MAX_MS - 60_000 });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("answers a step-up by every kind alike, the kind owed or not, admitting each inside the lifetime and refusing each past it", async () => {
    const at = Date.now();
    const options = { ...guardOptions(users, stepUpOwed), stepUpMaxAgeMs: 60_000, now: () => at };
    const kinds = ["email-otp", "totp-app", "passkey", "recovery-code"] as const;
    const answers = async (stepUpAt: number) =>
      Promise.all(
        kinds.map(async (stepUpKind) =>
          locationOf(await guardedApp([requireAuth(options)], { userId: "u1", stepUpAt, stepUpKind }).request("/account/passkeys")),
        ),
      );
    expect({ held: await answers(at - 59_000), stale: await answers(at - 61_000) }).toEqual({
      held: kinds.map(() => ({ status: 200, location: null })),
      stale: kinds.map(() => ({ status: 303, location: "/auth/verify" })),
    });
  });

  it("admits a session the policy demands no step-up of, which is every account without a second factor", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, satisfied))], { userId: "u1" });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("admits a session owing an enrolment, which is a page to visit and not a refusal", async () => {
    const owing = perRequest(fakeFactors({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }));
    const app = guardedApp([requireAuth(guardOptions(users, owing))], { userId: "u1" });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  const enrolmentBesideHeld = perRequest(fakeFactors({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["recovery-code"] }));

  it("sends an owed enrolment to verify while the account holds a confirmed factor this session has not proved", async () => {
    const res = await guardedApp([requireAuth(guardOptions(users, enrolmentBesideHeld))], { userId: "u1" }).request("/account/passkeys");

    expect(locationOf(res)).toEqual({ status: 303, location: "/auth/verify" });
  });

  it("navigates an htmx request owing a step-up to verify with HX-Redirect, and a plain one with 303", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, stepUpOwed))], { userId: "u1" });
    const answers = [
      hxAnswerOf(await app.request("/account/passkeys", { headers: { "HX-Request": "true" } })),
      hxAnswerOf(await app.request("/account/passkeys")),
    ];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/verify" },
      { status: 303, location: "/auth/verify", redirect: null },
    ]);
  });

  it("admits that session once its step-up mark holds", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, enrolmentBesideHeld))], { userId: "u1", stepUpAt: Date.now() });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  // Otherwise the endpoints that satisfy a step-up are the ones a session owing it cannot reach.
  it("admits a group declared `clearsStepUp`, which is how `/verify` stays reachable", async () => {
    const app = guardedApp([requireAuth({ ...guardOptions(users, stepUpOwed), clearsStepUp: true })], { userId: "u1" });

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("refuses a `json` group with a body rather than a redirect a controller cannot read", async () => {
    const app = guardedApp([requireAuth({ ...guardOptions(users, stepUpOwed), medium: "json" })], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This account owes a step-up verification." });
  });

  it("refuses rather than admits when the registry cannot read its store", async () => {
    const app = guardedApp([requireAuth(guardOptions(users, perRequest(unavailableFactors)))], { userId: "u1" });

    expect((await app.request("/account/passkeys")).status).toBe(503);
  });

  it("resolves the demand once, so a later enrolment guard on the same request costs no second read", async () => {
    const factors = recordingFactors({ status: "step-up-required", kinds: ["totp-app"] });
    const app = guardedApp(
      [requireAuth(guardOptions(users, perRequest(factors))), requireEnrolment({ factors: perRequest(factors), ...enrolment })],
      { userId: "u1", stepUpAt: Date.now() },
    );

    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
    expect(factors.calls).toHaveLength(1);
  });
});

const SESSION_READ =
  "SELECT auth_users.id, auth_users.email, auth_users.is_admin, auth_sessions.id AS session_id, auth_sessions.signed_in_at, auth_sessions.expires_at, auth_sessions.step_up_at, auth_sessions.step_up_kind, auth_sessions.last_seen_at, auth_sessions.device FROM auth_sessions JOIN auth_users ON auth_users.id = auth_sessions.user_id WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND auth_users.deactivated_at IS NULL AND auth_sessions.last_seen_at > ? LIMIT 1";
const SESSION_TOUCH = "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at <= ?";
const CONFIRMED_KINDS_READ =
  "SELECT kind FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL";

type StatementChain = (deps: {
  readonly sessions: AuthSessionStore;
  readonly factors: AuthFactorRegistry;
  readonly now: () => number;
}) => Parameters<Forge["use"]>[1][];

const underRequireAuth: StatementChain = ({ sessions, factors, now }) => [requireAuth({ ...guardOptions(sessions, perRequest(factors)), now })];

/** The statements one request issues `elapsedMs` after sign-in under `chain`, over the real stores and a registry offering `totp-app`; `signedIn: false` sends it anonymous. */
async function statementsOfSignedInRequest(
  elapsedMs: number,
  chain: StatementChain = underRequireAuth,
  request: { readonly method?: "GET" | "POST"; readonly signedIn?: boolean } = {},
): Promise<{ readonly status: number; readonly statements: string[] }> {
  const userId = "018f0000-0000-7000-8000-000000000001";
  const db = fakeAuthD1([{ id: userId, email: "ada@example.test", isAdmin: true, factors: [{ kind: "totp-app" }] }]);
  const client = createD1Client(db as never);
  const sessions = createAuthSessionStore(client);
  const factors = fakeFactorRegistry(["totp-app"], [], createFactorStore(client));
  const signedInAt = 1_000_000;
  let issuedBefore = 0;
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
  app.use("*", async (context, next) => {
    if (request.signedIn !== false) {
      await establishAuthSession(sessionCtx.get(context), sessions, userId, signedInAt, signedInAt, { kind: "email-otp", steppedUp: true });
    }
    issuedBefore = db.calls.length;
    return next();
  });
  for (const guard of chain({ sessions, factors, now: () => signedInAt + elapsedMs })) app.use("*", guard);
  mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));
  mapHandler(app, "POST", "/account/passkeys", () => new Response("enrolled"));
  const res = await app.request("/account/passkeys", { method: request.method ?? "GET" });
  return { status: res.status, statements: db.calls.slice(issuedBefore).map((call) => squashSql(call.sql)) };
}

describe("requireAuth — the statements one signed-in request issues", () => {
  it("reads the session joined to its owner and the owner's confirmed factor kinds, touching the row only once the interval has passed", async () => {
    const touchIntervalMs = AUTH_SESSION_IDLE_MS / 12;
    const [inside, past] = [await statementsOfSignedInRequest(60_000), await statementsOfSignedInRequest(touchIntervalMs)];
    expect({ inside, past }).toEqual({
      inside: { status: 200, statements: [SESSION_READ, CONFIRMED_KINDS_READ] },
      past: { status: 200, statements: [SESSION_READ, SESSION_TOUCH, CONFIRMED_KINDS_READ] },
    });
  });

  it("reads nothing more for `requireEnrolment`, `requireFreshStepUp` and `requireAdmin` stacked behind `requireAuth`", async () => {
    const stacked: StatementChain = (deps) => [
      ...underRequireAuth(deps),
      requireEnrolment({ factors: perRequest(deps.factors), ...enrolment, now: deps.now }),
      requireFreshStepUp({ factors: perRequest(deps.factors), ...enrolment, now: deps.now }),
      requireAdmin(),
    ];
    expect(await statementsOfSignedInRequest(60_000, stacked, { method: "POST" })).toEqual({
      status: 200,
      statements: [SESSION_READ, CONFIRMED_KINDS_READ],
    });
  });

  it("reads only the session under `resolveAuth`, and nothing at all for an anonymous request", async () => {
    const resolving: StatementChain = ({ sessions, now }) => [resolveAuth({ services: servicesOver(sessions), now })];
    expect({
      resolved: await statementsOfSignedInRequest(60_000, resolving),
      anonymous: await statementsOfSignedInRequest(60_000, resolving, { signedIn: false }),
      anonymousRequired: (await statementsOfSignedInRequest(60_000, underRequireAuth, { signedIn: false })).statements,
    }).toEqual({ resolved: { status: 200, statements: [SESSION_READ] }, anonymous: { status: 200, statements: [] }, anonymousRequired: [] });
  });
});

/** A session store that answers as `fakeSessions` does and records the owner of every row it was asked for. */
function countingSessions(users: readonly AuthUser[]): Pick<AuthSessionStore, "resolve"> & { readonly calls: string[] } {
  const calls: string[] = [];
  const store = fakeSessions(users);
  return {
    calls,
    resolve: async (tokenHash, at) => {
      calls.push(guardSessionRows.get(bytesToHex(tokenHash))?.userId ?? "");
      return store.resolve(tokenHash, at);
    },
  };
}

describe("resolveAuth", () => {
  it("admits an anonymous request unchanged rather than refusing it", async () => {
    const app = guardedApp([resolveAuth(guardOptions(fakeSessions([])))]);
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("passkeys");
  });

  it("answers 503 when the session store is unavailable, rather than admitting a signed-in visitor as anonymous", async () => {
    const app = guardedApp([resolveAuth(guardOptions(unavailableSessions))], { userId: "u1", signedInAt: Date.now() });
    const res = await app.request("/account/passkeys");

    expect({ status: res.status, body: await res.text(), session: Object.keys(await sessionOf(res)) }).toEqual({
      status: 503,
      body: "Service Unavailable",
      session: [AUTH_SESSION_TOKEN_KEY],
    });
  });

  it("reads no user store for an anonymous request, whose session names nobody to look up", async () => {
    const users = countingSessions([fakeAuthUser()]);
    const app = guardedApp([resolveAuth(guardOptions(users))]);
    await app.request("/account/passkeys");

    expect(users.calls).toEqual([]);
  });

  for (const [name, build] of [
    ["resolveAuth", resolveAuth],
    ["requireAuth", requireAuth],
  ] as const) {
    it(`never builds the session store for an anonymous request under \`${name}\`, and builds it once for a signed-in one`, async () => {
      const built: string[] = [];
      const options = {
        ...guardOptions(fakeSessions([fakeAuthUser()])),
        services: Object.assign(fakeAuthServicesResolver(), {
          sessions: async () => {
            built.push("sessions");
            return { ...fakeAuthSessionStore([]), ...fakeSessions([fakeAuthUser()]) };
          },
        }),
      };
      await guardedApp([build(options)]).request("/account/passkeys");
      const anonymous = [...built];
      await guardedApp([build(options)], { userId: "u1" }).request("/account/passkeys");
      expect({ anonymous, signedIn: built.length }).toEqual({ anonymous: [], signedIn: 1 });
    });
  }

  it("establishes the identity, so a guard ordered after it authorises without its own lookup", async () => {
    const app = guardedApp([resolveAuth(guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })]))), requireAdmin()], { userId: "u1" });
    expect(await (await app.request("/admin/users")).text()).toBe("users");
  });

  // The whole point of the reuse: a globally mounted `resolveAuth` must not double every guarded
  // route's cost, and one request asking the same question twice is what that would look like.
  it("leaves a following `requireAuth` nothing to look up, so the store is read once per request", async () => {
    const users = countingSessions([fakeAuthUser()]);
    const app = guardedApp([resolveAuth(guardOptions(users)), requireAuth(guardOptions(users))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(await res.text()).toBe("passkeys");
    expect(users.calls).toEqual(["u1"]);
  });

  it("still lets `requireAuth` resolve for itself when it runs alone", async () => {
    const users = countingSessions([fakeAuthUser()]);
    const app = guardedApp([requireAuth(guardOptions(users))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(await res.text()).toBe("passkeys");
    expect(users.calls).toEqual(["u1"]);
  });

  // `resolveAuth` clears the session's auth keys on a refusal, so the identity key is gone by the
  // time `requireAuth` looks — it refuses on an anonymous session rather than on a second lookup.
  it("costs a following `requireAuth` no second lookup when it refuses the identity", async () => {
    const users = countingSessions([fakeAuthUser({ deactivatedAt: 99 })]);
    const app = guardedApp([resolveAuth(guardOptions(users)), requireAuth(guardOptions(users))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(302);
    expect(users.calls).toEqual(["u1"]);
  });

  it("throws when no session middleware ran, rather than reading as an anonymous request", async () => {
    const guard = resolveAuth(guardOptions(fakeSessions([])));
    const context = new RequestContext(new Request("http://localhost/account/passkeys"));
    await expect(guard(context, async () => new Response("ok"))).rejects.toThrow(NO_SESSION);
  });
});

describe("requireAdmin", () => {
  const member = () => requireAuth(guardOptions(fakeSessions([fakeAuthUser()])));
  const administrator = () => requireAuth(guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })])));
  const answerOf = async (res: Response) => ({ status: res.status, type: res.headers.get("content-type"), body: await res.text() });

  it("refuses a signed-in non-administrator with a plain-text 403 when no hook is passed or published", async () => {
    const app = guardedApp([member(), requireAdmin()], { userId: "u1" });
    const res = await app.request("/admin/users");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
  });

  it("answers a signed-in non-administrator with the `onRefuse` response, handed the request's app context and the admin refusal", async () => {
    const refusals: Refusal[] = [];
    const onRefuse = (c: { readonly url: URL }, refusal: Refusal) => {
      refusals.push(refusal);
      return new Response(`page for ${c.url.pathname}`, { status: 403, headers: { "content-type": "text/html" } });
    };
    const app = guardedApp([member(), requireAdmin({ onRefuse })], { userId: "u1" });
    expect({ answer: await answerOf(await app.request("/admin/users")), refusals }).toEqual({
      answer: { status: 403, type: "text/html", body: "page for /admin/users" },
      refusals: [{ guard: "admin", status: 403 }],
    });
  });

  it("answers with what an async `onRefuse` resolves to", async () => {
    const app = guardedApp([member(), requireAdmin({ onRefuse: async () => new Response("later", { status: 451 }) })], { userId: "u1" });
    const res = await app.request("/admin/users");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 451, body: "later" });
  });

  it("answers through the hook published on the request when given none of its own", async () => {
    const refusals: Refusal[] = [];
    const app = guardedApp(
      [publishRefuseHook((_c, refusal) => (refusals.push(refusal), new Response("chain answer", { status: 403 }))), member(), requireAdmin()],
      { userId: "u1" },
    );
    const res = await app.request("/admin/users");
    expect({ status: res.status, body: await res.text(), refusals }).toEqual({
      status: 403,
      body: "chain answer",
      refusals: [{ guard: "admin", status: 403 }],
    });
  });

  it("answers through its own `onRefuse` rather than the hook published on the request", async () => {
    const published: Refusal[] = [];
    const app = guardedApp(
      [
        publishRefuseHook((_c, refusal) => (published.push(refusal), new Response("chain answer", { status: 403 }))),
        member(),
        requireAdmin({ onRefuse: () => new Response("own answer", { status: 403 }) }),
      ],
      { userId: "u1" },
    );
    const res = await app.request("/admin/users");
    expect({ status: res.status, body: await res.text(), published }).toEqual({ status: 403, body: "own answer", published: [] });
  });

  it("logs one security.admin.refused warning naming the route and request id, and no session, token or address", async () => {
    const capture = captureLogs();
    const app = guardedApp(
      [
        (context, next) => {
          requestLog.set(context, capture.logger);
          requestIdCtx.set(context, "req-admin-1");
          return next();
        },
        member(),
        requireAdmin(),
      ],
      { userId: "u1" },
    );
    const res = await app.request("/admin/users", { headers: { "CF-Connecting-IP": "203.0.113.9" } });
    expect({ status: res.status, logged: capture.records.map(({ level, message, data }) => ({ level, message, data })) }).toEqual({
      status: 403,
      logged: [
        {
          level: "warn",
          message: "security.admin.refused",
          data: { source: "security", guard: "admin", status: 403, reason: null, routePattern: "/admin/users", requestId: "req-admin-1" },
        },
      ],
    });
  });

  it("admits an administrator", async () => {
    const app = guardedApp([administrator(), requireAdmin()], { userId: "u1" });
    expect(await (await app.request("/admin/users")).text()).toBe("users");
  });

  it("admits an administrator without consulting the `onRefuse` it was passed, logging nothing", async () => {
    const consulted: string[] = [];
    const capture = captureLogs();
    const onRefuse = (c: { readonly url: URL }) => {
      consulted.push(c.url.pathname);
      return new Response("refused", { status: 403 });
    };
    const app = guardedApp(
      [
        (context, next) => {
          requestLog.set(context, capture.logger);
          return next();
        },
        administrator(),
        requireAdmin({ onRefuse }),
      ],
      { userId: "u1" },
    );
    expect({ body: await (await app.request("/admin/users")).text(), consulted, logged: capture.records }).toEqual({
      body: "users",
      consulted: [],
      logged: [],
    });
  });

  it("throws when no identity was established, rather than admitting the request", () => {
    const context = new RequestContext(new Request("http://localhost/admin/users"));
    expect(() => requireAdmin()(context, async () => new Response("ok"))).toThrow(
      "auth/web guard: no identity on this request — `requireAuth` must run before `requireAdmin`, which reads the identity it establishes.",
    );
  });

  it("throws on a missing identity before consulting `onRefuse`", () => {
    const consulted: string[] = [];
    const onRefuse = () => {
      consulted.push("called");
      return new Response("refused", { status: 403 });
    };
    const context = new RequestContext(new Request("http://localhost/admin/users"));
    expect(() => requireAdmin({ onRefuse })(context, async () => new Response("ok"))).toThrow(
      "auth/web guard: no identity on this request — `requireAuth` must run before `requireAdmin`, which reads the identity it establishes.",
    );
    expect(consulted).toEqual([]);
  });
});

/** A protected page guarded by `requireAuth` then `requireEnrolment`, under one factor verdict. */
function protectedApp(resolution: AuthFactorResolution, seed: SessionSeed = {}, maxAgeMs?: number | null) {
  const window = maxAgeMs === undefined ? {} : { stepUpMaxAgeMs: maxAgeMs };
  const options = { factors: perRequest(fakeFactors(resolution)), ...enrolment, ...window };
  // One registry and one window for both guards, as `createAuthGuards` wires them: the demand is
  // resolved once and memoised, so a second registry here would answer for neither guard predictably.
  return guardedApp([requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), options.factors), ...window }), requireEnrolment(options)], {
    userId: "u1",
    ...seed,
  });
}

describe("requireEnrolment", () => {
  it("sends an enrolment owed in two kinds to the first owed kind's page, since each must be enrolled and there is nothing to choose", async () => {
    const locationFor = async (kinds: readonly AuthFactorKind[]) =>
      (await protectedApp({ status: "enrolment-required", kinds, stepUpKinds: [] }).request("/account/passkeys")).headers.get("location");
    expect([await locationFor(["totp-app", "passkey"]), await locationFor(["passkey", "totp-app"])]).toEqual([
      "/auth/enrol/totp",
      "/auth/enrol/passkey",
    ]);
  });

  it("redirects to the enrolment page rather than refusing, because owing an enrolment is a success", async () => {
    const res = await protectedApp({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }).request("/account/passkeys");
    expect(res.status).toBe(303);
    // The kind that is owed, and not a fixed page: a passkey page cannot clear an authenticator-app enrolment.
    expect(res.headers.get("location")).toBe("/auth/enrol/totp");
  });

  it("sends an owed enrolment to verify first while the account holds a confirmed factor, and to the enrol page once it is proved", async () => {
    const owed: AuthFactorResolution = { status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["recovery-code"] };
    const locations = [
      (await protectedApp(owed).request("/account/passkeys")).headers.get("location"),
      (await protectedApp(owed, { stepUpAt: Date.now() }).request("/account/passkeys")).headers.get("location"),
    ];
    expect(locations).toEqual(["/auth/verify", "/auth/enrol/totp"]);
  });

  it("redirects a step-up demand to the verify page", async () => {
    const res = await protectedApp({ status: "step-up-required", kinds: ["email-otp"] }).request("/account/passkeys");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  // The only wiring that reaches this guard's own step-up branch: with `requireAuth` judging the
  // same demand, it refuses first and `requireEnrolment` never sees a step-up.
  it("answers its own step-up redirect with 303, behind a `clearsStepUp` require-auth", async () => {
    const factors = perRequest(fakeFactors({ status: "step-up-required", kinds: ["totp-app"] }));
    const app = guardedApp(
      [requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), factors), clearsStepUp: true }), requireEnrolment({ factors, ...enrolment })],
      { userId: "u1" },
    );
    const res = await app.request("/account/passkeys");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("continues when the demand is satisfied", async () => {
    expect(await (await protectedApp({ status: "satisfied" }).request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("refuses rather than redirects when the registry cannot read its store, because every remedy page asks the same store", async () => {
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeSessions([fakeAuthUser()]), perRequest(unavailableFactors))),
        requireEnrolment({ factors: perRequest(unavailableFactors), ...enrolment }),
      ],
      { userId: "u1" },
    );
    expect((await app.request("/account/passkeys")).status).toBe(503);
  });
});

describe("requireEnrolment step-up memory", () => {
  const stepUp: AuthFactorResolution = { status: "step-up-required", kinds: ["totp-app"] };

  it("admits a session that already completed its step-up, so a standing demand is not an infinite redirect", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() });
    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("still demands a step-up from a session that has not completed one", async () => {
    expect((await protectedApp(stepUp, {}).request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });

  it("demands it again once the completed step-up is older than its configured lifetime", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() - 60_000 }, 30_000);
    expect((await app.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });

  it("keeps admitting while the completed step-up is inside that lifetime", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() - 5_000 }, 30_000);
    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("demands it again past `AUTH_STEP_UP_MAX_MS` when no lifetime is configured", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() - AUTH_STEP_UP_MAX_MS - 60_000 });
    expect((await app.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });

  it("lasts the session when the lifetime is `null`", async () => {
    const app = protectedApp(stepUp, { stepUpAt: 1 }, null);
    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("counts a mark dated into the future for nothing, rather than satisfying every window until the clock catches up", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() + 3_600_000 }, 30_000);
    expect((await app.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });

  it("counts a future mark for nothing even with no configured lifetime", async () => {
    const app = protectedApp(stepUp, { stepUpAt: Date.now() + 3_600_000 });
    expect((await app.request("/account/passkeys")).headers.get("location")).toBe("/auth/verify");
  });
});

/** The enrolment page, guarded as `AUTH_ROUTE_GROUPS` declares it, under one factor verdict. */
function enrolmentApp(resolution: AuthFactorResolution, seed: SessionSeed = {}) {
  const factors = perRequest(fakeFactors(resolution));
  return guardedApp([requireAuth(guardOptions(fakeSessions([fakeAuthUser()]), factors)), requirePendingEnrolment({ factors, ...enrolment })], {
    userId: "u1",
    ...seed,
  });
}

describe("requirePendingEnrolment", () => {
  it("admits a user who genuinely owes an enrolment", async () => {
    expect(
      await (await enrolmentApp({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }).request("/auth/enrol/passkey")).text(),
    ).toBe("enrol");
  });

  it("sends a session owing a step-up to verify, so a compromised primary factor cannot mint the second one", async () => {
    const res = await enrolmentApp({ status: "step-up-required", kinds: ["totp-app"] }).request("/auth/enrol/passkey");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  // Same wiring as the sibling guard's: `requireAuth` refuses an owed step-up first unless the group
  // is the one that clears it, so this branch is only reachable behind `clearsStepUp`.
  it("answers its own step-up redirect with 303, behind a `clearsStepUp` require-auth", async () => {
    const factors = perRequest(fakeFactors({ status: "step-up-required", kinds: ["totp-app"] }));
    const app = guardedApp(
      [
        requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), factors), clearsStepUp: true }),
        requirePendingEnrolment({ factors, ...enrolment }),
      ],
      { userId: "u1" },
    );
    const res = await app.request("/auth/enrol/passkey");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("sends a settled user off the enrolment page rather than leaving it reachable", async () => {
    const res = await enrolmentApp({ status: "satisfied" }).request("/auth/enrol/passkey");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/passkeys");
  });

  it("admits a session that owes a step-up it has already completed and now owes an enrolment", async () => {
    const app = enrolmentApp({ status: "enrolment-required", kinds: ["passkey"], stepUpKinds: [] }, { stepUpAt: Date.now() });
    expect(await (await app.request("/auth/enrol/passkey")).text()).toBe("enrol");
  });

  const owedBesideHeld: AuthFactorResolution = { status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: ["recovery-code"] };

  it("sends an owed enrolment to verify while the account holds a confirmed factor this session has not proved", async () => {
    const res = await enrolmentApp(owedBesideHeld).request("/auth/enrol/passkey");
    expect({ status: res.status, location: res.headers.get("location"), body: await res.text() }).toEqual({
      status: 303,
      location: "/auth/verify",
      body: "",
    });
  });

  /** The enrolment page behind a `clearsStepUp` require-auth, so this guard alone judges the mark against a 30-second window. */
  const pendingBehindWindow = (stepUpAt: number) => {
    const factors = perRequest(fakeFactors(owedBesideHeld));
    return guardedApp(
      [
        requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), factors), clearsStepUp: true }),
        requirePendingEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 30_000 }),
      ],
      { userId: "u1", stepUpAt },
    );
  };

  it("sends that enrolment to verify when the mark is older than the configured lifetime", async () => {
    const res = await pendingBehindWindow(Date.now() - 60_000).request("/auth/enrol/passkey");
    expect(locationOf(res)).toEqual({ status: 303, location: "/auth/verify" });
  });

  it("sends that enrolment to verify when the mark is dated into the future", async () => {
    const res = await pendingBehindWindow(Date.now() + 3_600_000).request("/auth/enrol/passkey");
    expect(locationOf(res)).toEqual({ status: 303, location: "/auth/verify" });
  });

  it("admits that enrolment while the mark is inside the configured lifetime", async () => {
    expect(await (await pendingBehindWindow(Date.now() - 5_000).request("/auth/enrol/passkey")).text()).toBe("enrol");
  });

  it("admits that enrolment once the session has proved the factor it holds", async () => {
    const app = enrolmentApp(owedBesideHeld, { stepUpAt: Date.now() });
    expect(await (await app.request("/auth/enrol/passkey")).text()).toBe("enrol");
  });

  it("refuses when the registry cannot read its store", async () => {
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeSessions([fakeAuthUser()]), perRequest(unavailableFactors))),
        requirePendingEnrolment({ factors: perRequest(unavailableFactors), ...enrolment }),
      ],
      { userId: "u1" },
    );
    expect((await app.request("/auth/enrol/passkey")).status).toBe(503);
  });

  it("refuses a `json` group owing a step-up with a body rather than a redirect", async () => {
    const app = guardedApp(
      [
        requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), stepUpOwed), medium: "json" }),
        requirePendingEnrolment({ factors: stepUpOwed, ...enrolment, medium: "json" }),
      ],
      { userId: "u1" },
    );
    const res = await app.request("/auth/enrol/passkey");
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "This account owes a step-up verification." });
  });

  it("throws when no identity was established", () => {
    const context = new RequestContext(new Request("http://localhost/auth/enrol/passkey"));
    expect(requirePendingEnrolment({ factors: satisfied, ...enrolment })(context, async () => new Response("ok"))).rejects.toThrow(
      "auth/web guard: no identity on this request — `requireAuth` must run before `requirePendingEnrolment`, which reads the identity it establishes.",
    );
  });
});

describe("requireFreshStepUp", () => {
  const HOUR = 3_600_000;
  const owing: AuthFactorResolution = { status: "step-up-required", kinds: ["totp-app"] };

  /** The account group's stack, with the freshness window this test is about, under one factor verdict. */
  // `clearsStepUp`, so the subject is the freshness window alone: `requireAuth`'s own refusal of an
  // unmarked owed step-up is asserted where it belongs, and would otherwise pre-empt every case here.
  function freshApp(seed: SessionSeed, freshStepUpMaxAgeMs?: number | null, resolution: AuthFactorResolution = owing) {
    const factors = perRequest(fakeFactors(resolution));
    return guardedApp(
      [
        requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })]), factors), clearsStepUp: true }),
        requireFreshStepUp({ factors, ...enrolment, ...(freshStepUpMaxAgeMs === undefined ? {} : { freshStepUpMaxAgeMs }) }),
      ],
      seed,
    );
  }

  // The defect this closes: a session that stepped up once, arbitrarily long ago, could strip the
  // second factor and then move the address — the whole account on one stale proof.
  it("refuses a state-changing request whose mark is older than the window, and admits a fresh one", async () => {
    const stale = await freshApp({ userId: "u1", stepUpAt: Date.now() - 2 * HOUR }, HOUR).request("/account/passkeys", { method: "POST" });
    expect(stale.status).toBe(303);
    expect(stale.headers.get("location")).toBe("/auth/verify");

    const fresh = await freshApp({ userId: "u1", stepUpAt: Date.now() - 1_000 }, HOUR).request("/account/passkeys", { method: "POST" });
    expect(await fresh.text()).toBe("enrolled");
  });

  // No factor kind ranks above another: the account repair paths rest on a
  // recovery code proving exactly what a passkey proves.
  it("admits a recovery-code step-up exactly as a step-up by any other kind of the same age, and refuses every one once stale", async () => {
    const kinds = ["recovery-code", "passkey", "totp-app", "email-otp"] as const;
    const answers = async (stepUpAt: number) =>
      Promise.all(
        kinds.map(async (stepUpKind) =>
          locationOf(await freshApp({ userId: "u1", stepUpAt, stepUpKind }, HOUR).request("/account/passkeys", { method: "POST" })),
        ),
      );
    expect({ fresh: await answers(Date.now() - 1_000), stale: await answers(Date.now() - 2 * HOUR) }).toEqual({
      fresh: kinds.map(() => ({ status: 200, location: null })),
      stale: kinds.map(() => ({ status: 303, location: "/auth/verify" })),
    });
  });

  // Reading the page that offers the action is not the action, and gating the `GET` would leave the
  // visitor unable to reach the form that clears the demand.
  it("admits a safe method whatever the mark, so the page offering the action stays reachable", async () => {
    const unmarked = await freshApp({ userId: "u1" }, HOUR).request("/account/passkeys");
    expect(await unmarked.text()).toBe("passkeys");

    const stale = await freshApp({ userId: "u1", stepUpAt: Date.now() - 2 * HOUR }, HOUR).request("/account/passkeys", { method: "GET" });
    expect(await stale.text()).toBe("passkeys");
  });

  // On by default: a significant action on an account that has a second factor is held to it
  // without the mount having to ask, and the window is forge's own constant.
  it("demands a step-up inside 15 minutes when no window is configured", async () => {
    const stale = await freshApp({ userId: "u1", stepUpAt: Date.now() - 900_000 - 1 }).request("/account/passkeys", { method: "POST" });
    expect(stale.status).toBe(303);
    const fresh = await freshApp({ userId: "u1", stepUpAt: Date.now() - 900_000 + 5_000 }).request("/account/passkeys", { method: "POST" });
    expect(await fresh.text()).toBe("enrolled");
  });

  it("demands nothing when the window is `null`, which is the one way to opt out", async () => {
    const res = await freshApp({ userId: "u1" }, null).request("/account/passkeys", { method: "POST" });
    expect(await res.text()).toBe("enrolled");
  });

  it("treats a session that never stepped up as stale, rather than as having nothing to be stale", async () => {
    const res = await freshApp({ userId: "u1" }, HOUR).request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(303);
  });

  // The defect this closes: an email-only session could move the address, add a factor or change a
  // role up to the session's own lifetime after signing in, re-proving nothing.
  it("holds a single-factor session to the window on email change, factor add and an admin mutation, and admits it after a fresh proof", async () => {
    const single = (seed: SessionSeed) => {
      const app = freshApp(seed, HOUR, { status: "satisfied" });
      mapHandler(app, "POST", "/account/email", () => new Response("email"));
      mapHandler(app, "PATCH", "/admin/users/:id", () => new Response("updated"));
      return app;
    };
    const requests = [
      ["/account/email", { method: "POST" }],
      ["/account/passkeys", { method: "POST" }],
      ["/admin/users/u2", { method: "PATCH" }],
    ] as const;
    const answers = async (seed: SessionSeed) =>
      Promise.all(requests.map(async ([path, init]) => locationOf(await single(seed).request(path, init))));

    expect(await answers({ userId: "u1", signedInAt: Date.now() - 2 * HOUR })).toEqual(
      requests.map(() => ({ status: 303, location: "/auth/verify" })),
    );
    expect(await answers({ userId: "u1", signedInAt: Date.now() - 2 * HOUR, stepUpAt: Date.now() - 2 * HOUR })).toEqual(
      requests.map(() => ({ status: 303, location: "/auth/verify" })),
    );
    expect(await answers({ userId: "u1", signedInAt: Date.now() - 2 * HOUR, stepUpAt: Date.now() - 1_000 })).toEqual(
      requests.map(() => ({ status: 200, location: null })),
    );
  });

  it("refuses rather than admits when the registry cannot read its store", async () => {
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeSessions([fakeAuthUser()]), perRequest(unavailableFactors))),
        requireFreshStepUp({ factors: perRequest(unavailableFactors), ...enrolment }),
      ],
      { userId: "u1" },
    );
    expect((await app.request("/account/passkeys", { method: "POST" })).status).toBe(503);
  });

  it("reads the resolution `requireEnrolment` already made, rather than asking the registry twice", async () => {
    const factors = recordingFactors(owing);
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeSessions([fakeAuthUser()]), perRequest(factors))),
        requireEnrolment({ factors: perRequest(factors), ...enrolment }),
        requireFreshStepUp({ factors: perRequest(factors), ...enrolment, freshStepUpMaxAgeMs: HOUR }),
      ],
      { userId: "u1", stepUpAt: Date.now() - 2 * HOUR },
    );
    const res = await app.request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(303);
    expect(factors.calls).toHaveLength(1);
  });

  // The admin surface was the one place a significant action needed no step-up at all: a role change
  // or a deletion is exactly what a stolen long-lived session must not be able to do.
  it("holds the admin group's `PATCH /admin/users/:id` to a fresh mark, and admits it once the session steps up", async () => {
    const app = (seed: SessionSeed) => {
      const built = guardedApp(
        [
          requireAuth(guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })]), perRequest(fakeFactors(owing)))),
          requireEnrolment({ factors: perRequest(fakeFactors(owing)), ...enrolment }),
          requireAdmin(),
          requireFreshStepUp({ factors: perRequest(fakeFactors(owing)), ...enrolment, freshStepUpMaxAgeMs: HOUR }),
        ],
        seed,
      );
      mapHandler(built, "PATCH", "/admin/users/:id", () => new Response("updated"));
      return built;
    };

    const stale = await app({ userId: "u1", stepUpAt: Date.now() - 2 * HOUR }).request("/admin/users/u2", { method: "PATCH" });
    expect(stale.status).toBe(303);
    expect(stale.headers.get("location")).toBe("/auth/verify");

    const marked = await app({ userId: "u1", stepUpAt: Date.now() - 1_000 }).request("/admin/users/u2", { method: "PATCH" });
    expect(await marked.text()).toBe("updated");
  });

  it("refuses a `json` group with a body rather than a redirect a controller cannot read", async () => {
    const factors = perRequest(fakeFactors(owing));
    const app = guardedApp(
      [
        requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), factors), clearsStepUp: true, medium: "json" }),
        requireFreshStepUp({ factors, ...enrolment, freshStepUpMaxAgeMs: HOUR, medium: "json" }),
      ],
      { userId: "u1" },
    );
    const res = await app.request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This change needs a fresh verification." });
  });

  it("refuses a window no mark could be inside, at construction", () => {
    expect(() => requireFreshStepUp({ factors: satisfied, ...enrolment, freshStepUpMaxAgeMs: 999 })).toThrow(
      "requireFreshStepUp: freshStepUpMaxAgeMs is 999, below the 1000-millisecond floor",
    );
  });
});

describe("approvalCode", () => {
  it("answers the configured code, and nothing for an absent or empty one", async () => {
    const seen: (string | undefined)[] = [];
    for (const code of [undefined, "", "code"]) {
      const approval = fakeApproval({ code: () => code });
      const capture: Parameters<Forge["use"]>[1] = (context, next) => {
        seen.push(approvalCode(context, approval));
        return next();
      };
      await guardedApp([capture]).request("/admin/users");
    }
    expect(seen).toEqual([undefined, undefined, "code"]);
  });
});

const retiredSecret = "2e67c1fc3d0ec0a327d703be18be360021907809c836f6e5a6b543791c711e40";
const activeSecret = "e81cf59a0a3c12928819f5ddc4b0c634547b5f2de5fdb12d8153d69ab79b3b14";
const retiredRing = await importKeyRing([retiredSecret]);

function approvedUnder(ring: KeyRing): Parameters<Forge["use"]>[1] {
  return async (context, next) => {
    markApproval(sessionCtx.get(context), { presentedAt: Date.now(), digest: await signApprovalCode(ring, FAKE_APPROVAL_CODE) });
    return next();
  };
}

describe("requireApproval", () => {
  it("answers 404 on every method while no code is configured, an empty one included", async () => {
    const statuses = [];
    for (const code of [undefined, ""]) {
      const app = guardedApp([requireApproval(fakeApproval({ code: () => code }))]);
      statuses.push((await app.request("/admin/users")).status, (await app.request("/account/passkeys", { method: "POST" })).status);
    }
    expect(statuses).toEqual([404, 404, 404, 404]);
  });

  it("sends an unapproved GET to the prompt, carrying the path it asked for", async () => {
    const res = await guardedApp([requireApproval(fakeApproval())]).request("/admin/users?q=ada");
    expect(locationOf(res)).toEqual({ status: 302, location: "/approve?next=%2Fadmin%2Fusers%3Fq%3Dada" });
  });

  it("sends an unapproved mutation to the prompt with a 303 and no return-to, since nothing answers a GET there", async () => {
    const res = await guardedApp([requireApproval(fakeApproval())]).request("/account/passkeys", { method: "POST" });
    expect(locationOf(res)).toEqual({ status: 303, location: "/approve" });
  });

  it("returns an unapproved htmx mutation to the page it was sent from", async () => {
    const headers = { "HX-Request": "true", "HX-Current-URL": "http://localhost/account/passkeys?tab=2" };
    const res = await guardedApp([requireApproval(fakeApproval())]).request("/account/passkeys", { method: "POST", headers });
    expect(hxAnswerOf(res)).toEqual({ status: 204, location: null, redirect: "/approve?next=%2Faccount%2Fpasskeys%3Ftab%3D2" });
  });

  it("refuses an unapproved request to a json group with a body rather than a redirect", async () => {
    const res = await guardedApp([requireApproval(fakeApproval(), { medium: "json" })]).request("/account/passkeys", { method: "POST" });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 403, body: { error: "This needs an administrator's approval." } });
  });

  it("admits a session approved inside the window, on both methods", async () => {
    const app = guardedApp([approvedSession(), requireApproval(fakeApproval())]);
    expect([await (await app.request("/admin/users")).text(), await (await app.request("/account/passkeys", { method: "POST" })).text()]).toEqual([
      "users",
      "enrolled",
    ]);
  });

  it("refuses an approval once its window has run out", async () => {
    const app = guardedApp([approvedSession(Date.now() - 60_000), requireApproval(fakeApproval({ ttlMs: 60_000 }))]);
    expect((await app.request("/admin/users")).status).toBe(302);
  });

  it("refuses an approval dated into the future, which would otherwise outlast every window", async () => {
    const app = guardedApp([approvedSession(Date.now() + 60_000), requireApproval(fakeApproval())]);
    expect((await app.request("/admin/users")).status).toBe(302);
  });

  it("admits an approval signed under a key the ring has rotated off active but still holds", async () => {
    const rotated = await importKeyRing([activeSecret, retiredSecret]);
    const app = guardedApp([approvedUnder(retiredRing), requireApproval(fakeApproval({ ring: () => rotated }))]);
    expect(await (await app.request("/admin/users")).text()).toBe("users");
  });

  it("refuses an approval signed under a key the ring no longer holds", async () => {
    const dropped = await importKeyRing([activeSecret]);
    const app = guardedApp([approvedUnder(retiredRing), requireApproval(fakeApproval({ ring: () => dropped }))]);
    expect(locationOf(await app.request("/admin/users"))).toEqual({ status: 302, location: "/approve?next=%2Fadmin%2Fusers" });
  });

  it("refuses a session whose approval digest is malformed, sending it to the prompt rather than failing", async () => {
    const valid = await signApprovalCode(retiredRing, FAKE_APPROVAL_CODE);
    const [kid = "", mac = ""] = valid.split(".");
    const malformed = [
      "no-separator",
      `.${mac}`,
      `${kid}.`,
      // `!` is outside the base64url alphabet, so the MAC never decodes.
      `${kid}.!!!!`,
      `${kid}.${mac.slice(0, -4)}`,
      `${kid}.${mac}.${mac}`,
    ];
    const answers = [];
    for (const digest of malformed) {
      const stamp: Parameters<Forge["use"]>[1] = (context, next) => {
        sessionCtx.get(context).set(APPROVAL_SESSION_KEY, Date.now());
        sessionCtx.get(context).set(APPROVAL_CODE_SESSION_KEY, digest);
        return next();
      };
      const app = guardedApp([stamp, requireApproval(fakeApproval({ ring: () => retiredRing }))]);
      answers.push(locationOf(await app.request("/admin/users")));
    }
    expect(answers).toEqual(malformed.map(() => ({ status: 302, location: "/approve?next=%2Fadmin%2Fusers" })));
  });
});

describe("authFreshStepUpWindow", () => {
  const CLOCK = 5_000_000;

  function windowApp(guards: readonly Parameters<Forge["use"]>[1][]) {
    const seen: unknown[] = [];
    const app = guardedApp(guards, { userId: "u1", stepUpAt: CLOCK - 1_000 });
    const record = (context: Parameters<typeof authFreshStepUpWindow>[0]) => {
      seen.push(authFreshStepUpWindow(getAppContext(context)));
      return new Response("recorded");
    };
    mapHandler(app, "GET", "/account/window", record);
    mapHandler(app, "POST", "/account/window", record);
    return { seen, app };
  }

  const stack = (fresh: { freshStepUpMaxAgeMs?: number | null }) => [
    requireAuth(guardOptions(fakeSessions([fakeAuthUser()]))),
    requireFreshStepUp({ factors: satisfied, ...enrolment, now: () => CLOCK, ...fresh }),
  ];

  const cases: readonly { label: string; fresh: { freshStepUpMaxAgeMs?: number | null }; expected: unknown }[] = [
    { label: "the configured window", fresh: { freshStepUpMaxAgeMs: 60_000 }, expected: { maxAgeMs: 60_000, now: CLOCK } },
    { label: "fifteen minutes when none is configured", fresh: {}, expected: { maxAgeMs: 15 * 60_000, now: CLOCK } },
    { label: "an unbounded window for `null`", fresh: { freshStepUpMaxAgeMs: null }, expected: { maxAgeMs: undefined, now: CLOCK } },
  ];

  for (const { label, fresh, expected } of cases) {
    it(`returns ${label} on the guard's clock, for a safe and a state-changing request alike`, async () => {
      const { seen, app } = windowApp(stack(fresh));
      const answers = [
        await (await app.request("/account/window")).text(),
        await (await app.request("/account/window", { method: "POST" })).text(),
      ];
      expect({ answers, seen }).toStrictEqual({ answers: ["recorded", "recorded"], seen: [expected, expected] });
    });
  }

  it("returns `undefined` when `requireFreshStepUp` did not run", async () => {
    const { seen, app } = windowApp([requireAuth(guardOptions(fakeSessions([fakeAuthUser()])))]);
    await app.request("/account/window", { method: "POST" });
    expect(seen).toStrictEqual([undefined]);
  });
});

describe("stepUpHolds", () => {
  const cases: readonly { label: string; stepUpAt: number | null; maxAgeMs: number | undefined; expected: boolean }[] = [
    { label: "no mark, even under an unbounded window", stepUpAt: null, maxAgeMs: undefined, expected: false },
    { label: "a mark written this instant", stepUpAt: 10_000, maxAgeMs: 1_000, expected: true },
    { label: "a mark one millisecond inside the window", stepUpAt: 9_001, maxAgeMs: 1_000, expected: true },
    { label: "a mark exactly as old as the window", stepUpAt: 9_000, maxAgeMs: 1_000, expected: false },
    { label: "a mark dated into the future", stepUpAt: 10_001, maxAgeMs: 1_000, expected: false },
    { label: "a mark dated into the future under an unbounded window", stepUpAt: 10_001, maxAgeMs: undefined, expected: false },
    { label: "an arbitrarily old mark under an unbounded window", stepUpAt: 0, maxAgeMs: undefined, expected: true },
  ];

  for (const { label, stepUpAt, maxAgeMs, expected } of cases) {
    it(`answers ${expected} for ${label}`, () => {
      expect(stepUpHolds(stepUpAt, maxAgeMs, 10_000)).toBe(expected);
    });
  }
});

describe("the enrolment guards' redirects to an htmx request", () => {
  const HX = { "HX-Request": "true" };
  const stepUp: AuthFactorResolution = { status: "step-up-required", kinds: ["totp-app"] };

  /** `requireAuth` clearing the step-up, so the guard under test answers the demand itself. */
  function behindAuth(guard: Parameters<Forge["use"]>[1], factors: () => FakeRegistry, seed: SessionSeed = { userId: "u1" }): Forge {
    return guardedApp([requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()]), factors), clearsStepUp: true }), guard], seed);
  }

  it("navigates a stale `requireFreshStepUp` POST to verify with HX-Redirect, and a plain one with 303", async () => {
    const factors = perRequest(fakeFactors(stepUp));
    const app = behindAuth(requireFreshStepUp({ factors, ...enrolment, freshStepUpMaxAgeMs: 60_000 }), factors, {
      userId: "u1",
      stepUpAt: Date.now() - 120_000,
    });
    const answers = [
      hxAnswerOf(await app.request("/account/passkeys", { method: "POST", headers: HX })),
      hxAnswerOf(await app.request("/account/passkeys", { method: "POST" })),
    ];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/verify" },
      { status: 303, location: "/auth/verify", redirect: null },
    ]);
  });

  it("navigates a `requireEnrolment` owed enrolment to its enrol page with HX-Redirect, and a plain one with 303", async () => {
    const factors = perRequest(fakeFactors({ status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] }));
    const app = behindAuth(requireEnrolment({ factors, ...enrolment }), factors);
    const answers = [hxAnswerOf(await app.request("/account/passkeys", { headers: HX })), hxAnswerOf(await app.request("/account/passkeys"))];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/enrol/totp" },
      { status: 303, location: "/auth/enrol/totp", redirect: null },
    ]);
  });

  it("navigates a `requireEnrolment` owed step-up to verify with HX-Redirect, and a plain one with 303", async () => {
    const factors = perRequest(fakeFactors(stepUp));
    const app = behindAuth(requireEnrolment({ factors, ...enrolment }), factors);
    const answers = [hxAnswerOf(await app.request("/account/passkeys", { headers: HX })), hxAnswerOf(await app.request("/account/passkeys"))];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/verify" },
      { status: 303, location: "/auth/verify", redirect: null },
    ]);
  });

  it("navigates a settled user off `requirePendingEnrolment` with HX-Redirect, and a plain one with 303", async () => {
    const factors = satisfied;
    const app = behindAuth(requirePendingEnrolment({ factors, ...enrolment }), factors);
    const answers = [hxAnswerOf(await app.request("/auth/enrol/passkey", { headers: HX })), hxAnswerOf(await app.request("/auth/enrol/passkey"))];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/account/passkeys" },
      { status: 303, location: "/account/passkeys", redirect: null },
    ]);
  });

  it("navigates a `requirePendingEnrolment` owed step-up to verify with HX-Redirect, and a plain one with 303", async () => {
    const factors = perRequest(fakeFactors(stepUp));
    const app = behindAuth(requirePendingEnrolment({ factors, ...enrolment }), factors);
    const answers = [hxAnswerOf(await app.request("/auth/enrol/passkey", { headers: HX })), hxAnswerOf(await app.request("/auth/enrol/passkey"))];
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/verify" },
      { status: 303, location: "/auth/verify", redirect: null },
    ]);
  });

  it("still refuses an htmx request to a `json` group with a JSON 403 rather than HX-Redirect", async () => {
    const factors = perRequest(fakeFactors(stepUp));
    const app = behindAuth(requireEnrolment({ factors, ...enrolment, medium: "json" }), factors);
    const res = await app.request("/account/passkeys", { headers: HX });
    expect(hxAnswerOf(res)).toEqual({ status: 403, location: null, redirect: null });
    expect(await res.json()).toEqual({ error: "This account owes a step-up verification." });
  });
});

describe("the enrolment guards taken together", () => {
  const stepUp: AuthFactorResolution = { status: "step-up-required", kinds: ["totp-app"] };

  it("leaves a step-up demand with exactly one way out, and it is not the enrolment page", async () => {
    const off = await protectedApp(stepUp).request("/account/passkeys");
    const enrol = await enrolmentApp(stepUp).request("/auth/enrol/passkey");
    expect([off.headers.get("location"), enrol.headers.get("location")]).toEqual(["/auth/verify", "/auth/verify"]);
  });

  it("sends an owed enrolment to the one page that admits it, so the pair cannot loop", async () => {
    const owed: AuthFactorResolution = { status: "enrolment-required", kinds: ["totp-app"], stepUpKinds: [] };
    expect((await protectedApp(owed).request("/account/passkeys")).headers.get("location")).toBe("/auth/enrol/totp");
    expect(await (await enrolmentApp(owed).request("/auth/enrol/passkey")).text()).toBe("enrol");
  });
});

describe("a mandatory factor against the real registry", () => {
  it("owes the same enrolment of an admin as of anyone, since no requirement is scoped to roles", async () => {
    const factors = fakeFactorRegistry(["totp-app", "passkey"], ["totp-app"], fakeFactorStore([]));
    const app = (isAdmin: boolean) =>
      guardedApp(
        [
          requireAuth(guardOptions(fakeSessions([fakeAuthUser({ isAdmin })]), perRequest(factors))),
          requireEnrolment({ factors: perRequest(factors), ...enrolment }),
        ],
        { userId: "u1" },
      );

    const answers = await Promise.all(
      [true, false].map(async (isAdmin) => (await app(isAdmin).request("/account/passkeys")).headers.get("location")),
    );
    expect(answers).toEqual(["/auth/enrol/totp", "/auth/enrol/totp"]);
  });
});

/** A request context the router matched to the route `pattern`, as a rate limit's key reads it. */
function contextMatching(pattern: string): AppContext {
  const context = new RequestContext(new Request("http://localhost/"));
  matchedRoutePattern.set(context, pattern);
  return context as unknown as AppContext;
}

describe("createAuthGuards", () => {
  const origin = { allowedOrigins: ["https://app.example.com"] };

  // `origin` is part of the base fixture because a mutating group with no allowlist is refused: every
  // group of the shipped table carries a mutating leaf, so no chain without one wires at all.
  const chain = {
    routes: { auth: authMap, account: accountMap, admin: adminMap },
    auth: guardOptions(fakeSessions([fakeAuthUser()])),
    enrolment: { factors: satisfied, ...enrolment },
    origin,
  };

  // `origin` is a required field, so omitting it is what an untyped consumer does and the cast is
  // how a typed test reproduces it — the throw below is the only thing that catches them.
  /** The same chain with no origin allowlist, which only a group of read-only routes may be wired from. */
  const { origin: _omitted, ...rest } = chain;
  const chainWithoutOrigin = rest as typeof chain;

  /** A `rateLimit` keying every group the shipped table emits, each opted out. */
  const unlimitedGroups = {
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

  it("throws when a group lists `require-admin` before the `require-auth` it reads", () => {
    expect(() =>
      createAuthGuards({ ...chain, groups: [{ path: ["admin", "users"], guards: ["require-admin", "require-auth"], medium: "html" }] }),
    ).toThrow(
      "createAuthGuards: group `admin.users` lists `require-admin` without `require-auth` before it — that guard reads the identity `requireAuth` establishes, so in this order every request to the group fails instead of being authorised.",
    );
  });

  it("throws when a group lists `require-admin` with no `require-auth` at all", () => {
    expect(() => createAuthGuards({ ...chain, groups: [{ path: ["admin", "users"], guards: ["require-admin"], medium: "html" }] })).toThrow(
      "createAuthGuards: group `admin.users` lists `require-admin` without `require-auth` before it",
    );
  });

  it("lets a group list `require-approval` alone, because it reads the session and never the identity", () => {
    const { guards: groups } = createAuthGuards({
      ...chain,
      approval: fakeApproval(),
      groups: [{ path: ["account"], guards: ["require-approval"], medium: "html" }],
    });
    expect(groups.map((group) => group.guards?.length)).toEqual([1]);
  });

  /** An app running every stack `options` wires, over a session signed in as `u1` unless anonymous, and approved when asked. */
  function elevateApp(options: Partial<AuthGuardChainOptions>, seed: { readonly approved?: boolean; readonly anonymous?: boolean } = {}): Forge {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    app.use("*", async (context, next) => {
      if (seed.anonymous !== true)
        await establishAuthSession(sessionCtx.get(context), guardSeeder, "u1", Date.now(), Date.now(), { kind: "email-otp" });
      return next();
    });
    if (seed.approved === true) app.use("*", approvedSession());
    for (const group of createAuthGuards({ ...chain, ...options }).guards) app.use([...group.paths], ...(group.guards ?? []));
    mapHandler(app, "GET", "/admin/elevate", () => new Response("elevate"));
    return app;
  }

  it("closes `admin.elevate` when no approval was passed: an anonymous visitor goes to sign-in, a signed-in one gets 404", async () => {
    const anonymous = await elevateApp({}, { anonymous: true }).request("/admin/elevate");
    const signedIn = await elevateApp({}).request("/admin/elevate");
    expect([locationOf(anonymous), { status: signedIn.status, body: await signedIn.text() }]).toEqual([
      { status: 302, location: "/auth/signin?next=%2Fadmin%2Felevate" },
      { status: 404, body: "Not Found" },
    ]);
  });

  it("holds `admin.elevate` to the approval it was passed: the prompt first, the claim once approved", async () => {
    expect(locationOf(await elevateApp({ approval: fakeApproval() }).request("/admin/elevate"))).toEqual({
      status: 302,
      location: "/approve?next=%2Fadmin%2Felevate",
    });
    expect(await (await elevateApp({ approval: fakeApproval() }, { approved: true }).request("/admin/elevate")).text()).toBe("elevate");
  });

  it("ends an approval with the sign-out it was granted under: the pre-sign-out cookie, replayed, is sent to sign-in by `require-auth`", async () => {
    const sessions = fakeAuthSessionStore([fakeAuthUser()]);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    for (const group of createAuthGuards({ ...chain, auth: guardOptions(sessions), approval: fakeApproval() }).guards) {
      app.use([...group.paths], ...(group.guards ?? []));
    }
    mapHandler(app, "GET", "/admin/elevate", () => new Response("elevate"));
    mapHandler(app, "GET", "/seed", async (context) => {
      const now = Date.now();
      await establishAuthSession(sessionCtx.get(context), sessions, "u1", now, now, { kind: "email-otp" });
      return approvedSession()(context, async () => new Response("seeded"));
    });
    mapHandler(app, "POST", "/signout", async (context) => {
      await clearAuthSession(sessionCtx.get(context), sessions);
      return new Response("signed out");
    });
    const cookieOf = (res: Response) => res.headers.getSetCookie()[0]?.split(";")[0] ?? "";

    const held = cookieOf(await app.request("/seed"));
    const approved = await app.request("/admin/elevate", { headers: { cookie: held } });
    const approvedAnswer = { status: approved.status, body: await approved.text() };
    await app.request("/signout", { method: "POST", headers: { cookie: held } });
    const replayed = await app.request("/admin/elevate", { headers: { cookie: held } });

    expect({ approved: approvedAnswer, replayed: locationOf(replayed) }).toEqual({
      approved: { status: 200, body: "elevate" },
      replayed: { status: 302, location: "/auth/signin?next=%2Fadmin%2Felevate" },
    });
  });

  /** An app running every stack `options` wires, over a fresh session signed in as `u1`, with the admin user list behind it. */
  function adminListApp(options: Partial<AuthGuardChainOptions>): Forge {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    app.use("*", async (context, next) => {
      const session = sessionCtx.get(context);
      const now = Date.now();
      await establishAuthSession(session, guardSeeder, "u1", now, now, { kind: "email-otp" });
      await markAuthStepUp(session, guardSeeder, now, now, "email-otp");
      return next();
    });
    for (const group of createAuthGuards({ ...chain, ...options }).guards) app.use([...group.paths], ...(group.guards ?? []));
    mapHandler(app, "GET", "/admin/users", () => new Response("users"));
    return app;
  }

  it("refuses a non-administrator on `admin.users` with a plain-text 403 when the chain has no `onRefuse`", async () => {
    const res = await adminListApp({}).request("/admin/users");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
  });

  it("answers a non-administrator on `admin.users` with the chain's `onRefuse`, handed the admin refusal", async () => {
    const refusals: Refusal[] = [];
    const onRefuse = (c: { readonly url: URL }, refusal: Refusal) => (
      refusals.push(refusal),
      new Response(`admin only: ${c.url.pathname}`, { status: 403 })
    );
    const res = await adminListApp({ onRefuse }).request("/admin/users");
    expect({ status: res.status, body: await res.text(), refusals }).toEqual({
      status: 403,
      body: "admin only: /admin/users",
      refusals: [{ guard: "admin", status: 403 }],
    });
  });

  it("admits an administrator on `admin.users` past a chain carrying `onRefuse`", async () => {
    const onRefuse = () => new Response("admin only", { status: 403 });
    const res = await adminListApp({ auth: guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })])), onRefuse }).request("/admin/users");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "users" });
  });

  describe("a single-factor administrator on every state-changing account and admin route", () => {
    type Leaf = { readonly method: string; readonly pattern: { readonly source: string } };
    const leavesOf = (map: object): Leaf[] =>
      Object.values(map).flatMap((value: unknown) =>
        typeof value === "object" && value !== null && "method" in value ? [value as Leaf] : leavesOf(value as object),
      );
    const mutations = [...leavesOf(accountMap), ...leavesOf(adminMap)]
      .filter((leaf) => leaf.method !== "GET")
      .map((leaf) => ({ method: leaf.method as "POST" | "PATCH" | "DELETE", pattern: leaf.pattern.source }));
    const TO_VERIFY = { status: 303, location: "/auth/verify", body: "" };
    const STALE_JSON = { status: 403, location: null, body: JSON.stringify({ error: "This change needs a fresh verification." }) };

    /** The shipped guard table over an approved administrator holding no second factor, signed in two hours ago and stepped up at `stepUpAt`. */
    function tableApp(stepUpAt: number | null) {
      const reached: string[] = [];
      const app = new Forge(nullLogger);
      app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
      app.use("*", async (context, next) => {
        const session = sessionCtx.get(context);
        const signedInAt = Date.now() - 7_200_000;
        await establishAuthSession(session, guardSeeder, "u1", signedInAt, signedInAt, { kind: "email-otp" });
        if (stepUpAt !== null) await markAuthStepUp(session, guardSeeder, stepUpAt, stepUpAt, "email-otp");
        return next();
      });
      app.use("*", approvedSession());
      const options = { auth: guardOptions(fakeSessions([fakeAuthUser({ isAdmin: true })])), approval: fakeApproval() };
      for (const group of createAuthGuards({ ...chain, ...options }).guards) app.use([...group.paths], ...(group.guards ?? []));
      for (const { method, pattern } of mutations) {
        mapHandler(app, method, pattern, () => (reached.push(`${method} ${pattern}`), new Response("reached")));
      }
      const answers = () =>
        Promise.all(
          mutations.map(async ({ method, pattern }) => {
            const res = await app.request(pattern.replace(":id", "x1"), { method, headers: { origin: "https://app.example.com" } });
            return [`${method} ${pattern}`, { status: res.status, location: res.headers.get("location"), body: await res.text() }] as const;
          }),
        );
      return { reached, answers };
    }

    const expectedRefusals = () =>
      mutations.map(({ method, pattern }) => [`${method} ${pattern}`, pattern.includes("/register/") ? STALE_JSON : TO_VERIFY] as const);

    it("refuses each one, reaching no handler, when the step-up is a minute past the window", async () => {
      const { reached, answers } = tableApp(Date.now() - AUTH_FRESH_STEP_UP_MS - 60_000);
      expect({ answers: await answers(), reached }).toEqual({ answers: expectedRefusals(), reached: [] });
    });

    it("refuses each one, reaching no handler, when the session never stepped up", async () => {
      const { reached, answers } = tableApp(null);
      expect({ answers: await answers(), reached }).toEqual({ answers: expectedRefusals(), reached: [] });
    });

    it("reaches every handler once the step-up is fresh", async () => {
      const { reached, answers } = tableApp(Date.now() - 1_000);
      await answers();
      expect(reached.sort()).toEqual(mutations.map(({ method, pattern }) => `${method} ${pattern}`).sort());
    });
  });

  it("throws for every guard that reads the identity, not only `require-admin`", () => {
    for (const guard of ["require-enrolment", "require-pending-enrolment"] as const) {
      expect(() => createAuthGuards({ ...chain, groups: [{ path: ["account"], guards: [guard], medium: "html" }] })).toThrow(
        `createAuthGuards: group \`account\` lists \`${guard}\` without \`require-auth\` before it`,
      );
    }
  });

  it("throws when `resolve-auth` stands where `require-auth` must, before `require-admin`", () => {
    expect(() =>
      createAuthGuards({ ...chain, groups: [{ path: ["admin", "users"], guards: ["resolve-auth", "require-admin"], medium: "html" }] }),
    ).toThrow("createAuthGuards: group `admin.users` lists `require-admin` without `require-auth` before it");
  });

  it("wires a group of `resolve-auth` alone, which needs no `require-auth` before it", () => {
    expect(() => createAuthGuards({ ...chain, groups: [{ path: ["account"], guards: ["resolve-auth"], medium: "html" }] })).not.toThrow();
  });

  // The option this replaces could only be checked for presence, which a middleware other than the
  // one actually mounted satisfied too. This is the check that cannot be satisfied by the wrong value.
  it("fails the request when the app mounted no session middleware ahead of the chain, rather than admitting it", async () => {
    const app = new Forge(nullLogger);
    for (const group of createAuthGuards(chain).guards) app.use([...group.paths], ...(group.guards ?? []));
    mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));

    const res = await app.request("/account/passkeys");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toBe("passkeys");
  });

  it("emits one group per guarded route group, with paths read off the route map", () => {
    const { guards: groups } = createAuthGuards(chain);
    expect(groups.map((group) => group.paths.length > 0)).toEqual(groups.map(() => true));
    expect(groups.flatMap((group) => group.paths)).toContain("/admin/users/:id");
    // `/auth/signin` is here for its origin protection alone: its group declares no guard middleware.
    expect(groups.find((group) => group.paths.includes("/auth/signin"))?.guards).toBeUndefined();
  });

  it("registers a nested group's own leaves only, so a shared guard never runs twice", () => {
    const { guards: groups } = createAuthGuards(chain);
    const enrol = groups.find((group) => group.paths.includes("/auth/enrol/passkey"));
    expect(enrol?.paths).toEqual(["/auth/enrol/passkey", "/auth/enrol/totp"]);
  });

  // The admin map specifically: `admin.users` carries every guard standing between a session and an
  // account deletion, and dropping it is exactly the wiring error that used to ship silently.
  it("throws when the admin map is missing, rather than mounting the admin write routes unguarded", () => {
    expect(() => createAuthGuards({ ...chain, routes: { auth: authMap, account: accountMap } })).toThrow(
      "createAuthGuards: group `admin.users` declares 4 guards but `routes` holds no `admin.users` map",
    );
  });

  it("throws when a builder a guarded group names was never called, rather than mounting its routes unguarded", () => {
    expect(() => createAuthGuards({ ...chain, routes: { admin: adminMap } })).toThrow(
      "createAuthGuards: group `auth.verify` declares 1 guards but `routes` holds no `auth.verify` map",
    );
  });

  it("still skips a group that declares no guard and has no map, which is not a wiring error", () => {
    const { guards: groups } = createAuthGuards({
      ...chain,
      routes: { account: accountMap },
      groups: [
        { path: ["admin"], guards: [], medium: "html" },
        { path: ["account"], guards: ["require-auth"], medium: "html" },
      ],
    });

    expect(groups.flatMap((group) => group.paths)).toContain("/account/passkeys");
    expect(groups.flatMap((group) => group.paths).some((path) => path.startsWith("/admin"))).toBe(false);
  });

  it("throws when a guarded group finds its map but the map holds no route of its own", () => {
    expect(() =>
      createAuthGuards({ ...chain, routes: { admin: adminMap }, groups: [{ path: ["admin"], guards: ["require-auth"], medium: "html" }] }),
    ).toThrow("createAuthGuards: group `admin` declares 1 guards but its `routes` map holds no route of its own");
  });

  it("throws when a mutating group is wired with no origin policy, rather than accepting a cross-site POST", () => {
    expect(() => createAuthGuards(chainWithoutOrigin)).toThrow(
      "createAuthGuards: group `auth` answers a state-changing method but no `origin` policy was passed",
    );
  });

  it("hands each group its own medium down, so the JSON ceremony refuses in JSON while an HTML group still redirects", async () => {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    for (const group of createAuthGuards(chain).guards) app.use([...group.paths], ...(group.guards ?? []));
    mapHandler(app, "POST", "/auth/enrol/passkey/register/finish", () => new Response("finished"));
    mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));

    const ceremony = await app.request("/auth/enrol/passkey/register/finish", { method: "POST" });
    expect(ceremony.status).toBe(401);
    expect(await ceremony.json()).toEqual({ error: "Not signed in." });

    const account = await app.request("/account/passkeys");
    expect(account.status).toBe(302);
    expect(account.headers.get("location")).toBe("/auth/signin?next=%2Faccount%2Fpasskeys");
  });

  // The count is written out rather than derived from `AUTH_ROUTE_GROUPS`: a count read off the same
  // table cannot tell a group that was dropped from a group that was never declared.
  it("wires a stack for each of the nine groups the shipped table mounts a route for", () => {
    const { guards: groups } = createAuthGuards(chain);

    expect(groups).toHaveLength(9);
    expect(groups.flatMap((group) => group.paths)).toContain("/admin/users/:id");
    expect(groups.flatMap((group) => group.paths)).toContain("/admin/elevate");
    expect(groups.flatMap((group) => group.paths)).toContain("/auth/verify/passkey/finish");
  });

  it("collects a guard-less mutating group once an allowlist is configured, carrying origin protection and no middleware", () => {
    const { guards: groups } = createAuthGuards(chain);
    const signin = groups.find((group) => group.paths.includes("/auth/signin"));
    expect(signin?.origin).toBe(origin);
    expect(signin?.guards).toBeUndefined();
    expect(groups.find((group) => group.paths.includes("/auth/signup"))?.origin).toBe(origin);
  });

  // The seam the group table exists to make possible: without it a consumer matches groups by path
  // against the emitted array, which is the second copy of this table the design exists to prevent.
  it("emits the rate limit named for a group, and none for a group set to `false`", () => {
    const limit = { binding: "LIMITER", required: false };
    const rateLimit = { ...unlimitedGroups, auth: limit };
    const { guards: groups } = createAuthGuards({ ...chain, rateLimit });

    expect(groups).toHaveLength(9);
    expect(groups.find((group) => group.paths.includes("/auth/signin"))?.rateLimit).toBe(limit);
    expect(groups.find((group) => group.paths.includes("/account/passkeys"))?.rateLimit).toBeUndefined();
  });

  it("refuses a map leaving groups with routes of their own and no keyed ancestor unkeyed, naming each but not `auth.verify`, which inherits `auth`", () => {
    const limit = { binding: "LIMITER", required: false };
    const { "auth.verify": _verify, "admin.users": _users, "admin.elevate": _elevate, ...keyed } = unlimitedGroups;

    expect(() => createAuthGuards({ ...chain, rateLimit: { ...keyed, auth: limit } })).toThrow(
      new Error(
        "createAuthGuards: `rateLimit` leaves `admin.users`, `admin.elevate` unlimited — key each group a limit, or set it to `false` to mount it without one.",
      ),
    );
  });

  it("mounts no limit on any group when `rateLimit` is omitted", () => {
    expect(createAuthGuards(chain).guards.every((group) => group.rateLimit === undefined)).toBe(true);
  });

  it("refuses `false` for the bare `admin` group when every subgroup under it keys its own, naming those subgroups", () => {
    expect(() => createAuthGuards({ ...chain, rateLimit: { ...unlimitedGroups, admin: false } })).toThrow(
      new Error(
        "createAuthGuards: `rateLimit` names `admin`, whose `routes` map holds no route of its own and which no group inherits, so the limit would cover nothing — every subgroup under it keys a limit of its own (`admin.users`, `admin.elevate`), so remove it or drop a subgroup's key to inherit it.",
      ),
    );
  });

  it("drops a guard-less read-only group set to `false`, as it drops one with no map passed", () => {
    const readOnly = route("/read", { show: get("/thing") });
    const { guards: groups } = createAuthGuards({
      ...chainWithoutOrigin,
      routes: { auth: readOnly },
      groups: [{ path: ["auth"], guards: [], medium: "html" }],
      rateLimit: { auth: false },
    });

    expect(groups).toEqual([]);
  });

  // Forge picks no numbers, so a guard-less group is emitted for a rate limit alone the same way it
  // is for an origin allowlist — otherwise the sign-in POSTs would have nowhere to carry one.
  it("collects a guard-less group for a rate limit alone, on a read-only map that needs no allowlist", () => {
    const limit = { binding: "LIMITER", required: false };
    const readOnly = route("/read", { show: get("/thing") });
    const { guards: groups } = createAuthGuards({
      ...chainWithoutOrigin,
      routes: { auth: readOnly },
      groups: [{ path: ["auth"], guards: [], medium: "html" }],
      rateLimit: { auth: limit },
    });
    const unguarded = groups.find((group) => group.paths.includes("/read/thing"));

    expect(unguarded?.rateLimit).toBe(limit);
    expect(unguarded?.origin).toBeUndefined();
    expect(unguarded?.guards).toBeUndefined();
  });

  it("hands a limit on the bare `admin` group to each unkeyed subgroup, keyed per route rather than shared", () => {
    const limit = { binding: "LIMITER" };
    const { "admin.users": _users, "admin.elevate": _elevate, ...keyed } = unlimitedGroups;
    const { guards: groups } = createAuthGuards({ ...chain, rateLimit: { ...keyed, admin: limit } });
    const inherited = (path: string) => groups.find((group) => group.paths.includes(path))?.rateLimit as RateLimitOptions;

    expect(
      ["/admin/users/:id", "/admin/elevate"].map((path) => ({
        binding: inherited(path).binding,
        key: inherited(path).key,
        keySuffix: inherited(path).keySuffix?.(contextMatching(path)),
      })),
    ).toEqual([
      { binding: "LIMITER", key: undefined, keySuffix: "/admin/users/:id" },
      { binding: "LIMITER", key: undefined, keySuffix: "/admin/elevate" },
    ]);
  });

  it("refuses a key naming no group in the table, listing every name a limit can be keyed by", () => {
    const limit = { binding: "LIMITER", required: false };

    expect(() => createAuthGuards({ ...chain, rateLimit: { auth: limit, acount: limit } })).toThrow(
      "createAuthGuards: `rateLimit` names `acount`, which is no group in the table — key a limit by a group's dotted path: `auth`, `auth.verify`, `auth.verify.ceremony`, `auth.enrol`, `auth.enrol.ceremony`, `account`, `account.passkeyCeremony`, `admin`, `admin.users`, `admin.elevate`.",
    );
  });

  it("refuses a limit for a guard-less group that has no map, rather than skipping it and the limit with it", () => {
    const limit = { binding: "LIMITER", required: false };

    expect(() =>
      createAuthGuards({
        ...chain,
        routes: { account: accountMap },
        groups: [
          { path: ["admin"], guards: [], medium: "html" },
          { path: ["account"], guards: ["require-auth"], medium: "html" },
        ],
        rateLimit: { admin: limit },
      }),
    ).toThrow(
      "createAuthGuards: `rateLimit` names `admin` but `routes` holds no `admin` map — pass the map that mounts those routes, or remove the limit.",
    );
  });

  it("refuses a limit for a group with no route of its own and no subgroup to name, telling the caller to remove it", () => {
    const limit = { binding: "LIMITER", required: false };

    expect(() =>
      createAuthGuards({
        ...chain,
        routes: { admin: adminMap },
        groups: [{ path: ["admin"], guards: [], medium: "html" }],
        rateLimit: { admin: limit },
      }),
    ).toThrow(
      new Error(
        "createAuthGuards: `rateLimit` names `admin`, whose `routes` map holds no route of its own and which no group inherits, so the limit would cover nothing — remove it.",
      ),
    );
  });

  it("accepts a limit for each of the nine groups the shipped table emits, and puts each on its own group", () => {
    const representative = {
      auth: "/auth/signin",
      "auth.verify": "/auth/verify",
      "auth.verify.ceremony": "/auth/verify/passkey/finish",
      "auth.enrol": "/auth/enrol/passkey",
      "auth.enrol.ceremony": "/auth/enrol/passkey/register/finish",
      account: "/account/passkeys",
      "account.passkeyCeremony": "/account/passkeys/register/begin",
      "admin.users": "/admin/users/:id",
      "admin.elevate": "/admin/elevate",
    };
    const limits = Object.fromEntries(Object.keys(representative).map((name) => [name, { binding: "LIMITER", required: false }]));
    const { guards: groups } = createAuthGuards({ ...chain, rateLimit: limits });

    expect(groups).toHaveLength(9);
    for (const [name, path] of Object.entries(representative)) {
      expect({ name, rateLimit: groups.find((group) => group.paths.includes(path))?.rateLimit }).toEqual({ name, rateLimit: limits[name] });
    }
  });

  describe("a nested group's limit inherited from its nearest keyed ancestor", () => {
    const nested = route("/r", { home: get("/home"), verify: { a: get("/verify/a"), b: get("/verify/b/:id") }, other: { c: get("/other/c") } });
    const nestedGroups = [
      { path: ["auth"], guards: [], medium: "html" },
      { path: ["auth", "verify"], guards: [], medium: "html" },
      { path: ["auth", "other"], guards: [], medium: "html" },
    ] as const;
    const visitor = { headers: { "CF-Connecting-IP": "203.0.113.7" } };
    const burstContribution: MiddlewareContribution = {
      bindings: [{ name: "BURST", methods: ["limit"], label: "a rate-limit binding", optional: true }],
    };

    function nestedGuards(rateLimit: NonNullable<AuthGuardChainOptions["rateLimit"]>) {
      return createAuthGuards({ ...chainWithoutOrigin, routes: { auth: nested }, groups: nestedGroups, rateLimit });
    }

    /** The emitted rate limit on the group covering `path`. */
    function limitOn(rateLimit: NonNullable<AuthGuardChainOptions["rateLimit"]>, path: string) {
      return nestedGuards(rateLimit).guards.find((group) => group.paths.includes(path))?.rateLimit;
    }

    /** Requests each of `requested` in turn through the whole chain, answering every route, and returns each binding's `limit` call as `binding key`. */
    async function spent(rateLimit: NonNullable<AuthGuardChainOptions["rateLimit"]>, requested: readonly string[]): Promise<string[]> {
      const calls: string[] = [];
      const recording = (name: string): RateLimit => ({
        limit: async ({ key }) => {
          calls.push(`${name} ${key}`);
          return { success: true };
        },
      });
      const app = new Forge();
      applyMiddlewareChain(app, {
        securityHeaders: {},
        trustCfHeaders: true,
        rateLimits: { ...FAKE_RATE_LIMITS, BURST: { limit: 3, period: 10 } },
        session: createAnonymousSession({ ring: () => fakeWebRing, storage: "cookie" }),
        csrf: { ring: () => fakeWebRing, subject: false },
        contributions: [fakeLimiterContribution, burstContribution, nestedGuards(rateLimit)],
      });
      for (const pattern of ["/r/home", "/r/verify/a", "/r/verify/b/:id", "/r/other/c"]) mapHandler(app, "GET", pattern, () => new Response("ok"));
      const env = { LIMITER: recording("LIMITER"), BURST: recording("BURST") };
      for (const path of requested) {
        const res = await app.request(path, visitor, env);
        expect({ path, status: res.status, body: await res.text() }).toEqual({ path, status: 200, body: "ok" });
      }
      return calls;
    }

    it("spends two sibling routes of an inheriting child on separate per-route budgets, each apart from the parent's own", async () => {
      expect(await spent({ auth: { binding: "LIMITER" } }, ["/r/home", "/r/verify/a", "/r/verify/b/42", "/r/verify/a"])).toEqual([
        "LIMITER 203.0.113.7",
        "LIMITER 203.0.113.7:/r/verify/a",
        "LIMITER 203.0.113.7:/r/verify/b/:id",
        "LIMITER 203.0.113.7:/r/verify/a",
      ]);
    });

    it("keys an inheriting child of a parent already keyed per route by `<ip>:<pattern>`, never the pattern twice", async () => {
      expect(await spent({ auth: { binding: "LIMITER", keySuffix: routeKeySuffix } }, ["/r/home", "/r/verify/b/42"])).toEqual([
        "LIMITER 203.0.113.7:/r/home",
        "LIMITER 203.0.113.7:/r/verify/b/:id",
      ]);
    });

    it("charges one request to an inheriting child once on each binding of a stacked limit", async () => {
      expect(await spent({ auth: [{ binding: "LIMITER" }, { binding: "BURST" }] }, ["/r/verify/a"])).toEqual([
        "LIMITER 203.0.113.7:/r/verify/a",
        "BURST 203.0.113.7:/r/verify/a",
      ]);
    });

    it("leaves a child under an ancestor keyed `false` unlimited, while a sibling keyed its own limit spends it unchanged", async () => {
      expect(await spent({ auth: false, "auth.other": { binding: "LIMITER" } }, ["/r/home", "/r/verify/a", "/r/other/c"])).toEqual([
        "LIMITER 203.0.113.7",
      ]);
    });

    it("emits no limit on the child of an ancestor keyed `false`", () => {
      expect(limitOn({ auth: false, "auth.other": { binding: "LIMITER" } }, "/r/verify/a")).toBeUndefined();
    });

    it("refuses at construction a group with routes of its own under no keyed ancestor, though a sibling is keyed", () => {
      expect(() => nestedGuards({ "auth.verify": { binding: "LIMITER" }, "auth.other": false })).toThrow(
        new Error("createAuthGuards: `rateLimit` leaves `auth` unlimited — key each group a limit, or set it to `false` to mount it without one."),
      );
    });

    it("passes a group's own limit through as the very options it was keyed", () => {
      const own = { binding: "LIMITER" };
      expect(limitOn({ auth: own, "auth.verify": own }, "/r/verify/a")).toBe(own);
    });

    it.each([
      {
        name: "a limit keying by client IP gains the route pattern as its suffix",
        limit: { binding: "LIMITER", methods: ["POST"] },
        expected: { binding: "LIMITER", methods: ["POST"], key: undefined, keySuffix: "/r/verify/b/:id" },
      },
      {
        name: "a custom `key` gains the route pattern after its own",
        limit: { binding: "LIMITER", key: () => "tenant-7" },
        expected: { binding: "LIMITER", methods: undefined, key: "tenant-7:/r/verify/b/:id", keySuffix: undefined },
      },
      {
        name: "a `keySuffix` gains the route pattern after its own",
        limit: { binding: "LIMITER", keySuffix: () => "signin" },
        expected: { binding: "LIMITER", methods: undefined, key: undefined, keySuffix: "signin:/r/verify/b/:id" },
      },
    ])("keys an inherited limit per route: $name", ({ limit, expected }) => {
      const inherited = limitOn({ auth: limit }, "/r/verify/b/:id") as RateLimitOptions;
      const context = contextMatching("/r/verify/b/:id");

      expect({
        binding: inherited.binding,
        methods: inherited.methods,
        key: inherited.key?.(context),
        keySuffix: inherited.keySuffix?.(context),
      }).toEqual(expected);
    });

    it("keys each limit of an inherited stack per route, in the order the ancestor stacked them", () => {
      const stack = [{ binding: "LIMITER", key: () => "tenant-7" }, { binding: "BURST" }];
      const inherited = limitOn({ auth: stack }, "/r/verify/a") as readonly RateLimitOptions[];
      const context = contextMatching("/r/verify/a");

      expect(inherited.map((each) => ({ binding: each.binding, key: each.key?.(context), keySuffix: each.keySuffix?.(context) }))).toEqual([
        { binding: "LIMITER", key: "tenant-7:/r/verify/a", keySuffix: undefined },
        { binding: "BURST", key: undefined, keySuffix: "/r/verify/a" },
      ]);
      expect(limitOn({ auth: stack }, "/r/home")).toBe(stack);
    });
  });

  it("leaves a group with no mutating leaf of its own unprotected, and a group with no direct leaf absent", () => {
    // Every group of the shipped table now carries a mutating leaf, so the read-only case is stated
    // against a map of its own rather than dropped.
    const readOnly = route("/read", { show: get("/thing") });
    const { guards: groups } = createAuthGuards({
      ...chain,
      routes: { auth: readOnly },
      groups: [{ path: ["auth"], guards: ["require-auth"], medium: "html" }],
    });
    expect(groups.find((group) => group.paths.includes("/read/thing"))?.origin).toBeUndefined();
    // `admin`'s own level has no direct leaf: `users` and `elevate` are nested groups registering their own.
    expect(createAuthGuards(chain).guards.flatMap((group) => group.paths)).not.toContain("/admin");
  });

  it("checks a mutating request's origin while leaving the safe method on the same path reachable", async () => {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    for (const group of createAuthGuards(chain).guards) {
      if (group.origin) app.use([...group.paths], originProtection(group.origin));
      if (group.guards) app.use([...group.paths], ...group.guards);
    }
    mapHandler(app, "POST", "/auth/signin", () => new Response("signed in"));
    mapHandler(app, "GET", "/auth/signin", () => new Response("sign-in page"));

    const evil = { method: "POST", headers: { origin: "https://evil.example.com" } };
    expect((await app.request("/auth/signin", evil)).status).toBe(403);

    const allowed = await app.request("/auth/signin", { method: "POST", headers: { origin: "https://app.example.com" } });
    expect(await allowed.text()).toBe("signed in");

    const page = await app.request("/auth/signin", { headers: { origin: "https://evil.example.com" } });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("sign-in page");
  });
  it("stamps one URL per leaf of every route map under a non-default mount, nested and unguarded groups included, on every group it emits", () => {
    const members = { auth: authRoutes("/members"), account: accountRoutes("/members/account"), admin: adminRoutes("/members/admin") };
    const auth = [
      "/signin",
      "/signup",
      "/signout",
      "/signout/site-data",
      "/verify",
      "/verify/resend",
      "/verify/passkey/begin",
      "/verify/passkey/finish",
    ];
    const enrol = ["/enrol/passkey", "/enrol/totp", "/enrol/passkey/register/begin", "/enrol/passkey/register/finish"];
    const account = ["/passkeys", "/passkeys/new", "/passkeys/register/begin", "/passkeys/register/finish", "/passkeys/id", "/passkeys/id/edit"];
    const accountRest = ["/totp", "/totp/replace", "/factors", "/recovery-codes", "/recovery-codes/confirm", "/email-change"];
    const sessions = ["/sessions", "/sessions/revoke", "/sessions/revoke-others"];
    const admin = ["/users", "/users/id", "/users/id/edit", "/users/id/factors", "/users/id/factors/reset", "/elevate"];

    const covers = [
      ...[...auth, ...enrol].map((path) => `/members${path}`),
      ...[...account, ...accountRest, ...sessions].map((path) => `/members/account${path}`),
      ...admin.map((path) => `/members/admin${path}`),
    ];
    const { guards: groups } = createAuthGuards({ ...chain, routes: members });

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((group) => group.csrfCovers)).toEqual(groups.map(() => covers));
  });

  describe("the URLs its groups ask the csrf policy to cover, judged when applyMiddlewareChain registers it", () => {
    const ownGroup = [{ path: ["auth"], guards: ["resolve-auth" as const], medium: "html" as const }];

    /** Registers the guards for an `/auth/signin` group beside an ungrouped map of `leaves` under `basePath`, under a csrf policy skipping `exclude`. */
    function register(basePath: string, leaves: Record<string, ReturnType<typeof get>>, exclude: readonly string[]): void {
      const routes = { auth: route("/auth", { signin: get("/signin") }), account: route(basePath, leaves) };
      applyMiddlewareChain(new Forge(), {
        securityHeaders: {},
        session: createAnonymousSession({ ring: () => fakeWebRing, storage: "cookie" }),
        csrf: { ring: () => fakeWebRing, subject: false, exclude },
        contributions: [createAuthGuards({ ...chain, routes, groups: ownGroup })],
      });
    }

    const excluded = (path: string, entry: string) =>
      new Error(
        `applyMiddlewareChain: contribution 0's guard group \`/auth/signin\`'s route \`${path}\` mints a CSRF token, but the csrf policy's exclude entry \`${entry}\` skips it — narrow the entry so it leaves the route covered.`,
      );

    it("refuses an exclude matching a param leaf through the same param", () => {
      expect(() => register("/members", { passkey: get("/passkeys/:id") }, ["/members/passkeys/:id"])).toThrow(
        excluded("/members/passkeys/id", "/members/passkeys/:id"),
      );
    });

    it("refuses an exclude matching a leaf whose segment holds two params", () => {
      expect(() => register("/members", { file: get("/files/:id.:ext") }, ["/members/files/*"])).toThrow(
        excluded("/members/files/id.ext", "/members/files/*"),
      );
    });

    it("refuses an exclude matching an optional segment's longer form", () => {
      expect(() => register("/members", { file: get("/files(/:name)") }, ["/members/files/:name"])).toThrow(
        excluded("/members/files/name", "/members/files/:name"),
      );
    });

    it("refuses an exclude matching only an optional segment's shorter form, which the route also serves", () => {
      expect(() => register("/members", { file: get("/files(/:name)") }, ["/members/files"])).toThrow(/exclude entry `\/members\/files` skips it/);
    });

    it("refuses an exclude matching the unprefixed form of a mount whose base is an optional locale", () => {
      expect(() => register("(/:lang)/members", { signin: get("/signin") }, ["/members/*"])).toThrow(/exclude entry `\/members\/\*` skips it/);
    });

    it("refuses an exclude matching a leaf ending in a named wildcard", () => {
      expect(() => register("/members", { docs: get("/docs/*path") }, ["/members/docs/*"])).toThrow(/exclude entry `\/members\/docs\/\*` skips it/);
    });

    it("refuses an exclude matching a leaf ending in a nameless wildcard", () => {
      expect(() => register("/members", { raw: get("/raw/*") }, ["/members/raw/*"])).toThrow(/exclude entry `\/members\/raw\/\*` skips it/);
    });

    it("registers an exclude that only shares a param leaf's prefix", () => {
      expect(() => register("/members", { passkey: get("/passkeys/:id") }, ["/members/passkeys", "/members/passkeys/:id/edit"])).not.toThrow();
    });

    it("refuses an exclude skipping the auth routes when an app spreads the groups into its own contribution with no covers of its own", () => {
      const app = new Forge();
      const use = spyOn(app, "use");
      const { guards } = createAuthGuards(chain);

      expect(() =>
        applyMiddlewareChain(app, {
          securityHeaders: {},
          csrf: { ring: () => fakeWebRing, subject: false, exclude: ["/auth/*"] },
          contributions: [{ globals: [] }, { guards: [...guards] }],
        }),
      ).toThrow(
        /^applyMiddlewareChain: contribution 1's guard group `[^`]+`'s route `\/auth\/signin` mints a CSRF token, but the csrf policy's exclude entry `\/auth\/\*` skips it/,
      );
      expect(use).toHaveBeenCalledTimes(0);
    });

    it("refuses an exclude skipping the sign-out when an app spreads only an admin group, which carries every auth route", () => {
      const { guards } = createAuthGuards(chain);
      const admin = guards.find((group) => group.paths.every((path) => path.startsWith("/admin")));
      if (admin === undefined) throw new Error("no group holds only admin paths");

      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => fakeWebRing, subject: false, exclude: ["/auth/signout"] },
          contributions: [{ guards: [admin] }],
        }),
      ).toThrow(
        new Error(
          `applyMiddlewareChain: contribution 0's guard group \`${admin.paths.join(", ")}\`'s route \`/auth/signout\` mints a CSRF token, but the csrf policy's exclude entry \`/auth/signout\` skips it — narrow the entry so it leaves the route covered.`,
        ),
      );
    });

    it("returns only the guards and the session lifetime, no top-level covers", () => {
      const result = createAuthGuards(chain);
      // @ts-expect-error -- the covers ride on the groups, so the return type has no `csrfCovers`
      const dropped: unknown = result.csrfCovers;

      expect({ keys: Object.keys(result).sort(), dropped }).toEqual({ keys: ["guards", "sessionMaxAgeAtLeastMs"], dropped: undefined });
    });
  });

  describe("the session cookie lifetime its contribution needs, checked when applyMiddlewareChain registers it", () => {
    const DAY_SECONDS = 86_400;
    const DAY_MS = 86_400_000;
    const sessionRing = () => fakeWebRing;

    /** Registers `contribution` beside an anonymous session whose cookie lasts `maxAge` seconds, or the session's own default when omitted. */
    function register(contribution: MiddlewareContribution, maxAge?: number): void {
      applyMiddlewareChain(new Forge(), {
        securityHeaders: {},
        session: createAnonymousSession({ ring: sessionRing, storage: "cookie", ...(maxAge === undefined ? {} : { maxAge }) }),
        csrf: { ring: sessionRing, subject: false },
        contributions: [contribution],
      });
    }

    function servicesLasting(absoluteLifetimeMs?: number): AuthRequestServicesResolver {
      return authRequestServices({
        auth: { ring: () => importAuthKeyRing(["d4536f2555836b0b1bdc536c56e6f7245a2e89dd20ff8df68ade3cf0e7f39a65"]) },
        db: () => createD1Client(fakeAuthD1([]) as never),
        notifier: () => ({ send: () => Promise.resolve(ok()) }),
        defer: () => () => {},
        confirmUrl: (_c, token) => `https://app.example.com/confirm?t=${token}`,
        ...(absoluteLifetimeMs === undefined ? {} : { sessionOptions: { absoluteLifetimeMs } }),
      });
    }

    it("throws at registration on a 1-day cookie, naming the 7 days the auth session lasts, and registers nothing", () => {
      const app = new Forge();
      const use = spyOn(app, "use");

      expect(() =>
        applyMiddlewareChain(app, {
          securityHeaders: {},
          session: createAnonymousSession({ ring: sessionRing, storage: "cookie", maxAge: DAY_SECONDS }),
          contributions: [createAuthGuards(chain)],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: the session slot's cookie maxAge is 86400 seconds (1 day), shorter than the 604800 seconds (7 days) a contribution needs it to last — set maxAge to at least 604800.",
        ),
      );
      expect(use).toHaveBeenCalledTimes(0);
    });

    it("throws at registration on a session cookie that sets no maxAge, naming the 7 days it must last", () => {
      const app = new Forge();
      const use = spyOn(app, "use");

      expect(() =>
        applyMiddlewareChain(app, {
          securityHeaders: {},
          session: sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie),
          contributions: [createAuthGuards(chain)],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: a contribution needs the session cookie to last at least 604800 seconds (7 days), but the session slot's cookie sets no maxAge — set maxAge to at least 604800.",
        ),
      );
      expect(use).toHaveBeenCalledTimes(0);
    });

    it("throws at registration when no source supplies a session slot at all", () => {
      expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, contributions: [createAuthGuards(chain)] })).toThrow(
        new Error(
          "applyMiddlewareChain: a contribution needs the session cookie to last at least 604800 seconds (7 days), but no source supplies a session slot.",
        ),
      );
    });

    it("registers under a cookie lasting exactly 7 days and under the anonymous session's 365-day default", () => {
      expect(() => register(createAuthGuards(chain), 7 * DAY_SECONDS)).not.toThrow();
      expect(() => register(createAuthGuards(chain))).not.toThrow();
    });

    it("states the 7-day absolute lifetime of the real `authRequestServices` resolver when no sessionOptions are configured", () => {
      expect(createAuthGuards({ ...chain, auth: { ...chain.auth, services: servicesLasting() } }).sessionMaxAgeAtLeastMs).toBe(7 * DAY_MS);
    });

    it("compares the cookie with a configured `absoluteLifetimeMs`: a 1-day session admits the 1-day cookie the default refuses, and refuses a 12-hour one", () => {
      const oneDay = { ...chain, auth: { ...chain.auth, services: servicesLasting(DAY_MS) } };

      expect(createAuthGuards(oneDay).sessionMaxAgeAtLeastMs).toBe(DAY_MS);
      expect(() => register(createAuthGuards(oneDay), DAY_SECONDS)).not.toThrow();
      expect(() => register(createAuthGuards(chain), DAY_SECONDS)).toThrow("shorter than the 604800 seconds (7 days)");
      expect(() => register(createAuthGuards(oneDay), DAY_SECONDS / 2)).toThrow(
        new Error(
          "applyMiddlewareChain: the session slot's cookie maxAge is 43200 seconds (12 hours), shorter than the 86400 seconds (1 day) a contribution needs it to last — set maxAge to at least 86400.",
        ),
      );
    });
  });
});

describe("the identity guards — the services resolver they hold at construction", () => {
  const unwired = (guard: string) =>
    `${guard}: no \`services\` resolver, so no session could be resolved and every visitor would pass as anonymous — pass the \`authRequestServices\` resolver the pages use.`;
  const origin = { allowedOrigins: ["https://app.example.com"] };
  const { services: _omitted, ...withoutServices } = guardOptions(fakeSessions([fakeAuthUser()]));

  // Each `services` is what an untyped or pre-resolver consumer passes; the cast is how a typed test reproduces it.
  const MISWIRED: readonly { readonly name: string; readonly options: typeof withoutServices & Record<string, unknown> }[] = [
    { name: "no `services` at all", options: withoutServices },
    { name: "the retired `sessions` option in its place", options: { ...withoutServices, sessions: perRequest(fakeSessions([fakeAuthUser()])) } },
    { name: "a session store where the resolver belongs", options: { ...withoutServices, services: fakeAuthSessionStore([fakeAuthUser()]) } },
  ];

  for (const { name, options } of MISWIRED) {
    it(`refuses to build \`requireAuth\` given ${name}, so no request is ever sent to sign-in as anonymous`, () => {
      expect(() => guardedApp([requireAuth(options as unknown as Parameters<typeof requireAuth>[0])])).toThrow(unwired("requireAuth"));
    });

    it(`refuses to build \`resolveAuth\` given ${name}, so no request is ever admitted as anonymous`, () => {
      expect(() => guardedApp([resolveAuth(options as unknown as Parameters<typeof resolveAuth>[0])])).toThrow(unwired("resolveAuth"));
    });
  }

  for (const [guard, built] of [
    ["resolve-auth", "resolveAuth"],
    ["require-auth", "requireAuth"],
  ] as const) {
    it(`refuses to wire a group listing \`${guard}\` from an \`auth\` with no \`services\`, naming \`${built}\``, () => {
      expect(() =>
        createAuthGuards({
          routes: { auth: authMap, account: accountMap, admin: adminMap },
          auth: withoutServices as unknown as AuthGuardChainOptions["auth"],
          enrolment: { factors: satisfied, ...enrolment },
          origin,
          groups: [{ path: ["account"], guards: [guard], medium: "html" }],
        }),
      ).toThrow(unwired(built));
    });
  }

  it("builds both guards, and a group listing both, once the resolver is passed", () => {
    const options = guardOptions(fakeSessions([fakeAuthUser()]));

    expect(() => requireAuth(options)).not.toThrow();
    expect(() => resolveAuth(options)).not.toThrow();
    expect(() =>
      createAuthGuards({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: options,
        enrolment: { factors: satisfied, ...enrolment },
        origin,
        groups: [{ path: ["account"], guards: ["resolve-auth", "require-auth"], medium: "html" }],
      }),
    ).not.toThrow();
  });
});

describe("the enrolment guards — the step-up window they hold at construction", () => {
  const FLOOR = "stepUpMaxAgeMs is 0, below the 1000-millisecond floor — a window no mark can be inside makes every step-up owe another one.";
  const factors = perRequest(fakeFactors({ status: "satisfied" }));

  it("refuses a window no step-up mark could ever be inside, naming the guard that was built", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 0 })).toThrow(`requireEnrolment: ${FLOOR}`);
    expect(() => requirePendingEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 0 })).toThrow(`requirePendingEnrolment: ${FLOOR}`);
  });

  // `requireAuth` enforces the owed step-up itself, so it reads the same window the enrolment pair
  // does and has to refuse the same numbers — otherwise a zero there silently owes one every request.
  it("holds `requireAuth` to the same window, which it now enforces the step-up against", () => {
    const options = guardOptions(fakeSessions([fakeAuthUser()]));

    expect(() => requireAuth({ ...options, stepUpMaxAgeMs: 0 })).toThrow(`requireAuth: ${FLOOR}`);
    expect(() => requireAuth({ ...options, stepUpMaxAgeMs: 1_000 })).not.toThrow();
    expect(() => requireAuth(options)).not.toThrow();
  });

  it("holds `resolveAuth` to it too, since the verify page measures marks by the window it records", () => {
    const services = servicesOver(fakeSessions([fakeAuthUser()]));

    expect(() => resolveAuth({ services, stepUpMaxAgeMs: 0 })).toThrow(`resolveAuth: ${FLOOR}`);
    expect(() => resolveAuth({ services, stepUpMaxAgeMs: 1_000 })).not.toThrow();
  });

  it("refuses a fraction", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 1_000.5 })).toThrow(
      "requireEnrolment: stepUpMaxAgeMs is 1000.5, which is not a whole number.",
    );
  });

  it("accepts the floor and the ceiling themselves", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 1_000 })).not.toThrow();
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: AUTH_SESSION_MAX_MS })).not.toThrow();
  });

  it("refuses a window longer than any session lasts, pointing at `null`", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: AUTH_SESSION_MAX_MS + 1 })).toThrow(
      `requireEnrolment: stepUpMaxAgeMs is ${AUTH_SESSION_MAX_MS + 1}, above the ${AUTH_SESSION_MAX_MS}-millisecond ceiling — no session outlives the longest absolute lifetime, so pass \`null\` for a step-up that lasts the session.`,
    );
  });

  it("holds `requireAuth` and the freshness window to the same ceiling, accepting the ceiling itself", () => {
    const options = guardOptions(fakeSessions([fakeAuthUser()]));
    const ceiling = `above the ${AUTH_SESSION_MAX_MS}-millisecond ceiling`;

    expect(() => requireAuth({ ...options, stepUpMaxAgeMs: AUTH_SESSION_MAX_MS + 1 })).toThrow(
      `requireAuth: stepUpMaxAgeMs is ${AUTH_SESSION_MAX_MS + 1}, ${ceiling}`,
    );
    expect(() => requireFreshStepUp({ factors, ...enrolment, freshStepUpMaxAgeMs: AUTH_SESSION_MAX_MS + 1 })).toThrow(
      `requireFreshStepUp: freshStepUpMaxAgeMs is ${AUTH_SESSION_MAX_MS + 1}, ${ceiling}`,
    );
    expect(() => requireAuth({ ...options, stepUpMaxAgeMs: AUTH_SESSION_MAX_MS })).not.toThrow();
    expect(() => requireFreshStepUp({ factors, ...enrolment, freshStepUpMaxAgeMs: AUTH_SESSION_MAX_MS })).not.toThrow();
  });

  it("accepts the window omitted, which means `AUTH_STEP_UP_MAX_MS`, and `null`, which means the mark lasts the session", () => {
    expect(() => requireEnrolment({ factors, ...enrolment })).not.toThrow();
    expect(() => requirePendingEnrolment({ factors, ...enrolment })).not.toThrow();
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: null })).not.toThrow();
    expect(() => requireAuth({ ...guardOptions(fakeSessions([fakeAuthUser()])), stepUpMaxAgeMs: null })).not.toThrow();
  });
});

describe("requireBearer", () => {
  const AT = 1_700_000_000_000;
  const EXPIRES_AT = AT + 86_400_000;

  /** One array-backed token store a real service verifies against; `down` answers every lookup with an outage. */
  function bearerService(down = false) {
    const rows: { hash: string; record: AuthAccessToken }[] = [];
    const store: AccessTokenStore = {
      create: async (input, at) => {
        const record = { ...input, id: `t${rows.length + 1}`, lastUsedAt: null, revokedAt: null, createdAt: at };
        rows.push({ hash: bytesToHex(input.tokenHash), record });
        return ok(record);
      },
      findByHash: async (tokenHash) =>
        down
          ? { ok: false, error: new AuthStoreError("unavailable", "accessTokens.findByHash") }
          : ok(rows.find((row) => row.hash === bytesToHex(tokenHash))?.record ?? null),
      listByUser: async () => ok([]),
      recordUse: async () => ok(true),
      revoke: async () => ok(true),
    };
    const service = createAccessTokenService({ store, prefix: "nt_", scopes: ["notes:read", "notes:write"] });
    const issue = async (change: Partial<AuthAccessToken> = {}) => {
      const outcome = await service.issue({ userId: "u1", label: "CLI", scopes: ["notes:read"], expiresAt: EXPIRES_AT }, AT);
      if (!outcome.ok) throw new Error("issue failed");
      const row = rows.at(-1);
      if (row) row.record = { ...row.record, ...change };
      return outcome.data.token;
    };
    return { service, issue };
  }

  function bearerApp(service: ReturnType<typeof bearerService>["service"], now = AT, seed: SessionSeed = {}, identity?: AuthIdentity): Forge {
    const preset: Parameters<Forge["use"]>[1] = (context, next) => {
      if (identity !== undefined) authCtx.set(context, identity);
      return next();
    };
    const guard = requireBearer({ tokens: perRequest(service), scopes: ["notes:read"], now: () => now });
    const app = guardedApp([preset, guard], seed);
    mapHandler(app, "GET", "/api/token", (context) => new Response(accessTokenCtx.get(context).id));
    return app;
  }

  it("admits a valid token holding the scope and puts its record on the request", async () => {
    const { service, issue } = bearerService();
    const res = await bearerApp(service).request("/api/token", { headers: { Authorization: `Bearer ${await issue()}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("t1");
  });

  it("reads the scheme name case-insensitively", async () => {
    const { service, issue } = bearerService();
    const res = await bearerApp(service).request("/api/token", { headers: { Authorization: `bearer ${await issue()}` } });
    expect(res.status).toBe(200);
  });

  it("challenges with a bare Bearer when no credentials were presented, whatever else the request carries", async () => {
    const { service, issue } = bearerService();
    const token = await issue();
    const identity = { userId: "u1", email: "ada@example.com", isAdmin: false, sessionId: "s1", stepUpAt: null, stepUpKind: null };
    const requests: [string, Forge, string, RequestInit][] = [
      ["no header", bearerApp(service), "/api/token", {}],
      ["Basic", bearerApp(service), "/api/token", { headers: { Authorization: "Basic dTE6cHc=" } }],
      ["a signed-in session", bearerApp(service, AT, { userId: "u1" }, identity), "/api/token", {}],
      ["a query parameter", bearerApp(service), `/api/token?access_token=${token}`, {}],
    ];
    for (const [name, app, path, init] of requests) {
      const res = await app.request(path, init);
      expect(`${name}: ${res.status} ${res.headers.get("WWW-Authenticate")}`).toBe(`${name}: 401 Bearer`);
    }
  });

  it("refuses a malformed, mismatched, unknown, revoked or expired token as invalid_token", async () => {
    const { service, issue } = bearerService();
    const valid = await issue();
    const presented = [
      "nt_short",
      `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`,
      formatAccessToken("nt_", new Uint8Array(24)),
      await issue({ revokedAt: AT - 1 }),
    ];
    for (const token of presented) {
      const res = await bearerApp(service).request("/api/token", { headers: { Authorization: `Bearer ${token}` } });
      expect(`${res.status} ${res.headers.get("WWW-Authenticate")}`).toBe('401 Bearer error="invalid_token"');
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
    const expired = await bearerApp(service, EXPIRES_AT).request("/api/token", { headers: { Authorization: `Bearer ${valid}` } });
    expect(`${expired.status} ${expired.headers.get("WWW-Authenticate")}`).toBe('401 Bearer error="invalid_token"');
  });

  it("answers 403 insufficient_scope, naming the scope the route demands", async () => {
    const { service, issue } = bearerService();
    const token = await issue();
    const app = guardedApp([requireBearer({ tokens: perRequest(service), scopes: ["notes:write"], now: () => AT })]);
    const res = await app.request("/account/passkeys", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer error="insufficient_scope", scope="notes:write"');
    expect(await res.json()).toEqual({ error: "insufficient_scope" });
  });

  it("answers 503 with no challenge when the store cannot be read", async () => {
    const { service } = bearerService(true);
    const token = formatAccessToken("nt_", new Uint8Array(24));
    const res = await bearerApp(service).request("/api/token", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(503);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("refuses at compile time a scope the service was not configured with", () => {
    const { service } = bearerService();
    // @ts-expect-error — "admin" is not one of the service's scopes.
    expect(() => requireBearer({ tokens: perRequest(service), scopes: ["admin"] })).not.toThrow();
  });
});

describe("createAuthGuards — the HTML groups' refusal hook", () => {
  const EXPIRED: Refusal = { guard: "csrf", status: 403, reason: "expired" };

  function chainAt(auth: typeof authMap | ReturnType<typeof authRoutes<"/login">>, onRefuse?: RefuseHook) {
    return createAuthGuards({
      routes: { auth, account: accountMap, admin: adminMap },
      auth: guardOptions(fakeSessions([fakeAuthUser()])),
      enrolment: { factors: satisfied, ...enrolment },
      origin: { allowedOrigins: ["http://localhost"] },
      ...(onRefuse === undefined ? {} : { onRefuse }),
    }).guards;
  }

  function hookOf(groups: ReturnType<typeof chainAt>, path: string): RefuseHook | undefined {
    const group = groups.find((candidate) => candidate.paths.includes(path));
    if (group === undefined) throw new Error(`no group covers ${path}`);
    return group.onRefuse;
  }

  function recordingHook() {
    const seen: string[] = [];
    const hook: RefuseHook = (c, refusal) => {
      seen.push(`${c.method} ${c.url.pathname} ${refusal.guard}`);
      return new Response(`app answered ${refusal.guard}`, { status: refusal.status });
    };
    return { seen, hook };
  }

  async function ask(hook: RefuseHook | undefined, method: string, path: string, refusal: Refusal, headers: Record<string, string> = {}) {
    if (hook === undefined) return "no hook";
    const res = await hook(createTestContext(new Request(`http://localhost${path}`, { method, headers })), refusal);
    if (res === undefined) return "declined";
    return { status: res.status, location: res.headers.get("location"), hxRedirect: res.headers.get("hx-redirect"), body: await res.text() };
  }

  const toConfirm = { status: 303, location: "/auth/signout", hxRedirect: null, body: "" };

  const cases: Array<{ name: string; method: string; path: string; refusal: Refusal; answer: unknown; asked: boolean }> = [
    {
      name: "sends an expired-token sign-out POST to the confirm page",
      method: "POST",
      path: "/auth/signout",
      refusal: EXPIRED,
      answer: toConfirm,
      asked: false,
    },
    {
      name: "sends a missing-token sign-out POST to the confirm page",
      method: "POST",
      path: "/auth/signout",
      refusal: { guard: "csrf", status: 403, reason: "missing-token" },
      answer: toConfirm,
      asked: false,
    },
    {
      name: "passes an unbound-subject CSRF refusal of a sign-out POST to the app's hook",
      method: "POST",
      path: "/auth/signout",
      refusal: { guard: "csrf", status: 403, reason: "unbound-subject" },
      answer: { status: 403, location: null, hxRedirect: null, body: "app answered csrf" },
      asked: true,
    },
    {
      name: "passes a CSRF refusal of the sign-in POST to the app's hook",
      method: "POST",
      path: "/auth/signin",
      refusal: EXPIRED,
      answer: { status: 403, location: null, hxRedirect: null, body: "app answered csrf" },
      asked: true,
    },
    {
      name: "passes an oversized sign-out POST's 413 to the app's hook",
      method: "POST",
      path: "/auth/signout",
      refusal: { guard: "csrf", status: 413, reason: "too-large" },
      answer: { status: 413, location: null, hxRedirect: null, body: "app answered csrf" },
      asked: true,
    },
    {
      name: "passes an origin refusal of a sign-out POST to the app's hook",
      method: "POST",
      path: "/auth/signout",
      refusal: { guard: "origin", status: 403, reason: "cross-site" },
      answer: { status: 403, location: null, hxRedirect: null, body: "app answered origin" },
      asked: true,
    },
    {
      name: "passes an absent limiter binding's 503 on a sign-out POST to the app's hook",
      method: "POST",
      path: "/auth/signout",
      refusal: { guard: "rate-limit", status: 503, reason: "binding-absent" },
      answer: { status: 503, location: null, hxRedirect: null, body: "app answered rate-limit" },
      asked: true,
    },
  ];

  for (const { name, method, path, refusal, answer, asked } of cases) {
    it(name, async () => {
      const { seen, hook } = recordingHook();
      const auth = hookOf(chainAt(authMap, hook), "/auth/signout");
      expect({ answer: await ask(auth, method, path, refusal), seen }).toEqual({
        answer,
        seen: asked ? [`${method} ${path} ${refusal.guard}`] : [],
      });
    });
  }

  it("answers an htmx sign-out POST's expired token with a 204 carrying HX-Redirect to the confirm page", async () => {
    const auth = hookOf(chainAt(authMap), "/auth/signout");
    expect(await ask(auth, "POST", "/auth/signout", EXPIRED, { "HX-Request": "true" })).toEqual({
      status: 204,
      location: null,
      hxRedirect: "/auth/signout",
      body: "",
    });
  });

  it("recovers a sign-out with no onRefuse passed, declining every other refusal to the chain's hook", async () => {
    const auth = hookOf(chainAt(authMap), "/auth/signout");
    expect({
      signout: await ask(auth, "POST", "/auth/signout", EXPIRED),
      unbound: await ask(auth, "POST", "/auth/signout", { guard: "csrf", status: 403, reason: "unbound-subject" }),
      signin: await ask(auth, "POST", "/auth/signin", EXPIRED),
    }).toEqual({ signout: toConfirm, unbound: "declined", signin: "declined" });
  });

  describe("a declining hook passed both here and as the chain's", () => {
    const groupsAsked = [
      { name: "behind the sign-out recovery", path: "/auth/signout", at: "/auth/signin" },
      { name: "with no sign-out recovery", path: "/account/sessions", at: "/account/sessions" },
    ];

    for (const { name, path, at } of groupsAsked) {
      it(`is asked once per refusal ${name}, the answer unchanged`, async () => {
        const asked: string[] = [];
        const both: RefuseHook = (c) => {
          asked.push(c.url.pathname);
          return undefined;
        };
        const context = createTestContext(new Request(`http://localhost${at}`, { method: "POST" }));
        requestLog.set(context, captureLogs().logger);
        refuseHookCtx.set(context, both);

        const res = await createRefusalAnswer(hookOf(chainAt(authMap, both), path))(context, EXPIRED);

        expect({ status: res.status, body: await res.text(), asked }).toEqual({ status: 403, body: "Forbidden", asked: [at] });
      });
    }

    it("still recovers the sign-out ahead of it, never asking it", async () => {
      const asked: string[] = [];
      const both: RefuseHook = (c) => {
        asked.push(c.url.pathname);
        return undefined;
      };
      const context = createTestContext(new Request("http://localhost/auth/signout", { method: "POST" }));
      requestLog.set(context, captureLogs().logger);
      refuseHookCtx.set(context, both);

      const res = await createRefusalAnswer(hookOf(chainAt(authMap, both), "/auth/signout"))(context, EXPIRED);

      expect({ status: res.status, location: res.headers.get("location"), asked }).toEqual({ status: 303, location: "/auth/signout", asked: [] });
    });
  });

  describe("an answering hook passed both here and as the chain's", () => {
    function answeringAt() {
      const asked: string[] = [];
      const both: RefuseHook = (c) => {
        asked.push(c.url.pathname);
        return new Response("app answered", { status: 409 });
      };
      return { asked, both };
    }

    function refusedAt(path: string, chainHook: RefuseHook) {
      const context = createTestContext(new Request(`http://localhost${path}`, { method: "POST" }));
      requestLog.set(context, captureLogs().logger);
      refuseHookCtx.set(context, chainHook);
      return context;
    }

    it("is asked once for a refusal the recovery does not own, its answer used", async () => {
      const { asked, both } = answeringAt();

      const res = await createRefusalAnswer(hookOf(chainAt(authMap, both), "/auth/signout"))(refusedAt("/auth/signin", both), EXPIRED);

      expect({ status: res.status, body: await res.text(), asked }).toEqual({ status: 409, body: "app answered", asked: ["/auth/signin"] });
    });

    it("is never asked for an expired sign-out, which the recovery answers first", async () => {
      const { asked, both } = answeringAt();

      const res = await createRefusalAnswer(hookOf(chainAt(authMap, both), "/auth/signout"))(refusedAt("/auth/signout", both), EXPIRED);

      expect({ status: res.status, location: res.headers.get("location"), asked }).toEqual({ status: 303, location: "/auth/signout", asked: [] });
    });
  });

  it("falls through to the chain's hook when the app's hook declines a refusal the recovery does not own", async () => {
    const auth = hookOf(
      chainAt(authMap, () => undefined),
      "/auth/signout",
    );
    expect({ signout: await ask(auth, "POST", "/auth/signout", EXPIRED), signin: await ask(auth, "POST", "/auth/signin", EXPIRED) }).toEqual({
      signout: toConfirm,
      signin: "declined",
    });
  });

  it("recovers the sign-out at the path the app mounted auth under, and not at the default one", async () => {
    const { seen, hook } = recordingHook();
    const auth = hookOf(chainAt(authRoutes("/login"), hook), "/login/signout");
    expect({
      mounted: await ask(auth, "POST", "/login/signout", EXPIRED),
      defaultPath: await ask(auth, "POST", "/auth/signout", EXPIRED),
      seen,
    }).toEqual({
      mounted: { status: 303, location: "/login/signout", hxRedirect: null, body: "" },
      defaultPath: { status: 403, location: null, hxRedirect: null, body: "app answered csrf" },
      seen: ["POST /auth/signout csrf"],
    });
  });

  it("leaves a group not holding the sign-out without the recovery: no hook with none passed, the app's own otherwise", async () => {
    const { seen, hook } = recordingHook();
    const unhooked = hookOf(chainAt(authMap), "/account/passkeys");
    const hooked = hookOf(chainAt(authMap, hook), "/account/passkeys");
    expect({
      unhooked: await ask(unhooked, "POST", "/auth/signout", EXPIRED),
      hooked: await ask(hooked, "POST", "/auth/signout", EXPIRED),
      seen,
    }).toEqual({
      unhooked: "no hook",
      hooked: { status: 403, location: null, hxRedirect: null, body: "app answered csrf" },
      seen: ["POST /auth/signout csrf"],
    });
  });
});
