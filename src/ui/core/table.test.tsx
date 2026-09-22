/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Table } from "./table";

const TABLE = 'data-slot="table"';

const slottedTags = (html: string): string[] => [...html.matchAll(/<([a-z]+) data-slot="([^"]+)"/g)].map((match) => `${match[1]}:${match[2]}`);

describe("Table", () => {
  it("renders the whole scrolled table exactly, caller class merged last and forwarded values escaped", async () => {
    expect(
      await render(
        <Table label='Projects' class='mb-4' id='t1' data-note="a&b's">
          x
        </Table>,
      ),
    ).toBe(
      '<section data-slot="table-scroll" aria-label="Projects" tabindex="0" class="overflow-auto rounded-box border-field border-border focus-ring">' +
        '<table data-slot="table" data-size="md" class="w-full border-collapse text-sm [&amp;_td]:px-4 [&amp;_td]:py-2 [&amp;_th]:px-4 [&amp;_th]:py-2 mb-4"' +
        ' id="t1" data-note="a&amp;b&#39;s">x</table></section>',
    );
  });

  it("puts the table inside a scroll wrapper, so a wide table scrolls without the page doing so", async () => {
    const html = await render(
      <Table label='Projects'>
        <Table.Body>
          <Table.Row>
            <Table.Cell>a</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(slottedTags(html)).toEqual(["section:table-scroll", "table:table", "tbody:table-body", "tr:table-row", "td:table-cell"]);
    expect(attrsOf(html, TABLE)).toEqual({ "data-slot": "table", "data-size": "md" });
  });

  it("leaves a cell bare, because the density it wears is written on the table above it", async () => {
    const html = await render(<Table.Cell>a</Table.Cell>);

    expect(attrsOf(html)).toEqual({ "data-slot": "table-cell" });
    expect(classesOf(html)).toEqual([]);
  });

  it("tightens the cell gutters and drops a type step at the sm density", async () => {
    const html = await render(
      <Table label='Projects' size='sm'>
        x
      </Table>,
    );

    expect(attrOf(html, "data-size", TABLE)).toBe("sm");
    expect(variantClasses(html, await render(<Table label='Projects'>x</Table>), TABLE)).toEqual({
      added: ["text-xs", "[&amp;_td]:px-3", "[&amp;_td]:py-1.5", "[&amp;_th]:px-3", "[&amp;_th]:py-1.5"],
      dropped: ["text-sm", "[&amp;_td]:px-4", "[&amp;_td]:py-2", "[&amp;_th]:px-4", "[&amp;_th]:py-2"],
    });
  });

  it("opens the cell gutters and adds a type step at the lg density", async () => {
    const html = await render(
      <Table label='Projects' size='lg'>
        x
      </Table>,
    );

    expect(attrOf(html, "data-size", TABLE)).toBe("lg");
    expect(variantClasses(html, await render(<Table label='Projects'>x</Table>), TABLE)).toEqual({
      added: ["text-base", "[&amp;_td]:px-5", "[&amp;_td]:py-3", "[&amp;_th]:px-5", "[&amp;_th]:py-3"],
      dropped: ["text-sm", "[&amp;_td]:px-4", "[&amp;_td]:py-2", "[&amp;_th]:px-4", "[&amp;_th]:py-2"],
    });
  });

  it("writes zebra striping and a pinned header as descendant rules on the table, which is the only place SSR can", async () => {
    expect(
      variantClasses(
        await render(
          <Table label='Projects' zebra pinRows>
            x
          </Table>,
        ),
        await render(<Table label='Projects'>x</Table>),
        TABLE,
      ),
    ).toEqual({
      added: [
        "[&amp;_tbody_tr:nth-child(even)]:bg-muted/40",
        "[&amp;_thead_th]:sticky",
        "[&amp;_thead_th]:top-0",
        "[&amp;_thead_th]:bg-background",
      ],
      dropped: [],
    });
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(
      attrOf(
        await render(
          <Table label='Projects' data-slot='inherited'>
            x
          </Table>,
        ),
        "data-slot",
        'data-size="md"',
      ),
    ).toBe("table inherited");
  });
});

describe("Table.Row", () => {
  // `aria-selected` is meaningful inside a `grid`, and a `<tr>` in a plain `<table>` is a `row` in a
  // `table` — no selection model to report it to, so the attribute painted and announced nothing.
  it("paints a selected row without claiming a selection a plain table cannot report", async () => {
    const selected = attrsOf(await render(<Table.Row selected>r</Table.Row>));

    expect(selected).toEqual({ "data-slot": "table-row", "data-selected": "" });
    expect(attrsOf(await render(<Table.Row selected={false}>r</Table.Row>))).toEqual({ "data-slot": "table-row" });
    expect(attrsOf(await render(<Table.Row>r</Table.Row>))).toEqual({ "data-slot": "table-row" });
  });

  it("tints a selected row, which is the whole of what the state does", async () => {
    const html = await render(<Table.Row selected>r</Table.Row>);

    expect(variantClasses(html, await render(<Table.Row>r</Table.Row>))).toEqual({ added: ["bg-primary-soft"], dropped: [] });
  });

  it("paints a toned row in that tone's soft palette and names the tone on the attribute", async () => {
    const html = await render(<Table.Row tone='success'>r</Table.Row>);

    expect(attrOf(html, "data-tone")).toBe("success");
    expect(variantClasses(html, await render(<Table.Row>r</Table.Row>))).toEqual({
      added: [
        "[--tone:var(--color-success)]",
        "[--tone-fg:var(--color-success-foreground)]",
        "[--tone-text:var(--color-success-text)]",
        "[--tone-soft:var(--color-status-success-subtle)]",
        "[--tone-soft-fg:var(--color-status-success-subtle-foreground)]",
        "[--tone-soft-border:var(--color-status-success-border)]",
        "border-(--tone-soft-border)",
        "bg-(--tone-soft)",
        "text-(--tone-soft-fg)",
        "[--focus-ring:var(--color-ring)]",
        "hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]",
      ],
      dropped: ["border-border"],
    });
  });

  it("lets the selected tint beat the tone's own fill on a row that is both", async () => {
    const html = await render(
      <Table.Row tone='success' selected>
        r
      </Table.Row>,
    );

    expect(variantClasses(html, await render(<Table.Row tone='success'>r</Table.Row>))).toEqual({
      added: ["bg-primary-soft"],
      dropped: ["bg-(--tone-soft)"],
    });
  });
});

describe("Table sections", () => {
  it("renders each section on the semantic element a reader without CSS still gets a table from", async () => {
    const html = await render(
      <Table label='Projects'>
        <Table.Caption>C</Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.Head>H</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Footer>F</Table.Footer>
      </Table>,
    );

    expect(slottedTags(html)).toEqual([
      "section:table-scroll",
      "table:table",
      "caption:table-caption",
      "thead:table-header",
      "tr:table-row",
      "th:table-head",
      "tfoot:table-footer",
    ]);
  });

  it("appends a caller class after a head cell's own, and gives a plain cell nothing but the caller's", async () => {
    const html = await render(
      <Table.Row>
        <Table.Head class='w-8'>H</Table.Head>
        <Table.Cell class='text-end'>a</Table.Cell>
      </Table.Row>,
    );

    expect(classesOf(html, 'data-slot="table-head"').at(-1)).toBe("w-8");
    expect(classesOf(html, 'data-slot="table-cell"')).toEqual(["text-end"]);
  });
});
