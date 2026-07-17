import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Alert } from "./alert";

describe("Alert", () => {
  it("renders the default variant classes", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
    );
  });

  it("renders the destructive variant classes", async () => {
    expect(await render(<Alert variant='destructive'>Error</Alert>)).toBe(
      '<div data-slot="alert" data-variant="destructive" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-900">Error</div>',
    );
  });

  it("renders the success variant classes", async () => {
    expect(await render(<Alert variant='success'>Done</Alert>)).toBe(
      '<div data-slot="alert" data-variant="success" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-emerald-200 bg-emerald-50 text-emerald-900">Done</div>',
    );
  });

  it("renders children inside the alert div", async () => {
    expect(await render(<Alert>Hello world</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground">Hello world</div>',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Alert class='my-custom'>Note</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground my-custom">Note</div>',
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
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground"><div data-slot="alert-title" class="font-medium leading-none tracking-tight">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed opacity-90">Everything is in sync.</div></div>',
    );
  });

  it("renders the warning variant classes", async () => {
    expect(await render(<Alert variant='warning'>Warning</Alert>)).toBe(
      '<div data-slot="alert" data-variant="warning" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-yellow-200 bg-yellow-50 text-yellow-900">Warning</div>',
    );
  });

  it("renders the info variant classes", async () => {
    expect(await render(<Alert variant='info'>Info</Alert>)).toBe(
      '<div data-slot="alert" data-variant="info" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-blue-200 bg-blue-50 text-blue-900">Info</div>',
    );
  });

  it("renders dismiss button when dismissible=true", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground pr-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("does not render dismiss button by default", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
    );
  });

  it("stamps data-scope=alert on root when dismissible", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground pr-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("stamps data-on-click=dismiss on the dismiss button when dismissible", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" data-scope="alert" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground pr-8">Message<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-base leading-none">×</span></button></div>',
    );
  });

  it("does not stamp data-scope when not dismissible", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground">Message</div>',
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
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground" id="a1" data-testid="alert" data-note="a&amp;b">Message</div>',
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
      '<div data-slot="alert" data-variant="default" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-border bg-muted text-foreground"><div data-slot="alert-title" class="font-medium leading-none tracking-tight" id="t1">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed opacity-90" role="note">Detail</div></div>',
    );
  });
});
