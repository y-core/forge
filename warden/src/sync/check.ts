import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CANON_ROOT } from "../paths";
import type { Divergence, SyncTree } from "../types";
import { identical, walk } from "./sync";

const DOCS_HREF = /\]\(([^)]*\bdocs\/[^)]*)\)/g;

/** Compares one synced tree against the installed corpus. @public */
export function checkTree(repo: string, { tree, from }: SyncTree): Divergence[] {
  const to = resolve(repo, tree);
  const expected = new Set(walk(from));
  const actual = new Set(walk(to));
  const problems: Divergence[] = [];
  for (const file of expected) {
    if (!actual.has(file)) problems.push({ code: "missing", detail: `${tree}/${file}` });
    else if (!identical(join(from, file), join(to, file))) problems.push({ code: "modified", detail: `${tree}/${file}` });
  }
  for (const file of actual) {
    if (!expected.has(file)) problems.push({ code: "extra", detail: `${tree}/${file}` });
  }
  return problems;
}

/** Reconciles the agents `CLAUDE.md` names with the definitions under `.claude/agents`. @public */
export function checkAgents(repo: string): Divergence[] {
  const claude = resolve(repo, "CLAUDE.md");
  const defined = walk(resolve(repo, ".claude/agents"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length));
  const named = existsSync(claude)
    ? new Set([...readFileSync(claude, "utf-8").matchAll(/\bcc-[a-z][a-z-]*\b/g)].map((match) => match[0] ?? ""))
    : new Set<string>();

  if (defined.length === 0 && named.size === 0) {
    return [{ code: "absent", detail: "no agent is defined and none is named — this check measured nothing" }];
  }

  const problems: Divergence[] = [];
  for (const name of named) {
    if (!defined.includes(name)) problems.push({ code: "undefined", detail: `${name} — CLAUDE.md names it and .claude/agents does not define it` });
  }
  for (const name of defined) {
    if (!named.has(name)) problems.push({ code: "unnamed", detail: `${name} — it is defined and CLAUDE.md never names it` });
  }
  return problems;
}

/** Reports any markdown link in the canon whose target reaches into a repository's own `docs/`.
 *
 *  Links run one way — implementation may cite governance, governance never cites implementation —
 *  and the canon is byte-identical everywhere, so such a link resolves in the repository that wrote
 *  it and dangles in every other. This is the check `AGENT_GUIDE.md` §5d names. @public */
export function checkBoundary(canonRoot = CANON_ROOT): Divergence[] {
  const problems: Divergence[] = [];
  for (const file of walk(canonRoot).filter((name) => name.endsWith(".md"))) {
    const source = readFileSync(resolve(canonRoot, file), "utf-8");
    for (const match of source.matchAll(DOCS_HREF)) {
      problems.push({ code: "boundary", detail: `${file} links \`${match[1] ?? ""}\` — governance never cites a repository's own docs/` });
    }
  }
  return problems;
}

/** Every divergence between the repository's synced trees and the installed corpus. @public */
export function check(repo: string, trees: readonly SyncTree[], canonRoot = CANON_ROOT): Divergence[] {
  return [...trees.flatMap((tree) => checkTree(repo, tree)), ...checkAgents(repo), ...checkBoundary(canonRoot)];
}
