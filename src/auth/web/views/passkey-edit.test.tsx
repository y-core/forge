/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon, type ForgeIcon } from "../../../ui/core/icon";
import type { AuthCredential } from "../../types";
import { attrOf, attrsOf, elementOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf, valuesOf } from "../test-support";
import { PasskeyEditView, type PasskeyEditViewProps } from "./passkey-edit";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

const CREATED_AT = 1735689600000;

const FIELD_REFUSAL = "Use a shorter name for this passkey.";

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

function edit(props: Partial<PasskeyEditViewProps> = {}) {
  return render(
    <PasskeyEditView
      credential={credential()}
      renamePath='/account/passkeys/c1'
      cancelPath='/account/passkeys'
      csrfToken='csrf-1'
      icon={AppIcon}
      {...props}
    />,
  );
}

describe("PasskeyEditView", () => {
  it("patches the rename path, with the CSRF token merged into `hx-headers`", async () => {
    expect(tagOf(await edit(), 'data-slot="form"')).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}" class="flex flex-col gap-6" ' +
        'hx-patch="/account/passkeys/c1">',
    );
  });

  it("renders exactly one submitted field beyond the CSRF input", async () => {
    expect(valuesOf(await edit(), "name")).toEqual(["_csrf", "label"]);
  });

  it("prefills the field with the name the credential carries, escaped", async () => {
    const html = await edit({ credential: credential({ label: HOSTILE_TEXT }) });
    expect(attrOf(html, 'id="field-label"', "value")).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("names an unlabelled credential in the heading and leaves the field empty", async () => {
    const html = await edit({ credential: credential({ label: null }) });
    expect(textOf(html, "h1", 'data-ref="credential-label"')).toBe("Unnamed passkey");
    expect(attrOf(html, 'id="field-label"', "value")).toBe("");
  });

  it("dates the credential from its stored millisecond, machine-readable beside the text", async () => {
    expect(textOf(await edit(), "span", 'data-ref="credential-created"')).toBe(
      'Added <time datetime="2025-01-01T00:00:00.000Z" class="tabular-nums">2025-01-01</time>',
    );
  });

  it("carries the invalid triple on a refused name", async () => {
    const html = await edit({ fieldError: FIELD_REFUSAL });
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe("");
    expect(attrOf(html, 'id="field-label"', "aria-invalid")).toBe("true");
    expect(elementOf(html, "p", 'id="field-label-error"')).toBe(
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-label-error" role="alert">' +
        '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        `${FIELD_REFUSAL}</p>`,
    );
  });

  it("says nothing about the field until a submission was refused", async () => {
    const html = await edit();
    expect(tagOf(html, 'id="field-label-error"')).toBe("");
    expect(attrsOf(html, 'data-slot="field"')["data-invalid"]).toBe(undefined);
  });

  it("leaves the list reachable without a write, and submits from the one primary control", async () => {
    const html = await edit();
    expect(attrOf(html, 'data-ref="credential-rename-cancel"', "href")).toBe("/account/passkeys");
    expect(attrOf(html, 'data-ref="credential-rename-submit"', "type")).toBe("submit");
  });
});
