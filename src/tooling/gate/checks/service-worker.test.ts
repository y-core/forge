import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { spawnSync } from "bun";

import { loadConfig } from "../../assets/config";
import { buildAll, generateAssetsTypes } from "../../assets/pipeline";
import { ABSENT_FILE } from "../../assets/service-worker";
import type { ServiceWorkerRecord } from "../../assets/types";
import { GATE_TIERS } from "../types";
import type { CheckResult, GateTier } from "../types";
import { gateFixtureRoot } from "./gate.fixture";
import { checkServiceWorker } from "./service-worker";

const WORKER_CONFIG = `export default { paths: { publicDir: "public/assets" }, js: { serviceWorker: { entry: "src/sw.ts" } } };\n`;
const BUILD_HINT = "run `forge assets build` (an app's `build:assets`) to rebuild the worker from its current sources";

let root: string;

function fixture(config: string = WORKER_CONFIG): void {
  root = gateFixtureRoot(
    {
      "assets.config.ts": config,
      "src/sw.ts": 'import { prune } from "./prune";\nself.addEventListener("activate", prune);\n',
      "src/prune.ts": "export const prune = () => {};\n",
      "src/other.ts": "export const other = 1;\n",
    },
    "forge-sw-check-",
  );
}

async function build(): Promise<void> {
  await buildAll(await loadConfig({ root, configPath: "assets.config.ts" }), { assetsPath: join(root, ".forge", "assets.ts") });
}

const run = (tier: GateTier = "static") => checkServiceWorker({ root, assetConfig: "assets.config.ts" }, tier);

beforeEach(() => fixture());

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkServiceWorker", () => {
  it("passes a fresh build in every tier, counting the inputs its bundle read", async () => {
    await build();

    for (const tier of GATE_TIERS) {
      const result = await run(tier);
      expect(result.ok).toBe(true);
      expect(result.summary).toBe("service worker: `public/sw.js` current with the 2 inputs of `src/sw.ts`");
    }
  });

  it("fails an import of the entry that changed after the build, naming it and the rebuild, even in a static run", async () => {
    await build();
    writeFileSync(join(root, "src", "prune.ts"), "export const prune = () => caches.delete('old');\n");

    const result = await run("static");

    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => [f.file, f.message, f.detail])).toEqual([
      ["public/sw.js", "`src/prune.ts` changed since `public/sw.js` was built from `src/sw.ts`", [BUILD_HINT]],
    ]);
    expect(result.summary).toBe("service worker: `public/sw.js` is behind 1 of the 2 inputs of `src/sw.ts`");
  });

  it("fails a changed entry and a deleted input, each by name", async () => {
    await build();
    writeFileSync(join(root, "src", "sw.ts"), 'self.addEventListener("activate", () => {});\n');
    rmSync(join(root, "src", "prune.ts"));

    const result = await run("unit");

    expect(result.findings.map((f) => f.message)).toEqual([
      "`src/prune.ts`, which `public/sw.js` was built from, no longer exists",
      "`src/sw.ts` changed since `public/sw.js` was built from `src/sw.ts`",
    ]);
  });

  it("ignores a file the bundle never read", async () => {
    await build();
    writeFileSync(join(root, "src", "other.ts"), "export const other = 2;\n");

    expect((await run("unit")).ok).toBe(true);
  });

  it("fails in every tier when the built worker is missing beside its record", async () => {
    await build();
    rmSync(join(root, "public", "sw.js"));

    for (const tier of GATE_TIERS) {
      const result = await run(tier);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => [f.file, f.message])).toEqual([
        [".forge/sw.inputs.json", "`public/sw.js` is missing, though a build of `src/sw.ts` is recorded"],
      ]);
      expect(result.summary).toBe("service worker: built file missing");
    }
  });

  it("fails a worker some other step rewrote after the recorded build", async () => {
    await build();
    writeFileSync(join(root, "public", "sw.js"), "self.addEventListener('fetch', () => {});\n");

    const result = await run();

    expect(result.findings.map((f) => f.message)).toEqual(["`public/sw.js` is not the file the recorded build of `src/sw.ts` wrote"]);
  });

  const UNRECORDED: [string, string, string[]][] = [
    [".forge/sw.inputs.json", "`src/sw.ts` has no recorded build, so `public/sw.js` cannot be shown current with it", [BUILD_HINT]],
  ];
  const noRecord = [
    { tier: "static", ok: true, findings: [], summary: "service worker: no recorded build, nothing to verify" },
    { tier: "unit", ok: false, findings: UNRECORDED, summary: "service worker: no recorded build" },
    { tier: "runtime", ok: false, findings: UNRECORDED, summary: "service worker: no recorded build" },
    { tier: "scheduled", ok: false, findings: UNRECORDED, summary: "service worker: no recorded build" },
  ] as const;
  for (const { tier, ok, findings, summary } of noRecord) {
    it(`${ok ? "passes" : "fails"} an unbuilt tree in a ${tier} run`, async () => {
      const result = await run(tier);

      expect([result.ok, result.findings.map((f) => [f.file, f.message, f.detail]), result.summary]).toEqual([ok, findings, summary]);
    });
  }

  it("covers every tier in the no-record matrix", () => {
    expect(noRecord.map((row) => row.tier)).toEqual([...GATE_TIERS]);
  });

  it("fails a record whose entry the config no longer builds", async () => {
    await build();
    const recordPath = join(root, ".forge", "sw.inputs.json");
    const record = JSON.parse(readFileSync(recordPath, "utf-8")) as Record<string, unknown>;
    writeFileSync(recordPath, JSON.stringify({ ...record, entry: "src/old-sw.ts" }));

    const result = await run();

    expect(result.findings.map((f) => f.message)).toEqual([
      "the recorded build wrote `public/sw.js` from `src/old-sw.ts`, but the config now builds `public/sw.js` from `src/sw.ts`",
    ]);
  });

  it("fails a record that is not one", async () => {
    await build();
    writeFileSync(join(root, ".forge", "sw.inputs.json"), '{ "entry": 1 }\n');

    const result = await run();

    expect(result.findings.map((f) => f.message)).toEqual(["`.forge/sw.inputs.json` is not a service-worker record"]);
  });

  it("passes with nothing to verify when the config builds no worker", async () => {
    rmSync(root, { recursive: true, force: true });
    fixture(`export default { paths: { publicDir: "public/assets" } };\n`);

    for (const tier of GATE_TIERS) {
      const result = await run(tier);
      expect(result.ok).toBe(true);
      expect(result.summary).toBe("service worker: none configured");
    }
  });
});

const RECORD = join(".forge", "sw.inputs.json");
const UNREADABLE = [".forge/sw.inputs.json", "`.forge/sw.inputs.json` is not a service-worker record", [BUILD_HINT]];

function readRecord(): ServiceWorkerRecord {
  return JSON.parse(readFileSync(join(root, RECORD), "utf-8")) as ServiceWorkerRecord;
}

function shapeOf(result: CheckResult): unknown[] {
  return [result.ok, result.findings.map((f) => [f.file, f.message, f.detail]), result.summary];
}

describe("checkServiceWorker — inputs that moved after the build", () => {
  it("fails an import deleted after the build in every tier, naming it, the worker built from it and the rebuild", async () => {
    await build();
    rmSync(join(root, "src", "prune.ts"));

    for (const tier of GATE_TIERS) {
      expect(shapeOf(await run(tier))).toEqual([
        false,
        [["public/sw.js", "`src/prune.ts`, which `public/sw.js` was built from, no longer exists", [BUILD_HINT]]],
        "service worker: `public/sw.js` is behind 1 of the 2 inputs of `src/sw.ts`",
      ]);
    }
  });

  it("fails an entry edited to import a file the bundle never read, then counts that file once rebuilt", async () => {
    await build();
    writeFileSync(
      join(root, "src", "sw.ts"),
      'import { prune } from "./prune";\nimport { other } from "./other";\nself.addEventListener("activate", () => prune(other));\n',
    );

    expect((await run("unit")).findings.map((f) => f.message)).toEqual(["`src/sw.ts` changed since `public/sw.js` was built from `src/sw.ts`"]);

    await build();
    writeFileSync(join(root, "src", "other.ts"), "export const other = 2;\n");

    expect((await run("unit")).findings.map((f) => f.message)).toEqual(["`src/other.ts` changed since `public/sw.js` was built from `src/sw.ts`"]);
  });

  it("fails a dependency in node_modules upgraded in place, naming the installed file", async () => {
    rmSync(root, { recursive: true, force: true });
    root = gateFixtureRoot(
      {
        "assets.config.ts": WORKER_CONFIG,
        "src/sw.ts": 'import { expire } from "sw-dep";\nself.addEventListener("activate", expire);\n',
        "node_modules/sw-dep/package.json": JSON.stringify({ name: "sw-dep", version: "1.0.0", main: "index.js" }),
        "node_modules/sw-dep/index.js": "export const expire = () => 1;\n",
      },
      "forge-sw-check-",
    );
    await build();
    expect(Object.keys(readRecord().inputs)).toEqual(["node_modules/sw-dep/index.js", "src/sw.ts"]);

    writeFileSync(join(root, "node_modules", "sw-dep", "index.js"), "export const expire = () => 2;\n");

    expect(shapeOf(await run("unit"))).toEqual([
      false,
      [["public/sw.js", "`node_modules/sw-dep/index.js` changed since `public/sw.js` was built from `src/sw.ts`", [BUILD_HINT]]],
      "service worker: `public/sw.js` is behind 1 of the 2 inputs of `src/sw.ts`",
    ]);
  });

  it("fails a dependency upgrade that moves the package's entry to a new file, leaving the old one untouched", async () => {
    rmSync(root, { recursive: true, force: true });
    root = gateFixtureRoot(
      {
        "assets.config.ts": WORKER_CONFIG,
        "src/sw.ts": 'import { expire } from "sw-dep";\nself.addEventListener("activate", expire);\n',
        "node_modules/sw-dep/package.json": JSON.stringify({ name: "sw-dep", version: "1.0.0", main: "index.js" }),
        "node_modules/sw-dep/index.js": "export const expire = () => 1;\n",
      },
      "forge-sw-check-",
    );
    await build();
    writeFileSync(join(root, "node_modules", "sw-dep", "package.json"), JSON.stringify({ name: "sw-dep", version: "2.0.0", main: "next.js" }));
    writeFileSync(join(root, "node_modules", "sw-dep", "next.js"), "export const expire = () => 2;\n");

    expect((await run("unit")).ok).toBe(false);
  });

  it("fails a worker the config now builds with a different define, its sources untouched", async () => {
    const defining = (value: string) =>
      `export default { paths: { publicDir: "public/assets" }, js: { serviceWorker: { entry: "src/sw.ts", define: { CACHE: ${JSON.stringify(value)} } } } };\n`;
    writeFileSync(join(root, "assets.config.ts"), defining("v1"));
    await build();
    writeFileSync(join(root, "assets.config.ts"), defining("v2"));

    expect((await run("unit")).ok).toBe(false);
  });
});

describe("checkServiceWorker — the precache module", () => {
  it("records only real files when the worker imports the precache module, and passes once the deployed tree it lists changes", async () => {
    writeFileSync(
      join(root, "src", "sw.ts"),
      'import { PRECACHE_URLS, PRECACHE_VERSION } from "@y-core/forge/assets/precache";\nself.addEventListener("install", () => [PRECACHE_URLS, PRECACHE_VERSION]);\n',
    );
    await build();
    const before = readRecord();
    mkdirSync(join(root, "public", "assets"), { recursive: true });
    writeFileSync(join(root, "public", "assets", "added.txt"), "new deploy content\n");
    await build();
    const after = readRecord();

    expect([Object.keys(after.inputs), after.sha256 === before.sha256]).toEqual([["src/sw.ts"], false]);
    expect(shapeOf(await run("unit"))).toEqual([true, [], "service worker: `public/sw.js` current with the 1 input of `src/sw.ts`"]);
  });
});

describe("checkServiceWorker — where the record points", () => {
  it("passes a checkout moved to another directory after the build", async () => {
    await build();
    const moved = `${root}-moved`;
    renameSync(root, moved);
    root = moved;

    expect(shapeOf(await run("unit"))).toEqual([true, [], "service worker: `public/sw.js` current with the 2 inputs of `src/sw.ts`"]);
  });

  it("records the entry and every input relative to the root when the config names the entry absolutely", async () => {
    writeFileSync(
      join(root, "assets.config.ts"),
      `export default { paths: { publicDir: "public/assets" }, js: { serviceWorker: { entry: ${JSON.stringify(join(root, "src", "sw.ts"))} } } };\n`,
    );
    await build();
    const record = readRecord();

    expect([record.entry, record.worker, Object.keys(record.inputs)]).toEqual(["src/sw.ts", "public/sw.js", ["src/prune.ts", "src/sw.ts"]]);
    expect((await run("unit")).ok).toBe(true);
  });

  it("reads the record beside the assets module it is pointed at, and names that record when it is missing", async () => {
    await buildAll(await loadConfig({ root, configPath: "assets.config.ts" }), { assetsPath: join(root, "gen", "assets.ts") });
    const atGen = () => checkServiceWorker({ root, assetConfig: "assets.config.ts", assetsPath: "gen/assets.ts" }, "unit");

    expect((await atGen()).ok).toBe(true);

    rmSync(join(root, "gen", "sw.inputs.json"));

    expect((await atGen()).findings.map((f) => f.file)).toEqual(["gen/sw.inputs.json"]);
  });

  it("stays current when the types-only generator runs over the module the worker imports, as types:assets does ahead of it", async () => {
    const forgeAssets = resolve(import.meta.dir, "..", "..", "..", "assets", "mod.ts");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@assets": [".forge/assets.ts"], "@y-core/forge/assets": [forgeAssets] } } }),
    );
    writeFileSync(join(root, "src", "sw.ts"), 'import { assets } from "@assets";\nself.addEventListener("install", () => assets);\n');
    await build();
    expect(Object.keys(readRecord().inputs).filter((path) => !path.startsWith("../"))).toEqual([".forge/assets.ts", "src/sw.ts"]);

    await generateAssetsTypes(await loadConfig({ root, configPath: "assets.config.ts" }), { assetsPath: join(root, ".forge", "assets.ts") });

    expect((await run("unit")).ok).toBe(true);
  });
});

describe("checkServiceWorker — a nested entry", () => {
  it("records the inputs of an entry one level down by their root-relative paths, and fails one of them changed", async () => {
    rmSync(root, { recursive: true, force: true });
    root = gateFixtureRoot(
      {
        "assets.config.ts": `export default { paths: { publicDir: "public/assets" }, js: { serviceWorker: { entry: "src/client/sw.ts" } } };\n`,
        "src/client/sw.ts":
          'import { prune } from "./prune";\nimport { name } from "../shared/name";\nself.addEventListener("activate", () => prune(name));\n',
        "src/client/prune.ts": "export const prune = (name: string) => name;\n",
        "src/shared/name.ts": 'export const name = "v1";\n',
      },
      "forge-sw-check-",
    );
    await build();
    const record = readRecord();

    expect([record.entry, Object.keys(record.inputs)]).toEqual([
      "src/client/sw.ts",
      ["src/client/prune.ts", "src/client/sw.ts", "src/shared/name.ts"],
    ]);
    expect(shapeOf(await run("unit"))).toEqual([true, [], "service worker: `public/sw.js` current with the 3 inputs of `src/client/sw.ts`"]);

    writeFileSync(join(root, "src", "shared", "name.ts"), 'export const name = "v2";\n');

    expect((await run("unit")).findings.map((f) => f.message)).toEqual([
      "`src/shared/name.ts` changed since `public/sw.js` was built from `src/client/sw.ts`",
    ]);
  });
});

describe("checkServiceWorker — the package manifests that steer resolution", () => {
  const ALIASED_SW = 'import { prune } from "#prune";\nself.addEventListener("activate", prune);\n';
  const manifest = (fields: Record<string, unknown>) => JSON.stringify({ name: "app", private: true, ...fields });

  const edits = [
    { field: "imports", before: { imports: { "#prune": "./src/prune.ts" } }, after: { imports: { "#prune": "./src/other.ts" } } },
    {
      field: "browser",
      before: { imports: { "#prune": "./src/prune.ts" } },
      after: { imports: { "#prune": "./src/prune.ts" }, browser: { "./src/prune.ts": "./src/other.ts" } },
    },
  ];
  for (const { field, before, after } of edits) {
    it(`fails a change to the app package.json's ${field} field, naming the manifest as steering the entry`, async () => {
      writeFileSync(join(root, "package.json"), manifest(before));
      writeFileSync(join(root, "src", "sw.ts"), ALIASED_SW);
      await build();
      expect((await run("unit")).ok).toBe(true);

      writeFileSync(join(root, "package.json"), manifest(after));

      expect((await run("unit")).findings.map((f) => f.message)).toEqual([
        "`package.json`, which steers how `src/sw.ts` resolves, changed since `public/sw.js` was built from `src/sw.ts`",
      ]);
    });
  }

  it("fails an app package.json that appeared since a build that had none", async () => {
    await build();
    writeFileSync(join(root, "package.json"), manifest({}));

    expect((await run("unit")).findings.map((f) => f.message)).toEqual(["`package.json` appeared since `public/sw.js` was built from `src/sw.ts`"]);
  });

  it("records only absent manifests for an app with no package.json anywhere above it, and rebuilds to the same record", async () => {
    await build();
    const first = readRecord();
    await build();

    expect([first.resolution, readRecord()]).toEqual([{ "package.json": ABSENT_FILE, "tsconfig.json": ABSENT_FILE }, first]);
  });

  it("fails a change to the imports of the manifest above a root that has none, naming that manifest", async () => {
    const base = gateFixtureRoot(
      {
        "package.json": manifest({ imports: { "#prune": "./app/src/prune.ts" } }),
        "app/assets.config.ts": WORKER_CONFIG,
        "app/src/sw.ts": ALIASED_SW,
        "app/src/prune.ts": "export const prune = () => {};\n",
        "app/src/other.ts": "export const prune = () => 1;\n",
      },
      "forge-sw-parent-",
    );
    rmSync(root, { recursive: true, force: true });
    root = join(base, "app");
    try {
      await build();
      const first = readRecord();
      await build();

      expect([Object.keys(first.resolution), readRecord()]).toEqual([["../package.json", "package.json", "tsconfig.json"], first]);
      expect((await run("unit")).ok).toBe(true);

      writeFileSync(join(base, "package.json"), manifest({ imports: { "#prune": "./app/src/other.ts" } }));

      expect((await run("unit")).findings.map((f) => f.message)).toEqual([
        "`../package.json`, which steers how `src/sw.ts` resolves, changed since `public/sw.js` was built from `src/sw.ts`",
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("fails an app package.json deleted since a build that read it", async () => {
    writeFileSync(join(root, "package.json"), manifest({}));
    await build();
    rmSync(join(root, "package.json"));

    expect((await run("unit")).findings.map((f) => f.message)).toEqual(["`package.json`, which `public/sw.js` was built from, no longer exists"]);
  });

  it("passes an app with no package.json, and stays current when it is rebuilt without one", async () => {
    await build();
    const first = readRecord().resolution;
    await build();

    expect([Object.keys(first), readRecord().resolution, shapeOf(await run("unit"))]).toEqual([
      ["package.json", "tsconfig.json"],
      first,
      [true, [], "service worker: `public/sw.js` current with the 2 inputs of `src/sw.ts`"],
    ]);
  });

  it("records a dependency's own manifest but not one nested inside the installed package", async () => {
    rmSync(root, { recursive: true, force: true });
    root = gateFixtureRoot(
      {
        "assets.config.ts": WORKER_CONFIG,
        "package.json": manifest({}),
        "src/sw.ts": 'import { expire } from "sw-dep";\nself.addEventListener("activate", expire);\n',
        "node_modules/sw-dep/package.json": JSON.stringify({ name: "sw-dep", main: "lib/index.js" }),
        "node_modules/sw-dep/lib/package.json": JSON.stringify({ sideEffects: false }),
        "node_modules/sw-dep/lib/index.js": "export const expire = () => 1;\n",
      },
      "forge-sw-check-",
    );
    await build();

    expect(Object.keys(readRecord().resolution)).toEqual(["node_modules/sw-dep/package.json", "package.json", "tsconfig.json"]);
  });

  function workspaceFixture(): string {
    const base = gateFixtureRoot(
      {
        "app/assets.config.ts": WORKER_CONFIG,
        "app/package.json": manifest({}),
        "app/src/sw.ts": 'import { expire } from "ws-pkg";\nself.addEventListener("activate", expire);\n',
        "packages/ws-pkg/package.json": JSON.stringify({ name: "ws-pkg", main: "index.ts" }),
        "packages/ws-pkg/index.ts": "export const expire = () => 1;\n",
        "packages/ws-pkg/next.ts": "export const expire = () => 2;\n",
      },
      "forge-sw-workspace-",
    );
    rmSync(root, { recursive: true, force: true });
    root = join(base, "app");
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(base, "packages", "ws-pkg"), join(root, "node_modules", "ws-pkg"));
    return base;
  }

  it("records a symlinked workspace package's resolved file and manifest, and fails a change to its file", async () => {
    const base = workspaceFixture();
    try {
      await build();
      const record = readRecord();
      expect([Object.keys(record.inputs), Object.keys(record.resolution)]).toEqual([
        ["../packages/ws-pkg/index.ts", "src/sw.ts"],
        ["../packages/ws-pkg/package.json", "package.json", "tsconfig.json"],
      ]);

      writeFileSync(join(base, "packages", "ws-pkg", "index.ts"), "export const expire = () => 3;\n");

      expect((await run("unit")).findings.map((f) => f.message)).toEqual([
        "`../packages/ws-pkg/index.ts` changed since `public/sw.js` was built from `src/sw.ts`",
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("passes a workspace app rebuilt with nothing changed, its app and workspace manifests recorded the same both times", async () => {
    const base = workspaceFixture();
    try {
      await build();
      const first = readRecord().resolution;
      await build();

      expect([readRecord().resolution, shapeOf(await run("unit"))]).toEqual([
        first,
        [true, [], "service worker: `public/sw.js` current with the 2 inputs of `src/sw.ts`"],
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("fails a symlinked workspace package whose manifest now points its entry at another file", async () => {
    const base = workspaceFixture();
    try {
      await build();
      writeFileSync(join(base, "packages", "ws-pkg", "package.json"), JSON.stringify({ name: "ws-pkg", main: "next.ts" }));

      expect((await run("unit")).findings.map((f) => f.message)).toEqual([
        "`../packages/ws-pkg/package.json`, which steers how `src/sw.ts` resolves, changed since `public/sw.js` was built from `src/sw.ts`",
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("checkServiceWorker — run from a subdirectory of the root", () => {
  const PIPELINE = resolve(import.meta.dir, "..", "..", "assets", "pipeline.ts");
  const CONFIG = resolve(import.meta.dir, "..", "..", "assets", "config.ts");
  const CHECK = resolve(import.meta.dir, "service-worker.ts");

  it("builds the record beside the root's assets module and passes it, with every path root-relative", () => {
    mkdirSync(join(root, "sub"));
    const script = [
      `import { buildAll } from ${JSON.stringify(PIPELINE)};`,
      `import { loadConfig } from ${JSON.stringify(CONFIG)};`,
      `import { checkServiceWorker } from ${JSON.stringify(CHECK)};`,
      `const root = ${JSON.stringify(root)};`,
      `await buildAll(await loadConfig({ root, configPath: "assets.config.ts" }));`,
      `const result = await checkServiceWorker({ root, assetConfig: "assets.config.ts" }, "unit");`,
      "console.log(JSON.stringify([result.ok, result.findings.map((f) => f.message), result.summary]));",
    ].join("\n");

    const ran = spawnSync([process.execPath, "-e", script], { cwd: join(root, "sub") });
    const record = readRecord();

    expect(JSON.parse(ran.stdout.toString())).toEqual([true, [], "service worker: `public/sw.js` current with the 2 inputs of `src/sw.ts`"]);
    expect([record.entry, record.worker, Object.keys(record.inputs)]).toEqual(["src/sw.ts", "public/sw.js", ["src/prune.ts", "src/sw.ts"]]);
  });
});

describe("checkServiceWorker — a record that is not one", () => {
  const corrupt = [
    { name: "not JSON", contents: "{ entry: src/sw.ts" },
    { name: "empty", contents: "" },
    { name: "JSON null", contents: "null\n" },
    { name: "an array", contents: "[]\n" },
    { name: "missing the worker's digest", contents: JSON.stringify({ entry: "src/sw.ts", worker: "public/sw.js", inputs: {} }) },
  ];
  for (const { name, contents } of corrupt) {
    it(`refuses a record that is ${name} with a finding naming it and the rebuild, even in a static run`, async () => {
      await build();
      writeFileSync(join(root, RECORD), contents);

      expect(shapeOf(await run("static"))).toEqual([false, [UNREADABLE], "service worker: unreadable record"]);
    });
  }

  it("refuses a record carrying its inputs as a list rather than a path-to-digest map", async () => {
    await build();
    writeFileSync(join(root, RECORD), JSON.stringify({ ...readRecord(), inputs: [] }));

    expect(shapeOf(await run("static"))).toEqual([false, [UNREADABLE], "service worker: unreadable record"]);
  });

  it("refuses a record cut off part-way through writing", async () => {
    await build();
    const whole = readFileSync(join(root, RECORD), "utf-8");
    writeFileSync(join(root, RECORD), whole.slice(0, Math.floor(whole.length / 2)));

    expect(shapeOf(await run("unit"))).toEqual([false, [UNREADABLE], "service worker: unreadable record"]);
  });

  it("refuses, rather than throwing on, a well-formed record whose input names a directory", async () => {
    await build();
    const record = readRecord();
    writeFileSync(join(root, RECORD), JSON.stringify({ ...record, inputs: { ...record.inputs, src: record.sha256 } }));

    const result = await run("unit");

    expect([result.ok, result.findings.map((f) => f.file)]).toEqual([false, [".forge/sw.inputs.json"]]);
  });
});

describe("checkServiceWorker — a built worker edited by hand", () => {
  it("fails a sw.js edited after the build in every tier, naming the record and the rebuild", async () => {
    await build();
    const worker = join(root, "public", "sw.js");
    writeFileSync(worker, `${readFileSync(worker, "utf-8")}self.skipWaiting();\n`);

    for (const tier of GATE_TIERS) {
      expect(shapeOf(await run(tier))).toEqual([
        false,
        [[".forge/sw.inputs.json", "`public/sw.js` is not the file the recorded build of `src/sw.ts` wrote", [BUILD_HINT]]],
        "service worker: built file replaced",
      ]);
    }
  });
});
