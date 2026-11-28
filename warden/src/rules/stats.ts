import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { linkDefinitions, stripFences } from "../checks/docs";
import { localSources, repoRelative } from "../corpus/source";
import { CANON_ROOT } from "../paths";
import type { Kind } from "../types";
import { ruleDocuments } from "./load";
import type { DetectorClass, RegisteredRule, RuleStats } from "./types";

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

const WORD = /[\p{L}\p{N}]/u;

/** The strongest detector a rule carries: a lint key, step or failing pattern, else a test, else a triaged pattern, else the runtime, else review alone. @public */
export function detectorClass(rule: Pick<RegisteredRule, "detectors">): DetectorClass {
  const kinds = new Set(rule.detectors.map((detector) => (detector.kind === "rg" ? `rg:${detector.level}` : detector.kind)));
  if (kinds.has("lint") || kinds.has("step") || kinds.has("rg:fail")) return "automated";
  if (kinds.has("test")) return "test";
  if (kinds.has("rg:warn")) return "triaged";
  if (kinds.has("runtime")) return "runtime";
  return "review-only";
}

/** How many of `rules` fall in each detector class. @public */
export function ruleStats(rules: readonly Pick<RegisteredRule, "detectors">[]): RuleStats {
  const byClass: Record<DetectorClass, number> = { automated: 0, test: 0, triaged: 0, runtime: 0, "review-only": 0 };
  for (const rule of rules) byClass[detectorClass(rule)]++;
  return { total: rules.length, byClass };
}

/** The prose words of a markdown file: whitespace tokens holding a letter or digit, outside frontmatter, code, comments and link definitions. @public */
export function countWords(markdown: string): number {
  const lines = stripFences(markdown.replace(FRONTMATTER, ""));
  const definitions = new Set([...linkDefinitions(lines).values()].map(({ line }) => line - 1));
  const prose = lines.filter((_line, index) => !definitions.has(index)).join("\n");
  return prose
    .replace(HTML_COMMENT, " ")
    .split(/\s+/)
    .filter((token) => WORD.test(token)).length;
}

/** The repository-relative documents whose words a repository budgets: its own, and every canon tree where it is the canon's home. @public */
export function ownedDocuments(root: string, kind: Kind, canonHome: boolean, canonRoot = CANON_ROOT): string[] {
  const docs = canonHome ? ruleDocuments(root, kind, ["shared", "libs", "apps"], canonRoot) : localSources(root, kind);
  return docs.map((doc) => repoRelative(root, doc.file));
}

/** Each of `documents`' word count, keyed by the repository-relative path. @public */
export function corpusWords(root: string, documents: readonly string[]): ReadonlyMap<string, number> {
  return new Map(documents.map((path) => [path, countWords(readFileSync(resolve(root, path), "utf-8"))]));
}
