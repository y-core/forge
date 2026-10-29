import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { worktreeFixture } from "../src/tooling/cli/worktree.fixture";
import { urlReferences, workerdSpecReach } from "./spec-reach";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = worktreeFixture(files);
  roots.push(root);
  return root;
}

describe("urlReferences()", () => {
  it("resolves each path against the file naming it, and passes over a directory", () => {
    const root = repository({ "tests/fixtures/app/wrangler.jsonc": "{}\n", "tests/workerd/a.workerd.ts": "" });

    expect(urlReferences(root, ["../fixtures/app/wrangler.jsonc", "../.."], "tests/workerd/a.workerd.ts")).toEqual([
      "tests/fixtures/app/wrangler.jsonc",
    ]);
  });

  it("refuses a path that names nothing on disk", () => {
    const root = repository({ "tests/workerd/a.workerd.ts": "" });

    expect(() => urlReferences(root, ["../fixtures/gone/wrangler.jsonc"], "tests/workerd/a.workerd.ts")).toThrow("names nothing on disk");
  });
});

const TREE = {
  "src/ui/client/menu.ts": 'import { signal } from "./signal";\nexport const menu = signal;\n',
  "src/ui/client/signal.ts": "export const signal = 1;\n",
  "src/ui/client/sheet.ts": "export const sheet = 1;\n",
  "src/ui/core/button.tsx": "export const button = 1;\n",
  "src/app/app.ts": 'import { signal } from "../ui/client/signal";\nexport const app = signal;\n',
  "tests/fixtures/app/wrangler.jsonc": '{ "name": "app", "main": "worker.ts" }\n',
  "tests/fixtures/app/worker.ts": 'import { app } from "../../../src/app/app";\nexport default { app };\n',
  "tests/fixtures/db/wrangler.jsonc": '{ "name": "db-only" }\n',
  "tests/fixtures/schema.sql": "CREATE TABLE t (id INTEGER);\n",
};

describe("workerdSpecReach()", () => {
  it("answers each served Worker's closure, a Worker config without a `main` itself alone, and every other file named", async () => {
    const root = repository({
      ...TREE,
      "tests/workerd/a.workerd.ts": [
        'const APP = new URL("../fixtures/app/wrangler.jsonc", import.meta.url);',
        'const DB = new URL("../fixtures/db/wrangler.jsonc", import.meta.url);',
        'const DDL = new URL("../fixtures/schema.sql", import.meta.url);',
      ].join("\n"),
    });

    expect(await workerdSpecReach(root)).toEqual([
      "src/app/app.ts",
      "src/ui/client/signal.ts",
      "tests/fixtures/app/worker.ts",
      "tests/fixtures/app/wrangler.jsonc",
      "tests/fixtures/db/wrangler.jsonc",
      "tests/fixtures/schema.sql",
    ]);
  });

  it("reads a served Worker's config as JSONC, so comments and a trailing comma neither fail the trace nor stand in for a `main`", async () => {
    const root = repository({
      ...TREE,
      "tests/fixtures/app/wrangler.jsonc": '{\n  // the app under test\n  "name": "app",\n  /* served */ "main": "worker.ts",\n}\n',
      "tests/fixtures/db/wrangler.jsonc": '{\n  "name": "db-only",\n  // "main": "worker.ts",\n}\n',
      "tests/workerd/a.workerd.ts": [
        'const APP = new URL("../fixtures/app/wrangler.jsonc", import.meta.url);',
        'const DB = new URL("../fixtures/db/wrangler.jsonc", import.meta.url);',
      ].join("\n"),
    });

    expect(await workerdSpecReach(root)).toEqual([
      "src/app/app.ts",
      "src/ui/client/signal.ts",
      "tests/fixtures/app/worker.ts",
      "tests/fixtures/app/wrangler.jsonc",
      "tests/fixtures/db/wrangler.jsonc",
    ]);
  });

  it("rejects a Worker config it cannot parse as JSON, a TOML one included", async () => {
    const root = repository({
      "tests/fixtures/app/wrangler.toml": 'name = "app"\nmain = "worker.ts"\n',
      "tests/fixtures/app/worker.ts": "export default {};\n",
      "tests/workerd/a.workerd.ts": 'const APP = new URL("../fixtures/app/wrangler.toml", import.meta.url);\n',
    });

    await expect(workerdSpecReach(root)).rejects.toThrow("malformed wrangler config");
  });

  it("rejects when a spec names a file by URL that is not on disk", async () => {
    const root = repository({ "tests/workerd/a.workerd.ts": 'const GONE = new URL("../fixtures/gone.sql", import.meta.url);\n' });

    await expect(workerdSpecReach(root)).rejects.toThrow(
      'tests/workerd/a.workerd.ts: `new URL("../fixtures/gone.sql")`, which names nothing on disk,',
    );
  });

  it("rejects when a served Worker's `main` does not resolve", async () => {
    const root = repository({
      "tests/fixtures/app/wrangler.jsonc": '{ "name": "app", "main": "gone.ts" }\n',
      "tests/workerd/a.workerd.ts": 'const APP = new URL("../fixtures/app/wrangler.jsonc", import.meta.url);\n',
    });

    await expect(workerdSpecReach(root)).rejects.toThrow();
  });
});
