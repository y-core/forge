/** A `@y-core/forge/…` reference found in a document. */
export interface SubpathCitation {
  /** What the citation does: a table row *lists* a subpath, prose *binds* it. */
  kind: "prose" | "table";
  /** 1-indexed line the citation sits on. */
  line: number;
  /** The path fragment as written, package name stripped — e.g. `/ui/core`. */
  raw: string;
  /** The same fragment as an exports-map key, trailing punctuation trimmed — e.g. `./ui/core`. */
  subpath: string;
}

const IMPORT_POSITION = /\b(?:from|import)\s*\(?\s*["']/;

const QUICK_REFERENCE_HEADING = /^## 0\. /;
const QUICK_REFERENCE_ENTRY = /^\s*[-*]\s*§([0-9][A-Za-z0-9]*)\s+(.*)$/;

/** The `## 0. Quick Reference` block as a map from section number to the line describing it.
 *
 *  **One home, because two readers consume it.** The gate checks these lines against the headings
 *  they name; the indexer redistributes them as each section's gloss, which is both what a search
 *  result displays and a ranked retrieval column. A parser that drifted between the two would let
 *  the gate approve a line the index reads differently. @public */
export function quickReference(lines: readonly string[]): Map<string, string> {
  const entries = new Map<string, string>();
  const start = lines.findIndex((line) => QUICK_REFERENCE_HEADING.test(line));
  if (start === -1) return entries;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) break;
    const match = line.match(QUICK_REFERENCE_ENTRY);
    if (match) entries.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return entries;
}

// Non-strict scans only import-position lines, so a README may describe a subpath that does not
// exist without failing the check for naming the thing it denies.
/** Finds every `packageName/…` reference in `source`, scanning prose as well when `strict`. */
export function findSubpathCitations(source: string, packageName: string, opts: { strict: boolean }): SubpathCitation[] {
  const re = new RegExp(`${packageName.replace("/", "\\/")}(\\/[A-Za-z0-9._\\-\\/]*)`, "g");
  const found: SubpathCitation[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!opts.strict && !IMPORT_POSITION.test(line)) continue;
    const kind = line.trimStart().startsWith("|") ? "table" : "prose";

    for (const match of line.matchAll(re)) {
      const raw = match[1];
      if (!raw || raw.endsWith("/")) continue;
      if (raw.includes("...")) continue;

      found.push({ kind, line: i + 1, raw, subpath: `.${raw.replace(/[.\-/]+$/, "")}` });
    }
  }
  return found;
}

/** Every published subpath that no citation names and no exemption licenses, sorted. */
export function uncitedSubpaths(exportSubpaths: Iterable<string>, citations: readonly SubpathCitation[], exempt: ReadonlySet<string>): string[] {
  const cited = new Set(citations.map((citation) => citation.subpath));
  return [...exportSubpaths].filter((subpath) => !cited.has(subpath) && !exempt.has(subpath)).sort();
}
