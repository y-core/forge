import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Metafile } from "esbuild";

import { buildJS, importClosure } from "./js";

type Output = Metafile["outputs"][string];
type Import = Output["imports"][number];

function metaOutput(imports: Import[] = [], cssBundle?: string): Output {
  return { bytes: 1, inputs: {}, imports, exports: [], ...(cssBundle === undefined ? {} : { cssBundle }) };
}

const statically = (path: string): Import => ({ path, kind: "import-statement" });
const lazily = (path: string): Import => ({ path, kind: "dynamic-import" });

describe("importClosure()", () => {
  const cases: { name: string; outputs: Metafile["outputs"]; roots: string[]; expected: string[] }[] = [
    { name: "reaches nothing from no roots", outputs: { "main.js": metaOutput() }, roots: [], expected: [] },
    {
      name: "keeps a root and skips one the metafile does not name",
      outputs: { "main.js": metaOutput() },
      roots: ["main.js", "absent.js"],
      expected: ["main.js"],
    },
    {
      name: "follows static imports transitively",
      outputs: {
        "main.js": metaOutput([statically("a.js")]),
        "a.js": metaOutput([statically("b.js")]),
        "b.js": metaOutput(),
        "other.js": metaOutput(),
      },
      roots: ["main.js"],
      expected: ["a.js", "b.js", "main.js"],
    },
    {
      name: "stops at a dynamic import, and at everything only it reaches",
      outputs: { "main.js": metaOutput([lazily("lazy.js")]), "lazy.js": metaOutput([statically("lazy-dep.js")]), "lazy-dep.js": metaOutput() },
      roots: ["main.js"],
      expected: ["main.js"],
    },
    {
      name: "keeps a chunk imported lazily by one output and statically by another",
      outputs: {
        "main.js": metaOutput([lazily("shared.js"), statically("a.js")]),
        "a.js": metaOutput([statically("shared.js")]),
        "shared.js": metaOutput(),
      },
      roots: ["main.js"],
      expected: ["a.js", "main.js", "shared.js"],
    },
    {
      name: "follows an output's CSS bundle",
      outputs: { "main.js": metaOutput([statically("a.js")]), "a.js": metaOutput([], "a.css"), "a.css": metaOutput() },
      roots: ["main.js"],
      expected: ["a.css", "a.js", "main.js"],
    },
    {
      name: "ends on an import cycle",
      outputs: { "a.js": metaOutput([statically("b.js")]), "b.js": metaOutput([statically("a.js")]) },
      roots: ["a.js"],
      expected: ["a.js", "b.js"],
    },
  ];

  for (const { name, outputs, roots, expected } of cases) {
    it(name, () => {
      expect([...importClosure(outputs, roots, false)].sort()).toEqual(expected);
    });
  }

  it("follows a dynamic import when lazy, and everything the lazy chunk imports statically", () => {
    const outputs = { "main.js": metaOutput([lazily("lazy.js")]), "lazy.js": metaOutput([statically("lazy-dep.js")]), "lazy-dep.js": metaOutput() };

    expect([...importClosure(outputs, ["main.js"], true)].sort()).toEqual(["lazy-dep.js", "lazy.js", "main.js"]);
  });

  it("follows a dynamic import a lazy chunk itself makes, when lazy", () => {
    const outputs = {
      "main.js": metaOutput([lazily("a.js")]),
      "a.js": metaOutput([lazily("b.js")], "a.css"),
      "a.css": metaOutput(),
      "b.js": metaOutput(),
    };

    expect([...importClosure(outputs, ["main.js"], true)].sort()).toEqual(["a.css", "a.js", "b.js", "main.js"]);
  });
});

function chunkHolding(publicDir: string, marker: string): string {
  const chunks = readdirSync(join(publicDir, "js", "chunks")).filter((name) =>
    readFileSync(join(publicDir, "js", "chunks", name), "utf-8").includes(marker),
  );
  expect(chunks).toHaveLength(1);
  return `js/chunks/${chunks[0]}`;
}

describe("buildJS() — the precache shell", () => {
  function sharedProject(): { root: string; srcDir: string; publicDir: string } {
    const root = mkdtempSync(join(tmpdir(), "forge-js-shell-"));
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "shared.ts"), 'export const shared = "SHARED_MARKER";');
    writeFileSync(join(srcDir, "lazy.ts"), 'export const lazy = "LAZY_MARKER";');
    writeFileSync(join(srcDir, "main.ts"), 'import { shared } from "./shared";\nexport const run = () => [shared, import("./lazy")];');
    writeFileSync(join(srcDir, "admin.ts"), 'import { shared } from "./shared";\nexport const admin = shared;');
    return { root, srcDir, publicDir: join(root, "public") };
  }

  it("precaches the chunk two entries share statically, and not the one an entry loads lazily", async () => {
    const { root, srcDir, publicDir } = sharedProject();
    try {
      const { mapping, precache } = await buildJS(
        [
          { entry: join(srcDir, "main.ts"), outdir: "js", splitting: true },
          { entry: join(srcDir, "admin.ts"), outdir: "js", splitting: true },
        ],
        { outDir: publicDir },
      );

      expect(precache.sort()).toEqual(["js/admin.js", chunkHolding(publicDir, "SHARED_MARKER"), "js/main.js"].sort());
      expect(Object.values(mapping).sort()).toEqual(["js/admin.js", "js/main.js"]);
      expect(chunkHolding(publicDir, "LAZY_MARKER")).toMatch(/^js\/chunks\/lazy-[A-Z0-9]+\.js$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves out a precache: false bundle, while the chunk it shares with a precached entry stays in", async () => {
    const { root, srcDir, publicDir } = sharedProject();
    try {
      const { mapping, precache } = await buildJS(
        [
          { entry: join(srcDir, "main.ts"), outdir: "js", splitting: true },
          { entry: join(srcDir, "admin.ts"), outdir: "js", splitting: true, precache: false },
        ],
        { outDir: publicDir },
      );

      expect(precache.sort()).toEqual([chunkHolding(publicDir, "SHARED_MARKER"), "js/main.js"].sort());
      expect(mapping["js/admin.js"]).toBe("js/admin.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('precaches the chunk a precache: "all" entry loads lazily, beside its static shell', async () => {
    const { root, srcDir, publicDir } = sharedProject();
    try {
      const { precache } = await buildJS([{ entry: join(srcDir, "main.ts"), outdir: "js", splitting: true, precache: "all" }], {
        outDir: publicDir,
      });

      expect(precache.sort()).toEqual([chunkHolding(publicDir, "LAZY_MARKER"), "js/main.js"].sort());
      for (const output of precache) expect(existsSync(join(publicDir, output))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('precaches a lazy chunk only for the precache: "all" entry that loads it, not for a shell entry in the same build', async () => {
    const { root, srcDir, publicDir } = sharedProject();
    writeFileSync(join(srcDir, "reader.ts"), 'export const read = () => import("./reader-lazy");');
    writeFileSync(join(srcDir, "reader-lazy.ts"), 'export const readerLazy = "DEFERRED_MARKER";');
    try {
      const { precache } = await buildJS(
        [
          { entry: join(srcDir, "main.ts"), outdir: "js", splitting: true, precache: "all" },
          { entry: join(srcDir, "reader.ts"), outdir: "js", splitting: true, precache: "shell" },
        ],
        { outDir: publicDir },
      );

      expect(precache.sort()).toEqual([chunkHolding(publicDir, "LAZY_MARKER"), "js/main.js", "js/reader.js"].sort());
      expect(chunkHolding(publicDir, "DEFERRED_MARKER")).toMatch(/^js\/chunks\/reader-lazy-[A-Z0-9]+\.js$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("contributes nothing for a lone precache: false bundle, though it still builds and maps", async () => {
    const { root, srcDir, publicDir } = sharedProject();
    try {
      const { mapping, precache } = await buildJS([{ entry: join(srcDir, "admin.ts"), outdir: "js", precache: false }], { outDir: publicDir });

      expect({ mapping, precache }).toEqual({ mapping: { "js/admin.js": "js/admin.js" }, precache: [] });
      expect(existsSync(join(publicDir, "js", "admin.js"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("precaches the stylesheet an entry imports, beside the entry", async () => {
    const { root, srcDir, publicDir } = sharedProject();
    writeFileSync(join(srcDir, "theme.css"), "body { color: #000; }");
    writeFileSync(join(srcDir, "styled.ts"), 'import "./theme.css";\nexport const styled = 1;');
    try {
      const { precache } = await buildJS([{ entry: join(srcDir, "styled.ts"), outdir: "js" }], { outDir: publicDir });

      expect(precache.sort()).toEqual(["js/styled.css", "js/styled.js"]);
      expect(existsSync(join(publicDir, "js", "styled.css"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildJS()", () => {
  it("returns an empty mapping and no precache for an empty bundle list", async () => {
    const result = await buildJS([], { outDir: "/tmp" });
    expect(result).toEqual({ mapping: {}, precache: [] });
  });

  it("precaches the entry relative to the asset root, and leaves out a chunk reached only by a dynamic import", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "forge-js-outputs-"));
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), 'export const load = () => import("./editor.mount");');
    writeFileSync(join(srcDir, "editor.mount.ts"), "export const editor = 1;");

    try {
      const { mapping, precache } = await buildJS([{ entry: join(srcDir, "main.ts"), outdir: "js", splitting: true, format: "esm" }], {
        outDir: publicDir,
        hash: true,
      });
      const chunks = readdirSync(join(publicDir, "js", "chunks"));

      expect(precache).toEqual([mapping["js/main.js"] as string]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatch(/^editor\.mount-[A-Z0-9]+\.js$/);
      for (const output of precache) expect(existsSync(join(publicDir, output))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("two bundles sharing one outdir both survive on disk and appear in mapping", async () => {
    const tmpDir = join(tmpdir(), "forge-js-shared-outdir");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    writeFileSync(join(srcDir, "islands.ts"), "export const y = 2;");

    try {
      const mainEntry = join(srcDir, "main.ts");
      const islandsEntry = join(srcDir, "islands.ts");

      const { mapping } = await buildJS(
        [
          { entry: mainEntry, outdir: "js" },
          { entry: islandsEntry, outdir: "js" },
        ],
        { outDir: publicDir },
      );

      expect(mapping["js/main.js"]).toBeDefined();
      expect(mapping["js/islands.js"]).toBeDefined();
      expect(existsSync(join(publicDir, mapping["js/main.js"]!))).toBe(true);
      expect(existsSync(join(publicDir, mapping["js/islands.js"]!))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("content-hashed filenames differ between builds when hash is enabled", async () => {
    const tmpDir = join(tmpdir(), "forge-js-hash");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "app.ts"), "export const v = 42;");

    try {
      const { mapping } = await buildJS([{ entry: join(srcDir, "app.ts"), outdir: "js" }], { outDir: publicDir, hash: true });

      const hashed = mapping["js/app.js"]!;
      expect(hashed).toMatch(/^js\/app-[A-Z0-9]+\.js$/);
      expect(existsSync(join(publicDir, hashed))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildJS() never cleans the asset root", () => {
  it("refuses an outdir that resolves to the asset root, before it removes anything", async () => {
    const tmpDir = join(tmpdir(), "forge-js-root-outdir");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    writeFileSync(join(publicDir, "styles.css"), "body{}");

    try {
      await expect(buildJS([{ entry: join(srcDir, "main.ts"), outdir: "." }], { outDir: publicDir })).rejects.toThrow(/resolves to the asset root/);
      expect(existsSync(join(publicDir, "styles.css"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses an empty outdir for the same reason", async () => {
    const tmpDir = join(tmpdir(), "forge-js-empty-outdir");
    const srcDir = join(tmpDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");

    try {
      await expect(buildJS([{ entry: join(srcDir, "main.ts"), outdir: "" }], { outDir: join(tmpDir, "public") })).rejects.toThrow(
        /resolves to the asset root/,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("leaves a file it did not write in the outdir alone", async () => {
    const tmpDir = join(tmpdir(), "forge-js-scoped-clean");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    const outdir = join(publicDir, "js");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(outdir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    writeFileSync(join(outdir, "vendor.js"), "// written by something else");
    writeFileSync(join(outdir, "main-STALE1.js"), "// a previous hashed build of this very entry");

    try {
      await buildJS([{ entry: join(srcDir, "main.ts"), outdir: "js" }], { outDir: publicDir, hash: true });

      expect(existsSync(join(outdir, "vendor.js"))).toBe(true);
      expect(existsSync(join(outdir, "main-STALE1.js"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function writeConditionalProject(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-js-conditions-"));
  const pkgDir = join(root, "node_modules", "pkg");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "pkg", exports: { ".": { worker: "./worker.js", browser: "./browser.js" } } }),
  );
  writeFileSync(join(pkgDir, "worker.js"), 'export const marker = "WORKER_ENTRY";');
  writeFileSync(join(pkgDir, "browser.js"), 'export const marker = "BROWSER_ENTRY";');
  for (const name of ["sw", "app"]) {
    writeFileSync(join(root, "src", `${name}.ts`), 'import { marker } from "pkg";\nconsole.log(marker);');
  }
  return root;
}

describe("buildJS() export conditions", () => {
  it("selects a package's worker export for a bundle declaring the worker condition", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const { mapping } = await buildJS([{ entry: join(root, "src", "sw.ts"), outdir: "js", conditions: ["worker"] }], { outDir: publicDir });
      const output = readFileSync(join(publicDir, mapping["js/sw.js"]!), "utf-8");
      expect(output).toContain("WORKER_ENTRY");
      expect(output).not.toContain("BROWSER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the default browser export for a bundle declaring no conditions", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const { mapping } = await buildJS([{ entry: join(root, "src", "app.ts"), outdir: "js" }], { outDir: publicDir });
      const output = readFileSync(join(publicDir, mapping["js/app.js"]!), "utf-8");
      expect(output).toContain("BROWSER_ENTRY");
      expect(output).not.toContain("WORKER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds two bundles differing only in conditions separately, each resolving its own export", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const { mapping } = await buildJS(
        [
          { entry: join(root, "src", "sw.ts"), outdir: "js", conditions: ["worker"] },
          { entry: join(root, "src", "app.ts"), outdir: "js" },
        ],
        { outDir: publicDir },
      );
      const sw = readFileSync(join(publicDir, mapping["js/sw.js"]!), "utf-8");
      const app = readFileSync(join(publicDir, mapping["js/app.js"]!), "utf-8");
      expect(sw).toContain("WORKER_ENTRY");
      expect(sw).not.toContain("BROWSER_ENTRY");
      expect(app).toContain("BROWSER_ENTRY");
      expect(app).not.toContain("WORKER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets one bundle override the build-wide minify, so one build emits a minified and an unminified bundle", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-js-minify-"));
    const publicDir = join(root, "public");
    const source = "export function greet(longParameterName: string) { return longParameterName + '!'; }";
    writeFileSync(join(root, "minified.ts"), source);
    writeFileSync(join(root, "readable.ts"), source);
    try {
      const { mapping } = await buildJS(
        [
          { entry: join(root, "minified.ts"), outdir: "js" },
          { entry: join(root, "readable.ts"), outdir: "js", minify: false },
        ],
        { outDir: publicDir, minify: true },
      );
      expect(readFileSync(join(publicDir, mapping["js/minified.js"]!), "utf-8")).not.toContain("longParameterName");
      expect(readFileSync(join(publicDir, mapping["js/readable.js"]!), "utf-8")).toContain("longParameterName");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets one bundle opt into minify when the build-wide minify is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-js-minify-optin-"));
    const publicDir = join(root, "public");
    const source = "export function greet(longParameterName: string) { return longParameterName + '!'; }";
    writeFileSync(join(root, "minified.ts"), source);
    writeFileSync(join(root, "readable.ts"), source);
    try {
      const { mapping } = await buildJS(
        [
          { entry: join(root, "readable.ts"), outdir: "js" },
          { entry: join(root, "minified.ts"), outdir: "js", minify: true },
        ],
        { outDir: publicDir, minify: false },
      );
      expect(readFileSync(join(publicDir, mapping["js/minified.js"]!), "utf-8")).not.toContain("longParameterName");
      expect(readFileSync(join(publicDir, mapping["js/readable.js"]!), "utf-8")).toContain("longParameterName");
      expect(mapping["js/minified.js"]).toBe("js/minified.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
