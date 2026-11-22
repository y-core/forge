import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { curateTree, listWorkingTree } from "../../src/tooling/curate/commands";
import type { CurateRunner, FeatureManifest } from "../../src/tooling/curate/types";
import { forgeDb } from "./cli";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");
const FIXTURE = join(FORGE, "tests", "fixtures", "db-compose");

const DB_CONFIG = `export default {
  schemas: [
    "src/base/schema.sql",
    "src/notes/schema.sql", // feature:notes
  ],
};
`;

const MANIFEST: FeatureManifest = {
  features: {
    db: {
      directories: ["src/base/"],
      seams: [],
      regenerate: { remove: ["config/db/migrations/", "config/db/schema.snapshot.json"], run: ["forge", "db", "migrate", "compose"] },
    },
    notes: { directories: ["src/notes/"], seams: ["config/db.config.ts"] },
  },
};

/** Runs a regeneration's `forge …` as forge's own CLI from this checkout. */
const runner: CurateRunner = ([command, ...rest], cwd, env) => {
  const argv = command === "forge" ? ["run", BIN, ...rest] : [command, ...rest];
  const result = spawnSync("bun", argv, { cwd, env, encoding: "utf-8" });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
};

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

let home = "";
let root = "";

test.beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "forge-curate-db-"));
  root = join(home, "app");
  mkdirSync(root);
  cpSync(join(FIXTURE, "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  write(root, ".gitignore", ".forge/\n.wrangler/\nnode_modules\n");
  write(root, "config/db.config.ts", DB_CONFIG);
  write(root, "src/base/schema.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;\n");
  write(root, "src/notes/schema.sql", "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT) STRICT;\n");
  symlinkSync(join(FORGE, "node_modules"), join(root, "node_modules"), "dir");
  const init = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf-8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
});

test.afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

test("a copy dropping the feature that owns a table regenerates row types without it", async () => {
  const composed = await forgeDb(root, ["migrate", "compose"]);
  expect(composed.code, composed.stderr).toBe(0);
  expect(readFileSync(join(root, "config", "db", "tables.ts"), "utf-8")).toContain("export interface NotesRow {");

  const target = join(home, "copy");
  curateTree({ root, target, config: MANIFEST, selection: { drop: ["notes"] } }, listWorkingTree, runner);

  const tables = readFileSync(join(target, "config", "db", "tables.ts"), "utf-8");
  expect(tables).not.toContain("NotesRow");
  expect(tables).toContain("export interface UsersRow {");
  const checked = await forgeDb(target, ["types", "--check"]);
  expect(checked.code, `${checked.stdout}${checked.stderr}`).toBe(0);
});
