import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { ALERT_SCOPE } from "../contracts/alert-contract";
import { Alert } from "./alert";

const BOX = "relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm";
const NEUTRAL =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";
const DESTRUCTIVE =
  "[--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)]";
const SUCCESS =
  "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)]";
const SOFT =
  "border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]";
const SOLID =
  "border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";

const DEFAULT = `<div data-slot="alert" data-tone="neutral" data-appearance="soft" class="${BOX} ${NEUTRAL} ${SOFT}">`;
const DISMISS =
  '<button type="button" data-slot="alert-dismiss" aria-label="Dismiss" data-on-click="dismiss" class="absolute end-2 top-2 rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-base leading-none">×</span></button>';

describe("Alert", () => {
  it("renders neutral soft by default, stamping both axes", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(`${DEFAULT}Message</div>`);
  });

  // `forge-ui-a11y-one-live-region` routes urgency through the flash region, so a callout that is
  // merely on the page announces nothing. A caller who needs one passes `role` through `rest`.
  it("carries no role at any tone, and takes a caller's", async () => {
    const tones = ["neutral", "primary", "destructive", "success", "warning", "info"] as const;
    const rendered = await Promise.all(tones.map((tone) => render(<Alert tone={tone}>Message</Alert>)));

    expect(rendered.filter((html) => html.includes("role="))).toEqual([]);
    expect(await render(<Alert role='status'>Message</Alert>)).toBe(`${DEFAULT.slice(0, -1)} role="status">Message</div>`);
  });

  it("renders a destructive tone through the soft recipe", async () => {
    expect(await render(<Alert tone='destructive'>Error</Alert>)).toBe(
      `<div data-slot="alert" data-tone="destructive" data-appearance="soft" class="${BOX} ${DESTRUCTIVE} ${SOFT}">Error</div>`,
    );
  });

  it("renders the solid appearance", async () => {
    expect(
      await render(
        <Alert tone='success' appearance='solid'>
          Done
        </Alert>,
      ),
    ).toBe(`<div data-slot="alert" data-tone="success" data-appearance="solid" class="${BOX} ${SUCCESS} ${SOLID}">Done</div>`);
  });

  it("lets a caller override the role to status", async () => {
    expect(await render(<Alert role='status'>Saved</Alert>)).toBe(
      `<div data-slot="alert" data-tone="neutral" data-appearance="soft" class="${BOX} ${NEUTRAL} ${SOFT}" role="status">Saved</div>`,
    );
  });

  it("merges a custom class after the recipe", async () => {
    expect(await render(<Alert class='my-custom'>Note</Alert>)).toBe(
      `<div data-slot="alert" data-tone="neutral" data-appearance="soft" class="${BOX} ${NEUTRAL} ${SOFT} my-custom">Note</div>`,
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
      `${DEFAULT}<div data-slot="alert-title" class="leading-none font-medium tracking-tight">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">Everything is in sync.</div></div>`,
    );
  });

  it("renders the dismiss button, the alert scope and the wider end padding when dismissible", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      `<div data-slot="alert" data-tone="neutral" data-appearance="soft" data-scope="alert" class="${BOX.replace(" pe-4", "")} ${NEUTRAL} ${SOFT} pe-8">Message${DISMISS}</div>`,
    );
  });

  it("renders neither the dismiss button nor the scope by default", async () => {
    expect(await render(<Alert>Message</Alert>)).toBe(`${DEFAULT}Message</div>`);
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    expect(
      await render(
        <Alert id='a1' data-testid='alert' data-note='a&b'>
          Message
        </Alert>,
      ),
    ).toBe(
      `<div data-slot="alert" data-tone="neutral" data-appearance="soft" class="${BOX} ${NEUTRAL} ${SOFT}" id="a1" data-testid="alert" data-note="a&amp;b">Message</div>`,
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
      `${DEFAULT}<div data-slot="alert-title" class="leading-none font-medium tracking-tight" id="t1">Status</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90" role="note">Detail</div></div>`,
    );
  });
});

// The scope a component stamps and the scope a controller registers are two places that cannot see
// each other. Asserting them equal is only meaningful against the contract both now import.
describe("Alert — the scope it stamps is the scope that is registered", () => {
  it("emits ALERT_SCOPE when dismissible, and no scope when not", async () => {
    expect(await render(<Alert dismissible>Message</Alert>)).toBe(
      `<div data-slot="alert" data-tone="neutral" data-appearance="soft" data-scope="${ALERT_SCOPE}" class="${BOX.replace(" pe-4", "")} ${NEUTRAL} ${SOFT} pe-8">Message${DISMISS}</div>`,
    );
    expect(await render(<Alert>Message</Alert>)).toBe(`${DEFAULT}Message</div>`);
  });
});
