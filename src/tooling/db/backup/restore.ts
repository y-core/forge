import { join, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { applyMigrations } from "../migrate/applier";
import { RECORDED_CHECKSUM_SELECT } from "../migrate/checksum";
import { COMPANION_TABLES, ensureCompanionTables } from "../migrate/companions";
import { migrationChecksum, migrationsDigest } from "../migrate/files";
import { parseMigrationHeader } from "../schema/header";
import { INVENTORY_SELECT, rowCountSelect, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { BackupManifest, DbRunContext, Migration } from "../types";
import { executeFile, queryBatches, queryRows, queryRowsIfTable } from "../wrangler";
import {
  appSchemaDigestInput,
  checkRestoreTarget,
  classifyTable,
  compareManifests,
  manifestSelfDigest,
  validateManifest,
  verifyBackupArtifact,
} from "./artifact";
import { describeTables, readWholeTable } from "./read";
import type { RestoreOptions, RestoreOutcome, RestorePlan, RestoreTargetState } from "./types";

function refuseRemoteRestore(run: DbRunContext): void {
  const place = run.config.target.place;
  if (!isRemotePlace(place)) return;
  throw new CliError(
    "invalid-args",
    `restore is refused for ${place} — return a deployed database to a point in time with \`forge db bookmark restore\`, which is D1's own undo`,
  );
}

/** Reads and validates the artifact's manifest, refusing one this tool did not write. @public */
export function readBackupManifest(run: DbRunContext, artifact: string): BackupManifest {
  const path = join(artifact, "manifest.json");
  if (!run.io.exists(path)) {
    throw new CliError("invalid-args", `${path} does not exist — --artifact takes the directory, not a file inside it`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.io.readText(path));
  } catch (error) {
    throw new CliError("invalid-args", `${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const problems = validateManifest(parsed);
  if (problems.length > 0) throw new CliError("invalid-args", `${path} is not a manifest this tool wrote:\n  ${problems.join("\n  ")}`);
  const manifest = parsed as BackupManifest;
  if (manifestSelfDigest(manifest) !== manifest.selfDigest) {
    throw new CliError(
      "invalid-args",
      `${path} does not hash to the selfDigest it carries — it has been truncated, swapped or corrupted since it was written. The digest detects damage and not tampering: anyone who edits a manifest can recompute it.`,
    );
  }
  return manifest;
}

function discoverArtifactMigrations(run: DbRunContext, artifact: string, manifest: BackupManifest): Migration[] {
  return manifest.migrations.map((entry, index) => {
    const path = join(artifact, "migrations", `${entry.name}.sql`);
    if (!run.io.exists(path)) throw new CliError("invalid-args", `${path} is declared in the manifest and missing from the artifact`);
    const sql = run.io.readText(path);
    if (migrationChecksum(sql) !== entry.sha256) throw new CliError("invalid-args", `${path} does not hash to what the manifest declares for it`);
    const { origin, stamp } = parseMigrationHeader(sql);
    return { name: entry.name, version: Number(/^(\d+)_/.exec(entry.name)?.[1] ?? index + 1), path, sha256: entry.sha256, sql, origin, stamp };
  });
}

function inspect(run: DbRunContext): RestoreTargetState {
  const objects = toSchemaObjects(queryRows(run.io, run.home, INVENTORY_SELECT));
  const carried = objects
    .filter((object) => object.type === "table")
    .map((object) => object.name)
    .filter((name) => classifyTable(name) === "app" || (classifyTable(name) === "managed" && COMPANION_TABLES.includes(name)));
  const counted = queryBatches(run.io, run.home, carried.map(rowCountSelect));
  const counts: Record<string, number> = {};
  carried.forEach((name, index) => {
    counts[name] = Number(counted[index]?.[0]?.rows ?? 0);
  });
  return { objects, counts };
}

/** Everything a restore checks before it asks: the manifest, the artifact whole, its embedded migrations, and an empty target. @public */
export function prepareRestore(run: DbRunContext, options: RestoreOptions): RestorePlan {
  refuseRemoteRestore(run);
  const { io, home, config } = run;
  const artifact = resolve(config.root, options.artifact);
  const manifest = readBackupManifest(run, artifact);

  if (options.expect !== undefined && manifest.database.name !== options.expect) {
    throw new CliError("invalid-args", `--expect ${options.expect} does not match this artifact, which was taken from ${manifest.database.name}`);
  }
  const diverged = manifest.verified.filter((route) => route.divergent > 0);
  if (diverged.length > 0) {
    throw new CliError(
      "invalid-args",
      `${artifact} was proven by ${diverged.map((route) => `route ${route.route} with ${route.divergent} divergence(s)`).join(" and ")} — its own run refused it; take the backup again`,
    );
  }
  if (manifest.verified.length === 0) io.log("! this artifact was produced with --no-verify and has never been proven to rebuild");
  for (const warning of manifest.warnings) io.log(`! ${warning}`);

  for (const file of options.route === "full" ? ["schema.sql", "data.sql"] : ["data.sql"]) {
    if (!io.exists(join(artifact, file))) {
      throw new CliError("invalid-args", `${file} is missing from ${artifact}, and route ${options.route} loads it`);
    }
  }

  verifyBackupArtifact(io, artifact, manifest);

  const expectedTables = manifest.tables.map((table) => table.name);
  const before = inspect(run);
  const occupied = Object.entries(before.counts).filter(([, count]) => count > 0);
  if (occupied.length > 0) {
    throw new CliError(
      "invalid-args",
      `${home.database} already holds data (${occupied.map(([table, count]) => `${table} ${count}`).join(", ")}) — run \`forge db reset\` first; a restore adds rows and never removes them`,
    );
  }

  const migrations = discoverArtifactMigrations(run, artifact, manifest);
  const rows = manifest.tables.reduce((total, table) => total + table.rows, 0);
  return { artifact, route: options.route, manifest, migrations, expectedTables, before, rows };
}

/** Loads a prepared restore into the target and checks the result against the manifest's own digests. @public */
export function executeRestore(run: DbRunContext, plan: RestorePlan): RestoreOutcome {
  const { io, home } = run;
  const { artifact, manifest, expectedTables, before } = plan;
  if (plan.route === "full") {
    const problems = checkRestoreTarget("full", before.objects, before.counts, expectedTables);
    if (problems.length > 0) throw new CliError("invalid-args", `the target is not empty:\n  ${problems.join("\n  ")}`);
    // The schema declares the tables, then the rows fill them — the repeated `PRAGMA
    // defer_foreign_keys=TRUE;` the second file opens with is accepted and not honoured, as it is anywhere.
    executeFile(io, home, join(artifact, "schema.sql"));
    executeFile(io, home, join(artifact, "data.sql"));
  } else {
    // `record: false`: `data.sql` carries the artifact's own `_forge_migrations` rows, with their
    // original ids, `applied_at` and `fingerprint`, so recording here would collide with every one.
    applyMigrations(run, home, plan.migrations, { label: "restore", record: false });
    ensureCompanionTables(io, home);
    const after = inspect(run);
    const problems = checkRestoreTarget("migrations", after.objects, after.counts, expectedTables);
    if (problems.length > 0) throw new CliError("invalid-args", `the target is not ready for a data-only load:\n  ${problems.join("\n  ")}`);
    executeFile(io, home, join(artifact, "data.sql"));
  }

  const objects = toSchemaObjects(queryRows(io, home, INVENTORY_SELECT));
  const recorded = queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT);
  const bindings = compareManifests(manifest, {
    migrations: (recorded ?? []).map((row) => String(row.name ?? "")),
    digest: sha256(appSchemaDigestInput(objects)),
    migrationsDigest: migrationsDigest(plan.migrations),
  });

  const declared = new Map(manifest.tables.map((table) => [table.name, table.digest]));
  const tables = describeTables(io, home, expectedTables).map((table) => {
    const read = readWholeTable(io, home, table);
    return {
      name: table.name,
      rows: read.rows.length,
      matches: declared.get(table.name) === sha256(read.rows.map((row) => row.canonical).join("\n")),
    };
  });

  for (const binding of bindings) io.log(`! ${binding}`);
  const divergent = tables.filter((table) => !table.matches).length;
  if (divergent > 0 || bindings.length > 0) {
    throw new CliError(
      "invalid-args",
      `${divergent} table(s) do not match the manifest — discard this target and retry from an empty one; there is deliberately no repair path`,
    );
  }
  return { database: home.database, route: plan.route, artifact, tables };
}
