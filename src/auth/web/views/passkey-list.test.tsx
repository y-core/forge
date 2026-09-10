/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import type { AuthCredential } from "../../types";
import { authPaths } from "../paths";
import { accountRoutes } from "../routes";
import { attrOf, attrsOf, elementOf, elementsOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf, valuesOf } from "../test-support";
import { PasskeyListView } from "./passkey-list";
import type { PasskeyListViewProps, PasskeyRow } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

const ACCOUNT = authPaths(accountRoutes("/account"));

const CREATED_AT = 1735689600000;
const USED_AT = 1738368000000;

const LOCKOUT_REASON = "It is your only passkey and no other factor is enrolled, so removing it leaves nothing to sign in with.";

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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function row(held: AuthCredential, csrfToken = "csrf-1"): PasskeyRow {
  return { credential: held, csrfToken };
}

function passkeys(props: Partial<PasskeyListViewProps> = {}) {
  return render(
    <PasskeyListView
      rows={[row(credential())]}
      fallbackFactors={["email-otp"]}
      paths={ACCOUNT}
      enrolPath='/auth/enrol/passkey'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("PasskeyListView", () => {
  it("names each credential, escaping whatever the visitor called it", async () => {
    const html = await passkeys({ rows: [row(credential({ label: HOSTILE_TEXT }))] });
    expect(elementOf(html, "span", 'data-ref="credential-label"')).toBe(
      `<span data-ref="credential-label" class="text-sm font-medium text-foreground">${HOSTILE_TEXT_ESCAPED}</span>`,
    );
  });

  it("renders the name enrolment stored, rather than the placeholder meant for a credential with none", async () => {
    const html = await passkeys({ rows: [row(credential({ label: "Work laptop" }))] });
    expect(textOf(html, "span", 'data-ref="credential-label"')).toBe("Work laptop");
  });

  it("falls back to a placeholder name for a credential the visitor never labelled", async () => {
    const html = await passkeys({ rows: [row(credential({ label: null }))] });
    expect(textOf(html, "span", 'data-ref="credential-label"')).toBe("Unnamed passkey");
  });

  it("dates the credential from its stored millisecond, machine-readable beside the text", async () => {
    const html = await passkeys();
    expect(elementOf(html, "time", 'datetime="2025-01-01T00:00:00.000Z"')).toBe(
      '<time datetime="2025-01-01T00:00:00.000Z" class="tabular-nums">2025-01-01</time>',
    );
  });

  it("says a credential was never used rather than dating it from nothing", async () => {
    expect(textOf(await passkeys(), "span", 'data-ref="credential-used"')).toBe("Never used");
  });

  it("dates the last use when there has been one", async () => {
    const html = await passkeys({ rows: [row(credential({ lastUsedAt: USED_AT }))] });
    expect(textOf(html, "span", 'data-ref="credential-used"')).toBe(
      'Last used <time datetime="2025-02-01T00:00:00.000Z" class="tabular-nums">2025-02-01</time>',
    );
  });

  it("renders one list item per credential", async () => {
    const html = await passkeys({ rows: [row(credential()), row(credential({ id: "c2", label: "Phone" }), "csrf-2")] });
    expect(elementsOf(html, "li", 'data-ref="credential"').length).toBe(2);
  });

  it("designs the empty state rather than rendering an empty list", async () => {
    const html = await passkeys({ rows: [] });
    expect(tagOf(html, 'data-ref="credential-list"')).toBe("");
    expect(textOf(html, "h2", 'data-slot="empty-state-title"')).toBe("No passkeys yet");
    expect(attrOf(html, 'data-ref="passkey-enrol-empty"', "href")).toBe("/auth/enrol/passkey");
  });
});

// The lock-out path, which is the point of this view: the domain lets a visitor remove their only
// credential, so the only place the consequence can be stated is before the click.
describe("PasskeyListView and the last-credential lock-out", () => {
  it("warns, in place and by name, when the only passkey is the only factor", async () => {
    const html = await passkeys({ fallbackFactors: [] });
    expect(attrsOf(html, 'data-ref="credential-lockout"')["data-tone"]).toBe("warning");
    expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("Removing this passkey locks you out");
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(LOCKOUT_REASON);
  });

  it("names the warning as the remove button's description, so the reason is announced with the control", async () => {
    const html = await passkeys({ fallbackFactors: [] });
    expect(attrOf(html, 'data-ref="credential-lockout"', "id")).toBe("passkey-lockout");
    expect(attrOf(html, 'data-ref="credential-remove"', "aria-describedby")).toBe("passkey-lockout");
  });

  it("leaves the remove control live, because the store still permits the delete", async () => {
    const html = await passkeys({ fallbackFactors: [] });
    expect(attrsOf(html, 'data-ref="credential-remove"')["disabled"]).toBe(undefined);
  });

  it("stays silent when another factor would still admit the visitor", async () => {
    const html = await passkeys({ fallbackFactors: ["totp-app"] });
    expect(tagOf(html, 'data-ref="credential-lockout"')).toBe("");
    expect(attrOf(html, 'data-ref="credential-remove"', "aria-describedby")).toBe("");
  });

  it("stays silent when a second credential would still admit the visitor", async () => {
    const html = await passkeys({ rows: [row(credential()), row(credential({ id: "c2" }), "csrf-2")], fallbackFactors: [] });
    expect(tagOf(html, 'data-ref="credential-lockout"')).toBe("");
  });
});

describe("PasskeyListView paths", () => {
  it("reads the rename and remove paths off the route map, credential id and all", async () => {
    const html = await passkeys();
    expect(attrOf(html, 'data-ref="credential-rename"', "href")).toBe("/account/passkeys/c1/edit");
    expect(attrOf(html, 'data-slot="form"', "hx-delete")).toBe("/account/passkeys/c1");
  });

  it("follows the mount point, so no path in the markup is a literal", async () => {
    const html = await passkeys({ paths: authPaths(accountRoutes("/settings")) });
    expect(attrOf(html, 'data-ref="credential-rename"', "href")).toBe("/settings/passkeys/c1/edit");
    expect(attrOf(html, 'data-slot="form"', "hx-delete")).toBe("/settings/passkeys/c1");
  });

  it("carries the CSRF token into the header htmx sends the delete on", async () => {
    expect(attrOf(await passkeys(), 'data-slot="form"', "hx-headers")).toBe("{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}");
  });
});

// A token is bound to one path, so a page-level token would 403 every row it was not minted for.
describe("PasskeyListView and the per-row token", () => {
  it("stamps each row's own token into that row's delete form", async () => {
    const html = await passkeys({ rows: [row(credential()), row(credential({ id: "c2" }), "csrf-2")] });
    expect(valuesOf(html, "hx-headers")).toEqual([
      "{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}",
      "{&quot;X-CSRF-Token&quot;:&quot;csrf-2&quot;}",
    ]);
  });

  // Pinned rather than assumed: `csrfProtection` keys on the pathname, so one token per row
  // authorises both writes only while the two routes stay on the one path.
  it("holds the rename and the remove to one pathname, which is what lets one token cover both", () => {
    expect(ACCOUNT.passkeyRename({ id: "c1" })).toBe(ACCOUNT.passkeyRemove({ id: "c1" }));
  });
});
