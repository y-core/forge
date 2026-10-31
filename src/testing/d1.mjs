// Generated from src/testing/d1.ts by `bun run gen:bundles` — do not edit.

// src/testing/d1.ts
import { existsSync as existsSync2, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve as resolve3 } from "node:path";
import process from "node:process";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

// src/storage/db/migrations.ts
var DB_LAYOUT = { migrations: "config/db/migrations", snapshot: "config/db/schema.snapshot.json" };
var MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;
function isMigrationFileName(name) {
  return MIGRATION_FILE.test(name);
}
function inMigrationOrder(files) {
  const numbered = files.map((file) => {
    const match = MIGRATION_FILE.exec(file.name);
    if (match === null) throw new Error(`${file.name} is not a migration file name \u2014 wrangler applies <NNNN>_<name>.sql and nothing else`);
    return { file, version: Number(match[1]), digits: match[1] ?? "" };
  });
  numbered.sort((a, b) => a.version - b.version || (a.file.name < b.file.name ? -1 : a.file.name > b.file.name ? 1 : 0));
  const seen = /* @__PURE__ */ new Map();
  return numbered.map(({ file, version, digits }) => {
    const other = seen.get(version);
    if (other !== void 0) throw new Error(`${file.name} and ${other} share the number ${digits} \u2014 renumber one so they apply in one order`);
    seen.set(version, file.name);
    return { ...file, version };
  });
}

// src/storage/db/schema.ts
var INVENTORY_SELECT = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name";

// src/tooling/db/declared.ts
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve as resolve2 } from "node:path";

// src/validation/validation.ts
import * as v from "valibot";

// src/tooling/cli/config-module.ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
async function loadConfigModule(request) {
  const { root, path, explicit, what, option = "--config" } = request;
  const resolved = resolve(root, path);
  if (!existsSync(resolved)) {
    if (explicit) throw new Error(`No ${what} at \`${path}\` \u2014 ${option} names a module that does not exist.`);
    return void 0;
  }
  const module = await import(pathToFileURL(resolved).href);
  if (module.default === void 0) {
    throw new Error(`\`${path}\` has no default export \u2014 a ${what} module must \`export default\` the value it holds.`);
  }
  return { value: module.default };
}

// src/tooling/cli/errors.ts
var CliError = class extends Error {
  kind;
  constructor(kind, message, options) {
    super(message, options);
    this.name = "CliError";
    this.kind = kind;
  }
};

// src/tooling/db/types.ts
var DbHostConfigSchema = v.strictObject({
  schemas: v.optional(v.array(v.string())),
  seeds: v.optional(v.array(v.string())),
  migrations: v.optional(v.string()),
  snapshot: v.optional(v.string()),
  backupsDir: v.optional(v.string())
});
var D1EntrySchema = v.looseObject({
  binding: v.string(),
  database_name: v.optional(v.string()),
  database_id: v.optional(v.string()),
  preview_database_id: v.optional(v.string())
});

// src/tooling/db/declared.ts
var DEFAULT_DB_CONFIG = "config/db.config.ts";
async function loadHostConfig(root, path, explicit, option) {
  const request = { root, path, explicit, what: "db host config", ...option === void 0 ? {} : { option } };
  const loaded = (await loadConfigModule(request))?.value ?? {};
  const result = v.safeParse(DbHostConfigSchema, loaded);
  if (result.success) return loaded;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${path}: ${detail}`);
}
function declaredPath(root, declared) {
  if (!declared.startsWith("@")) return { path: isAbsolute(declared) ? declared : resolve2(root, declared), declared };
  try {
    return { path: createRequire(join(root, "package.json")).resolve(declared), declared };
  } catch {
    throw new CliError(
      "invalid-args",
      `${declared} names a module which no package installed under ${root} exports \u2014 install the package, or name the file by its path`
    );
  }
}

// src/storage/db/sql.ts
var SQL_PLACEHOLDER = "?";
var SQL_FRAGMENT_BRAND = /* @__PURE__ */ Symbol("forge.storage.db.SqlFragment");
function sql(strings, ...values) {
  let text = strings[0] ?? "";
  const params = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const next = strings[i + 1] ?? "";
    if (isSqlFragment(value)) {
      text += value.text + next;
      params.push(...value.params);
    } else {
      text += SQL_PLACEHOLDER + next;
      params.push(value);
    }
  }
  return { [SQL_FRAGMENT_BRAND]: true, text, params };
}
function isSqlFragment(x) {
  return typeof x === "object" && x !== null && x[SQL_FRAGMENT_BRAND] === true;
}

// src/testing/d1.ts
async function openPlatformD1(configPath, persistPath) {
  const proxy = await getPlatformProxy({ configPath, persist: { path: persistPath }, remoteBindings: false, envFiles: [] });
  let open = true;
  const dispose = async () => {
    if (!open) return;
    open = false;
    live.delete(dispose);
    await proxy.dispose();
  };
  live.add(dispose);
  sweepOnSignal();
  return { binding: proxy.env.DB, dispose };
}
var live = /* @__PURE__ */ new Set();
var bound = false;
function sweepOnSignal() {
  if (bound) return;
  bound = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      void Promise.allSettled([...live].map((dispose) => dispose())).then(() => process.exit(130));
    });
  }
}
function testD1Config() {
  return `${JSON.stringify(
    {
      name: "forge-test-d1",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "forge-test-d1", database_id: "forge-test-d1" }]
    },
    null,
    2
  )}
`;
}
function dropStatements(objects, parents) {
  const quote = (name) => `"${name.replaceAll('"', '""')}"`;
  const of = (type) => objects.filter((object) => object.type === type).map((object) => object.name);
  const drops = [
    ...of("trigger").map((name) => `DROP TRIGGER IF EXISTS ${quote(name)}`),
    ...of("view").map((name) => `DROP VIEW IF EXISTS ${quote(name)}`),
    ...of("index").map((name) => `DROP INDEX IF EXISTS ${quote(name)}`)
  ];
  const remaining = new Set(of("table"));
  while (remaining.size > 0) {
    const referenced = new Set([...remaining].flatMap((table) => (parents.get(table) ?? []).filter((parent) => parent !== table)));
    const leaves = [...remaining].filter((table) => !referenced.has(table)).sort();
    const next = leaves.length > 0 ? leaves : [...remaining].sort();
    for (const table of next) {
      drops.push(`DROP TABLE IF EXISTS ${quote(table)}`);
      remaining.delete(table);
    }
  }
  return drops;
}
async function openTestD1(options = {}) {
  const root = resolve3(options.root ?? process.cwd());
  const { hostConfig } = options;
  const host = options.migrations === void 0 ? await loadHostConfig(root, hostConfig ?? DEFAULT_DB_CONFIG, hostConfig !== void 0, "`hostConfig`") : {};
  const directory = declaredPath(root, options.migrations ?? host.migrations ?? DB_LAYOUT.migrations).path;
  if (!existsSync2(directory)) throw new Error(`openTestD1: no migrations directory at ${directory}`);
  const migrations = inMigrationOrder(
    readdirSync(directory).filter(isMigrationFileName).map((name) => ({ name, sql: readFileSync(join2(directory, name), "utf-8") }))
  );
  const home = mkdtempSync(join2(tmpdir(), "forge-test-d1-"));
  writeFileSync(join2(home, "wrangler.jsonc"), testD1Config());
  const platform = await openPlatformD1(join2(home, "wrangler.jsonc"), join2(home, "state")).catch((error) => {
    rmSync(home, { recursive: true, force: true });
    throw error;
  });
  const db = platform.binding;
  const rows = async (sql2) => (await db.prepare(sql2).all()).results;
  const migrate = async () => {
    for (const migration of migrations) {
      const statements = unstable_splitSqlQuery(migration.sql).filter((statement) => statement.trim() !== "");
      if (statements.length === 0) continue;
      await db.batch(statements.map((statement) => db.prepare(statement))).catch((error) => {
        throw new Error(`openTestD1: ${migration.name} failed to apply: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error
        });
      });
    }
  };
  const dispose = async () => {
    await platform.dispose();
    rmSync(home, { recursive: true, force: true });
  };
  try {
    await migrate();
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    binding: db,
    rows,
    async reset() {
      const objects = await rows(INVENTORY_SELECT);
      const parents = /* @__PURE__ */ new Map();
      for (const { type, name } of objects) {
        if (type !== "table") continue;
        const keys = await rows(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`);
        parents.set(
          name,
          keys.map((key) => key.table)
        );
      }
      const drops = dropStatements(objects, parents);
      if (drops.length > 0) await db.batch(["PRAGMA defer_foreign_keys = true", ...drops].map((statement) => db.prepare(statement)));
      await migrate();
    },
    dispose
  };
}
async function explainPlan(d1, fragment) {
  const res = await d1.binding.prepare(`EXPLAIN QUERY PLAN ${fragment.text}`).bind(...fragment.params).all();
  return res.results.map(({ id, parent, detail }) => ({ id, parent, detail }));
}
var quoted = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function usesIndex(plan, index) {
  const pattern = new RegExp(`\\bUSING (?:COVERING )?INDEX ${quoted(index)}(?:\\s|$)`);
  return plan.some((step) => pattern.test(step.detail));
}
function scansTable(plan, name) {
  const pattern = new RegExp(`^SCAN ${quoted(name)}$`);
  return plan.some((step) => pattern.test(step.detail));
}
export {
  dropStatements,
  explainPlan,
  openPlatformD1,
  openTestD1,
  scansTable,
  sql,
  testD1Config,
  usesIndex
};
