import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Badge } from "./badge";

const BOX = "inline-flex items-center rounded-selector border-field font-medium";
const NEUTRAL =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";
const PRIMARY =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const WARNING =
  "[--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)]";
const SOFT =
  "border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]";
const SOLID =
  "border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";
const OUTLINE = "border-(--tone-text) bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] hover:bg-(--tone-soft)";

describe("Badge", () => {
  it("renders neutral soft at the md size by default, stamping both axes", async () => {
    expect(await render(<Badge>New</Badge>)).toBe(
      `<span data-slot="badge" data-tone="neutral" data-appearance="soft" class="${BOX} px-2.5 py-0.5 text-xs ${NEUTRAL} ${SOFT}">New</span>`,
    );
  });

  it("renders a primary solid chip", async () => {
    expect(
      await render(
        <Badge tone='primary' appearance='solid'>
          Pro
        </Badge>,
      ),
    ).toBe(
      `<span data-slot="badge" data-tone="primary" data-appearance="solid" class="${BOX} px-2.5 py-0.5 text-xs ${PRIMARY} ${SOLID}">Pro</span>`,
    );
  });

  it("renders a warning soft chip on the audited warning text step", async () => {
    expect(await render(<Badge tone='warning'>Late</Badge>)).toBe(
      `<span data-slot="badge" data-tone="warning" data-appearance="soft" class="${BOX} px-2.5 py-0.5 text-xs ${WARNING} ${SOFT}">Late</span>`,
    );
  });

  it("renders the outline appearance", async () => {
    expect(await render(<Badge appearance='outline'>Draft</Badge>)).toBe(
      `<span data-slot="badge" data-tone="neutral" data-appearance="outline" class="${BOX} px-2.5 py-0.5 text-xs ${NEUTRAL} ${OUTLINE}">Draft</span>`,
    );
  });

  it("renders the sm size", async () => {
    expect(await render(<Badge size='sm'>3</Badge>)).toBe(
      `<span data-slot="badge" data-tone="neutral" data-appearance="soft" class="${BOX} px-2 py-px text-[0.6875rem] ${NEUTRAL} ${SOFT}">3</span>`,
    );
  });

  it("merges a caller class and escapes children", async () => {
    expect(await render(<Badge class='uppercase'>{`R&D's`}</Badge>)).toBe(
      `<span data-slot="badge" data-tone="neutral" data-appearance="soft" class="${BOX} px-2.5 py-0.5 text-xs ${NEUTRAL} ${SOFT} uppercase">R&amp;D&#39;s</span>`,
    );
  });

  it("forwards id and data-* attributes with escaped values", async () => {
    expect(
      await render(
        <Badge id='b1' data-note='a&b'>
          x
        </Badge>,
      ),
    ).toBe(
      `<span data-slot="badge" data-tone="neutral" data-appearance="soft" class="${BOX} px-2.5 py-0.5 text-xs ${NEUTRAL} ${SOFT}" id="b1" data-note="a&amp;b">x</span>`,
    );
  });
});
