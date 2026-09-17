import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Collapsible } from "./collapsible";
import { attrOf, attrsOf, classesOf, tagOf } from "./core.fixture";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg");
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1]);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Collapsible", () => {
  it("renders the whole disclosure exactly, with arbitrary data-* and aria-* values escaped", async () => {
    expect(await render(<Collapsible data-note={`R&D's "advanced" <opts>`} aria-label={`R&D's options`} />)).toBe(
      '<details data-slot="collapsible" class="group/collapsible-item" data-note="R&amp;D&#39;s &quot;advanced&quot; &lt;opts&gt;" aria-label="R&amp;D&#39;s options"></details>',
    );
  });

  it("stays closed unless it was told to open, carrying nothing but its slot", async () => {
    expect(attrsOf(await render(<Collapsible />))).toEqual({ "data-slot": "collapsible" });
  });

  it("stamps the platform `open` attribute, which is what actually holds it open", async () => {
    expect(attrsOf(await render(<Collapsible open />))).toEqual({ "data-slot": "collapsible", open: "" });
  });

  it("treats an explicit open={false} exactly as the default", async () => {
    expect(await render(<Collapsible open={false} />)).toBe(await render(<Collapsible />));
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Collapsible class='rounded-md border' />)).slice(-2)).toEqual(["rounded-md", "border"]);
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Collapsible data-slot='filters' />), "data-slot")).toBe("collapsible filters");
  });

  it("nests the trigger and the panel as siblings of the one details element", async () => {
    const html = await render(
      <Collapsible open>
        <Collapsible.Trigger icon={icon}>Advanced</Collapsible.Trigger>
        <Collapsible.Content>Nothing here yet.</Collapsible.Content>
      </Collapsible>,
    );

    expect(slotsOf(html)).toEqual(["collapsible", "collapsible-trigger", "icon", "collapsible-content"]);
    expect(textNodes(html)).toEqual(["Advanced", "Nothing here yet."]);
  });
});

describe("Collapsible.Trigger", () => {
  it("renders a summary, which is what makes the disclosure work without script", async () => {
    const html = await render(<Collapsible.Trigger icon={icon}>Advanced</Collapsible.Trigger>);

    expect(tagOf(html).startsWith("<summary ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "collapsible-trigger" });
  });

  it("puts the chevron after the label rather than before it", async () => {
    const html = await render(<Collapsible.Trigger icon={icon}>Advanced</Collapsible.Trigger>);

    expect(slotsOf(html)).toEqual(["collapsible-trigger", "icon"]);
    expect(textNodes(html)).toEqual(["Advanced"]);
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    const html = await render(
      <Collapsible.Trigger icon={icon} class='justify-between' data-slot='filters-trigger'>
        Advanced
      </Collapsible.Trigger>,
    );

    expect(attrOf(html, "data-slot")).toBe("collapsible-trigger filters-trigger");
    expect(classesOf(html).at(-1)).toBe("justify-between");
  });

  it("accepts a sheet narrowed to the glyphs it renders, uncast", async () => {
    const narrowIcon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 24 24", "icon-plus": "0 0 24 24" });

    expect(await render(<Collapsible.Trigger icon={narrowIcon}>Advanced</Collapsible.Trigger>)).toBe(
      await render(<Collapsible.Trigger icon={icon}>Advanced</Collapsible.Trigger>),
    );
  });

  it("escapes the label without disturbing the chevron beside it", async () => {
    const html = await render(<Collapsible.Trigger icon={icon}>{`R&D's <options>`}</Collapsible.Trigger>);

    expect(textNodes(html)).toEqual(["R&amp;D&#39;s &lt;options&gt;"]);
    expect(slotsOf(html)).toEqual(["collapsible-trigger", "icon"]);
  });
});

describe("Collapsible.Content", () => {
  it("renders the panel as a plain div carrying only its slot", async () => {
    const html = await render(<Collapsible.Content>Nothing here yet.</Collapsible.Content>);

    expect(tagOf(html).startsWith("<div ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "collapsible-content" });
  });

  it("merges a caller class, appends an inherited slot token, and escapes children", async () => {
    const html = await render(
      <Collapsible.Content class='pt-1' data-slot='filters-panel'>
        {`R&D's <options>`}
      </Collapsible.Content>,
    );

    expect(attrOf(html, "data-slot")).toBe("collapsible-content filters-panel");
    expect(classesOf(html).at(-1)).toBe("pt-1");
    expect(textNodes(html)).toEqual(["R&amp;D&#39;s &lt;options&gt;"]);
  });
});
