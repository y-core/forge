import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import type { JSXNode } from "../../jsx/types";
import { render } from "../../testing/render";
import { ANNOUNCE_FAILURE_ATTR, ANNOUNCER_REGION_SLOTS } from "../contracts/announcer-contract";
import { Alert } from "../core/alert";
import { Announcer } from "../core/announcer";
import { FieldError } from "../core/field";
import { createIcon } from "../core/icon";
import { Spinner } from "../core/spinner";
import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeHtmx: typeof import("./htmx");
    forgeAnnounce: typeof import("./announce");
    politeWrites: string[];
    htmxDone: Promise<void>;
  }
}

const EXPOSE = { expose: { forgeHtmx: "./ui/client/htmx", forgeAnnounce: "./ui/client/announce" } };

const POLITE = `[data-slot='${ANNOUNCER_REGION_SLOTS.polite}']`;
const ASSERTIVE = `[data-slot='${ANNOUNCER_REGION_SLOTS.assertive}']`;

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

/** Mounts the page, processes it with htmx, and records every text the polite region is given. */
async function mountPage(page: Page, html: string): Promise<void> {
  await mount(page, html, EXPOSE);
  await page.evaluate((polite) => {
    window.forgeHtmx.htmx.process(document.body);
    window.politeWrites = [];
    const region = document.querySelector(polite);
    if (!region) throw new Error("no polite region");
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) window.politeWrites.push(node.textContent ?? "");
    }).observe(region, { childList: true });
  }, POLITE);
}

async function answer(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.route("http://forge.test/results", respond);
}

/** Clicks the button and resolves once htmx has settled the swap its response caused. */
async function loadAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.htmxDone = new Promise((resolve) => document.body.addEventListener("htmx:afterSettle", () => resolve(), { once: true }));
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

test.describe("htmx — a request's busy indicator", () => {
  test("never speaks the spinner when the response arrives before the settle", async ({ page }) => {
    await mountPage(page, await markup());
    await answer(page, (route) => route.fulfill({ contentType: "text/html", body: "<p>Done</p>" }));

    await loadAndSettle(page);

    expect(await politeWritesSettled(page)).toEqual(["probe"]);
    await expect(page.locator("#out")).toHaveText("Done");
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
