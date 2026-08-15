/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
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

  // The same prop→attribute mapping `ToolbarAction.ref` uses, so a scope whose own setup addresses
  // its root no longer has to be hand-written as a bare `<div data-scope>`.
  it("emits ref as data-ref, after data-state and before class", async () => {
    const out = await render(
      <Resumable name='s' state={{ q: "" }} ref='surface' class='p-4'>
        z
      </Resumable>,
    );
    expect(out).toBe('<div data-scope="s" data-state="{&quot;q&quot;:&quot;&quot;}" data-ref="surface" class="p-4">z</div>');
  });

  it("omits data-ref entirely when ref is not passed", async () => {
    const out = await render(<Resumable name='s'>z</Resumable>);
    expect(out).not.toContain("data-ref");
  });

  it("emits the class attribute on the scope root when passed", async () => {
    const out = await render(
      <Resumable name='s' class='w-64 shrink-0'>
        z
      </Resumable>,
    );
    expect(out).toBe('<div data-scope="s" class="w-64 shrink-0">z</div>');
  });
});
