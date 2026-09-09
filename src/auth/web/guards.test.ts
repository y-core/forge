import { describe, expect, it } from "bun:test";

import { createCookie } from "@remix-run/cookie";
import { RequestContext } from "@remix-run/fetch-router";
import { get, route } from "@remix-run/fetch-router/routes";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { ok } from "../../result/result";
import { originProtection } from "../../security/cop";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import type { AuthFactorContext, AuthFactorRegistry, AuthFactorResolution } from "../factors/registry";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorKind, AuthUser, UserStore } from "../types";
import { createAuthGuards, requireAdmin, requireAuth, requireEnrolment, requireFreshStepUp, requirePendingEnrolment } from "./guards";
import { AUTH_SESSION_KEY, AUTH_STEP_UP_SESSION_KEY } from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes, AUTH_ROUTE_GROUPS } from "./routes";
import { AUTH_FACTOR_POLICIES, fakeFactorService, fakeFactorStore } from "./test-support";

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");
const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

const sessionCookie = createCookie("__session", { path: "/" });

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

function fakeUsers(users: readonly AuthUser[]): Pick<UserStore, "findById"> {
  return { findById: async (id) => ok(users.find((user) => user.id === id) ?? null) };
}

const unavailableUsers: Pick<UserStore, "findById"> = { findById: async () => ({ ok: false, error: new Error("db down") as never }) };

type FakeRegistry = Pick<AuthFactorRegistry, "resolve" | "stepUp">;

function fakeFactors(resolution: AuthFactorResolution, stepUp: readonly AuthFactorKind[] = ["totp-app"]): FakeRegistry {
  return { stepUp, resolve: async () => ok(resolution) };
}

const unavailableFactors: FakeRegistry = { stepUp: ["totp-app"], resolve: async () => ({ ok: false, error: new Error("kv down") as never }) };

interface ResolveCall {
  readonly userId: string;
  readonly context: AuthFactorContext | undefined;
}

/** A registry stub that answers one verdict and keeps every `resolve` argument it was handed. */
function recordingFactors(resolution: AuthFactorResolution): FakeRegistry & { readonly calls: ResolveCall[] } {
  const calls: ResolveCall[] = [];
  return {
    calls,
    stepUp: ["totp-app"],
    resolve: async (userId, context) => {
      calls.push({ userId, context });
      return ok(resolution);
    },
  };
}

/** One already-built dependency as the per-request resolver the guards take. */
function perRequest<T>(value: T): () => T {
  return () => value;
}

const satisfied = perRequest(fakeFactors({ status: "satisfied" }));

const enrolment = { enrolmentPaths: authEnrolmentPaths(paths.auth), stepUpPath: paths.auth.verify.show(), settledPath: paths.account.passkeys() };

function guardOptions(users: Pick<UserStore, "findById">) {
  return { users: perRequest(users), signinPath: paths.auth.signin() };
}

interface SessionSeed {
  readonly userId?: string;
  readonly stepUpAt?: number;
}

/** A `Forge` app with session middleware, a seeded session, `guards`, and one handler per guarded path. */
function guardedApp(guards: readonly Parameters<Forge["use"]>[1][], seed: SessionSeed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
  app.use("*", (context, next) => {
    const session = sessionCtx.get(context);
    if (seed.userId !== undefined) session.set(AUTH_SESSION_KEY, seed.userId);
    if (seed.stepUpAt !== undefined) session.set(AUTH_STEP_UP_SESSION_KEY, seed.stepUpAt);
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

/** The session values the response's own `Set-Cookie` carries, which cookie storage stores verbatim. */
function sessionOf(res: Response): Record<string, unknown> {
  const value = /__session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const decoded = JSON.parse(atob(decodeURIComponent(value))) as { d: [Record<string, unknown>, unknown] };
  return decoded.d[0];
}

describe("requireAuth", () => {
  it("redirects an anonymous request to the sign-in path with the return-to it came from", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([])))]);
    const res = await app.request("/account/passkeys?tab=all");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/signin?next=%2Faccount%2Fpasskeys%3Ftab%3Dall");
  });

  it("records no return-to off a mutation, and answers 303 so the method is not replayed against the sign-in page", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([])))]);
    const res = await app.request("/account/passkeys?tab=all", { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("refuses a `json` group with a body rather than a sign-in redirect a controller cannot read", async () => {
    const app = guardedApp([requireAuth({ ...guardOptions(fakeUsers([])), medium: "json" })]);
    const res = await app.request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "Not signed in." });
  });

  it("establishes the identity and continues for a signed-in user", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([fakeAuthUser()])))], { userId: "u1" });
    expect(await (await app.request("/account/passkeys")).text()).toBe("passkeys");
  });

  // The harness re-seeds the identity key on every request, so a second request would prove nothing:
  // the cookie this response sets is the whole record of what the denial did to the session.
  it("denies a deactivated user and sends back a session cookie carrying no identity", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([fakeAuthUser({ deactivatedAt: 99 })])))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(302);
    expect(sessionOf(res)).toEqual({});
  });

  it("denies when the user store is unavailable, rather than admitting an unverified request", async () => {
    const app = guardedApp([requireAuth(guardOptions(unavailableUsers))], { userId: "u1" });
    const res = await app.request("/account/passkeys");

    expect(res.status).toBe(302);
    // An outage is transient, so it must not sign the visitor out: the identity survives the denial.
    expect(sessionOf(res)).toEqual({ [AUTH_SESSION_KEY]: "u1" });
  });

  it("throws when no session middleware ran, rather than reading as a correct denial", async () => {
    const guard = requireAuth(guardOptions(fakeUsers([])));
    const context = new RequestContext(new Request("http://localhost/account/passkeys"));
    expect(guard(context, async () => new Response("ok"))).rejects.toThrow(
      "auth/web guard: no session on this request — mount session middleware (`createAnonymousSession`, or `sessionMiddleware` behind your own resolver) on the app before the auth guard chain, or the guards deny nothing while appearing to work.",
    );
  });
});

describe("requireAdmin", () => {
  it("refuses a signed-in non-administrator", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))), requireAdmin()], { userId: "u1" });
    expect((await app.request("/admin/users")).status).toBe(403);
  });

  it("admits an administrator", async () => {
    const app = guardedApp([requireAuth(guardOptions(fakeUsers([fakeAuthUser({ isAdmin: true })]))), requireAdmin()], { userId: "u1" });
    expect(await (await app.request("/admin/users")).text()).toBe("users");
  });

  it("throws when no identity was established, rather than admitting the request", () => {
    const context = new RequestContext(new Request("http://localhost/admin/users"));
    expect(() => requireAdmin()(context, async () => new Response("ok"))).toThrow(
      "auth/web guard: no identity on this request — `requireAuth` must run before `requireAdmin`, which reads the identity it establishes.",
    );
  });
});

/** A protected page guarded by `requireAuth` then `requireEnrolment`, under one factor verdict. */
function protectedApp(resolution: AuthFactorResolution, seed: SessionSeed = {}, maxAgeMs?: number) {
  const options =
    maxAgeMs === undefined
      ? { factors: perRequest(fakeFactors(resolution)), ...enrolment }
      : { factors: perRequest(fakeFactors(resolution)), ...enrolment, stepUpMaxAgeMs: maxAgeMs };
  return guardedApp([requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))), requireEnrolment(options)], { userId: "u1", ...seed });
}

describe("requireEnrolment", () => {
  it("redirects to the enrolment page rather than refusing, because owing an enrolment is a success", async () => {
    const res = await protectedApp({ status: "enrolment-required", kinds: ["totp-app"] }).request("/account/passkeys");
    expect(res.status).toBe(302);
    // The kind that is owed, and not a fixed page: a passkey page cannot clear an authenticator-app enrolment.
    expect(res.headers.get("location")).toBe("/auth/enrol/totp");
  });

  it("redirects a step-up demand to the verify page", async () => {
    const res = await protectedApp({ status: "step-up-required", kinds: ["email-otp"] }).request("/account/passkeys");
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("continues when the demand is satisfied", async () => {
    expect(await (await protectedApp({ status: "satisfied" }).request("/account/passkeys")).text()).toBe("passkeys");
  });

  it("refuses rather than redirects when the registry cannot read its store, because every remedy page asks the same store", async () => {
    const app = guardedApp(
      [requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))), requireEnrolment({ factors: perRequest(unavailableFactors), ...enrolment })],
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

  it("lasts the session when no lifetime is configured", async () => {
    const app = protectedApp(stepUp, { stepUpAt: 1 });
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
  return guardedApp(
    [
      requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))),
      requirePendingEnrolment({ factors: perRequest(fakeFactors(resolution)), ...enrolment }),
    ],
    { userId: "u1", ...seed },
  );
}

describe("requirePendingEnrolment", () => {
  it("admits a user who genuinely owes an enrolment", async () => {
    expect(await (await enrolmentApp({ status: "enrolment-required", kinds: ["totp-app"] }).request("/auth/enrol/passkey")).text()).toBe("enrol");
  });

  it("sends a session owing a step-up to verify, so a compromised primary factor cannot mint the second one", async () => {
    const res = await enrolmentApp({ status: "step-up-required", kinds: ["totp-app"] }).request("/auth/enrol/passkey");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("sends a settled user off the enrolment page rather than leaving it reachable", async () => {
    const res = await enrolmentApp({ status: "satisfied" }).request("/auth/enrol/passkey");
    expect(res.headers.get("location")).toBe("/account/passkeys");
  });

  it("admits a session that owes a step-up it has already completed and now owes an enrolment", async () => {
    const app = enrolmentApp({ status: "enrolment-required", kinds: ["passkey"] }, { stepUpAt: Date.now() });
    expect(await (await app.request("/auth/enrol/passkey")).text()).toBe("enrol");
  });

  it("refuses when the registry cannot read its store", async () => {
    const app = guardedApp(
      [requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))), requirePendingEnrolment({ factors: perRequest(unavailableFactors), ...enrolment })],
      { userId: "u1" },
    );
    expect((await app.request("/auth/enrol/passkey")).status).toBe(503);
  });

  it("refuses a `json` group owing a step-up with a body rather than a redirect", async () => {
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))),
        requirePendingEnrolment({
          factors: perRequest(fakeFactors({ status: "step-up-required", kinds: ["totp-app"] })),
          ...enrolment,
          medium: "json",
        }),
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

  /** The account group's stack, with the freshness window this test is about. */
  function freshApp(seed: SessionSeed, freshStepUpMaxAgeMs?: number, stepUp: readonly AuthFactorKind[] = ["totp-app"]) {
    const factors = perRequest(fakeFactors({ status: "satisfied" }, stepUp));
    return guardedApp(
      [
        requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))),
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

  // Reading the page that offers the action is not the action, and gating the `GET` would leave the
  // visitor unable to reach the form that clears the demand.
  it("admits a safe method whatever the mark, so the page offering the action stays reachable", async () => {
    const res = await freshApp({ userId: "u1" }, HOUR).request("/account/passkeys");
    expect(await res.text()).toBe("passkeys");
  });

  it("demands nothing at all when no window is configured, so the guard is opt-in", async () => {
    const res = await freshApp({ userId: "u1" }).request("/account/passkeys", { method: "POST" });
    expect(await res.text()).toBe("enrolled");
  });

  it("treats a session that never stepped up as stale, rather than as having nothing to be stale", async () => {
    const res = await freshApp({ userId: "u1" }, HOUR).request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(303);
  });

  // A deployment asking for freshness it has no factor to prove is a wiring mistake, and admitting
  // silently is the one answer that hides it. It throws rather than refusing every request forever.
  it("throws when a window is configured but nothing offered can step up", async () => {
    const res = await freshApp({ userId: "u1" }, HOUR, []).request("/account/passkeys", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("refuses a `json` group with a body rather than a redirect a controller cannot read", async () => {
    const factors = perRequest(fakeFactors({ status: "satisfied" }));
    const app = guardedApp(
      [
        requireAuth(guardOptions(fakeUsers([fakeAuthUser()]))),
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

describe("the enrolment guards taken together", () => {
  const stepUp: AuthFactorResolution = { status: "step-up-required", kinds: ["totp-app"] };

  it("leaves a step-up demand with exactly one way out, and it is not the enrolment page", async () => {
    const off = await protectedApp(stepUp).request("/account/passkeys");
    const enrol = await enrolmentApp(stepUp).request("/auth/enrol/passkey");
    expect([off.headers.get("location"), enrol.headers.get("location")]).toEqual(["/auth/verify", "/auth/verify"]);
  });

  it("sends an owed enrolment to the one page that admits it, so the pair cannot loop", async () => {
    const owed: AuthFactorResolution = { status: "enrolment-required", kinds: ["totp-app"] };
    expect((await protectedApp(owed).request("/account/passkeys")).headers.get("location")).toBe("/auth/enrol/totp");
    expect(await (await enrolmentApp(owed).request("/auth/enrol/passkey")).text()).toBe("enrol");
  });
});

describe("the roles both enrolment guards resolve against", () => {
  const guards = {
    requireEnrolment: { build: requireEnrolment, path: "/account/passkeys" },
    requirePendingEnrolment: { build: requirePendingEnrolment, path: "/auth/enrol/passkey" },
  };

  for (const [name, guard] of Object.entries(guards)) {
    it(`hands \`${name}\` the identity's roles, so a \`for-roles\` policy is not silently a \`when-enrolled\` one`, async () => {
      for (const [isAdmin, expected] of [
        [true, { roles: ["admin"] }],
        [false, {}],
      ] as const) {
        const factors = recordingFactors({ status: "enrolment-required", kinds: ["totp-app"] });
        const app = guardedApp(
          [requireAuth(guardOptions(fakeUsers([fakeAuthUser({ isAdmin })]))), guard.build({ factors: perRequest(factors), ...enrolment })],
          { userId: "u1" },
        );
        await app.request(guard.path);
        expect(factors.calls[0]?.context).toEqual(expected);
      }
    });
  }

  it("refuses an admin holding no enrolment against the real registry, and admits the same request from a non-admin", async () => {
    const policy = AUTH_FACTOR_POLICIES.find((held) => held.mode === "second-factor" && held.required === "for-roles");
    if (policy === undefined) throw new Error("the factor matrix no longer carries a `for-roles` policy");
    const factors = createFactorRegistry(fakeFactorStore([]), {
      offered: [fakeFactorService("email-otp"), fakeFactorService("totp-app")],
      primary: "email-otp",
      policy,
    });
    const app = (isAdmin: boolean) =>
      guardedApp(
        [requireAuth(guardOptions(fakeUsers([fakeAuthUser({ isAdmin })]))), requireEnrolment({ factors: perRequest(factors), ...enrolment })],
        { userId: "u1" },
      );

    const admin = await app(true).request("/account/passkeys");
    expect(admin.status).toBe(302);
    expect(admin.headers.get("location")).toBe("/auth/enrol/totp");
    expect(await (await app(false).request("/account/passkeys")).text()).toBe("passkeys");
  });
});

describe("createAuthGuards", () => {
  const chain = {
    routes: { auth: authMap, account: accountMap, admin: adminMap },
    auth: guardOptions(fakeUsers([fakeAuthUser()])),
    enrolment: { factors: satisfied, ...enrolment },
  };

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

  it("throws for every guard that reads the identity, not only `require-admin`", () => {
    for (const guard of ["require-enrolment", "require-pending-enrolment"] as const) {
      expect(() => createAuthGuards({ ...chain, groups: [{ path: ["account"], guards: [guard], medium: "html" }] })).toThrow(
        `createAuthGuards: group \`account\` lists \`${guard}\` without \`require-auth\` before it`,
      );
    }
  });

  // The option this replaces could only be checked for presence, which a middleware other than the
  // one actually mounted satisfied too. This is the check that cannot be satisfied by the wrong value.
  it("fails the request when the app mounted no session middleware ahead of the chain, rather than admitting it", async () => {
    const app = new Forge(nullLogger);
    for (const group of createAuthGuards(chain)) app.use([...group.paths], ...(group.middleware ?? []));
    mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));

    const res = await app.request("/account/passkeys");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toBe("passkeys");
  });

  it("emits one group per guarded route group, with paths read off the route map", () => {
    const groups = createAuthGuards(chain);
    expect(groups.map((group) => group.paths.length > 0)).toEqual(groups.map(() => true));
    expect(groups.flatMap((group) => group.paths)).toContain("/admin/users/:id");
    expect(groups.flatMap((group) => group.paths)).not.toContain("/auth/signin");
  });

  it("registers a nested group's own leaves only, so a shared guard never runs twice", () => {
    const groups = createAuthGuards(chain);
    const enrol = groups.find((group) => group.paths.includes("/auth/enrol/passkey"));
    expect(enrol?.paths).toEqual(["/auth/enrol/passkey", "/auth/enrol/totp"]);
  });

  it("skips a builder that was never called", () => {
    const groups = createAuthGuards({ ...chain, routes: { admin: adminMap } });
    expect(groups.flatMap((group) => group.paths).some((path) => path.startsWith("/account"))).toBe(false);
  });

  it("hands each group its own medium down, so the JSON ceremony refuses in JSON while an HTML group still redirects", async () => {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    for (const group of createAuthGuards(chain)) app.use([...group.paths], ...(group.middleware ?? []));
    mapHandler(app, "POST", "/auth/enrol/passkey/register/finish", () => new Response("finished"));
    mapHandler(app, "GET", "/account/passkeys", () => new Response("passkeys"));

    const ceremony = await app.request("/auth/enrol/passkey/register/finish", { method: "POST" });
    expect(ceremony.status).toBe(401);
    expect(await ceremony.json()).toEqual({ error: "Not signed in." });

    const account = await app.request("/account/passkeys");
    expect(account.status).toBe(302);
    expect(account.headers.get("location")).toBe("/auth/signin?next=%2Faccount%2Fpasskeys");
  });

  it("wires a stack for every group that declares one, and nothing at all for a guard-less group with no allowlist", () => {
    const guarded = AUTH_ROUTE_GROUPS.filter((group) => group.guards.length > 0);
    expect(createAuthGuards(chain)).toHaveLength(guarded.length);
  });

  const origin = { allowedOrigins: ["https://app.example.com"] };

  it("collects a guard-less mutating group once an allowlist is configured, carrying origin protection and no middleware", () => {
    const groups = createAuthGuards({ ...chain, origin });
    const signin = groups.find((group) => group.paths.includes("/auth/signin"));
    expect(signin?.origin).toBe(origin);
    expect(signin?.middleware).toBeUndefined();
    // The ceremony POSTs a browser controller drives, which carry no identity for a guard to read.
    expect(groups.find((group) => group.paths.includes("/auth/passkey/authenticate/begin"))?.origin).toBe(origin);
  });

  // The seam the group table exists to make possible: without it a consumer matches groups by path
  // against the emitted array, which is the second copy of this table the design exists to prevent.
  it("emits the rate limit named for a group, and leaves a group nothing was named for unchanged", () => {
    const limit = { limiter: () => undefined, required: false };
    const groups = createAuthGuards({ ...chain, rateLimit: { auth: limit } });

    expect(groups.find((group) => group.paths.includes("/auth/signin"))?.rateLimit).toBe(limit);
    expect(groups.find((group) => group.paths.includes("/account/passkeys"))?.rateLimit).toBeUndefined();
  });

  // Forge picks no numbers, so a guard-less group is emitted for a rate limit alone the same way it
  // is for an origin allowlist — otherwise the sign-in POSTs would have nowhere to carry one.
  it("collects a guard-less group for a rate limit alone, with no allowlist configured", () => {
    const limit = { limiter: () => undefined, required: false };
    const groups = createAuthGuards({ ...chain, rateLimit: { "auth.passkey": limit } });
    const ceremony = groups.find((group) => group.paths.includes("/auth/passkey/authenticate/begin"));

    expect(ceremony?.rateLimit).toBe(limit);
    expect(ceremony?.origin).toBeUndefined();
    expect(ceremony?.middleware).toBeUndefined();
  });

  it("leaves a group with no mutating leaf of its own unprotected, and a group with no direct leaf absent", () => {
    // Every group of the shipped table now carries a mutating leaf, so the read-only case is stated
    // against a map of its own rather than dropped.
    const readOnly = route("/read", { show: get("/thing") });
    const groups = createAuthGuards({
      ...chain,
      routes: { auth: readOnly },
      groups: [{ path: ["auth"], guards: ["require-auth"], medium: "html" }],
      origin,
    });
    expect(groups.find((group) => group.paths.includes("/read/thing"))?.origin).toBeUndefined();
    // `admin`'s own level has no direct leaf: `users` and `elevate` are nested groups registering their own.
    expect(createAuthGuards({ ...chain, origin }).flatMap((group) => group.paths)).not.toContain("/admin");
  });

  it("checks a mutating request's origin while leaving the safe method on the same path reachable", async () => {
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    for (const group of createAuthGuards({ ...chain, origin })) {
      if (group.origin) app.use([...group.paths], originProtection(group.origin));
      if (group.middleware) app.use([...group.paths], ...group.middleware);
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
});

describe("the enrolment guards — the step-up window they hold at construction", () => {
  const FLOOR = "stepUpMaxAgeMs is 0, below the 1000-millisecond floor — a window no mark can be inside makes every step-up owe another one.";
  const factors = perRequest(fakeFactors({ status: "satisfied" }));

  it("refuses a window no step-up mark could ever be inside, naming the guard that was built", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 0 })).toThrow(`requireEnrolment: ${FLOOR}`);
    expect(() => requirePendingEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 0 })).toThrow(`requirePendingEnrolment: ${FLOOR}`);
  });

  it("refuses a fraction", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 1_000.5 })).toThrow(
      "requireEnrolment: stepUpMaxAgeMs is 1000.5, which is not a whole number.",
    );
  });

  it("accepts the floor itself", () => {
    expect(() => requireEnrolment({ factors, ...enrolment, stepUpMaxAgeMs: 1_000 })).not.toThrow();
  });

  it("accepts the window omitted, which means the mark lasts the session", () => {
    expect(() => requireEnrolment({ factors, ...enrolment })).not.toThrow();
    expect(() => requirePendingEnrolment({ factors, ...enrolment })).not.toThrow();
  });
});
