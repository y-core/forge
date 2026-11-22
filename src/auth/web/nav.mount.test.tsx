/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { renderShell } from "../../app/shell";
import type { PageShell } from "../../app/types";
import type { AppContext } from "../../context/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import { createAnonymousSession } from "../../session/anonymous";
import { nullLogger } from "../../testing/context";
import { attrsOf, elementOf, tagsOf } from "../../testing/markup";
import { mapHandler } from "../../testing/route";
import { Navbar } from "../../ui/chrome/navbar";
import type { NavDefinition, NavGlyph } from "../../ui/chrome/types";
import { createIcon } from "../../ui/core/icon";
import type { ForgeIcon } from "../../ui/core/types";
import { AUTH_SESSION_MAX_MS } from "../config";
import { resolveAuth } from "./guards";
import { AUTH_NAV_SIGNOUT_SLOT, authNav } from "./nav";
import { authPaths } from "./paths";
import { registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthRequestServicesResolver, AuthWebOptions } from "./types";
import { fakeAuthIcon, fakeAuthServices, fakeAuthSessionStore, fakeAuthUser, fakeAuthUserStore, signedInSession } from "./web.fixture";

interface MemberEnv extends Record<string, unknown> {
  readonly SESSION_SECRET: string;
  readonly CSRF_SECRET: string;
}

const BINDINGS: MemberEnv = {
  SESSION_SECRET: "c15f22e5e9af45d15e1068ac2186b479735f5c60e4fc302f8916ab67aaf6b2c6",
  CSRF_SECRET: "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d",
};

const memberMap = authRoutes("/members");
const paths = {
  auth: authPaths(memberMap),
  account: authPaths(accountRoutes("/members/account")),
  admin: authPaths(adminRoutes("/members/admin")),
};
const NAV: NavDefinition = { sections: [{ items: [{ slot: AUTH_NAV_SIGNOUT_SLOT }] }] };
const NAV_ICON = createIcon("/sprite.svg") as ForgeIcon<NavGlyph>;

/** An app mounting auth at `/members`, whose shell puts `authNav` on every page it renders — its 404 and error pages included. */
function memberApp(signedIn: boolean): Forge<MemberEnv> {
  const user = fakeAuthUser();
  const users = [user];
  const services = fakeAuthServices({ users: fakeAuthUserStore(users), sessions: fakeAuthSessionStore(users) });
  const resolver: AuthRequestServicesResolver<MemberEnv> = Object.assign(async () => services, {
    sessions: async () => services.sessions,
    absoluteLifetimeMs: AUTH_SESSION_MAX_MS,
  });
  const options: AuthWebOptions<MemberEnv> = { resolveServices: resolver, paths, icon: fakeAuthIcon, now: () => Date.now() };
  const nav = authNav({ signoutPath: paths.auth.signout() });
  const shell: PageShell<MemberEnv> = async (c, content, slot) => {
    const state = await nav(c);
    return (
      <html lang='en'>
        <head>
          <title>{slot.meta.title}</title>
        </head>
        <body>
          <Navbar config={NAV} resolveHref={(key) => key} icon={NAV_ICON} activeFilters={state.activeFilters} slots={state.slots} />
          <main>{content}</main>
        </body>
      </html>
    );
  };

  const app = new Forge<MemberEnv>(nullLogger);
  app.setShell(shell);
  applyMiddlewareChain<MemberEnv>(app, {
    securityHeaders: {},
    session: createAnonymousSession<MemberEnv>({ ring: (bindings) => importKeyRing([bindings.SESSION_SECRET]), storage: "cookie" }),
    csrf: { ring: (bindings) => importKeyRing([bindings.CSRF_SECRET]), subject: "session", exclude: ["/public/*"] },
  });
  if (signedIn) app.use("*", signedInSession(services.sessions, user.id));
  app.use("*", resolveAuth<MemberEnv>({ services: resolver }));
  registerAuth(app, memberMap, options);

  const page = (c: AppContext<MemberEnv>, title: string, status: number) =>
    renderShell(c, <p>{title}</p>, { mount: "app", page: title, meta: { title } }, { status });
  app.setNotFound((c) => page(c, "Not found", 404));
  app.setOnError((_error, c) => page(c, "Something went wrong", 500));
  for (const path of ["/public/boom", "/desk/boom"]) {
    mapHandler(app, "GET", path, () => {
      throw new Error(`thrown by ${path}`);
    });
  }
  return app;
}

/** The status, the sign-out control's every attribute but its class, and the tags that would carry a sign-out form. */
async function chromeOf(res: Response) {
  const html = await res.text();
  return {
    status: res.status,
    signout: attrsOf(html, 'data-ref="signout"'),
    signoutTag: tagsOf(html, 'data-ref="signout"').map((tag) => /^<([a-z]+)/.exec(tag)?.[1]),
    forms: tagsOf(html, 'data-slot="form"').length,
    tokens: tagsOf(html, 'name="_csrf"').length,
  };
}

const LINK = { href: "/members/signout", "data-ref": "signout", "data-slot": "button" };

describe("authNav in an app's shell, on a page under csrf.exclude", () => {
  it.each([
    ["a 404", "/public/missing", 404],
    ["an error page", "/public/boom", 500],
  ])("renders %s for a signed-in member with a GET link to the mount's sign-out confirm page, and no token", async (_case, path, status) => {
    expect(await chromeOf(await memberApp(true).request(path, {}, BINDINGS))).toEqual({
      status,
      signout: LINK,
      signoutTag: ["a"],
      forms: 0,
      tokens: 0,
    });
  });

  it("points the link at the confirm route of the mount's own map, not the default /auth mount", async () => {
    const { signout } = await chromeOf(await memberApp(true).request("/public/missing", {}, BINDINGS));

    expect(signout["href"]).toBe(memberMap.signoutConfirm.href());
  });

  it("renders the 404 for an anonymous visitor with no sign-out control at all", async () => {
    expect(await chromeOf(await memberApp(false).request("/public/missing", {}, BINDINGS))).toEqual({
      status: 404,
      signout: {},
      signoutTag: [],
      forms: 0,
      tokens: 0,
    });
  });

  it("answers the link's GET with the confirm page, whose own form posts back to the mount's sign-out with a token", async () => {
    const app = memberApp(true);
    const { signout } = await chromeOf(await app.request("/public/missing", {}, BINDINGS));
    const confirm = await app.request(signout["href"] ?? "", {}, BINDINGS);
    const html = await confirm.text();
    const card = elementOf(html, "main");

    expect({
      status: confirm.status,
      title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
      action: attrsOf(card, 'data-slot="form"')["action"],
      method: attrsOf(card, 'data-slot="form"')["method"],
      tokenMinted: (attrsOf(card, 'name="_csrf"')["value"] ?? "") !== "",
    }).toEqual({ status: 200, title: "Sign out", action: "/members/signout", method: "post", tokenMinted: true });
  });
});

describe("authNav in an app's shell, on a page the CSRF policy covers", () => {
  it.each([
    ["a 404", "/desk/missing", 404],
    ["an error page", "/desk/boom", 500],
  ])("keeps the POST form and its token on %s for a signed-in member", async (_case, path, status) => {
    const chrome = await chromeOf(await memberApp(true).request(path, {}, BINDINGS));

    expect({ status: chrome.status, signoutTag: chrome.signoutTag, forms: chrome.forms, tokens: chrome.tokens }).toEqual({
      status,
      signoutTag: ["button"],
      forms: 1,
      tokens: 1,
    });
  });

  it("renders the covered 404 for an anonymous visitor with no sign-out control and nothing minted", async () => {
    expect(await chromeOf(await memberApp(false).request("/desk/missing", {}, BINDINGS))).toEqual({
      status: 404,
      signout: {},
      signoutTag: [],
      forms: 0,
      tokens: 0,
    });
  });
});
