import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { importClosure } from "./closure";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-closure-"));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const APP = {
  "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts" } // a comment\n',
  "src/worker.ts":
    'import { route } from "./routes/index.js";\nimport ddl from "../db/schema.sql";\nimport { read } from "node:fs";\nexport default { route, ddl, read };\n',
  "src/routes/index.ts": 'import { shared } from "../shared";\nexport const route = shared;\n',
  "src/shared/index.ts": "export const shared = 1;\n",
  "src/unreached.ts": "export const unreached = 1;\n",
  "db/schema.sql": "CREATE TABLE t (id INTEGER);\n",
  "node_modules/dep/package.json": '{ "name": "dep", "main": "index.js" }\n',
  "node_modules/dep/index.js": "export const dep = 1;\n",
  "lib/uses-dep.ts": 'import { dep } from "dep";\nexport const usesDep = dep;\n',
};

describe("importClosure()", () => {
  it("follows static imports transitively, resolving `.js` and directory spellings as esbuild does, and leaves out what nothing imports", async () => {
    expect(await importClosure(fixtureRoot(APP), ["./src/worker.ts"])).toEqual([
      "db/schema.sql",
      "src/routes/index.ts",
      "src/shared/index.ts",
      "src/worker.ts",
    ]);
  });

  it("resolves specifiers from `from`, and answers paths relative to the root", async () => {
    expect(await importClosure(fixtureRoot(APP), ["./routes", "./shared/index.ts"], "src")).toEqual(["src/routes/index.ts", "src/shared/index.ts"]);
  });

  it("answers no installed dependency, only the repository's own files", async () => {
    expect(await importClosure(fixtureRoot(APP), ["./lib/uses-dep.ts"])).toEqual(["lib/uses-dep.ts"]);
  });

  it("rejects a specifier that does not resolve, so a caller runs whole rather than trusting a partial closure", async () => {
    await expect(importClosure(fixtureRoot(APP), ["./src/worker.ts", "./src/missing"])).rejects.toThrow();
  });

  it("rejects an import that does not resolve however deep in the closure it sits", async () => {
    const root = fixtureRoot({ "w.ts": 'import { a } from "./a";\nexport { a };\n', "a.ts": 'import { b } from "./gone";\nexport const a = b;\n' });

    await expect(importClosure(root, ["./w.ts"])).rejects.toThrow('Could not resolve "./gone"');
  });

  it("passes over the runtime's own `cloudflare:` and `bun:` modules rather than failing on them, and follows the wasm and html modules wrangler bundles", async () => {
    const root = fixtureRoot({
      "w.ts": [
        'import { env } from "cloudflare:workers";',
        'import { connect } from "cloudflare:sockets";',
        'import { test } from "bun:test";',
        'import wasm from "./engine.wasm";',
        'import page from "./page.html";',
        "export { env, connect, test, wasm, page };",
      ].join("\n"),
      "engine.wasm": "",
      "page.html": "<p>page</p>\n",
    });

    expect(await importClosure(root, ["./w.ts"])).toEqual(["engine.wasm", "page.html", "w.ts"]);
  });

  it("answers nothing for no specifier", async () => {
    expect(await importClosure(fixtureRoot({}), [])).toEqual([]);
  });
});
