/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the dashed placeholder surface", async () => {
    expect(await render(<EmptyState>x</EmptyState>)).toBe(
      '<div data-slot="empty-state" class="flex flex-col items-center gap-3 rounded-box border-field border-dashed border-border p-8 text-center">x</div>',
    );
  });

  it("forwards props and merges an inherited data-slot", async () => {
    expect(await render(<EmptyState id='no-projects' data-slot='panel' />)).toBe(
      '<div data-slot="empty-state panel" class="flex flex-col items-center gap-3 rounded-box border-field border-dashed border-border p-8 text-center" id="no-projects"></div>',
    );
  });

  it("renders every compound", async () => {
    expect(
      await render(
        <EmptyState>
          <EmptyState.Figure>i</EmptyState.Figure>
          <EmptyState.Title>No projects</EmptyState.Title>
          <EmptyState.Description>Create one.</EmptyState.Description>
          <EmptyState.Actions>x</EmptyState.Actions>
        </EmptyState>,
      ),
    ).toBe(
      '<div data-slot="empty-state" class="flex flex-col items-center gap-3 rounded-box border-field border-dashed border-border p-8 text-center">' +
        '<span data-slot="empty-state-figure" class="text-muted-foreground">i</span>' +
        '<h3 data-slot="empty-state-title" class="text-base font-semibold">No projects</h3>' +
        '<p data-slot="empty-state-description" class="max-w-prose text-sm text-pretty text-muted-foreground">Create one.</p>' +
        '<div data-slot="empty-state-actions" class="mt-2 flex flex-wrap justify-center gap-2">x</div>' +
        "</div>",
    );
  });

  // The `data-slot` token and the class string must not vary with the level — only the tag — or the
  // hand-written-DOM path and every exact-markup assertion downstream break.
  it("renders Title at the requested level with byte-identical slot and class", async () => {
    expect(await render(<EmptyState.Title level={1}>No projects</EmptyState.Title>)).toBe(
      '<h1 data-slot="empty-state-title" class="text-base font-semibold">No projects</h1>',
    );
  });

  it("renders each of the six levels as its own tag", async () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      expect(await render(<EmptyState.Title level={level}>t</EmptyState.Title>)).toBe(
        `<h${level} data-slot="empty-state-title" class="text-base font-semibold">t</h${level}>`,
      );
    }
  });
});
