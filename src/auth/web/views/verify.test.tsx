/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { PASSKEY, PASSKEY_MODE_ATTR, PASSKEY_SCOPE } from "../../passkey-contract";
import type { AuthFactorKind } from "../../types";
import {
  attrOf,
  attrsOf,
  authFactorGrid,
  elementOf,
  elementsOf,
  factorDemand,
  HOSTILE_TEXT,
  HOSTILE_TEXT_ESCAPED,
  tagOf,
  textOf,
  valuesOf,
} from "../test-support";
import type { AuthPasskeyContract } from "./types";
import type { VerifyViewProps } from "./types";
import { VerifyView } from "./verify";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "key" | "mail">;

const PASSKEY_CONTRACT: AuthPasskeyContract = {
  mode: "authentication",
  optionsPath: "/auth/passkey/authenticate/begin",
  verifyPath: "/auth/passkey/authenticate/finish",
  optionsToken: "tok-options",
  verifyToken: "tok-verify",
};

function verify(props: Partial<VerifyViewProps> = {}) {
  return render(
    <VerifyView
      factor='email-otp'
      submitPath='/auth/verify'
      resendPath='/auth/verify/resend'
      signinPath='/auth/signin'
      csrfToken='csrf-1'
      resendToken='csrf-resend'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("VerifyView", () => {
  it("renders a six-cell numeric code field wired to the `code` field id", async () => {
    expect(tagOf(await verify(), 'id="field-code"')).toBe(
      '<input data-slot="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" data-size="md" ' +
        'class="state-busy otp-editor h-full shrink-0 border-0 bg-transparent font-mono text-foreground outline-none tabular-nums text-base" ' +
        'autofocus id="field-code" name="code" aria-describedby="field-code-description">',
    );
  });

  // The field sized off a constant while the factor's width was configurable is the second half of
  // the same defect the schema had: a correct eight-digit code typed into a six-cell field.
  it("sizes the field to the presented factor's width, and describes that width in words", async () => {
    const html = await verify({ codeDigits: 8 });
    expect(attrOf(html, 'id="field-code"', "maxlength")).toBe("8");
    expect(textOf(html, "p", 'id="field-code-description"')).toBe("8 digits. Spaces and dashes are ignored.");
  });

  it("names the inbox the code went to, escaping whatever the address contains", async () => {
    expect(textOf(await verify({ email: HOSTILE_TEXT }), "div", 'data-slot="card-description"')).toBe(
      `Enter the code we emailed you. Sent to ${HOSTILE_TEXT_ESCAPED}.`,
    );
  });

  it("carries the invalid triple on a refused code", async () => {
    const html = await verify({ fieldError: "That code has expired." });
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe("");
    expect(attrOf(html, 'id="field-code"', "aria-invalid")).toBe("true");
    expect(elementOf(html, "p", 'id="field-code-error"')).toBe(
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-code-error" role="alert">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That code has expired.</p>",
    );
  });
});

describe("VerifyView per factor", () => {
  const prompt = (html: string) => textOf(html, "div", 'data-slot="card-description"');

  it("asks for an emailed code, an app code, or a ceremony — one prompt per factor, never shared", async () => {
    const prompts: string[] = [];
    for (const factor of ["email-otp", "totp-app", "passkey"] as AuthFactorKind[]) {
      prompts.push(prompt(await verify({ factor, passkey: PASSKEY_CONTRACT })));
    }
    expect(prompts).toEqual([
      "Enter the code we emailed you.",
      "Enter the current code from your authenticator app.",
      "Confirm with the passkey saved on this device.",
    ]);
  });

  it("renders the code field for both code factors and a ceremony scope for neither", async () => {
    for (const factor of ["email-otp", "totp-app"] as AuthFactorKind[]) {
      const html = await verify({ factor, passkey: PASSKEY_CONTRACT });
      expect({ factor, code: tagOf(html, 'id="field-code"') !== "", scope: tagOf(html, `data-scope="${PASSKEY_SCOPE}"`) !== "" }).toEqual({
        factor,
        code: true,
        scope: false,
      });
    }
  });

  it("renders a ceremony scope and no code field for a passkey step-up", async () => {
    const html = await verify({ factor: "passkey", passkey: PASSKEY_CONTRACT });
    expect(tagOf(html, 'id="field-code"')).toBe("");
    expect(attrsOf(html, `data-scope="${PASSKEY_SCOPE}"`)[PASSKEY_MODE_ATTR]).toBe("authentication");
    expect(attrOf(html, `data-ref="${PASSKEY.trigger}"`, "data-ref")).toBe(PASSKEY.trigger);
  });

  it("offers another code only where one can be re-sent — never for an authenticator app or a passkey", async () => {
    const resends: string[] = [];
    for (const factor of ["email-otp", "totp-app", "passkey"] as AuthFactorKind[]) {
      const html = await verify({ factor, passkey: PASSKEY_CONTRACT });
      resends.push(`${factor}:${elementsOf(html, "form", 'action="/auth/verify/resend"').length}`);
    }
    expect(resends).toEqual(["email-otp:1", "totp-app:0", "passkey:0"]);
  });

  it("draws exactly one primary control per factor, so the resend never competes with the submit", async () => {
    const primary =
      "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap " +
      "focus-ring motion-safe:transition-colors h-control-md px-4 text-sm [--tone:var(--color-primary)] " +
      "[--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] " +
      "[--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent " +
      "bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";
    for (const factor of ["email-otp", "totp-app", "passkey"] as AuthFactorKind[]) {
      const html = await verify({ factor, passkey: PASSKEY_CONTRACT });
      const count = valuesOf(html, "class").filter((cls) => cls === primary || cls === `${primary} w-full`).length;
      expect({ factor, primaries: count }).toEqual({ factor, primaries: 1 });
    }
  });

  it("drops the resend affordance when the loader gave no resend path", async () => {
    const props: Partial<VerifyViewProps> = { factor: "email-otp" };
    const html = await render(
      <VerifyView submitPath='/auth/verify' signinPath='/auth/signin' csrfToken='csrf-1' icon={AppIcon} {...props} factor='email-otp' />,
    );
    expect(elementsOf(html, "form", 'action="/auth/verify/resend"')).toEqual([]);
  });

  // `csrfProtection` binds a token to the path it was minted for, and this page posts to two. The
  // resend form borrowing `csrfToken` made every "send another code" a 403 with nothing to see.
  it("gives the resend form its own token rather than the submit path's", async () => {
    const html = await verify();
    const tokenOf = (action: string) => attrOf(elementOf(html, "form", `action="${action}"`), 'name="_csrf"', "value");

    expect({ submit: tokenOf("/auth/verify"), resend: tokenOf("/auth/verify/resend") }).toEqual({ submit: "csrf-1", resend: "csrf-resend" });
  });

  it("says nothing about a resend nobody asked for, and leaves the control live", async () => {
    const html = await verify();
    expect(tagOf(html, 'data-ref="verify-resent"')).toBe("");
    expect(attrsOf(html, 'data-ref="verify-resend"')["disabled"]).toBe(undefined);
  });

  // The wait comes from the factor, so a deployment that configures a different one is not
  // contradicted by copy — and the notice states the policy, never what became of this request.
  it("marks a requested resend with the factor's own wait, and holds the control for it", async () => {
    const html = await verify({ resent: true, reissueAfterMs: 60_000 });
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(
      "If another code was due, it is on its way — check your inbox. You can ask again in a minute.",
    );
    expect(attrsOf(html, 'data-ref="verify-resend"')["disabled"]).toBe("");
  });

  it("names a sub-minute wait in seconds rather than rounding it away", async () => {
    const html = await verify({ resent: true, reissueAfterMs: 30_000 });
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(
      "If another code was due, it is on its way — check your inbox. You can ask again in 30 seconds.",
    );
  });

  it("promises no wait when the factor enforces none", async () => {
    const html = await verify({ resent: true });
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe("If another code was due, it is on its way — check your inbox.");
  });

  it("drops the resend affordance when a path arrived without its token, rather than rendering a guaranteed 403", async () => {
    const html = await verify({ resendToken: undefined });
    expect(elementsOf(html, "form", 'action="/auth/verify/resend"')).toEqual([]);
  });
});

// The half of the factor design the guards decide and the views must not blur: owing a step-up and
// owing an enrolment are different states, and they land on different pages.
describe("VerifyView and the step-up/enrolment distinction", () => {
  it("is the page for a step-up demand, and renders a code field rather than an enrolment ceremony", async () => {
    const cell = authFactorGrid(["totp-app"]).find((entry) => entry.label === "passkey+totp-app / second-factor:always");
    expect(await factorDemand(cell as never)).toEqual({ status: "step-up-required", kinds: ["totp-app"] });

    const html = await verify({ factor: "totp-app" });
    expect(textOf(html, "div", 'data-slot="card-description"')).toBe("Enter the current code from your authenticator app.");
    expect(tagOf(html, 'id="field-code"') !== "").toBe(true);
    expect(tagOf(html, `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
  });

  it("never renders the enrolment page's heading, so the two demands cannot read the same", async () => {
    for (const factor of ["email-otp", "totp-app", "passkey"] as AuthFactorKind[]) {
      const html = await verify({ factor, passkey: PASSKEY_CONTRACT });
      expect({ factor, heading: textOf(html, "h1", 'class="text-xl"') }).toEqual({ factor, heading: "Confirm it&#39;s you" });
    }
  });
});
