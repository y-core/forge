import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import pkg from "../../../../package.json" with { type: "json" };
import { cloudflareWorkerSteps } from "../presets";
import { isCheckStep } from "../steps";
import { declaredSteps } from "../tiers";
import type { Finding } from "../types";
import { checkConsumerCssSources, markupNamespacesReached, sourceEntry, sourcesDirectories } from "./consumer-css-sources";
import { gateFixtureRoot } from "./gate.fixture";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const FORGE_ROOT = resolve(import.meta.dir, "../../../..");

const CSS_BUILD = (input: string) => `{ tool: "tailwindcss", input: "${input}", output: "css/${input.split("/").at(-1) ?? ""}" }`;

/** An app root whose installed forge is `installed`, written as files, or this repository's own tree when omitted. */
function app(files: Record<string, string>, cssInputs: readonly string[] = ["src/assets/main.css"], installed?: Record<string, string>): string {
  const packaged = Object.fromEntries(Object.entries(installed ?? {}).map(([path, contents]) => [`node_modules/@y-core/forge/${path}`, contents]));
  const root = gateFixtureRoot(
    { "config/assets.config.ts": `export default { css: [${cssInputs.map(CSS_BUILD).join(", ")}] };\n`, ...packaged, ...files },
    "forge-consumer-css-",
  );
  roots.push(root);
  if (installed === undefined) {
    mkdirSync(join(root, "node_modules/@y-core"), { recursive: true });
    symlinkSync(FORGE_ROOT, join(root, "node_modules/@y-core/forge"), "dir");
  }
  return root;
}

const SHIPPED: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "@y-core/forge",
    exports: {
      "./package.json": "./package.json",
      "./app": "./src/app/mod.ts",
      "./app/page": "./src/app/page.ts",
      "./app/sources.css": "./src/app/sources.css",
      "./render/htmx": {
        types: "./src/render/htmx/mod.ts",
        bun: "./src/render/htmx/mod.ts",
        node: "./src/render/htmx/mod.node.mjs",
        import: "./src/render/htmx/mod.node.mjs",
      },
      "./render/htmx/sources.css": "./src/render/htmx/sources.css",
      "./render/jsx": "./src/render/jsx/mod.ts",
      "./types": { types: "./src/types.ts" },
    },
  }),
  "src/app/mod.ts": 'export { page } from "./page";\nexport type { Fragment } from "../render/htmx/markup";\n',
  "src/app/page.ts": 'export const page = () => ({ class: "flex gap-4 p-6" });\n',
  "src/render/htmx/mod.ts": 'export { fragment } from "./markup";\n',
  "src/render/htmx/markup.ts": 'export const fragment = () => ({ class: "rounded border px-4" });\nexport type Fragment = string;\n',
  "src/render/htmx/mod.node.mjs": 'export const fragment = () => "";\n',
  "src/render/jsx/mod.ts": 'import { outside } from "../../../outside";\n\nexport const jsx = () => outside;\n',
  "src/types.ts": "export type AppContext = { flex: 'flex gap-4' };\n",
};

const run = (root: string) => checkConsumerCssSources({ root, assetConfig: "config/assets.config.ts", packageName: pkg.name });

const missing = (findings: readonly Finding[]) => findings.map((finding) => [finding.file, finding.detail?.[0]]);

describe("checkConsumerCssSources", () => {
  it("fails an app that imports @y-core/forge/app without the sources.css of the markup it reaches, and passes once they are added", async () => {
    const worker = 'import { createApp } from "@y-core/forge/app";\n\nexport default createApp();\n';
    const without = await run(app({ "src/worker.ts": worker, "src/assets/main.css": '@import "tailwindcss";\n' }));
    const withIt = await run(
      app({
        "src/worker.ts": worker,
        "src/assets/main.css":
          '@import "tailwindcss";\n@import "@y-core/forge/app/sources.css";\n@import "@y-core/forge/render/htmx/sources.css";\n',
      }),
    );

    expect([without.ok, missing(without.findings), without.findings[0]?.detail?.[1]]).toEqual([
      false,
      [
        ["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";'],
        ["src/assets/main.css", 'add: @import "@y-core/forge/render/htmx/sources.css";'],
      ],
      "src/worker.ts:1 imports `@y-core/forge/app`",
    ]);
    expect([withIt.ok, withIt.findings]).toEqual([true, []]);
  });

  it("requires nothing for a type-only import, a namespace shipping no sources.css, or a test file", async () => {
    const result = await run(
      app({
        "src/types.ts": 'import type { AppContext } from "@y-core/forge/app";\n',
        "src/schema.ts": 'import { v } from "@y-core/forge/validation";\n',
        "src/worker.test.ts": 'import { createApp } from "@y-core/forge/app";\n',
        "src/assets/main.css": '@import "tailwindcss";\n',
      }),
    );

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("passes a print sheet without the import beside a main sheet carrying it", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
          "src/assets/main.css": "@import '@y-core/forge/app/sources.css';\n",
          "src/assets/print.css": '@import "tailwindcss";\n',
        },
        ["src/assets/print.css", "src/assets/main.css"],
        SHIPPED,
      ),
    );

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("fails against the first entry when no CSS entry carries the import", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
          "src/assets/main.css": '@import "tailwindcss";\n',
          "src/assets/print.css": '@import "tailwindcss";\n',
        },
        ["src/assets/main.css", "src/assets/print.css"],
        SHIPPED,
      ),
    );

    expect([result.ok, missing(result.findings)]).toEqual([false, [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']]]);
  });

  it("passes an entry that imports the sources.css through a relative stylesheet", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
          "src/assets/main.css": '@import "tailwindcss";\n@import "./forge.css";\n',
          "src/assets/forge.css": '@import "../styles/forge-sources.css";\n',
          "src/styles/forge-sources.css": '@import "@y-core/forge/app/sources.css";\n',
        },
        undefined,
        SHIPPED,
      ),
    );

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("terminates on an import cycle and fails when the cycle never reaches the sources.css", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
          "src/assets/main.css": '@import "./forge.css";\n',
          "src/assets/forge.css": '@import "./main.css";\n@import "./absent.css";\n',
        },
        undefined,
        SHIPPED,
      ),
    );

    expect([result.ok, missing(result.findings)]).toEqual([false, [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']]]);
  });

  it("does not follow a relative import that only a CSS block comment holds", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
          "src/assets/main.css": '/* @import "./forge.css"; */\n',
          "src/assets/forge.css": '@import "@y-core/forge/app/sources.css";\n',
        },
        undefined,
        SHIPPED,
      ),
    );

    expect(result.ok).toBe(false);
  });

  it("scans the `sources` the preset is given, rather than `src`", async () => {
    const root = app(
      { "app/worker.ts": 'import { createApp } from "@y-core/forge/app";\n', "app/assets/main.css": '@import "tailwindcss";\n' },
      ["app/assets/main.css"],
      SHIPPED,
    );
    const row = declaredSteps(
      cloudflareWorkerSteps({ root, assetConfig: "config/assets.config.ts", consumerCssSources: { sources: ["app"] } }),
    ).find((step) => step.label === "validate-consumer-css-sources");
    if (row === undefined || !isCheckStep(row)) throw new Error("no validate-consumer-css-sources row");
    const result = await row.run("static");

    expect([result.ok, missing(result.findings), result.findings[0]?.detail?.[1]]).toEqual([
      false,
      [["app/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
      "app/worker.ts:1 imports `@y-core/forge/app`",
    ]);
  });

  it("fails a CSS entry that does not exist", async () => {
    const result = await run(app({ "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n' }, undefined, SHIPPED));

    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["config/assets.config.ts", "the CSS entry `src/assets/main.css` named by `config/assets.config.ts` does not exist"],
    ]);
  });

  it("fails when the package is not installed, rather than requiring nothing", async () => {
    const root = gateFixtureRoot({ "src/worker.ts": "export {};\n" }, "forge-consumer-css-");
    roots.push(root);
    const result = await checkConsumerCssSources({ root, assetConfig: "config/assets.config.ts", packageName: "@scope/absent" });

    expect([result.ok, result.findings[0]?.message]).toEqual([
      false,
      "`@scope/absent` is not installed, so which of its namespaces ship a `sources.css` cannot be read",
    ]);
  });

  it("refuses a scan that found no source", async () => {
    const result = await run(app({ "src/assets/main.css": "" }));

    expect(result.ok).toBe(false);
  });
});

describe("checkConsumerCssSources — which imports count", () => {
  const BARE_CSS = '@import "tailwindcss";\n';
  const runShipped = (files: Record<string, string>, cssInputs?: readonly string[]) =>
    run(app({ "src/assets/main.css": BARE_CSS, ...files }, cssInputs, SHIPPED));

  it("does not carry a requirement across an in-package type-only import", async () => {
    const result = await runShipped({ "src/worker.ts": 'import { page } from "@y-core/forge/app";\n' });

    expect(missing(result.findings)).toEqual([["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']]);
  });

  const cases: { name: string; source: string; expected: (string | undefined)[][] }[] = [
    {
      name: "a conditional export resolves to its bun source and follows its value imports, never to its node bundle",
      source: 'import { fragment } from "@y-core/forge/render/htmx";\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/render/htmx/sources.css";']],
    },
    {
      name: "an entry whose closure declares no classes requires nothing, and its import out of the package is not followed",
      source: 'import { jsx } from "@y-core/forge/render/jsx";\n',
      expected: [],
    },
    {
      name: "a subpath the package does not export requires nothing",
      source: 'import { hx } from "@y-core/forge/render/htmx/attrs";\n',
      expected: [],
    },
    { name: "a subpath exported only as types requires nothing", source: 'import { AppContext } from "@y-core/forge/types";\n', expected: [] },
    {
      name: "the package root and non-namespace subpaths require nothing",
      source: 'import forge from "@y-core/forge";\nimport manifest from "@y-core/forge/package.json" with { type: "json" };\n',
      expected: [],
    },
    { name: "a type-only import requires nothing", source: 'import type { AppContext } from "@y-core/forge/app";\n', expected: [] },
    {
      name: "an import whose every member is inline-typed requires nothing",
      source: 'import { type AppContext, type AppEnv } from "@y-core/forge/app";\n',
      expected: [],
    },
    { name: "an export type re-export requires nothing", source: 'export type { AppContext } from "@y-core/forge/app";\n', expected: [] },
    {
      name: "a value re-export requires the namespace",
      source: 'export { createApp } from "@y-core/forge/app";\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
    },
    {
      name: "a star re-export requires the namespace",
      source: 'export * from "@y-core/forge/app";\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
    },
    {
      name: "a dynamic import requires the namespace",
      source: 'export const load = () => import("@y-core/forge/app");\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
    },
    {
      name: "a side-effect import requires the namespace",
      source: 'import "@y-core/forge/app";\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
    },
    {
      name: "a mixed value-and-type import requires the namespace",
      source: 'import { createApp, type AppContext } from "@y-core/forge/app";\n',
      expected: [["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']],
    },
    {
      name: "an import inside a line comment requires nothing",
      source: '// import { createApp } from "@y-core/forge/app";\nexport {};\n',
      expected: [],
    },
    {
      name: "a specifier sharing only a name prefix with the package requires nothing",
      source: 'import { x } from "@y-core/forge-extras/app";\n',
      expected: [],
    },
  ];

  for (const { name, source, expected } of cases) {
    it(name, async () => {
      const result = await runShipped({ "src/worker.ts": source });

      expect([result.ok, missing(result.findings)]).toEqual([expected.length === 0, expected]);
    });
  }

  it("scans a .tsx module as well as a .ts one", async () => {
    const result = await runShipped({ "src/page.tsx": 'import { createApp } from "@y-core/forge/app";\n' });

    expect(result.findings.map((finding) => finding.detail)).toEqual([
      ['add: @import "@y-core/forge/app/sources.css";', "src/page.tsx:1 imports `@y-core/forge/app`"],
    ]);
  });

  it("lists every importing site under the one missing namespace", async () => {
    const result = await runShipped({
      "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n\nimport { page } from "@y-core/forge/app/page";\n',
    });

    expect(result.findings.map((finding) => finding.detail)).toEqual([
      [
        'add: @import "@y-core/forge/app/sources.css";',
        "src/worker.ts:1 imports `@y-core/forge/app`",
        "src/worker.ts:3 imports `@y-core/forge/app/page`",
      ],
    ]);
  });

  it("names the missing namespace in the failure message, against the entry that lacks it", async () => {
    const result = await runShipped({ "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n' });

    expect(result.findings.map((finding) => [finding.level, finding.file, finding.message])).toEqual([
      ["fail", "src/assets/main.css", "no CSS entry imports `@y-core/forge/app/sources.css`, so the `app` markup the app renders ships unstyled"],
    ]);
  });

  it("passes two entries of which one carries the import, in either order", async () => {
    const files = {
      "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
      "src/assets/main.css": '@import "@y-core/forge/app/sources.css";\n',
      "src/assets/admin.css": BARE_CSS,
    };
    const adminLast = await runShipped(files, ["src/assets/main.css", "src/assets/admin.css"]);
    const adminFirst = await runShipped(files, ["src/assets/admin.css", "src/assets/main.css"]);

    expect([adminLast.ok, adminLast.findings, adminFirst.ok, adminFirst.findings]).toEqual([true, [], true, []]);
  });

  it("passes once both required imports are present, in single or double quotes", async () => {
    const result = await runShipped({
      "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\nimport { hx } from "@y-core/forge/render/htmx";\n',
      "src/assets/main.css": "@import \"@y-core/forge/app/sources.css\";\n@import '@y-core/forge/render/htmx/sources.css';\n",
    });

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("does not accept an import of a different namespace's sources.css as this one's", async () => {
    const result = await runShipped({
      "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
      "src/assets/main.css": '@import "@y-core/forge/render/htmx/sources.css";\n',
    });

    expect(missing(result.findings)).toEqual([["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']]);
  });

  it("refuses an @import that only a CSS block comment holds", async () => {
    const result = await runShipped({
      "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
      "src/assets/main.css": '/* @import "@y-core/forge/app/sources.css"; */\n@import "tailwindcss";\n',
    });

    expect(missing(result.findings)).toEqual([["src/assets/main.css", 'add: @import "@y-core/forge/app/sources.css";']]);
  });

  it("passes with no requirement when the assets config names no CSS entry", async () => {
    const result = await runShipped({ "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n' }, []);

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("scans only the directories `sources` names", async () => {
    const root = app(
      {
        "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n',
        "worker/index.ts": 'import { hx } from "@y-core/forge/render/htmx";\n',
        "src/assets/main.css": BARE_CSS,
      },
      undefined,
      SHIPPED,
    );
    const result = await checkConsumerCssSources({ root, assetConfig: "config/assets.config.ts", packageName: pkg.name, sources: ["worker"] });

    expect(missing(result.findings)).toEqual([["src/assets/main.css", 'add: @import "@y-core/forge/render/htmx/sources.css";']]);
  });

  it("fails a `sources` entry naming no directory, rather than scanning the rest green", async () => {
    const root = app({ "src/worker.ts": "export {};\n", "src/assets/main.css": BARE_CSS }, undefined, SHIPPED);
    const result = await checkConsumerCssSources({
      root,
      assetConfig: "config/assets.config.ts",
      packageName: pkg.name,
      sources: ["src", "absent"],
    });

    expect([result.ok, result.findings.map((finding) => finding.message)]).toEqual([
      false,
      ["`sources` entry `absent` names no directory under the root"],
    ]);
  });

  it("refuses a scan that found no source, naming the scanned directory", async () => {
    const result = await runShipped({});

    expect([result.ok, result.findings.map((finding) => finding.message)]).toEqual([
      false,
      ["`src` matched no source — refusing to report a green consumer-css-sources gate that scanned nothing"],
    ]);
  });

  it("does not count a test file as a scanned source", async () => {
    const result = await runShipped({ "src/worker.test.ts": 'import { createApp } from "@y-core/forge/app";\n' });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src` matched no source — refusing to report a green consumer-css-sources gate that scanned nothing",
    ]);
  });
});

describe("checkConsumerCssSources — against this repository's own tree", () => {
  const cases: { name: string; source: string; expected: string[] }[] = [
    { name: "logging alone requires nothing", source: 'import { createLogger } from "@y-core/forge/logging";\n', expected: [] },
    {
      name: "logging/viewer requires logging/sources.css",
      source: 'import * as viewer from "@y-core/forge/logging/viewer";\n',
      expected: ["logging"],
    },
    { name: "auth alone requires nothing", source: 'import { createUserStore } from "@y-core/forge/auth";\n', expected: [] },
    {
      name: "auth/web requires auth/sources.css, and the render/htmx markup it reaches",
      source: 'import * as web from "@y-core/forge/auth/web";\n',
      expected: ["auth", "render/htmx"],
    },
    {
      name: "app requires app/sources.css, and the render/htmx markup its error page reaches",
      source: 'import { createApp } from "@y-core/forge/app";\n',
      expected: ["app", "render/htmx"],
    },
    { name: "a type-only import requires nothing", source: 'import type { AppContext } from "@y-core/forge/app";\n', expected: [] },
  ];

  for (const { name, source, expected } of cases) {
    it(name, async () => {
      const result = await run(app({ "src/worker.ts": source, "src/assets/main.css": '@import "tailwindcss";\n' }));

      expect(result.findings.map((finding) => finding.detail?.[0])).toEqual(
        expected.map((namespace) => `add: @import "@y-core/forge/${namespace}/sources.css";`),
      );
    });
  }
});

describe("sourceEntry", () => {
  it("takes a string target, else the bun condition, else the default import one, and skips a types-only export", () => {
    const exports = {
      "./a": "./src/a/mod.ts",
      "./b": { types: "./src/b/mod.ts", bun: "./src/b/mod.ts", node: "./src/b/mod.node.mjs", import: "./src/b/mod.node.mjs" },
      "./c": { types: "./src/c/mod.ts", import: "./src/c/mod.ts" },
      "./d": { types: "./src/d.d.ts" },
    };

    expect(["a", "b", "c", "d", "e"].map((subpath) => sourceEntry(exports, subpath))).toEqual([
      "src/a/mod.ts",
      "src/b/mod.ts",
      "src/c/mod.ts",
      null,
      null,
    ]);
  });
});

describe("sourcesDirectories", () => {
  it("maps each namespace exporting a sources.css to the directory the sheet sits in", () => {
    const exports = {
      "./app": "./src/app/mod.ts",
      "./app/sources.css": "./src/app/sources.css",
      "./render/htmx/sources.css": "./lib/htmx/sources.css",
    };

    expect([...sourcesDirectories(exports)]).toEqual([
      ["app", "src/app"],
      ["render/htmx", "lib/htmx"],
    ]);
  });
});

describe("markupNamespacesReached", () => {
  const MARKUP = 'export const view = () => ({ class: "flex gap-4" });\nexport type View = string;\n';
  const DIRECTORIES = new Map([
    ["a", "src/a"],
    ["b", "src/b"],
  ]);

  function reached(files: Record<string, string>, entry = "src/a/mod.ts", directories: ReadonlyMap<string, string> = DIRECTORIES): string[] {
    const dir = gateFixtureRoot(files, "forge-markup-reach-");
    roots.push(dir);
    return [...markupNamespacesReached({ dir, exports: {} }, entry, directories)].sort();
  }

  const cases: { name: string; entry: string; expected: string[] }[] = [
    { name: "follows a named value re-export", entry: 'export { view } from "../b/view";\n', expected: ["b"] },
    { name: "follows a star re-export", entry: 'export * from "../b/view";\n', expected: ["b"] },
    { name: "follows a namespaced star re-export", entry: 'export * as b from "../b/view";\n', expected: ["b"] },
    {
      name: "follows a default-and-inline-type import as a value import",
      entry: 'import view, { type View } from "../b/view";\n',
      expected: ["b"],
    },
    { name: "follows a side-effect import", entry: 'import "../b/view";\n', expected: ["b"] },
    { name: "follows a dynamic import", entry: 'export const load = () => import("../b/view");\n', expected: ["b"] },
    { name: "follows a specifier written with its .ts extension", entry: 'export * from "../b/view.ts";\n', expected: ["b"] },
    { name: "follows a .js specifier to its .ts source", entry: 'export * from "../b/view.js";\n', expected: ["b"] },
    { name: "does not follow an import type", entry: 'import type { View } from "../b/view";\n', expected: [] },
    { name: "does not follow an export type re-export", entry: 'export type { View } from "../b/view";\n', expected: [] },
    { name: "does not follow an import whose every member is inline-typed", entry: 'import { type View } from "../b/view";\n', expected: [] },
    {
      name: "does not follow an import that only a comment holds",
      entry: '// export * from "../b/view";\n/* import "../b/view"; */\nexport {};\n',
      expected: [],
    },
    { name: "does not follow an import naming no file", entry: 'export * from "../b/absent";\n', expected: [] },
  ];

  for (const { name, entry, expected } of cases) {
    it(name, () => {
      expect(reached({ "src/a/mod.ts": entry, "src/b/view.ts": MARKUP })).toEqual(expected);
    });
  }

  it("credits the entry's own namespace when the entry itself declares classes", () => {
    expect(reached({ "src/a/mod.ts": MARKUP })).toEqual(["a"]);
  });

  it("does not credit a file whose class-like string sits only in a comment", () => {
    expect(reached({ "src/a/mod.ts": '// const view = () => ({ class: "flex gap-4" });\nexport {};\n' })).toEqual([]);
  });

  it("terminates on an import cycle and credits markup reached only through it", () => {
    expect(
      reached({
        "src/a/mod.ts": 'import { loop } from "./loop";\nexport const mod = loop;\n',
        "src/a/loop.ts": 'import { mod } from "./mod";\nexport { view } from "../b/view";\nexport const loop = () => mod;\n',
        "src/b/view.ts": MARKUP,
      }),
    ).toEqual(["b"]);
  });

  it("terminates on a module importing itself", () => {
    expect(reached({ "src/a/mod.ts": 'import { a } from "./mod";\nexport const a = 1;\n' })).toEqual([]);
  });

  it("resolves an extensionless specifier to a .tsx file and credits the markup its JSX declares", () => {
    expect(
      reached({
        "src/a/mod.ts": 'export { View } from "../b/view";\n',
        "src/b/view.tsx": 'export const View = () => <div class="flex gap-4" />;\n',
      }),
    ).toEqual(["b"]);
  });

  it("resolves a directory specifier to its index.ts", () => {
    expect(reached({ "src/a/mod.ts": 'export * from "../b/view";\n', "src/b/view/index.ts": MARKUP })).toEqual(["b"]);
  });

  it("follows a file outside every sheet's directory without crediting its own markup", () => {
    expect(
      reached(
        { "src/shared/util.ts": 'export { view } from "../b/view";\nexport const own = "flex gap-4";\n', "src/b/view.ts": MARKUP },
        "src/shared/util.ts",
      ),
    ).toEqual(["b"]);
  });

  it("does not credit a namespace to a sibling directory sharing its name as a prefix", () => {
    expect(reached({ "src/a/mod.ts": 'export * from "../bb/view";\n', "src/bb/view.ts": MARKUP })).toEqual([]);
  });

  describe("crediting a file to the deepest namespace directory holding it", () => {
    const NESTED = new Map([
      ["render", "src/render"],
      ["render/htmx", "src/render/htmx"],
    ]);
    const nested: { name: string; files: Record<string, string>; expected: string[] }[] = [
      {
        name: "markup under the nested directory credits only the nested namespace",
        files: { "src/render/mod.ts": 'export * from "./htmx/fragment";\n', "src/render/htmx/fragment.ts": MARKUP },
        expected: ["render/htmx"],
      },
      {
        name: "markup directly under the outer directory credits only the outer namespace",
        files: { "src/render/mod.ts": MARKUP, "src/render/htmx/fragment.ts": "export const fragment = 1;\n" },
        expected: ["render"],
      },
      {
        name: "markup in both directories credits both namespaces",
        files: { "src/render/mod.ts": `${MARKUP}export * from "./htmx/fragment";\n`, "src/render/htmx/fragment.ts": MARKUP },
        expected: ["render", "render/htmx"],
      },
    ];

    for (const { name, files, expected } of nested) {
      it(name, () => {
        expect(reached(files, "src/render/mod.ts", NESTED)).toEqual(expected);
      });
    }

    it("credits the same nested namespace whichever order the directories are listed in", () => {
      const files = { "src/render/mod.ts": 'export * from "./htmx/fragment";\n', "src/render/htmx/fragment.ts": MARKUP };

      expect(reached(files, "src/render/mod.ts", new Map([...NESTED].reverse()))).toEqual(["render/htmx"]);
    });
  });

  it("reaches nothing from an entry file that does not exist", () => {
    expect(reached({ "src/b/view.ts": MARKUP })).toEqual([]);
  });
});

describe("checkConsumerCssSources — the findings one run produces", () => {
  const BARE_CSS = '@import "tailwindcss";\n';

  it("names only the sheet a partial CSS entry lacks, with the site importing it", async () => {
    const result = await run(
      app(
        {
          "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\nimport { fragment } from "@y-core/forge/render/htmx";\n',
          "src/assets/main.css": '@import "tailwindcss";\n@import "@y-core/forge/app/sources.css";\n',
        },
        undefined,
        SHIPPED,
      ),
    );

    expect(result.findings.map((finding) => [finding.file, finding.detail])).toEqual([
      ["src/assets/main.css", ['add: @import "@y-core/forge/render/htmx/sources.css";', "src/worker.ts:2 imports `@y-core/forge/render/htmx`"]],
    ]);
  });

  it("reports a subpath two files import once, listing both sites", async () => {
    const result = await run(
      app(
        {
          "src/home.ts": 'import { page } from "@y-core/forge/app/page";\n',
          "src/worker.ts": 'export const x = 1;\nimport { page } from "@y-core/forge/app/page";\n',
          "src/assets/main.css": BARE_CSS,
        },
        undefined,
        SHIPPED,
      ),
    );

    expect(result.findings.map((finding) => finding.detail)).toEqual([
      [
        'add: @import "@y-core/forge/app/sources.css";',
        "src/home.ts:1 imports `@y-core/forge/app/page`",
        "src/worker.ts:2 imports `@y-core/forge/app/page`",
      ],
    ]);
  });

  it("re-reads the installed package on every run rather than reusing an earlier run's reach", async () => {
    const root = app({ "src/worker.ts": 'import { page } from "@y-core/forge/app/page";\n', "src/assets/main.css": BARE_CSS }, undefined, SHIPPED);
    const before = await run(root);
    writeFileSync(join(root, "node_modules/@y-core/forge/src/app/page.ts"), "export const page = () => null;\n", "utf-8");
    const after = await run(root);

    expect([before.ok, after.ok, after.findings]).toEqual([false, true, []]);
  });

  it("requires nothing for a subpath whose exported entry file is missing", async () => {
    const result = await run(
      app({ "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n', "src/assets/main.css": BARE_CSS }, undefined, {
        "package.json": JSON.stringify({ exports: { "./app": "./src/app/mod.ts", "./app/sources.css": "./src/app/sources.css" } }),
        "src/app/page.ts": 'export const page = () => ({ class: "flex gap-4" });\n',
      }),
    );

    expect([result.ok, result.findings]).toEqual([true, []]);
  });

  it("requires nothing from an installed package whose manifest has no exports", async () => {
    const result = await run(
      app({ "src/worker.ts": 'import { createApp } from "@y-core/forge/app";\n', "src/assets/main.css": BARE_CSS }, undefined, {
        "package.json": JSON.stringify({ name: "@y-core/forge" }),
        "src/app/mod.ts": 'export const createApp = () => ({ class: "flex gap-4" });\n',
      }),
    );

    expect([result.ok, result.findings]).toEqual([true, []]);
  });
});

describe("checkConsumerCssSources — every subpath of this repository at once", () => {
  const subpaths = Object.keys(pkg.exports)
    .filter((key) => !key.endsWith(".css") && key !== "./package.json")
    .map((key) => `${pkg.name}${key.slice(1)}`);
  const worker = subpaths.map((specifier, index) => `import * as m${index} from "${specifier}";\n`).join("");
  const shipped = [...sourcesDirectories(pkg.exports).keys()].sort();

  it("requires the sources.css of every namespace that ships one, within three seconds", async () => {
    const result = await run(app({ "src/worker.ts": worker, "src/assets/main.css": '@import "tailwindcss";\n' }));

    expect(result.findings.map((finding) => finding.detail?.[0])).toEqual(
      shipped.map((namespace) => `add: @import "@y-core/forge/${namespace}/sources.css";`),
    );
  }, 3000);
});
