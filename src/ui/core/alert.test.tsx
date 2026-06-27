import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Alert } from "./alert";

describe("Alert", () => {
  it("renders the default variant classes", async () => {
    const out = await render(<Alert>Message</Alert>);
    expect(out).toContain('data-slot="alert"');
    expect(out).toContain("border-border");
    expect(out).toContain("bg-muted");
    expect(out).toContain("text-foreground");
  });

  it("renders the destructive variant classes", async () => {
    const out = await render(<Alert variant='destructive'>Error</Alert>);
    expect(out).toContain("border-red-200");
    expect(out).toContain("bg-red-50");
    expect(out).toContain("text-red-900");
  });

  it("renders the success variant classes", async () => {
    const out = await render(<Alert variant='success'>Done</Alert>);
    expect(out).toContain("border-emerald-200");
    expect(out).toContain("bg-emerald-50");
    expect(out).toContain("text-emerald-900");
  });

  it("renders children inside the alert div", async () => {
    const out = await render(<Alert>Hello world</Alert>);
    expect(out).toContain("Hello world");
  });

  it("merges a custom class with the base classes", async () => {
    const out = await render(<Alert class='my-custom'>Note</Alert>);
    expect(out).toContain("my-custom");
    expect(out).toContain("rounded-2xl");
  });

  it("renders explicit title and description slots", async () => {
    const out = await render(
      <Alert>
        <Alert.Title>Status</Alert.Title>
        <Alert.Description>Everything is in sync.</Alert.Description>
      </Alert>,
    );
    expect(out).toContain('data-slot="alert-title"');
    expect(out).toContain('data-slot="alert-description"');
    expect(out).toContain("Everything is in sync.");
  });

  it("renders the warning variant classes", async () => {
    const out = await render(<Alert variant='warning'>Warning</Alert>);
    expect(out).toContain('data-variant="warning"');
    expect(out).toContain("bg-yellow-50");
    expect(out).toContain("text-yellow-900");
    expect(out).toContain("border-yellow-200");
  });

  it("renders the info variant classes", async () => {
    const out = await render(<Alert variant='info'>Info</Alert>);
    expect(out).toContain('data-variant="info"');
    expect(out).toContain("bg-blue-50");
    expect(out).toContain("text-blue-900");
    expect(out).toContain("border-blue-200");
  });

  it("renders dismiss button when dismissible=true", async () => {
    const out = await render(<Alert dismissible>Message</Alert>);
    expect(out).toContain('data-slot="alert-dismiss"');
    expect(out).toContain('aria-label="Dismiss"');
    expect(out).toContain("pr-8");
  });

  it("does not render dismiss button by default", async () => {
    const out = await render(<Alert>Message</Alert>);
    expect(out).not.toContain('data-slot="alert-dismiss"');
  });

  it("stamps data-scope=alert on root when dismissible", async () => {
    const out = await render(<Alert dismissible>Message</Alert>);
    expect(out).toContain('data-scope="alert"');
  });

  it("stamps data-on-click=dismiss on the dismiss button when dismissible", async () => {
    const out = await render(<Alert dismissible>Message</Alert>);
    expect(out).toContain('data-on-click="dismiss"');
  });

  it("does not stamp data-scope when not dismissible", async () => {
    const out = await render(<Alert>Message</Alert>);
    expect(out).not.toContain("data-scope=");
  });
});
