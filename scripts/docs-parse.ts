/** docs-parse.ts — the matchers `validate-docs.ts` decides on.
 *
 *  Mirrors the `validate-exports.ts` / `barrel-parse.ts` split: `validate-docs.ts` remains the
 *  entry point and retains every policy decision — which files are strict, which absent subpaths
 *  are licensed, what fails and with what message — while the pattern-matching lives here, where
 *  it is importable and therefore assertable.
 *
 *  Strings in, data out: no disk, no `package.json`, no repo root. The script's `ROOT` is derived
 *  from `import.meta.url` and can never be pointed at a fixture tree, so a scanner that took a
 *  path would be untestable for exactly the reason the split exists.
 */

/** A `@y-core/forge/…` reference found in a document. */
export interface SubpathCitation {
  /** 1-indexed line the citation sits on, for the failure message. */
  line: number;
  /** The path fragment as written, package name stripped — e.g. `/ui/core`. */
  raw: string;
  /** The same fragment as an exports-map key — e.g. `./ui/core`. Trailing punctuation swallowed
   *  by the match (a sentence's full stop, a hyphen before prose) is trimmed. */
  subpath: string;
}

/** A line that reads as a genuine import statement rather than prose about one. */
const IMPORT_POSITION = /\b(?:from|import)\s*\(?\s*["']/;

/**
 * Every `packageName/…` reference in `source`.
 *
 * `strict` decides whether prose counts. With it off, only lines that look like an import
 * statement are scanned — a namespace README's job includes describing what does *not* exist
 * ("there is no top-level `@y-core/forge/storage` barrel"), and that sentence must not fail a
 * check for naming the thing it denies. With it on, every position is scanned: table cells and
 * `**[…](…)**` links included, which is where the root README's stale subpaths sat unseen.
 *
 * Three shapes are skipped as non-citations rather than reported: a bare package name, a trailing
 * `/` (a `{namespace}` or `<subpath>` placeholder), and a path containing `...` (an elided
 * fragment). Each is a documented way to write about a subpath without naming one.
 */
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
