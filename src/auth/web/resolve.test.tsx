/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { renderToString } from "../../jsx/render-to-string";
import type { FC, JSXElement } from "../../jsx/types";
import { err, ok } from "../../result/result";
import { mapHandler } from "../../testing/route";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorService } from "../factors/types";
import type { AuthChallenge, ChallengeStore } from "../types";
import { authCtx } from "./identity";
import {
  loadAccountFactors,
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
  loadSignin,
  loadSignup,
  loadTotpEnrol,
  loadVerify,
} from "./loaders";
import { AUTH_VIEWS } from "./render";
import { AUTH_VIEW_GUARDS, resolveAuthView } from "./resolve";
import { AUTH_GOLDEN_PAGES } from "./resolve.golden";
import { AUTH_ROUTE_GROUPS } from "./routes";
import {
  fakeAdminUserService,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthServices,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorService,
  fakeFactorStore,
  attrOf,
  elementOf,
  elementsOf,
  tagOf,
} from "./test-support";
import type { AuthIdentity } from "./types";
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";
import type { AuthViewName, AuthViewProps } from "./types";
import type { AuthViewRequest } from "./types";
import { SigninView } from "./views/signin";
import type { SigninViewProps } from "./views/types";
import type { AuthViewChrome } from "./views/types";

type Loader = (c: never, options: AuthWebOptions, state?: AuthPageState) => Promise<Response>;

const viewer = fakeAuthUser({ id: "u9", email: "grace@example.com" });

const admin: AuthIdentity = { userId: "u9", email: "grace@example.com", isAdmin: true, stepUpAt: 1 };

const member: AuthIdentity = { ...admin, isAdmin: false };

const challenges: ChallengeStore = { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };

const passkeyCeremony = { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges };

function optionsWith(overrides: Partial<AuthRequestServices>): AuthWebOptions {
  const services = fakeAuthServices(overrides);
  return fakeAuthWebOptions({ resolveServices: () => services });
}

/** Mounts `handler` on an app carrying a deterministic minter and, when given, the identity a guard would have set. */
function guardedApp(handler: (c: AppContext) => Promise<Response>, identity: AuthIdentity | null, pattern = "/page"): Forge {
  const app = new Forge();
  app.use("*", (context, next) => {
    csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
    if (identity !== null) authCtx.set(context, identity);
    return next();
  });
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
  offered: [fakeFactorService("email-otp"), totpService],
  policy: { mode: "second-factor", required: "when-enrolled" },
});

const stepUpRegistry = createFactorRegistry(fakeFactorStore(["totp-app"]), {
  offered: [fakeFactorService("email-otp"), fakeFactorService("totp-app")],
  policy: { mode: "second-factor", required: "when-enrolled" },
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

// One case per page name, plus the second branch of every page that has one. The bodies these
// render are the record `resolve.golden.ts` holds, so a change to any of them is a deliberate act.
const CASES: readonly Case[] = [
  { label: "signin", name: "signin", load: loadSignin, options: fakeAuthWebOptions() },
  {
    label: "signin+passkey",
    name: "signin",
    load: loadSignin,
    options: optionsWith({
      passkey: passkeyCeremony,
      factors: createFactorRegistry(fakeFactorStore([]), { offered: [fakeFactorService("passkey")], policy: { mode: "single" } }),
    }),
  },
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
    options: optionsWith({ users: fakeAuthUserStore([viewer]), passkey: passkeyCeremony }),
    identity: admin,
  },
  {
    label: "accountPasskeys",
    name: "accountPasskeys",
    load: loadPasskeyList,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore(credentials) }),
    identity: admin,
  },
  {
    label: "accountPasskeys+empty",
    name: "accountPasskeys",
    load: loadPasskeyList,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore([]) }),
    identity: admin,
  },
  {
    label: "accountPasskey",
    name: "accountPasskey",
    load: loadPasskey,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore(credentials) }),
    pattern: "/page/:id",
    path: "/page/c2",
    identity: admin,
  },
  {
    label: "accountPasskeyEdit",
    name: "accountPasskeyEdit",
    load: loadPasskeyEdit,
    options: optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore(credentials) }),
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
  { label: "adminUsers", name: "adminUsers", load: loadAdminUsers, options: optionsWith({ admin: fakeAdminUserService(roster) }), identity: admin },
  {
    label: "adminUsers+search",
    name: "adminUsers",
    load: loadAdminUsers,
    options: optionsWith({ admin: fakeAdminUserService(roster) }),
    path: "/page?q=zz",
    identity: admin,
  },
  {
    label: "adminUser",
    name: "adminUser",
    load: loadAdminUser,
    options: optionsWith({ admin: fakeAdminUserService(roster) }),
    pattern: "/page/:id",
    path: "/page/u2",
    identity: admin,
  },
  {
    label: "adminUserEdit",
    name: "adminUserEdit",
    load: loadAdminUserEdit,
    options: optionsWith({ admin: fakeAdminUserService(roster) }),
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
    label: "adminUserFactors",
    name: "adminUserFactors",
    load: loadAdminUserFactors,
    options: optionsWith({ admin: fakeAdminUserService(roster), factors: totpRegistry, credentials: fakeAuthCredentialStore(credentials) }),
    pattern: "/page/:id",
    path: "/page/u2",
    identity: admin,
  },
  {
    label: "adminElevate",
    name: "adminElevate",
    load: loadAdminElevate,
    options: optionsWith({ admin: fakeAdminUserService([viewer]) }),
    identity: admin,
  },
  {
    label: "adminElevate+taken",
    name: "adminElevate",
    load: loadAdminElevate,
    options: optionsWith({ admin: fakeAdminUserService([fakeAuthUser({ isAdmin: true })]) }),
    identity: admin,
  },
];

// The two tables answer different questions — which guards a route runs, and which guards a page's
// data assumes — and only a test can hold them together, because the mapping is not mechanical:
// `adminElevate` sits under `/admin` and is deliberately not admin-gated.
const VIEW_GROUP: Readonly<Record<AuthViewName, readonly string[]>> = {
  signin: ["auth"],
  signup: ["auth"],
  verify: ["auth", "verify"],
  enrolPasskey: ["auth", "enrol"],
  enrolTotp: ["auth", "enrol"],
  accountPasskeys: ["account"],
  accountPasskey: ["account"],
  accountPasskeyEdit: ["account"],
  accountTotp: ["account"],
  accountEmailChange: ["account"],
  accountFactors: ["account"],
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

describe("every auth page renders the bytes it rendered before the resolver", () => {
  for (const one of CASES) {
    it(`renders ${one.label} byte for byte`, async () => {
      const app = loaderApp(one.load, one.options, one.identity ?? null, one.pattern ?? "/page", one.state ?? {});
      const res = await app.request(one.path ?? "/page");
      const golden = AUTH_GOLDEN_PAGES[one.label];

      expect(golden).toBeDefined();
      expect(res.status).toBe(golden?.status as number);
      expect(await res.text()).toBe(golden?.body as string);
    });
  }

  it("holds a golden for every case and no case for a golden nothing renders", () => {
    expect(CASES.map((one) => one.label).sort()).toEqual(Object.keys(AUTH_GOLDEN_PAGES).sort());
  });
});

describe("resolveAuthView refusals", () => {
  async function refusalOf(load: Loader, options: AuthWebOptions, identity: AuthIdentity | null, pattern = "/page", path = "/page") {
    const res = await loaderApp(load, options, identity, pattern).request(path);
    return { status: res.status, location: res.headers.get("location") };
  }

  const signin = { status: 302, location: "/auth/signin" };

  it("sends an anonymous request to sign-in on every page whose route runs `require-auth`", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([viewer]), passkey: passkeyCeremony });
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
    });
    expect((await refusalOf(loadPasskeyList, downCredentials, admin)).status).toBe(503);
    expect((await refusalOf(loadPasskeyEdit, downCredentials, admin, "/page/:id", "/page/c1")).status).toBe(503);

    const downAdmin = optionsWith({ admin: fakeAdminUserService(roster, { list: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUsers, downAdmin, admin)).status).toBe(503);

    const downView = optionsWith({ admin: fakeAdminUserService(roster, { view: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUser, downView, admin, "/page/:id", "/page/u2")).status).toBe(503);

    const downCount = optionsWith({ admin: fakeAdminUserService(roster, { countAdmins: async () => err(new Error("db down") as never) }) });
    expect((await refusalOf(loadAdminUserEdit, downCount, admin, "/page/:id", "/page/u2")).status).toBe(503);
    expect((await refusalOf(loadAdminElevate, downCount, admin)).status).toBe(503);

    const downEnrolments = optionsWith({
      users: fakeAuthUserStore([viewer]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [fakeFactorService("email-otp"), { ...totpService, listEnrolments: async () => err("unavailable" as const) } as AuthFactorService],
        policy: { mode: "second-factor", required: "when-enrolled" },
      }),
    });
    expect((await refusalOf(loadTotpEnrol, downEnrolments, admin)).status).toBe(503);
  });

  it("answers 404 for an account, a credential and a path segment that are not there", async () => {
    const empty = optionsWith({ users: fakeAuthUserStore([viewer]), credentials: fakeAuthCredentialStore([]), admin: fakeAdminUserService([]) });
    expect((await refusalOf(loadPasskey, empty, admin, "/page/:id", "/page/c1")).status).toBe(404);
    expect((await refusalOf(loadPasskey, empty, admin)).status).toBe(404);
    expect((await refusalOf(loadPasskeyEdit, empty, admin)).status).toBe(404);
    expect((await refusalOf(loadAdminUser, empty, admin, "/page/:id", "/page/u2")).status).toBe(404);
    expect((await refusalOf(loadAdminUserEdit, empty, admin)).status).toBe(404);
  });

  it("sends a malformed administrative query back to the plain listing", async () => {
    const options = optionsWith({ admin: fakeAdminUserService(roster) });
    const res = await loaderApp(loadAdminUsers, options, admin).request(`/page?after=${"x".repeat(500)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/users");
  });
});

// The leak this closes: `loadAdminUsers` reads `services.admin.list` having read no identity at all,
// so an auth view embedded on an unguarded consumer route served the whole user table to a visitor.
describe("resolveAuthView holds a host to the guards the page's data assumes", () => {
  const options = optionsWith({ admin: fakeAdminUserService(roster) });

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

// The hazard `AuthViewChrome` carries is not that it fails to work but that it changes what a mount
// already renders, so every view is checked on both sides: the heading it moves when a host asks,
// and the bytes it leaves alone when one does not.
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
