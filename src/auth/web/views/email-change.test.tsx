/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon, type ForgeIcon } from "../../../ui/core/icon";
import { attrOf, attrsOf, elementOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf, valuesOf } from "../test-support";
import { EmailChangeView, type EmailChangeViewProps } from "./email-change";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "mail">;

function emailChange(props: Partial<EmailChangeViewProps> = {}) {
  return render(
    <EmailChangeView
      currentEmail='ada@example.com'
      submitPath='/account/email-change'
      accountPath='/account/passkeys'
      csrfToken='csrf-1'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("EmailChangeView", () => {
  it("names the address in force so the visitor can see what they are replacing, escaped", async () => {
    expect(textOf(await emailChange({ currentEmail: HOSTILE_TEXT }), "div", 'data-slot="card-description"')).toBe(
      `You sign in with ${HOSTILE_TEXT_ESCAPED} today. The change takes effect once you confirm the new address.`,
    );
  });

  it("posts one new-address field with the CSRF token merged into `hx-headers`", async () => {
    const html = await emailChange();
    expect(tagOf(html, 'data-slot="form"')).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}" class="flex flex-col gap-6" ' +
        'action="/account/email-change">',
    );
    expect(valuesOf(html, "name")).toEqual(["_csrf", "email"]);
  });

  it("keeps the address the visitor typed, escaped, across a refusal", async () => {
    const html = await emailChange({ email: HOSTILE_TEXT, fieldError: "That address is already in use." });
    expect(attrOf(html, 'id="field-email"', "value")).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("carries the invalid triple on a refused address", async () => {
    const html = await emailChange({ fieldError: "That address is already in use." });
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe("");
    expect(attrOf(html, 'id="field-email"', "aria-invalid")).toBe("true");
    expect(elementOf(html, "p", 'id="field-email-error"')).toBe(
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-email-error" role="alert">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That address is already in use.</p>",
    );
  });
});

// The success state is its own state, not the absence of an error: the form is gone, because
// re-submitting it would send a second confirmation to the same address.
describe("EmailChangeView once the confirmation has gone out", () => {
  it("replaces the form with a titled success alert naming both addresses", async () => {
    const html = await emailChange({ sentTo: "grace@example.com" });
    expect(elementOf(html, "div", 'data-tone="success"')).toBe(
      '<div data-slot="alert" data-tone="success" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 ' +
        "text-sm [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] " +
        "[--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] " +
        "[--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) " +
        '[--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]">' +
        '<svg data-slot="icon" class="size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-mail"></use></svg>' +
        '<div data-slot="alert-title" class="leading-none font-medium tracking-tight">Confirmation sent</div>' +
        '<div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">Open the link we sent to ' +
        "grace@example.com. Until then you keep signing in with ada@example.com.</div></div>",
    );
  });

  it("renders no form at all in that state, so the change cannot be requested twice by reload", async () => {
    const html = await emailChange({ sentTo: "grace@example.com" });
    expect(tagOf(html, 'data-slot="form"')).toBe("");
    expect(valuesOf(html, "name")).toEqual([]);
  });

  it("keeps the way back to the account either way", async () => {
    expect(attrOf(await emailChange(), 'data-slot="link"', "href")).toBe("/account/passkeys");
    expect(attrOf(await emailChange({ sentTo: "grace@example.com" }), 'data-slot="link"', "href")).toBe("/account/passkeys");
  });
});
