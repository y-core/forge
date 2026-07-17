import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "./icon";
import { Spinner } from "./spinner";

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 24 24" });

describe("Spinner", () => {
  it("renders with role=status and data-slot=spinner", async () => {
    expect(await render(<Spinner icon={icon} />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders an aria-hidden SVG with animate-spin", async () => {
    expect(await render(<Spinner icon={icon} />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders the spinner via a sprite <use> reference", async () => {
    expect(await render(<Spinner icon={icon} />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders a sr-only default label", async () => {
    expect(await render(<Spinner icon={icon} />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders a custom label in sr-only span", async () => {
    expect(await render(<Spinner icon={icon} label='Processing…' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Processing…</span></span>',
    );
  });

  it("defaults to md size", async () => {
    expect(await render(<Spinner icon={icon} />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders sm size class", async () => {
    expect(await render(<Spinner icon={icon} size='sm' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-4" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("renders lg size class", async () => {
    expect(await render(<Spinner icon={icon} size='lg' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-8" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("merges a custom class on the wrapper", async () => {
    expect(await render(<Spinner icon={icon} class='my-spinner' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center my-spinner"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });

  it("forwards id and data-* attributes on the wrapper and keeps role=status", async () => {
    expect(await render(<Spinner icon={icon} id='sp1' data-testid='spinner' data-note='a&b' />)).toBe(
      '<span data-slot="spinner" role="status" class="inline-flex items-center justify-center" id="sp1" data-testid="spinner" data-note="a&amp;b"><svg data-slot="icon" viewBox="0 0 24 24" class="animate-spin size-6" aria-hidden="true"><use href="/sprite.svg#icon-spinner"></use></svg><span class="sr-only">Loading…</span></span>',
    );
  });
});
