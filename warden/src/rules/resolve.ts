import { chunkId } from "../corpus/ident";
import type { Kind } from "../types";
import type { RegisteredRule, RegisterProblem, RuleEntry, RuleMarkerSite, RuleSource } from "./types";

interface Declared {
  readonly entry: RuleEntry;
  readonly source: RuleSource;
}

function scopeOf(site: RuleMarkerSite, kind: Kind): readonly Kind[] {
  if (site.corpus === "project") return [kind];
  return site.tree === "libs" || site.tree === "apps" ? [site.tree] : ["libs", "apps"];
}

function markedWhereDeclared(site: RuleMarkerSite, source: RuleSource): boolean {
  if (source.origin === "repo") return site.corpus === "project";
  return site.corpus === "canon" && site.tree === source.tree && site.path === source.doc;
}

/** Joins every entry to its marker, deriving origin, scope and rationale, and reports each that does not join. @public */
export function buildRegister(
  sources: readonly RuleSource[],
  sites: readonly RuleMarkerSite[],
  kind: Kind,
): { rules: RegisteredRule[]; problems: RegisterProblem[] } {
  const problems: RegisterProblem[] = [];

  const declared = new Map<string, Declared>();
  for (const source of sources) {
    for (const entry of source.entries) {
      const first = declared.get(entry.id);
      if (first === undefined) declared.set(entry.id, { entry, source });
      else problems.push({ kind: "duplicate-entry", id: entry.id, file: source.file, other: first.source.file });
    }
  }

  const marked = new Map<string, RuleMarkerSite>();
  for (const site of sites) {
    const first = marked.get(site.id);
    if (first === undefined) marked.set(site.id, site);
    else problems.push({ kind: "duplicate-marker", id: site.id, file: site.file, line: site.line, other: `${first.file}:${first.line}` });
  }

  const rules: RegisteredRule[] = [];
  for (const [id, { entry, source }] of declared) {
    const site = marked.get(id);
    if (site === undefined) {
      problems.push({ kind: "no-marker", id, file: source.file });
      continue;
    }
    if (!markedWhereDeclared(site, source)) {
      problems.push({ kind: "origin-mismatch", id, file: site.file, line: site.line, other: source.file });
      continue;
    }
    if (site.section === undefined) {
      problems.push({ kind: "no-section", id, file: site.file, line: site.line });
      continue;
    }
    rules.push({
      id,
      statement: entry.statement,
      detectors: entry.detectors,
      origin: source.origin,
      scope: scopeOf(site, kind),
      rationale: {
        corpus: site.corpus,
        ...(site.tree === undefined ? {} : { tree: site.tree }),
        path: site.path,
        section: site.section,
        line: site.line,
        chunk: chunkId(site.corpus, site.path, site.section),
      },
      declaredIn: source.file,
    });
  }

  for (const site of marked.values()) {
    if (!declared.has(site.id)) problems.push({ kind: "no-entry", id: site.id, file: site.file, line: site.line });
  }
  return { rules, problems };
}
