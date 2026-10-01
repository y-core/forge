import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import { totpCodes } from "../testing/totp";
import { startDevServer } from "../testing/workerd";
import type { DevServer } from "../testing/workerd";
import { bundleModules } from "../ui/client/browser.fixture";
import { addVirtualAuthenticator } from "./client/authenticator.fixture";
import { JOURNEY_NOTICE, JOURNEY_RESET, JOURNEY_SCRIPT } from "./journey.fixture";

/** Sign-up, TOTP enrolment and step-up, a passkey added from the account pages, sign-out, and a passkey step-up on sign-in, against the real mount under workerd. */

const CONFIG = new URL("../../tests/fixtures/auth-web/wrangler.jsonc", import.meta.url).pathname;

const secret = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// `localhost` rather than the loopback address wrangler binds: WebAuthn refuses an IP address as an RP ID.
const test = base.extend<object, { server: DevServer }>({
  server: [
    // oxlint-disable-next-line no-empty-pattern -- playwright reads a fixture's dependencies off this pattern, and this one has none
    async ({}, use) => {
      const server = await startDevServer({
        config: CONFIG,
        capture: true,
        readyPath: "/auth/signin",
        vars: { AUTH_KEY_RING: secret(), SESSION_SECRET: secret(), CSRF_SECRET: secret() },
      });
      try {
        const reset = await fetch(`${server.origin}${JOURNEY_RESET}`, { method: "POST" });
        if (!reset.ok) throw new Error(`journey: schema reset answered ${reset.status}`);
        await use(server);
      } finally {
        server.stop();
      }
    },
    { scope: "worker", timeout: 200_000 },
  ],
  baseURL: async ({ server }, use) => use(server.origin.replace("127.0.0.1", "localhost")),
  page: async ({ page }, use) => {
    const bundle = await bundleModules({ forgeAuthClient: "./auth/client/mod.ts", forgeResume: "./ui/client/resume.ts" });
    await page.route(`**${JOURNEY_SCRIPT}`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: `${bundle}\nwindow.forgeResume.resume();` }),
    );
    await use(page);
  },
});

/** The `nth` one-time code the fixture's notifier printed for `email`, polled until it appears. */
async function emailedCode(server: DevServer, email: string, nth: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const codes = server
      .logs()
      .split("\n")
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

test("signs up with an authenticator app, adds a passkey, signs out, and signs back in with the passkey", async ({ page, server }) => {
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
  await confirmCode(page, "Verification code", await emailedCode(server, email, 1));
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
  await confirmCode(page, "Verification code", await emailedCode(server, email, 2));
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
