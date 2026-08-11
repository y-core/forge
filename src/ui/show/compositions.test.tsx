/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { CollectionSurface, CompositionsSection, FeedbackSurface, SettingsSurface } from "./compositions";

// Minimal icon compatible with ForgeIcon<…>; renders nothing.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

/** Occurrences of an exact substring — the primary-action count is a count, not a presence check. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("CompositionsSection", () => {
  it("renders the band anchor the table of contents links to", async () => {
    const out = await render(<CompositionsSection icon={icon} />);
    expect(out).toContain('id="compositions"');
    expect(out).toContain('id="composition-collection"');
    expect(out).toContain('id="composition-form"');
    expect(out).toContain('id="composition-feedback"');
  });
});

describe("CollectionSurface", () => {
  it("renders the populated rows from forge's own components", async () => {
    const out = await render(<CollectionSurface />);
    expect(out).toContain(">FlashOob</td>");
    expect(out).toContain(">ui/server</span>");
  });

  it("ships a designed empty state — a line of copy and the action that fills it", async () => {
    const out = await render(<CollectionSurface />);
    expect(out).toContain("No components are pinned yet. Pin one from the catalog to start the list.");
    expect(out).toContain(">Pin a component</button>");
  });

  it("shows the loading state as a skeleton in the row shape, never a spinner", async () => {
    const out = await render(<CollectionSurface />);
    // Two skeletons per real row: the placeholder occupies the box the table will occupy.
    expect(occurrences(out, 'data-slot="skeleton"')).toBe(10);
    expect(out).not.toContain('data-slot="spinner"');
  });

  it("names the failure in a destructive Alert and offers the way out", async () => {
    const out = await render(<CollectionSurface />);
    expect(out).toContain('data-variant="destructive"');
    expect(out).toContain("Could not load the component list");
    expect(out).toContain(">Retry</button>");
  });
});

describe("SettingsSurface", () => {
  it("carries exactly one primary action, with a secondary beside it", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    expect(occurrences(out, "bg-primary text-primary-foreground")).toBe(1);
    expect(out).toContain(">Save settings</button>");
    expect(out).toContain(">Reset</button>");
  });

  it("wires each validated control through FormField rather than by hand", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    expect(out).toContain('for="field-rows-per-page"');
    expect(out).toContain('id="field-rows-per-page"');
    expect(out).toContain('aria-describedby="field-rows-per-page-description"');
    expect(out).toContain('for="field-row-height"');
    expect(out).toContain('id="field-row-height"');
  });

  it("names the unvalidated settings row from the control itself", async () => {
    const out = await render(<SettingsSurface icon={icon} />);
    expect(out).toContain('data-slot="switch"');
    expect(out).toContain(">Show subpath</label>");
  });
});

describe("FeedbackSurface", () => {
  it("puts Alert and Toast side by side with the line that decides between them", async () => {
    const out = await render(<FeedbackSurface icon={icon} />);
    expect(out).toContain('data-slot="alert"');
    expect(out).toContain('data-slot="toast"');
    expect(out).toContain("The condition on the left is still true");
  });

  it("scopes the Spinner to the control in flight and the Skeleton to the known shape", async () => {
    const out = await render(<FeedbackSurface icon={icon} />);
    expect(out).toContain('data-slot="spinner"');
    expect(occurrences(out, 'data-slot="skeleton"')).toBe(2);
    expect(out).toContain("Saving…");
  });
});
