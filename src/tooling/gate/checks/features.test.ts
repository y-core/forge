import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { capture } from "../../cli/proc";
import type { CaptureResult } from "../../cli/types";
import { CURATE_FIXTURE_MANIFEST, curateFixtureRepo } from "../../curate/curate.fixture";
import type { CurateRunner } from "../../curate/types";
import { checkFeatures, defaultFeatureProfiles } from "./features";

const roots: string[] = [];

function demonstrator(manifest: string | null = CURATE_FIXTURE_MANIFEST): string {
  const root = curateFixtureRepo(manifest ?? undefined);
  roots.push(root);
  return root;
}

interface Call {
  argv: readonly string[];
  cwd: string;
  appRoot: string | undefined;
  preserveSymlinks: string | undefined;
  showcaseGone: boolean;
  contactGone: boolean;
  app: string;
  manifest: string | undefined;
  linked: boolean;
  dependency: boolean;
}

/** A runner recording what each call saw of the tree, answering with `results` in order and exit 0 after them. */
function recorder(results: CaptureResult[] = []): { run: CurateRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: CurateRunner = (argv, cwd, env) => {
    const manifest = join(cwd, "config/features.ts");
    calls.push({
      argv: [...argv],
      cwd,
      appRoot: env.FORGE_APP_ROOT,
      preserveSymlinks: env.NODE_PRESERVE_SYMLINKS,
      showcaseGone: !existsSync(join(cwd, "src/showcase")),
      contactGone: !existsSync(join(cwd, "src/contact")),
      app: readFileSync(join(cwd, "src/app.ts"), "utf-8"),
      manifest: existsSync(manifest) ? readFileSync(manifest, "utf-8") : undefined,
      linked: lstatSync(join(cwd, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() === true,
      dependency: existsSync(join(cwd, "node_modules/pkg/index.js")),
    });
    return results[calls.length - 1] ?? { code: 0, output: "", ms: 0 };
  };
  return { run, calls };
}

const PASS: CaptureResult = { code: 0, output: "", ms: 0 };
const VERIFY = ["forge", "verify", "--mode", "standard"];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("defaultFeatureProfiles()", () => {
  it("drops each of several features alone, in manifest order, then all of them together", () => {
    expect(defaultFeatureProfiles(["showcase", "contact", "blog"])).toEqual([["showcase"], ["contact"], ["blog"], ["showcase", "contact", "blog"]]);
  });
});

describe("checkFeatures()", () => {
  it("builds the skeleton's assets and then runs its standard gate, both inside the curated tree", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(), assetConfig: "config/assets.ts", profiles: [["showcase"]] }, run);
    const tree = calls[0]!.cwd;

    expect(result.ok).toBe(true);
    expect(tree.startsWith(join(tmpdir(), "forge-curate-"))).toBe(true);
    expect(calls.map((call) => call.argv)).toEqual([
      ["forge", "assets", "build", "all", "--minify", "--root", tree, "--config", "config/assets.ts", "--out", ".forge/assets.ts"],
      VERIFY,
    ]);
    expect(calls.map((call) => [call.cwd, call.appRoot, call.preserveSymlinks])).toEqual([
      [tree, tree, "1"],
      [tree, tree, "1"],
    ]);
  });

  it("passes the asset manifest path it is given", async () => {
    const { run, calls } = recorder();
    await checkFeatures({ root: demonstrator(), assetConfig: "config/assets.ts", assetOut: "gen/assets.ts", profiles: [["showcase"]] }, run);

    expect(calls[0]!.argv.slice(-2)).toEqual(["--out", "gen/assets.ts"]);
  });

  it("proves each feature dropped alone and then both together, each in a tree of its own, when no profiles are given", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator() }, run);

    expect(calls.map((call) => call.argv)).toEqual([VERIFY, VERIFY, VERIFY]);
    expect(calls.map((call) => [call.showcaseGone, call.contactGone])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
    expect(new Set(calls.map((call) => call.cwd)).size).toBe(3);
    expect(result.summary).toBe("features: --drop showcase; --drop contact; --drop showcase,contact each passed its standard gate");
  });

  it("proves only the profiles it is given, in their order", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(), profiles: [["contact"], ["contact", "showcase"]] }, run);

    expect(calls.map((call) => [call.showcaseGone, call.contactGone])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(result.summary).toBe("features: --drop contact; --drop contact,showcase each passed its standard gate");
  });

  it("runs against a tree already curated, its manifest trimmed to the kept feature and the root's node_modules linked in", async () => {
    const { run, calls } = recorder();
    await checkFeatures({ root: demonstrator(), profiles: [["showcase"]] }, run);

    expect(calls[0]).toMatchObject({ showcaseGone: true, contactGone: false, linked: true, dependency: true });
    expect(calls[0]!.app).toBe(
      'import { contact } from "./contact/form"; // feature:contact\nexport const app = 1;\nmountShared(demo, contact); // feature:showcase,contact\n',
    );
    expect(calls[0]!.manifest).toBe(CURATE_FIXTURE_MANIFEST.replace(/^.*\/\/ feature:showcase\n/m, ""));
  });

  it("runs against a tree without its manifest once every feature is dropped", async () => {
    const { run, calls } = recorder();
    await checkFeatures({ root: demonstrator(), profiles: [["showcase", "contact"]] }, run);

    expect(calls[0]).toMatchObject({ showcaseGone: true, contactGone: true, app: "export const app = 1;\n", manifest: undefined });
  });

  it("fails without curating or running anything when given no profiles", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(), profiles: [] }, run);

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      { level: "fail", message: "`profiles` is empty — the check would prove no skeleton; omit it for the defaults" },
    ]);
  });

  it("fails without curating or running anything when a profile drops no feature", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(), profiles: [["showcase"], []] }, run);

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ level: "fail", message: "profile 2 drops no feature — it would prove a plain copy, not a skeleton" }]);
  });

  it("fails with the tail of the gate's output, named by its profile, when a skeleton's gate fails", async () => {
    const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`);
    const { run } = recorder([{ code: 1, output: `${lines.join("\n")}\n`, ms: 0 }]);
    const result = await checkFeatures({ root: demonstrator(), profiles: [["showcase"]] }, run);

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ level: "fail", message: "--drop showcase: the skeleton's standard gate failed", detail: lines.slice(30) }]);
  });

  it("names the second profile when it is the one that fails, and proves no profile after it", async () => {
    const { run, calls } = recorder([PASS, { code: 1, output: "red\n", ms: 0 }]);
    const result = await checkFeatures({ root: demonstrator() }, run);

    expect(calls).toHaveLength(2);
    expect(result.findings).toEqual([{ level: "fail", message: "--drop contact: the skeleton's standard gate failed", detail: ["red"] }]);
  });

  it("never runs the gate when the asset build fails", async () => {
    const { run, calls } = recorder([{ code: 2, output: "esbuild: boom\n", ms: 0 }]);
    const result = await checkFeatures({ root: demonstrator(), assetConfig: "config/assets.ts" }, run);

    expect(calls).toHaveLength(1);
    expect(result.findings).toEqual([{ level: "fail", message: "--drop showcase: the skeleton's asset build failed", detail: ["esbuild: boom"] }]);
  });

  it("fails without running anything when a kept manifest still names a dropped feature", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures(
      { root: demonstrator(CURATE_FIXTURE_MANIFEST.replace(" // feature:showcase", "")), profiles: [["showcase"]] },
      run,
    );

    expect(calls).toHaveLength(0);
    expect(result.findings).toEqual([
      {
        level: "fail",
        message:
          "--drop showcase: the skeleton's manifest names showcase, contact where the skeleton keeps contact — wrap each feature's entry in a `feature:<feature>` region",
      },
    ]);
  });

  it("fails without running anything when a kept manifest no longer validates", async () => {
    const manifest = [
      "export default {",
      '  showcase: { directories: ["src/showcase/"], seams: ["src/app.ts", "README.md"] }, // feature:showcase',
      "  contact: {",
      '    directories: ["src/contact"], // feature:showcase',
      '    seams: ["src/app.ts", "config/app.toml"],',
      "  },",
      "};",
      "",
    ].join("\n");
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(manifest), profiles: [["showcase"]] }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings[0]!.message).toStartWith(
      "--drop showcase: the skeleton's manifest does not load: config/features.ts: contact.directories: ",
    );
  });

  it("fails, rather than throwing, when a kept manifest no longer imports", async () => {
    const manifest = [
      'const contact = { directories: ["src/contact"], seams: ["src/app.ts", "config/app.toml"] };',
      'export default { showcase: { directories: ["src/showcase/"], seams: ["src/app.ts", "README.md"] }, contact }; // feature:showcase',
      "",
    ].join("\n");
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(manifest), profiles: [["showcase"]] }, run);

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.findings[0]!.message).toStartWith("--drop showcase: the skeleton's manifest does not load: ");
  });

  it("fails, naming the profile, when a profile drops a feature the manifest does not name, and proves no profile before it", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(), profiles: [["showcase"], ["blog"]] }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings).toEqual([
      { level: "fail", message: "--drop blog: cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`" },
    ]);
  });

  it("fails without running anything when the root has no manifest", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(null) }, run);

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("features: no skeleton produced");
    expect(result.findings[0]!.message).toBe(
      "No feature manifest at `config/features.ts` — forge curate needs one, default-exporting defineFeatures({...})",
    );
  });

  it("fails without running anything when the manifest is invalid", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator("export default {};\n") }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings[0]!.message).toBe("config/features.ts: (root): a manifest must name a feature");
  });

  it("fails without running anything when the root has no node_modules to link", async () => {
    const root = demonstrator();
    rmSync(join(root, "node_modules"), { recursive: true });
    const { run, calls } = recorder();
    const result = await checkFeatures({ root }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings[0]!.message).toBe("no node_modules under the root to link — run `bun install`");
  });

  it("removes every tree after a pass and after a failure, leaving the root's node_modules intact", async () => {
    const root = demonstrator();
    const passing = recorder();
    await checkFeatures({ root }, passing.run);
    const failing = recorder([PASS, { code: 1, output: "red\n", ms: 0 }]);
    await checkFeatures({ root }, failing.run);

    expect([...passing.calls, ...failing.calls].filter((call) => existsSync(call.cwd))).toEqual([]);
    expect(readFileSync(join(root, "node_modules/pkg/index.js"), "utf-8")).toBe("module.exports = 1;\n");
  });

  it("resolves a dependency through the linked node_modules to its path inside the tree, not the root's", async () => {
    const root = demonstrator();
    const resolved: string[] = [];
    const run: CurateRunner = (_argv, cwd, env) => {
      const probe = capture("bun", ["-e", 'console.log(import.meta.resolve("pkg/index.js"))'], { cwd, env });
      resolved.push(cwd, probe.output.trim());
      return PASS;
    };
    await checkFeatures({ root, profiles: [["showcase"]] }, run);
    const [tree, url] = resolved;

    expect(fileURLToPath(url!)).toBe(join(tree!, "node_modules/pkg/index.js"));
  });
});

describe("checkFeatures() — the feature graph", () => {
  const CONTACT_REQUIRES_SHOWCASE = CURATE_FIXTURE_MANIFEST.replace(
    'seams: ["src/app.ts", "config/app.toml"] }',
    'seams: ["src/app.ts", "config/app.toml"], requires: ["showcase"] }',
  );

  it("resolves each default profile through the graph, proves each resolved set once, and labels what the graph added", async () => {
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(CONTACT_REQUIRES_SHOWCASE) }, run);

    expect(calls.map((call) => [call.showcaseGone, call.contactGone])).toEqual([
      [true, true],
      [false, true],
    ]);
    expect(result.summary).toBe("features: --drop showcase (+ contact); --drop contact each passed its standard gate");
  });

  it("proves a one-feature manifest's default profiles as one skeleton", async () => {
    const root = demonstrator(
      [
        "export default {",
        '  showcase: { directories: ["src/showcase/"], seams: ["src/app.ts", "README.md"] }, // feature:showcase',
        "};",
        "",
      ].join("\n"),
    );
    writeFileSync(join(root, "src/app.ts"), "export const app = 1;\nregister(demo); /* feature:showcase */\n", "utf-8");
    writeFileSync(join(root, "config/app.toml"), 'name = "app"\n', "utf-8");
    const { run, calls } = recorder();
    const result = await checkFeatures({ root }, run);

    expect(calls.map((call) => call.argv)).toEqual([VERIFY]);
    expect(result.summary).toBe("features: --drop showcase each passed its standard gate");
  });

  it("fails, naming the profile, on a manifest whose graph does not resolve, and runs nothing", async () => {
    const { run, calls } = recorder();
    const cyclic = CONTACT_REQUIRES_SHOWCASE.replace(
      'seams: ["src/app.ts", "README.md"] }',
      'seams: ["src/app.ts", "README.md"], requires: ["contact"] }',
    );
    const result = await checkFeatures({ root: demonstrator(cyclic), profiles: [["showcase"]] }, run);

    expect(calls).toHaveLength(0);
    expect(result.findings).toEqual([
      {
        level: "fail",
        message:
          "--drop showcase: features `showcase` → `contact` → `showcase` require one another — a feature graph has no cycles; merge them, or move what they share into a feature both require",
      },
    ]);
  });

  it("runs a kept feature's regeneration inside the skeleton before its asset build", async () => {
    const manifest = CURATE_FIXTURE_MANIFEST.replace(
      'seams: ["src/app.ts", "README.md"] }',
      'seams: ["src/app.ts", "README.md"], regenerate: { run: ["regen", "--fresh"] } }',
    );
    const { run, calls } = recorder();
    const result = await checkFeatures({ root: demonstrator(manifest), assetConfig: "config/assets.ts", profiles: [["contact"]] }, run);
    const tree = calls[0]!.cwd;

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.argv[0])).toEqual(["regen", "forge", "forge"]);
    expect(calls[0]).toMatchObject({ argv: ["regen", "--fresh"], appRoot: tree, contactGone: true, linked: true });
    expect(calls.map((call) => call.cwd)).toEqual([tree, tree, tree]);
  });

  it("holds a kept manifest to the features the graph resolved the skeleton to keep", async () => {
    const manifest = [
      ...CONTACT_REQUIRES_SHOWCASE.split("\n").slice(0, -2),
      '  notes: { directories: [], seams: ["notes.txt"] }, // feature:notes',
      "};",
      "",
    ].join("\n");
    const root = demonstrator(manifest);
    writeFileSync(join(root, "notes.txt"), "untracked, not ignored # feature:notes\n", "utf-8");
    const { run, calls } = recorder();
    const result = await checkFeatures({ root, profiles: [["showcase"]] }, run);

    expect(result.findings).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.manifest).toBe(
      ["export default {", '  notes: { directories: [], seams: ["notes.txt"] }, // feature:notes', "};", ""].join("\n"),
    );
  });
});
