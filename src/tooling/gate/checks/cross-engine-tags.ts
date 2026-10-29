import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { blankSourceComments, collectFiles, endOfRegex, endOfString, lineAt, resolveModuleFile, unresolvedSourceEntries } from "./source-scan";
import type { CrossEngineTagsCheckConfig, CrossEngineUnit } from "./types";

const ENGINE_READS: readonly (readonly [read: string, pattern: RegExp])[] = [
  ["computed style", /\bgetComputedStyle\b/],
  ["Playwright computed style", /\.toHaveCSS\(/],
  ["layout box", /\bgetBoundingClientRect\b|\bgetClientRects\b|\.boundingBox\(/],
  ["layout metric", /\b(?:offset(?:Width|Height|Top|Left)|client(?:Width|Height|Top|Left)|scroll(?:Width|Height|Left|Top))\b/],
  ["hit test", /\belementsFromPoint\b|\belementFromPoint\b/],
  ["top layer", /\b(?:showPopover|hidePopover|togglePopover|showModal)\b|:popover-open\b|:modal\b/],
  ["focus heuristic", /:focus-visible\b/],
  ["running animations", /\bgetAnimations\b/],
  ["visibility", /\bcheckVisibility\b/],
  ["media query", /\bmatchMedia\b/],
];

const UNIT_CALL = /^test(?:\.describe(?:\.(?:serial|parallel))?)?\s*\(/;
const LOOP_HEAD = /^for\s*\(/;
const TAG_ARGUMENT = /^\s*,\s*(\{ tag: "@cross-engine" \})\s*,/;
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?|const|let)\s+([A-Za-z_$][\w$]*)/;
const FIXTURE_IMPORT = /^import\s+\{([^}]*)\}\s+from\s+"(\.{1,2}\/[^"]*\.fixture)"/gm;
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_AFTER_WORD = /(?<![\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

function opensRegex(code: string, at: number): boolean {
  let prev = at - 1;
  while (prev >= 0 && /\s/.test(code[prev] ?? "")) prev--;
  if (prev < 0) return true;
  return REGEX_AFTER.has(code[prev] ?? "") || REGEX_AFTER_WORD.test(code.slice(Math.max(0, prev - 16), prev + 1));
}

function lexCode(code: string, from: number, to: number, visit: (index: number, depth: number) => boolean): boolean {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const char = code[i] ?? "";
    if (visit(i, depth)) return true;
    const literalEnd =
      char === "'" || char === '"' || char === "`" ? endOfString(code, i) : char === "/" && opensRegex(code, i) ? endOfRegex(code, i) : null;
    if (literalEnd === -1) return false;
    if (literalEnd !== null) {
      i = literalEnd - 1;
      continue;
    }
    if (OPENERS.has(char)) depth++;
    else if (CLOSERS.has(char) && --depth < 0) return false;
  }
  return true;
}

function statementStarts(code: string, from: number, to: number, indent: number): number[] | null {
  const starts: number[] = [];
  let lineStart = from;
  let atLineHead = from === 0 || code[from - 1] === "\n";
  const lexed = lexCode(code, from, to, (i, depth) => {
    const char = code[i] ?? "";
    if (char === "\n") {
      lineStart = i + 1;
      atLineHead = true;
      return false;
    }
    if (!atLineHead || char === " " || char === "\t" || char === "\r") return false;
    atLineHead = false;
    if (depth === 0 && i - lineStart === indent && !CLOSERS.has(char)) starts.push(i);
    return false;
  });
  return lexed ? starts : null;
}

function closingBracket(code: string, open: number): number | null {
  let close = -1;
  const lexed = lexCode(code, open, code.length, (i, depth) => {
    if (i === open || depth !== 1 || !CLOSERS.has(code[i] ?? "")) return false;
    close = i;
    return true;
  });
  return lexed && close !== -1 ? close : null;
}

function tagSpan(code: string, afterParen: number): { start: number; end: number } | null {
  const title = afterParen + (/^\s*/.exec(code.slice(afterParen))?.[0].length ?? 0);
  if (!["'", '"', "`"].includes(code[title] ?? "")) return null;
  const titleEnd = endOfString(code, title);
  if (titleEnd === -1) return null;
  const match = TAG_ARGUMENT.exec(code.slice(titleEnd, titleEnd + 200));
  if (match === null) return null;
  const start = code.indexOf("{", titleEnd);
  return { start, end: start + (match[1] ?? "").length };
}

function indentOf(code: string, from: number): number {
  const first = from + (/^\s*/.exec(code.slice(from))?.[0].length ?? 0);
  return first - (code.lastIndexOf("\n", first - 1) + 1);
}

function unitsIn(code: string, from: number, to: number, indent: number): CrossEngineUnit[] | null {
  const starts = statementStarts(code, from, to, indent);
  if (starts === null) return null;
  const units: CrossEngineUnit[] = [];
  for (const [k, start] of starts.entries()) {
    const text = code.slice(start, starts[k + 1] ?? to);
    const call = UNIT_CALL.exec(text);
    if (call !== null) {
      units.push({ line: lineAt(code, start), start, end: start + text.trimEnd().length, tag: tagSpan(code, start + call[0].length) });
      continue;
    }
    if (!LOOP_HEAD.test(text)) continue;
    const headClose = closingBracket(code, start + text.indexOf("("));
    if (headClose === null) return null;
    const bodyOpen = headClose + 1 + (/^\s*/.exec(code.slice(headClose + 1))?.[0].length ?? 0);
    if (code[bodyOpen] !== "{") continue;
    const bodyClose = closingBracket(code, bodyOpen);
    if (bodyClose === null) return null;
    const inner = unitsIn(code, bodyOpen + 1, bodyClose, indentOf(code, bodyOpen + 1));
    if (inner === null) return null;
    units.push(...inner);
  }
  return units;
}

function references(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name.replaceAll("$", "\\$")}(?![\\w$])`).test(text);
}

function engineReadsIn(text: string): string[] {
  return ENGINE_READS.filter(([, pattern]) => pattern.test(text)).map(([read]) => read);
}

function readersIn(code: string, imported: ReadonlySet<string>): Set<string> | null {
  const starts = statementStarts(code, 0, code.length, 0);
  if (starts === null) return null;
  const declarations = starts
    .map((start, k) => code.slice(start, starts[k + 1] ?? code.length))
    .map((text) => ({ text, name: DECLARATION.exec(text)?.[1] }))
    .filter((declaration): declaration is { text: string; name: string } => declaration.name !== undefined);
  const readers = new Set(imported);
  let grew = true;
  while (grew) {
    const found = declarations.filter(
      ({ text, name }) => !readers.has(name) && (engineReadsIn(text).length > 0 || [...readers].some((reader) => references(text, reader))),
    );
    for (const { name } of found) readers.add(name);
    grew = found.length > 0;
  }
  return readers;
}

/** Every top-level `describe` or `test` call in a browser spec, a top-level `for` loop's own included, or `null` when it cannot be lexed. @public */
export function findCrossEngineUnits(source: string): CrossEngineUnit[] | null {
  const code = blankSourceComments(source);
  return unitsIn(code, 0, code.length, 0);
}

/** The top-level declarations of a spec that read an engine-computed value, directly or through another, seeded with `imported`. @public */
export function findEngineReaders(source: string, imported: ReadonlySet<string> = new Set()): Set<string> | null {
  return readersIn(blankSourceComments(source), imported);
}

/** Judges one browser spec's top-level blocks against the engine reads they make and where `@cross-engine` is spelled. @public */
export function validateCrossEngineTags(file: string, source: string, imported: ReadonlySet<string> = new Set()): Finding[] {
  const code = blankSourceComments(source);
  const units = unitsIn(code, 0, code.length, 0);
  const readers = readersIn(code, imported);
  if (units === null || readers === null) return [fail("the spec cannot be lexed, so none of its blocks is judged", { file })];

  const untagged = units
    .filter((unit) => unit.tag === null)
    .flatMap((unit) => {
      const text = code.slice(unit.start, unit.end);
      const names = [...engineReadsIn(text), ...[...readers].filter((reader) => references(text, reader))];
      if (names.length === 0) return [];
      return [
        fail("an untagged top-level block reads what the engine computes", {
          file,
          line: unit.line,
          detail: [`reads ${names.join(", ")} — add { tag: "@cross-engine" }`],
        }),
      ];
    });
  const misplaced = [...code.matchAll(/@cross-engine/g)]
    .map((match) => match.index)
    .filter((index) => !units.some((unit) => unit.tag !== null && index >= unit.tag.start && index < unit.tag.end))
    .map((index) => fail('@cross-engine is spelled outside a top-level block\'s { tag: "@cross-engine" }', { file, line: lineAt(code, index) }));
  return [...untagged, ...misplaced];
}

/** The local names a spec imports from a relative `*.fixture.ts` module that read an engine-computed value. @public */
export function resolveFixtureReaders(root: string, file: string, source: string): { readers: Set<string>; findings: Finding[] } {
  const readers = new Set<string>();
  const findings: Finding[] = [];
  for (const [, specifiers = "", specifier = ""] of blankSourceComments(source).matchAll(FIXTURE_IMPORT)) {
    const fixture = resolveModuleFile(root, posix.join(posix.dirname(file), specifier));
    if (fixture === null || !fixture.endsWith(".fixture.ts")) continue;
    const fixtureReaders = findEngineReaders(readFileSync(resolve(root, fixture), "utf-8"));
    if (fixtureReaders === null) {
      findings.push(fail("the fixture cannot be lexed, so readers through it are unseen", { file: fixture }));
      continue;
    }
    const bindings = specifiers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !/^type\s/.test(entry))
      .map((entry) => entry.split(/\s+as\s+/));
    for (const [imported = "", local = imported] of bindings) {
      if (fixtureReaders.has(imported)) readers.add(local);
    }
  }
  return { readers, findings };
}

/** Walk the configured sources and judge every browser spec's `@cross-engine` tags. @public */
export function checkCrossEngineTags(config: CrossEngineTagsCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, (name) => name.endsWith(".browser.ts")));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no browser spec`, "cross-engine-tags");
  const unresolved = unresolvedSourceEntries(config.root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const findings = files.flatMap((file) => {
    const source = readFileSync(resolve(config.root, file), "utf-8");
    const fixture = resolveFixtureReaders(config.root, file, source);
    return [...fixture.findings, ...validateCrossEngineTags(file, source, fixture.readers)];
  });

  if (findings.length > 0) {
    findings.push(
      fail(
        "A top-level block that reads what the engine computes runs on Firefox and WebKit too (docs/TEST_RUNNERS.md §1g); a false positive is tagged, never excused.",
      ),
    );
  }

  return checkResult(findings, `${files.length} browser specs tag every top-level block that reads what the engine computes.`);
}
