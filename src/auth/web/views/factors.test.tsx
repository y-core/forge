/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import type { AuthCredential } from "../../types";
import { authPaths } from "../paths";
import { accountRoutes } from "../routes";
import { attrOf, elementOf, elementsOf } from "../test-support";
import { AuthFactorsTrigger, AuthFactorsView } from "./factors";
import type { AuthFactorRow, AuthFactorsViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"key">;

const ACCOUNT = authPaths(accountRoutes("/account"));

const CONFIRMED_AT = 1735689600000;

/** The text one element carries, with the markup inside it taken out. */
function words(element: string): string {
  return element.replace(/<[^>]*>/g, "");
}

/** The `href` each element in `elements` points at. */
function hrefs(elements: readonly string[]): string[] {
  return elements.map((element) => /href="([^"]*)"/.exec(element)?.[1] ?? "");
}

function credential(overrides: Partial<AuthCredential> = {}): AuthCredential {
  return {
    id: "c1",
    userId: "u1",
    credentialId: "cid-1",
    publicKey: new Uint8Array(0) as Uint8Array<ArrayBuffer>,
    algorithm: -7,
    signCount: 0,
    transports: [],
    backupEligible: false,
    backedUp: false,
    label: "Work laptop",
    lastUsedAt: null,
    createdAt: CONFIRMED_AT,
    updatedAt: CONFIRMED_AT,
    ...overrides,
  };
}

const OFFERED: readonly AuthFactorRow[] = [
  { kind: "email-otp", state: "always", at: null },
  { kind: "passkey", state: "enrolled", at: CONFIRMED_AT },
  { kind: "totp-app", state: "none", at: null },
];

function panel(props: Partial<AuthFactorsViewProps> = {}) {
  return render(<AuthFactorsView factors={OFFERED} passkeys={[credential()]} icon={AppIcon} {...props} />);
}

describe("AuthFactorsView", () => {
  it("names every offered factor and the state it is in", async () => {
    const html = await panel();
    expect(elementsOf(html, "span", 'data-ref="factor-name"').map(words)).toEqual(["Emailed code", "Passkey", "Authenticator app"]);
    expect(elementsOf(html, "span", 'data-ref="factor-state"').map(words)).toEqual(["Always available", "Enrolled", "Not enrolled"]);
  });

  it("dates an enrolment it has a date for, and dates nothing it does not", async () => {
    expect(elementsOf(await panel(), "span", 'data-ref="factor-at"').map(words)).toEqual(["Enrolled 2025-01-01"]);
  });

  it("says when an enrolment was only started", async () => {
    const html = await panel({ factors: [{ kind: "totp-app", state: "pending", at: CONFIRMED_AT }] });
    expect(elementsOf(html, "span", 'data-ref="factor-state"').map(words)).toEqual(["Unconfirmed"]);
    expect(elementsOf(html, "span", 'data-ref="factor-at"').map(words)).toEqual(["Started 2025-01-01"]);
  });

  it("offers a management link for each factor with a page, once a holder's paths are given", async () => {
    const html = await panel({ manage: ACCOUNT });
    expect(hrefs(elementsOf(html, "a", 'data-ref="factor-manage"'))).toEqual(["/account/passkeys", "/account/totp"]);
  });

  it("offers no management link at all when no holder's paths are given", async () => {
    expect(elementsOf(await panel(), "a", 'data-ref="factor-manage"')).toEqual([]);
  });

  it("lists each registered passkey by the name it carries", async () => {
    const html = await panel({ passkeys: [credential(), credential({ id: "c2", label: null })] });
    expect(elementsOf(html, "span", 'data-ref="passkey-label"').map(words)).toEqual(["Work laptop", "Unnamed passkey"]);
  });

  it("says so where no passkey is registered, rather than rendering an empty list", async () => {
    const html = await panel({ passkeys: [] });
    expect(elementsOf(html, "ul", 'data-ref="passkey-list"')).toEqual([]);
    expect(elementsOf(html, "p", 'data-ref="passkey-none"').length).toBe(1);
  });

  it("designs the empty state for a deployment offering no factor at all", async () => {
    const html = await panel({ factors: [] });
    expect(elementsOf(html, "ul", 'data-ref="factor-list"')).toEqual([]);
    expect(elementsOf(html, "h3", 'data-slot="empty-state-title"').map(words)).toEqual(["No sign-in methods offered"]);
  });

  it("takes its heading level from the host, and puts the empty state's one below it", async () => {
    const html = await panel({ factors: [], level: 3 });
    expect(elementsOf(html, "h3", 'class="text-sm font-medium text-foreground"').length).toBe(2);
    expect(elementsOf(html, "h4", 'data-slot="empty-state-title"').map(words)).toEqual(["No sign-in methods offered"]);
  });
});

describe("AuthFactorsTrigger", () => {
  it("fetches the panel and replaces itself with it", async () => {
    const html = await render(<AuthFactorsTrigger loadPath='/account/factors' />);
    expect(attrOf(html, 'data-ref="factors-trigger"', "hx-get")).toBe("/account/factors");
    expect(attrOf(html, 'data-ref="factors-trigger"', "hx-swap")).toBe("outerHTML");
    expect(words(elementOf(html, "a", 'data-ref="factors-trigger"'))).toBe("Show sign-in methods");
  });

  it("takes the host's own wording for the panel it opens", async () => {
    const html = await render(<AuthFactorsTrigger loadPath='/admin/users/u1/factors' label='Show their sign-in methods' />);
    expect(words(elementOf(html, "a", 'data-ref="factors-trigger"'))).toBe("Show their sign-in methods");
  });
});
