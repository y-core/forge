/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Link } from "./link";

const PRIMARY =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const WARNING =
  "[--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)]";
const BASE = "rounded-sm text-(--tone-text) focus-ring-outset";

describe("Link", () => {
  it("renders a primary underlined link by default, stamping both axes", async () => {
    expect(await render(<Link href='/a'>go</Link>)).toBe(
      `<a data-slot="link" data-tone="primary" data-decoration="underline" class="${PRIMARY} ${BASE} underline underline-offset-4" href="/a">go</a>`,
    );
  });

  it("renders the hover appearance on another tone", async () => {
    expect(
      await render(
        <Link tone='warning' decoration='hover' href='/b'>
          go
        </Link>,
      ),
    ).toBe(
      `<a data-slot="link" data-tone="warning" data-decoration="hover" class="${WARNING} ${BASE} no-underline hover:underline" href="/b">go</a>`,
    );
  });

  it("renders the plain appearance, merges a caller class, and escapes children", async () => {
    expect(
      await render(
        <Link decoration='plain' class='font-bold'>
          {`R&D's`}
        </Link>,
      ),
    ).toBe(`<a data-slot="link" data-tone="primary" data-decoration="plain" class="${PRIMARY} ${BASE} no-underline font-bold">R&amp;D&#39;s</a>`);
  });

  it("forwards id and data-* attributes with escaped values", async () => {
    expect(
      await render(
        <Link id='l1' data-note='a&b'>
          x
        </Link>,
      ),
    ).toBe(
      `<a data-slot="link" data-tone="primary" data-decoration="underline" class="${PRIMARY} ${BASE} underline underline-offset-4" id="l1" data-note="a&amp;b">x</a>`,
    );
  });

  it("merges its props onto a single element child under asChild", async () => {
    expect(
      await render(
        <Link asChild>
          <a href='/c' class='block'>
            kid
          </a>
        </Link>,
      ),
    ).toBe(
      `<a href="/c" class="${PRIMARY} ${BASE} underline underline-offset-4 block" data-tone="primary" data-decoration="underline" data-slot="link">kid</a>`,
    );
  });

  it("throws when asChild receives no single element child", async () => {
    expect(() => render(<Link asChild>text</Link>)).toThrow(
      "Link with asChild requires exactly one JSX element child (e.g. an <a> from a router); received a string, number, fragment, array, or empty child instead.",
    );
  });
});
