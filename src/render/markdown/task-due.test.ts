import { describe, expect, it } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import { shapeOf } from "./tree.fixture";
import type { Shaped } from "./tree.fixture";

function firstItem(md: string): Shaped {
  const [list] = shapeOf(parseDialect(md)).children;
  if (list?.type !== "list") throw new Error(`expected a list, got ${list?.type}`);
  const [item] = list.children ?? [];
  if (!item) throw new Error("expected a list item");
  return item;
}

function itemText(item: Shaped): readonly Shaped[] {
  const [first] = item.children ?? [];
  if (first?.type !== "paragraph") throw new Error(`expected a paragraph, got ${first?.type}`);
  return first.children ?? [];
}

function taskText(md: string): readonly Shaped[] {
  return itemText(firstItem(md));
}

describe("task due dates", () => {
  it("parses due:YYYY-MM-DD in a task", () => {
    expect(taskText("- [ ] a due:2026-10-01")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
    ]);
  });

  it("parses 📅 YYYY-MM-DD in a task", () => {
    expect(taskText("- [ ] a 📅 2026-10-01")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
    ]);
  });

  it("parses 📅YYYY-MM-DD with no space in a task", () => {
    expect(taskText("- [ ] a 📅2026-10-01")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
    ]);
  });

  it("parses a due date in a done task", () => {
    expect(taskText("- [x] a due:2026-10-01")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
    ]);
  });

  it("parses a due date in an ordered task", () => {
    expect(taskText("1. [ ] a due:2026-10-01")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
    ]);
  });

  it("parses a leap day", () => {
    expect(taskText("- [ ] a due:2024-02-29")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2024-02-29" },
    ]);
  });

  it("ends a due date before sentence punctuation", () => {
    expect(taskText("- [ ] a due:2026-10-01.")).toEqual([
      { type: "text", value: "a " },
      { type: "taskDue", date: "2026-10-01" },
      { type: "text", value: "." },
    ]);
  });

  it("keeps the parent's due date and gives a nested task its own", () => {
    const parent = firstItem("- [ ] p due:2026-10-01\n  - [ ] c due:2026-11-01");
    const nested = parent.children?.[1];
    const [child] = nested?.children ?? [];
    if (!child) throw new Error("expected a nested task");
    expect([itemText(parent), itemText(child)]).toEqual([
      [
        { type: "text", value: "p " },
        { type: "taskDue", date: "2026-10-01" },
      ],
      [
        { type: "text", value: "c " },
        { type: "taskDue", date: "2026-11-01" },
      ],
    ]);
  });

  it("gives a nested task its due date under a plain list item", () => {
    const parent = firstItem("- a\n  - [ ] c due:2026-11-01");
    const nested = parent.children?.[1];
    const [child] = nested?.children ?? [];
    if (!child) throw new Error("expected a nested task");
    expect(itemText(child)).toEqual([
      { type: "text", value: "c " },
      { type: "taskDue", date: "2026-11-01" },
    ]);
  });
});

describe("task due dates — not due dates", () => {
  it("keeps overdue:… as text", () => {
    expect(taskText("- [ ] a overdue:2026-10-01")).toEqual([{ type: "text", value: "a overdue:2026-10-01" }]);
  });

  it("keeps a date running into another digit as text", () => {
    expect(taskText("- [ ] a due:2026-10-011")).toEqual([{ type: "text", value: "a due:2026-10-011" }]);
  });

  it("keeps a two-digit year as text", () => {
    expect(taskText("- [ ] a due:26-10-01")).toEqual([{ type: "text", value: "a due:26-10-01" }]);
  });

  it("keeps a month past 12 as text", () => {
    expect(taskText("- [ ] a due:2026-13-01")).toEqual([{ type: "text", value: "a due:2026-13-01" }]);
  });

  it("keeps 29 February outside a leap year as text", () => {
    expect(taskText("- [ ] a due:2025-02-29")).toEqual([{ type: "text", value: "a due:2025-02-29" }]);
  });

  it("keeps due: followed by a space as text", () => {
    expect(taskText("- [ ] a due: 2026-10-01")).toEqual([{ type: "text", value: "a due: 2026-10-01" }]);
  });

  it("keeps 📅 followed by two spaces as text", () => {
    expect(taskText("- [ ] a 📅  2026-10-01")).toEqual([{ type: "text", value: "a 📅  2026-10-01" }]);
  });

  it("keeps an uppercase DUE: as text", () => {
    expect(taskText("- [ ] a DUE:2026-10-01")).toEqual([{ type: "text", value: "a DUE:2026-10-01" }]);
  });

  it("keeps a due date in a callout title as text", () => {
    const [callout] = shapeOf(parseDialect("> [!note] Ship due:2026-10-01\n> body\n")).children;
    expect(callout?.title).toEqual([{ type: "text", value: "Ship due:2026-10-01" }]);
  });

  it("keeps a due date in a task's second paragraph as text", () => {
    const item = firstItem("- [ ] a\n\n  b due:2026-10-01");
    expect(item.children).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "a" }] },
      { type: "paragraph", children: [{ type: "text", value: "b due:2026-10-01" }] },
    ]);
  });
});
