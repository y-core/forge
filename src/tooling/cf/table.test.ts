import { describe, expect, it } from "bun:test";

import { renderSections, renderTable } from "./table";

describe("renderTable()", () => {
  it("returns empty string for empty rows", () => {
    expect(renderTable([])).toBe("");
  });

  it("closes the grid on all four sides and rules off the headings", () => {
    expect(renderTable([{ Type: "kv", Binding: "MY_KV" }]).split("\n")).toEqual([
      "┌──────┬─────────┐",
      "│ Type │ Binding │",
      "├──────┼─────────┤",
      "│ kv   │ MY_KV   │",
      "└──────┴─────────┘",
    ]);
  });

  it("pads columns to the widest value, so the closing verticals line up", () => {
    const out = renderTable([
      { Col: "short", Val: "x" },
      { Col: "a-much-longer-value", Val: "y" },
    ]);
    const lines = out.split("\n");
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("renders all data rows", () => {
    const out = renderTable([
      { Type: "kv", Binding: "KV1", Action: "in sync" },
      { Type: "d1", Binding: "DB1", Action: "created" },
    ]);
    expect(out).toContain("KV1");
    expect(out).toContain("DB1");
  });

  it("uses key order from first row for column order", () => {
    expect(renderTable([{ Z: "z", A: "a" }]).split("\n")[1]).toBe("│ Z │ A │");
  });

  it("drops a column that is empty in every row", () => {
    expect(renderTable([{ Binding: "KV", "Remote ID": "" }]).split("\n")[1]).toBe("│ Binding │");
  });

  it("keeps a cell containing spaces legible, which is why the verticals are there", () => {
    const lines = renderTable([{ Action: "deploy pushes", Detail: "not verified — no read API" }]).split("\n");
    expect(lines[3]).toBe("│ deploy pushes │ not verified — no read API │");
  });
});

describe("renderSections()", () => {
  const rows = [{ Binding: "BASE_URL", Action: "deploy pushes" }];

  it("prints the title alone when there is no note", () => {
    expect(renderSections([{ title: "Local Only", rows }]).split("\n")[0]).toBe("Local Only");
  });

  it("prints the note on its own line under the title, indented to the grid", () => {
    // Two lines, because they answer different questions: which section this is, and what rule
    // governs every row in it. Run together the title stopped being findable.
    const out = renderSections([{ title: "Rotated by --commit", note: "the local value is never sent", rows }]);
    expect(out.split("\n").slice(0, 2)).toEqual(["Rotated by --commit", "  the local value is never sent"]);
  });

  it("indents the bordered grid two spaces under the heading", () => {
    expect(renderSections([{ title: "Local Only", rows }]).split("\n")).toEqual([
      "Local Only",
      "  ┌──────────┬───────────────┐",
      "  │ Binding  │ Action        │",
      "  ├──────────┼───────────────┤",
      "  │ BASE_URL │ deploy pushes │",
      "  └──────────┴───────────────┘",
    ]);
  });

  it("separates two sections with a blank line", () => {
    const out = renderSections([
      { title: "One", rows: [{ Binding: "A" }] },
      { title: "Two", rows: [{ Binding: "B" }] },
    ]);
    expect(out.split("\n")).toEqual([
      "One",
      "  ┌─────────┐",
      "  │ Binding │",
      "  ├─────────┤",
      "  │ A       │",
      "  └─────────┘",
      "",
      "Two",
      "  ┌─────────┐",
      "  │ Binding │",
      "  ├─────────┤",
      "  │ B       │",
      "  └─────────┘",
    ]);
  });

  it("omits a section with no rows, and its blank line with it", () => {
    const out = renderSections([
      { title: "One", rows: [{ Binding: "A" }] },
      { title: "Empty", rows: [] },
      { title: "Two", rows: [{ Binding: "B" }] },
    ]);
    expect(out).not.toContain("Empty");
    expect(out.split("\n").filter((l) => l === "")).toHaveLength(1);
  });

  it("computes widths per section, so one does not stretch another", () => {
    // A long value in the second section must not pad out the first — the sections
    // are separate answers, not one table with headings interleaved.
    const out = renderSections([
      { title: "Short", rows: [{ Binding: "A" }] },
      { title: "Long", rows: [{ Binding: "A-VERY-LONG-BINDING-NAME" }] },
    ]);
    const lines = out.split("\n");
    expect(lines[4]).toBe("  │ A       │");
    expect(lines[11]).toBe("  │ A-VERY-LONG-BINDING-NAME │");
  });

  it("drops a column empty across one section while keeping it in another", () => {
    const out = renderSections([
      { title: "One", rows: [{ Binding: "A", "Remote ID": "" }] },
      { title: "Two", rows: [{ Binding: "B", "Remote ID": "id-2" }] },
    ]);
    expect(out).toContain("  │ Binding │\n  ├─────────┤\n  │ A       │");
    expect(out).toContain("  │ Binding │ Remote ID │");
  });

  it("returns an empty string when every section is empty", () => {
    expect(renderSections([{ title: "One", rows: [] }])).toBe("");
  });

  it("prints footers under the grid", () => {
    const out = renderSections([{ title: "Secrets", rows: [{ Binding: "A" }], footers: ["No .dev.vars at /tmp/.dev.vars."] }]);
    expect(out.split("\n").at(-1)).toBe("  No .dev.vars at /tmp/.dev.vars.");
  });

  it("prints a section that has only a footer", () => {
    // "We looked and found nothing" is the one thing an omitted section cannot say.
    expect(renderSections([{ title: "Secrets", rows: [], footers: ["No .dev.vars here."] }]).split("\n")).toEqual([
      "Secrets",
      "  No .dev.vars here.",
    ]);
  });

  it("still omits a section with neither rows nor footers", () => {
    expect(renderSections([{ title: "One", rows: [], footers: [] }])).toBe("");
  });
});
