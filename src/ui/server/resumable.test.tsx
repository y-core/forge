/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Resumable } from "./resumable";

describe("Resumable", () => {
  it("renders a div carrying data-scope set to the name", async () => {
    const out = await render(<Resumable name='show-filter'>x</Resumable>);
    expect(out).toBe('<div data-scope="show-filter">x</div>');
  });

  it("serialises state to data-state as JSON that round-trips", async () => {
    const state = { query: "a", n: 2 };
    const out = await render(
      <Resumable name='s' state={state}>
        y
      </Resumable>,
    );
    expect(out).toBe('<div data-scope="s" data-state="{&quot;query&quot;:&quot;a&quot;,&quot;n&quot;:2}">y</div>');

    // Round-trip: the attribute value (HTML-entity-decoded) parses back to the original state.
    const decoded = '{"query":"a","n":2}';
    expect(JSON.parse(decoded)).toEqual(state);
  });

  it("omits the id attribute entirely when id is not passed", async () => {
    const out = await render(<Resumable name='s'>z</Resumable>);
    expect(out).toBe('<div data-scope="s">z</div>');
  });

  it("emits the id attribute when passed", async () => {
    const out = await render(
      <Resumable name='s' id='root'>
        z
      </Resumable>,
    );
    expect(out).toBe('<div data-scope="s" id="root">z</div>');
  });
});
