import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders a <span> with data-slot=badge", async () => {
    expect(await render(<Badge>New</Badge>)).toBe(
      '<span data-slot="badge" data-variant="default" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-primary text-primary-foreground border-transparent">New</span>',
    );
  });

  it("defaults to the default variant", async () => {
    expect(await render(<Badge>Label</Badge>)).toBe(
      '<span data-slot="badge" data-variant="default" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-primary text-primary-foreground border-transparent">Label</span>',
    );
  });

  it("renders secondary variant classes", async () => {
    expect(await render(<Badge variant='secondary'>Secondary</Badge>)).toBe(
      '<span data-slot="badge" data-variant="secondary" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-secondary text-secondary-foreground border-transparent">Secondary</span>',
    );
  });

  it("renders destructive variant classes", async () => {
    expect(await render(<Badge variant='destructive'>Error</Badge>)).toBe(
      '<span data-slot="badge" data-variant="destructive" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-red-100 text-red-800 border-red-200">Error</span>',
    );
  });

  it("renders outline variant classes", async () => {
    expect(await render(<Badge variant='outline'>Outline</Badge>)).toBe(
      '<span data-slot="badge" data-variant="outline" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors border-border text-foreground">Outline</span>',
    );
  });

  it("includes base inline-flex and rounded-full classes", async () => {
    expect(await render(<Badge>Base</Badge>)).toBe(
      '<span data-slot="badge" data-variant="default" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-primary text-primary-foreground border-transparent">Base</span>',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Badge class='my-badge'>Custom</Badge>)).toBe(
      '<span data-slot="badge" data-variant="default" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-primary text-primary-foreground border-transparent my-badge">Custom</span>',
    );
  });

  it("forwards id and data-* attributes with HTML-escaped values", async () => {
    expect(
      await render(
        <Badge id='b1' data-testid='badge' data-note='a&b'>
          New
        </Badge>,
      ),
    ).toBe(
      '<span data-slot="badge" data-variant="default" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-primary text-primary-foreground border-transparent" id="b1" data-testid="badge" data-note="a&amp;b">New</span>',
    );
  });
});
