import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, relative, resolve, sep } from "node:path";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { collectFiles, isTestSource } from "../../../src/tooling/gate/checks/source-scan";
import { canonSources, localSources, repoRelative } from "../corpus/source";
import { CANON_ROOT, RULES_CANON_ROOT } from "../paths";
import type { Kind, SourceDoc, Tree } from "../types";
import { collectMarkers } from "./markers";
import { buildRegister } from "./resolve";
import type { RegisteredRule, RuleEntry, RuleSource } from "./types";

const ALL_TREES: readonly Tree[] = ["shared", "libs", "apps"];

const load = createRequire(import.meta.url);

/** Every canon tree where the canon is authored inside `root` rather than installed under it, else `shared` and `kind`. @public */
export function registerTrees(root: string, kind: Kind, canonRoot = CANON_ROOT): Tree[] {
  const fromRoot = relative(resolve(root), resolve(canonRoot)).split(sep);
  const authoredHere = fromRoot[0] !== ".." && !fromRoot.includes("node_modules");
  return authoredHere ? [...ALL_TREES] : ["shared", kind];
}

/** The canon documents of `trees` and the repository's own, which is every document a marker may sit in. @public */
export function ruleDocuments(root: string, kind: Kind, trees: readonly Tree[], canonRoot = CANON_ROOT): SourceDoc[] {
  const canon = trees.flatMap((tree) => canonSources(tree, canonRoot).filter((doc) => doc.tree === tree));
  return [...canon, ...localSources(root, kind)].map((doc) => ({ ...doc, path: doc.path.split(sep).join(posix.sep) }));
}

/** What `loadRuleSources` reads. @public */
export interface RuleSourcesOptions {
  root: string;
  /** The canon trees whose rule files are read. */
  trees: readonly Tree[];
  /** The repository's own rule file, relative to `root`; an absent file declares nothing. Defaults to `config/rules.config.ts`. */
  rulesFile?: string;
  /** Walked for `<tree>/<DOC>.ts`, each mirroring one canon document. Defaults to `RULES_CANON_ROOT`. */
  canonRulesRoot?: string;
}

function entriesOf(file: string, label: string): Result<readonly RuleEntry[], string> {
  let module: unknown;
  try {
    module = load(file);
  } catch (error) {
    return err(`${label}: could not be loaded — ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = (module as { default?: unknown }).default;
  if (!Array.isArray(entries)) return err(`${label}: the default export is not an array of rule entries — export \`defineRules([...])\``);
  return ok(entries as readonly RuleEntry[]);
}

/** The repository's rule file and every canon rule file under `trees`, read synchronously, or the first that fails to load. @public */
export function loadRuleSources(options: RuleSourcesOptions): Result<RuleSource[], string> {
  const { root, trees } = options;
  const rulesFile = options.rulesFile ?? "config/rules.config.ts";
  const canonRulesRoot = options.canonRulesRoot ?? RULES_CANON_ROOT;
  const sources: RuleSource[] = [];

  const repoFile = resolve(root, rulesFile);
  if (existsSync(repoFile)) {
    const entries = entriesOf(repoFile, rulesFile);
    if (!entries.ok) return entries;
    sources.push({ origin: "repo", file: repoRelative(root, repoFile), entries: entries.data });
  }

  for (const tree of trees) {
    for (const entry of collectFiles(canonRulesRoot, tree, (name) => name.endsWith(".ts") && !isTestSource(name))) {
      const file = resolve(canonRulesRoot, entry);
      const declaredIn = repoRelative(root, file);
      const entries = entriesOf(file, declaredIn);
      if (!entries.ok) return entries;
      const doc = `${entry.slice(tree.length + 1, -".ts".length)}.md`;
      sources.push({ origin: "canon", file: declaredIn, tree, doc, entries: entries.data });
    }
  }
  return ok(sources);
}

/** The rules that join their markers, loaded from the rule files of `trees` and the documents those trees and the repository hold. @internal */
export function loadRegister(options: RuleSourcesOptions & { kind: Kind; canonRoot?: string }): Result<RegisteredRule[], string> {
  const { root, kind, trees } = options;
  const sources = loadRuleSources(options);
  if (!sources.ok) return sources;
  const { sites } = collectMarkers(root, ruleDocuments(root, kind, trees, options.canonRoot ?? CANON_ROOT));
  return ok(buildRegister(sources.data, sites, kind).rules);
}
