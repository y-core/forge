import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Toast } from "./toast";

const DEFAULT_TOAST =
  '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div></div>';

const DISMISSIBLE_TOAST =
  '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" data-scope="toast" data-state="{}" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground pr-10"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute right-2 top-2 rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>';

describe("Toast", () => {
  it("renders with role=status and data-slot=toast", async () => {
    expect(await render(<Toast>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("defaults to the default variant", async () => {
    expect(await render(<Toast>Hello</Toast>)).toBe(
      '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });

  it("renders success variant classes", async () => {
    expect(await render(<Toast variant='success'>Done</Toast>)).toBe(
      '<div data-slot="toast" data-variant="success" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-emerald-200 bg-emerald-50 text-emerald-900"><div data-slot="toast-body" class="flex-1 space-y-1">Done</div></div>',
    );
  });

  it("renders info variant classes", async () => {
    expect(await render(<Toast variant='info'>Info</Toast>)).toBe(
      '<div data-slot="toast" data-variant="info" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-blue-200 bg-blue-50 text-blue-900"><div data-slot="toast-body" class="flex-1 space-y-1">Info</div></div>',
    );
  });

  it("renders warning variant classes", async () => {
    expect(await render(<Toast variant='warning'>Alert</Toast>)).toBe(
      '<div data-slot="toast" data-variant="warning" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-yellow-200 bg-yellow-50 text-yellow-900"><div data-slot="toast-body" class="flex-1 space-y-1">Alert</div></div>',
    );
  });

  it("renders destructive variant classes", async () => {
    expect(await render(<Toast variant='destructive'>Error</Toast>)).toBe(
      '<div data-slot="toast" data-variant="destructive" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-red-200 bg-red-50 text-red-900"><div data-slot="toast-body" class="flex-1 space-y-1">Error</div></div>',
    );
  });

  it("has aria-atomic=true", async () => {
    expect(await render(<Toast>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("renders dismiss button when dismissible=true", async () => {
    expect(await render(<Toast dismissible>Message</Toast>)).toBe(DISMISSIBLE_TOAST);
  });

  it("does not render dismiss button by default", async () => {
    expect(await render(<Toast>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("adds pr-10 padding when dismissible to make room for close button", async () => {
    expect(await render(<Toast dismissible>Message</Toast>)).toBe(DISMISSIBLE_TOAST);
  });

  it("stamps data-scope and data-state when dismissible", async () => {
    expect(await render(<Toast dismissible>Message</Toast>)).toBe(DISMISSIBLE_TOAST);
  });

  it("stamps data-on-click=dismiss on the close button when dismissible", async () => {
    expect(await render(<Toast dismissible>Message</Toast>)).toBe(DISMISSIBLE_TOAST);
  });

  it("stamps data-scope and data-state with duration when duration > 0", async () => {
    expect(await render(<Toast duration={3000}>Message</Toast>)).toBe(
      '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" data-scope="toast" data-state="{&quot;duration&quot;:3000}" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div></div>',
    );
  });

  it("does not stamp data-scope when neither dismissible nor duration set", async () => {
    expect(await render(<Toast>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("does not stamp data-scope when duration is 0", async () => {
    expect(await render(<Toast duration={0}>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("merges a custom class", async () => {
    expect(await render(<Toast class='my-toast'>Hello</Toast>)).toBe(
      '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground my-toast"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    expect(
      await render(
        <Toast id='t1' data-testid='toast' data-note='a&b'>
          Hello
        </Toast>,
      ),
    ).toBe(
      '<div data-slot="toast" data-variant="default" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground" id="t1" data-testid="toast" data-note="a&amp;b"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });
});

describe("Toast.Container", () => {
  it("renders as <section> with aria-live=polite", async () => {
    expect(await render(<Toast.Container />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"></section>',
    );
  });

  it("defaults to bottom-right position", async () => {
    expect(await render(<Toast.Container />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"></section>',
    );
  });

  it("renders top-left position classes", async () => {
    expect(await render(<Toast.Container position='top-left' />)).toBe(
      '<section data-slot="toast-container" data-position="top-left" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 top-4 left-4 items-start"></section>',
    );
  });

  it("renders top-center position with translate", async () => {
    expect(await render(<Toast.Container position='top-center' />)).toBe(
      '<section data-slot="toast-container" data-position="top-center" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 top-4 left-1/2 -translate-x-1/2 items-center"></section>',
    );
  });

  it("renders top-right position classes", async () => {
    expect(await render(<Toast.Container position='top-right' />)).toBe(
      '<section data-slot="toast-container" data-position="top-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 top-4 right-4 items-end"></section>',
    );
  });

  it("renders fixed positioning and z-index", async () => {
    expect(await render(<Toast.Container />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"></section>',
    );
  });

  it("renders children", async () => {
    expect(
      await render(
        <Toast.Container>
          <Toast>Hello</Toast>
        </Toast.Container>,
      ),
    ).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"><div data-slot="toast" data-variant="default" role="status" aria-atomic="true" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-border bg-background text-foreground"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div></section>',
    );
  });

  it("forwards a custom id and data-* attributes via spread", async () => {
    expect(await render(<Toast.Container id='toasts' data-testid='container' />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end" id="toasts" data-testid="container"></section>',
    );
  });
});

describe("Toast.Title and Toast.Description", () => {
  it("renders Toast.Title with data-slot=toast-title", async () => {
    expect(await render(<Toast.Title>Success</Toast.Title>)).toBe(
      '<div data-slot="toast-title" class="text-sm font-semibold leading-none">Success</div>',
    );
  });

  it("renders Toast.Description with data-slot=toast-description", async () => {
    expect(await render(<Toast.Description>Your changes were saved.</Toast.Description>)).toBe(
      '<div data-slot="toast-description" class="text-sm opacity-90">Your changes were saved.</div>',
    );
  });

  it("forwards id and data-* attributes on the title and description", async () => {
    expect(
      await render(
        <>
          <Toast.Title id='tt'>Saved</Toast.Title>
          <Toast.Description data-note='a&b'>Detail</Toast.Description>
        </>,
      ),
    ).toBe(
      '<div data-slot="toast-title" class="text-sm font-semibold leading-none" id="tt">Saved</div><div data-slot="toast-description" class="text-sm opacity-90" data-note="a&amp;b">Detail</div>',
    );
  });
});
