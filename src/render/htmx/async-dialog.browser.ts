import { expect, test } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../../ui/client/browser.fixture";
import { Dialog } from "../../ui/core/dialog";
import { jsx } from "../jsx/jsx-runtime";
import { asyncDialogTrigger } from "./htmx-patterns";

declare global {
  interface Window {
    forgeHtmx: typeof import("../../ui/client/htmx");
    htmxDone: Promise<void>;
  }
}

const EXPOSE = { expose: { forgeHtmx: "./ui/client/htmx" } };

function markup(): Promise<string> {
  return render([
    jsx("button", {
      type: "button",
      id: "open-it",
      ...asyncDialogTrigger({ get: "/details", target: "#details-body", dialogId: "details" }),
      children: "Details",
    }),
    Dialog({ id: "details", label: "Details", children: Dialog.Content({ id: "details-body" }) }),
  ]);
}

test.describe("asyncDialogTrigger", () => {
  test("opens the dialog from a plain button and swaps the loaded fragment into its body", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await page.route("http://forge.test/details", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p id='loaded'>Loaded details</p>" }),
    );
    await page.evaluate(() => {
      window.forgeHtmx.htmx.process(document.body);
      window.htmxDone = new Promise((resolve) => document.addEventListener("htmx:after:swap", () => resolve(), { once: true }));
    });

    await page.click("#open-it");
    await page.evaluate(() => window.htmxDone);

    const state = await page.evaluate(() => ({
      open: document.querySelector<HTMLDialogElement>("#details")?.open,
      body: document.querySelector("#details-body #loaded")?.textContent,
    }));
    expect(state).toEqual({ open: true, body: "Loaded details" });
  });
});
