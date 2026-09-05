import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Toast } from "./toast";

const DEFAULT_TOAST =
  '<div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div></div>';

const DISMISSIBLE_TOAST =
  '<div data-slot="toast" data-tone="neutral" data-appearance="soft" data-scope="toast" data-island-state="{}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>';

describe("Toast", () => {
  // No `role`, no `aria-atomic`: a toast is announced by `Toast.Container`'s own live region, and a
  // second one on each item would re-announce the whole stack.
  it("is a bare div in the neutral soft variant, with no dismiss button and no scope of its own", async () => {
    expect(await render(<Toast>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("defaults to the default variant", async () => {
    expect(await render(<Toast>Hello</Toast>)).toBe(
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });

  it("renders success variant classes", async () => {
    expect(await render(<Toast tone='success'>Done</Toast>)).toBe(
      '<div data-slot="toast" data-tone="success" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Done</div></div>',
    );
  });

  it("renders info variant classes", async () => {
    expect(await render(<Toast tone='info'>Info</Toast>)).toBe(
      '<div data-slot="toast" data-tone="info" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Info</div></div>',
    );
  });

  it("renders warning variant classes", async () => {
    expect(await render(<Toast tone='warning'>Alert</Toast>)).toBe(
      '<div data-slot="toast" data-tone="warning" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Alert</div></div>',
    );
  });

  it("renders destructive variant classes", async () => {
    expect(await render(<Toast tone='destructive'>Error</Toast>)).toBe(
      '<div data-slot="toast" data-tone="destructive" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Error</div></div>',
    );
  });

  it("dismissible adds the close button, its dismiss action, the toast scope and the pe-10 it needs", async () => {
    expect(await render(<Toast dismissible>Message</Toast>)).toBe(DISMISSIBLE_TOAST);
  });

  it("stamps data-scope and data-state with duration when duration > 0", async () => {
    expect(await render(<Toast duration={3000}>Message</Toast>)).toBe(
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:3000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div></div>',
    );
  });

  it("does not stamp data-scope when duration is 0", async () => {
    expect(await render(<Toast duration={0}>Message</Toast>)).toBe(DEFAULT_TOAST);
  });

  it("keeps a duration of 0 in data-state, distinguishable from a duration never passed", async () => {
    expect(
      await render(
        <Toast dismissible duration={0}>
          Message
        </Toast>,
      ),
    ).toBe(
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:0}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1">Message</div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("merges a custom class", async () => {
    expect(await render(<Toast class='my-toast'>Hello</Toast>)).toBe(
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] my-toast"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
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
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]" id="t1" data-testid="toast" data-note="a&amp;b"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });
});

describe("Toast.Container", () => {
  it("is the polite live region, fixed and z-50, defaulting to bottom-right", async () => {
    expect(await render(<Toast.Container />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"></section>',
    );
  });

  it("renders top-left position classes", async () => {
    expect(await render(<Toast.Container position='top-left' />)).toBe(
      '<section data-slot="toast-container" data-position="top-left" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 top-4 left-4 items-start"></section>',
    );
  });

  it("renders top-center position with translate", async () => {
    expect(await render(<Toast.Container position='top-center' />)).toBe(
      '<section data-slot="toast-container" data-position="top-center" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 top-4 left-1/2 -translate-x-1/2 items-center"></section>',
    );
  });

  it("renders top-right position classes", async () => {
    expect(await render(<Toast.Container position='top-right' />)).toBe(
      '<section data-slot="toast-container" data-position="top-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 top-4 right-4 items-end"></section>',
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
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end"><div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div></section>',
    );
  });

  it("forwards a custom id and data-* attributes via spread", async () => {
    expect(await render(<Toast.Container id='toasts' data-testid='container' />)).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end" id="toasts" data-testid="container"></section>',
    );
  });
});

describe("Toast.Title and Toast.Description", () => {
  it("renders Toast.Title with data-slot=toast-title", async () => {
    expect(await render(<Toast.Title>Success</Toast.Title>)).toBe(
      '<div data-slot="toast-title" class="text-sm leading-none font-semibold">Success</div>',
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
      '<div data-slot="toast-title" class="text-sm leading-none font-semibold" id="tt">Saved</div><div data-slot="toast-description" class="text-sm opacity-90" data-note="a&amp;b">Detail</div>',
    );
  });
});
