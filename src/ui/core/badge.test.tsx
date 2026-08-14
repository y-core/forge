import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
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
      '<span data-slot="badge" data-variant="destructive" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-danger-strong text-status-danger-strong-foreground border-status-danger-border">Error</span>',
    );
  });

  it("renders info variant classes", async () => {
    expect(await render(<Badge variant='info'>Info</Badge>)).toBe(
      '<span data-slot="badge" data-variant="info" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-info-strong text-status-info-strong-foreground border-status-info-border">Info</span>',
    );
  });

  it("renders success variant classes", async () => {
    expect(await render(<Badge variant='success'>Success</Badge>)).toBe(
      '<span data-slot="badge" data-variant="success" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-success-strong text-status-success-strong-foreground border-status-success-border">Success</span>',
    );
  });

  it("renders warning variant classes — the same status intent every forge status surface uses", async () => {
    expect(await render(<Badge variant='warning'>Warning</Badge>)).toBe(
      '<span data-slot="badge" data-variant="warning" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-warning-strong text-status-warning-strong-foreground border-status-warning-border">Warning</span>',
    );
  });

  it("expresses every status variant through `--status-*` tokens, with no raw palette or `dark:` utility", async () => {
    const audit: Record<string, { tokens: number; palette: string[]; dark: string[] }> = {};
    for (const variant of ["destructive", "info", "success", "warning"] as const) {
      const html = await render(<Badge variant={variant}>x</Badge>);
      const classes = (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
      audit[variant] = {
        tokens: classes.filter((c) => /^(?:bg|text|border)-status-[a-z]+-/.test(c)).length,
        palette: classes.filter((c) => /^(?:bg|text|border)-[a-z]+-(?:50|[1-9]00|950)$/.test(c)),
        dark: classes.filter((c) => c.startsWith("dark:")),
      };
    }

    expect(audit).toEqual({
      destructive: { tokens: 3, palette: [], dark: [] },
      info: { tokens: 3, palette: [], dark: [] },
      success: { tokens: 3, palette: [], dark: [] },
      warning: { tokens: 3, palette: [], dark: [] },
    });
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
