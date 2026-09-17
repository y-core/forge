import { fail } from "../finding";
import type { Finding } from "../types";
import { findComments } from "./source-scan";
import type { CommentSpan } from "./types";

/** The two visibility markers §5a permits; every other JSDoc tag is prose the budget does not cover. */
const REJECTED_TAGS = new Set([
  "alpha",
  "async",
  "augments",
  "beta",
  "class",
  "constructor",
  "decorator",
  "defaultValue",
  "deprecated",
  "eventProperty",
  "example",
  "experimental",
  "exports",
  "file",
  "fileoverview",
  "function",
  "inheritDoc",
  "label",
  "link",
  "member",
  "module",
  "namespace",
  "override",
  "packageDocumentation",
  "param",
  "private",
  "privateRemarks",
  "property",
  "protected",
  "readonly",
  "remarks",
  "returns",
  "sealed",
  "see",
  "since",
  "template",
  "throws",
  "todo",
  "type",
  "typedef",
  "typeParam",
  "virtual",
  "yields",
]);

const TAG = /(?<![\w/])@([A-Za-z]+)/g;

const UNACTIONABLE = /\b(TODO|FIXME|XXX)\b/;

/** A tooling suppression or a compiler pragma — input that happens to use comment syntax. */
const TOOLING = /^(?:oxlint-|eslint-|biome-ignore|prettier-ignore|@ts-|@jsx[A-Za-z]+\b|global\b|globals\b)/;

/** The `/* <marker>: <rule> — <reason> *​/` form `suppressedBy` reads. */
const SUPPRESSION = /^\/\*\s*[a-z][a-z0-9-]*:\s*\S+\s+—\s+\S/;

/** A definite count of what exists, which goes stale the moment the population changes. */
const TALLY = /\bthe\s+(?:both|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([A-Za-z][A-Za-z-]{2,}s)\b/i;

/** Words ending in `s` that are never a plural noun, so the count is not counting them. */
const NOT_A_PLURAL = new Set([
  "always",
  "perhaps",
  "thus",
  "less",
  "plus",
  "was",
  "has",
  "does",
  "its",
  "this",
  "else",
  "unless",
  "across",
  "versus",
  "whereas",
]);

/** A spec citation or a unit, either of which makes the number the fact rather than a tally of what exists. */
const LOAD_BEARING_NUMBER = /\b(?:RFC|NIST|L3|WebAuthn|bytes|bits|ms|rem|digits|characters|columns)\b|§|\b\d+-bit\b/;

/** The items themselves, following the count — drift a reader catches on the same line. */
const ENUMERATION = /^\s*(?:[—:(]|-\s|,)/;

/** A rule of dashes, equals signs, box-drawing or asterisks, with or without a title inside it. */
const BANNER = /^\/\/\s*(?:[-=*#~_+]{3,}|[─-╿]{2,})/;

/** A statement, not a sentence: a binding, a module edge, a declaration, or a lone closer. */
const COMMENTED_OUT = [
  /^\/\/\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*[=:]/,
  /^\/\/\s*(?:import|export)\s+(?:type\s+)?[{*A-Za-z_$"']/,
  /^\/\/\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*[(<]/,
  /^\/\/\s*(?:interface|class|enum)\s+[A-Za-z_$][\w$]*\s*[{<]/,
  /^\/\/\s*return\s[^.?!]*;\s*$/,
  /^\/\/\s*[})\]][;,)\]}]*\s*$/,
  /^\/\/\s*[\w$.[\]]+\s*\([^)]*\)\s*;\s*$/,
];

function body(span: CommentSpan): string {
  return span.text
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .replace(/^\/\//, "")
    .trim();
}

/** The `-- <marker>: <value>` form a check parses out of a whole line, so only a block can hold it. */
const ANNOTATION = /^--[ \t]*[a-z][a-z0-9-]*:[ \t]*\S+$/;

function isAnnotationBlock(span: CommentSpan): boolean {
  if (span.kind !== "block" || span.text.startsWith("/**")) return false;
  // The delimiters get lines of their own, because a marker sharing a line with `/*` or `*/` is one
  // no whole-line reader can parse — exempting it would buy silence for an annotation nothing reads.
  const lines = span.text.split("\n");
  const closer = lines.pop();
  const opener = lines.shift();
  if (opener?.trim() !== "/*" || closer?.trim() !== "*/") return false;
  const marked = lines.map((line) => line.trim()).filter((line) => line !== "");
  return marked.length > 0 && marked.every((line) => ANNOTATION.test(line));
}

/** Whether a comment is machine-readable directive rather than prose — outside the budget entirely. @public */
export function isToolingDirective(span: CommentSpan): boolean {
  return TOOLING.test(body(span)) || SUPPRESSION.test(span.text) || isAnnotationBlock(span);
}

// `{@link X}` is the inline form: a cross-reference an editor resolves, costing the reader no line
// of its own. The bare tag is prose, and is judged as one.
const INLINE_LINK = /\{@link\s[^}]*\}/g;

function rejectedTags(span: CommentSpan): string[] {
  return [...span.text.replace(INLINE_LINK, "").matchAll(TAG)].map((match) => match[1] ?? "").filter((tag) => REJECTED_TAGS.has(tag));
}

function judgeBlock(file: string, span: CommentSpan): Finding[] {
  const lines = span.text.split("\n").length;
  const tsdoc = span.text.startsWith("/**");
  const findings: Finding[] = [];
  if (lines > (tsdoc ? 1 : 2)) {
    findings.push(
      tsdoc
        ? fail(`TSDoc spans ${lines} lines — §5a permits one`, {
            file,
            line: span.line,
            detail: ["cut it to one sentence on one line, or delete it — a claim about behaviour belongs in a test"],
          })
        : fail(`inline why spans ${lines} lines — §5a form 3 caps one at two`, {
            file,
            line: span.line,
            detail: ["keep the part a reader could not derive and would get wrong, in one or two lines; delete the rest"],
          }),
    );
  }
  for (const tag of rejectedTags(span)) {
    findings.push(
      fail(`\`@${tag}\` — §5a permits \`@public\` and \`@internal\` alone`, {
        file,
        line: span.line,
        detail: ["delete the tag; the signature is the parameter documentation, and usage belongs in the unit's `README.md`"],
      }),
    );
  }
  return findings;
}

function judgeLine(file: string, span: CommentSpan): Finding[] {
  if (BANNER.test(span.text.trim())) {
    return [fail("section banner — file structure is what files and exports are for", { file, line: span.line })];
  }
  if (COMMENTED_OUT.some((pattern) => pattern.test(span.text.trim()))) {
    return [fail("commented-out code — git holds it", { file, line: span.line })];
  }
  return [];
}

/** Words that carry no fact of their own, so a gloss built from them plus the field name says nothing. */
const STOP_WORDS = new Set([
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "by",
  "each",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "per",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "with",
]);

/** The property signature a block comment glosses — on the comment's own line, or the one below it. */
const GLOSSED_FIELD = /^[^\S\n]*\n?[^\S\n]*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/;

/** A second clause or a second sentence, which is where a default, a unit, a constraint or a caveat lives. */
const SECOND_CLAUSE = /[;:,—]|\.\s+\S/;

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function nameWords(name: string): string[] {
  return contentWords(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

// §5f, the half `judgeBlock` cannot reach: a one-line gloss is inside the budget by shape and still
// earns nothing when its words reduce to the field's own name.
function judgeGloss(file: string, source: string, span: CommentSpan): Finding[] {
  if (span.kind !== "block" || !span.text.startsWith("/**")) return [];
  const field = GLOSSED_FIELD.exec(source.slice(span.end))?.[1];
  if (field === undefined) return [];

  const prose = body(span).replace(/@(?:public|internal)\b/g, "");
  if (SECOND_CLAUSE.test(prose)) return [];

  const own = new Set(nameWords(field));
  const said = contentWords(prose);
  const spellsTheNameBack = own.size > 0 && [...own].every((word) => said.includes(word));
  const adds = said.filter((word) => !own.has(word));
  if (!spellsTheNameBack || adds.length > 1) return [];

  return [
    fail(`\`${field}\` — the gloss spells the field name back; §5f budgets nothing for that`, {
      file,
      line: span.line,
      detail: ["delete it, or say what the name and the type do not: a default, a unit, a constraint, a caveat"],
    }),
  ];
}

function judgeTally(file: string, span: CommentSpan): Finding[] {
  const text = body(span);
  if (LOAD_BEARING_NUMBER.test(text)) return [];
  const match = TALLY.exec(text);
  if (match === null || NOT_A_PLURAL.has((match[1] ?? "").toLowerCase())) return [];
  if (ENUMERATION.test(text.slice(match.index + match[0].length))) return [];

  return [
    fail(`inventory count \`${match[0]}\` — a comment records that a thing exists, not how many`, {
      file,
      line: span.line,
      detail: ["drop the count, or name the items so a reader catches the drift on the line"],
    }),
  ];
}

/** A `//` comment sitting alone on its line, which is what a run is made of. */
function ownsItsLine(source: string, span: CommentSpan): boolean {
  const start = source.lastIndexOf("\n", span.start) + 1;
  return source.slice(start, span.start).trim() === "";
}

function judgeRuns(file: string, source: string, spans: readonly CommentSpan[], licensed: boolean): Finding[] {
  const owned = spans.filter((span) => span.kind === "line" && ownsItsLine(source, span));
  const findings: Finding[] = [];
  let run: CommentSpan[] = [];

  const close = (): void => {
    const head = run[0];
    if (run.length >= 3 && head !== undefined && !(licensed && head === owned[0])) {
      findings.push(
        fail(`${run.length} consecutive \`//\` lines — §5a form 3 caps an inline why at two`, {
          file,
          line: head.line,
          detail: ["keep the part a reader could not derive and would get wrong, in one or two lines; delete the rest"],
        }),
      );
    }
    run = [];
  };

  for (const span of owned) {
    const previous = run[run.length - 1];
    if (previous !== undefined && span.line !== previous.line + 1) close();
    run.push(span);
  }
  close();
  return findings;
}

/** Every way `file` exceeds the `CODE_RULES.md` §5a comment budget, in source order. @public */
export function validateCommentBudget(file: string, source: string, licensed = false): Finding[] {
  const spans = findComments(source).filter((span) => !isToolingDirective(span));
  const perComment = spans.flatMap((span) => [
    ...(span.kind === "block" ? [...judgeBlock(file, span), ...judgeGloss(file, source, span)] : judgeLine(file, span)),
    ...(UNACTIONABLE.test(span.text) ? [fail("`TODO`/`FIXME`/`XXX` in a comment — open a ledger task", { file, line: span.line })] : []),
    ...judgeTally(file, span),
  ]);
  return [...perComment, ...judgeRuns(file, source, spans, licensed)].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
