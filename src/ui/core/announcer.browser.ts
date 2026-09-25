import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import type { JSXNode } from "../../jsx/types";
import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { ANNOUNCER_REGION_SLOTS } from "../contracts/announcer-contract";
import { Announcer } from "./announcer";
import { Toast } from "./toast";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    forgeAnnounce: typeof import("../client/announce");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client", forgeAnnounce: "./ui/client/announce" } };

const POLITE = `[data-slot='${ANNOUNCER_REGION_SLOTS.polite}']`;
const ASSERTIVE = `[data-slot='${ANNOUNCER_REGION_SLOTS.assertive}']`;

/** A layout holding the page's `<Announcer />` and a toast stack, with `children` rendered into the stack. */
function layout(...children: JSXNode[]): Promise<string> {
  return render(jsx("div", { children: [Toast.Container({ id: "toasts", children }), Announcer({})] }));
}

interface AxNode {
  nodeId: string;
  ignored: boolean;
  name?: { value?: string };
  properties?: Array<{ name: string; value: { value?: unknown } }>;
  childIds?: string[];
}

/** Every live region in Chromium's accessibility tree, with the politeness it exposes and the text it holds. */
async function liveRegions(page: Page): Promise<Array<{ live: unknown; text: string }>> {
  const session = await page.context().newCDPSession(page);
  const { nodes } = (await session.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const textOf = (node: AxNode): string =>
    (node.childIds ?? [])
      .map((id) => byId.get(id))
      .map((child) => (child === undefined ? "" : child.childIds?.length ? textOf(child) : (child.name?.value ?? "")))
      .join("");
  const isRegion = (node: AxNode) => node.properties?.some((property) => property.name === "live" && property.value.value !== "off");
  return nodes
    .filter((node) => !node.ignored && isRegion(node))
    .map((node) => ({ live: node.properties?.find((property) => property.name === "live")?.value.value, text: textOf(node) }));
}

test.describe("Announcer — toasts are spoken through the one region", () => {
  test("announces a toast inserted into the stack after load", async ({ page }) => {
    await mount(page, await layout(), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    const toast = await render(Toast({ children: "Draft saved" }));

    await page.evaluate((html) => document.querySelector("#toasts")?.insertAdjacentHTML("beforeend", html), toast);

    await expect(page.locator(POLITE)).toHaveText("Draft saved");
  });

  test("announces a toast the page was rendered with, as a flash after a redirect is", async ({ page }) => {
    await mount(page, await layout(Toast({ children: "Signed in" })), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await expect(page.locator(POLITE)).toHaveText("Signed in");
  });

  test("exposes exactly the announcer's two regions to assistive technology, holding the toast's text", async ({ page }) => {
    await mount(page, await layout(), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    const toast = await render(Toast({ children: "Draft saved" }));
    await page.evaluate((html) => document.querySelector("#toasts")?.insertAdjacentHTML("beforeend", html), toast);
    await expect(page.locator(POLITE)).toHaveText("Draft saved");

    expect(await liveRegions(page)).toEqual([
      { live: "polite", text: "Draft saved" },
      { live: "assertive", text: "" },
    ]);
  });
});

test.describe("Announcer — channels settling together", () => {
  test("keeps both messages as nodes of their own in the polite region, each exposed to assistive technology", async ({ page }) => {
    await mount(page, await layout(), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await page.evaluate(() => {
      window.forgeAnnounce.announce("Kernel ready", { channel: "kernel" });
      window.forgeAnnounce.announce("Draft saved", { channel: "status" });
    });

    await expect(page.locator(`${POLITE} > *`)).toHaveText(["Kernel ready", "Draft saved"]);
    const polite = (await liveRegions(page)).find((region) => region.live === "polite");
    expect(polite?.text).toContain("Kernel ready");
    expect(polite?.text).toContain("Draft saved");
  });
});

test.describe("Announcer — a failed full-page submission", () => {
  test("interrupts with the first field error the page was rendered with", async ({ page }) => {
    const form = jsx("form", {
      children: [
        jsx("p", { "data-slot": "field-error", children: "Enter an email address" }),
        jsx("p", { "data-slot": "field-error", children: "Choose a password" }),
      ],
    });
    await mount(page, await render(jsx("div", { children: [form, Announcer({})] })), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await expect(page.locator(ASSERTIVE)).toHaveText("Enter an email address");
  });
});
