// Generated from src/testing/d1/mod.ts by `bun run gen:bundles` — do not edit.

// src/testing/d1/mod.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
import process2 from "node:process";
import { getPlatformProxy } from "wrangler";

// src/testing/d1/migrations.ts
import { existsSync as existsSync2, readdirSync, readFileSync } from "node:fs";
import { join as join2, resolve as resolve3 } from "node:path";
import process from "node:process";

// src/storage/db/migrations.ts
var DB_LAYOUT = { migrations: "config/db/migrations", snapshot: "config/db/schema.snapshot.json", types: "config/db/tables.ts" };
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

// src/tooling/db/backup/split.ts
var WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
function pastQuoted(sql, index, quote) {
  let at = index;
  do {
    const close = sql.indexOf(quote, at + 1);
    if (close === -1) return sql.length;
    at = close + 1;
  } while (sql[at] === quote);
  return at;
}
function pastMarker(sql, from, marker) {
  const at = sql.indexOf(marker, from);
  return at === -1 ? sql.length : at + marker.length;
}
function opensTrigger(lead) {
  const [create, second, third] = lead;
  return create === "CREATE" && (second === "TRIGGER" || (second === "TEMP" || second === "TEMPORARY") && third === "TRIGGER");
}
function sqlStatementSpans(sql) {
  const spans = [];
  let start = 0;
  let index = 0;
  let depth = 0;
  let useful = false;
  let lead = [];
  const token = (word) => {
    useful = true;
    if (lead.length < 3) lead.push(word);
  };
  const finish = (end, terminated) => {
    spans.push({ start, end, terminated, useful });
    start = end + 1;
    depth = 0;
    useful = false;
    lead = [];
  };
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1];
    if (char === "'" || char === '"' || char === "`") {
      token("");
      index = pastQuoted(sql, index, char);
    } else if (char === "[") {
      token("");
      index = pastMarker(sql, index + 1, "]");
    } else if (char === "-" && next === "-") index = pastMarker(sql, index, "\n");
    else if (char === "/" && next === "*") index = pastMarker(sql, index + 2, "*/");
    else if (/[A-Za-z_]/.test(char)) {
      WORD.lastIndex = index;
      const word = (WORD.exec(sql)?.[0] ?? char).toUpperCase();
      token(word);
      if (word === "BEGIN" || word === "CASE") depth += 1;
      else if (word === "END") depth = Math.max(0, depth - 1);
      index += word.length;
    } else if (char === ";" && !(depth > 0 && opensTrigger(lead))) {
      finish(index, true);
      index += 1;
    } else {
      if (char !== ";" && !/\s/.test(char)) token("");
      index += 1;
    }
  }
  finish(sql.length, false);
  return spans;
}
function cutSqlStatements(sql) {
  return sqlStatementSpans(sql).filter((span) => span.useful).map((span) => sql.slice(span.start, span.end).trim());
}

// src/tooling/db/declared.ts
import { createRequire as createRequire2 } from "node:module";
import { dirname, isAbsolute, join, relative, resolve as resolve2 } from "node:path";

// src/validation/validation.ts
import * as v from "valibot";

// src/tooling/cli/config-module.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
async function loadConfigModule(request) {
  const { root, path, explicit, what, option = "--config" } = request;
  const resolved = resolve(root, path);
  if (!existsSync(resolved)) {
    if (explicit) throw new Error(`No ${what} at \`${path}\` \u2014 ${option} names a module that does not exist.`);
    return void 0;
  }
  delete createRequire(import.meta.url).cache[resolved];
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
  types: v.optional(v.string())
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
    return { path: createRequire2(join(root, "package.json")).resolve(declared), declared };
  } catch {
    throw new CliError(
      "invalid-args",
      `${declared} names a module which no package installed under ${root} exports \u2014 install the package, or name the file by its path`
    );
  }
}

// src/tooling/db/sql.ts
function quoteSqlIdentifier(name) {
  if (name === "") throw new Error("an empty string is not a SQL identifier");
  if (name.includes("\0")) throw new Error("a NUL byte cannot appear in a SQL identifier");
  return `"${name.replaceAll('"', '""')}"`;
}

// src/testing/d1/migrations.ts
async function readTestMigrations(options, caller) {
  const root = resolve3(options.root ?? process.cwd());
  const { hostConfig } = options;
  const host = options.migrations === void 0 ? await loadHostConfig(root, hostConfig ?? DEFAULT_DB_CONFIG, hostConfig !== void 0, "`hostConfig`") : {};
  const directory = declaredPath(root, options.migrations ?? host.migrations ?? DB_LAYOUT.migrations).path;
  if (!existsSync2(directory)) throw new Error(`${caller}: no migrations directory at ${directory}`);
  return inMigrationOrder(
    readdirSync(directory).filter(isMigrationFileName).map((name) => ({ name, sql: readFileSync(join2(directory, name), "utf-8") }))
  );
}
async function applyTestMigrations(db, migrations, caller) {
  for (const migration of migrations) {
    const statements = cutSqlStatements(migration.sql);
    if (statements.length === 0) continue;
    await db.batch(statements.map((statement) => db.prepare(statement))).catch((error) => {
      throw new Error(`${caller}: ${migration.name} failed to apply: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
  }
}
function dropStatements(objects, parents) {
  const of = (type) => objects.filter((object) => object.type === type).map((object) => object.name);
  const drops = [
    ...of("trigger").map((name) => `DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(name)}`),
    ...of("view").map((name) => `DROP VIEW IF EXISTS ${quoteSqlIdentifier(name)}`),
    ...of("index").map((name) => `DROP INDEX IF EXISTS ${quoteSqlIdentifier(name)}`)
  ];
  const remaining = new Set(of("table"));
  while (remaining.size > 0) {
    const referenced = new Set([...remaining].flatMap((table) => (parents.get(table) ?? []).filter((parent) => parent !== table)));
    const leaves = [...remaining].filter((table) => !referenced.has(table)).sort();
    const next = leaves.length > 0 ? leaves : [...remaining].sort();
    for (const table of next) {
      drops.push(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table)}`);
      remaining.delete(table);
    }
  }
  return drops;
}
async function dropAppObjects(db) {
  const rows = async (query) => (await db.prepare(query).all()).results;
  const objects = await rows(INVENTORY_SELECT);
  const parents = /* @__PURE__ */ new Map();
  for (const { type, name } of objects) {
    if (type !== "table") continue;
    const keys = await rows(`PRAGMA foreign_key_list(${quoteSqlIdentifier(name)})`);
    parents.set(
      name,
      keys.map((key) => key.table)
    );
  }
  const drops = dropStatements(objects, parents);
  if (drops.length > 0) await db.batch(["PRAGMA defer_foreign_keys = true", ...drops].map((statement) => db.prepare(statement)));
}

// src/testing/d1/mod.ts
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
    process2.once(signal, () => {
      void Promise.allSettled([...live].map((dispose) => dispose())).then(() => process2.exit(130));
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
async function openTestD1(options = {}) {
  const migrations = await readTestMigrations(options, "openTestD1");
  const home = mkdtempSync(join3(tmpdir(), "forge-test-d1-"));
  writeFileSync(join3(home, "wrangler.jsonc"), testD1Config());
  const platform = await openPlatformD1(join3(home, "wrangler.jsonc"), join3(home, "state")).catch((error) => {
    rmSync(home, { recursive: true, force: true });
    throw error;
  });
  const db = platform.binding;
  const dispose = async () => {
    await platform.dispose();
    rmSync(home, { recursive: true, force: true });
  };
  try {
    await applyTestMigrations(db, migrations, "openTestD1");
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    binding: db,
    rows: async (query) => (await db.prepare(query).all()).results,
    async reset() {
      await dropAppObjects(db);
      await applyTestMigrations(db, migrations, "openTestD1");
    },
    dispose
  };
}
async function explainPlan(d1, query, params = []) {
  const res = await d1.binding.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...params).all();
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
  explainPlan,
  openPlatformD1,
  openTestD1,
  scansTable,
  testD1Config,
  usesIndex
};
