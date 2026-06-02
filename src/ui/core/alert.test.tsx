import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Alert, AlertDescription, AlertTitle } from "./alert";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Alert", () => {
  it("renders the default variant classes", async () => {
    const out = await render(<Alert>Message</Alert>);
    expect(out).toContain('data-slot="alert"');
    expect(out).toContain("border-border");
    expect(out).toContain("bg-muted");
    expect(out).toContain("text-foreground");
  });

  it("renders the destructive variant classes", async () => {
    const out = await render(<Alert variant="destructive">Error</Alert>);
    expect(out).toContain("border-red-200");
    expect(out).toContain("bg-red-50");
    expect(out).toContain("text-red-900");
  });

  it("renders the success variant classes", async () => {
    const out = await render(<Alert variant="success">Done</Alert>);
    expect(out).toContain("border-emerald-200");
    expect(out).toContain("bg-emerald-50");
    expect(out).toContain("text-emerald-900");
  });

  it("renders children inside the alert div", async () => {
    const out = await render(<Alert>Hello world</Alert>);
    expect(out).toContain("Hello world");
  });

  it("merges a custom class with the base classes", async () => {
    const out = await render(<Alert class="my-custom">Note</Alert>);
    expect(out).toContain("my-custom");
    expect(out).toContain("rounded-2xl");
  });

  it("renders explicit title and description slots", async () => {
    const out = await render(
      <Alert>
        <AlertTitle>Status</AlertTitle>
        <AlertDescription>Everything is in sync.</AlertDescription>
      </Alert>,
    );
    expect(out).toContain('data-slot="alert-title"');
    expect(out).toContain('data-slot="alert-description"');
    expect(out).toContain("Everything is in sync.");
  });
});
