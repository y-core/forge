/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { renderToString } from "../../render/jsx/render-to-string";
import type { FC, JSXElement } from "../../render/jsx/types";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { sessionMiddleware } from "../../session/session";
import { createD1Client } from "../../storage/db/client";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { mapHandler } from "../../testing/route";
import type { FakeAuthFactor } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { createEmailOtpFactor } from "../factors/email-otp";
import { createFactorRegistry } from "../factors/registry";
import type { AuthSecondFactorKind, AuthSecondFactorService, EnrollableFactorService } from "../factors/types";
import type { TotpReplaceableFactorService } from "../factors/types";
import { createSigninFlow } from "../flows/signin";
import { importAuthKeyRing } from "../keys/ring";
import { PASSKEY_OPTIONS_PATH_ATTR, PASSKEY_REDIRECT_ATTR, PASSKEY_SCOPE, PASSKEY_VERIFY_PATH_ATTR } from "../passkey-contract";
import { createCredentialStore } from "../stores/credentials";
import { squashSql } from "../stores/events.fixture";
import { createFactorStore } from "../stores/factors";
import type { AuthFactorKind, AuthMessage, OtpStateStore } from "../types";
import { approvalCtx, requireFreshStepUp, resolveAuth } from "./guards";
import { authCtx } from "./identity";
import {
  loadAccountFactors,
  loadAccountPasskeyEnrol,
  loadAccountSessions,
  loadAdminElevate,
  loadAdminUser,
  loadAdminUserEdit,
  loadAdminUserFactors,
  loadAdminUsers,
  loadEmailChange,
  loadPasskey,
  loadPasskeyEdit,
  loadPasskeyEnrol,
  loadPasskeyList,
  loadRecoveryCodes,
  loadSignin,
  loadSignoutConfirm,
  loadSignup,
  loadEnrolTotp,
  loadTotpEnrol,
  loadTotpReplace,
  loadVerify,
} from "./loaders";
import { authServices } from "./options";
import { AUTH_RESENT_PARAM } from "./paths";
import { AUTH_VIEWS } from "./render";
import { AUTH_VIEW_GUARDS, authAfterEnrolTarget, authAfterStepUpTarget, resolveAuthView, resolveRecoveryStanding } from "./resolve";
import { AUTH_ROUTE_GROUPS } from "./routes";
import type { AuthAdminGuardOptions, AuthGuardName, AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";
import type { AuthViewName, AuthViewProps } from "./types";
import type { AuthViewRequest } from "./types";
import { SigninView } from "./views/signin";
import type { SigninViewProps } from "./views/types";
import type { AuthViewChrome } from "./views/types";
import {
  fakeAdminGuardChain,
  fakeAdminUserStore,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthServices,
  fakeAuthSessionStore,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorRegistry,
  fakeFactorService,
  fakeFactorStore,
  fakeRecoveryCodeService,
  fakeSecondFactorOffering,
  fakeSessionCookie,
  attrOf,
  attrsOf,
  demoteAuthIdentity,
  elementOf,
  elementsOf,
  tagOf,
  textOf,
} from "./web.fixture";

type Loader = (c: never, options: AuthWebOptions, state?: AuthPageState) => Promise<Response>;

const viewer = fakeAuthUser({ id: "u9", email: "grace@example.com" });

const admin: AuthIdentity = { userId: "u9", email: "grace@example.com", isAdmin: true, sessionId: "s1", stepUpAt: 1, stepUpKind: "email-otp" };

const member: AuthIdentity = { ...admin, isAdmin: false };

function optionsWith(overrides: Partial<AuthRequestServices>): AuthWebOptions {
  const services = fakeAuthServices(overrides);
  return fakeAuthWebOptions({ resolveServices: () => services });
}

/** Mounts `handler` on an app carrying a deterministic minter and, when given, the identity a guard would have set, then `guards`. */
function guardedApp(
  handler: (c: AppContext) => Promise<Response>,
  identity: AuthIdentity | null,
  pattern = "/page",
  guards: readonly Middleware[] = [],
): Forge {
  const app = new Forge();
  app.use("*", (context, next) => {
    csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
    if (identity !== null) {
      authCtx.set(context, identity);
      approvalCtx.set(context, Date.now());
    }
    return next();
  });
  for (const guard of guards) app.use("*", guard);
  mapHandler(app, "GET", pattern, (context) => handler(getAppContext(context)));
  return app;
}

function loaderApp(load: Loader, options: AuthWebOptions, identity: AuthIdentity | null, pattern = "/page", state: AuthPageState = {}): Forge {
  return guardedApp((c) => load(c as never, options, state), identity, pattern);
}

const roster = [fakeAuthUser({ id: "u1", email: "ada@example.com" }), fakeAuthUser({ id: "u2", email: "bob@example.com", isAdmin: true })];

const credentials = [fakeAuthCredential({ id: "c1", userId: "u9", label: "Work laptop" }), fakeAuthCredential({ id: "c2", userId: "u9" })];

const totpService = {
  ...fakeFactorService("totp-app"),
  beginEnrolment: async () => ok({ kind: "totp-app" as const, expiresAt: 1_000, options: { secret: "JBSWY3DP", uri: "otpauth://totp/x" } }),
} as AuthSecondFactorService;

const totpRegistry = createFactorRegistry(fakeFactorStore([]), {
  primary: fakeFactorService("email-otp"),
  second: fakeSecondFactorOffering([totpService]),
});

const stepUpRegistry = fakeFactorRegistry(["totp-app"], [], fakeFactorStore(["totp-app"]));

interface Case {
  readonly label: string;
  readonly name: AuthViewName;
  readonly load: Loader;
  readonly options: AuthWebOptions;
  readonly pattern?: string;
  readonly path?: string;
  readonly state?: AuthPageState;
  readonly identity?: AuthIdentity;
}

// One case per page name, plus the second branch of every page that has one.
const CASES: readonly Case[] = [
  { label: "signin", name: "signin", load: loadSignin, options: fakeAuthWebOptions() },
  {
    label: "signin+refusal",
    name: "signin",
    load: loadSignin,
    options: fakeAuthWebOptions(),
    state: { email: "ada@example.com", fieldError: "Try again.", error: "Too many attempts.", status: 422 },
  },
  { label: "signup", name: "signup", load: loadSignup, options: fakeAuthWebOptions() },
  { label: "signoutConfirm", name: "signoutConfirm", load: loadSignoutConfirm, options: fakeAuthWebOptions() },
  {
    label: "signup+refusal",
    name: "signup",
    load: loadSignup,
    options: fakeAuthWebOptions(),
    state: { email: "ada@example.com", fieldError: "No." },
  },
  { label: "verify", name: "verify", load: loadVerify, options: fakeAuthWebOptions(), state: { email: "ada@example.com" } },
  {
    label: "verify+stepup",
    name: "verify",
    load: loadVerify,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: stepUpRegistry }),
    identity: admin,
  },
  {
    label: "enrolPasskey",
    name: "enrolPasskey",
    load: loadPasskeyEnrol,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(["passkey"]) }),
    identity: admin,
  },
  {
    label: "accountPasskeyEnrol",
    name: "accountPasskeyEnrol",
    load: loadAccountPasskeyEnrol,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(["passkey"]) }),
    identity: admin,
  },
  {
    label: "accountPasskeys",
    name: "accountPasskeys",
    load: loadPasskeyList,
    options: optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore(credentials),
      factors: fakeFactorRegistry(["passkey"]),
    }),
    identity: admin,
  },
  {
    label: "accountPasskeys+empty",
    name: "accountPasskeys",
    load: loadPasskeyList,
    options: optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([]),
      factors: fakeFactorRegistry(["passkey"]),
    }),
    identity: admin,
  },
  {
    label: "accountPasskey",
    name: "accountPasskey",
    load: loadPasskey,
    options: optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore(credentials),
      factors: fakeFactorRegistry(["passkey"]),
    }),
    pattern: "/page/:id",
    path: "/page/c2",
    identity: admin,
  },
  {
    label: "accountPasskeyEdit",
    name: "accountPasskeyEdit",
    load: loadPasskeyEdit,
    options: optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore(credentials),
      factors: fakeFactorRegistry(["passkey"]),
    }),
    pattern: "/page/:id",
    path: "/page/c1",
    identity: admin,
  },
  {
    label: "accountTotp",
    name: "accountTotp",
    load: loadTotpEnrol,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: totpRegistry }),
    identity: admin,
  },
  {
    label: "accountEmailChange",
    name: "accountEmailChange",
    load: loadEmailChange,
    options: optionsWith({ users: fakeAuthUserStore([viewer]) }),
    identity: admin,
  },
  {
    label: "accountEmailChange+sent",
    name: "accountEmailChange",
    load: loadEmailChange,
    options: optionsWith({ users: fakeAuthUserStore([viewer]) }),
    state: { sentTo: "new@example.com" },
    identity: admin,
  },
  { label: "adminUsers", name: "adminUsers", load: loadAdminUsers, options: optionsWith({ admin: fakeAdminUserStore(roster) }), identity: admin },
  {
    label: "adminUsers+search",
    name: "adminUsers",
    load: loadAdminUsers,
    options: optionsWith({ admin: fakeAdminUserStore(roster) }),
    path: "/page?q=zz",
    identity: admin,
  },
  {
    label: "adminUser",
    name: "adminUser",
    load: loadAdminUser,
    options: optionsWith({ admin: fakeAdminUserStore(roster) }),
    pattern: "/page/:id",
    path: "/page/u2",
    identity: admin,
  },
  {
    label: "adminUserEdit",
    name: "adminUserEdit",
    load: loadAdminUserEdit,
    options: optionsWith({ admin: fakeAdminUserStore(roster) }),
    pattern: "/page/:id",
    path: "/page/u2",
    state: { outcome: "last-admin-demote", status: 409 },
    identity: admin,
  },
  {
    label: "accountFactors",
    name: "accountFactors",
    load: loadAccountFactors,
    options: optionsWith({ factors: totpRegistry, credentials: fakeAuthCredentialStore(credentials) }),
    identity: member,
  },
  {
    label: "accountRecoveryCodes",
    name: "accountRecoveryCodes",
    load: loadRecoveryCodes,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(["totp-app"]) }),
    identity: member,
  },
  {
    label: "accountRecoveryCodes+issued",
    name: "accountRecoveryCodes",
    load: loadRecoveryCodes,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(["totp-app"]) }),
    state: { issuedCodes: ["AAAA-BBBB"] },
    identity: member,
  },
  {
    label: "accountSessions",
    name: "accountSessions",
    load: loadAccountSessions,
    options: optionsWith({ users: fakeAuthUserStore([viewer]) }),
    identity: member,
  },
  {
    label: "adminUserFactors",
    name: "adminUserFactors",
    load: loadAdminUserFactors,
    options: optionsWith({ admin: fakeAdminUserStore(roster), factors: totpRegistry, credentials: fakeAuthCredentialStore(credentials) }),
    pattern: "/page/:id",
    path: "/page/u2",
    identity: admin,
  },
  {
    label: "adminElevate",
    name: "adminElevate",
    load: loadAdminElevate,
    options: optionsWith({ admin: fakeAdminUserStore([viewer]) }),
    identity: admin,
  },
  {
    label: "adminElevate+taken",
    name: "adminElevate",
    load: loadAdminElevate,
    options: optionsWith({ admin: fakeAdminUserStore([fakeAuthUser({ isAdmin: true })]) }),
    identity: admin,
  },
];

// The tables answer different questions — which guards a route runs, and which a page's data
// assumes — and the mapping is not mechanical: `adminElevate` is deliberately not admin-gated.
const VIEW_GROUP: Readonly<Record<AuthViewName, readonly string[]>> = {
  signin: ["auth"],
  signup: ["auth"],
  signoutConfirm: ["auth"],
  verify: ["auth", "verify"],
  enrolPasskey: ["auth", "enrol"],
  enrolTotp: ["auth", "enrol"],
  accountPasskeys: ["account"],
  accountPasskeyEnrol: ["account"],
  accountPasskey: ["account"],
  accountPasskeyEdit: ["account"],
  accountTotp: ["account"],
  accountTotpReplace: ["account"],
  accountEmailChange: ["account"],
  accountFactors: ["account"],
  accountRecoveryCodes: ["account"],
  accountSessions: ["account"],
  adminUsers: ["admin", "users"],
  adminUser: ["admin", "users"],
  adminUserEdit: ["admin", "users"],
  adminUserFactors: ["admin", "users"],
  adminElevate: ["admin", "elevate"],
};

describe("AUTH_VIEW_GUARDS", () => {
  it("names, for every page, exactly the guards its own route group runs", () => {
    for (const [name, path] of Object.entries(VIEW_GROUP)) {
      const group = AUTH_ROUTE_GROUPS.find((one) => one.path.length === path.length && one.path.every((part, i) => part === path[i]));
      expect(group).toBeDefined();
      expect(AUTH_VIEW_GUARDS[name as AuthViewName]).toEqual(group?.guards as never);
    }
  });

  it("covers every page name, so a new page cannot be added without declaring its guards", () => {
    expect(Object.keys(AUTH_VIEW_GUARDS).sort()).toEqual(Object.keys(VIEW_GROUP).sort());
  });
});

describe("resolveAuthView — the page each loader resolves to", () => {
  async function pageOf(one: Case): Promise<{ status: number; body: string }> {
    const app = loaderApp(one.load, one.options, one.identity ?? null, one.pattern ?? "/page", one.state ?? {});
    const res = await app.request(one.path ?? "/page");
    return { status: res.status, body: await res.text() };
  }

  const titleOf = (body: string): string => /<title>([^<]*)<\/title>/.exec(body)?.[1] ?? "";

  for (const one of CASES) {
    it(`resolves ${one.label} to a whole document at the status its state asked for`, async () => {
      const { status, body } = await pageOf(one);

      expect(status).toBe(one.state?.status ?? 200);
      expect(body.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
      expect(body.endsWith("</body></html>")).toBe(true);
    });
  }

  it("keeps every auth page out of a search index, which the layout owes and no single view can supply", async () => {
    for (const one of CASES) {
      expect(tagOf((await pageOf(one)).body, 'name="robots"')).toBe('<meta name="robots" content="noindex">');
    }
  });

  it("titles a page by the view it resolved to, so two states of one page cannot read as two pages", async () => {
    const titles = new Map<AuthViewName, Set<string>>();
    for (const one of CASES) titles.set(one.name, (titles.get(one.name) ?? new Set()).add(titleOf((await pageOf(one)).body)));

    for (const [name, seen] of titles) {
      expect([name, seen.size]).toEqual([name, 1]);
      expect([name, [...seen][0]]).not.toEqual([name, ""]);
    }
  });

  it("renders the refusal a case's state carries rather than dropping it on the way through the resolver", async () => {
    for (const one of CASES) {
      const { fieldError, error } = one.state ?? {};
      if (fieldError === undefined && error === undefined) continue;
      const { body } = await pageOf(one);

      if (fieldError !== undefined) expect(textOf(body, "p", 'data-slot="field-error"')).toBe(fieldError);
      if (error !== undefined) expect(textOf(body, "div", 'data-slot="alert-description"')).toBe(error);
    }
  });
});

describe("resolveAuthView refusals", () => {
  async function refusalOf(load: Loader, options: AuthWebOptions, identity: AuthIdentity | null, pattern = "/page", path = "/page") {
    const res = await loaderApp(load, options, identity, pattern).request(path);
    return { status: res.status, location: res.headers.get("location") };
  }

  const signin = { status: 302, location: "/auth/signin" };

  it("sends an anonymous request to sign-in on every page whose route runs `require-auth`", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(["passkey"]) });
    expect(await refusalOf(loadPasskeyEnrol, options, null)).toEqual(signin);
    expect(await refusalOf(loadPasskeyList, options, null)).toEqual(signin);
    expect(await refusalOf(loadPasskey, options, null, "/page/:id", "/page/c1")).toEqual(signin);
    expect(await refusalOf(loadPasskeyEdit, options, null, "/page/:id", "/page/c1")).toEqual(signin);
    expect(await refusalOf(loadTotpEnrol, options, null)).toEqual(signin);
    expect(await refusalOf(loadEmailChange, options, null)).toEqual(signin);
    expect(await refusalOf(loadAccountSessions, options, null)).toEqual(signin);
    expect(await refusalOf(loadAdminUsers, options, null)).toEqual(signin);
    expect(await refusalOf(loadAdminUser, options, null, "/page/:id", "/page/u2")).toEqual(signin);
    expect(await refusalOf(loadAdminElevate, options, null)).toEqual(signin);
  });

  it("navigates an anonymous htmx request to sign-in with HX-Redirect, and a plain one with 302", async () => {
    const app = loaderApp(loadPasskeyList, optionsWith({ users: fakeAuthUserStore([viewer]) }), null);
    const answers = await Promise.all(
      [{ "HX-Request": "true" }, {}].map(async (headers) => {
        const res = await app.request("/page", { headers });
        return { status: res.status, location: res.headers.get("location"), redirect: res.headers.get("hx-redirect") };
      }),
    );
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/signin" },
      { status: 302, location: "/auth/signin", redirect: null },
    ]);
  });

  it("answers 404 on the elevate page to a signed-in viewer that no `requireApproval` admitted", async () => {
    const identified: Middleware = (context, next) => {
      authCtx.set(context, member);
      return next();
    };
    const options = optionsWith({ admin: fakeAdminUserStore([viewer]) });
    const res = await guardedApp((c) => loadAdminElevate(c as never, options), null, "/page", [identified]).request("/page");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 404, body: "Not Found" });
  });

  // Swapped, an anonymous prober learns from the status whether this deployment offers passkeys.
  it("refuses an anonymous request before it reports that the passkey service is unconfigured", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]) });
    expect(await refusalOf(loadPasskeyEnrol, options, null)).toEqual(signin);
    expect((await refusalOf(loadPasskeyEnrol, options, admin)).status).toBe(404);
  });

  it("refuses an anonymous request before it reports that no authenticator app is offered", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]) });
    expect(await refusalOf(loadTotpEnrol, options, null)).toEqual(signin);
    expect((await refusalOf(loadTotpEnrol, options, admin)).status).toBe(404);
  });

  it("refuses an anonymous request before it reports that a credential is unknown", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore([]) });
    expect(await refusalOf(loadPasskeyEdit, options, null, "/page/:id", "/page/c1")).toEqual(signin);
    expect((await refusalOf(loadPasskeyEdit, options, admin, "/page/:id", "/page/c1")).status).toBe(404);
  });

  it("answers 503 for every store outage a page reads through", async () => {
    const downCredentials = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: { ...fakeAuthCredentialStore([]), listByUser: async () => err(new Error("kv down") as never) },
      factors: fakeFactorRegistry(["passkey"]),
    });
    expect((await refusalOf(loadPasskeyList, downCredentials, admin)).status).toBe(503);
    expect((await refusalOf(loadPasskeyEdit, downCredentials, admin, "/page/:id", "/page/c1")).status).toBe(503);

    const downAdmin = optionsWith({ admin: fakeAdminUserStore(roster, { list: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUsers, downAdmin, admin)).status).toBe(503);

    const downView = optionsWith({ admin: fakeAdminUserStore(roster, { findById: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUser, downView, admin, "/page/:id", "/page/u2")).status).toBe(503);

    const downCount = optionsWith({ admin: fakeAdminUserStore(roster, { countAdmins: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUserEdit, downCount, admin, "/page/:id", "/page/u2")).status).toBe(503);
    expect((await refusalOf(loadAdminElevate, downCount, admin)).status).toBe(503);

    const downEnrolments = optionsWith({
      users: fakeAuthUserStore([viewer]),
      enrolments: fakeFactorStore([], { down: true }),
      factors: createFactorRegistry(fakeFactorStore([]), {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([totpService]),
      }),
    });
    expect((await refusalOf(loadTotpEnrol, downEnrolments, admin)).status).toBe(503);

    const downSessions = optionsWith({
      users: fakeAuthUserStore([viewer]),
      sessions: { ...fakeAuthSessionStore([viewer]), listByUser: async () => err(new Error("db down") as never) },
    });
    expect((await refusalOf(loadAccountSessions, downSessions, admin)).status).toBe(503);
  });

  it("answers 404 for an account, a credential and a path segment that are not there", async () => {
    const empty = optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore([]), admin: fakeAdminUserStore([]) });
    expect((await refusalOf(loadPasskey, empty, admin, "/page/:id", "/page/c1")).status).toBe(404);
    expect((await refusalOf(loadPasskey, empty, admin)).status).toBe(404);
    expect((await refusalOf(loadPasskeyEdit, empty, admin)).status).toBe(404);
    expect((await refusalOf(loadAdminUser, empty, admin, "/page/:id", "/page/u2")).status).toBe(404);
    expect((await refusalOf(loadAdminUserEdit, empty, admin)).status).toBe(404);
  });

  it("sends a malformed administrative query back to the plain listing", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore(roster) });
    const res = await loaderApp(loadAdminUsers, options, admin).request(`/page?after=${"x".repeat(500)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/users");
  });

  it("navigates an htmx request with a malformed administrative query to the plain listing with HX-Redirect", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore(roster) });
    const res = await loaderApp(loadAdminUsers, options, admin).request(`/page?after=${"x".repeat(500)}`, { headers: { "HX-Request": "true" } });
    expect({ status: res.status, location: res.headers.get("location"), redirect: res.headers.get("hx-redirect") }).toEqual({
      status: 204,
      location: null,
      redirect: "/admin/users",
    });
  });

  const signedInOnly = (Object.keys(AUTH_VIEW_GUARDS) as AuthViewName[]).filter((name) =>
    (AUTH_VIEW_GUARDS[name] as readonly AuthGuardName[]).includes("require-auth"),
  );

  for (const name of signedInOnly) {
    it(`navigates an anonymous htmx request for ${name} to sign-in with HX-Redirect, and a plain one with 302`, async () => {
      const app = guardedApp(
        async (c) => {
          const view = await resolveAuthView(c, fakeAuthWebOptions(), { name, guarded: AUTH_VIEW_GUARDS[name] });
          return view.ok ? new Response("resolved") : view.error;
        },
        null,
        "/page/:id",
      );
      const answers = await Promise.all(
        [{ "HX-Request": "true" }, {}].map(async (headers) => {
          const res = await app.request("/page/c1", { headers });
          return { status: res.status, location: res.headers.get("location"), redirect: res.headers.get("hx-redirect") };
        }),
      );
      expect(answers).toEqual([
        { status: 204, location: null, redirect: "/auth/signin" },
        { status: 302, location: "/auth/signin", redirect: null },
      ]);
    });
  }
});

describe("no configuration makes a passkey start a sign-in", () => {
  async function signinPage(options: AuthWebOptions): Promise<string> {
    return await (await loaderApp(loadSignin, options, null).request("/page")).text();
  }

  it("renders no passkey scope on the sign-in page, whether or not the passkey is offered", async () => {
    const seconds = fakeFactorRegistry(["passkey"]);
    expect(tagOf(await signinPage(optionsWith({ factors: seconds })), `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
    expect(tagOf(await signinPage(fakeAuthWebOptions()), `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
  });

  it("refuses at runtime to build a registry offering the passkey as primary", () => {
    expect(() =>
      createFactorRegistry(fakeFactorStore([]), {
        // @ts-expect-error a passkey identifies nobody, so the offer does not typecheck either
        primary: fakeFactorService("passkey"),
      }),
    ).toThrow(
      'createFactorRegistry: "passkey" cannot be a primary factor — a primary factor must identify the visitor, which only "email-otp" does',
    );
  });
});

describe("a deployment offering no passkey factor serves no passkey management page", () => {
  const withdrawn = optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore([]) });

  const gone = { status: 404, body: "Not Found" };

  async function answerOf(load: Loader, options: AuthWebOptions, pattern = "/page", path = "/page") {
    const res = await loaderApp(load, options, admin, pattern).request(path);
    return { status: res.status, body: await res.text() };
  }

  it("answers 404 for the list, where it rendered an empty `Your passkeys`", async () => {
    expect(await answerOf(loadPasskeyList, withdrawn)).toEqual(gone);
  });

  // A stored credential under a withdrawn offering is a dead row an operator clears at the store,
  // so holding one keeps none of these pages alive.
  const holder = optionsWith({
    users: fakeAuthUserStore([viewer]),
    credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
  });

  it("answers 404 for the list a visitor still holds a stored credential in", async () => {
    expect(await answerOf(loadPasskeyList, holder)).toEqual(gone);
  });

  it("answers 404 for the row of a credential the visitor still holds", async () => {
    expect(await answerOf(loadPasskey, holder, "/page/:id", "/page/c1")).toEqual(gone);
  });

  it("answers 404 for the rename page of a credential the visitor still holds", async () => {
    expect(await answerOf(loadPasskeyEdit, holder, "/page/:id", "/page/c1")).toEqual(gone);
  });
});

// `loadAdminUsers` reads `services.admin.list` having read no identity, so an auth view embedded on
// an unguarded consumer route would serve the whole user table to a visitor.
const ADMIN_VIEWS = ["adminUsers", "adminUser", "adminUserEdit", "adminUserFactors"] as const;

type AdminViewName = (typeof ADMIN_VIEWS)[number];

describe("resolveAuthView holds a host to the guards the page's data assumes", () => {
  const options = optionsWith({ admin: fakeAdminUserStore(roster) });

  it("throws rather than resolving a guarded page for a route that claims no guards", async () => {
    const c = getAppContext(await contextOf());
    await expect(resolveAuthView(c, options, { name: "adminUsers" } as AuthViewRequest<"adminUsers">)).rejects.toThrow(
      /pass `guarded: AUTH_VIEW_GUARDS.adminUsers`/,
    );
  });

  it("serves no user list to an anonymous request on a route that claims the guards but never ran them", async () => {
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "adminUsers", guarded: AUTH_VIEW_GUARDS.adminUsers });
      return view.ok ? new Response(String(await renderToString(view.data.node))) : view.error;
    }, null);

    const res = await app.request("/page");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("refuses a signed-in non-admin with the status `requireAdmin` itself answers", async () => {
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "adminUsers", guarded: AUTH_VIEW_GUARDS.adminUsers });
      return view.ok ? new Response(String(await renderToString(view.data.node))) : view.error;
    }, member);

    const res = await app.request("/page");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  /** An app serving `name` behind the admin stack `createAuthGuards` wires from `onForbidden`, for an administrator the chain admits, demoted after it when `demoted`. */
  function adminViewApp(onForbidden: AuthAdminGuardOptions["onForbidden"], demoted: boolean, name: AdminViewName = "adminUsers"): Forge {
    const guards = [...fakeAdminGuardChain(onForbidden), ...(demoted ? [demoteAuthIdentity] : [])];
    return guardedApp(
      async (c) => {
        const view = await resolveAuthView(c, options, { name, guarded: AUTH_VIEW_GUARDS[name] } as AuthViewRequest<typeof name>);
        return view.ok ? new Response(String(await renderToString(view.data.node))) : view.error;
      },
      admin,
      "/page",
      guards,
    );
  }

  it("refuses a non-admin on every admin-gated view through the `onForbidden` given only to `createAuthGuards`, handed the request's app context", async () => {
    const onForbidden = (c: AppContext) => new Response(`admin only: ${c.url.pathname}`, { status: 403, headers: { "content-type": "text/html" } });
    const answers = [];
    for (const name of ADMIN_VIEWS) {
      const res = await adminViewApp(onForbidden, true, name).request("/page");
      answers.push({ name, status: res.status, type: res.headers.get("content-type"), body: await res.text() });
    }
    expect(answers).toEqual(ADMIN_VIEWS.map((name) => ({ name, status: 403, type: "text/html", body: "admin only: /page" })));
  });

  it("answers a non-admin with what an async `onForbidden` given to `createAuthGuards` resolves to", async () => {
    const res = await adminViewApp(async () => new Response("later", { status: 451 }), true).request("/page");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 451, body: "later" });
  });

  it("refuses a non-admin with a plain-text 403 behind a `createAuthGuards` chain given no `onForbidden`", async () => {
    const res = await adminViewApp(undefined, true).request("/page");
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
  });

  it("serves an administrator the page without consulting `onForbidden`", async () => {
    const consulted: string[] = [];
    const onForbidden = (c: AppContext) => {
      consulted.push(c.url.pathname);
      return new Response("admin only", { status: 403 });
    };
    const res = await adminViewApp(onForbidden, false).request("/page");
    expect({ status: res.status, consulted }).toEqual({ status: 200, consulted: [] });
  });

  it("needs no claim for a page whose route runs no guards", async () => {
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, fakeAuthWebOptions(), { name: "signin" });
      return view.ok ? new Response(String(await renderToString(view.data.node))) : view.error;
    }, null);

    expect((await app.request("/page")).status).toBe(200);
  });
});

/** A bare request context, for the one assertion that is about the throw and not about a response. */
function contextOf(): Promise<Parameters<typeof getAppContext>[0]> {
  return new Promise((resolve) => {
    const app = new Forge();
    mapHandler(app, "GET", "/page", (context) => {
      resolve(context);
      return new Response("");
    });
    void app.request("/page");
  });
}

describe("resolveAuthView hands a host the props, the node and the status", () => {
  it("returns the same props forge's own loader renders from, and a node built off them", async () => {
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, fakeAuthWebOptions(), { name: "signin", state: { email: "ada@example.com", status: 422 } });
      if (!view.ok) return view.error;
      return Response.json({
        name: view.data.name,
        submitPath: view.data.props.submitPath,
        csrfToken: view.data.props.csrfToken,
        status: view.data.status ?? null,
        node: String(await renderToString(view.data.node)),
      });
    }, null);

    const body = (await (await app.request("/page")).json()) as Record<string, string>;
    expect(body.name).toBe("signin");
    expect(body.submitPath).toBe("/auth/signin");
    expect(body.csrfToken).toBe("csrf-for:/auth/signin");
    expect(body.status).toBe(422 as never);
    expect(attrOf(body.node as string, 'data-slot="form-csrf"', "value")).toBe("csrf-for:/auth/signin");
  });

  it("tells sign-up a second factor follows only where one is mandatory", async () => {
    const adds = async (factors: AuthRequestServices["factors"]): Promise<boolean | null> => {
      const app = guardedApp(async (c) => {
        const view = await resolveAuthView(c, optionsWith({ factors }), { name: "signup" });
        return view.ok ? Response.json(view.data.props.addsSecondFactor) : view.error;
      }, null);
      return (await (await app.request("/page")).json()) as boolean | null;
    };
    expect({
      none: await adds(fakeFactorRegistry([])),
      optional: await adds(fakeFactorRegistry(["totp-app", "passkey"], [])),
      app: await adds(fakeFactorRegistry(["totp-app", "passkey"], ["totp-app"])),
      passkey: await adds(fakeFactorRegistry(["totp-app", "passkey"], ["passkey"])),
    }).toEqual({ none: false, optional: false, app: true, passkey: true });
  });

  it("builds the node off a consumer's own view when the mount replaced this page", async () => {
    const Own: FC<SigninViewProps> = ({ submitPath }) => <section data-view='consumer'>{submitPath}</section>;
    const options = fakeAuthWebOptions({ views: { signin: Own } });
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "signin" });
      return view.ok ? new Response(String(await renderToString(view.data.node))) : view.error;
    }, null);

    expect(await (await app.request("/page")).text()).toBe('<section data-view="consumer">/auth/signin</section>');
  });
});

describe("AuthViewChrome", () => {
  const CARD = "flex flex-col rounded-box border-field border-border bg-card text-card-foreground shadow-sm";

  async function chromed(chrome: { class?: string; level?: 2 }): Promise<string> {
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, fakeAuthWebOptions(), { name: "signin" });
      if (!view.ok) return view.error;
      return new Response(String(await renderToString(<SigninView {...view.data.props} {...chrome} />)));
    }, null);
    return (await app.request("/page")).text();
  }

  it("leaves the root and the heading exactly as they are when the host passes neither", async () => {
    const html = await chromed({});
    expect(tagOf(html, 'data-slot="card"')).toBe(`<div data-slot="card" class="${CARD} mx-auto w-full max-w-md" id="auth-signin">`);
    expect(elementOf(html, "h1", 'class="text-xl"')).toBe('<h1 class="text-xl">Sign in</h1>');
  });

  it("lets the host's own width win over the view's, and demotes the heading it asked to demote", async () => {
    const html = await chromed({ class: "max-w-none", level: 2 });
    expect(tagOf(html, 'data-slot="card"')).toBe(`<div data-slot="card" class="${CARD} mx-auto w-full max-w-none" id="auth-signin">`);
    expect(elementOf(html, "h2", 'class="text-xl"')).toBe('<h2 class="text-xl">Sign in</h2>');
    expect(elementsOf(html, "h1", 'class="text-xl"')).toEqual([]);
  });
});

describe("the factors page served as an htmx fragment", () => {
  const factorsCase = CASES.find((one) => one.label === "adminUserFactors");

  it("resolves at level 2, under the h1 of the edit page it is swapped into", async () => {
    if (factorsCase === undefined) throw new Error("no adminUserFactors case");
    const levels = await Promise.all(
      [{ "HX-Request": "true", "HX-Request-Type": "partial" }, {}].map(async (headers) => {
        const app = guardedApp(
          async (c) => {
            const view = await resolveAuthView(c, factorsCase.options, { name: "adminUserFactors", guarded: AUTH_VIEW_GUARDS.adminUserFactors });
            return view.ok ? Response.json({ level: view.data.props.level ?? null }) : view.error;
          },
          admin,
          "/page/:id",
        );
        return (await (await app.request("/page/u2", { headers })).json()) as { level: number | null };
      }),
    );
    expect(levels).toEqual([{ level: 2 }, { level: null }]);
  });
});

// The hazard `AuthViewChrome` carries is changing what a mount already renders, so every view is
// checked on both sides: the heading it moves, and the bytes it leaves alone when asked nothing.
describe("every view places its heading where the host says", () => {
  async function rendered<Name extends AuthViewName>(one: Case, name: Name, chrome: AuthViewChrome): Promise<string> {
    let html = "";
    const app = guardedApp(
      async (c) => {
        const view = await resolveAuthView(c, one.options, { name, state: one.state ?? {}, guarded: AUTH_VIEW_GUARDS[name] });
        if (!view.ok) return view.error;
        // Cast because `FC` intersects a `children` slot the compiler cannot place on an unresolved
        // `AuthViewProps[Name]`; no view here takes children.
        const View = AUTH_VIEWS[name] as (props: AuthViewProps[Name] & AuthViewChrome) => JSXElement | null;
        html = String(await renderToString(View({ ...view.data.props, ...chrome })));
        return new Response("");
      },
      one.identity ?? null,
      one.pattern ?? "/page",
    );
    await app.request(one.path ?? "/page");
    return html;
  }

  for (const one of CASES) {
    it(`opens ${one.label} on an h1 when its host asks for no level`, async () => {
      expect(/<h[1-6][\s>]/.exec(await rendered(one, one.name, {}))?.[0]).toBe("<h1 ");
    });

    it(`moves ${one.label}'s heading to the level its host asked for`, async () => {
      const html = await rendered(one, one.name, { level: 2 });

      expect(html).not.toMatch(/<h1[\s>]/);
      // The first heading is the view's own; a page with an empty state renders a second below it.
      expect(/<h[1-6][\s>]/.exec(html)?.[0]).toBe("<h2 ");
    });

    // `cn` is a fixed point on a single argument and a spread of `undefined` is an absent prop, so
    // the two renders are the same bytes — which is what makes the new props free for every mount.
    it(`renders ${one.label} identically whether the chrome props are absent or undefined`, async () => {
      expect(await rendered(one, one.name, { class: undefined, level: undefined })).toBe(await rendered(one, one.name, {}));
    });
  }
});

describe("the passkey enrolment page's rendered redirect", () => {
  const owing = (seconds: readonly AuthSecondFactorKind[], mandatory: readonly AuthSecondFactorKind[]) =>
    optionsWith({ users: fakeAuthUserStore([viewer]), factors: fakeFactorRegistry(seconds, mandatory) });
  const redirectOf = async (options: AuthWebOptions) => {
    const html = await (await loaderApp(loadPasskeyEnrol, options, member).request("/page")).text();
    return attrOf(html, `data-scope="${PASSKEY_SCOPE}"`, PASSKEY_REDIRECT_ATTR);
  };

  it("sends a first passkey straight on to generate recovery codes, since the account holds none", async () => {
    expect(await redirectOf(owing(["passkey"], ["passkey"]))).toBe("/account/recovery-codes");
  });

  it("sends it on to recovery codes and not to an optional authenticator app also offered", async () => {
    expect(await redirectOf(owing(["passkey", "totp-app"], ["passkey"]))).toBe("/account/recovery-codes");
  });

  it("sends it on to the authenticator app where that is mandatory too, since every mandatory factor is enrolled in turn", async () => {
    expect(await redirectOf(owing(["passkey", "totp-app"], ["passkey", "totp-app"]))).toBe("/auth/enrol/totp");
  });
});

interface Holding {
  readonly mandatory?: readonly AuthSecondFactorKind[];
  /** Offers the passkey after the authenticator app. */
  readonly passkey?: boolean;
  readonly remaining?: number;
  readonly storeDown?: boolean;
  readonly onRead?: () => void;
}

/** The registry and enrolment rows over one store holding `held` as confirmed, the recovery-code factor counting `remaining` unused codes. */
function holdingServices(
  held: readonly AuthFactorKind[],
  { mandatory = [], passkey = false, remaining = 10, storeDown = false, onRead = () => {} }: Holding = {},
): Pick<AuthRequestServices, "factors" | "enrolments"> {
  const store = fakeFactorStore(held, { down: storeDown, onRead });
  const codes = Object.assign(fakeRecoveryCodeService(), {
    remaining: async () => {
      onRead();
      return ok(remaining);
    },
  });
  const factors = createFactorRegistry(store, {
    primary: fakeFactorService("email-otp"),
    second: fakeSecondFactorOffering(passkey ? ["totp-app", "passkey"] : ["totp-app"], mandatory, codes),
  });
  return { factors, enrolments: store };
}

const unproved: AuthIdentity = { ...member, stepUpAt: null };

const choicesOf = (html: string) =>
  elementsOf(html, "a", 'data-ref="verify-choice"').map((link) => [attrOf(link, "href", "href"), textOf(link, "a", 'data-ref="verify-choice"')]);

describe("the verify page's step-up picker", () => {
  const verifyOf = async (held: readonly AuthFactorKind[], path: string) => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(held) });
    const html = await (await loaderApp(loadVerify, options, unproved).request(path)).text();
    return {
      prompt: textOf(html, "div", 'data-slot="card-description"'),
      action: attrOf(html, "action", "action"),
      field: attrOf(html, 'name="code"', "data-slot"),
      choices: choicesOf(html),
    };
  };

  it("offers every other confirmed second factor by a link that keeps the return-to, and posts the one it asks for", async () => {
    expect(await verifyOf(["totp-app", "recovery-code"], "/page?next=%2Fapp")).toEqual({
      prompt: "Enter the current code from your authenticator app.",
      action: "/auth/verify?next=%2Fapp&amp;factor=totp-app",
      field: "otp-input",
      choices: [["/auth/verify?next=%2Fapp&amp;factor=recovery-code", "Use a recovery code instead"]],
    });
  });

  it("switches to the factor the query names when the account holds it, asking for it in a free-text field", async () => {
    expect(await verifyOf(["totp-app", "recovery-code"], "/page?next=%2Fapp&factor=recovery-code")).toEqual({
      prompt: "Enter one of your recovery codes.",
      action: "/auth/verify?next=%2Fapp&amp;factor=recovery-code",
      field: "input",
      choices: [["/auth/verify?next=%2Fapp&amp;factor=totp-app", "Use your authenticator app instead"]],
    });
  });

  for (const forged of ["passkey", "email-otp", "recovery-code", "nonsense", ""]) {
    it(`falls back to the first held factor for a query naming ${forged === "" ? "nothing" : `"${forged}"`}, which this account cannot step up with`, async () => {
      const page = await verifyOf(["totp-app"], `/page?factor=${forged}`);
      expect({ prompt: page.prompt, action: page.action }).toEqual({
        prompt: "Enter the current code from your authenticator app.",
        action: "/auth/verify?factor=totp-app",
      });
    });
  }

  it("offers no picker to an account holding a single second factor", async () => {
    expect((await verifyOf(["totp-app"], "/page")).choices).toEqual([]);
  });
});

describe("the verify page's recovery-standing lookup", () => {
  const verifyReading = async (held: readonly AuthFactorKind[], holding: Holding) => {
    let reads = 0;
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(held, { ...holding, onRead: () => (reads += 1) }) });
    const html = await (await loaderApp(loadVerify, options, unproved).request("/page?next=%2Fapp")).text();
    return { html, reads };
  };

  it("reads only the demand's own resolution for an authenticator-app step-up, which renders no passkey ceremony", async () => {
    const { html, reads } = await verifyReading(["totp-app"], {});
    expect({ prompt: textOf(html, "div", 'data-slot="card-description"'), reads }).toEqual({
      prompt: "Enter the current code from your authenticator app.",
      reads: 1,
    });
  });

  const passkeyCases: readonly { label: string; held: readonly AuthFactorKind[]; remaining?: number; expected: string; reads: number }[] = [
    {
      label: "sends a passkey step-up by a holder who never confirmed codes on to generate them, return-to kept, counting no codes",
      held: ["passkey"],
      expected: "/account/recovery-codes?next=%2Fapp",
      reads: 1,
    },
    {
      label: "sends a passkey step-up by a holder with codes to spare on to the return-to, counting their codes",
      held: ["passkey", "recovery-code"],
      remaining: 2,
      expected: "/app",
      reads: 2,
    },
  ];

  for (const { label, held, remaining, expected, reads: expectedReads } of passkeyCases) {
    it(label, async () => {
      const { html, reads } = await verifyReading(held, { passkey: true, ...(remaining === undefined ? {} : { remaining }) });
      expect({ redirect: attrOf(html, `data-scope="${PASSKEY_SCOPE}"`, PASSKEY_REDIRECT_ATTR), reads }).toEqual({
        redirect: expected,
        reads: expectedReads,
      });
    });
  }
});

describe("the verify page's resend control after a `?resent` stamp", () => {
  const NOW = 10_000_000;
  const WINDOW_MS = 45_000;
  const ASKED = "If another code was due, it is on its way — check your inbox.";

  function signinWith(reissueAfterMs: number | null): AuthWebOptions {
    const primary = { ...fakeFactorService("email-otp"), reissueAfterMs };
    const services = fakeAuthServices({ factors: createFactorRegistry(fakeFactorStore([]), { primary }) });
    return fakeAuthWebOptions({ resolveServices: () => services, now: () => NOW });
  }

  async function resendControl(query: string, reissueAfterMs: number | null = WINDOW_MS) {
    const html = await (await loaderApp(loadVerify, signinWith(reissueAfterMs), null).request(`/page${query}`)).text();
    return { notice: textOf(html, "div", 'data-slot="alert-description"'), disabled: attrsOf(html, 'data-ref="verify-resend"')["disabled"] };
  }

  const STAMPS = [
    {
      label: "holds the control inside the window and names the wait still left",
      query: `?resent=${NOW - 15_000}`,
      expected: { notice: `${ASKED} You can ask again in 30 seconds.`, disabled: "" },
    },
    {
      label: "re-opens the control once the window has fully elapsed",
      query: `?resent=${NOW - WINDOW_MS}`,
      expected: { notice: ASKED, disabled: undefined },
    },
    { label: "re-opens the control long after the window", query: `?resent=${NOW - 3_600_000}`, expected: { notice: ASKED, disabled: undefined } },
    {
      label: "reads a stamp dated into the future as now, holding the control for one whole window",
      query: `?resent=${NOW + 3_600_000}`,
      expected: { notice: `${ASKED} You can ask again in 45 seconds.`, disabled: "" },
    },
    {
      label: "shows the notice with the control live for an unparseable stamp",
      query: "?resent=soon",
      expected: { notice: ASKED, disabled: undefined },
    },
    // A negative number, which the digits-only stamp refuses rather than reading as long ago.
    { label: "shows the notice with the control live for a signed stamp", query: "?resent=-5", expected: { notice: ASKED, disabled: undefined } },
    { label: "shows the notice with the control live for a bare `?resent`", query: "?resent", expected: { notice: ASKED, disabled: undefined } },
    { label: "says nothing and leaves the control live with no `?resent` at all", query: "", expected: { notice: "", disabled: undefined } },
  ] as const;

  for (const { label, query, expected } of STAMPS) {
    it(label, async () => {
      expect(await resendControl(query)).toEqual(expected);
    });
  }

  it("leaves the control live inside what would be a window when the factor enforces no reissue wait", async () => {
    expect(await resendControl(`?resent=${NOW - 1_000}`, null)).toEqual({ notice: ASKED, disabled: undefined });
  });
});

describe("the verify page for a session holding no second factor", () => {
  /** A real sign-in flow over an emailed-code primary, recording what it mails and what it defers. */
  async function mailingOptions() {
    const sent: AuthMessage[] = [];
    const deferred: Promise<unknown>[] = [];
    const state: OtpStateStore = {
      issue: async () => ok(true),
      countAttempt: async () => ok(null),
      read: async () => ok(null),
      discard: async () => ok(),
      clear: async () => ok(),
    };
    const keys = await importAuthKeyRing(["17bd3b2b6521b7cfde60fad521de43d2860704680c51641152e6e05aa786d162"]);
    const nonces = { markConsumed: async () => ok(true) };
    const notifier = { send: async (message: AuthMessage) => (sent.push(message), ok()) };
    const emailOtp = createEmailOtpFactor({ keys, state, nonces, notifier, address: () => ok(viewer.email) });
    const users = fakeAuthUserStore([viewer]);
    const factors = createFactorRegistry(fakeFactorStore([]), { primary: emailOtp });
    const signin = createSigninFlow({ keys, users, state, nonces, factors, defer: (work) => void deferred.push(work) });
    return { options: optionsWith({ users, factors, signin }), sent, deferred };
  }

  const NO_CODE = { prompt: "Send yourself a code by email, then enter it here.", button: "Send a code", resends: true };
  const SITES = [{ "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Site": "none" }, { "Sec-Fetch-Site": "cross-site" }, {}];

  async function arrive(identity: AuthIdentity, path = "/page?next=%2Fapp") {
    const { options, sent, deferred } = await mailingOptions();
    const app = loaderApp(loadVerify, options, identity);
    const pages = [];
    for (const headers of SITES) {
      const html = await (await app.request(path, { headers })).text();
      pages.push({
        prompt: textOf(html, "div", 'data-slot="card-description"'),
        button: textOf(html, "button", 'data-ref="verify-resend"'),
        resends: html.includes('action="/auth/verify/resend?next=%2Fapp"'),
      });
    }
    await Promise.all(deferred);
    return { mailed: sent.length, pages };
  }

  it("mails nothing to a stale arrival, whatever `Sec-Fetch-Site` says, and offers to send a code", async () => {
    expect(await arrive(unproved)).toEqual({ mailed: 0, pages: SITES.map(() => NO_CODE) });
  });

  it("mails nothing to a fresh arrival either, and offers to send a code", async () => {
    expect(await arrive({ ...member, stepUpAt: Date.now() - 1_000 })).toEqual({ mailed: 0, pages: SITES.map(() => NO_CODE) });
  });

  it("asks for the emailed code once the visitor is back from the resend action", async () => {
    const { pages } = await arrive(unproved, `/page?next=%2Fapp&${AUTH_RESENT_PARAM}=1`);
    expect(pages[0]).toEqual({ prompt: "Enter the code we emailed you.", button: "Send another code", resends: true });
  });

  it("mails nothing when the page re-renders a refused code, so the code being typed stays the live one", async () => {
    const { options, sent, deferred } = await mailingOptions();
    const app = guardedApp((c) => loadVerify(c as never, options, { error: "That did not match.", status: 422 }), unproved, "/page");
    mapHandler(app, "POST", "/page", (c) => loadVerify(c as never, options, { error: "That did not match.", status: 422 }));
    await app.request("/page", { method: "POST" });
    await Promise.all(deferred);
    expect(sent).toEqual([]);
  });
});

describe("the verify page for an owed enrolment beside a confirmed second factor", () => {
  const owing = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(["recovery-code"], { mandatory: ["totp-app"] }) });

  /** The verify page behind the `resolve-auth` its group mounts, whose window is 30 seconds, for a session marked `stepUpAt`. */
  const verifyMarked = async (stepUpAt: number | null) => {
    const guard = resolveAuth({ sessions: () => fakeAuthSessionStore([viewer]), stepUpMaxAgeMs: 30_000 });
    const res = await guardedApp((c) => loadVerify(c as never, owing), { ...member, stepUpAt }, "/page", [guard]).request("/page");
    return { status: res.status, location: res.headers.get("location"), prompt: textOf(await res.text(), "div", 'data-slot="card-description"') };
  };
  const asksForCode = { status: 200, location: null, prompt: "Enter one of your recovery codes." };

  it("asks a session that has not proved the held factor for it, rather than sending it to enrol on email alone", async () => {
    expect(await verifyMarked(null)).toEqual(asksForCode);
  });

  it("asks again for a mark older than the guard's window, as the enrol page's guard does", async () => {
    expect(await verifyMarked(Date.now() - 60_000)).toEqual(asksForCode);
  });

  it("asks again for a mark dated into the future", async () => {
    expect(await verifyMarked(Date.now() + 3_600_000)).toEqual(asksForCode);
  });

  it("sends a session whose mark holds on to the enrolment it still owes", async () => {
    expect(await verifyMarked(Date.now() - 5_000)).toEqual({ status: 303, location: "/auth/enrol/totp", prompt: "" });
  });

  it("navigates an htmx request on to the enrolment it still owes with HX-Redirect, and a plain one with 303", async () => {
    const guard = resolveAuth({ sessions: () => fakeAuthSessionStore([viewer]), stepUpMaxAgeMs: 30_000 });
    const app = guardedApp((c) => loadVerify(c as never, owing), { ...member, stepUpAt: Date.now() - 5_000 }, "/page", [guard]);
    const answers = await Promise.all(
      [{ "HX-Request": "true" }, {}].map(async (headers) => {
        const res = await app.request("/page", { headers });
        return { status: res.status, location: res.headers.get("location"), redirect: res.headers.get("hx-redirect") };
      }),
    );
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/auth/enrol/totp" },
      { status: 303, location: "/auth/enrol/totp", redirect: null },
    ]);
  });

  it("asks for the held factor whatever the mark when no guard established the window to measure it by", async () => {
    const res = await loaderApp(loadVerify, owing, member).request("/page");
    expect({ status: res.status, prompt: textOf(await res.text(), "div", 'data-slot="card-description"') }).toEqual({
      status: 200,
      prompt: "Enter one of your recovery codes.",
    });
  });
});

describe("the account passkey enrolment page's step-up check", () => {
  const NOW = 10_000_000;
  const WINDOW_MS = 60_000;
  const TO_VERIFY = { status: 302, location: "/auth/verify?next=%2Faccount%2Fpasskeys%2Fnew" };
  const RENDERED = { status: 200, location: null };

  const holding = (held: readonly AuthFactorKind[]) =>
    optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(held, { passkey: true }) });

  /** The page behind the `require-fresh-step-up` its group mounts, with a one-minute window at `NOW`, for a session marked `stepUpAt`. */
  function enrolApp(options: AuthWebOptions, stepUpAt: number | null, guarded = true): Forge {
    const guard = requireFreshStepUp({
      factors: () => holdingServices([]).factors,
      enrolmentPaths: { kinds: {} },
      stepUpPath: "/auth/verify",
      settledPath: "/account/passkeys",
      freshStepUpMaxAgeMs: WINDOW_MS,
      now: () => NOW,
    });
    return guardedApp((c) => loadAccountPasskeyEnrol(c as never, options), { ...member, stepUpAt }, "/page", guarded ? [guard] : []);
  }

  const answerOf = async (app: Forge) => {
    const res = await app.request("/page");
    return { status: res.status, location: res.headers.get("location") };
  };

  const STEP_UP_HELD = ["totp-app", "recovery-code"] as const;

  const MARKS = [
    { label: "sends a stale step-up to verify, returning here", held: STEP_UP_HELD, stepUpAt: NOW - WINDOW_MS, expected: TO_VERIFY },
    { label: "sends a session that never stepped up to verify", held: STEP_UP_HELD, stepUpAt: null, expected: TO_VERIFY },
    { label: "sends a mark dated into the future to verify", held: STEP_UP_HELD, stepUpAt: NOW + 1, expected: TO_VERIFY },
    { label: "renders for a step-up inside the window", held: STEP_UP_HELD, stepUpAt: NOW - WINDOW_MS + 1, expected: RENDERED },
    {
      label: "sends a stale single-factor session to verify, as the guard on the ceremony would",
      held: [],
      stepUpAt: NOW - WINDOW_MS,
      expected: TO_VERIFY,
    },
    { label: "renders for a single-factor step-up inside the window", held: [], stepUpAt: NOW - WINDOW_MS + 1, expected: RENDERED },
  ] as const;

  for (const { label, held, stepUpAt, expected } of MARKS) {
    it(label, async () => {
      expect(await answerOf(enrolApp(holding(held), stepUpAt))).toEqual(expected);
    });
  }

  it("renders a stale step-up when no guard established the window, leaving the ceremony's own guard to refuse it", async () => {
    expect(await answerOf(enrolApp(holding(STEP_UP_HELD), NOW - WINDOW_MS, false))).toEqual(RENDERED);
  });

  it("carries the return-to under the parameter the mount renamed it to", async () => {
    const services = fakeAuthServices({ users: fakeAuthUserStore([viewer]), ...holdingServices(STEP_UP_HELD, { passkey: true }) });
    const options = fakeAuthWebOptions({ resolveServices: () => services, returnParam: "back" });
    expect(await answerOf(enrolApp(options, null))).toEqual({ status: 302, location: "/auth/verify?back=%2Faccount%2Fpasskeys%2Fnew" });
  });

  it("navigates an htmx request to verify with HX-Redirect", async () => {
    const res = await enrolApp(holding(STEP_UP_HELD), null).request("/page", { headers: { "HX-Request": "true" } });
    expect({ status: res.status, redirect: res.headers.get("hx-redirect") }).toEqual({
      status: 204,
      redirect: "/auth/verify?next=%2Faccount%2Fpasskeys%2Fnew",
    });
  });

  it("judges the mark alone, so a fresh one is not sent to verify while the factor demand cannot be read, and the page answers 503", async () => {
    const held = holdingServices(STEP_UP_HELD, { passkey: true });
    const down = { ...held.factors, resolve: async () => err(new Error("store down") as never) };
    expect(await answerOf(enrolApp(optionsWith({ users: fakeAuthUserStore([viewer]), ...held, factors: down }), NOW))).toEqual({
      status: 503,
      location: null,
    });
  });

  const contractOf = async (held: readonly AuthFactorKind[]) => {
    const html = await (await enrolApp(holding(held), NOW).request("/page")).text();
    const scope = `data-scope="${PASSKEY_SCOPE}"`;
    return [
      attrOf(html, scope, PASSKEY_OPTIONS_PATH_ATTR),
      attrOf(html, scope, PASSKEY_VERIFY_PATH_ATTR),
      attrOf(html, scope, PASSKEY_REDIRECT_ATTR),
    ];
  };

  it("runs its ceremony on the account endpoints and renders a return to the passkey list once codes are in hand", async () => {
    expect(await contractOf(STEP_UP_HELD)).toEqual(["/account/passkeys/register/begin", "/account/passkeys/register/finish", "/account/passkeys"]);
  });

  it("renders a first recoverable passkey's redirect on to generate recovery codes", async () => {
    expect((await contractOf([]))[2]).toBe("/account/recovery-codes");
  });
});

describe("the passkey list's enrolment links", () => {
  it("point both the header action and the empty state at the account enrolment page, which a settled visitor can reach", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([]),
      factors: fakeFactorRegistry(["passkey"]),
    });
    const html = await (await loaderApp(loadPasskeyList, options, admin).request("/page")).text();
    expect([attrOf(html, 'data-ref="passkey-enrol"', "href"), attrOf(html, 'data-ref="passkey-enrol-empty"', "href")]).toEqual([
      "/account/passkeys/new",
      "/account/passkeys/new",
    ]);
  });
});

describe("the passkey backup prompt", () => {
  it("is left off the one-passkey page, which shows a single row whatever the visitor holds", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
      factors: fakeFactorRegistry(["passkey"]),
    });
    const app = guardedApp(
      async (c) => {
        const view = await resolveAuthView(c, options, { name: "accountPasskey", guarded: AUTH_VIEW_GUARDS.accountPasskey });
        return view.ok ? Response.json(view.data.props.backupPrompt) : view.error;
      },
      member,
      "/page/:id",
    );
    expect(await (await app.request("/page/c1")).json()).toBe(false);
  });
});

describe("authAfterStepUpTarget", () => {
  const targetOf = async (held: ReturnType<typeof holdingServices>, verified: AuthFactorKind) => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...held });
    const app = guardedApp(async (c) => targetResponse(await authAfterStepUpTarget(c, options, member, verified, "/otherwise")), member);
    return (await app.request("/page?next=%2Fapp")).text();
  };

  const cases: readonly { label: string; held: ReturnType<typeof holdingServices>; verified: AuthFactorKind; expected: string }[] = [
    {
      label: "lands a step-up by recovery code on the repair page, ahead of any enrolment owed",
      held: holdingServices(["totp-app", "recovery-code"], { mandatory: ["totp-app", "passkey"], passkey: true, remaining: 4 }),
      verified: "recovery-code",
      expected: "/account/factors?recovered=1",
    },
    {
      label: "leaves a holder of the mandatory app on their page, owing no enrolment of the optional passkey",
      held: holdingServices(["totp-app", "recovery-code"], { mandatory: ["totp-app"], passkey: true, remaining: 4 }),
      verified: "totp-app",
      expected: "/otherwise",
    },
    {
      label: "sends a holder of an authenticator who never confirmed codes to generate them, return-to kept",
      held: holdingServices(["totp-app"]),
      verified: "totp-app",
      expected: "/account/recovery-codes?next=%2Fapp",
    },
    {
      label: "sends a holder whose every code is spent to generate a new set",
      held: holdingServices(["totp-app", "recovery-code"], { remaining: 0 }),
      verified: "totp-app",
      expected: "/account/recovery-codes?next=%2Fapp",
    },
    {
      label: "leaves a holder with codes to spare on the page they were going to",
      held: holdingServices(["totp-app", "recovery-code"], { remaining: 1 }),
      verified: "totp-app",
      expected: "/otherwise",
    },
  ];

  for (const { label, held, verified, expected } of cases) {
    it(label, async () => {
      expect(await targetOf(held, verified)).toBe(expected);
    });
  }

  it("answers 503 when the store cannot say where they stand, never the page they were going to", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(["totp-app"], { storeDown: true }) });
    expect(await statusTo((c) => authAfterStepUpTarget(c, options, member, "totp-app", "/otherwise"))).toBe(503);
  });
});

describe("the recovery-code resolvers", () => {
  it("keeps a mandatory passkey's removal disabled however many recovery codes stand beside it", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
      ...holdingServices(["passkey", "recovery-code"], { passkey: true, mandatory: ["passkey"] }),
    });
    expect(await mandatoryOn("accountPasskeys", options)).toBe(true);
  });

  it("lists an implicit factor on the factors panel as always on, and an explicit one without a row as not set up", async () => {
    const options = optionsWith({ ...holdingServices([]), credentials: fakeAuthCredentialStore([]) });
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "accountFactors", guarded: AUTH_VIEW_GUARDS.accountFactors });
      return view.ok ? Response.json(view.data.props.factors) : view.error;
    }, member);
    expect(await (await app.request("/page")).json()).toEqual([
      { kind: "email-otp", state: "always", at: null },
      { kind: "totp-app", state: "none", at: null },
      { kind: "recovery-code", state: "none", at: null },
    ]);
  });

  it("tells a visitor back from a recovery code how many codes they have left", async () => {
    const options = optionsWith({ ...holdingServices(["totp-app", "recovery-code"], { remaining: 3 }) });
    const html = await (await loaderApp(loadAccountFactors, options, member).request("/page?recovered=1")).text();
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(
      "You have 3 unused codes left. If your authenticator app or passkey no longer works, add a new one below before you remove the old one, then generate a new set of codes.",
    );
  });

  it("says nothing about recovery on a factors page reached any other way", async () => {
    const options = optionsWith({ ...holdingServices(["totp-app", "recovery-code"], { remaining: 3 }) });
    const html = await (await loaderApp(loadAccountFactors, options, member).request("/page")).text();
    expect(tagOf(html, 'data-ref="factors-recovered"')).toBe("");
  });

  it("offers an administrator the reset of someone else's factors, posted with a token minted for that account's reset path", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore([...roster, viewer]), ...holdingServices(["totp-app"]) });
    const html = await (await loaderApp(loadAdminUserFactors, options, admin, "/page/:id").request("/page/u2")).text();
    const form = elementOf(html, "form", 'action="/admin/users/u2/factors/reset"');
    expect(attrOf(form, 'name="_csrf"', "value")).toBe("csrf-for:/admin/users/u2/factors/reset");
  });

  it("titles an administrator's view of someone else's factors by the same word the holder's own page uses", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore([...roster, viewer]), ...holdingServices(["totp-app"]) });
    const html = await (await loaderApp(loadAdminUserFactors, options, admin, "/page/:id").request("/page/u2")).text();
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Factors");
  });

  it("offers no reset on an administrator's own factors, which would lock them out of the console they stand in", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore([...roster, viewer]), ...holdingServices(["totp-app"]) });
    const html = await (await loaderApp(loadAdminUserFactors, options, admin, "/page/:id").request("/page/u9")).text();
    expect(elementsOf(html, "form", 'action="/admin/users/u9/factors/reset"')).toEqual([]);
    expect(tagOf(html, 'data-ref="factors-reset"')).toBe("");
  });

  it("counts the confirmed set's unused codes on the codes page, and posts each form on its own path and token", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(["totp-app", "recovery-code"], { remaining: 3 }) });
    const html = await (
      await loaderApp(loadRecoveryCodes, options, member, "/page", { issuedCodes: ["AAAA-BBBB"] }).request("/page?next=%2Fapp")
    ).text();
    const tokenOf = (action: string) => attrOf(elementOf(html, "form", `action="${action}"`), 'name="_csrf"', "value");
    expect({
      standing: textOf(html, "span", 'data-ref="recovery-remaining"'),
      generate: tokenOf("/account/recovery-codes?next=%2Fapp"),
      confirm: tokenOf("/account/recovery-codes/confirm?next=%2Fapp"),
    }).toEqual({
      standing: "You have 3 unused recovery codes left.",
      generate: "csrf-for:/account/recovery-codes",
      confirm: "csrf-for:/account/recovery-codes/confirm",
    });
  });

  it("reports no codes for an account whose set was never confirmed, whatever a staged set holds", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), ...holdingServices(["totp-app"], { remaining: 7 }) });
    const html = await (await loaderApp(loadRecoveryCodes, options, member).request("/page")).text();
    expect(textOf(html, "span", 'data-ref="recovery-remaining"')).toBe("You have no recovery codes yet.");
  });
});

describe("the factors panel's enrolment rows", () => {
  it("lists a begun enrolment that was never confirmed as pending since it began", async () => {
    const store = fakeFactorStore([{ kind: "totp-app", confirmedAt: null, createdAt: 42 }]);
    const factors = fakeFactorRegistry(["totp-app"], [], store);
    const options = optionsWith({ factors, enrolments: store, credentials: fakeAuthCredentialStore([]) });
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "accountFactors", guarded: AUTH_VIEW_GUARDS.accountFactors });
      return view.ok ? Response.json(view.data.props.factors) : view.error;
    }, member);
    expect(await (await app.request("/page")).json()).toEqual([
      { kind: "email-otp", state: "always", at: null },
      { kind: "totp-app", state: "pending", at: 42 },
      { kind: "recovery-code", state: "none", at: null },
    ]);
  });

  it("answers 503 when the enrolment rows cannot be read", async () => {
    const options = optionsWith({ ...holdingServices(["totp-app"], { storeDown: true }), credentials: fakeAuthCredentialStore([]) });
    expect((await loaderApp(loadAccountFactors, options, member).request("/page")).status).toBe(503);
  });
});

const STORED_USER = "018f0000-0000-7000-8000-000000000009";
const FACTORS_READ = "SELECT * FROM auth_factors WHERE user_id = ? ORDER BY id";
const CONFIRMED_KINDS_READ =
  "SELECT kind FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL";
const CREDENTIALS_READ = "SELECT * FROM auth_credentials WHERE user_id = ? ORDER BY id";

interface Stored {
  readonly offered?: readonly ("passkey" | "totp-app")[];
  readonly refuseListing?: boolean;
}

/** Options over the real factor and credential stores on one `fakeAuthD1` account holding `held`, each factor listing its rows through them and the recovery-code one counting four codes in memory. */
function storedOptions(held: readonly FakeAuthFactor[], { offered = ["totp-app"], refuseListing = false }: Stored = {}) {
  const db = fakeAuthD1([{ id: STORED_USER, email: "grace@example.com", factors: held }]);
  const client = createD1Client(db as never);
  const enrolments = createFactorStore(client);
  const listing = <kind extends AuthSecondFactorKind | "recovery-code">(kind: kind): EnrollableFactorService<kind> =>
    refuseListing
      ? {
          ...fakeFactorService(kind),
          listEnrolments: () => {
            throw new Error(`listEnrolments consulted for "${kind}"`);
          },
        }
      : {
          ...fakeFactorService(kind),
          listEnrolments: async (userId: string) => {
            const listed = await enrolments.listByUser(userId);
            return listed.ok ? ok(listed.data.filter((factor) => factor.kind === kind)) : listed;
          },
        };
  const codes = Object.assign(listing("recovery-code"), { remaining: async () => ok(4) });
  const factors = createFactorRegistry(enrolments, {
    primary: fakeFactorService("email-otp"),
    second: fakeSecondFactorOffering(offered.map(listing), [], codes),
  });
  const options = optionsWith({ factors, enrolments, credentials: createCredentialStore(client) });
  return { options, statements: () => db.calls.map((call) => squashSql(call.sql)).toSorted() };
}

const stored: AuthIdentity = { ...member, userId: STORED_USER };

describe("the factor resolvers over the real stores — the statements one page issues", () => {
  const HOLDS_CODES: readonly FakeAuthFactor[] = [{ kind: "totp-app" }, { kind: "recovery-code" }];

  for (const path of ["/page", "/page?recovered=1"]) {
    it(`reads the factor rows once beside the passkeys for the panel at \`${path}\``, async () => {
      const { options, statements } = storedOptions(HOLDS_CODES);
      const res = await loaderApp(loadAccountFactors, options, stored).request(path);
      expect({ status: res.status, statements: statements() }).toEqual({ status: 200, statements: [CREDENTIALS_READ, FACTORS_READ] });
    });
  }

  it("tells a visitor back from a recovery code their count from that same read", async () => {
    const { options } = storedOptions(HOLDS_CODES);
    const html = await (await loaderApp(loadAccountFactors, options, stored).request("/page?recovered=1")).text();
    expect(textOf(html, "div", 'data-slot="alert-description"')).toStartWith("You have 4 unused codes left.");
  });

  it("reads the passkeys alone for the passkey page, and the factor rows alone for the authenticator-app page", async () => {
    const passkey = storedOptions(HOLDS_CODES, { offered: ["totp-app", "passkey"] });
    const totp = storedOptions(HOLDS_CODES, { offered: ["totp-app", "passkey"] });
    const statuses = [
      (await loaderApp(loadPasskeyList, passkey.options, stored).request("/page")).status,
      (await loaderApp(loadTotpEnrol, totp.options, stored).request("/page")).status,
    ];
    expect({ statuses, passkey: passkey.statements(), totp: totp.statements() }).toEqual({
      statuses: [200, 200],
      passkey: [CREDENTIALS_READ],
      totp: [FACTORS_READ],
    });
  });

  it("reads the factor rows once for the recovery-codes page", async () => {
    const { options, statements } = storedOptions(HOLDS_CODES);
    const html = await (await loaderApp(loadRecoveryCodes, options, stored).request("/page")).text();
    expect({ standing: textOf(html, "span", 'data-ref="recovery-remaining"'), statements: statements() }).toEqual({
      standing: "You have 4 unused recovery codes left.",
      statements: [FACTORS_READ],
    });
  });

  const targetOf = async (options: AuthWebOptions, target: (c: AppContext) => Promise<Result<string, Response>>) => {
    const app = guardedApp(async (c) => targetResponse(await target(c)), stored);
    return (await app.request("/page")).text();
  };

  it("judges the post-enrolment target from the registry's one resolution", async () => {
    const { options, statements } = storedOptions([]);
    const target = await targetOf(options, (c) => authAfterEnrolTarget(c, options, stored, "totp-app", "/otherwise"));
    expect({ target, statements: statements() }).toEqual({ target: "/account/recovery-codes", statements: [CONFIRMED_KINDS_READ] });
  });

  it("judges the post-step-up target from the registry's one resolution", async () => {
    const { options, statements } = storedOptions(HOLDS_CODES);
    const target = await targetOf(options, (c) => authAfterStepUpTarget(c, options, stored, "totp-app", "/otherwise"));
    expect({ target, statements: statements() }).toEqual({ target: "/otherwise", statements: [CONFIRMED_KINDS_READ] });
  });

  it("ignores a leftover row of a kind no longer offered, in the standing and on the panel", async () => {
    const { options } = storedOptions([{ kind: "passkey" }, { kind: "recovery-code" }]);
    const app = guardedApp(async (c) => {
      const standing = await resolveRecoveryStanding(await authServices(c, options), STORED_USER);
      const view = await resolveAuthView(c, options, { name: "accountFactors", guarded: AUTH_VIEW_GUARDS.accountFactors });
      return Response.json({ standing, factors: view.ok ? view.data.props.factors : null });
    }, stored);
    expect(await (await app.request("/page")).json()).toEqual({
      standing: { recoverable: false, confirmed: true, remaining: 4 },
      factors: [
        { kind: "email-otp", state: "always", at: null },
        { kind: "totp-app", state: "none", at: null },
        { kind: "recovery-code", state: "enrolled", at: 1 },
      ],
    });
  });

  it("no longer consults a factor's own `listEnrolments` on any of these pages", async () => {
    const { options } = storedOptions([{ kind: "passkey" }, ...HOLDS_CODES], { offered: ["totp-app", "passkey"], refuseListing: true });
    const statuses = await Promise.all(
      [
        loaderApp(loadAccountFactors, options, stored).request("/page?recovered=1"),
        loaderApp(loadRecoveryCodes, options, stored).request("/page"),
        loaderApp(loadPasskeyList, options, stored).request("/page"),
        loaderApp(loadTotpEnrol, options, stored).request("/page"),
      ].map(async (pending) => (await pending).status),
    );
    const target = await targetOf(options, (c) => authAfterEnrolTarget(c, options, stored, "passkey", "/otherwise"));
    expect({ statuses, target }).toEqual({ statuses: [200, 200, 200, 200], target: "/otherwise" });
  });
});

interface Laying {
  readonly seconds?: readonly ("totp-app" | "passkey")[];
  readonly mandatory?: readonly AuthSecondFactorKind[];
  readonly remaining?: number | "down";
  readonly storeDown?: boolean;
  readonly credentialsDown?: boolean;
}

/** Options over one `fakeFactorStore` holding `rows` in that order, offering email-OTP, then `seconds` in theirs, then recovery codes. */
function laidOut(
  rows: Parameters<typeof fakeFactorStore>[0],
  { seconds = ["totp-app", "passkey"], mandatory = [], remaining = 5, storeDown = false, credentialsDown = false }: Laying = {},
): AuthWebOptions {
  const store = fakeFactorStore(rows, { down: storeDown });
  const codes = Object.assign(fakeRecoveryCodeService(), {
    remaining: async () => (remaining === "down" ? err(new AuthStoreError("unavailable", "remaining")) : ok(remaining)),
  });
  const factors = createFactorRegistry(store, {
    primary: fakeFactorService("email-otp"),
    second: fakeSecondFactorOffering(seconds, mandatory, codes),
  });
  const listed = fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]);
  const passkeys = credentialsDown
    ? { ...listed, listByUser: async () => err(new AuthStoreError("unavailable", "credentials.listByUser")) }
    : listed;
  return optionsWith({ users: fakeAuthUserStore([viewer]), factors, enrolments: store, credentials: passkeys });
}

async function panelFactorsOf(options: AuthWebOptions): Promise<unknown> {
  const app = guardedApp(async (c) => {
    const view = await resolveAuthView(c, options, { name: "accountFactors", guarded: AUTH_VIEW_GUARDS.accountFactors });
    return view.ok ? Response.json(view.data.props.factors) : view.error;
  }, member);
  return (await app.request("/page")).json();
}

/** The page's `mandatory` as `identity` reads it, or the status it refused with. */
async function mandatoryOn(
  name: "accountPasskeys" | "accountTotp",
  options: AuthWebOptions,
  identity: AuthIdentity = member,
): Promise<boolean | number> {
  const app = guardedApp(async (c) => {
    const view = await resolveAuthView(c, options, { name, guarded: AUTH_VIEW_GUARDS[name] });
    return view.ok ? Response.json(view.data.props.mandatory) : view.error;
  }, identity);
  const res = await app.request("/page");
  return res.ok ? ((await res.json()) as boolean) : res.status;
}

async function standingOf(options: AuthWebOptions): Promise<unknown> {
  const app = guardedApp(async (c) => Response.json(await resolveRecoveryStanding(await authServices(c, options), member.userId)), member);
  return (await app.request("/page")).json();
}

/** The target as a response: its path as the body, or the refusal it answered with. */
function targetResponse(target: Result<string, Response>): Response {
  return target.ok ? new Response(target.data) : target.error;
}

async function answerTo(options: AuthWebOptions, target: (c: AppContext) => Promise<Result<string, Response>>): Promise<string> {
  const app = guardedApp(async (c) => targetResponse(await target(c)), member);
  return (await app.request("/page?next=%2Fapp")).text();
}

async function statusTo(target: (c: AppContext) => Promise<Result<string, Response>>): Promise<number> {
  const app = guardedApp(async (c) => targetResponse(await target(c)), member);
  return (await app.request("/page?next=%2Fapp")).status;
}

describe("the passkey and authenticator-app pages disable removing a mandatory factor", () => {
  const pageOptions = (mandatory: readonly AuthSecondFactorKind[], held: readonly AuthFactorKind[], passkeys = 1) =>
    optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore(
        Array.from({ length: passkeys }, (_, index) => fakeAuthCredential({ id: `c${index + 1}`, userId: "u9" })),
      ),
      ...holdingServices(held, { passkey: true, mandatory }),
    });
  const cases: readonly {
    label: string;
    page: "accountPasskeys" | "accountTotp";
    mandatory: readonly AuthSecondFactorKind[];
    held: readonly AuthFactorKind[];
    passkeys?: number;
    identity?: AuthIdentity;
    expected: boolean;
  }[] = [
    { label: "the one passkey, passkeys mandatory", page: "accountPasskeys", mandatory: ["passkey"], held: ["passkey"], expected: true },
    {
      label: "one of two passkeys, passkeys mandatory",
      page: "accountPasskeys",
      mandatory: ["passkey"],
      held: ["passkey"],
      passkeys: 2,
      expected: false,
    },
    {
      label: "the one passkey beside an app, both mandatory",
      page: "accountPasskeys",
      mandatory: ["totp-app", "passkey"],
      held: ["passkey", "totp-app"],
      expected: true,
    },
    {
      label: "the one passkey beside a mandatory app, passkeys optional",
      page: "accountPasskeys",
      mandatory: ["totp-app"],
      held: ["passkey", "totp-app"],
      expected: false,
    },
    { label: "the one passkey, nothing mandatory", page: "accountPasskeys", mandatory: [], held: ["passkey"], expected: false },
    { label: "the app, the app mandatory", page: "accountTotp", mandatory: ["totp-app"], held: ["totp-app"], expected: true },
    {
      label: "the app beside a passkey, the app mandatory",
      page: "accountTotp",
      mandatory: ["totp-app"],
      held: ["totp-app", "passkey"],
      expected: true,
    },
    {
      label: "the app beside a mandatory passkey, the app optional",
      page: "accountTotp",
      mandatory: ["passkey"],
      held: ["totp-app", "passkey"],
      expected: false,
    },
    { label: "the app, nothing mandatory", page: "accountTotp", mandatory: [], held: ["totp-app"], expected: false },
    { label: "an admin's app, nothing mandatory", page: "accountTotp", mandatory: [], held: ["totp-app"], identity: admin, expected: false },
  ];

  for (const { label, page, mandatory, held, passkeys, identity, expected } of cases) {
    it(`${expected ? "disables" : "leaves live"} removing ${label}`, async () => {
      expect(await mandatoryOn(page, pageOptions(mandatory, held, passkeys), identity)).toBe(expected);
    });
  }
});

describe("the factor resolvers reading one account's rows at once", () => {
  const orderings: readonly { label: string; seconds: readonly ("totp-app" | "passkey")[]; expected: readonly unknown[] }[] = [
    {
      label: "authenticator app before passkey",
      seconds: ["totp-app", "passkey"],
      expected: [
        { kind: "email-otp", state: "always", at: null },
        { kind: "totp-app", state: "enrolled", at: 10 },
        { kind: "passkey", state: "enrolled", at: 20 },
        { kind: "recovery-code", state: "enrolled", at: 30 },
      ],
    },
    {
      label: "passkey before authenticator app",
      seconds: ["passkey", "totp-app"],
      expected: [
        { kind: "email-otp", state: "always", at: null },
        { kind: "passkey", state: "enrolled", at: 20 },
        { kind: "totp-app", state: "enrolled", at: 10 },
        { kind: "recovery-code", state: "enrolled", at: 30 },
      ],
    },
  ];

  for (const { label, seconds, expected } of orderings) {
    it(`lists the panel in the offered order, ${label}, whatever order the rows come back in`, async () => {
      const rows = [
        { kind: "recovery-code" as const, confirmedAt: 30 },
        { kind: "passkey" as const, confirmedAt: 20 },
        { kind: "totp-app" as const, confirmedAt: 10 },
      ];
      expect(await panelFactorsOf(laidOut(rows, { seconds }))).toEqual(expected);
    });
  }

  it("answers 503 on the authenticator-app page when the enrolments cannot be read, never the app as though it were not held", async () => {
    expect(await mandatoryOn("accountTotp", laidOut([{ kind: "totp-app" }], { mandatory: ["totp-app"], storeDown: true }))).toBe(503);
  });

  it("counts neither begun factors nor a staged code set towards the recovery standing", async () => {
    const rows = [
      { kind: "totp-app" as const, confirmedAt: null },
      { kind: "passkey" as const, confirmedAt: null },
      { kind: "recovery-code" as const, confirmedAt: null },
    ];
    expect(await standingOf(laidOut(rows))).toEqual({ recoverable: false, confirmed: false, remaining: null });
  });

  it("holds no standing on rows left behind by a deployment that has stopped offering second factors", async () => {
    const store = fakeFactorStore(["totp-app", "passkey", "recovery-code"]);
    const factors = fakeFactorRegistry([], [], store);
    expect(await standingOf(optionsWith({ factors, enrolments: store }))).toEqual({ recoverable: false, confirmed: false, remaining: null });
  });

  it("reports no codes on the codes page while the only set is staged and never typed back", async () => {
    const options = laidOut([{ kind: "totp-app" }, { kind: "recovery-code", confirmedAt: null }], { remaining: 7 });
    const html = await (await loaderApp(loadRecoveryCodes, options, member).request("/page")).text();
    expect(textOf(html, "span", 'data-ref="recovery-remaining"')).toBe("You have no recovery codes yet.");
  });

  it("sends an authenticator holder whose code set is only staged on to generate one after a step-up", async () => {
    const options = laidOut([{ kind: "totp-app" }, { kind: "recovery-code", confirmedAt: null }]);
    expect(await answerTo(options, (c) => authAfterStepUpTarget(c, options, member, "totp-app", "/otherwise"))).toBe(
      "/account/recovery-codes?next=%2Fapp",
    );
  });

  it("answers 503 after an enrolment when the factor demand cannot be read, rather than guessing a page", async () => {
    const store = fakeFactorStore([]);
    const factors = fakeFactorRegistry(["totp-app"], [], store);
    const down = { ...factors, resolve: async () => err(new AuthStoreError("unavailable", "factors.resolve")) };
    const failing = optionsWith({ users: fakeAuthUserStore([viewer]), factors: down, enrolments: store });
    expect(await statusTo((c) => authAfterEnrolTarget(c, failing, member, "totp-app", "/otherwise"))).toBe(503);
  });

  it("answers 503 after a step-up when the remaining codes cannot be counted", async () => {
    const options = laidOut([{ kind: "totp-app" }, { kind: "recovery-code" }], { remaining: "down" });
    expect(await statusTo((c) => authAfterStepUpTarget(c, options, member, "totp-app", "/otherwise"))).toBe(503);
  });

  const refusals: readonly { label: string; load: Loader; path: string; laying: Laying }[] = [
    { label: "the panel, when the passkeys cannot be listed", load: loadAccountFactors, path: "/page", laying: { credentialsDown: true } },
    {
      label: "the panel back from a recovery code, when the codes cannot be counted",
      load: loadAccountFactors,
      path: "/page?recovered=1",
      laying: { remaining: "down" },
    },
    { label: "the passkey page, when the passkeys cannot be listed", load: loadPasskeyList, path: "/page", laying: { credentialsDown: true } },
    { label: "the authenticator-app page, when the rows cannot be read", load: loadTotpEnrol, path: "/page", laying: { storeDown: true } },
    { label: "the codes page, when the rows cannot be read", load: loadRecoveryCodes, path: "/page", laying: { storeDown: true } },
    { label: "the codes page, when the codes cannot be counted", load: loadRecoveryCodes, path: "/page", laying: { remaining: "down" } },
  ];

  for (const { label, load, path, laying } of refusals) {
    it(`answers 503 for ${label}`, async () => {
      const res = await loaderApp(load, laidOut([{ kind: "totp-app" }, { kind: "recovery-code" }], laying), member).request(path);
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 503, body: "Service Unavailable" });
    });
  }

  it("renders the panel reached any other way without counting codes, so an uncountable set refuses nothing", async () => {
    const res = await loaderApp(
      loadAccountFactors,
      laidOut([{ kind: "totp-app" }, { kind: "recovery-code" }], { remaining: "down" }),
      member,
    ).request("/page");
    expect({ status: res.status, recovered: tagOf(await res.text(), 'data-ref="factors-recovered"') }).toEqual({ status: 200, recovered: "" });
  });
});

describe("the pages rendering a passkey's onward redirect answer 503 when the factor demand cannot be read for it", () => {
  const answerOf = async (res: Response) => ({ status: res.status, location: res.headers.get("location"), body: await res.text() });

  it("answers the owed passkey enrolment page with 503", async () => {
    const registry = fakeFactorRegistry(["passkey"], ["passkey"]);
    const down = { ...registry, resolve: async () => err(new AuthStoreError("unavailable", "factors.resolve")) };
    const res = await loaderApp(loadPasskeyEnrol, optionsWith({ users: fakeAuthUserStore([viewer]), factors: down }), member).request("/page");
    expect(await answerOf(res)).toEqual({ status: 503, location: null, body: "Service Unavailable" });
  });

  // The onward target reuses the demand's own resolution, so the read left to fail is the code count.
  it("answers the passkey step-up page with 503 when the recovery codes it would weigh cannot be counted", async () => {
    const options = laidOut([{ kind: "passkey" }, { kind: "recovery-code" }], { remaining: "down" });
    const res = await loaderApp(loadVerify, options, unproved).request("/page?factor=passkey");
    expect(await answerOf(res)).toEqual({ status: 503, location: null, body: "Service Unavailable" });
  });
});

describe("the authenticator-app replacement page", () => {
  const NOW = 50_000_000;
  const FRESH_MS = 900_000;
  const PENDING = { secret: "KRSXG5CT", uri: "otpauth://totp/replace" };
  const replaceable = {
    ...totpService,
    beginReplacement: async () => ok({ kind: "totp-app" as const, expiresAt: NOW, options: PENDING }),
    completeReplacement: async () => err("unavailable" as const),
  } as TotpReplaceableFactorService;

  function replaceOptions(service: AuthSecondFactorService = replaceable): AuthWebOptions {
    const store = fakeFactorStore(["totp-app"]);
    const services = fakeAuthServices({
      users: fakeAuthUserStore([viewer]),
      factors: createFactorRegistry(store, { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([service]) }),
      enrolments: store,
    });
    return fakeAuthWebOptions({ resolveServices: () => services, now: () => NOW });
  }

  /** `load` behind the session and the `require-fresh-step-up` the account group mounts, for a session marked `stepUpAt`. */
  function page(load: Loader, options: AuthWebOptions, stepUpAt: number | null, path = "/page"): Promise<Response> {
    const guard = requireFreshStepUp({
      factors: () => holdingServices([]).factors,
      enrolmentPaths: { kinds: {} },
      stepUpPath: "/auth/verify",
      settledPath: "/account/passkeys",
      now: () => NOW,
    });
    const session = sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie);
    return guardedApp((c) => load(c as never, options), { ...member, stepUpAt }, "/page", [session, guard]).request(path);
  }

  it("shows the new secret and its link, posting to the replacement's own confirmation, after a fresh step-up", async () => {
    const res = await page(loadTotpReplace, replaceOptions(), NOW - 1);
    const html = await res.text();
    expect({
      status: res.status,
      heading: textOf(html, "h1", 'class="text-xl"'),
      secret: textOf(html, "code", 'data-ref="totp-secret"'),
      uri: textOf(html, "code", 'data-ref="totp-uri"'),
      posts: attrOf(html, 'method="post"', "action"),
      keeps: textOf(html, "span", 'data-ref="totp-replacing"'),
    }).toEqual({
      status: 200,
      heading: "Replace your authenticator app",
      secret: PENDING.secret,
      uri: PENDING.uri,
      posts: "/account/totp/replace",
      keeps: "Your current app keeps working until you confirm a code from the new one.",
    });
  });

  // The guard lets a `GET` through on any step-up, so the page is what holds a stale one back.
  it("sends a stale step-up to verify, returning here, before minting anything", async () => {
    let begun = 0;
    const counted = {
      ...replaceable,
      beginReplacement: async (...args: Parameters<TotpReplaceableFactorService["beginReplacement"]>) => {
        begun++;
        return replaceable.beginReplacement(...args);
      },
    } as TotpReplaceableFactorService;
    const answers = [];
    for (const stepUpAt of [NOW - FRESH_MS - 1, null]) {
      const res = await page(loadTotpReplace, replaceOptions(counted), stepUpAt);
      answers.push(res.headers.get("location"));
    }
    expect({ answers, begun }).toEqual({
      answers: ["/auth/verify?next=%2Faccount%2Ftotp%2Freplace", "/auth/verify?next=%2Faccount%2Ftotp%2Freplace"],
      begun: 0,
    });
  });

  it("returns to the authenticator page when there is no confirmed app to replace", async () => {
    const none = { ...replaceable, beginReplacement: async () => err("not-enrolled" as const) } as TotpReplaceableFactorService;
    const res = await page(loadTotpReplace, replaceOptions(none), NOW - 1);
    expect(res.headers.get("location")).toBe("/account/totp");
  });

  it("answers 503 when the pending secret cannot be held", async () => {
    const down = { ...replaceable, beginReplacement: async () => err("unavailable" as const) } as TotpReplaceableFactorService;
    expect((await page(loadTotpReplace, replaceOptions(down), NOW - 1)).status).toBe(503);
  });

  it("links the settled app to its replacement on the account page, and not on the owed-enrolment page or without a replaceable factor", async () => {
    const linkOn = async (load: Loader, options: AuthWebOptions) => {
      const html = await (await page(load, options, NOW - 1)).text();
      return html.includes('data-ref="totp-replace"') ? attrOf(html, 'data-ref="totp-replace"', "href") : null;
    };
    expect([
      await linkOn(loadTotpEnrol, replaceOptions()),
      await linkOn(loadEnrolTotp, replaceOptions()),
      await linkOn(loadTotpEnrol, replaceOptions(totpService)),
    ]).toEqual(["/account/totp/replace", null, null]);
  });

  // A second app row is impossible, so "add a new one before you remove the old one" leads a TOTP-only user nowhere.
  it("sends a visitor back from a recovery code to replace their app, rather than to add a second one", async () => {
    const html = await (await page(loadAccountFactors, replaceOptions(), NOW - 1, "/page?recovered=1")).text();
    expect({
      description: textOf(html, "div", 'data-slot="alert-description"').replace(/<a [^>]*>|<\/a>/g, ""),
      href: attrOf(html, 'data-ref="factors-replace-app"', "href"),
    }).toEqual({
      description:
        "You have 0 unused codes left. If your authenticator app no longer works, replace it. If a passkey no longer works, add a new one below before you remove the old one. Then generate a new set of codes.",
      href: "/account/totp/replace",
    });
  });

  it("says the app went first when a replacement lands back on the authenticator page flagged so", async () => {
    const html = await (await page(loadTotpEnrol, replaceOptions(), NOW - 1, "/page?removed=1")).text();
    expect(textOf(html, "div", 'data-ref="totp-error"')).toContain("Your authenticator app was removed before the replacement finished.");
  });
});
