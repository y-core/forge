import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { Tabs } from "./tabs";

const TAB_BASE =
  "cursor-pointer rounded-field border-0 bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground no-underline focus-ring hover:text-foreground state-disabled aria-selected:bg-accent aria-selected:text-accent-foreground";

const PANEL_BASE = "focus-ring";

describe("Tabs", () => {
  it("defaults to a horizontal, automatically-activated root carrying the scope", async () => {
    expect(await render(<Tabs />)).toBe(
      `<div data-slot="tabs" data-scope="${TABS_SCOPE}" data-activation="automatic" data-orientation="horizontal" class="flex flex-col gap-3"></div>`,
    );
  });

  it("stacks a vertical root along the other axis and says so in the state attribute", async () => {
    expect(await render(<Tabs orientation='vertical' />)).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="automatic" data-orientation="vertical" class="flex flex-row gap-4"></div>',
    );
  });

  it("carries manual activation through to the attribute the controller reads", async () => {
    expect(await render(<Tabs activation='manual' />)).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="manual" data-orientation="horizontal" class="flex flex-col gap-3"></div>',
    );
  });

  it("merges a caller class and keeps its own slot token ahead of an inherited one", async () => {
    expect(await render(<Tabs class='w-full' data-slot='settings-tabs' />)).toBe(
      '<div data-slot="tabs settings-tabs" data-scope="tabs" data-activation="automatic" data-orientation="horizontal" ' +
        'class="flex flex-col gap-3 w-full"></div>',
    );
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<Tabs data-note={`R&D's "views" <all>`} aria-label={`R&D's views`} />)).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="automatic" data-orientation="horizontal" class="flex flex-col gap-3" ' +
        'data-note="R&amp;D&#39;s &quot;views&quot; &lt;all&gt;" aria-label="R&amp;D&#39;s views"></div>',
    );
  });

  it("renders the whole compound in one tree, with only the unselected panel hidden", async () => {
    expect(
      await render(
        <Tabs>
          <Tabs.List>
            <Tabs.Tab for='panel-a' selected>
              A
            </Tabs.Tab>
            <Tabs.Tab for='panel-b'>B</Tabs.Tab>
          </Tabs.List>
          <Tabs.Content id='panel-a' selected>
            First
          </Tabs.Content>
          <Tabs.Content id='panel-b'>Second</Tabs.Content>
        </Tabs>,
      ),
    ).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="automatic" data-orientation="horizontal" class="flex flex-col gap-3">' +
        '<div role="tablist" data-slot="tabs-list" aria-orientation="horizontal" data-orientation="horizontal" ' +
        'class="flex gap-1 border-b border-border pb-1">' +
        `<a href="#panel-a" role="tab" data-slot="tab" aria-selected="true" aria-controls="panel-a" data-selected="" ` +
        `data-composite-item-active="" class="${TAB_BASE}">A</a>` +
        `<a href="#panel-b" role="tab" data-slot="tab" aria-selected="false" aria-controls="panel-b" class="${TAB_BASE}">B</a>` +
        "</div>" +
        `<div id="panel-a" role="tabpanel" data-slot="tabs-content" tabindex="0" data-selected="" class="${PANEL_BASE}">First</div>` +
        `<div id="panel-b" role="tabpanel" data-slot="tabs-content" tabindex="0" hidden class="${PANEL_BASE}">Second</div>` +
        "</div>",
    );
  });
});

describe("Tabs.List", () => {
  it("announces its axis to both readers and underlines a horizontal strip", async () => {
    expect(await render(<Tabs.List />)).toBe(
      '<div role="tablist" data-slot="tabs-list" aria-orientation="horizontal" data-orientation="horizontal" ' +
        'class="flex gap-1 border-b border-border pb-1"></div>',
    );
  });

  it("turns the rule down the side for a vertical strip", async () => {
    expect(await render(<Tabs.List orientation='vertical' />)).toBe(
      '<div role="tablist" data-slot="tabs-list" aria-orientation="vertical" data-orientation="vertical" ' +
        'class="flex gap-1 flex-col border-e border-border pe-2"></div>',
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(await render(<Tabs.List class='px-2' data-slot='settings-tablist' />)).toBe(
      '<div role="tablist" data-slot="tabs-list settings-tablist" aria-orientation="horizontal" data-orientation="horizontal" ' +
        'class="flex gap-1 border-b border-border pb-1 px-2"></div>',
    );
  });
});

describe("Tabs.Tab", () => {
  it("renders an unselected tab wired to the panel it controls", async () => {
    expect(await render(<Tabs.Tab for='panel-a'>A</Tabs.Tab>)).toBe(
      `<a href="#panel-a" role="tab" data-slot="tab" aria-selected="false" aria-controls="panel-a" class="${TAB_BASE}">A</a>`,
    );
  });

  it("stamps aria-selected, data-selected and the composite marker together when selected", async () => {
    expect(
      await render(
        <Tabs.Tab for='panel-a' selected>
          A
        </Tabs.Tab>,
      ),
    ).toBe(
      '<a href="#panel-a" role="tab" data-slot="tab" aria-selected="true" aria-controls="panel-a" data-selected="" ' +
        `data-composite-item-active="" class="${TAB_BASE}">A</a>`,
    );
  });

  // No `href`: with scripts off, or before `mountTabs` stamps `data-tabs-mounted`, the `:target`
  // fallback in `forge-ui.css` would reveal a disabled tab's panel and hide the selected one — so
  // the prop's promise held only once the controller had run.
  it("passes disabled through, renders no href, and merges a caller class", async () => {
    expect(
      await render(
        <Tabs.Tab for='panel-c' class='grow' disabled>
          C
        </Tabs.Tab>,
      ),
    ).toBe(
      '<a role="tab" data-slot="tab" aria-selected="false" aria-controls="panel-c" ' +
        `aria-disabled="true" data-disabled="" class="${TAB_BASE} grow">C</a>`,
    );
  });

  it("keeps its own slot token ahead of an inherited one and escapes its children", async () => {
    expect(await render(<Tabs.Tab for='panel-a' data-slot='settings-tab'>{`R&D's <view>`}</Tabs.Tab>)).toBe(
      '<a href="#panel-a" role="tab" data-slot="tab settings-tab" aria-selected="false" aria-controls="panel-a" ' +
        `class="${TAB_BASE}">R&amp;D&#39;s &lt;view&gt;</a>`,
    );
  });
});

describe("Tabs.Content", () => {
  it("hides an unselected panel with the platform's own attribute", async () => {
    expect(await render(<Tabs.Content id='panel-b'>Second</Tabs.Content>)).toBe(
      `<div id="panel-b" role="tabpanel" data-slot="tabs-content" tabindex="0" hidden class="${PANEL_BASE}">Second</div>`,
    );
  });

  it("shows the selected panel and carries the CSS hook instead", async () => {
    expect(
      await render(
        <Tabs.Content id='panel-a' selected>
          First
        </Tabs.Content>,
      ),
    ).toBe(`<div id="panel-a" role="tabpanel" data-slot="tabs-content" tabindex="0" data-selected="" class="${PANEL_BASE}">First</div>`);
  });

  it("merges a caller class, appends an inherited slot token, and escapes children", async () => {
    expect(
      await render(
        <Tabs.Content id='panel-a' selected class='pt-2' data-slot='settings-panel'>
          {`R&D's <view>`}
        </Tabs.Content>,
      ),
    ).toBe(
      '<div id="panel-a" role="tabpanel" data-slot="tabs-content settings-panel" tabindex="0" data-selected="" ' +
        `class="${PANEL_BASE} pt-2">R&amp;D&#39;s &lt;view&gt;</div>`,
    );
  });
});
