import { resolve } from "node:path";

import { fnv1a } from "../corpus/hash";
import type { Tree } from "../types";
import { loadRuleSources } from "./load";
import { proseLines } from "./markers";
import type { RuleSource } from "./types";

const MARKER = /<!--\s*rule:\s*([^\s>]*?)\s*-->/g;

/** What `ruleStatements` reads. @internal */
export interface RuleStatementsOptions {
  root: string;
  kind: Tree;
  /** The canon trees whose rule files are read. Defaults to `shared` and `kind`, the trees the index serves. */
  trees?: readonly Tree[];
  /** The installed library's root, whose own rule file states the rules its served documents mark. */
  dependencyRoot?: string;
}

function sourcesOrThrow(root: string, trees: readonly Tree[]): RuleSource[] {
  const sources = loadRuleSources({ root, trees });
  if (!sources.ok) throw new Error(sources.error);
  return sources.data;
}

/** Every statement the served corpora's rule files declare, keyed by rule id; throws when a rule file does not load. @internal */
export function ruleStatements(options: RuleStatementsOptions): ReadonlyMap<string, string> {
  const { root, kind } = options;
  const trees = options.trees ?? (kind === "shared" ? ["shared"] : ["shared", kind]);
  const sources = sourcesOrThrow(root, trees);
  const { dependencyRoot } = options;
  if (dependencyRoot !== undefined && resolve(dependencyRoot) !== resolve(root)) sources.push(...sourcesOrThrow(dependencyRoot, []));
  return new Map(sources.flatMap((source) => source.entries.map((entry) => [entry.id, entry.statement] as const)));
}

/** `source` with each known marker outside code preceded by its statement in bold; an unknown id is left as written. @internal */
export function renderStatements(source: string, statements: ReadonlyMap<string, string>): string {
  if (statements.size === 0) return source;
  const prose = proseLines(source);
  return source
    .split("\n")
    .map((line, index) =>
      [...(prose[index] ?? "").matchAll(MARKER)]
        .filter((marker) => statements.has(marker[1] ?? ""))
        .reduceRight(
          (rendered, marker) => `${rendered.slice(0, marker.index)}**${statements.get(marker[1] ?? "")}** ${rendered.slice(marker.index)}`,
          line,
        ),
    )
    .join("\n");
}

/** A digest of every statement, so an index knows a statement moved when no document did. @internal */
export function statementsDigest(statements: ReadonlyMap<string, string>): string {
  const entries = [...statements].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return fnv1a(entries.map(([id, statement]) => `${id}\u0000${statement}`).join("\n"));
}
