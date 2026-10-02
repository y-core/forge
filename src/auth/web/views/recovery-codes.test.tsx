/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { attrOf, elementOf, elementsOf, tagOf, textOf, valuesOf } from "../web.fixture";
import { RecoveryCodeField, RecoveryCodesView } from "./recovery-codes";
import type { RecoveryCodesViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert" | "key">;

const ISSUED = ["AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", "GGGG-HHHH-IIII-JJJJ-KKKK-LLLL"];

function codes(props: Partial<RecoveryCodesViewProps> = {}) {
  return render(
    <RecoveryCodesView
      remaining={null}
      generatePath='/account/recovery-codes'
      generateToken='csrf-generate'
      confirmPath='/account/recovery-codes/confirm'
      confirmToken='csrf-confirm'
      icon={AppIcon}
      {...props}
    />,
  );
}

const tokenOf = (html: string, action: string) => attrOf(elementOf(html, "form", `action="${action}"`), 'name="_csrf"', "value");

describe("RecoveryCodesView standing", () => {
  it("says an account without a confirmed set has none yet, and offers to generate one", async () => {
    const html = await codes();
    expect(textOf(html, "span", 'data-ref="recovery-remaining"')).toBe("You have no recovery codes yet.");
    expect(textOf(html, "button", 'type="submit"')).toBe("Generate recovery codes");
  });

  it("counts the unused codes of a confirmed set, singular and plural", async () => {
    const one = await codes({ remaining: 1 });
    const many = await codes({ remaining: 7 });
    expect([textOf(one, "span", 'data-ref="recovery-remaining"'), textOf(many, "span", 'data-ref="recovery-remaining"')]).toEqual([
      "You have 1 unused recovery code left.",
      "You have 7 unused recovery codes left.",
    ]);
  });

  it("posts the generate form with its own token, and shows no confirmation before a set is issued", async () => {
    const html = await codes({ remaining: 3 });
    expect(tokenOf(html, "/account/recovery-codes")).toBe("csrf-generate");
    expect(elementsOf(html, "form", 'action="/account/recovery-codes/confirm"')).toEqual([]);
    expect(tagOf(html, 'data-ref="recovery-codes"')).toBe("");
  });
});

describe("RecoveryCodesView with an issued set", () => {
  it("shows every issued code once, one per line in a single block", async () => {
    const html = await codes({ issued: ISSUED });
    expect(textOf(html, "pre", 'data-ref="recovery-codes"')).toBe(ISSUED.join("\n"));
  });

  it("tells the user to copy the codes now and keep them safe, because they are not shown again", async () => {
    const html = await codes({ issued: ISSUED });
    expect(textOf(html, "div", 'data-ref="recovery-keep-safe"')).toBe(
      "Keep them somewhere safe, such as a password manager. They won&#39;t be shown again. " +
        "Your old codes keep working until you type one of these back.",
    );
    expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("Copy these codes now");
  });

  it("offers the codes for copying only, never as a download", async () => {
    const html = await codes({ issued: ISSUED });
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/<[^>]*\sdownload(?=[\s>=])/);
    expect(valuesOf(html, "href").filter((href) => /^\s*data:/i.test(href))).toEqual([]);
  });

  it("asks for one of the new codes back, on the confirm path with its own token", async () => {
    const html = await codes({ issued: ISSUED });
    expect(tokenOf(html, "/account/recovery-codes/confirm")).toBe("csrf-confirm");
    expect(tagOf(elementOf(html, "form", 'action="/account/recovery-codes/confirm"'), 'name="code"')).not.toBe("");
  });
});

describe("RecoveryCodesView after a refused confirmation", () => {
  it("keeps the confirmation form and names the refusal, without showing any code again", async () => {
    const html = await codes({ fieldError: "That is not one of the new codes." });
    expect(tokenOf(html, "/account/recovery-codes/confirm")).toBe("csrf-confirm");
    expect(textOf(html, "p", 'id="field-code-error"')).toBe(
      '<svg data-slot="icon" class="me-2 inline-block size-4" aria-hidden="true"><use href="/assets/icons.svg#icon-alert"></use></svg>' +
        "That is not one of the new codes.",
    );
    expect(tagOf(html, 'data-ref="recovery-codes"')).toBe("");
  });
});

describe("RecoveryCodeField", () => {
  it("is a text field named code, not a digit-by-digit input", async () => {
    const html = await render(<RecoveryCodeField fieldError={undefined} icon={AppIcon} />);
    expect(attrOf(html, 'name="code"', "type")).toBe("text");
  });
});
