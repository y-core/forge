/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { renderToString } from "../../jsx/render-to-string";
import type { FC, JSXElement } from "../../jsx/types";
import { err, ok } from "../../result/result";
import { mapHandler } from "../../testing/route";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorRequirement, AuthFactorService } from "../factors/types";
import { PASSKEY_OPTIONS_PATH_ATTR, PASSKEY_REDIRECT_ATTR, PASSKEY_SCOPE, PASSKEY_VERIFY_PATH_ATTR } from "../passkey-contract";
import type { AuthFactor, AuthFactorKind } from "../types";
import { requireFreshStepUp, resolveAuth } from "./guards";
import { authCtx } from "./identity";
import {
  loadAccountFactors,
  loadAccountPasskeyEnrol,
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
  loadSignup,
  loadTotpEnrol,
  loadVerify,
} from "./loaders";
import { AUTH_VIEWS } from "./render";
import { AUTH_VIEW_GUARDS, authAfterStepUpTarget, resolveAuthView } from "./resolve";
import { AUTH_ROUTE_GROUPS } from "./routes";
import type { AuthGuardName, AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";
import type { AuthViewName, AuthViewProps } from "./types";
import type { AuthViewRequest } from "./types";
import { SigninView } from "./views/signin";
import type { SigninViewProps } from "./views/types";
import type { AuthViewChrome } from "./views/types";
import {
  fakeAdminUserStore,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthServices,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorRegistry,
  fakeFactorOffer,
  fakeFactorService,
  fakeFactorStore,
  attrOf,
  elementOf,
  elementsOf,
  tagOf,
  textOf,
  recoveryOffer,
} from "./web.fixture";

type Loader = (c: never, options: AuthWebOptions, state?: AuthPageState) => Promise<Response>;

const viewer = fakeAuthUser({ id: "u9", email: "grace@example.com" });

const admin: AuthIdentity = { userId: "u9", email: "grace@example.com", isAdmin: true, stepUpAt: 1 };

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
    if (identity !== null) authCtx.set(context, identity);
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
} as AuthFactorService;

const totpRegistry = createFactorRegistry(fakeFactorStore([]), {
  offered: [
    { service: fakeFactorService("email-otp"), role: "primary" },
    { service: totpService, role: "second", requirement: "optional" },
    recoveryOffer(),
  ],
});

const stepUpRegistry = createFactorRegistry(fakeFactorStore(["totp-app"]), {
  offered: [
    { service: fakeFactorService("email-otp"), role: "primary" },
    { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
    recoveryOffer(),
  ],
});

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
  verify: ["auth", "verify"],
  enrolPasskey: ["auth", "enrol"],
  enrolTotp: ["auth", "enrol"],
  accountPasskeys: ["account"],
  accountPasskeyEnrol: ["account"],
  accountPasskey: ["account"],
  accountPasskeyEdit: ["account"],
  accountTotp: ["account"],
  accountEmailChange: ["account"],
  accountFactors: ["account"],
  accountRecoveryCodes: ["account"],
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
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          {
            service: { ...totpService, listEnrolments: async () => err("unavailable" as const) } as AuthFactorService,
            role: "second",
            requirement: "optional",
          },
          recoveryOffer(),
        ],
      }),
    });
    expect((await refusalOf(loadTotpEnrol, downEnrolments, admin)).status).toBe(503);
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
    const seconds = createFactorRegistry(fakeFactorStore([]), {
      offered: [fakeFactorOffer("email-otp", "primary"), fakeFactorOffer("passkey", "second"), recoveryOffer()],
    });
    expect(tagOf(await signinPage(optionsWith({ factors: seconds })), `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
    expect(tagOf(await signinPage(fakeAuthWebOptions()), `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
  });

  it("refuses at runtime to build a registry offering the passkey as primary", () => {
    expect(() =>
      createFactorRegistry(fakeFactorStore([]), {
        // @ts-expect-error a passkey identifies nobody, so the offer does not typecheck either
        offered: [{ service: fakeFactorService("passkey"), role: "primary" }],
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
  const CARD = "flex flex-col rounded-box border border-border bg-card text-card-foreground shadow-sm";

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
    expect(tagOf(html, 'data-slot="card"')).toBe(`<div data-slot="card" class="${CARD} mx-auto w-full max-w-md">`);
    expect(elementOf(html, "h1", 'class="text-xl"')).toBe('<h1 class="text-xl">Sign in</h1>');
  });

  it("lets the host's own width win over the view's, and demotes the heading it asked to demote", async () => {
    const html = await chromed({ class: "max-w-none", level: 2 });
    expect(tagOf(html, 'data-slot="card"')).toBe(`<div data-slot="card" class="${CARD} mx-auto w-full max-w-none">`);
    expect(elementOf(html, "h2", 'class="text-xl"')).toBe('<h2 class="text-xl">Sign in</h2>');
    expect(elementsOf(html, "h1", 'class="text-xl"')).toEqual([]);
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
  const owing = (seconds: readonly ("passkey" | "totp-app")[]) =>
    optionsWith({
      users: fakeAuthUserStore([viewer]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          ...seconds.map((kind) => fakeFactorOffer(kind, "second", "mandatory")),
          recoveryOffer(),
        ],
      }),
    });
  const redirectOf = async (options: AuthWebOptions) => {
    const html = await (await loaderApp(loadPasskeyEnrol, options, member).request("/page")).text();
    return attrOf(html, `data-scope="${PASSKEY_SCOPE}"`, PASSKEY_REDIRECT_ATTR);
  };

  it("sends a first passkey straight on to generate recovery codes, since the account holds none", async () => {
    expect(await redirectOf(owing(["passkey"]))).toBe("/account/recovery-codes");
  });

  it("sends it on to an enrolment still owed besides the passkey first", async () => {
    expect(await redirectOf(owing(["passkey", "totp-app"]))).toBe("/auth/enrol/totp");
  });
});

const confirmedRow = (kind: AuthFactorKind): AuthFactor => ({
  id: `f-${kind}`,
  userId: "u9",
  kind,
  secret: null,
  lastCounter: null,
  failedAttempts: 0,
  lastVerifiedAt: null,
  confirmedAt: 1,
  createdAt: 1,
  updatedAt: 1,
});

interface Holding {
  readonly totp?: AuthFactorRequirement;
  readonly passkey?: AuthFactorRequirement;
  readonly remaining?: number;
  readonly storeDown?: boolean;
  readonly onRead?: () => void;
}

/** A registry whose explicit factors list `held` as confirmed, the recovery-code one counting `remaining` unused codes. */
function holdingRegistry(
  held: readonly AuthFactorKind[],
  { totp = "optional", passkey, remaining = 10, storeDown = false, onRead = () => {} }: Holding = {},
) {
  const listed = (kind: AuthFactorKind) => ({
    ...fakeFactorService(kind),
    listEnrolments: async () => {
      onRead();
      return storeDown ? err(new Error("store down") as never) : ok(held.includes(kind) ? [confirmedRow(kind)] : []);
    },
  });
  const codes = Object.assign(listed("recovery-code"), {
    remaining: async () => {
      onRead();
      return ok(remaining);
    },
  }) as AuthFactorService;
  return createFactorRegistry(fakeFactorStore(held), {
    offered: [
      fakeFactorOffer("email-otp", "primary"),
      fakeFactorOffer(listed("totp-app") as AuthFactorService, "second", totp),
      ...(passkey === undefined ? [] : [fakeFactorOffer(listed("passkey") as AuthFactorService, "second", passkey)]),
      fakeFactorOffer(codes, "second"),
    ],
  });
}

const unproved: AuthIdentity = { ...member, stepUpAt: null };

const choicesOf = (html: string) =>
  elementsOf(html, "a", 'data-ref="verify-choice"').map((link) => [attrOf(link, "href", "href"), textOf(link, "a", 'data-ref="verify-choice"')]);

describe("the verify page's step-up picker", () => {
  const verifyOf = async (held: readonly AuthFactorKind[], path: string) => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(held) });
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
    const factors = holdingRegistry(held, { ...holding, onRead: () => (reads += 1) });
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors });
    const html = await (await loaderApp(loadVerify, options, unproved).request("/page?next=%2Fapp")).text();
    return { html, reads };
  };

  it("reads no recovery standing for an authenticator-app step-up, which renders no passkey ceremony", async () => {
    const { html, reads } = await verifyReading(["totp-app"], {});
    expect({ prompt: textOf(html, "div", 'data-slot="card-description"'), reads }).toEqual({
      prompt: "Enter the current code from your authenticator app.",
      reads: 0,
    });
  });

  const passkeyCases: readonly { label: string; held: readonly AuthFactorKind[]; remaining?: number; expected: string }[] = [
    {
      label: "sends a passkey step-up by a holder who never confirmed codes on to generate them, return-to kept",
      held: ["passkey"],
      expected: "/account/recovery-codes?next=%2Fapp",
    },
    {
      label: "sends a passkey step-up by a holder with codes to spare on to the return-to",
      held: ["passkey", "recovery-code"],
      remaining: 2,
      expected: "/app",
    },
  ];

  for (const { label, held, remaining, expected } of passkeyCases) {
    it(label, async () => {
      const { html, reads } = await verifyReading(held, { passkey: "optional", ...(remaining === undefined ? {} : { remaining }) });
      expect(attrOf(html, `data-scope="${PASSKEY_SCOPE}"`, PASSKEY_REDIRECT_ATTR)).toBe(expected);
      expect(reads).toBeGreaterThan(0);
    });
  }
});

describe("the verify page for a session that owes nothing", () => {
  it("navigates an htmx request on to its return-to with HX-Redirect, and a plain one with 303", async () => {
    const app = loaderApp(loadVerify, optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry([]) }), member);
    const answers = await Promise.all(
      [{ "HX-Request": "true" }, {}].map(async (headers) => {
        const res = await app.request("/page?next=%2Fapp", { headers });
        return { status: res.status, location: res.headers.get("location"), redirect: res.headers.get("hx-redirect") };
      }),
    );
    expect(answers).toEqual([
      { status: 204, location: null, redirect: "/app" },
      { status: 303, location: "/app", redirect: null },
    ]);
  });
});

describe("the verify page for an owed enrolment beside a confirmed second factor", () => {
  const owing = optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(["recovery-code"], { totp: "mandatory" }) });

  /** The verify page behind the `resolve-auth` its group mounts, whose window is 30 seconds, for a session marked `stepUpAt`. */
  const verifyMarked = async (stepUpAt: number | null) => {
    const guard = resolveAuth({ users: () => fakeAuthUserStore([viewer]), stepUpMaxAgeMs: 30_000 });
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
    const guard = resolveAuth({ users: () => fakeAuthUserStore([viewer]), stepUpMaxAgeMs: 30_000 });
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
    optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(held, { passkey: "optional" }) });

  /** The page behind the `require-fresh-step-up` its group mounts, with a one-minute window at `NOW`, for a session marked `stepUpAt`. */
  function enrolApp(options: AuthWebOptions, stepUpAt: number | null, guarded = true): Forge {
    const guard = requireFreshStepUp({
      factors: () => holdingRegistry([]),
      enrolmentPaths: {},
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
    { label: "renders for an account holding no second factor, which no step-up is demanded of", held: [], stepUpAt: null, expected: RENDERED },
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
    const services = fakeAuthServices({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(STEP_UP_HELD, { passkey: "optional" }) });
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

  it("answers 503 rather than rendering when the factor demand cannot be read", async () => {
    const registry = holdingRegistry(STEP_UP_HELD, { passkey: "optional" });
    const down = { ...registry, resolve: async () => err(new Error("store down") as never) };
    expect((await enrolApp(optionsWith({ users: fakeAuthUserStore([viewer]), factors: down }), NOW).request("/page")).status).toBe(503);
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

describe("authAfterStepUpTarget", () => {
  const targetOf = async (registry: ReturnType<typeof holdingRegistry>, verified: AuthFactorKind) => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors: registry });
    const app = guardedApp(async (c) => new Response(await authAfterStepUpTarget(c, options, member, verified, "/otherwise")), member);
    return (await app.request("/page?next=%2Fapp")).text();
  };

  const cases: readonly { label: string; registry: ReturnType<typeof holdingRegistry>; verified: AuthFactorKind; expected: string }[] = [
    {
      label: "lands a step-up by recovery code on the repair page, ahead of any enrolment owed",
      registry: holdingRegistry(["totp-app", "recovery-code"], { passkey: "mandatory", remaining: 4 }),
      verified: "recovery-code",
      expected: "/account/factors?recovered=1",
    },
    {
      label: "sends a step-up on to an enrolment the policy still owes",
      registry: holdingRegistry(["totp-app", "recovery-code"], { passkey: "mandatory", remaining: 4 }),
      verified: "totp-app",
      expected: "/auth/enrol/passkey",
    },
    {
      label: "sends a holder of an authenticator who never confirmed codes to generate them, return-to kept",
      registry: holdingRegistry(["totp-app"]),
      verified: "totp-app",
      expected: "/account/recovery-codes?next=%2Fapp",
    },
    {
      label: "sends a holder whose every code is spent to generate a new set",
      registry: holdingRegistry(["totp-app", "recovery-code"], { remaining: 0 }),
      verified: "totp-app",
      expected: "/account/recovery-codes?next=%2Fapp",
    },
    {
      label: "leaves a holder with codes to spare on the page they were going to",
      registry: holdingRegistry(["totp-app", "recovery-code"], { remaining: 1 }),
      verified: "totp-app",
      expected: "/otherwise",
    },
    {
      label: "falls back to the page they were going to when the store cannot say where they stand",
      registry: holdingRegistry(["totp-app"], { storeDown: true }),
      verified: "totp-app",
      expected: "/otherwise",
    },
  ];

  for (const { label, registry, verified, expected } of cases) {
    it(label, async () => {
      expect(await targetOf(registry, verified)).toBe(expected);
    });
  }
});

describe("the recovery-code resolvers", () => {
  it("never counts recovery codes as a way back in once the last passkey is gone", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
      factors: holdingRegistry(["passkey", "totp-app", "recovery-code"], { passkey: "optional" }),
    });
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "accountPasskeys", guarded: AUTH_VIEW_GUARDS.accountPasskeys });
      return view.ok ? Response.json(view.data.props.fallbackFactors) : view.error;
    }, member);
    expect(await (await app.request("/page")).json()).toEqual(["email-otp", "totp-app"]);
  });

  it("offers an implicit factor as a way back in, though the account holds no enrolment row for it", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([viewer]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
      factors: holdingRegistry(["passkey"], { passkey: "optional" }),
    });
    const app = guardedApp(async (c) => {
      const view = await resolveAuthView(c, options, { name: "accountPasskeys", guarded: AUTH_VIEW_GUARDS.accountPasskeys });
      return view.ok ? Response.json(view.data.props.fallbackFactors) : view.error;
    }, member);
    expect(await (await app.request("/page")).json()).toEqual(["email-otp"]);
  });

  it("lists an implicit factor on the factors panel as always on, and an explicit one without a row as not set up", async () => {
    const options = optionsWith({ factors: holdingRegistry([]), credentials: fakeAuthCredentialStore([]) });
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
    const options = optionsWith({ factors: holdingRegistry(["totp-app", "recovery-code"], { remaining: 3 }) });
    const html = await (await loaderApp(loadAccountFactors, options, member).request("/page?recovered=1")).text();
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(
      "You have 3 unused codes left. If your authenticator app or passkey no longer works, remove it below and add it again, then generate a new set of codes.",
    );
  });

  it("says nothing about recovery on a factors page reached any other way", async () => {
    const options = optionsWith({ factors: holdingRegistry(["totp-app", "recovery-code"], { remaining: 3 }) });
    const html = await (await loaderApp(loadAccountFactors, options, member).request("/page")).text();
    expect(tagOf(html, 'data-ref="factors-recovered"')).toBe("");
  });

  it("offers an administrator the reset of someone else's factors, posted with a token minted for that account's reset path", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore([...roster, viewer]), factors: holdingRegistry(["totp-app"]) });
    const html = await (await loaderApp(loadAdminUserFactors, options, admin, "/page/:id").request("/page/u2")).text();
    const form = elementOf(html, "form", 'action="/admin/users/u2/factors/reset"');
    expect(attrOf(form, 'name="_csrf"', "value")).toBe("csrf-for:/admin/users/u2/factors/reset");
  });

  it("offers no reset on an administrator's own factors, which would lock them out of the console they stand in", async () => {
    const options = optionsWith({ admin: fakeAdminUserStore([...roster, viewer]), factors: holdingRegistry(["totp-app"]) });
    const html = await (await loaderApp(loadAdminUserFactors, options, admin, "/page/:id").request("/page/u9")).text();
    expect(elementsOf(html, "form", 'action="/admin/users/u9/factors/reset"')).toEqual([]);
    expect(tagOf(html, 'data-ref="factors-reset"')).toBe("");
  });

  it("counts the confirmed set's unused codes on the codes page, and posts each form on its own path and token", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(["totp-app", "recovery-code"], { remaining: 3 }) });
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
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), factors: holdingRegistry(["totp-app"], { remaining: 7 }) });
    const html = await (await loaderApp(loadRecoveryCodes, options, member).request("/page")).text();
    expect(textOf(html, "span", 'data-ref="recovery-remaining"')).toBe("You have no recovery codes yet.");
  });
});
