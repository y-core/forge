/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { EmptyState } from "./empty-state";
import { attrsOf, classesOf, variantClasses } from "./test-support";

describe("EmptyState", () => {
  it("renders the whole placeholder and its four parts exactly, text escaped", async () => {
    expect(
      await render(
        <EmptyState>
          <EmptyState.Figure>i</EmptyState.Figure>
          <EmptyState.Title>{`No R&D projects`}</EmptyState.Title>
          <EmptyState.Description>{`Create one in <1 minute — it's free.`}</EmptyState.Description>
          <EmptyState.Actions>x</EmptyState.Actions>
        </EmptyState>,
      ),
    ).toBe(
      '<div data-slot="empty-state" class="flex flex-col items-center gap-3 rounded-box border-field border-dashed border-border p-8 text-center">' +
        '<span data-slot="empty-state-figure" class="text-muted-foreground">i</span>' +
        '<h3 data-slot="empty-state-title" class="text-base font-semibold">No R&amp;D projects</h3>' +
        '<p data-slot="empty-state-description" class="max-w-prose text-sm text-pretty text-muted-foreground">Create one in &lt;1 minute — it&#39;s free.</p>' +
        '<div data-slot="empty-state-actions" class="mt-2 flex flex-wrap justify-center gap-2">x</div>' +
        "</div>",
    );
  });

  it("keeps its own slot token ahead of one handed down, and forwards the rest of the caller's attributes", async () => {
    expect(attrsOf(await render(<EmptyState id='no-projects' data-slot='panel' data-note='a&b' />))).toEqual({
      "data-slot": "empty-state panel",
      id: "no-projects",
      "data-note": "a&amp;b",
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<EmptyState class='p-2' />)).at(-1)).toBe("p-2");
  });

  it("changes only the Title's tag with the level, never its slot or its classes, which the hand-written-DOM path reads", async () => {
    const atThree = await render(<EmptyState.Title>t</EmptyState.Title>);

    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const heading = await render(<EmptyState.Title level={level}>t</EmptyState.Title>);

      expect(heading).toStartWith(`<h${level} `);
      expect(heading).toEndWith(`</h${level}>`);
      expect(attrsOf(heading)).toEqual(attrsOf(atThree));
      expect(variantClasses(heading, atThree)).toEqual({ added: [], dropped: [] });
    }
  });
});
