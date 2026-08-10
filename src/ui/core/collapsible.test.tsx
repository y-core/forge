import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Collapsible } from "./collapsible";

/**
 * `core/Collapsible`'s SSR markup, pinned exactly.
 *
 * Opening and closing are `<details>`'s own, and `collapsible.browser.ts` covers what happens when a
 * user drives it. What is pinned here is what the *server* emits, and the `data-open` /
 * `data-closed` pair being exhaustive is the part a behaviour test never sees: a closed disclosure
 * looks identical whether `data-closed` was written or forgotten.
 */

const TRIGGER_BASE =
  "flex cursor-pointer list-none select-none items-center gap-2 rounded px-1 py-2 text-sm font-medium outline-none " +
  "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring";

describe("Collapsible", () => {
  it("renders a closed details with the scope and the closed half of the state pair", async () => {
    expect(await render(<Collapsible />)).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" data-closed="" class="group/collapsible"></details>',
    );
  });

  it("stamps the platform `open` attribute and the open half of the pair together", async () => {
    expect(await render(<Collapsible open />)).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" open data-open="" class="group/collapsible"></details>',
    );
  });

  it("treats an explicit open={false} exactly as the default", async () => {
    expect(await render(<Collapsible open={false} />)).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" data-closed="" class="group/collapsible"></details>',
    );
  });

  it("merges a caller class onto the group base", async () => {
    expect(await render(<Collapsible class='rounded-md border' />)).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" data-closed="" class="group/collapsible rounded-md border"></details>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<Collapsible data-slot='filters' />)).toBe(
      '<details data-slot="collapsible filters" data-scope="collapsible" data-closed="" class="group/collapsible"></details>',
    );
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<Collapsible data-note={`R&D's "advanced" <opts>`} aria-label={`R&D's options`} />)).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" data-closed="" class="group/collapsible" ' +
        'data-note="R&amp;D&#39;s &quot;advanced&quot; &lt;opts&gt;" aria-label="R&amp;D&#39;s options"></details>',
    );
  });

  it("renders the whole compound in one tree", async () => {
    expect(
      await render(
        <Collapsible open>
          <Collapsible.Trigger>Advanced</Collapsible.Trigger>
          <Collapsible.Panel>Nothing here yet.</Collapsible.Panel>
        </Collapsible>,
      ),
    ).toBe(
      '<details data-slot="collapsible" data-scope="collapsible" open data-open="" class="group/collapsible">' +
        `<summary data-slot="collapsible-trigger" class="${TRIGGER_BASE}">Advanced</summary>` +
        '<div data-slot="collapsible-panel" class="px-1 pb-2 text-sm text-muted-foreground">Nothing here yet.</div>' +
        "</details>",
    );
  });
});

describe("Collapsible.Trigger", () => {
  it("renders a summary with the trigger base classes", async () => {
    expect(await render(<Collapsible.Trigger>Advanced</Collapsible.Trigger>)).toBe(
      `<summary data-slot="collapsible-trigger" class="${TRIGGER_BASE}">Advanced</summary>`,
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(
      await render(
        <Collapsible.Trigger class='justify-between' data-slot='filters-trigger'>
          Advanced
        </Collapsible.Trigger>,
      ),
    ).toBe(`<summary data-slot="collapsible-trigger filters-trigger" class="${TRIGGER_BASE} justify-between">Advanced</summary>`);
  });
});

describe("Collapsible.Panel", () => {
  it("renders the panel div with its base classes", async () => {
    expect(await render(<Collapsible.Panel>Nothing here yet.</Collapsible.Panel>)).toBe(
      '<div data-slot="collapsible-panel" class="px-1 pb-2 text-sm text-muted-foreground">Nothing here yet.</div>',
    );
  });

  it("merges a caller class, appends an inherited slot token, and escapes children", async () => {
    expect(
      await render(
        <Collapsible.Panel class='pt-1' data-slot='filters-panel'>
          {`R&D's <options>`}
        </Collapsible.Panel>,
      ),
    ).toBe(
      '<div data-slot="collapsible-panel filters-panel" class="px-1 pb-2 text-sm text-muted-foreground pt-1">' +
        "R&amp;D&#39;s &lt;options&gt;</div>",
    );
  });
});
