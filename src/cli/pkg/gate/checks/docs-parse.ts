/** A `@y-core/forge/…` reference found in a document. */
export interface SubpathCitation {
  /** 1-indexed line the citation sits on. */
  line: number;
  /** The path fragment as written, package name stripped — e.g. `/ui/core`. */
  raw: string;
  /** The same fragment as an exports-map key, trailing punctuation trimmed — e.g. `./ui/core`. */
  subpath: string;
}

const IMPORT_POSITION = /\b(?:from|import)\s*\(?\s*["']/;

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

    for (const match of line.matchAll(re)) {
      const raw = match[1];
      if (!raw || raw.endsWith("/")) continue;
      if (raw.includes("...")) continue;

      found.push({ line: i + 1, raw, subpath: `.${raw.replace(/[.\-/]+$/, "")}` });
    }
  }
  return found;
}

/** Every published subpath that no citation names and no exemption licenses, sorted. */
export function uncitedSubpaths(exportSubpaths: Iterable<string>, citations: readonly SubpathCitation[], exempt: ReadonlySet<string>): string[] {
  const cited = new Set(citations.map((citation) => citation.subpath));
  return [...exportSubpaths].filter((subpath) => !cited.has(subpath) && !exempt.has(subpath)).sort();
}
