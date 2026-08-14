const UNRELEASED_HEADING = /^## \[Unreleased\]$/;

// The separator is an em dash (U+2014); written as an escape so a pasted en dash cannot pass review by looking identical.
const RELEASED_HEADING = /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})$/;

const ENTRY_HEADING = /^## \[/;

const LINK_REF = /^\[(\d+\.\d+\.\d+)\]: (\S+)$/;

// Bodies are long-form prose containing `###` subsections, so only level-2 headings end a section.
const SECTION_END = /^## /;

const PLACEHOLDER = "_Nothing yet._";

/** A released version heading, as it appears in the document. @public */
export interface VersionHeading {
  /** Bare semver, no brackets — `"0.0.83"`. */
  version: string;
  /** ISO calendar date — `"2026-08-11"`. */
  date: string;
  /** Zero-indexed line the heading sits on. */
  line: number;
}

/** The `[Unreleased]` section: where it sits, what it holds, and whether that amounts to anything. @public */
export interface UnreleasedSection {
  /** Zero-indexed line of the `## [Unreleased]` heading. */
  line: number;
  /** Verbatim body lines, from just after the heading up to the next `## ` heading or EOF. */
  body: readonly string[];
  /** True when the body carries no content — see {@link parseChangelog} for the exact rule. */
  empty: boolean;
}

/** The outcome of reading a changelog: every heading and link definition, or every reason the document could not be read. @public */
export type ChangelogParse =
  | {
      ok: true;
      unreleased: UnreleasedSection;
      /** Released headings in document order — newest first, if the document is well-formed. */
      versions: readonly VersionHeading[];
      /** Versions named by a link reference definition, in document order. */
      linkRefs: readonly string[];
    }
  | { ok: false; errors: readonly string[] };

/** Inputs to {@link promoteUnreleased}. @public */
export interface PromoteOptions {
  /** The version the section is being promoted to — bare semver, no leading `v`. */
  version: string;
  /** Release date, already formatted — see {@link formatReleaseDate}. */
  date: string;
  /** Tag prefix used when building the compare URL. Defaults to `"v"`. */
  tagPrefix?: string;
  /** Repository base URL, e.g. `https://github.com/y-core/forge`. Omit to skip the link definition. */
  compareUrlBase?: string;
}

function isRealDate(iso: string): boolean {
  const [y = "", m = "", d = ""] = iso.split("-");
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function isBodyEmpty(body: readonly string[]): boolean {
  const meaningful = body.filter((line) => line.trim() !== "" && line.trim() !== "---");
  if (meaningful.length === 0) return true;
  return meaningful.length === 1 && meaningful[0] === PLACEHOLDER;
}

/** Reads a changelog's structure without changing it, or every reason the document could not be parsed. @public */
export function parseChangelog(source: string): ChangelogParse {
  const lines = source.split("\n");
  const errors: string[] = [];
  const versions: VersionHeading[] = [];
  const linkRefs: string[] = [];
  const unreleasedLines: number[] = [];
  let firstEntry: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const ref = line.match(LINK_REF);
    if (ref) {
      const [, version = ""] = ref;
      linkRefs.push(version);
      continue;
    }

    if (!ENTRY_HEADING.test(line)) continue;
    if (firstEntry === null) firstEntry = i;

    if (UNRELEASED_HEADING.test(line)) {
      unreleasedLines.push(i);
      continue;
    }

    const released = line.match(RELEASED_HEADING);
    if (!released) {
      errors.push(`line ${i + 1}: \`${line}\` does not match \`## [X.Y.Z] — YYYY-MM-DD\` (the separator is an em dash)`);
      continue;
    }
    const [, version = "", date = ""] = released;
    if (!isRealDate(date)) {
      errors.push(`line ${i + 1}: \`${date}\` is not a real calendar date`);
      continue;
    }
    versions.push({ version, date, line: i });
  }

  if (unreleasedLines.length === 0) {
    errors.push("no `## [Unreleased]` section — it is the only section humans edit, and release promotes it");
  } else if (unreleasedLines.length > 1) {
    const at = unreleasedLines.map((line) => line + 1).join(", ");
    errors.push(`${unreleasedLines.length} \`## [Unreleased]\` headings (lines ${at}) — there must be exactly one`);
  }

  const unreleasedLine = unreleasedLines[0];
  if (unreleasedLine !== undefined && firstEntry !== null && firstEntry !== unreleasedLine) {
    errors.push(`line ${firstEntry + 1}: an entry heading precedes \`## [Unreleased]\` (line ${unreleasedLine + 1}) — Unreleased must be first`);
  }

  if (errors.length > 0 || unreleasedLine === undefined) {
    return { ok: false, errors };
  }

  let end = lines.length;
  for (let i = unreleasedLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && SECTION_END.test(line)) {
      end = i;
      break;
    }
  }
  const body = lines.slice(unreleasedLine + 1, end);

  return { ok: true, unreleased: { line: unreleasedLine, body, empty: isBodyEmpty(body) }, versions, linkRefs };
}

/** Promotes `[Unreleased]` into a dated, released version section. @public */
export function promoteUnreleased(source: string, opts: PromoteOptions): { ok: true; source: string } | { ok: false; errors: readonly string[] } {
  const parsed = parseChangelog(source);
  if (!parsed.ok) return parsed;

  const tagPrefix = opts.tagPrefix ?? "v";
  const lines = source.split("\n");

  lines[parsed.unreleased.line] = `## [${opts.version}] — ${opts.date}`;
  lines.splice(parsed.unreleased.line, 0, "## [Unreleased]", "", PLACEHOLDER, "", "---", "");

  const previous = parsed.versions[0]?.version;
  if (opts.compareUrlBase !== undefined && previous !== undefined) {
    const def = `[${opts.version}]: ${opts.compareUrlBase}/compare/${tagPrefix}${previous}...${tagPrefix}${opts.version}`;
    const firstRef = lines.findIndex((line) => LINK_REF.test(line));
    if (firstRef === -1) lines.push("", def);
    else lines.splice(firstRef, 0, def);
  }

  return { ok: true, source: lines.join("\n") };
}

// `toISOString().slice(0, 10)` reads UTC, so a late-evening release would stamp tomorrow's date.
/** Formats `date` as `YYYY-MM-DD` in the local calendar. @public */
export function formatReleaseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
