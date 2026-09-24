import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { capture } from "../../cli/proc";
import type { CaptureResult } from "../../cli/types";
import { stripFixtureRepo } from "../../strip/strip.fixture";
import { checkStrip } from "./strip";
import type { StripRunner } from "./types";

const roots: string[] = [];

const MANIFEST = 'export default { directories: ["src/showcase/"], seams: [{ file: "src/app.ts", marker: "// strip:showcase" }] };\n';

function demonstrator(manifest: string | null = MANIFEST): string {
  const root = stripFixtureRepo();
  roots.push(root);
  if (manifest !== null) {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config/strip.ts"), manifest, "utf-8");
  }
  return root;
}

interface Call {
  argv: readonly string[];
  cwd: string;
  appRoot: string | undefined;
  showcaseGone: boolean;
  preserveSymlinks: string | undefined;
  app: string;
  linked: boolean;
  dependency: boolean;
  manifestCopied: boolean;
}

/** A runner recording what each call saw of the tree, answering with `results` in order and exit 0 after them. */
function recorder(results: CaptureResult[] = []): { run: StripRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: StripRunner = (argv, cwd, env) => {
    calls.push({
      argv: [...argv],
      cwd,
      appRoot: env.FORGE_APP_ROOT,
      preserveSymlinks: env.NODE_PRESERVE_SYMLINKS,
      showcaseGone: !existsSync(join(cwd, "src/showcase")),
      app: readFileSync(join(cwd, "src/app.ts"), "utf-8"),
      linked: lstatSync(join(cwd, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() === true,
      dependency: existsSync(join(cwd, "node_modules/pkg/index.js")),
      manifestCopied: existsSync(join(cwd, "config/strip.ts")),
    });
    return results[calls.length - 1] ?? { code: 0, output: "", ms: 0 };
  };
  return { run, calls };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("checkStrip()", () => {
  it("builds the skeleton's assets and then runs its standard gate, both inside the stripped tree", async () => {
    const { run, calls } = recorder();
    const result = await checkStrip({ root: demonstrator(), assetConfig: "config/assets.ts" }, run);
    const tree = calls[0]!.cwd;

    expect(result.ok).toBe(true);
    expect(tree.startsWith(join(tmpdir(), "forge-strip-"))).toBe(true);
    expect(calls.map((call) => call.argv)).toEqual([
      ["forge", "assets", "build", "all", "--minify", "--root", tree, "--config", "config/assets.ts", "--out", ".forge/assets.ts"],
      ["forge", "verify", "--mode", "standard"],
    ]);
    expect(calls.map((call) => [call.cwd, call.appRoot, call.preserveSymlinks])).toEqual([
      [tree, tree, "1"],
      [tree, tree, "1"],
    ]);
  });

  it("passes the asset manifest path it is given", async () => {
    const { run, calls } = recorder();
    await checkStrip({ root: demonstrator(), assetConfig: "config/assets.ts", assetOut: "gen/assets.ts" }, run);

    expect(calls[0]!.argv.slice(-2)).toEqual(["--out", "gen/assets.ts"]);
  });

  it("runs against a tree already stripped, without its manifest and with the root's node_modules linked in", async () => {
    const { run, calls } = recorder();
    await checkStrip({ root: demonstrator() }, run);

    expect(calls[0]).toMatchObject({ showcaseGone: true, app: "export const app = 1;\n", linked: true, dependency: true, manifestCopied: false });
  });

  it("runs only the gate when there is no asset config", async () => {
    const { run, calls } = recorder();
    const result = await checkStrip({ root: demonstrator() }, run);

    expect(calls.map((call) => call.argv)).toEqual([["forge", "verify", "--mode", "standard"]]);
    expect(result.summary).toBe("strip: a 6-file skeleton passed its standard gate");
  });

  it("fails with the tail of the gate's output when the skeleton's gate fails", async () => {
    const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`);
    const { run } = recorder([{ code: 1, output: `${lines.join("\n")}\n`, ms: 0 }]);
    const result = await checkStrip({ root: demonstrator() }, run);

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ level: "fail", message: "the skeleton's standard gate failed", detail: lines.slice(30) }]);
  });

  it("never runs the gate when the asset build fails", async () => {
    const { run, calls } = recorder([{ code: 2, output: "esbuild: boom\n", ms: 0 }]);
    const result = await checkStrip({ root: demonstrator(), assetConfig: "config/assets.ts" }, run);

    expect(calls).toHaveLength(1);
    expect(result.findings).toEqual([{ level: "fail", message: "the skeleton's asset build failed", detail: ["esbuild: boom"] }]);
  });

  it("fails without running anything when the root has no manifest", async () => {
    const { run, calls } = recorder();
    const result = await checkStrip({ root: demonstrator(null) }, run);

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.findings[0]!.message).toBe(
      "No strip manifest at `config/strip.ts` — forge strip needs one, default-exporting defineStripConfig({...})",
    );
  });

  it("fails without running anything when the manifest is invalid", async () => {
    const { run, calls } = recorder();
    const result = await checkStrip({ root: demonstrator("export default { directories: [], seams: [] };\n") }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings[0]!.message).toBe("config/strip.ts: (root): a manifest must name something to remove");
  });

  it("fails without running anything when the root has no node_modules to link", async () => {
    const root = demonstrator();
    rmSync(join(root, "node_modules"), { recursive: true });
    const { run, calls } = recorder();
    const result = await checkStrip({ root }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings[0]!.message).toBe("no node_modules under the root to link — run `bun install`");
  });

  it("removes the tree after a pass and after a failure, leaving the root's node_modules intact", async () => {
    const root = demonstrator();
    const passing = recorder();
    await checkStrip({ root }, passing.run);
    const failing = recorder([{ code: 1, output: "red\n", ms: 0 }]);
    await checkStrip({ root }, failing.run);

    expect(existsSync(passing.calls[0]!.cwd)).toBe(false);
    expect(existsSync(failing.calls[0]!.cwd)).toBe(false);
    expect(readFileSync(join(root, "node_modules/pkg/index.js"), "utf-8")).toBe("module.exports = 1;\n");
  });

  it("resolves a dependency through the linked node_modules to its path inside the tree, not the root's", async () => {
    const root = demonstrator();
    const resolved: string[] = [];
    const run: StripRunner = (_argv, cwd, env) => {
      const probe = capture("bun", ["-e", 'console.log(import.meta.resolve("pkg/index.js"))'], { cwd, env });
      resolved.push(cwd, probe.output.trim());
      return { code: 0, output: "", ms: 0 };
    };
    await checkStrip({ root }, run);
    const [tree, url] = resolved;

    expect(fileURLToPath(url!)).toBe(join(tree!, "node_modules/pkg/index.js"));
  });
});
