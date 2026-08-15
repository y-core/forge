/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { createBoundControl } from "./create-bound-control";

describe("createBoundControl", () => {
  it("adds a bind prop that becomes data-field, and forwards everything else", async () => {
    // Spreads everything: the wrapper hands `data-field` down as a prop, so a stub that named only
    // its own props would drop it and prove nothing.
    const Bare = (props: { id: string }) => <span {...props} />;
    const Bound = createBoundControl(Bare);

    expect(await render(<Bound bind='thing' id='x' />)).toBe('<span id="x" data-field="thing"></span>');
  });

  it("does not leak bind itself as an attribute", async () => {
    const Bound = createBoundControl((props: { id: string }) => <span {...props} />);

    expect(await render(<Bound bind='thing' id='x' />)).not.toContain('bind="');
  });
});
