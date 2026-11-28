import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import MARKDOWN from "../../../config/markdown";
import { checkMarkdown } from "../../../src/tooling/gate/checks/markdown";
import { WARDEN_ROOT } from "../paths";
import type { SyncPlan, SyncTree } from "../types";
import { layerTree, mergeOverlay, render, sync, syncFiles, syncPlan, syncTrees, walk, writeTree } from "./sync";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function plan(trees: SyncTree[]): SyncPlan {
  return { trees, files: [], slug: "forge" };
}

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

describe("syncTrees()", () => {
  it("names the two .claude trees and nothing else — the canon is never copied", () => {
    expect(syncTrees("/warden/claude", "libs")).toEqual([
      { tree: ".claude/agents", from: ["/warden/claude/agents/shared", "/warden/claude/agents/libs"] },
      { tree: ".claude/skills", from: ["/warden/claude/skills/shared", "/warden/claude/skills/libs"] },
    ]);
  });

  it("selects the kind-specific source of each tree by kind", () => {
    expect(syncTrees("/warden/claude", "apps").map(({ from }) => from[1])).toEqual(["/warden/claude/agents/apps", "/warden/claude/skills/apps"]);
  });

  it("names only the two trees it owns, so a sync deletes nothing else under .claude/", () => {
    expect(syncTrees("/warden/claude", "libs").map((entry) => entry.tree)).toEqual([".claude/agents", ".claude/skills"]);
  });
});

describe("walk()", () => {
  it("lists every file under a directory, nested and sorted", () => {
    const root = tree({ "b.md": "b", "a/c.md": "c", "a/b.md": "b" }, "warden-walk-");

    expect(walk(root)).toEqual([join("a", "b.md"), join("a", "c.md"), "b.md"]);
  });

  it("returns nothing for a directory that is not there", () => {
    expect(walk(join(tmpdir(), "warden-absent-directory"))).toEqual([]);
  });
});

describe("syncFiles()", () => {
  it("overwrites the harness policy and the Codex example, and seeds neither", () => {
    expect(syncFiles("/warden/claude")).toEqual([
      { file: ".claude/settings.json", from: "/warden/claude/settings.json" },
      { file: ".codex/config.toml.example", from: "/warden/claude/codex/config.toml.example" },
    ]);
  });
});

describe("syncPlan()", () => {
  it("takes the slug from the manifest's name with its scope dropped", () => {
    const repo = tree({ "package.json": JSON.stringify({ name: "@y-core/starter" }) }, "warden-plan-scoped-");

    expect(syncPlan("/warden/claude", "apps", repo).slug).toBe("starter");
  });

  it("falls back to the directory name when the manifest names nothing", () => {
    const repo = tree({ "package.json": "{}" }, "warden-plan-unnamed-");

    expect(syncPlan("/warden/claude", "apps", repo).slug).toBe(basename(repo));
  });
});

describe("render()", () => {
  it("replaces every {{repo}} with the slug and leaves the rest byte for byte", () => {
    const root = tree({ "a.md": "url = /mcp/{{repo}}\nproject = {{repo}} — {{other}}\n" }, "warden-render-");

    expect(render(join(root, "a.md"), "starter")).toBe("url = /mcp/starter\nproject = starter — {{other}}\n");
  });
});

describe("mergeOverlay()", () => {
  const BODY = "---\n{{slot:description}}\n---\n\nShared.\n{{slot:mission}}\nShared again.\n";

  it("fills each slot line with the overlay's block, which may span lines or be empty", () => {
    const overlay = "<!-- slot:description -->\ndescription: apps\n<!-- /slot -->\n\n<!-- slot:mission -->\n<!-- /slot -->\n";

    expect(mergeOverlay(BODY, overlay, "x.overlay.md")).toBe("---\ndescription: apps\n---\n\nShared.\nShared again.\n");
  });

  it("keeps a block's own blank lines, so a slot can carry a whole paragraph break", () => {
    const overlay = "<!-- slot:description -->\nd\n<!-- /slot -->\n<!-- slot:mission -->\none\n\ntwo\n<!-- /slot -->\n";

    expect(mergeOverlay(BODY, overlay, "x.overlay.md")).toBe("---\nd\n---\n\nShared.\none\n\ntwo\nShared again.\n");
  });

  for (const { why, overlay, error } of [
    {
      why: "a slot the overlay leaves unfilled",
      overlay: "<!-- slot:description -->\nd\n<!-- /slot -->\n",
      error: "does not fill {{slot:mission}}",
    },
    {
      why: "a block the body has no slot for",
      overlay: "<!-- slot:description -->\nd\n<!-- /slot -->\n<!-- slot:mission -->\n<!-- /slot -->\n<!-- slot:extra -->\n<!-- /slot -->\n",
      error: "fills slots the body does not have: extra",
    },
    { why: "text outside any block", overlay: "stray\n", error: "has text outside a slot: stray" },
    { why: "a block never closed", overlay: "<!-- slot:description -->\nd\n", error: "never closes {{slot:description}}" },
    {
      why: "a slot filled twice",
      overlay: "<!-- slot:mission -->\n<!-- /slot -->\n<!-- slot:mission -->\n<!-- /slot -->\n",
      error: "fills {{slot:mission}} twice",
    },
  ]) {
    it(`refuses ${why}`, () => {
      expect(() => mergeOverlay(BODY, overlay, "x.overlay.md")).toThrow(error);
    });
  }
});

describe("layerTree()", () => {
  it("layers sources in order, renders the slug, and merges an overlay into the body an earlier source holds", () => {
    const shared = tree(
      { "cc-dev.md": "{{slot:intro}}\nLedger /mcp/{{repo}}\n", "cc-tester.md": "tester", "nested/b.md": "b" },
      "warden-layer-shared-",
    );
    const kind = tree(
      { "cc-dev.overlay.md": "<!-- slot:intro -->\nFor {{repo}} apps.\n<!-- /slot -->\n", "nested/b.md": "kind b" },
      "warden-layer-kind-",
    );

    expect(Object.fromEntries(layerTree([shared, kind], "starter"))).toEqual({
      "cc-dev.md": "For starter apps.\nLedger /mcp/starter\n",
      "cc-tester.md": "tester",
      [join("nested", "b.md")]: "kind b",
    });
  });

  it("refuses an overlay with no body beneath it, and a body left with an unfilled slot", () => {
    const orphan = tree({ "cc-dev.overlay.md": "" }, "warden-layer-orphan-");
    const unfilled = tree({ "cc-dev.md": "{{slot:intro}}\n" }, "warden-layer-unfilled-");

    expect(() => layerTree([orphan], "forge")).toThrow("overlays cc-dev.md, which no earlier source holds");
    expect(() => layerTree([unfilled], "forge")).toThrow("cc-dev.md has no overlay filling {{slot:intro}}");
  });
});

describe("writeTree()", () => {
  it("writes every layered file, nested directories included", () => {
    const toRoot = mkdtempSync(join(tmpdir(), "warden-write-to-"));
    roots.push(toRoot);

    writeTree(
      toRoot,
      new Map([
        ["a.md", "a"],
        [join("nested", "b.md"), "b"],
      ]),
    );

    expect(walk(toRoot)).toEqual(["a.md", join("nested", "b.md")]);
    expect(readFileSync(join(toRoot, "nested", "b.md"), "utf-8")).toBe("b");
  });
});

describe("sync()", () => {
  it("deletes the destination first, so a file the corpus dropped does not survive", () => {
    const from = tree({ "kept.md": "new" }, "warden-sync-from-");
    const repo = tree({ ".claude/agents/kept.md": "old", ".claude/agents/dropped.md": "gone" }, "warden-sync-repo-");

    expect(sync(repo, plan([{ tree: ".claude/agents", from: [from] }]))).toEqual([".claude/agents"]);
    expect(readFileSync(join(repo, ".claude/agents/kept.md"), "utf-8")).toBe("new");
    expect(existsSync(join(repo, ".claude/agents/dropped.md"))).toBe(false);
  });

  it("leaves the destination intact when the copy fails partway", () => {
    const from = tree({ "kept.md": "new" }, "warden-sync-fail-from-");
    const repo = tree({ ".claude/agents/kept.md": "old" }, "warden-sync-fail-repo-");
    // A dangling symlink is read as a file and copied as one, so the copy throws partway — which is
    // exactly where the destination used to be already deleted with nothing to restore from.
    symlinkSync(join(from, "absent.md"), join(from, "broken.md"));

    expect(() => sync(repo, plan([{ tree: ".claude/agents", from: [from] }]))).toThrow();
    expect(readFileSync(join(repo, ".claude/agents/kept.md"), "utf-8")).toBe("old");
  });

  it("skips a tree the installed corpus does not carry, writing nothing", () => {
    const repo = tree({ ".claude/agents/own.md": "own" }, "warden-sync-skip-");

    expect(sync(repo, plan([{ tree: ".claude/agents", from: [join(tmpdir(), "warden-absent-source")] }]))).toEqual([]);
    expect(existsSync(join(repo, ".claude/agents/own.md"))).toBe(true);
  });

  it("overwrites a synced file the repository edited, rendered for its slug, creating its directory", () => {
    const corpus = tree({ "settings.json": "{}", "config.toml.example": 'url = "/mcp/{{repo}}"' }, "warden-sync-files-from-");
    const repo = tree({ ".claude/settings.json": "edited in place" }, "warden-sync-files-repo-");
    const files = [
      { file: ".claude/settings.json", from: join(corpus, "settings.json") },
      { file: ".codex/config.toml.example", from: join(corpus, "config.toml.example") },
    ];

    expect(sync(repo, { trees: [], files, slug: "crucible" })).toEqual([".claude/settings.json", ".codex/config.toml.example"]);
    expect(readFileSync(join(repo, ".claude/settings.json"), "utf-8")).toBe("{}");
    expect(readFileSync(join(repo, ".codex/config.toml.example"), "utf-8")).toBe('url = "/mcp/crucible"');
  });

  it("leaves settings.local.json alone, so a repository's own additions survive a sync", () => {
    const corpus = tree({ "settings.json": "{}" }, "warden-sync-local-from-");
    const repo = tree({ ".claude/settings.local.json": "own" }, "warden-sync-local-repo-");

    sync(repo, { trees: [], files: [{ file: ".claude/settings.json", from: join(corpus, "settings.json") }], slug: "x" });

    expect(readFileSync(join(repo, ".claude/settings.local.json"), "utf-8")).toBe("own");
  });
});

describe("the shipped agent definitions", () => {
  // What a repository of each kind receives, merged — the overlays mean no source file is a whole agent on its own.
  const agents = (["apps", "libs"] as const).flatMap((kind) =>
    [...layerTree(syncTrees(join(WARDEN_ROOT, "claude"), kind)[0]?.from ?? [], "forge")].map(([file, text]) => ({ name: `${kind}/${file}`, text })),
  );

  it("are merged for both kinds, every slot filled", () => {
    expect(agents.map(({ name }) => name)).toEqual([
      ...["cc-dev.md", "cc-doc.md", "cc-plan.md", "cc-reviewer.md", "cc-test.md", "cc-tester.md"].map((file) => `apps/${file}`),
      ...["cc-dev.md", "cc-doc.md", "cc-plan.md", "cc-reviewer.md", "cc-test.md", "cc-tester.md"].map((file) => `libs/${file}`),
    ]);
  });

  it("grant LSP to every agent whose text tells it to use the language server", () => {
    const missing = agents.filter(({ text }) => {
      const tools = /^tools: (.*)$/m.exec(text)?.[1]?.split(", ") ?? [];
      return text.includes("LSP plugin") && !tools.includes("LSP");
    });
    expect(missing.map(({ name }) => name)).toEqual([]);
  });

  // An agent that skips CLAUDE.md loses the rule CLAUDE.md carries for every other one.
  it("state the data-not-instruction rule in the body of every agent that omits CLAUDE.md", () => {
    const omitting = agents.filter(({ text }) => /^omitClaudeMd: true$/m.test(text));
    expect(omitting.length).toBeGreaterThan(0);
    for (const { text } of omitting) expect(text).toContain("(`AGENT_WORKFLOW.md` §6)");
  });

  it("hold every merged agent to forge's markdown rules, which skip the fragments they are merged from", () => {
    for (const kind of ["apps", "libs"] as const) {
      const root = mkdtempSync(join(tmpdir(), `warden-agents-markdown-${kind}-`));
      roots.push(root);
      writeTree(root, layerTree(syncTrees(join(WARDEN_ROOT, "claude"), kind)[0]?.from ?? [], "forge"));

      const result = checkMarkdown({ root, sources: ["."], rules: MARKDOWN.rules });
      expect([kind, result.findings.map((finding) => `${finding.file}:${finding.line} ${finding.message}`)]).toEqual([kind, []]);
    }
  });

  // The canon owns the conventions; an agent restating one is a second copy free to disagree with it.
  it("point at the canon for coding conventions rather than restating them", () => {
    for (const { name, text } of agents.filter((agent) => agent.name.endsWith("cc-dev.md"))) {
      expect([name, text.includes("SCREAMING_SNAKE_CASE"), text.includes("| About to… | Read |")]).toEqual([name, false, false]);
      expect(text).toContain("casing and prefixes §7e");
    }
  });
});

describe("the shipped reviewers", () => {
  // A reviewer reviews and closes; a repair it made itself would be a change nobody reviews.
  it("warden-review cannot edit while it is active", () => {
    const source = readFileSync(join(WARDEN_ROOT, "claude/skills/shared/warden-review/SKILL.md"), "utf-8");
    expect(/^disallowed-tools: (.*)$/m.exec(source)?.[1]?.split(", ")).toEqual(["Edit", "Write"]);
  });

  it("cc-reviewer cannot edit, spawn a stand-in, or skip the review skill", () => {
    const source = readFileSync(join(WARDEN_ROOT, "claude/agents/shared/cc-reviewer.md"), "utf-8");
    const tools = /^tools: (.*)$/m.exec(source)?.[1]?.split(", ") ?? [];
    expect(/^disallowedTools: (.*)$/m.exec(source)?.[1]?.split(", ")).toEqual(["Edit", "Write"]);
    expect([tools.includes("Agent"), tools.includes("Edit"), tools.includes("Write")]).toEqual([false, false, false]);
    expect(/^skills: (.*)$/m.exec(source)?.[1]).toBe("warden-review");
  });
});

describe("the shipped session skills", () => {
  const SKILLS = join(WARDEN_ROOT, "claude/skills/shared");

  it("name each skill for its directory, so the name a session invokes is the one sync writes", () => {
    for (const skill of readdirSync(SKILLS)) {
      expect([skill, /^name: (.*)$/m.exec(readFileSync(join(SKILLS, skill, "SKILL.md"), "utf-8"))?.[1]]).toEqual([skill, skill]);
    }
  });

  it("render the repository's own review worktree into cc-reviewer", () => {
    const text = layerTree(syncTrees(join(WARDEN_ROOT, "claude"), "libs")[0]?.from ?? [], "cornellaw").get("cc-reviewer.md") ?? "";
    expect([text.includes("~/work/cornellaw-review"), text.includes("~/work/forge-review")]).toEqual([true, false]);
  });

  // A reviewer rung over a cross-session message has to be running; an agent the handoff dispatches does not.
  it("dispatch cc-reviewer from handoff, never a session over SendMessage", () => {
    const text = readFileSync(join(SKILLS, "handoff/SKILL.md"), "utf-8");
    expect([text.includes("`cc-reviewer`"), text.includes("SendMessage"), text.includes("ListAgents")]).toEqual([true, false, false]);
  });

  // A closed task reaches main only through `merge`; a handoff whose reply names no such skill strands it in `done`.
  it("hand a closed task from handoff to merge, which writes git and so restricts no tool", () => {
    expect(readFileSync(join(SKILLS, "handoff/SKILL.md"), "utf-8")).toContain("invoke the `merge` skill");
    expect(readFileSync(join(SKILLS, "merge/SKILL.md"), "utf-8")).not.toMatch(/^disallowed-tools:/m);
  });
});

describe("the shipped fleet settings", () => {
  const settings = JSON.parse(readFileSync(join(WARDEN_ROOT, "claude/settings.json"), "utf-8"));

  // Everything else — model, effort, attribution, allow lists, sandbox, env — is the user's to set.
  it("holds only the fleet's policy keys", () => {
    expect(Object.keys(settings).sort()).toEqual(["$schema", "autoMemoryEnabled", "enabledMcpjsonServers", "permissions", "skillOverrides"]);
    expect(Object.keys(settings.permissions)).toEqual(["deny"]);
  });

  /** Whether a `Bash(...)` rule matches a command: `*` spans any text, and a trailing ` *` also matches the bare command. */
  const denies = (command: string) =>
    settings.permissions.deny.some((rule: string) => {
      const pattern = /^Bash\((.*)\)$/.exec(rule)?.[1];
      if (pattern === undefined) return false;
      const regex = (glob: string) =>
        new RegExp(
          `^${glob
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*")}$`,
        );
      // Claude Code reads a trailing `:*` (not `:**`) as a prefix rule: the glob before it, followed by anything or by nothing.
      if (pattern.endsWith(":*")) {
        const prefix = pattern.slice(0, -2).trimEnd();
        return regex(prefix).test(command) || regex(`${prefix} *`).test(command);
      }
      const bare = pattern.endsWith(" *") ? pattern.slice(0, -2) : undefined;
      return regex(pattern).test(command) || (bare !== undefined && regex(bare).test(command));
    });

  // The developing session commits and pushes (AGENT_WORKFLOW.md §4b); these rewrite, discard or publish what the flow never does.
  const HARMFUL = [
    "apply p.diff",
    "clean -fdx",
    "clone https://x/y.git /tmp/y",
    "init /tmp/z",
    "push --force origin main",
    "push origin main --force-with-lease",
    "push -f origin main",
    "push origin -f main",
    "push -uf origin main",
    "push --mirror origin",
    "push --tags origin",
    "push origin --follow-tags main",
    "push origin --delete task/x",
    "push -d origin task/x",
    "push --prune origin refs/heads/*:refs/heads/*",
    "push --all origin",
    "push --no-verify origin main",
    "push origin :task/x",
    "push :task/x",
    "push origin +main",
    "push +main",
    "push origin main +task/x",
  ];

  const spell = (verb: string) => [
    `git ${verb}`,
    `git -C /src/forge ${verb}`,
    `git -c core.x=y ${verb}`,
    `git -C . -c a=b ${verb}`,
    `git --no-pager ${verb}`,
  ];

  it("holds no rule ending in `:*`, which Claude Code reads as a prefix rule", () => {
    expect(settings.permissions.deny.filter((rule: string) => rule.endsWith(":*)"))).toEqual([]);
  });

  it("denies every git write the flow never makes, plainly and behind any leading global option", () => {
    const spellings = HARMFUL.flatMap(spell);
    expect(spellings.filter((command) => !denies(command))).toEqual([]);
  });

  // Config set on the command line turns a plain push into a mirror, a force or a tag push, so a push behind `-c` is denied whatever follows it.
  it("denies a push behind a command-line config option, which can make a plain push any other kind", () => {
    for (const command of [
      "git -c remote.origin.mirror=true push origin",
      "git -c remote.origin.push=+refs/heads/*:refs/heads/* push origin",
      "git -c push.followTags=true push origin main",
      "git -C . -c remote.origin.mirror=true push origin",
      "git --config-env=remote.origin.mirror=MIRROR push origin",
      "git -c remote.origin.mirror=true push",
    ]) {
      expect([command, denies(command)]).toEqual([command, true]);
    }
  });

  it("denies pointing git at another git directory or work tree, plainly and behind `-C`", () => {
    for (const command of [
      "git --git-dir=/tmp/g --work-tree=. reset --hard",
      "git --work-tree=. checkout -- .",
      "git -C /src/forge --git-dir=/tmp/g checkout -- .",
    ]) {
      expect(denies(command)).toBe(true);
    }
  });

  // The push the flow does make: a fast-forward of `main`, or a task branch, with no option and no `+` or `:` refspec.
  it("leaves a plain push of main or a task branch usable, plainly and behind `-C` or `--no-pager`", () => {
    const spellings = ["push", "push origin main", "push origin task/chore-261126-05", "push origin HEAD:refs/heads/task/x"].flatMap((verb) => [
      `git ${verb}`,
      `git -C /src/forge ${verb}`,
      `git --no-pager ${verb}`,
    ]);
    expect(spellings.filter((command) => denies(command))).toEqual([]);
  });

  it("leaves read-only git usable, `git -C <dir>` included", () => {
    for (const command of [
      "git status",
      "git -C /src/forge status --short",
      "git -C /src/forge log --oneline -3",
      "git rev-parse --git-dir",
      "git diff HEAD",
    ]) {
      expect(denies(command)).toBe(false);
    }
  });

  it("denies GitHub, deploys, secrets in every spelling, recursive deletion and reading secret files", () => {
    for (const rule of [
      "Bash(gh *)",
      "Bash(wrangler deploy*)",
      "Bash(wrangler secret *)",
      "Bash(bun x wrangler deploy*)",
      "Bash(bun x wrangler secret *)",
      "Bash(bunx wrangler deploy*)",
      "Bash(bunx wrangler secret *)",
      "Bash(rm -rf *)",
      "Read(**/.dev.vars)",
      "Read(**/.env)",
      "Read(**/.env.*)",
    ]) {
      expect(settings.permissions.deny).toContain(rule);
    }
  });

  it("enables both MCP servers the agents reach", () => {
    expect(settings.enabledMcpjsonServers).toEqual(["ledger", "warden"]);
  });

  it("leaves the bundled /code-review to a person, so warden-review takes review requests", () => {
    expect(settings.skillOverrides).toEqual({ "code-review": "user-invocable-only" });
  });

  it("is forge's own settings.json byte for byte", () => {
    expect(readFileSync(join(WARDEN_ROOT, "../.claude/settings.json"), "utf-8")).toBe(
      readFileSync(join(WARDEN_ROOT, "claude/settings.json"), "utf-8"),
    );
  });
});

describe("the shipped Codex example", () => {
  it("names the ledger scoped to the repository it is synced into", () => {
    expect(readFileSync(join(WARDEN_ROOT, "claude/codex/config.toml.example"), "utf-8")).toContain(
      'url = "https://task-forge.devbox.test:8443/mcp/{{repo}}"',
    );
  });
});
