/** namespace-graph-parse.ts — the matchers `validate-namespace-graph.ts` decides on.
 *
 *  Mirrors the `validate-exports.ts` / `barrel-parse.ts` and `validate-docs.ts` / `docs-parse.ts`
 *  splits: the entry point keeps every policy decision — which directories are namespaces, which
 *  edges are declared, what fails and with what message — while the pattern matching lives here,
 *  where it is importable and therefore assertable.
 *
 *  Strings in, data out: no `node:fs`, no repo root, no `package.json`. `node:path`'s `posix`
 *  helpers are pure string computation and are used for specifier arithmetic; nothing here touches
 *  a filesystem. A scanner that read from disk could only ever be tested against the real tree,
 *  which is the one tree whose answer must not be allowed to define the rule.
 */

import { posix } from "node:path";

/** Whether an edge survives type erasure. A `type` edge exists only in the type checker. */
export type EdgeKind = "value" | "type";

/** One import site: a single specifier as it appears in one file. */
export interface ImportRef {
  /** 1-indexed line, for the failure message. */
  line: number;
  /** The specifier exactly as written. */
  specifier: string;
  /** `type` only when every binding at this site is type-only. */
  kind: EdgeKind;
}

/** A file handed to the graph builder, already read by the caller. */
export interface SourceFile {
  /** Repo-relative posix path, e.g. `src/ui/core/card.tsx`. */
  path: string;
  /** The file's full text. */
  source: string;
}

/** One namespace-to-namespace edge, as observed across every contributing site. */
export interface ObservedEdge {
  /** `value` if any contributing site was a value import; `type` only if all of them were. */
  kind: EdgeKind;
  /** A site consistent with `kind`, for the message — the first one seen at the kind finally
   *  reported, not the first one seen overall. The two differ only when a `type` edge is later
   *  promoted by a value import, and there the site has to move with it: a message that reported a
   *  value edge while naming a `import type` line would send its reader to somewhere that looks
   *  entirely correct. */
  file: string;
  /** 1-indexed line within `file`. */
  line: number;
}

/** Filler for masked comment and literal interiors: same length, never a quote, never whitespace. */
const MASK = "\u0001";

/** Extensions a specifier may carry that must be stripped before namespace attribution. */
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js"];

/** Suffixes that mark a file as test-only. */
const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".browser.ts", ".browser.tsx"];

/** Characters an import/export clause may contain between the keyword and its `from`. Excluding
 *  quotes, `;`, `=` and parens is what stops a lazy clause from running past the end of one
 *  statement and stitching two unrelated ones into a phantom import. */
const CLAUSE = "[A-Za-z0-9_$,{}\\s*]*?";

/** `import <clause> from "…"`, `export <clause> from "…"`, a bare side-effect `import "…"`, and a
 *  dynamic `import("…")`. Each captures the *opening quote* rather than the specifier: the source
 *  being scanned has had literal interiors masked, so the text is recovered by position instead. */
const SITE_PATTERNS = [
  new RegExp(`\\bimport\\b(${CLAUSE})\\bfrom\\s*(["'\`])`, "gd"),
  new RegExp(`\\bexport\\b(${CLAUSE})\\bfrom\\s*(["'\`])`, "gd"),
  /\bimport\s+()(["'`])/dg,
  /\bimport\s*\(\s*()(["'`])/dg,
];

/** Index of the pattern producing dynamic `import(…)` sites, which are always value edges. */
const DYNAMIC_PATTERN = 3;

/** Punctuation after which a `/` opens a regex literal rather than dividing. */
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">"]);

/** Keywords after which a `/` opens a regex literal. Without these, `return /["']/` reads as a
 *  division followed by an unterminated string, and every import below it disappears. */
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "case", "in", "of", "do", "else", "yield", "await", "delete", "void", "new"]);

/** The masked source plus the text of every string literal, keyed by its opening quote's index. */
interface MaskedSource {
  masked: string;
  literals: Map<number, string>;
}

/** Whether the `/` at `index` opens a regex literal, judged from the preceding significant token. */
function opensRegex(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i] ?? "")) i--;
  const prev = text[i];
  if (i < 0 || prev === undefined) return true;
  if (REGEX_PRECEDERS.has(prev)) return true;
  if (!/[A-Za-z0-9_$]/.test(prev)) return false;

  let start = i;
  while (start >= 0 && /[A-Za-z0-9_$]/.test(text[start] ?? "")) start--;
  return REGEX_KEYWORDS.has(text.slice(start + 1, i + 1));
}

/**
 * Blanks out everything a regex must not read while keeping every character position and every
 * newline, so a match index still yields the right line number.
 *
 * Comments and literal interiors both become filler. A TSDoc block that writes `import { x } from
 * "./y"` as an example, and a test fixture that holds an import statement in a string, are the two
 * shapes that would otherwise invent an edge from a file that has none — and inventing an edge in a
 * declared leaf is the failure mode with no local evidence for the reader to check.
 *
 * Regex literals are masked too, because this codebase writes character classes like `["']` that
 * would otherwise open a string and swallow every real import below them.
 */
function maskSource(source: string): MaskedSource {
  const out: string[] = [];
  const literals = new Map<number, string>();
  const fill = (text: string) => text.replace(/[^\n]/g, MASK);

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      out.push(fill(source.slice(i, stop)));
      i = stop;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out.push(fill(source.slice(i, stop)));
      i = stop;
      continue;
    }

    if (char === "/" && opensRegex(source, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        j++;
      }
      if (j < source.length && source[j] === "/") {
        out.push("/", fill(source.slice(i + 1, j)), "/");
        i = j + 1;
        continue;
      }
      // Unterminated — not a regex after all; fall through and treat `/` as an ordinary character.
    }

    if (char === '"' || char === "'" || char === "`") {
      let j = i + 1;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === char) break;
        if (c === "\n" && char !== "`") break;
        j++;
      }
      const closed = j < source.length && source[j] === char;
      const body = source.slice(i + 1, j);
      out.push(char, fill(body), closed ? char : "");
      if (closed) literals.set(i, body);
      i = closed ? j + 1 : j;
      continue;
    }

    out.push(char ?? "");
    i++;
  }

  return { masked: out.join(""), literals };
}

/** Whether a single brace member is type-only. `{ type as t }` imports a binding *named* `type`
 *  under an alias, so the `as` form is excluded rather than counted. */
function isTypeMember(member: string): boolean {
  if (/^type\s+as\b/.test(member)) return false;
  return /^type\s+\S/.test(member);
}

/**
 * The kind of one static site, from its clause text.
 *
 * A brace clause counts as type-only only when *every* member carries the marker: a mixed
 * `import { type A, B }` still emits a runtime import of the module, so calling it a type edge
 * would erase a real dependency from the graph.
 */
function clauseKind(clause: string): EdgeKind {
  const text = clause.trim();
  if (/^type\b/.test(text)) return "type";

  const brace = text.match(/^\{([\s\S]*)\}$/);
  if (!brace) return "value";

  const members = (brace[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (members.length === 0) return "value";
  return members.every(isTypeMember) ? "type" : "value";
}

/** 1-indexed line number of a character offset. */
function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/**
 * Every module specifier `source` depends on: static `import`, `export … from` re-exports, bare
 * side-effect imports, and dynamic `import(…)`.
 *
 * Re-exports are included because a barrel that forwards a symbol depends on the module it forwards
 * from just as surely as a caller does — omitting them would let a namespace acquire a dependency
 * simply by re-exporting it, which is the one shape a barrel makes easy.
 *
 * Sites are keyed by the position of their specifier, so the four patterns cannot double-count a
 * single statement, and are returned in source order.
 */
export function parseImports(source: string): ImportRef[] {
  const { masked, literals } = maskSource(source);
  const byIndex = new Map<number, ImportRef>();

  for (let p = 0; p < SITE_PATTERNS.length; p++) {
    const site = SITE_PATTERNS[p];
    if (site === undefined) continue;
    const pattern = new RegExp(site.source, site.flags);
    for (const match of masked.matchAll(pattern)) {
      const quoteAt = match.indices?.[2]?.[0];
      if (quoteAt === undefined) continue;
      const specifier = literals.get(quoteAt);
      if (specifier === undefined) continue;

      const kind = p === DYNAMIC_PATTERN ? "value" : clauseKind(match[1] ?? "");
      const existing = byIndex.get(quoteAt);
      if (existing && existing.kind === "value") continue;
      byIndex.set(quoteAt, { line: lineAt(source, quoteAt), specifier, kind });
    }
  }

  return [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, ref]) => ref);
}

/** Whether a file is test-only. Load-bearing: counting test files turns declared leaves into
 *  integration namespaces and invents edges to the fixture namespace that no shipped module has. */
export function isTestSource(path: string): boolean {
  return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * The namespace owning a repo-relative file, or `null` when it sits outside every namespace.
 *
 * The match is longest-prefix, not first-match: `storage/db` and `storage` can both be namespaces,
 * and attributing `src/storage/db/x.ts` to the shorter one would silently merge a nested namespace
 * into its parent and hide every edge between them. `dirs` arrives already relative to `src/` — the
 * caller derives it, this module never does.
 */
export function namespaceOf(file: string, dirs: readonly string[]): string | null {
  const normalized = posix.normalize(file);
  if (!normalized.startsWith("src/")) return null;
  const relative = normalized.slice("src/".length);

  let best: string | null = null;
  for (const dir of dirs) {
    if (relative !== dir && !relative.startsWith(`${dir}/`)) continue;
    if (best === null || dir.length > best.length) best = dir;
  }
  return best;
}

/**
 * A specifier as a repo-relative path with its extension stripped, or `null` when it is external.
 *
 * Attribution is a directory-prefix question, so no disk resolution is needed and none is
 * attempted: whether `./x` is `x.ts`, `x/mod.ts` or nonexistent does not change which namespace
 * owns it. Bare specifiers (`valibot`, `@remix-run/headers`, `node:path`) are external and are not
 * namespace edges.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

  const joined = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const extension = MODULE_EXTENSIONS.find((ext) => joined.endsWith(ext));
  return extension ? joined.slice(0, -extension.length) : joined;
}

/**
 * The observed dependency graph: source namespace → target namespace → the edge between them.
 *
 * Self-edges are dropped, since a namespace importing its own files is the normal case and says
 * nothing about coupling. Edge kind is the AND over every contributing site: one value import
 * anywhere makes the whole edge a value edge, because it is the runtime dependency that a leaf
 * classification actually forbids.
 *
 * When a value site overrides an earlier type-only edge, the recorded site moves with it. Reporting
 * a value edge while pointing at a `import type` line sends the reader to a line that looks
 * blameless, and a message that cannot be checked is worse than no message.
 */
export function buildGraph(files: readonly SourceFile[], dirs: readonly string[]): Map<string, Map<string, ObservedEdge>> {
  const graph = new Map<string, Map<string, ObservedEdge>>();

  for (const file of files) {
    if (isTestSource(file.path)) continue;
    const from = namespaceOf(file.path, dirs);
    if (from === null) continue;

    for (const ref of parseImports(file.source)) {
      const resolved = resolveSpecifier(file.path, ref.specifier);
      if (resolved === null) continue;
      const to = namespaceOf(resolved, dirs);
      if (to === null || to === from) continue;

      let targets = graph.get(from);
      if (!targets) {
        targets = new Map<string, ObservedEdge>();
        graph.set(from, targets);
      }

      const existing = targets.get(to);
      if (!existing) {
        targets.set(to, { kind: ref.kind, file: file.path, line: ref.line });
        continue;
      }
      if (existing.kind === "type" && ref.kind === "value") {
        targets.set(to, { kind: "value", file: file.path, line: ref.line });
      }
    }
  }

  return graph;
}

/** The graph as declared: the primitive set, the leaf set, and every intended edge. */
export interface DeclaredGraph {
  /** Namespaces exempt as an import *target*; an edge out of one is a closure violation. */
  primitives: readonly string[];
  /** Namespaces declared to have no cross-namespace edge at all. */
  leaf: readonly string[];
  /** Source namespace → target namespace → the declared kind. */
  edges: Record<string, Record<string, EdgeKind>>;
}

/** The six ways the observed tree and the declaration can disagree. Each names a different defect,
 *  and each carries a different remedy. */
export type FindingKind = "undeclared-edge" | "absent-edge" | "leaf-edge" | "kind-mismatch" | "primitive-escape" | "unknown-namespace";

/** One disagreement, with the site that proves it where the observed tree supplies one. */
export interface Finding {
  kind: FindingKind;
  /** The source namespace, or the namespace the declaration names. */
  from: string;
  /** The target namespace, absent only when the finding is about `from` alone. */
  to?: string;
  /** Repo-relative path of the first offending site — absent for findings about a declared edge
   *  that no file produces, which by definition have no site. */
  file?: string;
  /** 1-indexed line within `file`. */
  line?: number;
  /** Reason and remedy, ready to print after the caller's subject. */
  detail: string;
}

/** Sorted keys, so a findings list is a function of the graph and not of insertion order. */
function sortedKeys<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort();
}

/**
 * Every disagreement between the observed graph and the declaration.
 *
 * Edges *into* a primitive are dropped before anything else, which is the §4c exemption and the
 * reason this is not simply a set difference: some thirty of them exist and none is a coupling
 * decision anyone made. The exemption is target-only — a remaining edge whose *source* is a
 * primitive is the closure property failing, and is reported rather than waved through.
 *
 * A leaf violation yields two findings, `leaf-edge` and `undeclared-edge`, because they are two
 * different statements and either could be the one that is wrong: the import may be the mistake, or
 * the leaf classification may be. A `primitive-escape` yields one, since there its remedy is not in
 * question — the import goes.
 */
export function diffGraph(observed: Map<string, Map<string, ObservedEdge>>, declared: DeclaredGraph, namespaces: readonly string[]): Finding[] {
  const known = new Set(namespaces);
  const primitives = new Set(declared.primitives);
  const leaf = new Set(declared.leaf);
  const findings: Finding[] = [];

  for (const from of sortedKeys(declared.edges)) {
    if (!known.has(from)) {
      findings.push({
        kind: "unknown-namespace",
        from,
        detail: `\`EDGES\` declares edges out of \`${from}\`, which owns no \`mod.ts\` export subpath — remove \`EDGES["${from}"]\`, or give \`${from}\` a subpath in \`package.json\` \`exports\``,
      });
    }
    // `from` came out of this same record's own keys, so the miss branch is a formality.
    const declaredTargets = declared.edges[from];
    if (declaredTargets === undefined) continue;
    for (const to of sortedKeys(declaredTargets)) {
      if (known.has(to)) continue;
      findings.push({
        kind: "unknown-namespace",
        from,
        to,
        detail: `\`EDGES["${from}"]\` names the target \`${to}\`, which owns no \`mod.ts\` export subpath — remove that entry, or give \`${to}\` a subpath in \`package.json\` \`exports\``,
      });
    }
  }

  const seen = new Set<string>();

  for (const from of [...observed.keys()].sort()) {
    const targets = observed.get(from) as Map<string, ObservedEdge>;
    for (const to of [...targets.keys()].sort()) {
      if (primitives.has(to)) continue;
      const edge = targets.get(to) as ObservedEdge;
      seen.add(`${from} ${to}`);

      if (primitives.has(from)) {
        findings.push({
          kind: "primitive-escape",
          from,
          to,
          file: edge.file,
          line: edge.line,
          detail: `\`${from}\` is a foundational primitive in \`PRIMITIVES\` but imports \`${to}\`, which is not — the primitive set is closed, and an edge out of it puts every consumer of \`${from}\` behind \`${to}\`; remove the import`,
        });
        continue;
      }

      if (leaf.has(from)) {
        findings.push({
          kind: "leaf-edge",
          from,
          to,
          file: edge.file,
          line: edge.line,
          detail: `\`${from}\` is declared leaf in \`LEAF\` but imports \`${to}\` — remove the import, or drop \`${from}\` from \`LEAF\` and declare the edge in \`EDGES\``,
        });
      }

      const declaredKind = declared.edges[from]?.[to];
      if (declaredKind === undefined) {
        findings.push({
          kind: "undeclared-edge",
          from,
          to,
          file: edge.file,
          line: edge.line,
          detail: `\`${from}\` imports \`${to}\` but \`EDGES\` declares no such edge — add \`"${to}": "${edge.kind}"\` to \`EDGES["${from}"]\`, or remove the import`,
        });
        continue;
      }

      if (declaredKind !== edge.kind) {
        const remedy =
          edge.kind === "value"
            ? `make the import \`import type\`, or change \`EDGES["${from}"]["${to}"]\` to \`"value"\``
            : `change \`EDGES["${from}"]["${to}"]\` to \`"type"\``;
        findings.push({
          kind: "kind-mismatch",
          from,
          to,
          file: edge.file,
          line: edge.line,
          detail: `\`${from}\` imports \`${to}\` as a \`${edge.kind}\` edge but \`EDGES\` declares \`${declaredKind}\` — ${remedy}`,
        });
      }
    }
  }

  for (const from of sortedKeys(declared.edges)) {
    const declaredTargets = declared.edges[from];
    if (declaredTargets === undefined) continue;
    for (const to of sortedKeys(declaredTargets)) {
      if (seen.has(`${from} ${to}`)) continue;
      const reason = primitives.has(to)
        ? `\`${to}\` is a foundational primitive in \`PRIMITIVES\`, and an import of one is not an edge`
        : `no non-test source file imports it`;
      findings.push({
        kind: "absent-edge",
        from,
        to,
        detail: `\`EDGES\` declares \`${from}\` → \`${to}\` but ${reason} — remove \`"${to}"\` from \`EDGES["${from}"]\``,
      });
    }
  }

  return findings;
}
