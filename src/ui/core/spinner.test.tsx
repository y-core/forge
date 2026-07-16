import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "./icon";
import { Spinner } from "./spinner";

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 24 24" });

describe("Spinner", () => {
  it("renders with role=status and data-slot=spinner", async () => {
    const out = await render(<Spinner icon={icon} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('data-slot="spinner"');
  });

  it("renders an aria-hidden SVG with animate-spin", async () => {
    const out = await render(<Spinner icon={icon} />);
    expect(out).toContain("<svg");
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("animate-spin");
  });

  it("renders the spinner via a sprite <use> reference", async () => {
    const out = await render(<Spinner icon={icon} />);
    expect(out).toContain("<use");
    expect(out).toContain('href="/sprite.svg#icon-spinner"');
  });

  it("renders a sr-only default label", async () => {
    const out = await render(<Spinner icon={icon} />);
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("Loading");
  });

  it("renders a custom label in sr-only span", async () => {
    const out = await render(<Spinner icon={icon} label='Processing…' />);
    expect(out).toContain("Processing");
  });

  it("defaults to md size", async () => {
    const out = await render(<Spinner icon={icon} />);
    expect(out).toContain("size-6");
  });

  it("renders sm size class", async () => {
    const out = await render(<Spinner icon={icon} size='sm' />);
    expect(out).toContain("size-4");
  });

  it("renders lg size class", async () => {
    const out = await render(<Spinner icon={icon} size='lg' />);
    expect(out).toContain("size-8");
  });

  it("merges a custom class on the wrapper", async () => {
    const out = await render(<Spinner icon={icon} class='my-spinner' />);
    expect(out).toContain("my-spinner");
    expect(out).toContain("inline-flex");
  });

  it("forwards id and data-* attributes on the wrapper and keeps role=status", async () => {
    const out = await render(<Spinner icon={icon} id='sp1' data-testid='spinner' data-note='a&b' />);
    expect(out).toContain('id="sp1"');
    expect(out).toContain('data-testid="spinner"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('role="status"');
  });
});
