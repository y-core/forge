import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Alert } from "./alert";

describe("Alert", () => {
  it("renders the default variant classes", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
    );
  });

  it("renders the destructive variant classes", async () => {
    expect(await render(<Alert variant='destructive'>Error</Alert>)).toBe(
      '<div data-slot="alert" data-variant="destructive" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground">Error</div>',
    );
  });

  it("renders the success variant classes", async () => {
    expect(await render(<Alert variant='success'>Done</Alert>)).toBe(
      '<div data-slot="alert" data-variant="success" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-status-success-border bg-status-success-subtle text-status-success-subtle-foreground">Done</div>',
    );
  });

  it("renders children inside the alert div", async () => {
    expect(await render(<Alert>Hello world</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground">Hello world</div>',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Alert class='my-custom'>Note</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground my-custom">Note</div>',
    );
  });

  it("renders explicit title and description slots", async () => {
    expect(
      await render(
        <Alert>
          <Alert.Title>Status</Alert.Title>
          <Alert.Description>Everything is in sync.</Alert.Description>
        </Alert>,
      ),
    ).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground"><div data-slot="alert-title" class="font-medium leading-none tracking-tight">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">Everything is in sync.</div></div>',
    );
  });

  it("renders the warning variant classes", async () => {
    expect(await render(<Alert variant='warning'>Warning</Alert>)).toBe(
      '<div data-slot="alert" data-variant="warning" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-status-warning-border bg-status-warning-subtle text-status-warning-subtle-foreground">Warning</div>',
    );
  });

  it("renders the info variant classes", async () => {
    expect(await render(<Alert variant='info'>Info</Alert>)).toBe(
      '<div data-slot="alert" data-variant="info" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-status-info-border bg-status-info-subtle text-status-info-subtle-foreground">Info</div>',
    );
  });

  it("renders dismiss button when dismissible=true", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border ps-4 py-3 text-sm border-border bg-muted text-foreground pe-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute end-2 top-2 rounded opacity-50 motion-safe:transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("does not render dismiss button by default", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
    );
  });

  it("stamps data-scope=alert on root when dismissible", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border ps-4 py-3 text-sm border-border bg-muted text-foreground pe-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute end-2 top-2 rounded opacity-50 motion-safe:transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("stamps data-on-click=dismiss on the dismiss button when dismissible", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border ps-4 py-3 text-sm border-border bg-muted text-foreground pe-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute end-2 top-2 rounded opacity-50 motion-safe:transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("does not stamp data-scope when not dismissible", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
    );
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    expect(
      await render(
        <Alert id='a1' data-testid='alert' data-note='a&b'>
          Message
        </Alert>,
      ),
    ).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground" id="a1" data-testid="alert" data-note="a&amp;b">Message</div>',
    );
  });

  it("forwards id and role attributes on the title and description", async () => {
    expect(
      await render(
        <Alert>
          <Alert.Title id='t1'>Status</Alert.Title>
          <Alert.Description role='note'>Detail</Alert.Description>
        </Alert>,
      ),
    ).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border ps-4 pe-4 py-3 text-sm border-border bg-muted text-foreground"><div data-slot="alert-title" class="font-medium leading-none tracking-tight" id="t1">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90" role="note">Detail</div></div>',
    );
  });
});
