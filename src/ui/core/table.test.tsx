/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Table } from "./table";

const SCROLL = '<div data-slot="table-scroll" class="overflow-auto rounded-box border-field border-border">';
const BOX = "w-full border-collapse";
const CELLS_SM = "[&amp;_td]:px-3 [&amp;_td]:py-1.5 [&amp;_th]:px-3 [&amp;_th]:py-1.5";
const CELLS_MD = "[&amp;_td]:px-4 [&amp;_td]:py-2 [&amp;_th]:px-4 [&amp;_th]:py-2";
const CELLS_LG = "[&amp;_td]:px-5 [&amp;_td]:py-3 [&amp;_th]:px-5 [&amp;_th]:py-3";
const ROW = "border-b border-border last:border-b-0";
const SUCCESS =
  "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)]";
const SOFT =
  "border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]";

describe("Table", () => {
  it("renders a md table inside the scroll wrapper, stamping its size", async () => {
    expect(
      await render(
        <Table>
          <Table.Body>
            <Table.Row>
              <Table.Cell>a</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>,
      ),
    ).toBe(
      `${SCROLL}<table data-slot="table" data-size="md" class="${BOX} text-sm ${CELLS_MD}">` +
        `<tbody data-slot="table-body"><tr data-slot="table-row" class="${ROW}"><td data-slot="table-cell">a</td></tr></tbody>` +
        `</table></div>`,
    );
  });

  it("renders the sm density", async () => {
    expect(await render(<Table size='sm'>x</Table>)).toBe(
      `${SCROLL}<table data-slot="table" data-size="sm" class="${BOX} text-xs ${CELLS_SM}">x</table></div>`,
    );
  });

  it("renders the lg density with zebra rows and a pinned header", async () => {
    expect(
      await render(
        <Table size='lg' zebra pinRows>
          x
        </Table>,
      ),
    ).toBe(
      `${SCROLL}<table data-slot="table" data-size="lg" class="${BOX} text-base ${CELLS_LG} ` +
        `[&amp;_tbody_tr:nth-child(even)]:bg-muted/40 [&amp;_thead_th]:sticky [&amp;_thead_th]:top-0 [&amp;_thead_th]:bg-background">x</table></div>`,
    );
  });

  it("merges a caller class onto the table and forwards attributes with escaped values", async () => {
    expect(
      await render(
        <Table class='mb-4' id='t1' data-note="a&b's">
          x
        </Table>,
      ),
    ).toBe(
      `${SCROLL}<table data-slot="table" data-size="md" class="${BOX} text-sm ${CELLS_MD} mb-4" id="t1" data-note="a&amp;b&#39;s">x</table></div>`,
    );
  });

  it("composes an inherited data-slot token after its own", async () => {
    expect(await render(<Table data-slot='inherited'>x</Table>)).toBe(
      `${SCROLL}<table data-slot="table inherited" data-size="md" class="${BOX} text-sm ${CELLS_MD}">x</table></div>`,
    );
  });

  it("paints a toned row soft and marks a selected one", async () => {
    expect(
      await render(
        <Table.Row tone='success' selected>
          r
        </Table.Row>,
      ),
    ).toBe(
      `<tr data-slot="table-row" data-tone="success" aria-selected="true" data-selected="" class="border-b last:border-b-0 ${SUCCESS} ` +
        `border-(--tone-soft-border) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] bg-primary-soft">r</tr>`,
    );
  });

  // Tri-state: absent means the table is not selectable at all, which is not the same claim as
  // "selectable, and this row is not selected".
  it("announces an explicitly unselected row, and says nothing on a row that took no `selected`", async () => {
    expect(await render(<Table.Row selected={false}>r</Table.Row>)).toBe(
      '<tr data-slot="table-row" aria-selected="false" class="border-b border-border last:border-b-0">r</tr>',
    );
    expect(await render(<Table.Row>r</Table.Row>)).toBe('<tr data-slot="table-row" class="border-b border-border last:border-b-0">r</tr>');
  });

  it("paints a toned row without the selected background", async () => {
    expect(await render(<Table.Row tone='success'>r</Table.Row>)).toBe(
      `<tr data-slot="table-row" data-tone="success" class="border-b last:border-b-0 ${SUCCESS} ${SOFT}">r</tr>`,
    );
  });

  it("renders the caption, header, head cell, and footer", async () => {
    expect(
      await render(
        <Table>
          <Table.Caption>C</Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.Head>H</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Footer>F</Table.Footer>
        </Table>,
      ),
    ).toBe(
      `${SCROLL}<table data-slot="table" data-size="md" class="${BOX} text-sm ${CELLS_MD}">` +
        `<caption data-slot="table-caption" class="mt-2 caption-bottom text-sm text-muted-foreground">C</caption>` +
        `<thead data-slot="table-header"><tr data-slot="table-row" class="${ROW}">` +
        `<th data-slot="table-head" class="text-start font-medium text-muted-foreground">H</th></tr></thead>` +
        `<tfoot data-slot="table-footer">F</tfoot></table></div>`,
    );
  });

  it("merges a caller class onto a cell and a head cell", async () => {
    expect(
      await render(
        <Table.Row>
          <Table.Head class='w-8'>H</Table.Head>
          <Table.Cell class='text-end'>a</Table.Cell>
        </Table.Row>,
      ),
    ).toBe(
      `<tr data-slot="table-row" class="${ROW}">` +
        `<th data-slot="table-head" class="text-start font-medium text-muted-foreground w-8">H</th>` +
        `<td data-slot="table-cell" class="text-end">a</td></tr>`,
    );
  });
});
