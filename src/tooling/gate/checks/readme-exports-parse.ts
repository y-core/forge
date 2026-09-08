/** One subpath section of a README, located by the `> Import path:` line that opens it. */
export interface ImportPathAnchor {
  /** The exports-map key form of the subpath — e.g. `./ui/controls`. */
  subpath: string;
  /** The barrel the anchor points at, repo-relative as written — e.g. `src/ui/controls/mod.ts`. */
  barrel: string;
  /** 1-indexed line the anchor itself sits on. */
  line: number;
  /** 1-indexed line of the `##` heading the anchor belongs to. */
  sectionStart: number;
  /** 1-indexed line the next `##` heading sits on, or one past the last line. Exclusive. */
  sectionEnd: number;
}

/** One symbol a documentation table or a `**Types:**` sentence names, and where it was named. */
export interface DocumentedSymbol {
  name: string;
  /** 1-indexed line the symbol was written on. */
  line: number;
}

/** The line that opts a README section into the check. @public */
export const ANCHOR_RE = /^>\s*Import path:\s*`([^`]+)`\s*→\s*`([^`]+)`/;

const HEADING_RE = /^##\s/;

const BACKTICKED = /`([^`]+)`/g;

const ROOT_IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/** The exports-map key for an import specifier, dropping the package name — scoped or bare. */
function subpathOf(specifier: string): string {
  const segments = specifier.split("/");
  const nameSegments = specifier.startsWith("@") ? 2 : 1;
  return `./${segments.slice(nameSegments).join("/")}`;
}

/** Every `> Import path:` anchor in `markdown`, each carrying the span of the section it opens. */
export function parseImportPathAnchors(markdown: string): ImportPathAnchor[] {
  const lines = markdown.split("\n");
  const headings: number[] = [];
  for (let i = 0; i < lines.length; i++) if (HEADING_RE.test(lines[i] ?? "")) headings.push(i + 1);

  const anchors: ImportPathAnchor[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = ANCHOR_RE.exec(lines[i] ?? "");
    if (match === null) continue;
    const specifier = match[1];
    const barrel = match[2];
    if (specifier === undefined || barrel === undefined) continue;

    const line = i + 1;
    const start = headings.filter((heading) => heading <= line).at(-1) ?? 1;
    const end = headings.find((heading) => heading > line) ?? lines.length + 1;
    anchors.push({ subpath: subpathOf(specifier), barrel, line, sectionStart: start, sectionEnd: end });
  }
  return anchors;
}

/** The 1-indexed line of a section's `### Exports` heading, or `null` when it has none. */
export function parseExportsHeadingLine(markdown: string, sectionStart: number, sectionEnd: number): number | null {
  const lines = markdown.split("\n");
  for (let i = sectionStart - 1; i < Math.min(sectionEnd - 1, lines.length); i++) {
    if (/^###\s+Exports\s*$/.test(lines[i] ?? "")) return i + 1;
  }
  return null;
}

/** Every identifier a backticked span names, reduced to its root — `Select.Option` and
 *  `stateAttrs(state)` both name one symbol, and a `{ … }` shape names none. Exported for the
 *  catalog contract, which names components in cell 2 and so cannot reuse the table parser. */
export function rootIdentifiers(cell: string): string[] {
  const names: string[] = [];
  for (const match of cell.matchAll(BACKTICKED)) {
    const root = ROOT_IDENTIFIER.exec(match[1] ?? "");
    if (root !== null) names.push(root[0]);
  }
  return names;
}

/** The symbols named in cell 1 of every body row of the table under a section's `### Exports`. */
export function parseExportsTableSymbols(markdown: string, sectionStart: number, sectionEnd: number): DocumentedSymbol[] {
  const heading = parseExportsHeadingLine(markdown, sectionStart, sectionEnd);
  if (heading === null) return [];

  const lines = markdown.split("\n");
  const symbols: DocumentedSymbol[] = [];
  let seenHeader = false;

  for (let i = heading; i < Math.min(sectionEnd - 1, lines.length); i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("|")) {
      // The table is the first one after the heading; anything past its last row ends the scan.
      if (seenHeader && symbols.length > 0) break;
      continue;
    }
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    // The `| --- |` rule between header and body names nothing.
    if (/^\|[\s|:-]*\|$/.test(line)) continue;
    const cell = line.split("|")[1] ?? "";
    for (const name of rootIdentifiers(cell)) symbols.push({ name, line: i + 1 });
  }
  return symbols;
}

/** The backticked names of a section's `**Types:**` sentence — the paragraph it opens, in full. */
export function parseTypesProse(markdown: string, sectionStart: number, sectionEnd: number): Set<string> {
  const lines = markdown.split("\n");
  const names = new Set<string>();

  for (let i = sectionStart - 1; i < Math.min(sectionEnd - 1, lines.length); i++) {
    const start = (lines[i] ?? "").indexOf("**Types:**");
    if (start < 0) continue;
    let paragraph = (lines[i] ?? "").slice(start);
    for (let j = i + 1; j < Math.min(sectionEnd - 1, lines.length); j++) {
      const next = lines[j] ?? "";
      if (next.trim() === "") break;
      paragraph += `\n${next}`;
    }
    for (const name of rootIdentifiers(paragraph)) names.add(name);
  }
  return names;
}
