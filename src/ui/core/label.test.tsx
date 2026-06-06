/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Label } from "./label";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Label", () => {
  it("renders a <label> with data-slot=label", async () => {
    const out = await render(<Label>Name</Label>);
    expect(out).toContain("<label");
    expect(out).toContain('data-slot="label"');
    expect(out).toContain("Name");
  });

  it("applies shared label classes", async () => {
    const out = await render(<Label>Field</Label>);
    expect(out).toContain("text-sm");
    expect(out).toContain("font-medium");
    expect(out).toContain("text-foreground");
  });

  it("renders required marker when required=true", async () => {
    const out = await render(<Label required>Email</Label>);
    expect(out).toContain('data-slot="label-required"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("*");
    expect(out).toContain("text-red-500");
  });

  it("does not render required marker by default", async () => {
    const out = await render(<Label>Optional</Label>);
    expect(out).not.toContain('data-slot="label-required"');
  });

  it("passes the for attribute through", async () => {
    const out = await render(<Label for='email-field'>Email</Label>);
    expect(out).toContain('for="email-field"');
  });

  it("merges a custom class", async () => {
    const out = await render(<Label class='my-label'>Text</Label>);
    expect(out).toContain("my-label");
    expect(out).toContain("text-sm");
  });
});
