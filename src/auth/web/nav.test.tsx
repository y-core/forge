/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";
import type { Session } from "@remix-run/session";

import { importCsrfKey, verifyCsrfToken } from "../../form/csrf";
import { sessionCtx } from "../../session/session";
import { render } from "../../testing/render";
import { authCtx } from "./identity";
import { AUTH_NAV_FILTERS, AUTH_NAV_SIGNOUT_SLOT, authNav } from "./nav";
import { attrOf, attrsOf, tagOf, textOf } from "./test-support";
import type { AuthIdentity, AuthNavContext, AuthNavOptions } from "./types";

const HEX_SECRET = "b".repeat(64);
const SIGNOUT_PATH = "/auth/signout";

function fakeIdentity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return { userId: "u1", email: "ada@example.com", isAdmin: false, stepUpAt: null, ...overrides };
}

interface NavSeed {
  readonly identity?: AuthIdentity;
  readonly sessionId?: string;
  readonly env?: object;
}

/** A request carrying what the middleware chain would have put there by the time a page renders. */
function navContext(seed: NavSeed = {}): AuthNavContext {
  const context = new RequestContext(new Request("http://localhost/"));
  Object.assign(context, { env: seed.env ?? { CSRF_SECRET: HEX_SECRET } });
  sessionCtx.set(context, { id: seed.sessionId ?? "sess-1" } as Session);
  if (seed.identity !== undefined) authCtx.set(context, seed.identity);
  return context;
}

/** `authNav` wired to a key that never changes, which is every deployment with one CSRF secret. */
async function fixedKeyNav(options: Partial<Pick<AuthNavOptions, "slot" | "signout">> = {}) {
  const key = await importCsrfKey(HEX_SECRET);
  return authNav({ signoutPath: SIGNOUT_PATH, secret: () => key, ...options });
}

describe("authNav filters", () => {
  it("gives an anonymous visitor the anonymous token alone", async () => {
    const nav = await fixedKeyNav();
    expect((await nav(navContext())).activeFilters).toEqual([AUTH_NAV_FILTERS.anonymous]);
  });

  it("gives a signed-in member the signed-in token alone", async () => {
    const nav = await fixedKeyNav();
    expect((await nav(navContext({ identity: fakeIdentity() }))).activeFilters).toEqual([AUTH_NAV_FILTERS.signedIn]);
  });

  // An administrator is a signed-in visitor too, so an item marked for members must not vanish for them.
  it("gives an administrator both tokens", async () => {
    const nav = await fixedKeyNav();
    expect((await nav(navContext({ identity: fakeIdentity({ isAdmin: true }) }))).activeFilters).toEqual([
      AUTH_NAV_FILTERS.signedIn,
      AUTH_NAV_FILTERS.admin,
    ]);
  });
});

describe("authNav slots", () => {
  it("fills no slot for an anonymous visitor, who has nothing to sign out of", async () => {
    const nav = await fixedKeyNav();
    expect(Object.keys((await nav(navContext())).slots)).toEqual([]);
  });

  // The cost this exists to avoid: a signing key imported and a token signed on every anonymous page
  // render, for a control that render does not emit.
  it("mints no token for an anonymous visitor", async () => {
    let mints = 0;
    const nav = authNav({
      signoutPath: SIGNOUT_PATH,
      secret: async () => {
        mints += 1;
        return importCsrfKey(HEX_SECRET);
      },
    });

    await nav(navContext());
    expect(mints).toBe(0);
  });

  it("fills the sign-out slot for a signed-in member", async () => {
    const nav = await fixedKeyNav();
    expect(Object.keys((await nav(navContext({ identity: fakeIdentity() }))).slots)).toEqual([AUTH_NAV_SIGNOUT_SLOT]);
  });

  it("names the slot as the definition does, when the definition spells it differently", async () => {
    const nav = await fixedKeyNav({ slot: "session" });
    expect(Object.keys((await nav(navContext({ identity: fakeIdentity() }))).slots)).toEqual(["session"]);
  });

  it("posts to the sign-out path, carrying the token in both the field and the htmx header", async () => {
    const nav = await fixedKeyNav();
    const { slots } = await nav(navContext({ identity: fakeIdentity() }));
    const html = await render(slots[AUTH_NAV_SIGNOUT_SLOT]);
    const token = attrOf(html, 'name="_csrf"', "value");

    expect(attrOf(html, 'data-slot="form"', "action")).toBe(SIGNOUT_PATH);
    expect(attrOf(html, 'data-slot="form"', "method")).toBe("post");
    expect(attrOf(html, 'data-slot="form"', "hx-headers")).toBe(`{&quot;X-CSRF-Token&quot;:&quot;${token}&quot;}`);
    expect(attrsOf(html, 'name="_csrf"')).toEqual({ "data-slot": "form-csrf", type: "hidden", name: "_csrf", value: token });
  });

  // A `NavLink` announces a destination, which an action is not — and `/auth/signout` is POST-only,
  // so an anchor would have no handler to reach.
  it("submits from a menu row rather than a link", async () => {
    const nav = await fixedKeyNav();
    const { slots } = await nav(navContext({ identity: fakeIdentity() }));
    const html = await render(slots[AUTH_NAV_SIGNOUT_SLOT]);

    expect(attrOf(html, 'type="submit"', "role")).toBe("menuitem");
    expect(tagOf(html, 'href="/auth/signout"')).toBe("");
  });

  it("takes the host's wording over its own default", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const nav = authNav({ signoutPath: SIGNOUT_PATH, secret: () => key, signout: { label: "Log out" } });
    const html = await render((await nav(navContext({ identity: fakeIdentity() }))).slots[AUTH_NAV_SIGNOUT_SLOT]);

    expect(textOf(html, "button", 'type="submit"')).toBe("Log out");
  });
});

describe("authNav token", () => {
  it("binds the token to this session, so another session's cannot end it", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const nav = authNav({ signoutPath: SIGNOUT_PATH, secret: () => key });
    const html = await render((await nav(navContext({ identity: fakeIdentity(), sessionId: "sess-1" }))).slots[AUTH_NAV_SIGNOUT_SLOT]);
    const token = attrOf(html, 'name="_csrf"', "value");

    expect(await verifyCsrfToken(key, token, SIGNOUT_PATH, { subject: "sess-1" })).toEqual({ ok: true });
    expect(await verifyCsrfToken(key, token, SIGNOUT_PATH, { subject: "sess-2" })).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("scopes the token to the sign-out path, so it authorises no other POST", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const nav = authNav({ signoutPath: SIGNOUT_PATH, secret: () => key });
    const html = await render((await nav(navContext({ identity: fakeIdentity() }))).slots[AUTH_NAV_SIGNOUT_SLOT]);
    const token = attrOf(html, 'name="_csrf"', "value");

    expect(await verifyCsrfToken(key, token, "/account/email", { subject: "sess-1" })).toEqual({ ok: false, error: "path-mismatch" });
  });

  // A navbar renders on every page, so the key import is the one cost that must not scale with pages.
  it("imports the signing key once per env, however many pages render", async () => {
    let imports = 0;
    const nav = authNav({
      signoutPath: SIGNOUT_PATH,
      secret: async () => {
        imports += 1;
        return importCsrfKey(HEX_SECRET);
      },
    });

    const env = { CSRF_SECRET: HEX_SECRET };
    await nav(navContext({ identity: fakeIdentity(), env }));
    await nav(navContext({ identity: fakeIdentity(), env }));
    expect(imports).toBe(1);
  });
});
