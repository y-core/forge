import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount, SECURE_ORIGIN } from "../../ui/client/browser-test-helper";
import {
  PASSKEY,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_OUTCOME_EVENT,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../passkey-contract";

declare global {
  interface Window {
    forgePasskey: typeof import("./passkey");
    /** Every `passkey:outcome` the scope root dispatched, as `mode` and `reason`. */
    passkeyOutcomes: Array<{ mode: string; reason?: string }>;
    /** Cleanup returned by the controller, parked so a later evaluate can call it. */
    passkeyCleanup?: () => void;
  }
}

const OPTIONS_PATH = "/auth/passkey/options";
const VERIFY_PATH = "/auth/passkey/verify";
const OPTIONS_TOKEN = "token-for-options";
const VERIFY_TOKEN = "token-for-verify";
const RP_ID = "forge.test";

/** base64url, in the page's own realm — the fixture routes answer with encoded buffers. */
const b64url = (bytes: number[]): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const FIXTURE = `<!doctype html><html><body>
  <div data-scope="${PASSKEY_SCOPE}"
       ${PASSKEY_MODE_ATTR}="registration"
       ${PASSKEY_OPTIONS_PATH_ATTR}="${OPTIONS_PATH}"
       ${PASSKEY_VERIFY_PATH_ATTR}="${VERIFY_PATH}"
       ${PASSKEY_OPTIONS_TOKEN_ATTR}="${OPTIONS_TOKEN}"
       ${PASSKEY_VERIFY_TOKEN_ATTR}="${VERIFY_TOKEN}"
       ${PASSKEY_REDIRECT_ATTR}="/account/passkeys">
    <button type="button" data-ref="${PASSKEY.trigger}">Add a passkey</button>
    <input data-ref="${PASSKEY.nickname}" value="Work laptop" />
    <p data-ref="${PASSKEY.status}"></p>
    <p data-ref="${PASSKEY.unsupported}" hidden>No passkeys here.</p>
  </div>
</body></html>`;

/** Attaches a CDP virtual authenticator, so `navigator.credentials` runs a real ceremony. */
async function addVirtualAuthenticator(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
}

/** Serves the two ceremony endpoints, recording each request so the spec can read the tokens back.
 *
 * Registered *after* `mount`, never before: playwright matches routes newest-first, so the origin
 * catch-all `mount` installs would otherwise answer both endpoints with the empty fixture page. */
async function routeCeremony(page: Page, options: { verifyStatus?: number } = {}): Promise<Array<{ url: string; token: string | null }>> {
  const seen: Array<{ url: string; token: string | null }> = [];

  await page.route(`**${OPTIONS_PATH}`, async (route) => {
    seen.push({ url: OPTIONS_PATH, token: route.request().headers()["x-csrf-token"] ?? null });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challenge: b64url([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        rp: { id: RP_ID, name: "Forge" },
        user: { id: b64url([20, 21, 22, 23]), name: "a@forge.test", displayName: "A" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 60_000,
        attestation: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      }),
    });
  });

  await page.route(`**${VERIFY_PATH}`, async (route) => {
    seen.push({ url: VERIFY_PATH, token: route.request().headers()["x-csrf-token"] ?? null });
    await route.fulfill({ status: options.verifyStatus ?? 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  return seen;
}

/** Mounts the fixture with the controller exposed and the outcome recorder installed. */
async function mountCeremony(page: Page): Promise<void> {
  await mount(page, FIXTURE, { expose: { forgePasskey: "./auth/client/passkey" }, origin: SECURE_ORIGIN });
  await page.evaluate((eventName) => {
    window.passkeyOutcomes = [];
    const root = document.querySelector<HTMLElement>("[data-scope]");
    if (!root) throw new Error("no scope root in the fixture");
    root.addEventListener(eventName, (event) => {
      window.passkeyOutcomes.push((event as CustomEvent<{ mode: string; reason?: string }>).detail);
    });
    window.passkeyCleanup = window.forgePasskey.mountPasskey(root);
  }, PASSKEY_OUTCOME_EVENT);
}

const outcomes = (page: Page) => page.evaluate(() => window.passkeyOutcomes);

test.describe("passkey controller — a real ceremony against a virtual authenticator", () => {
  test("registers a credential, sends each endpoint its own token, and redirects", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await mountCeremony(page);
    const seen = await routeCeremony(page);

    await page.click(`[data-ref='${PASSKEY.trigger}']`);

    // The navigation *is* the success signal, and it tears the page down — so it is what this test
    // waits on. The success outcome event fires just before it, and is asserted under `bun test`
    // where no navigation can race it.
    await page.waitForURL("**/account/passkeys");
    expect(seen).toEqual([
      { url: OPTIONS_PATH, token: OPTIONS_TOKEN },
      { url: VERIFY_PATH, token: VERIFY_TOKEN },
    ]);
  });

  test("reports a refused verification as its own outcome and does not navigate", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await mountCeremony(page);
    await routeCeremony(page, { verifyStatus: 403 });
    const before = page.url();

    await page.click(`[data-ref='${PASSKEY.trigger}']`);

    await expect.poll(() => outcomes(page)).toEqual([{ mode: "registration", reason: "verification-failed" }]);
    expect(page.url()).toBe(before);
    await expect(page.locator(`[data-ref='${PASSKEY.status}']`)).not.toBeEmpty();
  });

  test("reveals the unsupported message before any press when the realm has no WebAuthn", async ({ page }) => {
    // No virtual authenticator, and `PublicKeyCredential` deleted before the controller mounts:
    // the realm a browser without WebAuthn presents.
    await mount(page, FIXTURE, { expose: { forgePasskey: "./auth/client/passkey" }, origin: SECURE_ORIGIN });
    await page.evaluate((eventName) => {
      Reflect.deleteProperty(window, "PublicKeyCredential");
      window.passkeyOutcomes = [];
      const root = document.querySelector<HTMLElement>("[data-scope]");
      if (!root) throw new Error("no scope root in the fixture");
      root.addEventListener(eventName, (event) => {
        window.passkeyOutcomes.push((event as CustomEvent<{ mode: string; reason?: string }>).detail);
      });
      window.passkeyCleanup = window.forgePasskey.mountPasskey(root);
    }, PASSKEY_OUTCOME_EVENT);

    await expect(page.locator(`[data-ref='${PASSKEY.unsupported}']`)).toBeVisible();
    await expect(page.locator(`[data-ref='${PASSKEY.trigger}']`)).toBeDisabled();
    expect(await outcomes(page)).toEqual([{ mode: "registration", reason: "unsupported" }]);
  });

  test("the disposer leaves a root no press can drive", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await mountCeremony(page);
    const seen = await routeCeremony(page);

    await page.evaluate(() => window.passkeyCleanup?.());
    await page.click(`[data-ref='${PASSKEY.trigger}']`);
    await page.waitForTimeout(250);

    expect(seen).toEqual([]);
    expect(await outcomes(page)).toEqual([]);
  });
});
