/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { attrOf, tagOf, textOf } from "../web.fixture";
import { ApprovalView } from "./approval";
import type { ApprovalViewProps } from "./types";

function prompt(props: Partial<ApprovalViewProps> = {}) {
  return render(<ApprovalView submitPath='/approve?next=%2Fadmin' csrfToken='csrf-1' {...props} />);
}

describe("ApprovalView", () => {
  it("asks for the administrator code in the words a visitor stopped on the way somewhere reads", async () => {
    const html = await prompt();
    expect(textOf(html, "div", 'data-slot="card-description"')).toBe("Enter a valid administrator code to continue.");
  });

  it("posts the code to the path it was given, return-to included, with the token as a field", async () => {
    const html = await prompt();
    expect({
      action: attrOf(html, 'data-slot="form"', "action"),
      method: attrOf(html, 'data-slot="form"', "method"),
      token: attrOf(html, 'data-slot="form-csrf"', "value"),
      type: attrOf(html, 'data-ref="approval-code"', "type"),
    }).toEqual({ action: "/approve?next=%2Fadmin", method: "post", token: "csrf-1", type: "password" });
  });

  it("marks the field invalid and wires the refusal to it, only when there is one", async () => {
    const clean = await prompt();
    const refused = await prompt({ fieldError: "That is not a valid administrator code." });
    expect({
      before: attrOf(clean, 'data-ref="approval-code"', "aria-invalid"),
      after: attrOf(refused, 'data-ref="approval-code"', "aria-describedby"),
      error: textOf(refused, "p", 'id="field-code-error"'),
    }).toEqual({ before: "", after: "field-code-error", error: "That is not a valid administrator code." });
  });

  it("renders the challenge it is handed before the submit button, and none without one", async () => {
    const html = await prompt({ turnstile: { siteKey: "site-key", action: "approval" } });
    expect({
      widget: attrOf(html, 'data-sitekey="site-key"', "data-action"),
      before: html.indexOf('data-sitekey="site-key"') < html.indexOf('data-ref="approval-submit"'),
      absent: tagOf(await prompt(), 'data-sitekey="site-key"'),
    }).toEqual({ widget: "approval", before: true, absent: "" });
  });

  it("takes its heading level and its width from the host page", async () => {
    const html = await prompt({ level: 2, class: "max-w-none" });
    expect({ heading: textOf(html, "h2", 'class="text-xl"'), root: attrOf(html, 'data-slot="card"', "class").endsWith("max-w-none") }).toEqual({
      heading: "Administrator approval",
      root: true,
    });
  });
});
