import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders a <div> with data-slot=skeleton", async () => {
    expect(await render(<Skeleton />)).toBe('<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted"></div>');
  });

  it("is aria-hidden to hide from screen readers", async () => {
    expect(await render(<Skeleton />)).toBe('<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted"></div>');
  });

  it("has animate-pulse class", async () => {
    expect(await render(<Skeleton />)).toBe('<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted"></div>');
  });

  it("has bg-muted and rounded-md classes", async () => {
    expect(await render(<Skeleton />)).toBe('<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted"></div>');
  });

  it("merges a custom size class", async () => {
    expect(await render(<Skeleton class='h-4 w-full' />)).toBe(
      '<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted h-4 w-full"></div>',
    );
  });

  it("merges a custom shape class", async () => {
    expect(await render(<Skeleton class='h-10 w-10 rounded-full' />)).toBe(
      '<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted h-10 w-10 rounded-full"></div>',
    );
  });

  it("forwards id and data-* attributes and keeps aria-hidden", async () => {
    expect(await render(<Skeleton id='sk1' data-testid='skeleton' data-note='a&b' />)).toBe(
      '<div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted" id="sk1" data-testid="skeleton" data-note="a&amp;b"></div>',
    );
  });
});
