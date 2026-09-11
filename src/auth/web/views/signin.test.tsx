/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import {
  PASSKEY,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../../passkey-contract";
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
import type { AuthFactorCell } from "../types";
import { SigninView } from "./signin";
import type { AuthPasskeyContract } from "./types";
import type { SigninViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "key" | "mail">;

const PASSKEY_CONTRACT: AuthPasskeyContract = {
  mode: "authentication",
  optionsPath: "/auth/passkey/authenticate/begin",
  verifyPath: "/auth/passkey/authenticate/finish",
  optionsToken: "tok-options",
  verifyToken: "tok-verify",
};

const BUTTON_BASE =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap " +
  "focus-ring motion-safe:transition-colors h-control-md px-4 text-sm ";

/** The exact class a `primary`/`solid` control carries — compared whole, never as a substring. */
const PRIMARY_CLASS =
  `${BUTTON_BASE}[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] ` +
  "[--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] " +
  "[--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] " +
  "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";

/** The exact class a `neutral`/`outline` control carries. */
const OUTLINE_CLASS =
  `${BUTTON_BASE}[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] ` +
  "[--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent " +
  "[--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground";

/** The trigger's emphasis, named by whole-string equality so an unexpected class shows up in the diff. */
function triggerEmphasis(html: string): string {
  const cls = attrsOf(html, `data-ref="${PASSKEY.trigger}"`)["class"];
  if (cls === undefined) return "no-trigger";
  if (cls === `${PRIMARY_CLASS} w-full`) return "primary";
  if (cls === `${OUTLINE_CLASS} w-full`) return "outline";
  return `unexpected:${cls}`;
}

function signin(props: Partial<SigninViewProps> = {}) {
  return render(
    <SigninView primaryFactor='email-otp' submitPath='/auth/signin' signupPath='/auth/signup' csrfToken='csrf-1' icon={AppIcon} {...props} />,
  );
}

describe("SigninView", () => {
  it("renders the address field as the primary affordance when email-OTP is primary", async () => {
    expect(tagOf(await signin(), 'id="field-email"')).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" ' +
        'type="email" autocomplete="email" autofocus required id="field-email" name="email" aria-describedby="field-email-description">',
    );
  });

  it("keeps the address the visitor typed, escaped, across a refusal", async () => {
    const html = await signin({ email: HOSTILE_TEXT, fieldError: "That address was not accepted." });
    expect(attrOf(html, 'id="field-email"', "value")).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("carries `data-invalid`, `aria-invalid` and an icon together on a refused field", async () => {
    const html = await signin({ fieldError: "That address was not accepted." });
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe("");
    expect(attrOf(html, 'id="field-email"', "aria-invalid")).toBe("true");
    expect(elementOf(html, "p", 'id="field-email-error"')).toBe(
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-email-error" role="alert">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That address was not accepted.</p>",
    );
  });

  it("leaves the field valid and renders no error paragraph when nothing was refused", async () => {
    const html = await signin();
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBeUndefined();
    expect(elementOf(html, "p", 'id="field-email-error"')).toBe("");
  });

  it("names the failure in a titled destructive alert, so status is never colour alone", async () => {
    expect(elementOf(await signin({ error: "Too many attempts. Try again in an hour." }), "div", 'data-tone="destructive"')).toBe(
      '<div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 ' +
        "text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] " +
        "[--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] " +
        "[--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) " +
        '[--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]">' +
        '<svg data-slot="icon" class="size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        '<div data-slot="alert-title" class="leading-none font-medium tracking-tight">Sign-in failed</div>' +
        '<div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">Too many attempts. Try again in an hour.</div>' +
        "</div>",
    );
  });

  it("merges the CSRF token into `hx-headers` and renders exactly one hidden field for it", async () => {
    const html = await signin();
    expect(tagOf(html, 'data-slot="form"')).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}" class="flex flex-col gap-6" ' +
        'action="/auth/signin">',
    );
    expect(valuesOf(html, "value")).toEqual(["csrf-1"]);
  });
});

describe("SigninView passkey affordance", () => {
  it("makes the passkey trigger the one primary control when passkey is primary", async () => {
    expect(triggerEmphasis(await signin({ primaryFactor: "passkey", passkey: PASSKEY_CONTRACT }))).toBe("primary");
  });

  it("demotes the trigger to outline when it is the alternative, so one primary stands on the surface", async () => {
    const html = await signin({ passkey: PASSKEY_CONTRACT });
    expect(triggerEmphasis(html)).toBe("outline");
    expect(attrsOf(html, 'type="submit"')["class"]).toBe(PRIMARY_CLASS);
  });

  it("renders no passkey scope at all when the deployment offers no passkey", async () => {
    expect(tagOf(await signin(), `data-scope="${PASSKEY_SCOPE}"`)).toBe("");
  });

  it("puts the whole ceremony contract on the scope root, both tokens present and distinct", async () => {
    const html = await signin({ primaryFactor: "passkey", passkey: PASSKEY_CONTRACT });
    expect(attrsOf(html, `data-scope="${PASSKEY_SCOPE}"`)).toEqual({
      "data-scope": PASSKEY_SCOPE,
      [PASSKEY_MODE_ATTR]: "authentication",
      [PASSKEY_OPTIONS_PATH_ATTR]: "/auth/passkey/authenticate/begin",
      [PASSKEY_VERIFY_PATH_ATTR]: "/auth/passkey/authenticate/finish",
      [PASSKEY_OPTIONS_TOKEN_ATTR]: "tok-options",
      [PASSKEY_VERIFY_TOKEN_ATTR]: "tok-verify",
      class: "flex flex-col gap-3",
    });
  });

  it("opens no second live region — the ceremony announces through its outcome event", async () => {
    const html = await signin({ primaryFactor: "passkey", passkey: PASSKEY_CONTRACT });
    expect(valuesOf(html, "aria-live")).toEqual([]);
    expect(elementOf(html, "p", `data-ref="${PASSKEY.status}"`)).toBe(
      `<p data-ref="${PASSKEY.status}" class="max-w-prose text-sm text-pretty text-muted-foreground"></p>`,
    );
  });
});

// The visible half of the factor design: what a consumer's configuration puts on the sign-in page.
describe("SigninView across the factor matrix", () => {
  const grid = authFactorGrid();

  async function renderCell(cell: AuthFactorCell): Promise<string | null> {
    const choices = factorChoices(cell);
    if (choices === null) return null;
    return signin({ primaryFactor: choices.primary, ...(cell.kinds.includes("passkey") ? { passkey: PASSKEY_CONTRACT } : {}) });
  }

  it("puts the passkey trigger at exactly the emphasis the registry's primary implies, in every legal cell", async () => {
    const rendered: string[] = [];
    for (const cell of grid) {
      const html = await renderCell(cell);
      if (html === null) continue;
      const field = tagOf(html, 'id="field-email"') === "" ? "no-email-field" : "email-field";
      rendered.push(`${cell.label} => ${triggerEmphasis(html)} / ${field}`);
    }
    expect(rendered).toEqual([
      "email-otp primary=email-otp / all-optional => no-trigger / email-field",
      "email-otp primary=email-otp / all-mandatory => no-trigger / email-field",
      "email-otp primary=email-otp / first-mandatory => no-trigger / email-field",
      "email-otp primary=email-otp / for-roles => no-trigger / email-field",
      "passkey primary=passkey / all-optional => primary / no-email-field",
      "passkey primary=passkey / all-mandatory => primary / no-email-field",
      "passkey primary=passkey / first-mandatory => primary / no-email-field",
      "passkey primary=passkey / for-roles => primary / no-email-field",
      "email-otp+passkey primary=email-otp / all-optional => outline / email-field",
      "email-otp+passkey primary=email-otp / all-mandatory => outline / email-field",
      "email-otp+passkey primary=email-otp / first-mandatory => outline / email-field",
      "email-otp+passkey primary=email-otp / for-roles => outline / email-field",
      "email-otp+passkey primary=passkey / all-optional => primary / no-email-field",
      "email-otp+passkey primary=passkey / all-mandatory => primary / no-email-field",
      "email-otp+passkey primary=passkey / first-mandatory => primary / no-email-field",
      "email-otp+passkey primary=passkey / for-roles => primary / no-email-field",
      "email-otp+totp-app primary=email-otp / all-optional => no-trigger / email-field",
      "email-otp+totp-app primary=email-otp / all-mandatory => no-trigger / email-field",
      "email-otp+totp-app primary=email-otp / first-mandatory => no-trigger / email-field",
      "email-otp+totp-app primary=email-otp / for-roles => no-trigger / email-field",
      "passkey+totp-app primary=passkey / all-optional => primary / no-email-field",
      "passkey+totp-app primary=passkey / all-mandatory => primary / no-email-field",
      "passkey+totp-app primary=passkey / first-mandatory => primary / no-email-field",
      "passkey+totp-app primary=passkey / for-roles => primary / no-email-field",
      "email-otp+passkey+totp-app primary=email-otp / all-optional => outline / email-field",
      "email-otp+passkey+totp-app primary=email-otp / all-mandatory => outline / email-field",
      "email-otp+passkey+totp-app primary=email-otp / first-mandatory => outline / email-field",
      "email-otp+passkey+totp-app primary=email-otp / for-roles => outline / email-field",
      "email-otp+passkey+totp-app primary=passkey / all-optional => primary / no-email-field",
      "email-otp+passkey+totp-app primary=passkey / all-mandatory => primary / no-email-field",
      "email-otp+passkey+totp-app primary=passkey / first-mandatory => primary / no-email-field",
      "email-otp+passkey+totp-app primary=passkey / for-roles => primary / no-email-field",
    ]);
  });

  it("draws exactly one primary control in every legal cell, whichever factor is primary", async () => {
    for (const cell of grid) {
      const html = await renderCell(cell);
      if (html === null) continue;
      const primaries = valuesOf(html, "class").filter((cls) => cls === PRIMARY_CLASS || cls === `${PRIMARY_CLASS} w-full`);
      expect({ cell: cell.label, primaries: primaries.length }).toEqual({ cell: cell.label, primaries: 1 });
    }
  });

  it("offers no authenticator-app affordance on the sign-in page, in any cell", async () => {
    for (const cell of grid) {
      const html = await renderCell(cell);
      if (html === null) continue;
      expect({ cell: cell.label, totpNamed: /authenticator/.test(html) }).toEqual({ cell: cell.label, totpNamed: false });
    }
  });

  it("leaves every refused offering with no page to render at all", () => {
    expect(grid.filter((cell) => factorChoices(cell) === null).map((cell) => cell.label)).toEqual([
      "none / all-optional",
      "none / all-mandatory",
      "none / first-mandatory",
      "none / for-roles",
      "totp-app / all-optional",
      "totp-app / all-mandatory",
      "totp-app / first-mandatory",
      "totp-app / for-roles",
    ]);
  });

  it("keeps the heading the same whatever the primary factor is, so only the affordance moves", async () => {
    expect(textOf(await signin(), "h1", 'class="text-xl"')).toBe("Sign in");
    expect(textOf(await signin({ primaryFactor: "passkey", passkey: PASSKEY_CONTRACT }), "h1", 'class="text-xl"')).toBe("Sign in");
  });
});
