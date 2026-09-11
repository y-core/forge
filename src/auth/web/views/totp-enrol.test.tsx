/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { authPaths } from "../paths";
import { accountRoutes } from "../routes";
import { attrOf, attrsOf, elementOf, tagOf, textOf } from "../test-support";
import { TotpEnrolView } from "./totp-enrol";
import type { TotpEnrolViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

const ACCOUNT = authPaths(accountRoutes("/account"));

const SECRET = "JBSWY3DPEHPK3PXP";

const URI = "otpauth://totp/Forge:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Forge";

const ENROLLED_AT = 1738368000000;

const ENROLLING = { status: "enrolling", secret: SECRET, uri: URI } as const;

const ENROLLED = { status: "enrolled", enrolledAt: ENROLLED_AT } as const;

function totp(props: Partial<TotpEnrolViewProps> = {}) {
  return render(
    <TotpEnrolView
      state={ENROLLING}
      enrolPath={ACCOUNT.totpEnrol()}
      removePath={ACCOUNT.totpRemove()}
      csrfToken='csrf-1'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("TotpEnrolView while enrolling", () => {
  it("shows the secret, since this is the only page that will ever carry it", async () => {
    expect(textOf(await totp(), "code", 'data-ref="totp-secret"')).toBe(SECRET);
  });

  it("shows the setup link beside it, escaping the query the URI carries", async () => {
    expect(textOf(await totp(), "code", 'data-ref="totp-uri"')).toBe(
      "otpauth://totp/Forge:ada@example.com?secret=JBSWY3DPEHPK3PXP&amp;issuer=Forge",
    );
  });

  it("says plainly that the secret is not shown again, because the visitor cannot recover it", async () => {
    expect(textOf(await totp(), "div", 'data-slot="card-description"')).toBe(
      "Store this secret in your app now. It is shown on this page only, and never again.",
    );
  });

  it("asks for the code the app now shows, six digits wide by default", async () => {
    expect(attrOf(await totp(), 'data-slot="otp-input"', "maxlength")).toBe("6");
    expect(textOf(await totp(), "p", 'data-slot="field-description"')).toBe("6 digits, refreshed by the app every 30 seconds.");
  });

  // The defect this closes: the width and the refresh interval were literals here, so a factor
  // configured for eight digits on a sixty-second step rendered a page that contradicted it.
  it("takes the width and the refresh interval from the factor, rather than restating forge's own", async () => {
    const html = await totp({ codeDigits: 8, codePeriodSeconds: 60 });
    expect(attrOf(html, 'data-slot="otp-input"', "maxlength")).toBe("8");
    expect(textOf(html, "p", 'data-slot="field-description"')).toBe("8 digits, refreshed by the app every 60 seconds.");
  });

  it("posts the confirmation to the enrol path read off the route map", async () => {
    expect(attrOf(await totp(), 'data-slot="form"', "action")).toBe("/account/totp");
  });

  it("carries the CSRF token in the header htmx sends and the field a plain post sends", async () => {
    const html = await totp();
    expect(attrOf(html, 'data-slot="form"', "hx-headers")).toBe("{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-1");
  });

  it("marks the field invalid and states its own copy, since the domain returns only a field name", async () => {
    const html = await totp({ fieldError: "That code did not match. Check your app and try the current one." });
    expect(textOf(html, "p", 'data-slot="field-error"')).toBe(
      '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>That code did not match. Check your app and try the current one.',
    );
  });

  it("keeps the secret on screen through a rejected code, so a retry needs no second enrolment", async () => {
    expect(textOf(await totp({ fieldError: "That code did not match." }), "code", 'data-ref="totp-secret"')).toBe(SECRET);
  });

  it("says nothing about an error until there is one", async () => {
    expect(tagOf(await totp(), 'data-slot="field-error"')).toBe("");
  });
});

// The point of the view: the secret exists on the enrolling page and nowhere else. A settled
// enrolment that still rendered it would leave it in every later page load, history entry and cache.
describe("TotpEnrolView once enrolled", () => {
  it("does not render the secret, on the page or anywhere in the document", async () => {
    const html = await totp({ state: ENROLLED });
    expect(tagOf(html, 'data-ref="totp-secret"')).toBe("");
    expect(html.includes(SECRET)).toBe(false);
  });

  it("does not render the setup link either, which carries the same secret in its query", async () => {
    const html = await totp({ state: ENROLLED });
    expect(tagOf(html, 'data-ref="totp-uri"')).toBe("");
    expect(html.includes("otpauth://")).toBe(false);
  });

  it("asks for no code, because there is nothing left to confirm", async () => {
    expect(tagOf(await totp({ state: ENROLLED }), 'data-slot="otp-input"')).toBe("");
  });

  it("dates the enrolment and marks it settled", async () => {
    const html = await totp({ state: ENROLLED });
    expect(textOf(html, "span", 'data-ref="totp-enrolled"')).toBe(
      'Confirmed <time datetime="2025-02-01T00:00:00.000Z" class="tabular-nums">2025-02-01</time>',
    );
    expect(textOf(html, "span", 'data-ref="totp-status"')).toBe("Enrolled");
  });

  it("offers removal as the one destructive action, on the path read off the route map", async () => {
    const html = await totp({ state: ENROLLED });
    expect(attrsOf(html, 'data-ref="totp-remove"')["data-slot"]).toBe("button");
    expect(attrOf(html, 'data-slot="form"', "hx-delete")).toBe("/account/totp");
  });
});

describe("TotpEnrolView paths", () => {
  it("follows the mount point, so no path in the markup is a literal", async () => {
    const settings = authPaths(accountRoutes("/settings"));
    expect(attrOf(await totp({ enrolPath: settings.totpEnrol() }), 'data-slot="form"', "action")).toBe("/settings/totp");
    expect(attrOf(await totp({ state: ENROLLED, removePath: settings.totpRemove() }), 'data-slot="form"', "hx-delete")).toBe("/settings/totp");
  });

  it("heads the two states differently, so a visitor can tell which one they are on", async () => {
    expect(elementOf(await totp(), "h1", 'class="text-xl"')).toBe('<h1 class="text-xl">Add an authenticator app</h1>');
    expect(elementOf(await totp({ state: ENROLLED }), "h1", 'class="text-xl"')).toBe('<h1 class="text-xl">Your authenticator app</h1>');
  });
});
