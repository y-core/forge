import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { check, checkAgents, checkBoundary, checkFiles, checkGit, checkTree, MUST_IGNORE } from "./check";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", args, { cwd, stdio: "ignore" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
}

/** A git repository holding `files`, with `.gitignore` ignoring every path the fleet requires unless `files` sets its own. */
function gitRepo(files: Record<string, string>, prefix: string): string {
  const root = tree({ ".gitignore": `${MUST_IGNORE.join("\n")}\n`, ...files }, prefix);
  git(root, "init", "-q");
  return root;
}

const SYNCED = [
  { file: ".claude/settings.json", from: "/corpus/settings.json" },
  { file: ".codex/config.toml.example", from: "/corpus/config.toml.example" },
];

describe("checkTree()", () => {
  it("reports nothing when the tree matches the corpus", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-from-");
    const repo = tree({ ".claude/agents/cc-dev.md": "dev" }, "warden-check-repo-");

    expect(checkTree(repo, { tree: ".claude/agents", from: [from] }, "forge")).toEqual([]);
  });

  it("names a missing, a modified and an extra file", () => {
    const from = tree({ "cc-dev.md": "dev", "cc-doc.md": "doc" }, "warden-check-drift-from-");
    const repo = tree({ ".claude/agents/cc-dev.md": "edited in place", ".claude/agents/cc-own.md": "project" }, "warden-check-drift-repo-");

    expect(checkTree(repo, { tree: ".claude/agents", from: [from] }, "forge")).toEqual([
      { code: "modified", detail: ".claude/agents/cc-dev.md" },
      { code: "missing", detail: ".claude/agents/cc-doc.md" },
      { code: "extra", detail: ".claude/agents/cc-own.md" },
    ]);
  });

  it("layers the sources in order, so the kind tree's copy is the one a shared name is held to", () => {
    const shared = tree({ "cc-tester.md": "shared", "cc-both.md": "shared" }, "warden-check-shared-");
    const kind = tree({ "cc-both.md": "kind", "cc-dev.md": "dev" }, "warden-check-kind-");
    const repo = tree(
      { ".claude/agents/cc-tester.md": "shared", ".claude/agents/cc-both.md": "kind", ".claude/agents/cc-dev.md": "dev" },
      "warden-check-layered-",
    );

    expect(checkTree(repo, { tree: ".claude/agents", from: [shared, kind] }, "forge")).toEqual([]);
  });

  it("holds a synced file to its source rendered for the slug, so another repository's name is drift", () => {
    const from = tree({ "handoff/SKILL.md": "Ledger: /mcp/{{repo}}" }, "warden-check-render-from-");
    const repo = tree({ ".claude/skills/handoff/SKILL.md": "Ledger: /mcp/starter" }, "warden-check-render-repo-");

    expect(checkTree(repo, { tree: ".claude/skills", from: [from] }, "starter")).toEqual([]);
    expect(checkTree(repo, { tree: ".claude/skills", from: [from] }, "forge")).toEqual([
      { code: "modified", detail: ".claude/skills/handoff/SKILL.md" },
    ]);
  });
});

describe("checkFiles()", () => {
  it("reports nothing when each synced file matches its rendered source", () => {
    const corpus = tree({ "settings.json": "{}", "codex.toml": "/mcp/{{repo}}" }, "warden-files-ok-from-");
    const repo = tree({ ".claude/settings.json": "{}", ".codex/config.toml.example": "/mcp/cornellaw" }, "warden-files-ok-repo-");

    expect(
      checkFiles(
        repo,
        [
          { file: ".claude/settings.json", from: join(corpus, "settings.json") },
          { file: ".codex/config.toml.example", from: join(corpus, "codex.toml") },
        ],
        "cornellaw",
      ),
    ).toEqual([]);
  });

  it("names a synced file edited in place and one that is missing", () => {
    const corpus = tree({ "settings.json": "{}", "codex.toml": "/mcp/{{repo}}" }, "warden-files-drift-from-");
    const repo = tree({ ".claude/settings.json": '{ "model": "opus" }' }, "warden-files-drift-repo-");

    expect(
      checkFiles(
        repo,
        [
          { file: ".claude/settings.json", from: join(corpus, "settings.json") },
          { file: ".codex/config.toml.example", from: join(corpus, "codex.toml") },
        ],
        "forge",
      ),
    ).toEqual([
      { code: "modified", detail: ".claude/settings.json" },
      { code: "missing", detail: ".codex/config.toml.example" },
    ]);
  });

  it("holds nothing to a file the installed corpus does not carry", () => {
    const repo = tree({}, "warden-files-absent-");

    expect(checkFiles(repo, [{ file: ".claude/settings.json", from: join(tmpdir(), "warden-absent-corpus-file") }], "forge")).toEqual([]);
  });
});

describe("checkGit()", () => {
  it("reports nothing for a .gitignore that ignores every required path and none of the synced files", () => {
    expect(checkGit(gitRepo({}, "warden-git-ok-"), SYNCED)).toEqual([]);
  });

  it("names every required path the .gitignore leaves unignored", () => {
    const repo = gitRepo({ ".gitignore": "node_modules/\n.dev.vars\n.env*\n" }, "warden-git-unignored-");

    expect(checkGit(repo, SYNCED).map(({ detail }) => detail.split(" ")[0])).toEqual(
      MUST_IGNORE.filter((path) => ![".dev.vars", ".env", ".env.local"].includes(path)),
    );
  });

  it("names a synced file a .gitignore pattern swallows — settings.json, as cornellaw, crucible and starter ignored it", () => {
    const repo = gitRepo({ ".gitignore": `${MUST_IGNORE.join("\n")}\n.claude/settings.json\n.codex\n` }, "warden-git-ignored-");

    expect(checkGit(repo, SYNCED)).toEqual([
      { code: "ignored", detail: ".claude/settings.json — sync writes it to be committed; .gitignore must not ignore it" },
      { code: "ignored", detail: ".codex/config.toml.example — sync writes it to be committed; .gitignore must not ignore it" },
    ]);
  });

  it("accepts a directory ignored wholesale with the synced file negated back in", () => {
    const repo = gitRepo({ ".gitignore": `${MUST_IGNORE.join("\n")}\n.codex/*\n!.codex/config.toml.example\n` }, "warden-git-negated-");

    expect(checkGit(repo, SYNCED)).toEqual([]);
  });

  it("counts only a .gitignore in the repository, not .git/info/exclude, which is one machine's", () => {
    const repo = gitRepo({ ".gitignore": "node_modules/\n" }, "warden-git-exclude-");
    writeFileSync(join(repo, ".git/info/exclude"), `${MUST_IGNORE.join("\n")}\n`, "utf-8");

    expect(checkGit(repo, SYNCED).filter(({ code }) => code === "unignored")).toHaveLength(MUST_IGNORE.length);
  });

  it("names a tracked settings.local.json at any depth", () => {
    const repo = gitRepo({ ".claude/settings.local.json": "{}", "app/.claude/settings.local.json": "{}" }, "warden-git-tracked-");
    git(repo, "add", "-f", ".claude/settings.local.json", "app/.claude/settings.local.json");

    expect(checkGit(repo, SYNCED)).toEqual([
      { code: "tracked", detail: ".claude/settings.local.json — personal settings; remove it from the index and keep it untracked" },
      { code: "tracked", detail: "app/.claude/settings.local.json — personal settings; remove it from the index and keep it untracked" },
    ]);
  });

  it("accepts a tracked settings.local.json already deleted from the working tree, the removal awaiting the user's commit", () => {
    const repo = gitRepo({ ".claude/settings.local.json": "{}", "app/.claude/settings.local.json": "{}" }, "warden-git-pending-");
    git(repo, "add", "-f", ".claude/settings.local.json", "app/.claude/settings.local.json");
    rmSync(join(repo, ".claude/settings.local.json"));

    expect(checkGit(repo, SYNCED)).toEqual([
      { code: "tracked", detail: "app/.claude/settings.local.json — personal settings; remove it from the index and keep it untracked" },
    ]);
  });

  it("says so rather than passing outside a git repository", () => {
    const outside = mkdtempSync(join(tmpdir(), "warden-git-none-"));
    roots.push(outside);

    expect(checkGit(outside, SYNCED)).toEqual([
      { code: "git", detail: "not a git repository — the .gitignore and tracking checks measured nothing" },
    ]);
  });
});

describe("checkAgents()", () => {
  it("reports nothing when every defined agent is named and every named agent is defined", () => {
    const repo = tree(
      { "CLAUDE.md": "delegate to cc-dev and cc-doc", ".claude/agents/cc-dev.md": "d", ".claude/agents/cc-doc.md": "d" },
      "warden-agents-ok-",
    );

    expect(checkAgents(repo)).toEqual([]);
  });

  it("accepts the roster as one line of the pointer block, with no section of its own", () => {
    const repo = tree(
      {
        "CLAUDE.md": "# CLAUDE.md\n\nAgents are `cc-plan` → `cc-dev`, with `cc-doc`; sessions are `forge-dev` and `forge-review`.\n\n## Checks\n",
        ".claude/agents/cc-plan.md": "p",
        ".claude/agents/cc-dev.md": "d",
        ".claude/agents/cc-doc.md": "d",
      },
      "warden-agents-line-",
    );

    expect(checkAgents(repo)).toEqual([]);
  });

  it("names an agent CLAUDE.md names but nothing defines", () => {
    const repo = tree({ "CLAUDE.md": "delegate to cc-tester", ".claude/agents/cc-dev.md": "d" }, "warden-agents-undefined-");

    expect(checkAgents(repo)).toEqual([
      { code: "undefined", detail: "cc-tester — CLAUDE.md names it and .claude/agents does not define it" },
      { code: "unnamed", detail: "cc-dev — it is defined and CLAUDE.md never names it" },
    ]);
  });

  it("names the review skill when sync wrote it and CLAUDE.md never says a review starts there", () => {
    const files = { ".claude/agents/cc-dev.md": "d", ".claude/skills/warden-review/SKILL.md": "s" };
    const silent = tree({ ...files, "CLAUDE.md": "delegate to cc-dev" }, "warden-agents-review-silent-");
    const named = tree(
      { ...files, "CLAUDE.md": "delegate to cc-dev; a review starts with the `warden-review` skill" },
      "warden-agents-review-named-",
    );

    expect(checkAgents(silent)).toEqual([{ code: "unnamed", detail: "warden-review — a code review starts at it, and CLAUDE.md never says so" }]);
    expect(checkAgents(named)).toEqual([]);
  });

  it("says so rather than passing when it measured nothing", () => {
    const repo = tree({ "CLAUDE.md": "no agent named here" }, "warden-agents-empty-");

    expect(checkAgents(repo)).toEqual([{ code: "absent", detail: "no agent is defined and none is named — this check measured nothing" }]);
  });
});

describe("checkBoundary()", () => {
  it("reports nothing when the canon cites a local document by name in prose", () => {
    const canon = tree({ "shared/AGENT_GUIDE.md": "See `docs/TESTING.md` §3a for the local ruling.\n" }, "warden-boundary-clean-");

    expect(checkBoundary(canon)).toEqual([]);
  });

  it("names every canon link whose target reaches into docs/, file and href both", () => {
    const canon = tree(
      { "shared/AGENT_GUIDE.md": "See [`TESTING.md`](../docs/TESTING.md) §3a.\n", "libs/CODE_RULES.md": "Clean.\n" },
      "warden-boundary-drift-",
    );

    expect(checkBoundary(canon)).toEqual([
      { code: "boundary", detail: "shared/AGENT_GUIDE.md links `../docs/TESTING.md` — governance never cites a repository's own docs/" },
    ]);
  });
});

describe("check()", () => {
  it("runs every tree check, the agent reconciliation and the boundary scan together", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-all-from-");
    const corpus = tree({ "settings.json": "{}" }, "warden-check-all-files-");
    const repo = gitRepo(
      { "CLAUDE.md": "delegate to cc-dev", ".claude/agents/cc-dev.md": "dev", ".claude/settings.json": "{}" },
      "warden-check-all-repo-",
    );
    const canon = tree({ "shared/AGENT_GUIDE.md": "Clean.\n" }, "warden-check-all-canon-");
    const plan = {
      trees: [{ tree: ".claude/agents", from: [from] }],
      files: [{ file: ".claude/settings.json", from: join(corpus, "settings.json") }],
      slug: "forge",
    };

    expect(check(repo, plan, canon)).toEqual([]);
  });

  it("surfaces a boundary violation through the one report a sync --check prints", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-b-from-");
    const repo = gitRepo({ "CLAUDE.md": "delegate to cc-dev", ".claude/agents/cc-dev.md": "dev" }, "warden-check-b-repo-");
    const canon = tree({ "shared/AGENT_GUIDE.md": "See [x](./docs/X.md).\n" }, "warden-check-b-canon-");

    expect(
      check(repo, { trees: [{ tree: ".claude/agents", from: [from] }], files: [], slug: "forge" }, canon).map((problem) => problem.code),
    ).toEqual(["boundary"]);
  });

  it("surfaces synced-file and git drift through the same report", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-g-from-");
    const corpus = tree({ "settings.json": "{}" }, "warden-check-g-files-");
    const repo = gitRepo({ "CLAUDE.md": "delegate to cc-dev", ".claude/agents/cc-dev.md": "dev", ".gitignore": "tmp/\n" }, "warden-check-g-repo-");
    const canon = tree({ "shared/AGENT_GUIDE.md": "Clean.\n" }, "warden-check-g-canon-");
    const plan = {
      trees: [{ tree: ".claude/agents", from: [from] }],
      files: [{ file: ".claude/settings.json", from: join(corpus, "settings.json") }],
      slug: "forge",
    };

    expect(new Set(check(repo, plan, canon).map((problem) => problem.code))).toEqual(new Set(["missing", "unignored"]));
  });
});
