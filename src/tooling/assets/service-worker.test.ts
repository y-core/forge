import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildServiceWorker, precacheUrls, precacheVersion, removeServiceWorker } from "./service-worker";

function workerProject(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "forge-sw-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "sw.ts"), source);
  return root;
}

const READS_PRECACHE = 'import { PRECACHE_URLS } from "@y-core/forge/assets/precache";\nconsole.log(JSON.stringify(PRECACHE_URLS));\n';
const READS_BOTH =
  'import { PRECACHE_URLS, PRECACHE_VERSION } from "@y-core/forge/assets/precache";\nconsole.log(JSON.stringify({ urls: PRECACHE_URLS, version: PRECACHE_VERSION }));\n';

function assetTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-sw-tree-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

function versionOf(files: Record<string, string>, exclude: (dir: string) => string[] = () => []): string {
  const dir = assetTree(files);
  try {
    return precacheVersion(dir, exclude(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TREE = { "css/main.css": "a{color:#000}", "js/main.js": "export {};", "fonts/inter.woff2": "wOF2" };

describe("precacheUrls", () => {
  it("prefixes each path with the public prefix, as a page requests it", () => {
    expect(precacheUrls("/assets", ["js/main.js", "js/chunks/editor-AB12.js"])).toEqual(["/assets/js/chunks/editor-AB12.js", "/assets/js/main.js"]);
  });

  it("strips one trailing slash from the prefix and drops a repeated path", () => {
    expect(precacheUrls("/assets/", ["css/main.css", "css/main.css"])).toEqual(["/assets/css/main.css"]);
    expect(precacheUrls("/", ["app.js"])).toEqual(["/app.js"]);
  });
});

describe("precacheVersion", () => {
  it("answers the same SHA-256 hex digest for the same tree, wherever it sits and whatever order it was written in", () => {
    const reversed = Object.fromEntries(Object.entries(TREE).reverse());

    expect(versionOf(TREE)).toMatch(/^[0-9a-f]{64}$/);
    expect(versionOf(reversed)).toBe(versionOf(TREE));
  });

  const changes: { name: string; tree: Record<string, string> }[] = [
    { name: "one changed byte in a file", tree: { ...TREE, "css/main.css": "a{color:#001}" } },
    { name: "one byte added to a file", tree: { ...TREE, "js/main.js": "export {};\n" } },
    {
      name: "a file renamed with its bytes kept",
      tree: { "css/app.css": "a{color:#000}", "js/main.js": "export {};", "fonts/inter.woff2": "wOF2" },
    },
    { name: "an empty file added", tree: { ...TREE, "js/chunks/lazy.js": "" } },
    { name: "a file removed", tree: { "css/main.css": "a{color:#000}", "js/main.js": "export {};" } },
  ];

  for (const { name, tree } of changes) {
    it(`answers a new version for ${name}`, () => {
      expect(versionOf(tree)).not.toBe(versionOf(TREE));
    });
  }

  it("keeps a byte moved across the boundary between a file's name and its contents from colliding", () => {
    expect(versionOf({ ab: "c" })).not.toBe(versionOf({ a: "bc" }));
  });

  it("ignores an excluded file, so the version matches the tree without it whatever the file holds", () => {
    const withWorker = (worker: string) => ({ ...TREE, "sw.js": worker });
    const excludeWorker = (dir: string) => [join(dir, "sw.js")];

    expect(versionOf(withWorker("first"), excludeWorker)).toBe(versionOf(TREE));
    expect(versionOf(withWorker("second"), excludeWorker)).toBe(versionOf(TREE));
    expect(versionOf(withWorker("first"))).not.toBe(versionOf(TREE));
  });

  it("matches an exclusion written as an unnormalised path", () => {
    expect(versionOf({ ...TREE, "sw.js": "worker" }, (dir) => [join(dir, "js", "..", "sw.js")])).toBe(versionOf(TREE));
  });
});

describe("buildServiceWorker", () => {
  it("injects the version as PRECACHE_VERSION alongside PRECACHE_URLS", async () => {
    const root = workerProject(READS_BOTH);
    try {
      const written = await buildServiceWorker(
        { entry: join(root, "src", "sw.ts") },
        { outDir: join(root, "public"), precache: ["/assets/js/main.js"], version: "3f9a" },
      );

      expect(JSON.parse(Bun.spawnSync(["bun", written]).stdout.toString())).toEqual({ urls: ["/assets/js/main.js"], version: "3f9a" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes sw.js unhashed into the directory it is given, with the precache list as the imported PRECACHE_URLS", async () => {
    const root = workerProject(READS_PRECACHE);
    const outDir = join(root, "public");
    try {
      const written = await buildServiceWorker(
        { entry: join(root, "src", "sw.ts") },
        { outDir, precache: ["/assets/js/main-AB12.js", "/assets/js/chunks/editor.mount-CD34.js"], version: "" },
      );

      expect(written).toBe(join(outDir, "sw.js"));
      expect(Bun.spawnSync(["bun", written]).stdout.toString().trim()).toBe(
        JSON.stringify(["/assets/js/main-AB12.js", "/assets/js/chunks/editor.mount-CD34.js"]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits a classic script, which registers without a module type", async () => {
    const root = workerProject(READS_PRECACHE);
    try {
      const written = await buildServiceWorker({ entry: join(root, "src", "sw.ts") }, { outDir: join(root, "public"), precache: [], version: "" });
      const source = readFileSync(written, "utf-8");

      expect(/^\s*(import|export)\b/m.test(source)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies the worker's own define and conditions", async () => {
    const root = workerProject('import { marker } from "pkg";\nconsole.log(marker, VERSION);\n');
    const pkgDir = join(root, "node_modules", "pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "pkg", exports: { ".": { worker: "./worker.js", browser: "./browser.js" } } }),
    );
    writeFileSync(join(pkgDir, "worker.js"), 'export const marker = "WORKER_ENTRY";');
    writeFileSync(join(pkgDir, "browser.js"), 'export const marker = "BROWSER_ENTRY";');
    try {
      const written = await buildServiceWorker(
        { entry: join(root, "src", "sw.ts"), conditions: ["worker"], define: { VERSION: '"v7"' } },
        { outDir: join(root, "public"), precache: [], version: "" },
      );
      const source = readFileSync(written, "utf-8");

      expect([source.includes("WORKER_ENTRY"), source.includes("BROWSER_ENTRY"), source.includes('"v7"')]).toEqual([true, false, true]);
      expect(existsSync(join(root, "public", "sw.js"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("removeServiceWorker", () => {
  const minifyCases = [false, true];

  for (const minify of minifyCases) {
    it(`deletes a sw.js this build wrote${minify ? " minified" : ""}`, async () => {
      const root = workerProject(READS_PRECACHE);
      const outDir = join(root, "public");
      try {
        await buildServiceWorker({ entry: join(root, "src", "sw.ts"), minify }, { outDir, precache: [], version: "" });
        expect(existsSync(join(outDir, "sw.js"))).toBe(true);

        removeServiceWorker(outDir);

        expect(existsSync(join(outDir, "sw.js"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("leaves a hand-written sw.js byte for byte, and the rest of the directory with it", () => {
    const foreign = "self.addEventListener('fetch', () => {});\n";
    const outDir = assetTree({ "sw.js": foreign, _headers: "/assets/*\n" });
    try {
      removeServiceWorker(outDir);

      expect([readFileSync(join(outDir, "sw.js"), "utf-8"), readFileSync(join(outDir, "_headers"), "utf-8")]).toEqual([foreign, "/assets/*\n"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("leaves a hand-written sw.js that quotes forge's first line further down", async () => {
    const root = workerProject(READS_PRECACHE);
    const outDir = join(root, "public");
    try {
      await buildServiceWorker({ entry: join(root, "src", "sw.ts") }, { outDir, precache: [], version: "" });
      const forgeFirstLine = readFileSync(join(outDir, "sw.js"), "utf-8").split("\n")[0] as string;
      const foreign = `// adapted from forge\n${forgeFirstLine}\n`;
      writeFileSync(join(outDir, "sw.js"), foreign);

      removeServiceWorker(outDir);

      expect(readFileSync(join(outDir, "sw.js"), "utf-8")).toBe(foreign);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does nothing when there is no sw.js, or no directory at all", () => {
    const outDir = assetTree({ _headers: "/assets/*\n" });
    try {
      removeServiceWorker(outDir);
      removeServiceWorker(join(outDir, "missing"));

      expect(readdirSync(outDir)).toEqual(["_headers"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
