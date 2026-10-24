import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { gateFixtureRoot } from "./checks/gate.fixture";
import { workerMainClosure } from "./closure";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "forge-closure-");
  roots.push(root);
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

describe("workerMainClosure()", () => {
  it("traces the `main` a Worker config names, resolved from the config's own directory", async () => {
    const root = fixtureRoot(Object.fromEntries(Object.entries(APP).map(([path, body]) => [`app/${path}`, body])));

    expect(await workerMainClosure(root, "app/wrangler.jsonc")).toEqual([
      "app/db/schema.sql",
      "app/src/routes/index.ts",
      "app/src/shared/index.ts",
      "app/src/worker.ts",
    ]);
  });

  it("rejects a config that names no `main`, and one that is not there", async () => {
    const root = fixtureRoot({ "wrangler.jsonc": '{ "name": "db-only" }\n' });

    await expect(workerMainClosure(root, "wrangler.jsonc")).rejects.toThrow("wrangler.jsonc names no `main` to trace");
    await expect(workerMainClosure(root, "missing.jsonc")).rejects.toThrow();
  });
});
