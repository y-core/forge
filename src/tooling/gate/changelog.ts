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

// Link definitions sit below the last section rather than inside it, and the rule between sections
// is punctuation — neither is prose a release wrote, so neither may move a section's digest.
/** One section's prose, from the line after its heading to `end`, stripped of what is not prose. */
function sectionBody(lines: readonly string[], from: number, end: number): string[] {
  const body = lines.slice(from, end).filter((line) => !LINK_REF.test(line) && line.trim() !== "---");
  while (body.length > 0 && (body.at(-1) ?? "").trim() === "") body.pop();
  return body;
}

/** Where the section opened at `line` ends: the next level-2 heading, or the end of the document. */
function sectionEnd(lines: readonly string[], line: number): number {
  for (let i = line + 1; i < lines.length; i++) {
    if (SECTION_END.test(lines[i] ?? "")) return i;
  }
  return lines.length;
}

// FNV-1a over the section's own prose, and not a cryptographic digest: this catches a hand edit,
// which is an accident rather than an attacker, and it answers without making the check async.
/** A released section's prose as the digest a manifest records it under. @public */
export function changelogSectionDigest(body: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const code of new TextEncoder().encode(body.join("\n"))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(code)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
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
    versions.push({ version, date, line: i, body: sectionBody(lines, i + 1, sectionEnd(lines, i)) });
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
  if (parsed.data.versions.some((heading) => heading.version === opts.version)) {
    return err([`[${opts.version}] is already a heading — the release was promoted once, and promoting it again would duplicate it`]);
  }

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

const SUBSECTION = /^### /;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function trimBlank(lines: readonly string[]): string[] {
  let from = 0;
  let to = lines.length;
  while (from < to && isBlank(lines[from] ?? "")) from++;
  while (to > from && isBlank(lines[to - 1] ?? "")) to--;
  return lines.slice(from, to);
}

function isListItem(line: string): boolean {
  return /^\s*[-*] /.test(line);
}

function trimTrailing(lines: readonly string[]): string[] {
  let to = lines.length;
  while (to > 0 && isBlank(lines[to - 1] ?? "")) to--;
  return lines.slice(0, to);
}

/** `kept` with `added` appended after its last line, inside the blank lines around it. */
function appendBlock(kept: readonly string[], added: readonly string[]): string[] {
  if (added.length === 0) return [...kept];
  const core = trimBlank(kept);
  if (core.length === 0) return [...(kept.length === 0 ? [""] : kept), ...added, ""];
  const lead = kept.indexOf(core[0] ?? "");
  const tail = kept.slice(lead + core.length);
  const last = core.at(-1) ?? "";
  const gap = isListItem(last) && isListItem(added[0] ?? "") ? [] : [""];
  return [...kept.slice(0, lead), ...core, ...gap, ...added, ...(tail.length === 0 ? [""] : tail)];
}

interface Subsections {
  preamble: string[];
  sections: { heading: string; body: string[] }[];
}

function splitSubsections(lines: readonly string[]): Subsections {
  const out: Subsections = { preamble: [], sections: [] };
  for (const line of lines) {
    if (SUBSECTION.test(line)) out.sections.push({ heading: line.trim(), body: [] });
    else (out.sections.at(-1)?.body ?? out.preamble).push(line);
  }
  return out;
}

/** `released` with every line of `unreleased` merged in by `###` subsection; with nothing to merge, `released` unchanged. */
function mergeBodies(released: readonly string[], unreleased: readonly string[]): string[] {
  if (trimBlank(unreleased).length === 0) return [...released];
  const into = splitSubsections(released);
  const from = splitSubsections(unreleased);
  const kept = into.sections.flatMap(({ heading, body }) => {
    const extra = from.sections.filter((section) => section.heading === heading).flatMap((section) => trimBlank(section.body));
    return [heading, ...appendBlock(body, extra)];
  });
  const added = from.sections
    .filter((section) => !into.sections.some((existing) => existing.heading === section.heading))
    .flatMap(({ heading, body }) => ["", heading, "", ...trimBlank(body)]);
  return [...trimTrailing([...appendBlock(into.preamble, trimBlank(from.preamble)), ...kept]), ...added];
}

/** Folds the released `[version]` section back into `[Unreleased]`, merging both bodies; the inverse of {@link promoteUnreleased}. @internal */
export function reopenRelease(source: string, version: string): ValidationResult<string> {
  const parsed = parseChangelog(source);
  if (!parsed.ok) return parsed;
  const [newest] = parsed.data.versions;
  if (newest === undefined || newest.version !== version) {
    if (parsed.data.versions.some((heading) => heading.version === version)) {
      return err([`[${version}] is not the newest released section, so it cannot be reopened`]);
    }
    return ok(source);
  }

  const lines = source.split("\n");
  const unreleased = parsed.data.unreleased.line;
  const end = sectionEnd(lines, newest.line);
  const body = lines.slice(newest.line + 1, end);
  const content = body.slice(0, sectionContentEnd(body));
  const pending = lines
    .slice(unreleased + 1, newest.line)
    .filter((line) => !LINK_REF.test(line) && line.trim() !== "---" && line.trim() !== PLACEHOLDER);

  const reopened = [
    ...lines.slice(0, unreleased),
    "## [Unreleased]",
    ...mergeBodies(content, pending),
    ...body.slice(content.length),
    ...lines.slice(end),
  ];

  const ref = reopened.findIndex((line) => line.match(LINK_REF)?.[1] === version);
  if (ref !== -1) {
    const appended = ref === reopened.length - 1 && reopened[ref - 1] === "" && !reopened.some((line, i) => i !== ref && LINK_REF.test(line));
    reopened.splice(appended ? ref - 1 : ref, appended ? 2 : 1);
  }
  return ok(reopened.join("\n"));
}

/** Where a section body's own lines stop and the separator and link definitions after it begin. */
function sectionContentEnd(body: readonly string[]): number {
  let to = body.length;
  while (to > 0) {
    const line = body[to - 1] ?? "";
    if (!isBlank(line) && line.trim() !== "---" && !LINK_REF.test(line)) break;
    to--;
  }
  return to;
}

// `toISOString().slice(0, 10)` reads UTC, so a late-evening release would stamp tomorrow's date.
/** Formats `date` as `YYYY-MM-DD` in the local calendar. @public */
export function formatReleaseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
