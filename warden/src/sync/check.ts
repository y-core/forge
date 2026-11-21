import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { CANON_ROOT } from "../paths";
import type { CorpusFile, Divergence, SyncPlan, SyncTree } from "../types";
import { layerTree, render, walk } from "./sync";

// Both link forms: under reference style the destination is not on the prose line at all, it is in
// the definition block — which is exactly where a boundary-crossing path would now hide.
const DOCS_HREF = /\]\(([^)]*\bdocs\/[^)]*)\)|^ {0,3}\[[^\]]+\]:[ \t]+(\S*\bdocs\/\S*)/gm;

// Spelled as `git check-ignore` reads a path: a trailing slash marks a directory, and `.env` with `.env.local` stand for `.env*`.
/** What every repository's `.gitignore` must ignore. @public */
export const MUST_IGNORE: readonly string[] = [
  ".claude/settings.local.json",
  ".dev.vars",
  ".env",
  ".env.local",
  ".forge/",
  "tmp/",
  "test-results/",
  "playwright-report/",
  "coverage/",
  ".wrangler/",
  ".DS_Store",
];

// The skill a code review starts at; `CLAUDE.md` names it wherever sync has written it.
const REVIEW_SKILL = "warden-review";

// `source:line:pattern<TAB>path`; a path no pattern matches prints as `::<TAB>path`.
const CHECK_IGNORE_LINE = /^(.*?):(\d*):(.*)\t(.+)$/;

/** Compares one synced tree against the installed corpus, sources layered in the order `sync` copies them. @public */
export function checkTree(repo: string, { tree, from }: SyncTree, slug: string): Divergence[] {
  const to = resolve(repo, tree);
  const expected = layerTree(from, slug);
  const actual = new Set(walk(to));
  const problems: Divergence[] = [];
  for (const [file, text] of expected) {
    if (!actual.has(file)) problems.push({ code: "missing", detail: `${tree}/${file}` });
    else if (text !== readFileSync(join(to, file), "utf-8")) problems.push({ code: "modified", detail: `${tree}/${file}` });
  }
  for (const file of actual) {
    if (!expected.has(file)) problems.push({ code: "extra", detail: `${tree}/${file}` });
  }
  return problems;
}

/** Compares each synced file against its rendered corpus source. @public */
export function checkFiles(repo: string, files: readonly CorpusFile[], slug: string): Divergence[] {
  return files.flatMap(({ file, from }): Divergence[] => {
    if (!existsSync(from)) return [];
    const to = resolve(repo, file);
    if (!existsSync(to)) return [{ code: "missing", detail: file }];
    return render(from, slug) === readFileSync(to, "utf-8") ? [] : [{ code: "modified", detail: file }];
  });
}

/** Holds the repository's `.gitignore` and index to the fleet's git hygiene, reading git and never writing it. @public */
export function checkGit(repo: string, synced: readonly CorpusFile[]): Divergence[] {
  const git = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (git(["rev-parse", "--is-inside-work-tree"]).stdout.trim() !== "true") {
    return [{ code: "git", detail: "not a git repository — the .gitignore and tracking checks measured nothing" }];
  }

  const committed = synced.map(({ file }) => file);
  // `--no-index` asks what the patterns say whatever is tracked; a pattern from the global excludes file or
  // `.git/info/exclude` is one machine's, so only a `.gitignore` inside the repository counts as ignoring.
  const verdicts = new Map<string, boolean>();
  for (const line of git(["check-ignore", "--no-index", "-v", "-n", "--", ...MUST_IGNORE, ...committed]).stdout.split("\n")) {
    const match = CHECK_IGNORE_LINE.exec(line);
    if (match === null) continue;
    const [, source = "", , pattern = "", path = ""] = match;
    verdicts.set(path, source !== "" && !isAbsolute(source) && basename(source) === ".gitignore" && !pattern.startsWith("!"));
  }

  const problems: Divergence[] = [];
  for (const path of MUST_IGNORE) {
    if (verdicts.get(path) !== true) problems.push({ code: "unignored", detail: `${path} — add it to .gitignore` });
  }
  for (const path of committed) {
    if (verdicts.get(path) === true)
      problems.push({ code: "ignored", detail: `${path} — sync writes it to be committed; .gitignore must not ignore it` });
  }
  // A tracked copy already deleted from the working tree is a removal awaiting the user's commit, which no agent can stage.
  const lines = (args: string[]) => git(args).stdout.split("\n").filter(Boolean);
  const pending = new Set(lines(["ls-files", "--deleted", "--", ":(glob)**/settings.local.json"]));
  for (const path of lines(["ls-files", "--", ":(glob)**/settings.local.json"]).filter((file) => !pending.has(file))) {
    problems.push({ code: "tracked", detail: `${path} — personal settings; remove it from the index and keep it untracked` });
  }
  return problems;
}

/** Reconciles the agents `CLAUDE.md` names with the definitions under `.claude/agents`, and the review skill with `.claude/skills`. @public */
export function checkAgents(repo: string): Divergence[] {
  const claude = resolve(repo, "CLAUDE.md");
  const text = existsSync(claude) ? readFileSync(claude, "utf-8") : "";
  const defined = walk(resolve(repo, ".claude/agents"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length));
  const named = new Set([...text.matchAll(/\bcc-[a-z][a-z-]*\b/g)].map((match) => match[0] ?? ""));

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
  if (existsSync(resolve(repo, ".claude/skills", REVIEW_SKILL)) && !new RegExp(`\\b${REVIEW_SKILL}\\b`).test(text)) {
    problems.push({ code: "unnamed", detail: `${REVIEW_SKILL} — a code review starts at it, and CLAUDE.md never says so` });
  }
  return problems;
}

/** Reports any markdown link in the canon whose target reaches into a repository's own `docs/`. @public */
export function checkBoundary(canonRoot = CANON_ROOT): Divergence[] {
  const problems: Divergence[] = [];
  for (const file of walk(canonRoot).filter((name) => name.endsWith(".md"))) {
    const source = readFileSync(resolve(canonRoot, file), "utf-8");
    for (const match of source.matchAll(DOCS_HREF)) {
      problems.push({
        code: "boundary",
        detail: `${file} links \`${match[1] ?? match[2] ?? ""}\` — governance never cites a repository's own docs/`,
      });
    }
  }
  return problems;
}

/** Every divergence between the repository and what a sync plans for it. @public */
export function check(repo: string, { trees, files, slug }: SyncPlan, canonRoot = CANON_ROOT): Divergence[] {
  return [
    ...trees.flatMap((tree) => checkTree(repo, tree, slug)),
    ...checkFiles(repo, files, slug),
    ...checkGit(repo, files),
    ...checkAgents(repo),
    ...checkBoundary(canonRoot),
  ];
}
