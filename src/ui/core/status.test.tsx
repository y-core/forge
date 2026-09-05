/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Status } from "./status";

const NEUTRAL =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";
const SUCCESS =
  "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)]";
const DOT = "inline-block rounded-selector bg-(--tone)";

describe("Status", () => {
  it("renders a neutral md dot named by its label", async () => {
    expect(await render(<Status label='Idle' />)).toBe(
      `<span role="img" aria-label="Idle" data-slot="status" data-tone="neutral" class="${NEUTRAL} ${DOT} size-2.5"></span>`,
    );
  });

  it("renders a toned lg dot", async () => {
    expect(await render(<Status label='Up' tone='success' size='lg' />)).toBe(
      `<span role="img" aria-label="Up" data-slot="status" data-tone="success" class="${SUCCESS} ${DOT} size-3"></span>`,
    );
  });

  it("renders the sm size", async () => {
    expect(await render(<Status label='Up' size='sm' />)).toBe(
      `<span role="img" aria-label="Up" data-slot="status" data-tone="neutral" class="${NEUTRAL} ${DOT} size-2"></span>`,
    );
  });

  it("escapes the label and merges a caller class last", async () => {
    expect(await render(<Status label={`R&D's`} class='ring-2' />)).toBe(
      `<span role="img" aria-label="R&amp;D&#39;s" data-slot="status" data-tone="neutral" class="${NEUTRAL} ${DOT} size-2.5 ring-2"></span>`,
    );
  });

  it("forwards attributes with escaped values", async () => {
    expect(await render(<Status label='Up' id='s1' data-note='a&b' />)).toBe(
      `<span role="img" aria-label="Up" data-slot="status" data-tone="neutral" class="${NEUTRAL} ${DOT} size-2.5" id="s1" data-note="a&amp;b"></span>`,
    );
  });

  it("composes an inherited data-slot token after its own", async () => {
    expect(await render(<Status label='Up' data-slot='inherited' />)).toBe(
      `<span role="img" aria-label="Up" data-slot="status inherited" data-tone="neutral" class="${NEUTRAL} ${DOT} size-2.5"></span>`,
    );
  });
});
