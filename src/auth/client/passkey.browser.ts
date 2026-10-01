import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, SECURE_ORIGIN } from "../../ui/client/browser.fixture";
import { ANNOUNCER_REGION_SLOTS } from "../../ui/contracts/announcer-contract";
import { Announcer } from "../../ui/core/announcer";
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
import { addVirtualAuthenticator } from "./authenticator.fixture";

declare global {
  interface Window {
    forgePasskey: typeof import("./passkey");
    /** Every `passkey:outcome` the scope root dispatched, as `mode` and `reason`. */
    passkeyOutcomes: Array<{ mode: string; reason?: string }>;
    /** Cleanup returned by the controller, parked so a later evaluate can call it. */
    passkeyCleanup?: () => void;
    /** Hands each PRF result the page received to the spec, since in-page state dies at the navigation. */
    recordPrf: (result: RecordedPrf) => Promise<void>;
  }
}

interface RecordedPrf {
  mode: string;
  credentialId: string;
  output: number[] | null;
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

/** The ceremony root beside the page's real `<Announcer />`. */
const fixture = async (mode = "registration"): Promise<string> => `<!doctype html><html><body>
  ${await render(Announcer({}))}
  <div data-scope="${PASSKEY_SCOPE}"
       ${PASSKEY_MODE_ATTR}="${mode}"
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

const hex = (bytes: number[]): string => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Enrols a discoverable credential for `RP_ID` directly, so a spec can start at the assertion. */
async function addDiscoverableCredential(page: Page): Promise<void> {
  const { session, authenticatorId } = await addVirtualAuthenticator(page);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  await session.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: btoa("step-up-credential"),
      isResidentCredential: true,
      rpId: RP_ID,
      privateKey: btoa(String.fromCharCode(...pkcs8)),
      userHandle: btoa("user-1"),
      signCount: 0,
    },
  });
}

// Registered *after* `mount`: playwright matches routes newest-first, so the origin catch-all
// `mount` installs would otherwise answer both endpoints with the empty fixture page.
/** Serves the two ceremony endpoints, recording each request so the spec can read the tokens back. */
async function routeCeremony(
  page: Page,
  options: {
    verifyStatus?: number;
    mode?: "registration" | "authentication";
    extensions?: Record<string, unknown>;
    allowCredentials?: Array<{ type: "public-key"; id: string }>;
  } = {},
): Promise<Array<{ url: string; token: string | null }>> {
  const seen: Array<{ url: string; token: string | null }> = [];

  await page.route(`**${OPTIONS_PATH}`, async (route) => {
    seen.push({ url: OPTIONS_PATH, token: route.request().headers()["x-csrf-token"] ?? null });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.mode === "authentication"
          ? {
              challenge: b64url([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
              rpId: RP_ID,
              timeout: 60_000,
              userVerification: "required",
              ...(options.allowCredentials ? { allowCredentials: options.allowCredentials } : {}),
              ...(options.extensions ? { extensions: options.extensions } : {}),
            }
          : {
              challenge: b64url([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
              rp: { id: RP_ID, name: "Forge" },
              user: { id: b64url([20, 21, 22, 23]), name: "a@forge.test", displayName: "A" },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
              timeout: 60_000,
              attestation: "none",
              authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
              ...(options.extensions ? { extensions: options.extensions } : {}),
            },
      ),
    });
  });

  await page.route(`**${VERIFY_PATH}`, async (route) => {
    seen.push({ url: VERIFY_PATH, token: route.request().headers()["x-csrf-token"] ?? null });
    await route.fulfill({ status: options.verifyStatus ?? 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  return seen;
}

/** Mounts the fixture with the controller exposed and the outcome recorder installed. */
async function mountCeremony(page: Page, mode = "registration"): Promise<void> {
  await mount(page, await fixture(mode), { expose: { forgePasskey: "./auth/client/passkey" }, origin: SECURE_ORIGIN });
  await page.evaluate(
    ({ eventName, scope }) => {
      window.passkeyOutcomes = [];
      const root = document.querySelector<HTMLElement>(`[data-scope='${scope}']`);
      if (!root) throw new Error("no scope root in the fixture");
      root.addEventListener(eventName, (event) => {
        window.passkeyOutcomes.push((event as CustomEvent<{ mode: string; reason?: string }>).detail);
      });
      window.passkeyCleanup = window.forgePasskey.mountPasskey(root);
    },
    { eventName: PASSKEY_OUTCOME_EVENT, scope: PASSKEY_SCOPE },
  );
}

const outcomes = (page: Page) => page.evaluate(() => window.passkeyOutcomes);

/** Registers a PRF handler in the page that forwards every result to the returned list. */
async function recordPrf(page: Page): Promise<RecordedPrf[]> {
  const recorded: RecordedPrf[] = [];
  await page.exposeFunction("recordPrf", (result: RecordedPrf) => {
    recorded.push(result);
  });
  await page.evaluate(() => {
    window.forgePasskey.onPasskeyPrf(({ mode, credentialId, output }) =>
      window.recordPrf({ mode, credentialId, output: output && Array.from(output) }),
    );
  });
  return recorded;
}

/** Answers the verify endpoint, keeping each raw body posted to it. */
async function recordVerifyBodies(page: Page): Promise<string[]> {
  const posted: string[] = [];
  await page.route(`**${VERIFY_PATH}`, async (route) => {
    posted.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  return posted;
}

const SALT_A = [0x61, 1, 2, 3, 4, 5, 6, 7];
const SALT_B = [0x62, 1, 2, 3, 4, 5, 6, 7];

test.describe("passkey controller — a real ceremony against a virtual authenticator", () => {
  test("registers a credential, sends each endpoint its own token, and redirects", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await mountCeremony(page);
    const seen = await routeCeremony(page);

    await page.click(`[data-ref='${PASSKEY.trigger}']`);

    // The navigation *is* the success signal and it tears the page down, so it is what this test
    // waits on; the outcome event that fires just before it is asserted under `bun test` instead.
    await page.waitForURL("**/account/passkeys");
    expect(seen).toEqual([
      { url: OPTIONS_PATH, token: OPTIONS_TOKEN },
      { url: VERIFY_PATH, token: VERIFY_TOKEN },
    ]);
  });

  for (const mode of ["registration", "authentication"] as const) {
    test(`posts no PRF or largeBlob output from the ${mode} ceremony, even when the authenticator returns some`, async ({ page }) => {
      if (mode === "authentication") await addDiscoverableCredential(page);
      else await addVirtualAuthenticator(page);
      await mountCeremony(page, mode);
      await routeCeremony(page, { mode });
      const posted: string[] = [];
      await page.route(`**${VERIFY_PATH}`, async (route) => {
        posted.push(route.request().postData() ?? "");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      const secret = Array.from({ length: 32 }, () => 0xab);
      await page.evaluate((bytes) => {
        const output = new Uint8Array(bytes).buffer;
        PublicKeyCredential.prototype.getClientExtensionResults = () =>
          ({ prf: { enabled: true, results: { first: output } }, largeBlob: { blob: output } }) as AuthenticationExtensionsClientOutputs;
      }, secret);

      await page.click(`[data-ref='${PASSKEY.trigger}']`);

      await page.waitForURL("**/account/passkeys");
      expect(posted).toHaveLength(1);
      const body = posted[0] ?? "";
      expect(body).not.toContain("prf");
      expect(body).not.toContain("largeBlob");
      expect(body).not.toContain("clientExtensionResults");
      expect(body).not.toContain(b64url(secret).slice(0, 16));
      expect(JSON.parse(body).credential.response).toHaveProperty(mode === "authentication" ? "signature" : "attestationObject");
    });
  }

  test("hands the page the 32-byte PRF output of a registration, and posts none of it", async ({ page }) => {
    await addVirtualAuthenticator(page, { prf: true });
    await mountCeremony(page);
    await routeCeremony(page, { extensions: { prf: { eval: { first: b64url(SALT_A) } } } });
    const posted = await recordVerifyBodies(page);
    const recorded = await recordPrf(page);

    await page.click(`[data-ref='${PASSKEY.trigger}']`);

    await page.waitForURL("**/account/passkeys");
    const body = posted[0] ?? "";
    const output = recorded[0]?.output ?? [];
    expect(recorded.map((r) => ({ mode: r.mode, credentialId: r.credentialId, bytes: r.output?.length }))).toEqual([
      { mode: "registration", credentialId: JSON.parse(body).credential.id, bytes: 32 },
    ]);
    expect(body).not.toContain("prf");
    expect(body).not.toContain(b64url(output));
    expect(body).not.toContain(hex(output));
  });

  test("hands the page a step-up's PRF output, the same bytes the credential's creation gave for that salt", async ({ page }) => {
    await addVirtualAuthenticator(page, { prf: true });
    await mountCeremony(page, "authentication");
    const enrolled = await page.evaluate(
      async ({ rpId, saltA, saltB }) => {
        const encode = (buffer: ArrayBuffer): string =>
          btoa(String.fromCharCode(...new Uint8Array(buffer)))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", "");
        const prfBytes = (credential: PublicKeyCredential): number[] | null => {
          const first = credential.getClientExtensionResults().prf?.results?.first;
          return first === undefined ? null : Array.from(new Uint8Array(first as ArrayBuffer));
        };
        const created = (await navigator.credentials.create({
          publicKey: {
            challenge: new Uint8Array(16),
            rp: { id: rpId, name: "Forge" },
            user: { id: new Uint8Array([1, 2, 3, 4]), name: "a@forge.test", displayName: "A" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { residentKey: "required", userVerification: "required" },
            extensions: { prf: { eval: { first: new Uint8Array(saltA) } } },
          },
        })) as PublicKeyCredential;
        const other = (await navigator.credentials.get({
          publicKey: {
            challenge: new Uint8Array(16),
            rpId,
            allowCredentials: [{ type: "public-key", id: created.rawId }],
            userVerification: "required",
            extensions: { prf: { eval: { first: new Uint8Array(saltB) } } },
          },
        })) as PublicKeyCredential;
        return { id: encode(created.rawId), atCreation: prfBytes(created), otherSalt: prfBytes(other) };
      },
      { rpId: RP_ID, saltA: SALT_A, saltB: SALT_B },
    );
    expect(enrolled.atCreation?.length).toBe(32);
    await routeCeremony(page, {
      mode: "authentication",
      allowCredentials: [{ type: "public-key", id: enrolled.id }],
      extensions: { prf: { evalByCredential: { [enrolled.id]: { first: b64url(SALT_A) } } } },
    });
    const posted = await recordVerifyBodies(page);
    const recorded = await recordPrf(page);

    await page.click(`[data-ref='${PASSKEY.trigger}']`);

    await page.waitForURL("**/account/passkeys");
    expect(recorded).toEqual([{ mode: "authentication", credentialId: enrolled.id, output: enrolled.atCreation }]);
    expect(recorded[0]?.output).not.toEqual(enrolled.otherSalt);
    const body = posted[0] ?? "";
    const output = recorded[0]?.output ?? [];
    expect(body).not.toContain("prf");
    expect(body).not.toContain(b64url(output));
    expect(body).not.toContain(hex(output));
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
    await expect(page.locator(`[data-slot='${ANNOUNCER_REGION_SLOTS.assertive}']`)).toHaveText("That passkey wasn't accepted. Please try again.");
  });

  test("reveals the unsupported message before any press when the realm has no WebAuthn", async ({ page }) => {
    // No virtual authenticator, and `PublicKeyCredential` deleted before the controller mounts:
    // the realm a browser without WebAuthn presents.
    await mount(page, await fixture(), { expose: { forgePasskey: "./auth/client/passkey" }, origin: SECURE_ORIGIN });
    await page.evaluate(
      ({ eventName, scope }) => {
        Reflect.deleteProperty(window, "PublicKeyCredential");
        window.passkeyOutcomes = [];
        const root = document.querySelector<HTMLElement>(`[data-scope='${scope}']`);
        if (!root) throw new Error("no scope root in the fixture");
        root.addEventListener(eventName, (event) => {
          window.passkeyOutcomes.push((event as CustomEvent<{ mode: string; reason?: string }>).detail);
        });
        window.passkeyCleanup = window.forgePasskey.mountPasskey(root);
      },
      { eventName: PASSKEY_OUTCOME_EVENT, scope: PASSKEY_SCOPE },
    );

    await expect(page.locator(`[data-ref='${PASSKEY.unsupported}']`)).toBeVisible();
    await expect(page.locator(`[data-ref='${PASSKEY.trigger}']`)).toBeDisabled();
    expect(await outcomes(page)).toEqual([{ mode: "registration", reason: "unsupported" }]);
    await expect(page.locator(`[data-slot='${ANNOUNCER_REGION_SLOTS.assertive}']`)).toHaveText(
      "This browser cannot use passkeys. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
    );
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
