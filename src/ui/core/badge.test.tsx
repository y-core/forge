import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders a <span> with data-slot=badge", async () => {
    const out = await render(<Badge>New</Badge>);
    expect(out).toContain("<span");
    expect(out).toContain('data-slot="badge"');
    expect(out).toContain("New");
  });

  it("defaults to the default variant", async () => {
    const out = await render(<Badge>Label</Badge>);
    expect(out).toContain('data-variant="default"');
    expect(out).toContain("bg-primary");
    expect(out).toContain("text-primary-foreground");
  });

  it("renders secondary variant classes", async () => {
    const out = await render(<Badge variant='secondary'>Secondary</Badge>);
    expect(out).toContain('data-variant="secondary"');
    expect(out).toContain("bg-secondary");
    expect(out).toContain("text-secondary-foreground");
  });

  it("renders destructive variant classes", async () => {
    const out = await render(<Badge variant='destructive'>Error</Badge>);
    expect(out).toContain('data-variant="destructive"');
    expect(out).toContain("bg-red-100");
    expect(out).toContain("text-red-800");
  });

  it("renders outline variant classes", async () => {
    const out = await render(<Badge variant='outline'>Outline</Badge>);
    expect(out).toContain('data-variant="outline"');
    expect(out).toContain("border-border");
    expect(out).toContain("text-foreground");
  });

  it("includes base inline-flex and rounded-full classes", async () => {
    const out = await render(<Badge>Base</Badge>);
    expect(out).toContain("inline-flex");
    expect(out).toContain("rounded-full");
    expect(out).toContain("text-xs");
  });

  it("merges a custom class with the base classes", async () => {
    const out = await render(<Badge class='my-badge'>Custom</Badge>);
    expect(out).toContain("my-badge");
    expect(out).toContain("inline-flex");
  });

  it("forwards id and data-* attributes with HTML-escaped values", async () => {
    const out = await render(
      <Badge id='b1' data-testid='badge' data-note='a&b'>
        New
      </Badge>,
    );
    expect(out).toContain('id="b1"');
    expect(out).toContain('data-testid="badge"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('data-slot="badge"');
  });
});
