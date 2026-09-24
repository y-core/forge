import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Tabs } from "./tabs";

const textOf = (html: string) => html.replaceAll(/<[^>]*>/g, "");
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]);

describe("Tabs", () => {
  it("renders the whole root exactly, with spread data-* and aria-* values escaped", async () => {
    expect(await render(<Tabs data-note={`R&D's "views" <all>`} aria-label={`R&D's views`} />)).toBe(
      '<div data-slot="tabs" data-scope="tabs" data-activation="automatic" data-orientation="horizontal" class="flex flex-col gap-3" ' +
        'data-note="R&amp;D&#39;s &quot;views&quot; &lt;all&gt;" aria-label="R&amp;D&#39;s views"></div>',
    );
  });

  it("carries the scope, the activation mode and the axis the controller resumes on", async () => {
    expect(attrsOf(await render(<Tabs />))).toEqual({
      "data-slot": "tabs",
      "data-scope": "tabs",
      "data-activation": "automatic",
      "data-orientation": "horizontal",
    });
  });

  it("stacks a vertical root along the other axis rather than laying a second one across it", async () => {
    const vertical = await render(<Tabs orientation='vertical' />);

    expect(attrOf(vertical, "data-orientation")).toBe("vertical");
    expect(variantClasses(vertical, await render(<Tabs />))).toEqual({ added: ["flex-row", "gap-4"], dropped: ["flex-col", "gap-3"] });
  });

  it("carries manual activation through to the attribute the controller reads", async () => {
    expect(attrOf(await render(<Tabs activation='manual' />), "data-activation")).toBe("manual");
  });

  it("appends a caller class after its own and keeps its slot token ahead of an inherited one", async () => {
    const html = await render(<Tabs class='w-full' data-slot='settings-tabs' />);

    expect(classesOf(html).at(-1)).toBe("w-full");
    expect(attrOf(html, "data-slot")).toBe("tabs settings-tabs");
  });

  it("renders list, tabs and panels as one tree, with only the unselected panel hidden", async () => {
    const html = await render(
      <Tabs>
        <Tabs.List label='Views'>
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
    );

    expect(slotsOf(html)).toEqual(["tabs", "tabs-list", "tab", "tab", "tabs-content", "tabs-content"]);
    expect([attrsOf(html, 'id="panel-a"'), attrsOf(html, 'id="panel-b"')]).toEqual([
      { id: "panel-a", role: "tabpanel", "data-slot": "tabs-content", tabindex: "0", "aria-labelledby": "panel-a-tab", "data-selected": "" },
      { id: "panel-b", role: "tabpanel", "data-slot": "tabs-content", tabindex: "0", "aria-labelledby": "panel-b-tab", hidden: "" },
    ]);
  });
});

describe("Tabs.List", () => {
  // APG asks a tablist for a name, and a page with two tab sets gives a reader nothing to tell them
  // apart without one — so it is required rather than forwarded if the caller remembers it.
  it("cannot be rendered unnamed", () => {
    // @ts-expect-error — one of `label` or `labelledby` is required.
    const unnamed = <Tabs.List />;
    void unnamed;
  });

  it("announces its axis to a screen reader as well as to the controller", async () => {
    expect(attrsOf(await render(<Tabs.List label='Views' />))).toEqual({
      role: "tablist",
      "aria-label": "Views",
      "data-slot": "tabs-list",
      "aria-orientation": "horizontal",
      "data-orientation": "horizontal",
    });
  });

  it("turns the rule down the side for a vertical strip instead of under it", async () => {
    const vertical = await render(<Tabs.List label='Views' orientation='vertical' />);

    expect(attrsOf(vertical)).toEqual({
      role: "tablist",
      "aria-label": "Views",
      "data-slot": "tabs-list",
      "aria-orientation": "vertical",
      "data-orientation": "vertical",
    });
    expect(variantClasses(vertical, await render(<Tabs.List label='Views' />))).toEqual({
      added: ["flex-col", "border-e", "pe-2"],
      dropped: ["border-b", "pb-1"],
    });
  });

  it("appends a caller class after its own and keeps its slot token ahead of an inherited one", async () => {
    const html = await render(<Tabs.List label='Views' class='px-2' data-slot='settings-tablist' />);

    expect(classesOf(html).at(-1)).toBe("px-2");
    expect(attrOf(html, "data-slot")).toBe("tabs-list settings-tablist");
  });
});

describe("Tabs.Tab", () => {
  it("wires an unselected tab to the panel it controls and to the fragment that reveals it", async () => {
    expect(attrsOf(await render(<Tabs.Tab for='panel-a'>A</Tabs.Tab>))).toEqual({
      href: "#panel-a",
      role: "tab",
      "data-slot": "tab",
      "aria-selected": "false",
      "aria-controls": "panel-a",
      id: "panel-a-tab",
    });
  });

  it("stamps aria-selected, data-selected and the composite marker together when selected", async () => {
    expect(
      attrsOf(
        await render(
          <Tabs.Tab for='panel-a' selected>
            A
          </Tabs.Tab>,
        ),
      ),
    ).toEqual({
      href: "#panel-a",
      role: "tab",
      "data-slot": "tab",
      "aria-selected": "true",
      "aria-controls": "panel-a",
      id: "panel-a-tab",
      "data-selected": "",
      "data-composite-item-active": "",
    });
  });

  it("renders no href on a disabled tab, so the :target fallback cannot reveal its panel", async () => {
    const html = await render(
      <Tabs.Tab for='panel-c' class='grow' disabled>
        C
      </Tabs.Tab>,
    );

    expect(attrsOf(html)).toEqual({
      role: "tab",
      "data-slot": "tab",
      "aria-selected": "false",
      "aria-controls": "panel-c",
      id: "panel-c-tab",
      "aria-disabled": "true",
      "data-disabled": "",
    });
    expect(classesOf(html).at(-1)).toBe("grow");
  });

  // A panel is a Tab stop in its own right, so an unnamed one is announced as "tab panel" and nothing
  // else — the pairing runs both ways off the single id the caller wrote.
  it("names the panel it controls, and keeps the derived id when a caller supplies one of their own", async () => {
    const html = await render(
      <Tabs>
        <Tabs.List label='Views'>
          <Tabs.Tab for='panel-a' id='mine' selected>
            A
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Content id='panel-a' selected>
          First
        </Tabs.Content>
      </Tabs>,
    );

    expect(attrOf(html, "id", 'role="tab"')).toBe("panel-a-tab");
    expect(attrOf(html, "aria-labelledby", 'role="tabpanel"')).toBe("panel-a-tab");
  });

  it("keeps its own slot token ahead of an inherited one and escapes its children", async () => {
    const html = await render(<Tabs.Tab for='panel-a' data-slot='settings-tab'>{`R&D's <view>`}</Tabs.Tab>);

    expect(attrOf(html, "data-slot")).toBe("tab settings-tab");
    expect(textOf(html)).toBe("R&amp;D&#39;s &lt;view&gt;");
  });
});

describe("Tabs.Content", () => {
  it("hides an unselected panel with the platform's own attribute", async () => {
    expect(attrsOf(await render(<Tabs.Content id='panel-b'>Second</Tabs.Content>))).toEqual({
      id: "panel-b",
      role: "tabpanel",
      "data-slot": "tabs-content",
      tabindex: "0",
      "aria-labelledby": "panel-b-tab",
      hidden: "",
    });
  });

  it("shows the selected panel and carries the CSS hook instead", async () => {
    expect(
      attrsOf(
        await render(
          <Tabs.Content id='panel-a' selected>
            First
          </Tabs.Content>,
        ),
      ),
    ).toEqual({
      id: "panel-a",
      role: "tabpanel",
      "data-slot": "tabs-content",
      tabindex: "0",
      "aria-labelledby": "panel-a-tab",
      "data-selected": "",
    });
  });

  it("appends a caller class, keeps its slot token ahead of an inherited one, and escapes children", async () => {
    const html = await render(
      <Tabs.Content id='panel-a' selected class='pt-2' data-slot='settings-panel'>
        {`R&D's <view>`}
      </Tabs.Content>,
    );

    expect(classesOf(html).at(-1)).toBe("pt-2");
    expect(attrOf(html, "data-slot")).toBe("tabs-content settings-panel");
    expect(textOf(html)).toBe("R&amp;D&#39;s &lt;view&gt;");
  });
});
