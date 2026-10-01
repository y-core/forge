import type { CDPSession, Page } from "@playwright/test";

/** Attaches a CDP virtual authenticator, so `navigator.credentials` runs a real ceremony. @internal */
export async function addVirtualAuthenticator(
  page: Page,
  options: { prf?: boolean } = {},
): Promise<{ session: CDPSession; authenticatorId: string }> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      ...(options.prf ? { hasPrf: true } : {}),
    },
  });
  return { session, authenticatorId };
}
