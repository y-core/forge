/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { PASSKEY_SCOPE } from "../../passkey-contract";
import {
  attrOf,
  attrsOf,
  authFactorGrid,
  elementOf,
  factorChoices,
  HOSTILE_TEXT,
  HOSTILE_TEXT_ESCAPED,
  tagOf,
  textOf,
  valuesOf,
} from "../test-support";
import { SignupView } from "./signup";
import type { SignupViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

function signup(props: Partial<SignupViewProps> = {}) {
  return render(<SignupView submitPath='/auth/signup' signinPath='/auth/signin' csrfToken='csrf-1' icon={AppIcon} {...props} />);
}

describe("SignupView", () => {
  it("posts one address field to the sign-up path, with the CSRF token merged into `hx-headers`", async () => {
    expect(tagOf(await signup(), 'data-slot="form"')).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}" class="flex flex-col gap-6" ' +
        'action="/auth/signup">',
    );
  });

  // The visitor is about to search an inbox: the sign-up flow mails a six-digit code and no link,
  // so naming a link sends them looking for the wrong thing.
  it("tells the visitor a six-digit code is coming, which is what the flow sends", async () => {
    expect(textOf(await signup(), "div", 'data-slot="card-description"')).toBe("We email you a six-digit code to confirm the address.");
  });

  // A deployment demanding no second factor must not promise a step its visitor is never shown, and
  // one that switched the passkey off must not name it: the copy follows the offered factors.
  it("names the factor that will be enrolled, and only the one this deployment offers", async () => {
    const described = async (enrols: SignupViewProps["enrols"]) => textOf(await signup({ enrols }), "div", 'data-slot="card-description"');

    expect({ passkey: await described("passkey"), totp: await described("totp-app"), none: await described(undefined) }).toEqual({
      passkey: "We email you a six-digit code to confirm the address. You choose a passkey afterwards.",
      totp: "We email you a six-digit code to confirm the address. You add an authenticator app afterwards.",
      none: "We email you a six-digit code to confirm the address.",
    });
  });

  it("renders exactly one submitted field beyond the CSRF input", async () => {
    const html = await signup();
    expect(valuesOf(html, "name")).toEqual(["_csrf", "email"]);
  });

  it("keeps the address the visitor typed, escaped, across a refusal", async () => {
    const html = await signup({ email: HOSTILE_TEXT, fieldError: "That address is already in use." });
    expect(attrOf(html, 'id="field-email"', "value")).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("carries the invalid triple on a refused address", async () => {
    const html = await signup({ fieldError: "That address is already in use." });
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe("");
    expect(attrOf(html, 'id="field-email"', "aria-invalid")).toBe("true");
    expect(elementOf(html, "p", 'id="field-email-error"')).toBe(
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-email-error" role="alert">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That address is already in use.</p>",
    );
  });

  it("names the failure in a titled alert when the attempt as a whole was refused", async () => {
    const html = await signup({ error: "Sign-ups are closed." });
    expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("We could not use that address");
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe("Sign-ups are closed.");
  });

  it("links back to sign-in rather than dead-ending a visitor who already has an account", async () => {
    expect(attrOf(await signup(), 'data-slot="link"', "href")).toBe("/auth/signin");
  });
});

// A passkey is enrolled against an account, so it cannot be the thing that creates one. That holds
// in every cell of the matrix, including the ones where passkey is the deployment's primary factor.
describe("SignupView across the factor matrix", () => {
  it("renders the same single-address form whatever the offering and policy are", async () => {
    const grid = authFactorGrid();
    const shapes = new Set<string>();
    for (const cell of grid) {
      if (factorChoices(cell) === null) continue;
      const html = await signup();
      shapes.add(`${valuesOf(html, "name").join(",")}|${tagOf(html, `data-scope="${PASSKEY_SCOPE}"`)}`);
    }
    expect([...shapes]).toEqual(["_csrf,email|"]);
  });

  it("offers no passkey and no authenticator affordance at all", async () => {
    const html = await signup();
    expect(tagOf(html, `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
    expect(/passkey|authenticator/.test(textOf(html, "div", 'data-slot="card-content"'))).toBe(false);
  });
});
