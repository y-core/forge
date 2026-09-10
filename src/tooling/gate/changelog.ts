import { err, ok } from "../../result/result";
import type { ValidationResult } from "../../result/types";
import type { ChangelogParse, PromoteOptions, VersionHeading } from "./types";

const UNRELEASED_HEADING = /^## \[Unreleased\]$/;

// The separator is an em dash (U+2014); written as an escape so a pasted en dash cannot pass review by looking identical.
const RELEASED_HEADING = /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})$/;

const ENTRY_HEADING = /^## \[/;

const LINK_REF = /^\[(\d+\.\d+\.\d+)\]: (\S+)$/;

// Bodies are long-form prose containing `###` subsections, so only level-2 headings end a section.
const SECTION_END = /^## /;

const PLACEHOLDER = "_Nothing yet._";

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
    return err(errors);
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

  return ok({ unreleased: { line: unreleasedLine, body, empty: isBodyEmpty(body) }, versions, linkRefs });
}

/** Promotes `[Unreleased]` into a dated, released version section. @public */
export function promoteUnreleased(source: string, opts: PromoteOptions): ValidationResult<string> {
  const parsed = parseChangelog(source);
  if (!parsed.ok) return parsed;

  const tagPrefix = opts.tagPrefix ?? "v";
  const lines = source.split("\n");

  lines[parsed.data.unreleased.line] = `## [${opts.version}] — ${opts.date}`;
  lines.splice(parsed.data.unreleased.line, 0, "## [Unreleased]", "", PLACEHOLDER, "", "---", "");

  const previous = parsed.data.versions[0]?.version;
  if (opts.compareUrlBase !== undefined && previous !== undefined) {
    const def = `[${opts.version}]: ${opts.compareUrlBase}/compare/${tagPrefix}${previous}...${tagPrefix}${opts.version}`;
    const firstRef = lines.findIndex((line) => LINK_REF.test(line));
    if (firstRef === -1) lines.push("", def);
    else lines.splice(firstRef, 0, def);
  }

  return ok(lines.join("\n"));
}

// `toISOString().slice(0, 10)` reads UTC, so a late-evening release would stamp tomorrow's date.
/** Formats `date` as `YYYY-MM-DD` in the local calendar. @public */
export function formatReleaseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
