import { dirname, join } from "node:path";

import { CliError } from "../../cli/errors";
import { insertStatement } from "../backup/artifact";
import { declaredSeeds } from "../declared";
import { sha256 } from "../digest";
import { readSchemaInputs } from "../schema/compose";
import { loadDesired } from "../schema/scratch";
import { rowCountSelect, tableInfoSelect, toColumnInfo } from "../sql";
import type { DbRunContext, Home, SeedFixtureOptions, SeedFixtureOutcome } from "../types";
import { executeFile, queryBatches, queryOne } from "../wrangler";
import { seedVariablesIn } from "./files";

/** Refuses a path a `seed apply` would never read, which is the difference between a generated seed and a file somewhere. */
function refuseUndeclaredPath(run: DbRunContext, path: string): void {
  if (!path.endsWith(".sql")) throw new CliError("invalid-args", `${path} is not a .sql file, and a seeds directory holds nothing else`);
  const sources = declaredSeeds(run);
  if (sources.some((source) => path.startsWith(`${source.path}/`))) return;
  const named = sources.map((source) => source.declared).join(", ");
  throw new CliError(
    "invalid-args",
    `${path} is outside every seeds directory \`config/db.ts\` names${named === "" ? "" : ` (${named})`} — a seed forge does not read is a file nothing applies`,
  );
}

/** Each table's declared columns in `cid` order, read in one spawn; a table the schema does not declare is refused by name. */
function declaredColumns(run: DbRunContext, home: Home, tables: readonly string[]): Map<string, string[]> {
  const batches = queryBatches(run.io, home, tables.map(tableInfoSelect));
  const columns = new Map<string, string[]>();
  tables.forEach((table, index) => {
    const names = toColumnInfo(batches[index] ?? []).map((column) => column.name);
    if (names.length === 0)
      throw new CliError("invalid-args", `the declared schema has no table \`${table}\` — the fixture names one it does not create`);
    columns.set(table, names);
  });
  return columns;
}

/** Composes a seed file from rows in memory, proving every one loads into the declared schema before the file is written. @public */
export function composeSeedFixture(run: DbRunContext, options: SeedFixtureOptions): SeedFixtureOutcome {
  refuseUndeclaredPath(run, options.path);

  // The fixture's own scratch side: a regeneration must not empty the database a cached compose model
  // was built against, and `loadDesired` forces `local`, so nothing here can reach the resolved target.
  const home = loadDesired(run, readSchemaInputs(run).states, "fixture");
  const foreignKeys = Number(queryOne(run.io, home, "SELECT foreign_keys FROM pragma_foreign_keys").foreign_keys ?? 0);
  if (foreignKeys !== 1) {
    throw new CliError(
      "invalid-args",
      "the scratch database has foreign keys off, so a row pointing at nothing would load — the fixture proves nothing without them",
    );
  }

  const columns = declaredColumns(run, home, options.tables);
  const statements: string[] = [];
  const tables = options.tables.map((table) => {
    const declared = columns.get(table) ?? [];
    const rows = options.rows[table] ?? [];
    const missing = declared.filter((column) => rows.some((row) => !Object.hasOwn(row, column)));
    if (missing.length > 0) {
      throw new CliError(
        "invalid-args",
        `${table} declares ${missing.join(", ")}, which the rows given here do not carry — add the column to them`,
      );
    }
    const dropped = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) => !declared.includes(column));
    for (const row of rows) statements.push(insertStatement(table, declared, row, { orIgnore: true }));
    return { name: table, rows: rows.length, dropped };
  });

  const places = options.places === undefined ? "" : `-- forge:places ${options.places.join(",")}\n`;
  const sql = `${places}${statements.join("\n")}\n`;

  const variables = seedVariablesIn(sql);
  if (variables.length > 0) {
    throw new CliError(
      "invalid-args",
      `the rows hold ${variables.join(", ")}, which \`seed apply\` substitutes from the environment — reword the value, or the file will not say what it says here`,
    );
  }

  const staged = join(home.dir, "fixture.sql");
  run.io.writeText(staged, sql);
  try {
    executeFile(run.io, home, staged);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError("invalid-args", `the fixture does not load into the declared schema — a row is refused by a constraint:\n${detail}`);
  }

  // `OR IGNORE` is what the lint rule asks of a seed, and what it costs is a silent skip on a
  // duplicate key. Counting is what buys that back: it catches the row the load never wrote.
  const counted = queryBatches(run.io, home, options.tables.map(rowCountSelect));
  options.tables.forEach((table, index) => {
    const loaded = Number(counted[index]?.[0]?.rows ?? 0);
    const authored = (options.rows[table] ?? []).length;
    if (loaded !== authored) {
      throw new CliError(
        "invalid-args",
        `${table}: ${authored} row(s) are given here and ${loaded} loaded — two of them share a key, and OR IGNORE dropped one`,
      );
    }
  });

  run.io.mkdir(dirname(options.path));
  run.io.writeText(options.path, sql);
  return { path: options.path, sha256: sha256(sql), sql, tables };
}
