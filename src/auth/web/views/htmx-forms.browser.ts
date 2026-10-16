import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

import { jsx } from "../../../render/jsx/jsx-runtime";
import { render } from "../../../testing/render";
import { mount } from "../../../ui/client/browser.fixture";
import { TURNSTILE_SCRIPT_SRC } from "../../../ui/contracts/turnstile-contract";
import { Announcer } from "../../../ui/core/announcer";
import { fakeAuthCredential, fakeAuthIcon, fakeAuthUser, fakeAuthWebPaths } from "../web.fixture";
import { AdminUserEditView, AUTH_ADMIN_USER_EDIT_ID } from "./admin-user-edit";
import { AUTH_PASSKEY_EDIT_ID, PasskeyEditView } from "./passkey-edit";
import { AUTH_PASSKEY_LIST_ID, PasskeyListView } from "./passkey-list";
import { AUTH_SIGNIN_ID, SigninView } from "./signin";
import { AUTH_TOTP_ID, TotpEnrolView } from "./totp-enrol";

declare global {
  interface Window {
    forgeHtmx: typeof import("../../../ui/client/htmx");
    forgeResume: typeof import("../../../ui/client/resume");
    htmxDone: Promise<void>;
    /** Recorder installed by the stand-in Cloudflare script. */
    authTurnstileCalls: { renders: number; executes: number; removes: number; callback: ((token: string) => void) | null };
  }
}

const EXPOSE = { expose: { forgeHtmx: "./ui/client/htmx" } };

const ORIGIN = "http://forge.test";

const PATHS = fakeAuthWebPaths();

const TOKEN = "csrf-live-7";

const ANSWERED = "answered";

const CREDENTIAL = fakeAuthCredential({ id: "c1", label: "Laptop" });

const TARGET = fakeAuthUser({ id: "u2", email: "grace@example.com", isAdmin: true });

const ENROLLED = { status: "enrolled", enrolledAt: 1 } as const;

const ENROLLING = { status: "enrolling", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Forge:ada@example.com?secret=JBSWY3DPEHPK3PXP" } as const;

type Chrome = { readonly class?: string };

interface AuthHtmxForm {
  readonly name: string;
  readonly root: string;
  readonly method: "PATCH" | "DELETE";
  readonly path: string;
  readonly submit: string;
  readonly view: (chrome: Chrome) => unknown;
  readonly refused: (chrome: Chrome) => unknown;
}

const passkeyEdit = (chrome: Chrome, fieldError?: string) =>
  PasskeyEditView({
    credential: CREDENTIAL,
    renamePath: PATHS.account.passkeyRename({ id: CREDENTIAL.id }),
    cancelPath: PATHS.account.passkeys(),
    csrfToken: TOKEN,
    fieldError,
    icon: fakeAuthIcon,
    ...chrome,
  });

const passkeyList = (chrome: Chrome, fallbackFactors: readonly ["email-otp"] | readonly [] = ["email-otp"]) =>
  PasskeyListView({
    rows: [{ credential: CREDENTIAL, csrfToken: TOKEN }],
    fallbackFactors,
    paths: PATHS.account,
    enrolPath: PATHS.account.passkeyEnrol(),
    icon: fakeAuthIcon,
    ...chrome,
  });

const adminEdit = (chrome: Chrome, outcome: "last-admin-demote" | null = null) =>
  AdminUserEditView({ user: TARGET, lastAdmin: false, self: false, outcome, paths: PATHS.admin, csrfToken: TOKEN, icon: fakeAuthIcon, ...chrome });

const totp = (chrome: Chrome, state: typeof ENROLLED | typeof ENROLLING = ENROLLED) =>
  TotpEnrolView({
    state,
    enrolPath: PATHS.account.totpEnrol(),
    removePath: PATHS.account.totpRemove(),
    csrfToken: TOKEN,
    icon: fakeAuthIcon,
    ...chrome,
  });

const FORMS: readonly AuthHtmxForm[] = [
  {
    name: "passkey rename",
    root: AUTH_PASSKEY_EDIT_ID,
    method: "PATCH",
    path: "/account/passkeys/c1",
    submit: "[data-ref='credential-rename-submit']",
    view: (chrome) => passkeyEdit(chrome),
    refused: (chrome) => passkeyEdit(chrome, "Use a shorter name for this passkey."),
  },
  {
    name: "admin update",
    root: AUTH_ADMIN_USER_EDIT_ID,
    method: "PATCH",
    path: "/admin/users/u2",
    submit: "[data-ref='admin-role-submit']",
    view: (chrome) => adminEdit(chrome),
    refused: (chrome) => adminEdit(chrome, "last-admin-demote"),
  },
  {
    name: "passkey remove",
    root: AUTH_PASSKEY_LIST_ID,
    method: "DELETE",
    path: "/account/passkeys/c1",
    submit: "[data-ref='credential-remove']",
    view: (chrome) => passkeyList(chrome),
    refused: (chrome) => passkeyList(chrome, []),
  },
  {
    name: "TOTP remove",
    root: AUTH_TOTP_ID,
    method: "DELETE",
    path: "/account/totp",
    submit: "[data-ref='totp-remove']",
    view: (chrome) => totp(chrome),
    refused: (chrome) => totp(chrome, ENROLLING),
  },
];

async function mountView(page: Page, view: unknown): Promise<void> {
  await mount(page, await render(jsx("main", { children: [view, Announcer({})] })), EXPOSE);
  await page.evaluate(() => window.forgeHtmx.htmx.process(document.body));
}

/** Answers `method` on `path` with `respond`, handing back every request it answered. */
async function answer(
  page: Page,
  form: Pick<AuthHtmxForm, "method" | "path">,
  respond: { status: number; contentType?: string; body?: string; headers?: Record<string, string> },
): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(`${ORIGIN}${form.path}**`, async (route) => {
    if (route.request().method() !== form.method) return route.fallback();
    seen.push(route.request());
    await route.fulfill(respond);
  });
  return seen;
}

async function submitAndFinish(page: Page, submit: string): Promise<void> {
  await page.evaluate(() => {
    window.htmxDone = new Promise((resolve) => document.addEventListener("htmx:finally:request", () => resolve(), { once: true }));
  });
  await page.click(submit);
  await page.evaluate(() => window.htmxDone);
}

for (const form of FORMS) {
  test.describe(`auth htmx form — ${form.name}`, () => {
    for (const [status, answered] of [
      [200, form.view],
      [422, form.refused],
    ] as const) {
      test(`swaps the ${status} re-render over the view, leaving exactly one #${form.root}`, async ({ page }) => {
        await mountView(page, form.view({}));
        await answer(page, form, { status, contentType: "text/html", body: await render(answered({ class: ANSWERED })) });

        await submitAndFinish(page, form.submit);

        await expect(page.locator(`#${form.root}`)).toHaveCount(1);
        await expect(page.locator(`#${form.root}.${ANSWERED}`)).toHaveCount(1);
      });
    }

    test("leaves the card as it was on a text/plain 403", async ({ page }) => {
      await mountView(page, form.view({}));
      const before = await page.locator(`#${form.root}`).evaluate((card) => card.outerHTML);
      await answer(page, form, { status: 403, contentType: "text/plain", body: "Forbidden" });

      await submitAndFinish(page, form.submit);

      await expect(page.locator(`#${form.root}`)).toHaveCount(1);
      expect(await page.locator(`#${form.root}`).evaluate((card) => card.outerHTML)).toBe(before);
    });
  });
}

const DELETES: readonly Pick<AuthHtmxForm, "name" | "method" | "path" | "submit" | "view">[] = [
  ...FORMS.filter((form) => form.method === "DELETE"),
  {
    name: "admin remove",
    method: "DELETE",
    path: "/admin/users/u2",
    submit: "[data-ref='admin-delete-submit']",
    view: (chrome) => adminEdit(chrome),
  },
];

test.describe("auth htmx DELETE — the CSRF token travels in the header only", () => {
  for (const form of DELETES) {
    test(`${form.name} sends the token as x-csrf-token and puts no _csrf in the URL`, async ({ page }) => {
      await mountView(page, form.view({}));
      const seen = await answer(page, form, { status: 204 });

      await submitAndFinish(page, form.submit);

      expect(seen.map((request) => ({ url: request.url(), token: request.headers()["x-csrf-token"] }))).toEqual([
        { url: `${ORIGIN}${form.path}`, token: TOKEN },
      ]);
    });
  }
});

test.describe("auth htmx DELETE — a redirect answer", () => {
  test("admin remove answered with 204 and HX-Redirect navigates the page to the listing", async ({ page }) => {
    await mountView(page, adminEdit({}));
    await answer(page, { method: "DELETE", path: "/admin/users/u2" }, { status: 204, headers: { "HX-Redirect": "/admin/users" } });
    await page.route(`${ORIGIN}/admin/users`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><h1 id='listing'>Users</h1>" }),
    );

    await page.click("[data-ref='admin-delete-submit']");

    await page.waitForURL(`${ORIGIN}/admin/users`);
    await expect(page.locator("#listing")).toHaveText("Users");
  });
});

/** Stands in for Cloudflare's `api.js`: a recording `window.turnstile` whose challenge answers only when the test says so. */
const FAKE_TURNSTILE_SCRIPT = `
  window.authTurnstileCalls = { renders: 0, executes: 0, removes: 0, callback: null };
  window.turnstile = {
    render: function (el, params) {
      window.authTurnstileCalls.renders += 1;
      window.authTurnstileCalls.callback = params.callback;
      return "widget-" + window.authTurnstileCalls.renders;
    },
    execute: function () { window.authTurnstileCalls.executes += 1; },
    reset: function () {
      var input = document.querySelector("[name='cf-turnstile-response']");
      if (input) input.value = "";
    },
    remove: function () { window.authTurnstileCalls.removes += 1; },
  };
`;

const EXPOSE_SCOPED = { expose: { forgeHtmx: "./ui/client/htmx", forgeCoreClient: "./ui/core/client", forgeResume: "./ui/client/resume" } };

const SIGNIN_WIDGET = { siteKey: "site-key", action: "auth-signin" };

const signin = (fieldError?: string) =>
  SigninView({
    submitPath: PATHS.auth.signinSubmit(),
    signupPath: PATHS.auth.signup(),
    csrfToken: TOKEN,
    fieldError,
    turnstile: SIGNIN_WIDGET,
    icon: fakeAuthIcon,
  });

/** What Cloudflare does when the deferred challenge passes: write the token input into the live widget, then call back. */
const completeChallenge = (page: Page, token: string) =>
  page.evaluate(
    ({ value, root }) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "cf-turnstile-response";
      input.value = value;
      document.querySelector(`#${root} [data-ref='turnstile']`)?.appendChild(input);
      window.authTurnstileCalls.callback?.(value);
    },
    { value: token, root: AUTH_SIGNIN_ID },
  );

const challengeCounts = (page: Page) =>
  page.evaluate(() => {
    const { renders, executes, removes } = window.authTurnstileCalls;
    return { renders, executes, removes };
  });

test.describe("auth htmx form — sign-in under Turnstile", () => {
  /** Mounts the guarded sign-in card under htmx and the scope runtime, answering every POST with `respond`; hands back each body sent. */
  async function mountGuarded(page: Page, respond: () => Promise<string>, status: number): Promise<string[]> {
    const posts: string[] = [];
    await page.route(
      (url) => url.href.startsWith(TURNSTILE_SCRIPT_SRC),
      (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_TURNSTILE_SCRIPT }),
    );
    await mount(page, await render(jsx("main", { children: [signin(), Announcer({})] })), EXPOSE_SCOPED);
    await page.route(`${ORIGIN}/auth/signin`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().postData() ?? "");
      await route.fulfill({ status, contentType: "text/html", body: await respond() });
    });
    await page.evaluate(() => {
      window.forgeResume.resume();
      window.forgeHtmx.htmx.process(document.body);
    });
    await expect.poll(() => page.evaluate(() => window.authTurnstileCalls?.renders ?? 0)).toBe(1);
    return posts;
  }

  test("holds the press until the challenge issues a token, then posts the form once with it", async ({ page }) => {
    const posts = await mountGuarded(page, () => render(signin()), 200);
    await page.locator("#field-email").fill("ada@example.com");

    await page.locator(`#${AUTH_SIGNIN_ID} button[type='submit']`).click();
    await expect.poll(() => page.evaluate(() => window.authTurnstileCalls.executes)).toBe(1);
    expect(posts).toEqual([]);

    await completeChallenge(page, "token-1");
    await expect.poll(() => posts.length).toBe(1);

    const body = new URLSearchParams(posts[0]);
    expect({ token: body.get("cf-turnstile-response"), email: body.get("email"), csrf: body.get("_csrf") }).toEqual({
      token: "token-1",
      email: "ada@example.com",
      csrf: TOKEN,
    });
  });

  test("swaps a refusal's card back in and remounts its widget, which holds the next press too", async ({ page }) => {
    const refusal = "Enter an email address in the form name@example.com.";
    const posts = await mountGuarded(page, () => render(signin(refusal)), 422);
    await page.locator("#field-email").fill("ada@example.com");
    await page.locator(`#${AUTH_SIGNIN_ID} button[type='submit']`).click();
    await expect.poll(() => page.evaluate(() => window.authTurnstileCalls.executes)).toBe(1);

    await completeChallenge(page, "token-1");
    await expect(page.locator(`#${AUTH_SIGNIN_ID} #field-email-error`)).toHaveText(refusal);
    await expect(page.locator(`#${AUTH_SIGNIN_ID}`)).toHaveCount(1);
    await expect.poll(() => challengeCounts(page)).toEqual({ renders: 2, executes: 1, removes: 1 });

    await page.locator("#field-email").fill("ada@example.com");
    await page.locator(`#${AUTH_SIGNIN_ID} button[type='submit']`).click();
    await expect.poll(() => page.evaluate(() => window.authTurnstileCalls.executes)).toBe(2);
    expect(posts).toHaveLength(1);
  });
});
