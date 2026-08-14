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
  /** A site consistent with `kind`, chosen at the kind finally reported. */
  file: string;
  /** 1-indexed line within `file`. */
  line: number;
}

/** Filler for masked comment and literal interiors: same length, never a quote, never whitespace. */
const MASK = "\u0001";

/** Extensions a specifier may carry that must be stripped before namespace attribution. */
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js"];

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".browser.ts", ".browser.tsx"];

/** Characters an import/export clause may contain between the keyword and its `from`. */
const CLAUSE = "[A-Za-z0-9_$,{}\\s*]*?";

/** The import and export forms, each capturing the opening quote because literal interiors are masked. */
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

// Without these keywords `return /["']/` reads as a division followed by an unterminated string.
/** Keywords after which a `/` opens a regex literal. */
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

/** Blanks out comments, literal interiors, and regex literals, preserving every character position. */
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

// `{ type as t }` imports a binding *named* `type` under an alias, so the `as` form is excluded.
/** Whether a single brace member is type-only. */
function isTypeMember(member: string): boolean {
  if (/^type\s+as\b/.test(member)) return false;
  return /^type\s+\S/.test(member);
}

// A mixed `import { type A, B }` still emits a runtime import, so it is not a type edge.
/** The kind of one static site, from its clause text. */
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

/** Every module specifier `source` depends on, including re-exports and dynamic imports, in source order. */
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

/** Whether a file is test-only. */
export function isTestSource(path: string): boolean {
  return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** The namespace owning a repo-relative file by longest prefix, or `null` when it sits outside every namespace. */
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

/** A specifier as a repo-relative path with its extension stripped, or `null` when it is external. */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

  const joined = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const extension = MODULE_EXTENSIONS.find((ext) => joined.endsWith(ext));
  return extension ? joined.slice(0, -extension.length) : joined;
}

/** The observed dependency graph: source namespace to target namespace to the edge between them. */
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

/** The six ways the observed tree and the declaration can disagree. */
export type GraphFindingKind = "undeclared-edge" | "absent-edge" | "leaf-edge" | "kind-mismatch" | "primitive-escape" | "unknown-namespace";

/** One disagreement, with the site that proves it where the observed tree supplies one. */
export interface GraphFinding {
  kind: GraphFindingKind;
  /** The source namespace, or the namespace the declaration names. */
  from: string;
  /** The target namespace, absent only when the finding is about `from` alone. */
  to?: string;
  /** Repo-relative path of the first offending site. */
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

/** Every disagreement between the observed graph and the declaration. */
export function diffGraph(
  observed: Map<string, Map<string, ObservedEdge>>,
  declared: DeclaredGraph,
  namespaces: readonly string[],
): GraphFinding[] {
  const known = new Set(namespaces);
  const primitives = new Set(declared.primitives);
  const leaf = new Set(declared.leaf);
  const findings: GraphFinding[] = [];

  for (const from of sortedKeys(declared.edges)) {
    if (!known.has(from)) {
      findings.push({
        kind: "unknown-namespace",
        from,
        detail: `\`EDGES\` declares edges out of \`${from}\`, which owns no \`mod.ts\` export subpath — remove \`EDGES["${from}"]\`, or give \`${from}\` a subpath in \`package.json\` \`exports\``,
      });
    }
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

/** The classification section, whose prose cites `EDGES` and must enumerate nothing. */
const CLASSIFICATION_START = /^### 4a\. /;

/** The catalog section, whose table names every export subpath. */
const CATALOG_START = /^### 3a\. /;

/** The header row of the enumeration table that `EDGES` replaced. */
const COMPOSES_TABLE = /^\|\s*Namespace\s*\|\s*Composes\s*\|/;

/** A catalog header row carrying leaf/integration or side-effect status as a column. */
const CLASSIFICATION_COLUMN = /^\|.*\|\s*(?:Category|Classification)\s*\|/;

/** The half-open line range from the first heading matching `start` to the next `## `, or `null` when absent. */
export function sectionWindow(lines: readonly string[], start: RegExp): { from: number; to: number } | null {
  const from = lines.findIndex((line) => start.test(line));
  if (from === -1) return null;

  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && /^## /.test(line)) return { from, to: i };
  }
  return { from, to: lines.length };
}

/** The four ways the document can carry an enumeration the data files own. */
export type EnumerationFindingKind = "missing-catalog-section" | "missing-classification-section" | "composes-table" | "classification-column";

/** One enumeration finding, carrying no message because its remedy is a fixed string the caller emits. */
export interface EnumerationFinding {
  kind: EnumerationFindingKind;
  /** 1-indexed line, or null for a missing section. */
  line: number | null;
}

/** Every enumeration the document carries: the classification section first, then the catalog. */
export function findEnumerations(lines: readonly string[]): EnumerationFinding[] {
  const findings: EnumerationFinding[] = [];

  const classification = sectionWindow(lines, CLASSIFICATION_START);
  if (classification === null) {
    findings.push({ kind: "missing-classification-section", line: null });
  } else {
    for (let i = classification.from; i < classification.to; i++) {
      const line = lines[i];
      if (line === undefined || !COMPOSES_TABLE.test(line)) continue;
      findings.push({ kind: "composes-table", line: i + 1 });
    }
  }

  const catalog = sectionWindow(lines, CATALOG_START);
  if (catalog === null) {
    findings.push({ kind: "missing-catalog-section", line: null });
    return findings;
  }
  for (let i = catalog.from; i < catalog.to; i++) {
    const line = lines[i];
    if (line === undefined || !CLASSIFICATION_COLUMN.test(line)) continue;
    findings.push({ kind: "classification-column", line: i + 1 });
  }

  return findings;
}
