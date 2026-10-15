import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { harnessTest } from "../../tests/workerd/harness.fixture";
import type { ServedWorker } from "../testing/harness";
import { totpCodes } from "../testing/totp";
import { bundleModules } from "../ui/client/browser.fixture";
import { addVirtualAuthenticator } from "./client/authenticator.fixture";
import { JOURNEY_NOTICE, JOURNEY_RESET, JOURNEY_SCRIPT } from "./journey.fixture";

/** Sign-up, TOTP enrolment and step-up, a passkey added from the account pages, sign-out, and a passkey step-up on sign-in, against the real mount under workerd. */

const CONFIG = new URL("../../tests/fixtures/auth-web/wrangler.jsonc", import.meta.url).pathname;

const secret = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// `localhost` rather than the loopback address the harness binds: WebAuthn refuses an IP address as an RP ID.
const test = harnessTest({
  config: CONFIG,
  siteHost: "localhost",
  secrets: { AUTH_KEY_RING: secret(), SESSION_SECRET: secret(), CSRF_SECRET: secret() },
}).extend<object, { schema: undefined }>({
  schema: [
    async ({ served }, use) => {
      const reset = await fetch(`${served.origin}${JOURNEY_RESET}`, { method: "POST" });
      if (!reset.ok) throw new Error(`journey: schema reset answered ${reset.status}`);
      await use(undefined);
    },
    { scope: "worker", auto: true },
  ],
  baseURL: async ({ served }, use) => use(served.origin),
  page: async ({ page }, use) => {
    const bundle = await bundleModules({ forgeAuthClient: "./auth/client/mod.ts", forgeResume: "./ui/client/resume.ts" });
    await page.route(`**${JOURNEY_SCRIPT}`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: `${bundle}\nwindow.forgeResume.resume();` }),
    );
    await use(page);
  },
});

/** The `nth` one-time code the fixture's notifier printed for `email`, polled until it appears. */
async function emailedCode(served: ServedWorker, email: string, nth: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const codes = served.harness
      .getLogs()
      .map((log) => log.message)
      .filter((line) => line.startsWith(JOURNEY_NOTICE))
      .map((line) => JSON.parse(line.slice(JOURNEY_NOTICE.length)) as { kind: string; to: string; code?: string })
      .filter((notice) => notice.kind === "otp" && notice.to === email)
      .flatMap((notice) => (notice.code === undefined ? [] : [notice.code]));
    const code = codes[nth - 1];
    if (code !== undefined) return code;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no code #${nth} was printed for ${email}`);
}

async function confirmCode(page: Page, label: string, code: string): Promise<void> {
  await page.getByLabel(label).fill(code);
  await page.getByRole("button", { name: "Confirm" }).click();
}

test("signs up with an authenticator app, adds a passkey, signs out, and signs back in with the passkey", async ({ page, served }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { session, authenticatorId } = await addVirtualAuthenticator(page);
  const email = `journey-${Date.now()}@example.com`;
  const signout = page.locator("[data-ref='signout']");

  await page.goto("/auth/signup");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await confirmCode(page, "Verification code", await emailedCode(served, email, 1));
  await expect(page).toHaveURL(/\/auth\/enrol\/totp$/);

  // Enrolling on the previous step's code, inside the server's one-step drift window, leaves the current step unspent for the step-up.
  const totp = await totpCodes((await page.locator("[data-ref='totp-uri']").textContent())?.trim() ?? "", Date.now());
  await confirmCode(page, "Code from your app", totp.previous);
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await confirmCode(page, "Verification code", totp.current);
  await expect(page).not.toHaveURL(/\/auth\//);
  await expect(signout).toHaveCount(1);

  await page.goto("/account/passkeys");
  await page.locator("[data-ref='passkey-enrol']").click();
  await expect(page).toHaveURL(/\/account\/passkeys\/new$/);
  await page.getByLabel("Name this passkey").fill("virtual");
  await page.getByRole("button", { name: "Create a passkey" }).click();
  await expect(page).toHaveURL(/\/account\/recovery-codes$/);
  const [enrolled] = (await session.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
  expect(enrolled).toBeDefined();

  await signout.click();
  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(signout).toHaveCount(0);

  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await confirmCode(page, "Verification code", await emailedCode(served, email, 2));
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await page.getByRole("link", { name: "Use a passkey instead" }).click();
  await expect(page).toHaveURL(/\/auth\/verify\?factor=passkey$/);
  await page.getByRole("button", { name: "Confirm with a passkey" }).click();
  await expect(page).not.toHaveURL(/\/auth\//);
  await expect(signout).toHaveCount(1);

  const after = (await session.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
  expect(after.map((credential) => credential.credentialId)).toEqual([enrolled?.credentialId]);
  expect(after[0]?.signCount ?? 0).toBeGreaterThan(enrolled?.signCount ?? 0);
  expect(errors).toEqual([]);
});
