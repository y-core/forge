/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { createBoundCompound, createBoundControl } from "./create-bound-control";

describe("createBoundControl", () => {
  it("adds a bind prop that becomes data-field, and forwards everything else", async () => {
    // Spreads everything: the wrapper hands `data-field` down as a prop, so a stub that named only
    // its own props would drop it and prove nothing.
    const Bare = (props: { id: string }) => <span {...props} />;
    const Bound = createBoundControl(Bare);

    expect(await render(<Bound bind='thing' id='x' />)).toBe('<span id="x" data-field="thing"></span>');
  });

  it("overrides a data-field the caller already set", async () => {
    const Bound = createBoundControl((props: { id: string }) => <span {...props} />);

    expect(await render(<Bound bind='thing' data-field='stale' id='x' />)).toBe('<span data-field="thing" id="x"></span>');
  });

  it("forwards a caller's name untouched rather than deriving it from bind", async () => {
    const Bound = createBoundControl((props: { id: string; name?: string }) => <span {...props} />);

    expect(await render(<Bound bind='thing' id='x' name='other' />)).toBe('<span id="x" name="other" data-field="thing"></span>');
  });

  it("emits an empty data-field for an empty bind", async () => {
    const Bound = createBoundControl((props: { id: string }) => <span {...props} />);

    expect(await render(<Bound bind='' id='x' />)).toBe('<span id="x" data-field=""></span>');
  });

  it("carries the core component's own statics onto the wrapper", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundControl(Core);

    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<i>core</i>");
  });

  it("lets an override replace one static and wrap the original without re-entering itself", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundControl(Core, { Item: () => <u>{Core.Item()}</u> });

    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<u><i>core</i></u>");
  });
});

describe("createBoundCompound", () => {
  it("passes the root's props through untouched and carries every static over", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundCompound(Core, { Item: () => <u>bound</u> });

    expect(await render(<Bound id='x' />)).toBe('<span id="x"></span>');
    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<u>bound</u>");
  });
});
