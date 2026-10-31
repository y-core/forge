import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { lineAtOffset } from "./source";
import type { MarkdownDocument, MarkdownListItem, MarkdownTask } from "./types";
import { walkMarkdown } from "./walk";

/** The task box on a list item, its line and offset read under the unit starting at `base`, or null for a plain item. @internal */
export function readListItemTask(document: MarkdownDocument, item: MarkdownListItem, base: number): MarkdownTask | null {
  if (item.box === null || item.checked === null) return null;
  const offset = base + item.box;
  return { line: lineAtOffset(document.lineStarts, offset), offset, checked: item.checked };
}

/** Every GFM task box in a document, in source order. */
export function listTasks(document: MarkdownDocument): MarkdownTask[] {
  const tasks: MarkdownTask[] = [];
  walkMarkdown(document, (node, { base }) => {
    const task = node.type === "listItem" ? readListItemTask(document, node, base) : null;
    if (task !== null) tasks.push(task);
    if (node.type === "paragraph" || node.type === "heading" || node.type === "table") return false;
    return undefined;
  });
  return tasks;
}

/** Ticks the boxes on `checkedLines` and unticks every other, writing only the character between a box's brackets; refuses lines holding no box. */
export function setTasks(source: string, document: MarkdownDocument, checkedLines: ReadonlySet<number>): Result<string, readonly number[]> {
  if (source !== document.source) throw new Error("setTasks: `source` is not the source `document` was parsed from.");
  const tasks = listTasks(document);
  const boxLines = new Set(tasks.map((task) => task.line));
  const refused = [...checkedLines].filter((line) => !boxLines.has(line));
  if (refused.length > 0) return err(refused);
  let from = 0;
  let next = "";
  for (const task of tasks) {
    const wanted = checkedLines.has(task.line);
    if (wanted === task.checked) continue;
    next += source.slice(from, task.offset + 1) + (wanted ? "x" : " ");
    from = task.offset + 2;
  }
  return ok(from === 0 ? source : next + source.slice(from));
}
