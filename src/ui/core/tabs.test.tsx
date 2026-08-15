import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Tabs } from "./tabs";

const TAB_BASE =
  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground bg-transparent border-0 cursor-pointer outline-none no-underline " +
  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-selected:bg-accent aria-selected:text-accent-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50";

const PANEL_BASE = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

describe("Tabs", () => {
  it("defaults to a horizontal, automatically-activated root carrying the scope", async () => {
    expect(await render(<Tabs />)).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="automatic" data-orientation="horizontal" class="flex flex-col gap-3"></div>',
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
          <Tabs.Panel id='panel-a' selected>
            First
          </Tabs.Panel>
          <Tabs.Panel id='panel-b'>Second</Tabs.Panel>
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
        `<div id="panel-a" role="tabpanel" data-slot="tabs-panel" tabindex="0" data-selected="" class="${PANEL_BASE}">First</div>` +
        `<div id="panel-b" role="tabpanel" data-slot="tabs-panel" tabindex="0" hidden class="${PANEL_BASE}">Second</div>` +
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

  it("passes disabled through and merges a caller class", async () => {
    expect(
      await render(
        <Tabs.Tab for='panel-c' class='grow' disabled>
          C
        </Tabs.Tab>,
      ),
    ).toBe(
      '<a href="#panel-c" role="tab" data-slot="tab" aria-selected="false" aria-controls="panel-c" ' +
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

describe("Tabs.Panel", () => {
  it("hides an unselected panel with the platform's own attribute", async () => {
    expect(await render(<Tabs.Panel id='panel-b'>Second</Tabs.Panel>)).toBe(
      `<div id="panel-b" role="tabpanel" data-slot="tabs-panel" tabindex="0" hidden class="${PANEL_BASE}">Second</div>`,
    );
  });

  it("shows the selected panel and carries the CSS hook instead", async () => {
    expect(
      await render(
        <Tabs.Panel id='panel-a' selected>
          First
        </Tabs.Panel>,
      ),
    ).toBe(`<div id="panel-a" role="tabpanel" data-slot="tabs-panel" tabindex="0" data-selected="" class="${PANEL_BASE}">First</div>`);
  });

  it("merges a caller class, appends an inherited slot token, and escapes children", async () => {
    expect(
      await render(
        <Tabs.Panel id='panel-a' selected class='pt-2' data-slot='settings-panel'>
          {`R&D's <view>`}
        </Tabs.Panel>,
      ),
    ).toBe(
      '<div id="panel-a" role="tabpanel" data-slot="tabs-panel settings-panel" tabindex="0" data-selected="" ' +
        `class="${PANEL_BASE} pt-2">R&amp;D&#39;s &lt;view&gt;</div>`,
    );
  });
});
