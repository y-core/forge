/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { pageShell, shellCtx } from "../../app/shell";
import type { PageShell } from "../../app/types";
import type { FC } from "../../jsx/types";
import { renderAuthPage } from "./render";
import type { AuthViews } from "./types";
import { PasskeyListView } from "./views/passkey-list";
import type { SigninViewProps } from "./views/types";
import type { VerifyViewProps } from "./views/types";

const icon: SigninViewProps["icon"] = () => null;

/** The real props a signin view is handed, so what this file proves is what a consumer is held to. */
const signinProps = (email: string): SigninViewProps => ({
  primaryFactor: "email-otp",
  submitPath: "/auth/signin",
  signupPath: "/auth/signup",
  csrfToken: "tok",
  email,
  icon,
});

const ForgeSignin: FC<SigninViewProps> = ({ email }) => <p data-view='forge'>{email}</p>;
const ForgeVerify: FC<VerifyViewProps> = ({ email }) => <p data-view='forge'>{email}</p>;

/** The app's own shell, as a consumer registers it — no `<head>`, so what auth adds is visible. */
const appShell: PageShell = (_c, content) => (
  <html lang='en'>
    <body>{content}</body>
  </html>
);

function context(headers: Record<string, string> = {}, shell?: PageShell): RequestContext {
  const c = new RequestContext(new Request("http://localhost/auth/signin", { headers }));
  if (shell) shellCtx.set(c, shell);
  return c;
}

function signin(c: RequestContext, extra: { views?: AuthViews; status?: number; headers?: Record<string, string> } = {}) {
  return renderAuthPage(c, { name: "signin", view: ForgeSignin, props: signinProps("Ada & Co <ada@example.com>"), ...extra });
}

describe("renderAuthPage", () => {
  it("renders a full document for an ordinary navigation", async () => {
    const res = await signin(context({}, appShell));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html lang="en"><body><p data-view="forge">Ada &amp; Co &lt;ada@example.com&gt;</p></body></html>',
    );
  });

  it("renders a fragment for an htmx request", async () => {
    const res = await signin(context({ "HX-Request": "true" }, appShell));
    expect(await res.text()).toBe('<p data-view="forge">Ada &amp; Co &lt;ada@example.com&gt;</p>');
  });

  it("renders a full document for a boosted navigation, which carries the htmx header but wants a page", async () => {
    const res = await signin(context({ "HX-Request": "true", "HX-Boosted": "true" }, appShell));
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html lang="en"><body><p data-view="forge">Ada &amp; Co &lt;ada@example.com&gt;</p></body></html>',
    );
  });
});

// An app that registered no shell is the documented base offering, so what it renders has to be a
// readable page — not the bare `<!DOCTYPE html><p>` a shell-less render used to answer with.
describe("renderAuthPage without a registered shell", () => {
  it("renders a complete document, titled for the page", async () => {
    const res = await renderAuthPage(context(), { name: "signin", view: ForgeSignin, props: signinProps("ada@example.com") });
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Sign in</title><meta name="robots" content="noindex"></head><body><p data-view="forge">ada@example.com</p></body></html>',
    );
  });

  it("links every stylesheet and loads every script the registered `pageShell` was given", async () => {
    const shell = pageShell({ stylesheet: ["/assets/app.css", "/assets/auth.css"], script: "/assets/auth.js", lang: "cy" });
    const res = await renderAuthPage(context({}, shell), {
      name: "accountPasskeys",
      view: ForgeSignin as never,
      props: signinProps("ada@example.com") as never,
    });
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html lang="cy"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Passkeys</title><meta name="robots" content="noindex">' +
        '<link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/auth.css"></head>' +
        '<body><p data-view="forge">ada@example.com</p><script type="module" src="/assets/auth.js"></script></body></html>',
    );
  });

  it("lets the mount override the per-page title", async () => {
    const res = await renderAuthPage(context(), {
      name: "signin",
      view: ForgeSignin,
      props: signinProps("ada@example.com"),
      meta: { title: "Acme — sign in" },
    });
    expect(await res.text()).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Acme — sign in</title><meta name="robots" content="noindex"></head><body><p data-view="forge">ada@example.com</p></body></html>',
    );
  });
});

// Without the slot a consumer's one shell cannot vary per page, and without the request it cannot
// read a nonce — so both are asserted rather than assumed.
describe("renderAuthPage shell slot", () => {
  it("hands the registered shell the request and a slot naming the auth page", async () => {
    const seen: { c: unknown; slot: unknown }[] = [];
    const capture: PageShell = (shellC, content, slot) => {
      seen.push({ c: shellC, slot });
      return <html lang='en'>{content}</html>;
    };
    const c = context({}, capture);
    await renderAuthPage(c, { name: "signin", view: ForgeSignin, props: signinProps("ada@example.com") });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.c).toBe(c);
    expect(seen[0]?.slot).toEqual({ mount: "auth", page: "signin", meta: { title: "Sign in", robots: "noindex" } });
  });

  it("names the page in the slot for a page whose title is not its own name", async () => {
    const seen: string[] = [];
    const capture: PageShell = (_c, content, slot) => {
      seen.push(`${slot.page}:${slot.meta.title}`);
      return <html lang='en'>{content}</html>;
    };
    await renderAuthPage(context({}, capture), { name: "adminUsers", view: ForgeSignin as never, props: signinProps("ada@example.com") as never });
    expect(seen).toEqual(["adminUsers:Users"]);
  });

  it("renders no shell around an htmx fragment, so a registered shell is never asked", async () => {
    let asked = 0;
    const capture: PageShell = (_c, content) => {
      asked += 1;
      return <html lang='en'>{content}</html>;
    };
    const res = await renderAuthPage(context({ "HX-Request": "true" }, capture), {
      name: "signin",
      view: ForgeSignin,
      props: signinProps("ada@example.com"),
    });
    expect(asked).toBe(0);
    expect(await res.text()).toBe('<p data-view="forge">ada@example.com</p>');
  });
});

describe("renderAuthPage view override", () => {
  const OwnSignin: FC<SigninViewProps> = ({ email }) => <section data-view='consumer'>{email}</section>;
  const views: AuthViews = { signin: OwnSignin };

  it("replaces only the markup, leaving status and headers identical to the default", async () => {
    const init = { status: 401, headers: { "x-auth-step": "signin" } };
    const fallback = await signin(context({}, appShell), init);
    const overridden = await signin(context({}, appShell), { ...init, views });

    expect(overridden.status).toBe(fallback.status);
    expect([...overridden.headers].sort()).toEqual([...fallback.headers].sort());
    expect(await overridden.text()).toBe(
      '<!DOCTYPE html><html lang="en"><body><section data-view="consumer">Ada &amp; Co &lt;ada@example.com&gt;</section></body></html>',
    );
    expect(await fallback.text()).toBe(
      '<!DOCTYPE html><html lang="en"><body><p data-view="forge">Ada &amp; Co &lt;ada@example.com&gt;</p></body></html>',
    );
  });

  it("hands the override exactly the props forge's own view would have received", async () => {
    const res = await signin(context({ "HX-Request": "true" }, appShell), { views });
    expect(await res.text()).toBe('<section data-view="consumer">Ada &amp; Co &lt;ada@example.com&gt;</section>');
  });

  it("leaves a page the consumer did not override on forge's markup", async () => {
    const res = await renderAuthPage(context({ "HX-Request": "true" }), {
      name: "verify",
      view: ForgeVerify,
      props: { factor: "email-otp", submitPath: "/auth/verify", signinPath: "/auth/signin", csrfToken: "tok", email: "ada@example.com", icon },
      views,
    });
    expect(await res.text()).toBe('<p data-view="forge">ada@example.com</p>');
  });
});

// The map is what makes these two lines errors, and an unused `@ts-expect-error` is itself an error
// under this tsconfig — so each one is a live assertion that the compiler, and not a cast, holds the
// promise that an override receives exactly the props the view it replaces would have.
describe("AuthViews holds an override to its own page's props", () => {
  it("refuses a signin entry whose props are not a signin view's", () => {
    const OwnSignin: FC<{ readonly email: string }> = ({ email }) => <p>{email}</p>;
    // @ts-expect-error -- a `signin` entry is held to `SigninViewProps`, which `{ email: string }` is not
    const views: AuthViews = { signin: OwnSignin };
    expect(views.signin).toBe(OwnSignin);
  });

  it("refuses one page's own view under another page's name", () => {
    // @ts-expect-error -- `accountPasskeyEdit` is held to `PasskeyEditViewProps`, not the list view's
    const views: AuthViews = { accountPasskeyEdit: PasskeyListView };
    expect(views.accountPasskeyEdit).toBe(PasskeyListView);
  });
});
