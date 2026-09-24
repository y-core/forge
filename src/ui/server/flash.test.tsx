import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Flash, FlashContainer, FlashOob } from "./flash";

describe("Flash", () => {
  it("renders nothing for empty messages array", async () => {
    const out = await render(<Flash messages={[]} />);
    expect(out).toBe("");
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<Flash />);
    expect(out).toBe("");
  });

  it("renders success toast with success variant", async () => {
    const out = await render(<Flash messages={[{ type: "success", text: "Saved!" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Saved!</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("maps error type to destructive variant", async () => {
    const out = await render(<Flash messages={[{ type: "error", text: "Failed" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="destructive" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Failed</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("maps info type to info variant", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "FYI" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="info" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">FYI</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("maps warning type to warning variant", async () => {
    const out = await render(<Flash messages={[{ type: "warning", text: "Careful" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="warning" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Careful</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("renders multiple messages", async () => {
    const out = await render(
      <Flash
        messages={[
          { type: "success", text: "All good" },
          { type: "error", text: "Something failed" },
        ]}
      />,
    );
    expect(out).toBe(
      '<div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">All good</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div><div data-slot="toast" data-tone="destructive" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Something failed</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("renders toasts as dismissible", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="info" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Hello</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("renders title when provided", async () => {
    const out = await render(<Flash messages={[{ type: "success", text: "Body text", title: "Great news" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-title" class="text-sm leading-none font-semibold">Great news</div><div data-slot="toast-description" class="text-sm opacity-90">Body text</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });

  it("does not render title slot when title is omitted", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "No title here" }]} />);
    expect(out).toBe(
      '<div data-slot="toast" data-tone="info" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">No title here</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div>',
    );
  });
});

describe("FlashContainer", () => {
  it("always renders toast-container with id and aria-live even when no messages", async () => {
    const out = await render(<FlashContainer />);
    expect(out).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end" id="flash-container"></section>',
    );
  });

  it("always renders wrapper even with empty messages array", async () => {
    const out = await render(<FlashContainer messages={[]} />);
    expect(out).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end" id="flash-container"></section>',
    );
  });

  it("renders messages inside the container", async () => {
    const out = await render(<FlashContainer messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toBe(
      '<section data-slot="toast-container" data-position="bottom-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 bottom-4 right-4 items-end" id="flash-container"><div data-slot="toast" data-tone="info" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Hello</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></section>',
    );
  });

  it("reflects position prop as data-position attribute", async () => {
    const out = await render(<FlashContainer position='top-right' />);
    expect(out).toBe(
      '<section data-slot="toast-container" data-position="top-right" aria-label="Notifications" aria-live="polite" aria-atomic="false" class="fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4 top-4 right-4 items-end" id="flash-container"></section>',
    );
  });
});

describe("FlashOob", () => {
  it("renders nothing for empty messages array", async () => {
    const out = await render(<FlashOob messages={[]} />);
    expect(out).toBe("");
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<FlashOob />);
    expect(out).toBe("");
  });

  it("renders oob swap attr targeting #flash-container on each wrapper div", async () => {
    const out = await render(<FlashOob messages={[{ type: "success", text: "Done" }]} />);
    expect(out).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Done</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });

  it("renders one oob wrapper per message", async () => {
    const out = await render(
      <FlashOob
        messages={[
          { type: "success", text: "A" },
          { type: "error", text: "B" },
        ]}
      />,
    );
    expect(out).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">A</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div><div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-tone="destructive" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">B</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });

  it("uses custom selector and strategy when provided", async () => {
    const out = await render(<FlashOob messages={[{ type: "info", text: "Custom" }]} selector='#notifications' strategy='afterend' />);
    expect(out).toBe(
      '<div hx-swap-oob="afterend:#notifications"><div data-slot="toast" data-tone="info" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-description" class="text-sm opacity-90">Custom</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });
});
