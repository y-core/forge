import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config";
import { assetInputs } from "./inputs";
import { buildJS } from "./js";
import { buildServiceWorker } from "./service-worker";

const TAILWIND = dirname(fileURLToPath(import.meta.resolve("tailwindcss/index.css")));

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "forge-asset-inputs-")));
  roots.push(root);
  mkdirSync(join(root, "node_modules"));
  symlinkSync(TAILWIND, join(root, "node_modules/tailwindcss"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const CONFIG = {
  js: { bundles: [{ entry: "src/client/main.ts", outdir: "js" }], serviceWorker: { entry: "src/client/sw.ts" } },
  css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
  copy: [{ from: "static/robots.txt", to: "robots.txt" }],
  rasters: [{ from: "art/logo.svg", to: "img/logo.png", width: 64 }],
  sprites: { main: { target: "svg/sprite.svg", sources: [{ path: "art/icons/", files: ["star.svg", { key: "moon", file: "night.svg" }] }] } },
  marks: [{ from: "art/mark.svg", to: "marks/mark.json" }],
};

const APP: Record<string, string> = {
  "config/assets.ts": `import { site } from "./site";\nexport default { ...${JSON.stringify(CONFIG)}, site: undefined, extra: site };\n`,
  "config/site.ts": "export const site = 1;\n",
  "src/client/main.ts": 'import { helper } from "./helper";\nimport { dep } from "dep";\nconsole.log(helper, dep);\n',
  "src/client/helper.ts": "export const helper = 1;\n",
  "src/client/sw.ts":
    'import { PRECACHE_URLS } from "@y-core/forge/assets/precache";\nimport { worker } from "./worker-only";\nconsole.log(PRECACHE_URLS, worker);\n',
  "src/client/worker-only.ts": "export const worker = 1;\n",
  "src/client/unbundled.ts": "export const unbundled = 1;\n",
  "src/styles/main.css": '@import "tailwindcss" source(none);\n@import "./theme.css";\n@source "../views";\n@source not "../views/**/*.test.ts";\n',
  "src/styles/theme.css": ":root { --x: 1; }\n",
  "src/views/page.tsx": "export const page = 1;\n",
  "src/views/page.test.ts": "export const spec = 1;\n",
  "static/robots.txt": "User-agent: *\n",
  "art/logo.svg": "<svg/>\n",
  "art/mark.svg": "<svg/>\n",
  "art/icons/star.svg": "<svg/>\n",
  "art/icons/night.svg": "<svg/>\n",
  "docs/README.md": "# docs\n",
  "node_modules/dep/package.json": '{ "name": "dep", "main": "index.js" }\n',
  "node_modules/dep/index.js": "export const dep = 1;\n",
};

const listing = (files: Record<string, string>): string[] => Object.keys(files).filter((path) => !path.startsWith("node_modules/"));

const configModule = (config: object): string => `export default ${JSON.stringify(config)};\n`;

describe("assetInputs()", () => {
  it("answers bundle and service-worker inputs, stylesheets and covered sources, stated paths and the config's closure, never node_modules", async () => {
    expect(await assetInputs(fixtureRoot(APP), "config/assets.ts", listing(APP))).toEqual([
      "art/icons/night.svg",
      "art/icons/star.svg",
      "art/logo.svg",
      "art/mark.svg",
      "config/assets.ts",
      "config/site.ts",
      "src/client/helper.ts",
      "src/client/main.ts",
      "src/client/sw.ts",
      "src/client/worker-only.ts",
      "src/styles/main.css",
      "src/styles/theme.css",
      "src/views/page.tsx",
      "static/robots.txt",
    ]);
  });

  it("answers only the config's own closure for a config that builds nothing", async () => {
    const files = {
      "config/assets.ts": 'import { site } from "./site";\nexport default { extra: site };\n',
      "config/site.ts": "export const site = 1;\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual(["config/assets.ts", "config/site.ts"]);
  });

  it("leaves out an installed package the config module imports", async () => {
    const files = {
      "config/assets.ts": 'import { dep } from "dep";\nexport default { extra: dep };\n',
      "node_modules/dep/package.json": '{ "name": "dep", "main": "index.js" }\n',
      "node_modules/dep/index.js": "export const dep = 1;\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual(["config/assets.ts"]);
  });

  it("answers the service worker's own imports when it is the only script built", async () => {
    const files = {
      "config/assets.ts": configModule({ js: { serviceWorker: { entry: "src/sw.ts" } } }),
      "src/sw.ts":
        'import { PRECACHE_URLS } from "@y-core/forge/assets/precache";\nimport { cache } from "./cache";\nconsole.log(PRECACHE_URLS, cache);\n',
      "src/cache.ts": "export const cache = 1;\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual(["config/assets.ts", "src/cache.ts", "src/sw.ts"]);
  });

  it("answers the inputs of every bundle, not only the first", async () => {
    const files = {
      "config/assets.ts": configModule({
        js: {
          bundles: [
            { entry: "src/a.ts", outdir: "js" },
            { entry: "src/b.ts", outdir: "js/b" },
          ],
        },
      }),
      "src/a.ts": "console.log(1);\n",
      "src/b.ts": 'import { c } from "./c";\nconsole.log(c);\n',
      "src/c.ts": "export const c = 1;\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual([
      "config/assets.ts",
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("answers each file once, sorted, when several sources name it", async () => {
    const files = {
      "config/assets.ts": configModule({
        js: { bundles: [{ entry: "src/shared.ts", outdir: "js" }] },
        css: [{ tool: "tailwindcss", input: "src/main.css", output: "css/main.css" }],
        copy: [
          { from: "src/shared.ts", to: "a.ts" },
          { from: "src/shared.ts", to: "b.ts" },
        ],
      }),
      "src/shared.ts": "console.log(1);\n",
      "src/main.css": '@import "tailwindcss" source(none);\n@source "./shared.ts";\n',
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual([
      "config/assets.ts",
      "src/main.css",
      "src/shared.ts",
    ]);
  });
});

describe("assetInputs() — stylesheets", () => {
  it("answers every listed file when the stylesheet leaves automatic source detection on", async () => {
    const files = {
      "config/assets.ts": configModule({ css: [{ tool: "tailwindcss", input: "src/main.css", output: "css/main.css" }] }),
      "src/main.css": '@import "tailwindcss";\n',
      "docs/README.md": "# docs\n",
      "art/unstated.svg": "<svg/>\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual([
      "art/unstated.svg",
      "config/assets.ts",
      "docs/README.md",
      "src/main.css",
    ]);
  });

  it("leaves out a node_modules path the listing carries, even when automatic detection counts every file", async () => {
    const files = {
      "config/assets.ts": configModule({ css: [{ tool: "tailwindcss", input: "src/main.css", output: "css/main.css" }] }),
      "src/main.css": '@import "tailwindcss";\n',
      "node_modules/dep/index.js": "export const dep = 1;\n",
      "packages/ui/node_modules/dep/index.js": "export const dep = 1;\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", Object.keys(files))).toEqual(["config/assets.ts", "src/main.css"]);
  });

  it("answers a covered file only when the work-tree listing names it", async () => {
    const files = {
      "config/assets.ts": configModule({ css: [{ tool: "tailwindcss", input: "src/main.css", output: "css/main.css" }] }),
      "src/main.css": '@import "tailwindcss" source(none);\n@source "./views";\n',
      "src/views/listed.tsx": "export {};\n",
      "src/views/unlisted.tsx": "export {};\n",
    };
    const listed = listing(files).filter((path) => path !== "src/views/unlisted.tsx");

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listed)).toEqual(["config/assets.ts", "src/main.css", "src/views/listed.tsx"]);
  });

  it("answers the sources of every stylesheet the config builds", async () => {
    const files = {
      "config/assets.ts": configModule({
        css: [
          { tool: "tailwindcss", input: "src/a.css", output: "css/a.css" },
          { tool: "tailwindcss", input: "src/b.css", output: "css/b.css" },
        ],
      }),
      "src/a.css": '@import "tailwindcss" source(none);\n@source "./a";\n',
      "src/b.css": '@import "tailwindcss" source(none);\n@source "./b";\n',
      "src/a/view.tsx": "export {};\n",
      "src/b/view.tsx": "export {};\n",
      "src/c/view.tsx": "export {};\n",
    };

    expect(await assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).toEqual([
      "config/assets.ts",
      "src/a.css",
      "src/a/view.tsx",
      "src/b.css",
      "src/b/view.tsx",
    ]);
  });
});

const STATED: { kind: string; config: object; files: Record<string, string>; expected: string[] }[] = [
  {
    kind: "copy",
    config: { copy: [{ from: "static/robots.txt", to: "robots.txt" }] },
    files: { "static/robots.txt": "User-agent: *\n" },
    expected: ["static/robots.txt"],
  },
  {
    kind: "rasters",
    config: { rasters: [{ from: "art/logo.svg", to: "img/logo.png", width: 64 }] },
    files: { "art/logo.svg": "<svg/>\n" },
    expected: ["art/logo.svg"],
  },
  {
    kind: "sprites",
    config: {
      sprites: { main: { target: "svg/sprite.svg", sources: [{ path: "art/icons", files: ["star.svg", { key: "moon", file: "night.svg" }] }] } },
    },
    files: { "art/icons/star.svg": "<svg/>\n", "art/icons/night.svg": "<svg/>\n", "art/icons/unused.svg": "<svg/>\n" },
    expected: ["art/icons/night.svg", "art/icons/star.svg"],
  },
  {
    kind: "icons",
    config: { icons: { src: "art/icon.svg", outDir: "public", lightColor: "#000000", outputs: [{ kind: "svg", file: "icon.svg" }] } },
    files: { "art/icon.svg": "<svg/>\n" },
    expected: ["art/icon.svg"],
  },
  {
    kind: "fonts.subsets",
    config: { fonts: { subsets: [{ family: "Inter", from: "fonts/inter.ttf", to: "fonts/inter.woff2", covering: "abc" }] } },
    files: { "fonts/inter.ttf": "ttf\n" },
    expected: ["fonts/inter.ttf"],
  },
  {
    kind: "cursors",
    config: {
      cursors: {
        target: "svg/cursors.svg",
        themes: {},
        sources: [
          {
            path: "art/cursors",
            files: ["arrow.svg", { key: "hand", file: "pointer.svg" }],
            template: { path: "art/templates", file: "cursor.svg" },
          },
        ],
      },
    },
    files: { "art/cursors/arrow.svg": "<svg/>\n", "art/cursors/pointer.svg": "<svg/>\n", "art/templates/cursor.svg": "<svg/>\n" },
    expected: ["art/cursors/arrow.svg", "art/cursors/pointer.svg", "art/templates/cursor.svg"],
  },
  {
    kind: "marks",
    config: { marks: [{ from: "art/mark.svg", to: "marks/mark.json" }] },
    files: { "art/mark.svg": "<svg/>\n" },
    expected: ["art/mark.svg"],
  },
];

describe("assetInputs() — the paths the config states", () => {
  for (const { kind, config, files, expected } of STATED) {
    it(`answers the paths ${kind} names`, async () => {
      const app = { ...files, "config/assets.ts": configModule(config) };

      expect(await assetInputs(fixtureRoot(app), "config/assets.ts", listing(app))).toEqual(["config/assets.ts", ...expected].sort());
    });

    for (const missing of expected) {
      it(`rejects, naming it, when ${missing} that ${kind} states is not there`, async () => {
        const { [missing]: _gone, ...rest } = files;
        const root = fixtureRoot({ ...rest, "config/assets.ts": configModule(config) });

        await expect(assetInputs(root, "config/assets.ts", listing(rest))).rejects.toThrow(join(root, missing));
      });
    }
  }

  it("leaves out a remote sprite source, which is no repository file, and still answers the local one beside it", async () => {
    const app = {
      "config/assets.ts": configModule({
        sprites: {
          main: {
            target: "svg/sprite.svg",
            sources: [
              { path: "https://cdn.example.com/icons/", files: [{ key: "x", file: "x.svg", sha256: "0".repeat(64) }] },
              { path: "art/icons", files: ["star.svg"] },
            ],
          },
        },
      }),
      "art/icons/star.svg": "<svg/>\n",
    };

    expect(await assetInputs(fixtureRoot(app), "config/assets.ts", listing(app))).toEqual(["art/icons/star.svg", "config/assets.ts"]);
  });

  it("leaves out a stated path under node_modules, once it is there", async () => {
    const app = {
      "config/assets.ts": configModule({
        sprites: { main: { target: "svg/sprite.svg", sources: [{ path: "node_modules/icon-set", files: ["star.svg"] }] } },
      }),
      "node_modules/icon-set/star.svg": "<svg/>\n",
    };

    expect(await assetInputs(fixtureRoot(app), "config/assets.ts", listing(app))).toEqual(["config/assets.ts"]);
  });
});

describe("assetInputs() — what it cannot resolve", () => {
  it("rejects a bundle import that does not resolve", async () => {
    const files = { ...APP, "src/client/helper.ts": 'export { gone } from "./gone";\n' };

    await expect(assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).rejects.toThrow('Could not resolve "./gone"');
  });

  it("rejects a service-worker import that does not resolve", async () => {
    const files = { ...APP, "src/client/worker-only.ts": 'export { gone } from "./gone-worker";\n' };

    await expect(assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).rejects.toThrow('Could not resolve "./gone-worker"');
  });

  it("rejects a config module whose own import does not resolve", async () => {
    const files = { ...APP, "config/site.ts": 'export { site } from "./gone-site";\n' };

    await expect(assetInputs(fixtureRoot(files), "config/assets.ts", listing(files))).rejects.toThrow("gone-site");
  });

  it("rejects a stylesheet the config names that is not there", async () => {
    const { "src/styles/main.css": _main, ...files } = APP;
    const root = fixtureRoot(files);

    await expect(assetInputs(root, "config/assets.ts", listing(files))).rejects.toThrow(join(root, "src/styles/main.css"));
  });

  it("rejects a stylesheet that imports one that is not there", async () => {
    const files = { ...APP, "src/styles/main.css": '@import "tailwindcss" source(none);\n@import "./gone.css";\n' };
    const root = fixtureRoot(files);

    await expect(assetInputs(root, "config/assets.ts", listing(files))).rejects.toThrow(join(root, "src/styles/gone.css"));
  });

  it("rejects a stated path that is not there", async () => {
    const { "art/mark.svg": _mark, ...files } = APP;
    const root = fixtureRoot(files);

    await expect(assetInputs(root, "config/assets.ts", listing(files))).rejects.toThrow(join(root, "art/mark.svg"));
  });
});

const SHAPED: Record<string, string> = {
  "package.json": JSON.stringify({ name: "app", imports: { "#impl": { custom: "./src/impl-custom.ts", default: "./src/impl-default.ts" } } }),
  "src/main.ts": 'import { impl } from "#impl";\nif (FLAG) { import("./flagged"); }\nconsole.log("MAIN_MARKER", impl);\n',
  "src/impl-custom.ts": 'export const impl = "IMPL_CUSTOM_MARKER";\n',
  "src/impl-default.ts": 'export const impl = "IMPL_DEFAULT_MARKER";\n',
  "src/flagged.ts": 'console.log("FLAGGED_MARKER");\n',
};

const MARKERS: Record<string, string> = {
  "src/main.ts": "MAIN_MARKER",
  "src/impl-custom.ts": "IMPL_CUSTOM_MARKER",
  "src/impl-default.ts": "IMPL_DEFAULT_MARKER",
  "src/flagged.ts": "FLAGGED_MARKER",
};

const bundledBy = (output: string): string[] =>
  Object.entries(MARKERS)
    .filter(([, marker]) => output.includes(marker))
    .map(([path]) => path)
    .sort();

const SHAPES: { name: string; build: { conditions?: string[]; define: Record<string, boolean> }; expected: string[] }[] = [
  {
    name: "no condition and a define that keeps a branch",
    build: { define: { FLAG: true } },
    expected: ["src/flagged.ts", "src/impl-default.ts", "src/main.ts"],
  },
  {
    name: "a condition and a define that drops a branch",
    build: { conditions: ["custom"], define: { FLAG: false } },
    expected: ["src/impl-custom.ts", "src/main.ts"],
  },
];

describe("assetInputs() reads what the build bundles", () => {
  for (const { name, build, expected } of SHAPES) {
    it(`names the files buildJS bundles for a bundle with ${name}`, async () => {
      const root = fixtureRoot({
        ...SHAPED,
        "config/assets.ts": configModule({ js: { bundles: [{ entry: "src/main.ts", outdir: "js", ...build }] } }),
      });
      const config = await loadConfig({ root, configPath: "config/assets.ts" });
      const { mapping } = await buildJS(config.js.bundles, { outDir: join(root, "public") });
      const built = readFileSync(join(root, "public", mapping["js/main.js"]!), "utf-8");
      const inputs = await assetInputs(root, "config/assets.ts", []);

      expect({ built: bundledBy(built), inputs: inputs.filter((path) => path in MARKERS) }).toEqual({ built: expected, inputs: expected });
    });

    it(`names the files buildServiceWorker bundles for a worker with ${name}`, async () => {
      const root = fixtureRoot({ ...SHAPED, "config/assets.ts": configModule({ js: { serviceWorker: { entry: "src/main.ts", ...build } } }) });
      const config = await loadConfig({ root, configPath: "config/assets.ts" });
      const written = await buildServiceWorker(config.js.serviceWorker!, { outDir: join(root, "public"), precache: [], version: "" });
      const inputs = await assetInputs(root, "config/assets.ts", []);

      expect({ built: bundledBy(readFileSync(written, "utf-8")), inputs: inputs.filter((path) => path in MARKERS) }).toEqual({
        built: expected,
        inputs: expected,
      });
    });
  }
});
