import { describe, expect, it } from "bun:test";

import { attrsOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders the whole placeholder exactly, forwarded attributes escaped", async () => {
    expect(await render(<Skeleton id='sk1' data-testid='skeleton' data-note='a&b' />)).toBe(
      '<div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse" id="sk1" data-testid="skeleton" data-note="a&amp;b"></div>',
    );
  });

  it("hides itself from a screen reader, which has nothing to announce about content that has not loaded", async () => {
    expect(attrsOf(await render(<Skeleton />))).toEqual({ "data-slot": "skeleton", "aria-hidden": "true" });
  });

  it("takes its size from the caller, having no intrinsic dimensions of its own", async () => {
    expect(variantClasses(await render(<Skeleton class='h-4 w-full' />), await render(<Skeleton />))).toEqual({
      added: ["h-4", "w-full"],
      dropped: [],
    });
  });

  it("lets a caller's radius evict the default one rather than emit two", async () => {
    expect(variantClasses(await render(<Skeleton class='h-10 w-10 rounded-full' />), await render(<Skeleton />))).toEqual({
      added: ["h-10", "w-10", "rounded-full"],
      dropped: ["rounded-field"],
    });
  });
});
