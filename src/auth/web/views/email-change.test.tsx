/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { attrOf, attrsOf, elementOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf, valuesOf } from "../web.fixture";
import { EmailChangeConfirmView, EmailChangeView } from "./email-change";
import type { EmailChangeConfirmViewProps, EmailChangeViewProps } from "./types";

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
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-email-error">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That address is already in use.</p>",
    );
  });
});

describe("EmailChangeView once the confirmation has gone out", () => {
  it("replaces the form with a titled success alert naming both addresses", async () => {
    const html = await emailChange({ sentTo: "grace@example.com" });
    expect(elementOf(html, "div", 'data-tone="success"')).toBe(
      '<div data-slot="alert" data-tone="success" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 ' +
        "text-sm [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] " +
        "[--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] " +
        "[--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) " +
        '[--focus-ring:var(--color-ring)]">' +
        '<svg data-slot="icon" class="size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-mail"></use></svg>' +
        '<div data-slot="alert-title" class="leading-none font-medium tracking-tight">Confirmation sent</div>' +
        '<div data-slot="alert-description" class="text-sm leading-relaxed text-pretty">Open the link we sent to ' +
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

function confirmPage(props: Partial<EmailChangeConfirmViewProps> = {}) {
  return render(
    <EmailChangeConfirmView
      stage='approve'
      address='grace@example.com'
      token='link-token-1'
      submitPath='/email/confirm'
      csrfToken='csrf-1'
      {...props}
    />,
  );
}

describe("EmailChangeConfirmView", () => {
  it("asks the account's own inbox to approve the move to the new address", async () => {
    const html = await confirmPage({ stage: "approve" });
    expect(textOf(html, "h1", 'class="text-xl"')).toBe("Approve the new email address");
    expect(textOf(html, "div", 'data-slot="card-description"')).toBe(
      "Someone signed in to your account asked to move it to grace@example.com. Approve only if that was you — we then send a link to " +
        "grace@example.com to finish.",
    );
    expect(textOf(html, "button", 'type="submit"')).toBe("Approve the change");
  });

  it("asks the new inbox to confirm the move, warning that every session signs out", async () => {
    const html = await confirmPage({ stage: "move" });
    expect(textOf(html, "h1", 'class="text-xl"')).toBe("Confirm your new email address");
    expect(textOf(html, "div", 'data-slot="card-description"')).toBe(
      "Confirm grace@example.com as the address you sign in with. Every session signs out once it changes.",
    );
    expect(textOf(html, "button", 'type="submit"')).toBe("Confirm the new address");
  });

  it("escapes the address at both stages", async () => {
    expect(textOf(await confirmPage({ stage: "approve", address: HOSTILE_TEXT }), "div", 'data-slot="card-description"')).toBe(
      `Someone signed in to your account asked to move it to ${HOSTILE_TEXT_ESCAPED}. Approve only if that was you — we then send a link ` +
        `to ${HOSTILE_TEXT_ESCAPED} to finish.`,
    );
    expect(textOf(await confirmPage({ stage: "move", address: HOSTILE_TEXT }), "div", 'data-slot="card-description"')).toBe(
      `Confirm ${HOSTILE_TEXT_ESCAPED} as the address you sign in with. Every session signs out once it changes.`,
    );
  });

  for (const stage of ["approve", "move"] as const) {
    it(`posts the ${stage} link's token and the CSRF token to the submit path, so opening the link changes nothing`, async () => {
      const html = await confirmPage({ stage });
      expect(tagOf(html, 'data-slot="form"')).toBe(
        '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}" class="flex flex-col gap-6" ' +
          'action="/email/confirm">',
      );
      expect(attrsOf(html, 'data-slot="form-csrf"')).toEqual({ "data-slot": "form-csrf", type: "hidden", name: "_csrf", value: "csrf-1" });
      expect(attrsOf(html, 'name="token"')).toEqual({ type: "hidden", name: "token", value: "link-token-1" });
      expect(valuesOf(html, "name")).toEqual(["_csrf", "token"]);
    });
  }

  it("escapes a hostile link token in the hidden field", async () => {
    expect(attrOf(await confirmPage({ token: HOSTILE_TEXT }), 'name="token"', "value")).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("sends the CSRF token under a renamed header", async () => {
    expect(attrOf(await confirmPage({ csrfHeader: "X-App-Csrf" }), 'data-slot="form"', "hx-headers")).toBe(
      "{&quot;X-App-Csrf&quot;:&quot;csrf-1&quot;}",
    );
  });

  it("appends the caller's class to the card and renders the heading at the level asked", async () => {
    const html = await confirmPage({ class: "mt-8", level: 2 });
    expect(attrOf(html, 'data-slot="card"', "class").split(" ").slice(-1)).toEqual(["mt-8"]);
    expect(textOf(html, "h2", 'class="text-xl"')).toBe("Approve the new email address");
    expect(textOf(html, "h1", 'class="text-xl"')).toBe("");
  });

  it("offers no link back to an account the visitor may not be signed in to", async () => {
    expect(valuesOf(await confirmPage(), "href")).toEqual([]);
  });
});
