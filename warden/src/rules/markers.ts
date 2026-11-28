import { readFileSync } from "node:fs";

import { findRuleMarkers, findSplitRuleMarkers } from "../../../src/tooling/gate/checks/design-parse";
import { parseSections, stripFences } from "../checks/docs";
import { repoRelative } from "../corpus/source";
import type { SourceDoc } from "../types";
import type { RuleMarkerScan, RuleMarkerSite, SplitRuleMarker } from "./types";

const CODE_SPAN = /(`+).+?\1/g;

const ANY_MARKER = /<!--\s*rule:\s*[^\s>]*?\s*-->/g;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

const BLOCK_BOUNDARY = /^\s*(?:#{1,6}\s|-{3,}\s*$|\*{3,}\s*$)/;

/** `lines` with each inline code span overwritten by `fill`, column for column. */
function blankCodeSpans(lines: readonly string[], fill: string): string[] {
  return lines.map((line) => line.replace(CODE_SPAN, (span) => fill.repeat(span.length)));
}

/** A document's lines with fenced, indented and inline code blanked, so a quoted marker is never read as one. @internal */
export function proseLines(source: string): string[] {
  return blankCodeSpans(stripFences(source), " ");
}

function opensBlock(lines: readonly string[], index: number, column: number): boolean {
  const line = lines[index] ?? "";
  const before = line.slice(0, column).replace(ANY_MARKER, "");
  if (line.trimStart().startsWith("|")) return before.slice(before.lastIndexOf("|") + 1).trim() === "";
  const item = LIST_ITEM.exec(before);
  if ((item === null ? before : before.slice(item[0].length)).trim() !== "") return false;
  if (item !== null) return true;
  const previous = lines[index - 1];
  return previous === undefined || previous.trim() === "" || BLOCK_BOUNDARY.test(previous);
}

function blockAfter(unfenced: readonly string[], judged: readonly string[], index: number, column: number): string {
  const line = judged[index] ?? "";
  const markerEnd = line.indexOf("-->", column) + 3;
  const inTable = line.trimStart().startsWith("|");
  const cellEnd = inTable ? line.indexOf("|", markerEnd) : -1;
  const parts = [(unfenced[index] ?? "").slice(markerEnd, cellEnd === -1 ? undefined : cellEnd)];
  for (let next = index + 1; !inTable && next < unfenced.length; next++) {
    const following = judged[next] ?? "";
    if (following.trim() === "" || BLOCK_BOUNDARY.test(following) || LIST_ITEM.test(following)) break;
    parts.push(unfenced[next] ?? "");
  }
  return parts.join(" ").replace(ANY_MARKER, "").replaceAll("`", "").replace(/\s+/g, " ").trim();
}

function columnOf(line: string, id: string, from: number): number {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<!--\\s*rule:\\s*${escaped}\\s*-->`, "g");
  match.lastIndex = from;
  return match.exec(line)?.index ?? from;
}

/** Every rule marker outside code in `docs`, each with its numbered section and whether it opens its block. @public */
export function collectMarkers(root: string, docs: readonly SourceDoc[]): RuleMarkerScan {
  const sites: RuleMarkerSite[] = [];
  const split: SplitRuleMarker[] = [];
  for (const doc of docs) {
    const file = repoRelative(root, doc.file);
    const unfenced = stripFences(readFileSync(doc.file, "utf-8"));
    const lines = blankCodeSpans(unfenced, " ");
    const judged = blankCodeSpans(unfenced, "x");
    const prose = lines.join("\n");
    const { sections } = parseSections(file, lines);
    for (const marker of findSplitRuleMarkers(prose)) split.push({ ...marker, file });

    const cursor = new Map<number, number>();
    for (const { line, id } of findRuleMarkers(prose)) {
      const text = lines[line - 1] ?? "";
      const column = columnOf(text, id, cursor.get(line) ?? 0);
      cursor.set(line, column + 1);
      const section = sections.findLast((candidate) => candidate.line < line)?.number;
      sites.push({
        id,
        corpus: doc.corpus === "canon" ? "canon" : "project",
        ...(doc.tree === undefined ? {} : { tree: doc.tree }),
        path: doc.path,
        file,
        line,
        section,
        opensBlock: opensBlock(judged, line - 1, column),
        block: blockAfter(unfenced, judged, line - 1, column),
      });
    }
  }
  return { sites, split };
}
