import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders a <div> with data-slot=skeleton", async () => {
    const out = await render(<Skeleton />);
    expect(out).toContain("<div");
    expect(out).toContain('data-slot="skeleton"');
  });

  it("is aria-hidden to hide from screen readers", async () => {
    const out = await render(<Skeleton />);
    expect(out).toContain('aria-hidden="true"');
  });

  it("has animate-pulse class", async () => {
    const out = await render(<Skeleton />);
    expect(out).toContain("animate-pulse");
  });

  it("has bg-muted and rounded-md classes", async () => {
    const out = await render(<Skeleton />);
    expect(out).toContain("bg-muted");
    expect(out).toContain("rounded-md");
  });

  it("merges a custom size class", async () => {
    const out = await render(<Skeleton class='h-4 w-full' />);
    expect(out).toContain("h-4");
    expect(out).toContain("w-full");
    expect(out).toContain("animate-pulse");
  });

  it("merges a custom shape class", async () => {
    const out = await render(<Skeleton class='h-10 w-10 rounded-full' />);
    expect(out).toContain("rounded-full");
    expect(out).toContain("animate-pulse");
  });

  it("forwards id and data-* attributes and keeps aria-hidden", async () => {
    const out = await render(<Skeleton id='sk1' data-testid='skeleton' data-note='a&b' />);
    expect(out).toContain('id="sk1"');
    expect(out).toContain('data-testid="skeleton"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('aria-hidden="true"');
  });
});
