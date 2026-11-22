import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { Forge } from "../../app/forge-app";
import { createHandlerFactory } from "../../app/handler-factory";
import { refuseAsFragment } from "../../app/refusal";
import type { Refusal } from "../../context/types";
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT } from "../../form/constants";
import { jsx } from "../../render/jsx/jsx-runtime";
import type { JSXNode } from "../../render/jsx/types";
// oxlint-disable-next-line eslint/no-restricted-imports -- `post` is defined only in the router facade's barrel, and nothing imports a spec, so no cycle is reachable
import { post } from "../../router/mod";
import { createTestContext } from "../../testing/context";
import { render } from "../../testing/render";
import { mapHandler } from "../../testing/route";
import { v } from "../../validation/validation";
import { ANNOUNCE_FAILURE_ATTR, ANNOUNCER_REGION_SLOTS } from "../contracts/announcer-contract";
import { Alert } from "../core/alert";
import { Announcer } from "../core/announcer";
import { Button } from "../core/button";
import { FieldError } from "../core/field";
import { Form } from "../core/form";
import { createIcon } from "../core/icon";
import { Spinner } from "../core/spinner";
import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeHtmx: typeof import("./htmx");
    forgeAnnounce: typeof import("./announce");
    politeWrites: string[];
    assertiveWrites: string[];
    htmxDone: Promise<void>;
    htmxAnswered: Promise<void>;
  }
}

const EXPOSE = { expose: { forgeHtmx: "./ui/client/htmx", forgeAnnounce: "./ui/client/announce" } };

const POLITE = `[data-slot='${ANNOUNCER_REGION_SLOTS.polite}']`;
const ASSERTIVE = `[data-slot='${ANNOUNCER_REGION_SLOTS.assertive}']`;
const PAUSE_HORIZON_MS = 86_400_000;

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 24 24" });

/** A button whose request marks a spinner-holding indicator, a target for the response, and the page's `<Announcer />`. */
function markup(): Promise<string> {
  return render(
    jsx("div", {
      children: [
        jsx("button", { id: "load", "hx-get": "/results", "hx-target": "#out", "hx-indicator": "#busy", children: "Load" }),
        jsx("span", { id: "busy", class: "htmx-indicator", children: Spinner({ icon, label: "Loading results" }) }),
        jsx("div", { id: "out" }),
        Announcer({}),
      ],
    }),
  );
}

/** Mounts the page, processes it with htmx, and records every text each announcer region is given. */
async function mountPage(page: Page, html: string): Promise<void> {
  await mount(page, html, EXPOSE);
  await page.evaluate(
    ({ polite, assertive }) => {
      window.forgeHtmx.htmx.process(document.body);
      window.politeWrites = [];
      window.assertiveWrites = [];
      for (const [selector, writes] of [
        [polite, window.politeWrites],
        [assertive, window.assertiveWrites],
      ] as const) {
        const region = document.querySelector(selector);
        if (!region) throw new Error(`no region at ${selector}`);
        new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) writes.push(node.textContent ?? "");
        }).observe(region, { childList: true });
      }
    },
    { polite: POLITE, assertive: ASSERTIVE },
  );
}

async function answer(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.route("http://forge.test/results", respond);
}

/** Clicks the button with the page's clock paused until htmx fires `answered`, so the response always lands inside the announcer's settle. */
async function clickWithinSettle(page: Page, answered: string): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + PAUSE_HORIZON_MS);
  await page.evaluate((event) => {
    window.htmxAnswered = new Promise((resolve) => document.addEventListener(event, () => resolve(), { once: true }));
    document.querySelector<HTMLElement>("#load")?.click();
  }, answered);
  await page.evaluate(() => window.htmxAnswered);
  await page.clock.resume();
}

/** Clicks the button and resolves once htmx has settled the swap its response caused. */
async function loadAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.htmxDone = new Promise((resolve) => document.addEventListener("htmx:after:swap", () => resolve(), { once: true }));
  });
  await clickWithinSettle(page, "htmx:after:request");
  await page.evaluate(() => window.htmxDone);
}

/** Clicks the button and resolves once htmx has finished the request, whether or not it swapped. */
async function requestAndFinish(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.htmxDone = new Promise((resolve) => document.addEventListener("htmx:finally:request", () => resolve(), { once: true }));
  });
  await page.click("#load");
  await page.evaluate(() => window.htmxDone);
}

/** Every text the polite region was given, read once a probe announced after now has itself been spoken. */
async function politeWritesSettled(page: Page): Promise<string[]> {
  await page.evaluate(() => window.forgeAnnounce.announce("probe", { channel: "probe" }));
  await expect(page.locator(POLITE)).toHaveText("probe");
  return page.evaluate(() => window.politeWrites);
}

/** Every text the assertive region was given, read once a probe announced after now has itself been spoken. */
async function assertiveWritesSettled(page: Page): Promise<string[]> {
  await page.evaluate(() => window.forgeAnnounce.announce("probe", { channel: "probe", politeness: "assertive" }));
  await expect(page.locator(ASSERTIVE)).toContainText("probe");
  return page.evaluate(() => window.assertiveWrites);
}

async function fulfillWith(route: Route, response: Response): Promise<void> {
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
}

test.describe("htmx — a request's busy indicator", () => {
  test("never speaks the spinner when the response arrives before the settle", async ({ page }) => {
    await mountPage(page, await markup());
    await answer(page, (route) => route.fulfill({ contentType: "text/html", body: "<p>Done</p>" }));

    await loadAndSettle(page);

    expect(await politeWritesSettled(page)).toEqual(["probe"]);
    await expect(page.locator("#out")).toHaveText("Done");
  });

  test("never speaks the spinner when the request fails on the network before the settle", async ({ page }) => {
    await mountPage(page, await markup());
    await answer(page, (route) => route.abort());

    await clickWithinSettle(page, "htmx:error");

    expect(await politeWritesSettled(page)).toEqual(["probe"]);
  });

  test("speaks the indicator's spinner label while a slow request is still waiting", async ({ page }) => {
    await mountPage(page, await markup());
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    await answer(page, async (route) => {
      await released;
      await route.fulfill({ contentType: "text/html", body: "<p>Done</p>" });
    });

    await page.click("#load");

    await expect(page.locator(POLITE)).toHaveText("Loading results");
    release();
    await expect(page.locator("#out")).toHaveText("Done");
  });
});

test.describe("htmx — content a swap introduces", () => {
  async function swapIn(page: Page, body: JSXNode): Promise<void> {
    await mountPage(page, await markup());
    const html = await render(body);
    await answer(page, (route) => route.fulfill({ contentType: "text/html", body: html }));
    await loadAndSettle(page);
  }

  test("interrupts with the first field error the response holds", async ({ page }) => {
    await swapIn(
      page,
      jsx("form", {
        children: [
          FieldError({ name: "email", children: "Enter an email address" }),
          FieldError({ name: "password", children: "Choose a password" }),
        ],
      }),
    );

    await expect(page.locator(ASSERTIVE)).toHaveText("Enter an email address");
  });

  test("interrupts with a failure panel's message, as a failed request's swapped-in panel is", async ({ page }) => {
    const message = "Could not read the log stream. The channel did not answer.";
    await swapIn(
      page,
      Alert({
        tone: "destructive",
        [ANNOUNCE_FAILURE_ATTR]: message,
        children: [Alert.Title({ children: "Could not read the log stream" }), jsx("button", { children: "Retry" })],
      }),
    );

    await expect(page.locator(ASSERTIVE)).toHaveText(message);
  });

  test("speaks a spinner the response shows, as a swapped-in pending state is", async ({ page }) => {
    await swapIn(page, jsx("div", { children: Spinner({ icon, label: "Preparing export" }) }));

    await expect(page.locator(POLITE)).toHaveText("Preparing export");
  });

  for (const [what, wrapper] of [
    ["inside an htmx indicator", { class: "htmx-indicator" }],
    ["inside a hidden element", { hidden: true }],
  ] as const) {
    test(`says nothing for a swapped-in spinner ${what}, which no one can see`, async ({ page }) => {
      await swapIn(page, jsx("div", { ...wrapper, children: Spinner({ icon, label: "Preparing export" }) }));

      expect(await politeWritesSettled(page)).toEqual(["probe"]);
    });
  }
});

test.describe("htmx — the configured module", () => {
  test("drops htmx's own unlayered indicator sheet, so forge-ui's layered rules govern", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const adopted = await page.evaluate(() =>
      document.adoptedStyleSheets.some((sheet) => {
        const first = sheet.cssRules[0];
        return first instanceof CSSStyleRule && first.selectorText === ".htmx-indicator";
      }),
    );

    expect(adopted).toBe(false);
  });

  test("swaps a 422 fragment into the target and interrupts with its field error", async ({ page }) => {
    await mountPage(page, await markup());
    const html = await render(jsx("form", { children: FieldError({ name: "email", children: "Enter an email address" }) }));
    await answer(page, (route) => route.fulfill({ status: 422, contentType: "text/html", body: html }));

    await loadAndSettle(page);

    await expect(page.locator("#out")).toContainText("Enter an email address");
    await expect(page.locator(ASSERTIVE)).toHaveText("Enter an email address");
  });

  test("leaves the target unchanged on an unmarked 500", async ({ page }) => {
    await mountPage(page, await markup());
    await answer(page, (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<p>Server error</p>" }));

    await requestAndFinish(page);

    await expect(page.locator("#out")).toBeEmpty();
  });

  test("leaves the target unchanged on an unmarked 503 whose server asks for a swap with HX-Reswap", async ({ page }) => {
    await mountPage(page, await markup());
    await answer(page, (route) =>
      route.fulfill({ status: 503, contentType: "text/html", headers: { "HX-Reswap": "innerHTML" }, body: "<p>Unavailable</p>" }),
    );

    await requestAndFinish(page);

    await expect(page.locator("#out")).toBeEmpty();
  });

  test("leaves the target untouched on a text/plain 403 and interrupts with its text exactly once", async ({ page }) => {
    await mountPage(page, await markup());
    await page.evaluate(() => {
      const out = document.querySelector("#out");
      if (out) out.textContent = "Kept";
    });
    await answer(page, (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "Forbidden" }));

    await requestAndFinish(page);

    await expect(page.locator("#out")).toHaveText("Kept");
    expect(await assertiveWritesSettled(page)).toEqual(["Forbidden", "probe"]);
  });

  test("still swaps a text/plain 403 where the element asks for it with hx-status", async ({ page }) => {
    const html = await render(
      jsx("div", {
        children: [
          jsx("button", { id: "load", "hx-get": "/results", "hx-target": "#out", "hx-status:403": "swap:innerHTML", children: "Load" }),
          jsx("div", { id: "out" }),
          Announcer({}),
        ],
      }),
    );
    await mountPage(page, html);
    await answer(page, (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "Forbidden" }));

    await requestAndFinish(page);

    await expect(page.locator("#out")).toHaveText("Forbidden");
  });

  test("swaps an unmarked 500 where the element asks for it with hx-status:5xx", async ({ page }) => {
    const html = await render(
      jsx("div", {
        children: [
          jsx("button", { id: "load", "hx-get": "/results", "hx-target": "#out", "hx-status:5xx": "swap:innerHTML", children: "Load" }),
          jsx("div", { id: "out" }),
          Announcer({}),
        ],
      }),
    );
    await mountPage(page, html);
    await answer(page, (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<p>Server error</p>" }));

    await requestAndFinish(page);

    await expect(page.locator("#out")).toHaveText("Server error");
  });

  test("never speaks the spinner for a fast request whose button swaps itself away", async ({ page }) => {
    const html = await render(
      jsx("div", {
        children: [
          jsx("button", {
            id: "load",
            "hx-get": "/results",
            "hx-target": "this",
            "hx-swap": "outerHTML",
            "hx-indicator": "#busy",
            children: "Load",
          }),
          jsx("span", { id: "busy", class: "htmx-indicator", children: Spinner({ icon, label: "Loading results" }) }),
          Announcer({}),
        ],
      }),
    );
    await mountPage(page, html);
    await answer(page, (route) => route.fulfill({ contentType: "text/html", body: '<p id="done">Done</p>' }));

    await loadAndSettle(page);

    await expect(page.locator("#done")).toHaveText("Done");
    expect(await politeWritesSettled(page)).toEqual(["probe"]);
  });
});

test.describe("htmx — a failure fragment forge answers", () => {
  /** A button whose request targets `#out`, a separate `#notice` a refusal retargets to, and the page's `<Announcer />`. */
  function failureMarkup(): Promise<string> {
    return render(
      jsx("div", {
        children: [
          jsx("button", { id: "load", "hx-get": "/results", "hx-target": "#out", children: "Send" }),
          jsx("div", { id: "out" }),
          jsx("div", { id: "notice" }),
          Announcer({}),
        ],
      }),
    );
  }

  const refusals: Refusal[] = [
    { guard: "csrf", status: 400, reason: "unreadable-body" },
    { guard: "origin", status: 403, reason: "cross-site" },
    { guard: "csrf", status: 413, reason: "too-large" },
    { guard: "rate-limit", status: 429 },
    { guard: "rate-limit", status: 503, reason: "binding-absent" },
  ];

  for (const refusal of refusals) {
    test(`swaps refuseAsFragment's ${refusal.status} panel into its HX-Retarget and announces it once on failure`, async ({ page }) => {
      const message = `Refused with ${refusal.status}.`;
      const hook = refuseAsFragment({ target: "#notice", render: () => ({ message, panel: jsx("p", { children: "Try again later." }) }) });
      const response = await hook(createTestContext(new Request("http://forge.test/results", { headers: { "HX-Request": "true" } })), refusal);
      if (!response) throw new Error("refuseAsFragment declined a refusal");
      await mountPage(page, await failureMarkup());
      await answer(page, (route) => fulfillWith(route, response));

      await loadAndSettle(page);

      await expect(page.locator("#notice")).toHaveText("Try again later.");
      await expect(page.locator("#out")).toBeEmpty();
      expect(await assertiveWritesSettled(page)).toEqual([message, "probe"]);
    });
  }

  test("swaps a 503 an app marks itself into the request's own target and announces it once on failure", async ({ page }) => {
    const message = "Search is down for maintenance.";
    const panel = await render(jsx("div", { [ANNOUNCE_FAILURE_ATTR]: message, children: jsx("p", { children: "Try again in an hour." }) }));
    await mountPage(page, await failureMarkup());
    await answer(page, (route) =>
      route.fulfill({ status: 503, contentType: "text/html", headers: { "forge-failure-fragment": "1" }, body: panel }),
    );

    await loadAndSettle(page);

    await expect(page.locator("#out")).toHaveText("Try again in an hour.");
    await expect(page.locator("#notice")).toBeEmpty();
    expect(await assertiveWritesSettled(page)).toEqual([message, "probe"]);
  });

  const { defineAction } = createHandlerFactory();
  const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

  function submitAction(handle: () => Response, body: string): Promise<Response> {
    const app = new Forge();
    mapHandler(app, "POST", "/test", defineAction(post("/test"), { schema: NameSchema, handle }));
    return app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "HX-Request": "true" }, body });
  }

  const actions: Array<{ status: number; handle: () => Response; body: string; spoken: string }> = [
    { status: 422, handle: () => new Response("ok"), body: "name=", spoken: "Please correct the following fields." },
    {
      status: 500,
      handle: () => {
        throw new Error("downstream failure");
      },
      body: "name=Jane",
      spoken: "Something went wrong. Please try again.",
    },
  ];

  for (const action of actions) {
    test(`swaps defineAction's ${action.status} fragment into the request's own target and announces it once on failure`, async ({ page }) => {
      const response = await submitAction(action.handle, action.body);
      expect(response.status).toBe(action.status);
      await mountPage(page, await failureMarkup());
      await answer(page, (route) => fulfillWith(route, response));

      await loadAndSettle(page);

      await expect(page.locator("#out")).toContainText(action.spoken);
      expect(await assertiveWritesSettled(page)).toEqual([action.spoken, "probe"]);
    });
  }
});

test.describe("htmx — a no-JS DELETE form whose button carries the verb", () => {
  const token = "csrf-token-7f3a";

  type SentDelete = { method: string; url: string; csrfHeader: string | null };

  async function submitDelete(page: Page, button: Record<string, unknown>): Promise<SentDelete> {
    const html = await render(
      Form({
        csrfToken: token,
        action: "/items/1",
        children: Button({ id: "load", type: "submit", "hx-delete": "/items/1", ...button, children: "Remove" }),
      }),
    );
    await mount(page, html, EXPOSE);
    await page.evaluate(() => window.forgeHtmx.htmx.process(document.body));
    let sent: SentDelete | undefined;
    await page.route("http://forge.test/items/1**", async (route) => {
      const request = route.request();
      sent = { method: request.method(), url: request.url(), csrfHeader: await request.headerValue(CSRF_HEADER_DEFAULT) };
      await route.fulfill({ contentType: "text/html", body: "" });
    });

    await requestAndFinish(page);

    if (!sent) throw new Error("no request reached /items/1");
    return sent;
  }

  test("sends the CSRF header from the button's own hx-headers, and no field in the URL", async ({ page }) => {
    const sent = await submitDelete(page, { "hx-headers": JSON.stringify({ [CSRF_HEADER_DEFAULT]: token }) });

    expect(sent).toEqual({ method: "DELETE", url: "http://forge.test/items/1", csrfHeader: token });
    await expect(page.locator(`form input[type='hidden'][name='${CSRF_FIELD_DEFAULT}']`)).toHaveValue(token);
  });

  test("sends no CSRF header when only the form carries hx-headers, since the button inherits none", async ({ page }) => {
    const sent = await submitDelete(page, {});

    expect(sent).toEqual({ method: "DELETE", url: "http://forge.test/items/1", csrfHeader: null });
    expect(JSON.parse((await page.locator("form").getAttribute("hx-headers")) ?? "{}")).toEqual({ [CSRF_HEADER_DEFAULT]: token });
  });
});

test.describe("htmx — a <Form> htmx submits by hx-method", () => {
  const token = "csrf-token-9c1e";

  test("sends a DELETE whose URL carries the form's fields but no CSRF field, with the token as a header", async ({ page }) => {
    const html = await render(
      Form({
        csrfToken: token,
        ...{ "hx-action": "/items/1", "hx-method": "delete" },
        children: [jsx("input", { name: "title", value: "Old" }), Button({ id: "load", type: "submit", children: "Remove" })],
      }),
    );
    await mount(page, html, EXPOSE);
    await page.evaluate(() => window.forgeHtmx.htmx.process(document.body));
    let sent: { method: string; url: string; csrfHeader: string | null } | undefined;
    await page.route("http://forge.test/items/1**", async (route) => {
      const request = route.request();
      sent = { method: request.method(), url: request.url(), csrfHeader: await request.headerValue(CSRF_HEADER_DEFAULT) };
      await route.fulfill({ contentType: "text/html", body: "" });
    });

    await requestAndFinish(page);

    expect(sent).toEqual({ method: "DELETE", url: "http://forge.test/items/1?title=Old", csrfHeader: token });
  });
});
