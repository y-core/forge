/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import type { Session } from "@remix-run/session";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { importKeyRing } from "../../crypto/keyring/ring";
import { csrfMintStage, mintCsrf, verifyCsrfToken } from "../../form/csrf";
import type { JSXNode } from "../../render/jsx/types";
import { brandSessionMiddleware, sessionCtx } from "../../session/session";
import { createTestContext } from "../../testing/context";
import { attrsOf as attrsBesideClass, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { mapHandler } from "../../testing/route";
import { Navbar } from "../../ui/chrome/navbar";
import { createPrimaryNav, resolveNavState } from "../../ui/chrome/primary-nav";
import type { NavContribution, NavDefinition, NavGlyph, NavState } from "../../ui/chrome/types";
import { createIcon } from "../../ui/core/icon";
import type { ForgeIcon } from "../../ui/core/types";
import { authCtx } from "./identity";
import type * as authWeb from "./mod";
import { AUTH_NAV_FILTERS, AUTH_NAV_SIGNOUT_SLOT, authNav } from "./nav";
import type { AuthIdentity, AuthNavContext, AuthNavOptions } from "./types";
import { attrOf, attrsOf, tagOf, textOf } from "./web.fixture";

const HEX_SECRET = "38f516127047072640d79f757593f8c971ed2324a5e1db688f6f129f9b0478db";
const SIGNOUT_PATH = "/auth/signout";
const CONTACT_PATH = "/api/contact";
const DESK_HEADER = "x-desk-user";
const NAV_ICON = createIcon("/sprite.svg") as ForgeIcon<NavGlyph>;

function fakeIdentity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return { userId: "u1", email: "ada@example.com", isAdmin: false, sessionId: "s1", stepUpAt: null, stepUpKind: null, ...overrides };
}

const sessionPolicy = csrfMintStage({ ring: () => importKeyRing([HEX_SECRET]), subject: (c) => sessionCtx.get(c).id });

interface NavSeed {
  readonly identity?: AuthIdentity;
  readonly sessionId?: string;
  readonly policy?: Middleware | null;
}

/** A request carrying what the middleware chain would have put there by the time a page renders. */
async function navContext(seed: NavSeed = {}): Promise<AuthNavContext> {
  const context = createTestContext(new Request("http://localhost/"), { env: { CSRF_SECRET: HEX_SECRET } });
  sessionCtx.set(context, { id: seed.sessionId ?? "sess-1" } as Session);
  if (seed.identity !== undefined) authCtx.set(context, seed.identity);
  const policy = seed.policy === undefined ? sessionPolicy : seed.policy;
  if (policy !== null) await policy(context, () => Promise.resolve(new Response()));
  return context;
}

/** The sign-out control as a host placing it outside a `Navbar` renders it. */
function signoutControl(state: NavState, inMenu: boolean): JSXNode {
  const slot = state.slots[AUTH_NAV_SIGNOUT_SLOT];
  return typeof slot === "function" ? slot({ inMenu }) : slot;
}

function signoutNav(options: Partial<Omit<AuthNavOptions, "signoutPath">> = {}) {
  return authNav({ signoutPath: SIGNOUT_PATH, ...options });
}

async function signoutToken(state: NavState): Promise<string> {
  return attrOf(await render(signoutControl(state, false)), 'name="_csrf"', "value");
}

describe("authNav filters", () => {
  it("gives an anonymous visitor the anonymous token alone", async () => {
    expect((await signoutNav()(await navContext())).activeFilters).toEqual([AUTH_NAV_FILTERS.anonymous]);
  });

  it("gives a signed-in member the signed-in token alone", async () => {
    expect((await signoutNav()(await navContext({ identity: fakeIdentity() }))).activeFilters).toEqual([AUTH_NAV_FILTERS.signedIn]);
  });

  // An administrator is a signed-in visitor too, so an item marked for members must not vanish for them.
  it("gives an administrator both tokens", async () => {
    expect((await signoutNav()(await navContext({ identity: fakeIdentity({ isAdmin: true }) }))).activeFilters).toEqual([
      AUTH_NAV_FILTERS.signedIn,
      AUTH_NAV_FILTERS.admin,
    ]);
  });
});

describe("authNav slots", () => {
  it("fills no slot for an anonymous visitor, who has nothing to sign out of", async () => {
    expect(Object.keys((await signoutNav()(await navContext())).slots)).toEqual([]);
  });

  it("mints nothing for an anonymous visitor, so a page no CSRF policy covers still renders their nav", async () => {
    expect(await signoutNav()(await navContext({ policy: null }))).toEqual({ activeFilters: [AUTH_NAV_FILTERS.anonymous], slots: {} });
  });

  it("fills the sign-out slot for a signed-in member", async () => {
    expect(Object.keys((await signoutNav()(await navContext({ identity: fakeIdentity() }))).slots)).toEqual([AUTH_NAV_SIGNOUT_SLOT]);
  });

  it("names the slot as the definition does, when the definition spells it differently", async () => {
    const nav = signoutNav({ slot: "session" });
    expect(Object.keys((await nav(await navContext({ identity: fakeIdentity() }))).slots)).toEqual(["session"]);
  });

  it("posts to the sign-out path, carrying the token in both the field and the htmx header", async () => {
    const html = await render(signoutControl(await signoutNav()(await navContext({ identity: fakeIdentity() })), false));
    const token = attrOf(html, 'name="_csrf"', "value");

    expect(attrOf(html, 'data-slot="form"', "action")).toBe(SIGNOUT_PATH);
    expect(attrOf(html, 'data-slot="form"', "method")).toBe("post");
    expect(attrOf(html, 'data-slot="form"', "hx-headers")).toBe(`{&quot;X-CSRF-Token&quot;:&quot;${token}&quot;}`);
    expect(attrsOf(html, 'name="_csrf"')).toEqual({ "data-slot": "form-csrf", type: "hidden", name: "_csrf", value: token });
  });

  it("submits from a button rather than a link", async () => {
    const html = await render(signoutControl(await signoutNav()(await navContext({ identity: fakeIdentity() })), false));

    expect(tagOf(html, 'type="submit"')).toStartWith("<button");
    expect(attrOf(html, 'type="submit"', "role")).toBe("");
    expect(tagOf(html, 'href="/auth/signout"')).toBe("");
  });

  it("makes the sign-out a menu item inside a navbar menu, and in no copy that sits outside one", async () => {
    const { slots } = await signoutNav()(await navContext({ identity: fakeIdentity() }));
    const config: NavDefinition = {
      sections: [{ items: [{ slot: AUTH_NAV_SIGNOUT_SLOT }, { label: "Account", items: [{ slot: AUTH_NAV_SIGNOUT_SLOT }] }] }],
    };
    const html = await render(<Navbar config={config} resolveHref={(key) => key} icon={NAV_ICON} slots={slots} />);
    const popup = html.indexOf('role="menu"');
    const disclosure = html.indexOf('data-slot="navbar-disclosure"');
    const menuitems = [...html.matchAll(/role="menuitem"[^>]*type="submit"|type="submit"[^>]*role="menuitem"/g)].map((hit) => hit.index);

    expect(html.match(/type="submit"/g)?.length).toBe(3);
    expect(menuitems).toHaveLength(1);
    expect([popup < (menuitems[0] ?? -1), (menuitems[0] ?? Infinity) < disclosure]).toEqual([true, true]);
  });

  it("lets the host's own menuitem setting win in every place", async () => {
    const nav = signoutNav({ signout: { menuitem: false } });
    const html = await render(signoutControl(await nav(await navContext({ identity: fakeIdentity() })), true));

    expect(attrOf(html, 'type="submit"', "role")).toBe("");
  });

  it("takes the host's wording over its own default", async () => {
    const nav = signoutNav({ signout: { label: "Log out" } });
    const html = await render(signoutControl(await nav(await navContext({ identity: fakeIdentity() })), false));

    expect(textOf(html, "button", 'type="submit"')).toBe("Log out");
  });
});

describe("authNav token", () => {
  it("binds the token to this session under a session-subject policy, so another session's cannot end it", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const token = await signoutToken(await signoutNav()(await navContext({ identity: fakeIdentity(), sessionId: "sess-1" })));

    expect(await verifyCsrfToken(ring, token, SIGNOUT_PATH, { subject: "sess-1" })).toEqual({ ok: true });
    expect(await verifyCsrfToken(ring, token, SIGNOUT_PATH, { subject: "sess-2" })).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("scopes the token to the sign-out path, so it authorises no other POST", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const token = await signoutToken(await signoutNav()(await navContext({ identity: fakeIdentity() })));

    expect(await verifyCsrfToken(ring, token, "/account/email", { subject: "sess-1" })).toEqual({ ok: false, error: "path-mismatch" });
  });
});

describe("authNav on a request no CSRF policy covers", () => {
  async function uncoveredControl(options: Partial<Omit<AuthNavOptions, "signoutPath">> = {}, inMenu = false): Promise<string> {
    return render(signoutControl(await signoutNav(options)(await navContext({ identity: fakeIdentity(), policy: null })), inMenu));
  }

  it("links a signed-in member to the sign-out confirm page with a GET, carrying no form and no token", async () => {
    const html = await uncoveredControl();

    expect(tagOf(html, 'data-ref="signout"')).toStartWith("<a");
    expect(attrOf(html, 'data-ref="signout"', "href")).toBe(SIGNOUT_PATH);
    expect([tagOf(html, 'data-slot="form"'), tagOf(html, 'name="_csrf"')]).toEqual(["", ""]);
    expect(textOf(html, "a", 'data-ref="signout"')).toBe("Sign out");
  });

  it("makes the link a menu item inside a navbar menu and a plain link outside one", async () => {
    expect([
      attrOf(await uncoveredControl({}, true), 'data-ref="signout"', "role"),
      attrOf(await uncoveredControl(), 'data-ref="signout"', "role"),
    ]).toEqual(["menuitem", ""]);
  });

  it("takes the host's wording and menuitem setting on the link too", async () => {
    const html = await uncoveredControl({ signout: { label: "Log out", menuitem: false } }, true);

    expect([textOf(html, "a", 'data-ref="signout"'), attrOf(html, 'data-ref="signout"', "role")]).toEqual(["Log out", ""]);
  });

  it("renders the link alone, with no query, no form attribute and no submit type", async () => {
    const html = await uncoveredControl({}, true);

    expect(attrsBesideClass(html, 'data-ref="signout"')).toEqual({
      href: SIGNOUT_PATH,
      role: "menuitem",
      "data-ref": "signout",
      "data-slot": "button",
    });
    expect(new URL(attrOf(html, 'data-ref="signout"', "href"), "http://localhost").search).toBe("");
    expect(html.match(/<[a-z]+/g)).toEqual(["<a"]);
  });

  it.each<[string, AuthNavOptions["signout"]]>([
    ["the navbar defaults", undefined],
    ["the host's tone", { tone: "destructive" }],
    ["the host's appearance and size", { appearance: "solid", size: "md" }],
    ["the host's class", { class: "ms-auto" }],
  ])("styles the link exactly as the covered page styles its button, under %s", async (_case, signout) => {
    const options = signout === undefined ? {} : { signout };
    const link = await uncoveredControl(options);
    const button = await render(signoutControl(await signoutNav(options)(await navContext({ identity: fakeIdentity() })), false));

    expect(classesOf(link, 'data-ref="signout"')).toEqual(classesOf(button, 'data-ref="signout"'));
  });

  it("styles the link differently once the host changes its appearance, so the parity above is not two empty lists", async () => {
    expect(
      variantClasses(await uncoveredControl({ signout: { appearance: "solid" } }), await uncoveredControl(), 'data-ref="signout"').added,
    ).not.toEqual([]);
  });

  it("fills the slot the definition names with the link too", async () => {
    const state = await signoutNav({ slot: "session" })(await navContext({ identity: fakeIdentity(), policy: null }));

    expect(Object.keys(state.slots)).toEqual(["session"]);
  });

  it("links an administrator to the confirm page too, under both filter tokens", async () => {
    const state = await signoutNav()(await navContext({ identity: fakeIdentity({ isAdmin: true }), policy: null }));

    expect(state.activeFilters).toEqual([AUTH_NAV_FILTERS.signedIn, AUTH_NAV_FILTERS.admin]);
    expect(attrOf(await render(signoutControl(state, false)), 'data-ref="signout"', "href")).toBe(SIGNOUT_PATH);
  });

  it("makes the link a menu item inside a navbar menu, and in no copy that sits outside one", async () => {
    const { slots } = await signoutNav()(await navContext({ identity: fakeIdentity(), policy: null }));
    const config: NavDefinition = {
      sections: [{ items: [{ slot: AUTH_NAV_SIGNOUT_SLOT }, { label: "Account", items: [{ slot: AUTH_NAV_SIGNOUT_SLOT }] }] }],
    };
    const html = await render(<Navbar config={config} resolveHref={(key) => key} icon={NAV_ICON} slots={slots} />);
    const popup = html.indexOf('role="menu"');
    const disclosure = html.indexOf('data-slot="navbar-disclosure"');
    const links = [...html.matchAll(/<a [^>]*data-ref="signout"[^>]*>/g)];
    const menuitems = links.filter((hit) => hit[0].includes('role="menuitem"')).map((hit) => hit.index);

    expect([links.length, html.match(/type="submit"|name="_csrf"/g)]).toEqual([3, null]);
    expect(menuitems).toHaveLength(1);
    expect([popup < (menuitems[0] ?? -1), (menuitems[0] ?? Infinity) < disclosure]).toEqual([true, true]);
  });
});

describe("authNav under the app's one CSRF policy", () => {
  /** An app whose policy binds tokens to the desk user a header names, beside a session that names someone else. */
  function deskApp(): Forge {
    const app = new Forge();
    const nav = signoutNav();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: brandSessionMiddleware((context, next) => {
        sessionCtx.set(context, { id: "sess-1" } as Session);
        return next();
      }, undefined),
      csrf: {
        ring: () => importKeyRing([HEX_SECRET]),
        subject: (c) => c.request.headers.get(DESK_HEADER) ?? undefined,
        unboundPaths: [CONTACT_PATH],
      },
      onRefuse: (_c, refusal) => new Response(`refused: ${"reason" in refusal ? refusal.reason : refusal.guard}`, { status: refusal.status }),
    });
    mapHandler(app, "GET", "/desk", async (c) => {
      authCtx.set(c, fakeIdentity());
      return Response.json({ signout: await signoutToken(await nav(c)), contact: await mintCsrf(c, CONTACT_PATH) });
    });
    for (const path of [SIGNOUT_PATH, CONTACT_PATH]) mapHandler(app, "POST", path, () => new Response(`posted ${path}`));
    return app;
  }

  async function tokensFor(app: Forge, desk: string): Promise<{ signout: string; contact: string }> {
    return (await app.request("/desk", { headers: { [DESK_HEADER]: desk } })).json();
  }

  async function post(app: Forge, path: string, token: string, desk?: string) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "x-csrf-token": token, ...(desk === undefined ? {} : { [DESK_HEADER]: desk }) },
    });
    return { status: res.status, body: await res.text() };
  }

  it("verifies the sign-out token on a POST to the sign-out path under a subject that is not the session", async () => {
    const app = deskApp();
    const { signout } = await tokensFor(app, "clerk-7");

    expect(await post(app, SIGNOUT_PATH, signout, "clerk-7")).toEqual({ status: 200, body: `posted ${SIGNOUT_PATH}` });
  });

  it("refuses the sign-out token posted under another desk user as subject-mismatch", async () => {
    const app = deskApp();
    const { signout } = await tokensFor(app, "clerk-7");

    expect(await post(app, SIGNOUT_PATH, signout, "clerk-8")).toEqual({ status: 403, body: "refused: subject-mismatch" });
  });

  it("mints an unbound contact token beside the bound sign-out token on one request, and each verifies on its own POST", async () => {
    const app = deskApp();
    const { signout, contact } = await tokensFor(app, "clerk-7");

    expect({ contact: await post(app, CONTACT_PATH, contact), signout: await post(app, SIGNOUT_PATH, signout, "clerk-7") }).toEqual({
      contact: { status: 200, body: `posted ${CONTACT_PATH}` },
      signout: { status: 200, body: `posted ${SIGNOUT_PATH}` },
    });
  });

  it("refuses the contact token on the sign-out path, so the unbound token authorises no bound POST", async () => {
    const app = deskApp();
    const { contact } = await tokensFor(app, "clerk-7");

    expect(await post(app, SIGNOUT_PATH, contact, "clerk-7")).toEqual({ status: 403, body: "refused: path-mismatch" });
  });
});

describe("authNav under a policy whose exclude skips the page", () => {
  const EXCLUDED_PAGE = "/public/missing";
  const COVERED_PAGE = "/desk";

  function excludeApp(identity?: AuthIdentity): Forge {
    const app = new Forge();
    const nav = signoutNav();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: brandSessionMiddleware((context, next) => {
        sessionCtx.set(context, { id: "sess-1" } as Session);
        return next();
      }, undefined),
      csrf: { ring: () => importKeyRing([HEX_SECRET]), subject: (c) => sessionCtx.get(c).id, exclude: ["/public/*"] },
    });
    for (const path of [EXCLUDED_PAGE, COVERED_PAGE]) {
      mapHandler(app, "GET", path, async (c) => {
        if (identity !== undefined) authCtx.set(c, identity);
        const state = await nav(c);
        const html = await render(signoutControl(state, false) ?? null);
        return new Response(`${Object.keys(state.slots).join(",")}|${html}`, { headers: { "content-type": "text/html" } });
      });
    }
    return app;
  }

  async function page(app: Forge, path: string): Promise<{ status: number; slots: string; html: string }> {
    const res = await app.request(path);
    const [slots = "", html = ""] = (await res.text()).split("|");
    return { status: res.status, slots, html };
  }

  it("answers 200 with a GET link to the sign-out confirm page for a signed-in member on an excluded page", async () => {
    const { status, html } = await page(excludeApp(fakeIdentity()), EXCLUDED_PAGE);

    expect(status).toBe(200);
    expect([tagOf(html, 'data-ref="signout"').startsWith("<a"), attrOf(html, 'data-ref="signout"', "href")]).toEqual([true, SIGNOUT_PATH]);
    expect(tagOf(html, 'name="_csrf"')).toBe("");
  });

  it("keeps the POST form and a verifying token for a signed-in member on a covered page", async () => {
    const { status, html } = await page(excludeApp(fakeIdentity()), COVERED_PAGE);
    const token = attrOf(html, 'name="_csrf"', "value");

    expect(status).toBe(200);
    expect([attrOf(html, 'data-slot="form"', "action"), attrOf(html, 'data-slot="form"', "method")]).toEqual([SIGNOUT_PATH, "post"]);
    expect(await verifyCsrfToken(await importKeyRing([HEX_SECRET]), token, SIGNOUT_PATH, { subject: "sess-1" })).toEqual({ ok: true });
  });

  it("fills no slot for an anonymous visitor on an excluded page", async () => {
    expect(await page(excludeApp(), EXCLUDED_PAGE)).toEqual({ status: 200, slots: "", html: "" });
  });

  it("fills no slot for an anonymous visitor on a covered page, where a minter is there to mint with", async () => {
    expect(await page(excludeApp(), COVERED_PAGE)).toEqual({ status: 200, slots: "", html: "" });
  });
});

describe("authNav merged with an app's contribution", () => {
  async function mergedBar(identity?: AuthIdentity) {
    const authSlice: NavContribution<"admin" | "signin", AuthNavContext, NavState> = {
      items: [
        { label: "Sign in", href: "signin", filters: [AUTH_NAV_FILTERS.anonymous] },
        { label: "Admin", href: "admin", filters: [AUTH_NAV_FILTERS.admin] },
        { slot: AUTH_NAV_SIGNOUT_SLOT },
      ],
      hrefs: { signin: "/auth/signin", admin: "/admin" },
      state: signoutNav(),
    };
    const appSlice: NavContribution<"home", AuthNavContext, NavState> = {
      items: [
        { label: "Home", href: "home" },
        { slot: "greeting", filters: ["beta"] },
      ],
      hrefs: { home: "/" },
      state: async () => ({ activeFilters: ["beta"], slots: { greeting: "Hello" } }),
    };
    const nav = createPrimaryNav<"home" | "admin" | "signin", AuthNavContext, NavState>([authSlice, appSlice]);

    const state = await resolveNavState(nav, await navContext(identity === undefined ? {} : { identity }));
    const html = await render(
      <Navbar config={nav.definition()} resolveHref={nav.resolveHref} icon={NAV_ICON} activeFilters={state.activeFilters} slots={state.slots} />,
    );
    return { state, html };
  }

  it("merges auth's filters and sign-out slot ahead of the app's", async () => {
    const { state } = await mergedBar(fakeIdentity({ isAdmin: true }));

    expect(state.activeFilters).toEqual([AUTH_NAV_FILTERS.signedIn, AUTH_NAV_FILTERS.admin, "beta"]);
    expect(Object.keys(state.slots)).toEqual([AUTH_NAV_SIGNOUT_SLOT, "greeting"]);
  });

  it("renders through Navbar: the signed-in admin's links shown, the sign-in link hidden, both slots filled", async () => {
    const { html } = await mergedBar(fakeIdentity({ isAdmin: true }));

    expect([attrsOf(html, 'href="/auth/signin"')["hidden"], attrsOf(html, 'href="/admin"')["hidden"]]).toEqual(["", undefined]);
    expect(attrOf(html, 'data-slot="form"', "action")).toBe(SIGNOUT_PATH);
    expect(textOf(html, "div", 'data-filter="beta"')).toBe("Hello");
  });

  it("renders through Navbar for an anonymous visitor: the sign-in link shown, the admin link hidden, no sign-out form", async () => {
    const { state, html } = await mergedBar();

    expect(Object.keys(state.slots)).toEqual(["greeting"]);
    expect([attrsOf(html, 'href="/auth/signin"')["hidden"], attrsOf(html, 'href="/admin"')["hidden"]]).toEqual([undefined, ""]);
    expect(tagOf(html, 'data-slot="form"')).toBe("");
  });
});

describe("authNav's state type", () => {
  it("is ui/chrome's NavState, with no AuthNav left on the auth/web barrel", () => {
    // @ts-expect-error -- AuthNav is removed; authNav returns ui/chrome's NavState
    const removed: authWeb.AuthNav | null = null;
    expect(removed).toBeNull();
  });
});
