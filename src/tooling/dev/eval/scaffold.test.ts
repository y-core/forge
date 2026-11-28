import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnSync } from "../../cli/types";
import { DRIFTED, DRIFTED_WITH_ENTRY, ENTRY_PATCH, RELEASED_PATCH, UNENTRY_PATCH } from "./changelog.fixture";
import {
  applyPatch,
  assertCleanCheckout,
  commitAll,
  consumerTemplate,
  createTree,
  prepareBase,
  readHead,
  removeTree,
  resetTree,
  writeMcpConfig,
} from "./scaffold";
import { loadTask } from "./spec";
import { removeAll, SAMPLE_FILES, sampleSpec, writeTaskDir } from "./task.fixture";
import { callsTo, fakeWorld } from "./world.fixture";

const roots: string[] = [];
afterAll(() => removeAll(roots));

function world(): ReturnType<typeof fakeWorld> {
  const made = fakeWorld();
  roots.push(made.root);
  return made;
}

const HEAD = { checkout: "/checkout", sha: "abc", changes: "" };

function consumerSources(w: ReturnType<typeof fakeWorld>): void {
  mkdirSync(join(w.env.checkout, "tests", "fixtures", "workers-consumer"), { recursive: true });
  writeFileSync(join(w.env.checkout, "tests", "fixtures", "workers-consumer", "worker.ts"), "export {};\n", "utf-8");
  mkdirSync(join(w.env.evalsDir, "consumer-base"), { recursive: true });
  writeFileSync(join(w.env.evalsDir, "consumer-base", "package.json"), JSON.stringify({ name: "app", dependencies: { valibot: "^1" } }), "utf-8");
}

describe("assertCleanCheckout()", () => {
  it("refuses a checkout with uncommitted changes, naming them", () => {
    const w = world();
    w.answers.dirty = "?? scratch.ts\n";
    expect(() => assertCleanCheckout(readHead(w.env.checkout, w.spawn))).toThrow(/uncommitted changes[\s\S]*scratch\.ts/);
  });

  it("accepts a round's uncommitted result, and still names any other change beside it", () => {
    const w = world();
    w.answers.dirty = "?? tests/evals/results/baseline.json\n";
    expect(() => assertCleanCheckout(readHead(w.env.checkout, w.spawn))).not.toThrow();
    w.answers.dirty = " M tests/evals/results/baseline.json\n M src/http/mod.ts\n";
    expect(() => assertCleanCheckout(readHead(w.env.checkout, w.spawn))).toThrow(/eval run:\n M src\/http\/mod\.ts$/);
  });

  it("accepts a clean checkout", () => {
    const w = world();
    expect(() => assertCleanCheckout(readHead(w.env.checkout, w.spawn))).not.toThrow();
  });
});

const realSpawn: SpawnSync = (command, args, options) => spawnSync(command, args, { ...options, encoding: "utf-8" });

function ignoringTree(modules: (tree: string) => void): string {
  const tree = mkdtempSync(join(tmpdir(), "forge-eval-commit-"));
  roots.push(tree);
  spawnSync("git", ["init", "-q"], { cwd: tree });
  writeFileSync(join(tree, ".gitignore"), "node_modules/\n", "utf-8");
  writeFileSync(join(tree, "app.ts"), "export {};\n", "utf-8");
  modules(tree);
  return tree;
}

function committedPaths(tree: string): string[] {
  return spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: tree, encoding: "utf-8" })
    .stdout.split("\n")
    .filter((path) => path !== "");
}

describe("commitAll()", () => {
  it("commits with --no-verify, so no hook in the tree runs", () => {
    const w = world();
    commitAll("/tree", "m", w.spawn);
    expect(callsTo(w.spawn, "git").find((args) => args.includes("commit"))).toContain("--no-verify");
  });

  it("leaves out a symlinked node_modules, which a `node_modules/` rule does not match", () => {
    const target = mkdtempSync(join(tmpdir(), "forge-eval-modules-"));
    roots.push(target);
    const tree = ignoringTree((at) => symlinkSync(target, join(at, "node_modules"), "dir"));
    commitAll(tree, "m", realSpawn);
    expect(committedPaths(tree)).toEqual([".gitignore", "app.ts"]);
  });

  it("commits beside an ignored node_modules directory", () => {
    const tree = ignoringTree((at) => {
      mkdirSync(join(at, "node_modules", "dep"), { recursive: true });
      writeFileSync(join(at, "node_modules", "dep", "index.js"), "", "utf-8");
    });
    commitAll(tree, "m", realSpawn);
    expect(committedPaths(tree)).toEqual([".gitignore", "app.ts"]);
  });

  it("commits a tree with no node_modules at all", () => {
    const tree = ignoringTree(() => {});
    commitAll(tree, "m", realSpawn);
    expect(committedPaths(tree)).toEqual([".gitignore", "app.ts"]);
  });
});

describe("resetTree()", () => {
  it("keeps the node_modules link when it cleans", () => {
    const w = world();
    resetTree("/tree", "abc", w.spawn);
    expect(callsTo(w.spawn, "git")).toEqual([
      ["reset", "-q", "--hard", "abc"],
      ["clean", "-fdq", "-e", "node_modules"],
    ]);
  });
});

function driftedTree(): string {
  const tree = mkdtempSync(join(tmpdir(), "forge-eval-apply-"));
  roots.push(tree);
  spawnSync("git", ["init", "-q"], { cwd: tree });
  mkdirSync(join(tree, "src"));
  writeFileSync(join(tree, "src", "mod.ts"), "export {};\n", "utf-8");
  writeFileSync(join(tree, "CHANGELOG.md"), DRIFTED, "utf-8");
  commitAll(tree, "base", realSpawn);
  return tree;
}

function patchFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-eval-patch-"));
  roots.push(dir);
  writeFileSync(join(dir, "change.patch"), text, "utf-8");
  return join(dir, "change.patch");
}

describe("applyPatch()", () => {
  it("applies a patch whose changelog context drifted, in a repository holding none of its blobs", () => {
    const tree = driftedTree();
    expect(applyPatch(tree, patchFile(ENTRY_PATCH), realSpawn)).toBe(true);
    expect(readFileSync(join(tree, "CHANGELOG.md"), "utf-8")).toBe(DRIFTED_WITH_ENTRY);
    expect(readFileSync(join(tree, "src", "mod.ts"), "utf-8")).toBe("export {};\nexport const added = 1;\n");
  });

  it("applies a patch that touches only the changelog", () => {
    const tree = driftedTree();
    applyPatch(tree, patchFile(ENTRY_PATCH), realSpawn);
    expect(applyPatch(tree, patchFile(UNENTRY_PATCH), realSpawn)).toBe(true);
    expect(readFileSync(join(tree, "CHANGELOG.md"), "utf-8")).toBe(DRIFTED);
  });

  it("leaves the changelog alone when the rest of the patch does not apply", () => {
    const tree = driftedTree();
    writeFileSync(join(tree, "src", "mod.ts"), "export const moved = 0;\n", "utf-8");
    expect(applyPatch(tree, patchFile(ENTRY_PATCH), realSpawn)).toBe(false);
    expect(readFileSync(join(tree, "CHANGELOG.md"), "utf-8")).toBe(DRIFTED);
  });

  it("leaves the source alone when a changelog anchor is not in [Unreleased]", () => {
    const tree = driftedTree();
    expect(applyPatch(tree, patchFile(`${RELEASED_PATCH}${ENTRY_PATCH.slice(ENTRY_PATCH.indexOf("diff --git a/src"))}`), realSpawn)).toBe(false);
    expect(readFileSync(join(tree, "src", "mod.ts"), "utf-8")).toBe("export {};\n");
  });
});

describe("writeMcpConfig()", () => {
  it("lists warden alone, so no session can reach the ledger", () => {
    const w = world();
    for (const kind of ["forge", "consumer"] as const) {
      const config = JSON.parse(readFileSync(writeMcpConfig(w.env, "r1", kind), "utf-8")) as { mcpServers: Record<string, { args: string[] }> };
      expect(Object.keys(config.mcpServers)).toEqual(["warden"]);
      expect(config.mcpServers.warden?.args).toContain("serve");
    }
  });

  it("serves a consumer tree the installed forge's consumer documents, and a forge tree its own corpus alone", () => {
    const w = world();
    const argsOf = (kind: "forge" | "consumer"): string[] =>
      (JSON.parse(readFileSync(writeMcpConfig(w.env, "r1", kind), "utf-8")) as { mcpServers: { warden: { args: string[] } } }).mcpServers.warden
        .args;
    expect(argsOf("consumer")).toEqual(["node_modules/@y-core/forge/warden/src/bin.ts", "serve", "--dependency"]);
    expect(argsOf("forge")).toEqual(["warden/src/bin.ts", "serve"]);
  });
});

describe("createTree() and removeTree()", () => {
  it("adds a detached forge worktree with node_modules linked to the checkout's, and removes it", () => {
    const w = world();
    const at = join(w.env.treesDir, "r1", "t-1");
    createTree(w.env, "forge", HEAD, at);
    expect(callsTo(w.spawn, "git")).toContainEqual(["worktree", "add", "-q", "--detach", at, "abc"]);
    expect(lstatSync(join(at, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    removeTree(w.env, "forge", at);
    expect(existsSync(at)).toBe(false);
    expect(existsSync(join(w.env.checkout, "node_modules"))).toBe(true);
  });

  it("copies the consumer template, built once per forge commit", () => {
    const w = world();
    consumerSources(w);
    createTree(w.env, "consumer", HEAD, join(w.env.treesDir, "r1", "t-1"));
    createTree(w.env, "consumer", HEAD, join(w.env.treesDir, "r1", "t-2"));
    expect(callsTo(w.spawn, "bun").filter((args) => args[0] === "pm")).toHaveLength(1);
    expect(existsSync(join(w.env.treesDir, "r1", "t-2", "worker.ts"))).toBe(true);
    removeTree(w.env, "consumer", join(w.env.treesDir, "r1", "t-2"));
    expect(existsSync(join(w.env.treesDir, "r1", "t-2"))).toBe(false);
  });
});

describe("consumerTemplate()", () => {
  it("overlays consumer-base on the fixture and points the forge dependency at the packed tarball", () => {
    const w = world();
    consumerSources(w);
    const template = consumerTemplate(w.env, HEAD);
    const manifest = JSON.parse(readFileSync(join(template, "package.json"), "utf-8")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies).toEqual({ valibot: "^1", "@y-core/forge": `file:${join(w.env.cacheDir, "forge-abc.tgz")}` });
    expect(existsSync(join(template, "worker.ts"))).toBe(true);
  });

  it("leaves no template behind when a step fails, so the next run builds it again", () => {
    const w = world();
    consumerSources(w);
    w.answers.failing = (command, args) => command === "bun" && args[0] === "install";
    expect(() => consumerTemplate(w.env, HEAD)).toThrow(/bun install exited 1/);
    expect(existsSync(join(w.env.cacheDir, "consumer-abc"))).toBe(false);
    expect(existsSync(join(w.env.cacheDir, "consumer-abc.partial"))).toBe(false);
  });
});

describe("prepareBase()", () => {
  it("indexes the corpus, applies the bait and commits the base", () => {
    const w = world();
    const { root, dir } = writeTaskDir(sampleSpec(), SAMPLE_FILES);
    roots.push(root);
    const task = loadTask(dir);
    prepareBase(w.env, task, "/tree");
    expect(callsTo(w.spawn, "bun")[0]).toEqual(["warden/src/bin.ts", "index", "--root", "/tree"]);
    expect(callsTo(w.spawn, "git")).toContainEqual(["apply", "--whitespace=nowarn", join(dir, "bait/helper.patch")]);
  });

  it("indexes a consumer tree with the installed forge's dependency corpus, as a consumer's own warden does", () => {
    const w = world();
    const { root, dir } = writeTaskDir({ ...sampleSpec(), tree: "consumer" }, SAMPLE_FILES);
    roots.push(root);
    prepareBase(w.env, loadTask(dir), "/tree");
    expect(callsTo(w.spawn, "bun")[0]).toEqual(["node_modules/@y-core/forge/warden/src/bin.ts", "index", "--dependency", "--root", "/tree"]);
  });

  it("refuses bait that does not apply", () => {
    const w = world();
    const { root, dir } = writeTaskDir(sampleSpec(), SAMPLE_FILES);
    roots.push(root);
    w.answers.failing = (command, args) => command === "git" && args[0] === "apply";
    expect(() => prepareBase(w.env, loadTask(dir), "/tree")).toThrow(/bait bait\/helper\.patch does not apply/);
  });
});
