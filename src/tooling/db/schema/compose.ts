import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { declaredSchemas, NO_SCHEMAS, snapshotPath } from "../declared";
import { sha256 } from "../digest";
import { migrationChecksum, migrationFileName, migrationsDigest, nextMigrationNumber, readMigrations } from "../migrate/files";
import { isManagedObject, MANAGED_TABLE_PREFIXES } from "../migrate/fingerprint";
import { formatLintFinding, lintMigration } from "../migrate/lint";
import type { DbRunContext } from "../types";
import { executeFile } from "../wrangler";
import { readDesiredState } from "./desired";
import { checkSchemaRenames, describeSchemaDiff, destructivePlanDigest, diffSchemaModels, parseSchemaRename, schemaDiffIsEmpty } from "./diff";
import { emitMigrationSql } from "./emit";
import { formatComposeHeader, formatCustomHeader, parseMigrationHeader } from "./header";
import { describeSchemaDifference, readSchemaModel } from "./introspect";
import { declaredObjectNames } from "./normalize";
import { assignOwnership } from "./ownership";
import { cachedSchemaModel, forgeVersion, loadDesired, readScratchModel, replayBaseline, scratchModelKey, scratchWranglerVersion } from "./scratch";
import { buildSchemaSnapshot, readSchemaSnapshot, writeSchemaSnapshot } from "./snapshot";
import type { ComposeOptions, ComposeOutcome, DesiredState, OwnershipClaim, SchemaInputs, SchemaModel, SchemaRename } from "./types";

/** Refuses a declared object named in the space forge, SQLite and the platform keep for themselves, which no model would carry. */
function refuseReservedNames(claims: readonly OwnershipClaim[], migrationsTable: string): void {
  const problems = claims.flatMap((claim) =>
    (claim.declared ?? [])
      .filter((object) => isManagedObject(object.name, migrationsTable))
      .map((object) => `${claim.source} declares ${object.type} \`${object.name}\``),
  );
  if (problems.length === 0) return;
  const reserved = MANAGED_TABLE_PREFIXES.map((prefix) => `\`${prefix}\``).join(", ");
  throw new CliError(
    "invalid-args",
    `${problems.join("\n")}\n${reserved} are reserved for forge, SQLite and the platform, and \`${migrationsTable}\` is the migrations table — rename it, or drop it from the schema.`,
  );
}

/** Reads the migrations on disk, every declared schema, and the snapshot. @internal */
export function readSchemaInputs(run: DbRunContext): SchemaInputs {
  const schemas = declaredSchemas(run);
  const states = schemas.map((source) => readDesiredState(run.io, source)).filter((state): state is DesiredState => state !== null);
  const path = snapshotPath(run);
  const claims = schemas.map((source) => {
    const state = states.find((candidate) => candidate.source === source.declared) ?? null;
    return { source: source.declared, declared: state === null ? null : declaredObjectNames(state.text) };
  });
  refuseReservedNames(claims, run.config.entry.migrationsTable);
  return { migrations: readMigrations(run), schemas, states, snapshotPath: path, snapshot: readSchemaSnapshot(run.io, path), claims };
}

/** The replayed model of every migration on disk, from the cache when the migrations have not changed. @internal */
export function baselineSchemaModel(run: DbRunContext, inputs: SchemaInputs, cache: boolean): SchemaModel {
  const key = scratchModelKey(scratchWranglerVersion(run), migrationsDigest(inputs.migrations));
  return cachedSchemaModel(run, "baseline", key, cache, () => readScratchModel(run, replayBaseline(run, inputs.migrations)));
}

/** Each declared schema's digest, keyed as `config/db.ts` declared it — what the snapshot records and `--check` compares against. @internal */
export function declaredDigests(states: readonly DesiredState[]): Record<string, string> {
  return Object.fromEntries(states.map((state) => [state.source, state.digest]));
}

/** The model every declared schema builds together, from the cache when none of them has changed. @internal */
export function desiredSchemaModel(run: DbRunContext, inputs: SchemaInputs, cache: boolean): SchemaModel {
  const key = scratchModelKey(scratchWranglerVersion(run), sha256(inputs.states.map((state) => `${state.source}\0${state.digest}`).join("\0\0")));
  return cachedSchemaModel(run, "desired", key, cache, () => readScratchModel(run, loadDesired(run, inputs.states)));
}

function writeCustom(run: DbRunContext, inputs: SchemaInputs, options: ComposeOptions): ComposeOutcome {
  if (options.name === undefined || options.name === "")
    throw new CliError("invalid-args", "a custom migration needs a name — `forge db migrate compose --custom <name>`");
  const dir = run.config.entry.migrationsDir;
  const file = migrationFileName(nextMigrationNumber(inputs.migrations), options.name);
  const path = join(dir, file);
  const sql = `${formatCustomHeader()}\n`;
  if (!options.dryRun) {
    run.io.mkdir(dir);
    run.io.writeText(path, sql);
  }
  return { path: options.dryRun ? null : path, snapshotPath: null, plan: [`custom migration ${file}`], warnings: [], sql, dryRun: options.dryRun };
}

/** Rewrites one generated migration's stamp to the history now on disk; a checksum covers the file with the stamp blanked, so nothing else moves. */
function restampMigration(run: DbRunContext, inputs: SchemaInputs, name: string, dryRun: boolean): ComposeOutcome {
  const wanted = name.endsWith(".sql") ? name.slice(0, -".sql".length) : name;
  const index = inputs.migrations.findIndex((migration) => migration.name === wanted);
  const target = inputs.migrations[index];
  if (target === undefined) {
    const known = inputs.migrations.map((migration) => migration.name).join(", ");
    throw new CliError(
      "invalid-args",
      `--restamp ${name} names no migration${known === "" ? " — the migrations directory is empty" : ` — on disk: ${known}`}`,
    );
  }
  if (target.origin !== "generated" || target.stamp === null) {
    throw new CliError(
      "invalid-args",
      `${target.name} is a ${target.origin} migration with no compose stamp — only a generated migration can be restamped`,
    );
  }
  const header = parseMigrationHeader(target.sql);
  if (migrationChecksum(target.sql) !== target.stamp.body) {
    throw new CliError(
      "invalid-args",
      `${target.name} was edited since it was composed — restamp would certify an unproven file; compose again instead`,
    );
  }

  const say = (line: string) => {
    if (!run.json) run.print(line);
  };
  const stamp = {
    desired: declaredDigests(inputs.states),
    baseline: migrationsDigest(inputs.migrations.slice(0, index)),
    forge: forgeVersion(run.io),
  };
  const sql = `${formatComposeHeader(stamp, header.body)}${header.body}`;
  const plan = [`restamped ${target.name}`];
  if (dryRun) {
    for (const line of plan) say(`would have ${line}`);
    return { path: null, snapshotPath: null, plan, warnings: [], sql, dryRun: true };
  }
  run.io.writeText(target.path, sql);
  for (const line of plan) say(line);
  return { path: target.path, snapshotPath: null, plan, warnings: [], sql, dryRun: false };
}

/** Applies the emitted SQL to a fresh replay and refuses to write it unless the result is the desired model; returns what the replay then holds. */
function proveEmitted(run: DbRunContext, inputs: SchemaInputs, sql: string, desired: SchemaModel): SchemaModel {
  const home = replayBaseline(run, inputs.migrations);
  const file = join(home.dir, "proof.sql");
  run.io.writeText(file, sql);
  try {
    executeFile(run.io, home, file);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      "invalid-args",
      `the composed migration does not apply to the baseline — this is a forge bug, and the file was not written:\n${detail}`,
    );
  }
  const model = readSchemaModel(run.io, home, run.config.entry.migrationsTable);
  const difference = describeSchemaDifference(model, desired, { left: "after the migration", right: "the declared schema" });
  if (difference.length > 0) {
    throw new CliError(
      "invalid-args",
      `the composed migration does not produce the declared schema — this is a forge bug, and the file was not written:\n  ${difference.join("\n  ")}`,
    );
  }
  return model;
}

/** Composes the next migration from every declared schema, proving it against a replay of the migrations before writing it. @public */
export function composeMigration(run: DbRunContext, options: ComposeOptions): ComposeOutcome {
  const inputs = readSchemaInputs(run);
  if (options.custom) return writeCustom(run, inputs, options);
  if (options.restamp !== undefined) return restampMigration(run, inputs, options.restamp, options.dryRun);
  if (inputs.states.length === 0) throw new CliError("invalid-args", NO_SCHEMAS);

  const renames: SchemaRename[] = options.renames.map(parseSchemaRename);
  const migrationsDir = run.config.entry.migrationsDir;

  const baselineAll = baselineSchemaModel(run, inputs, options.cache);
  const desired = desiredSchemaModel(run, inputs, options.cache);
  assignOwnership(inputs.claims, desired);

  let baseline = baselineAll;

  const renameProblems = checkSchemaRenames(baseline, renames);
  if (renameProblems.length > 0) throw new CliError("invalid-args", renameProblems.join("\n"));
  if (renames.length > 0) {
    // The rename runs on a real SQLite, which rewrites every index, trigger and REFERENCES that names the old name.
    const home = replayBaseline(run, inputs.migrations);
    const file = join(home.dir, "renames.sql");
    run.io.writeText(
      file,
      emitMigrationSql(
        {
          tables: [],
          indexes: { created: [], dropped: [], changed: [] },
          triggers: { created: [], dropped: [], changed: [] },
          views: { created: [], dropped: [], changed: [] },
          destructive: [],
          refusals: [],
          dataDependent: [],
          dropDependents: [],
        },
        baseline,
        baseline,
        renames,
      ),
    );
    executeFile(run.io, home, file);
    baseline = readSchemaModel(run.io, home, run.config.entry.migrationsTable);
  }

  const diff = diffSchemaModels(baseline, desired);
  if (diff.refusals.length > 0) throw new CliError("invalid-args", diff.refusals.join("\n"));
  const plan = describeSchemaDiff(diff);
  const say = (line: string) => {
    if (!run.json) run.print(line);
  };
  const warnings = diff.dataDependent.map((line) => `warning: ${line}`);
  const warn = (line: string) => (run.json ? run.io.log(line) : run.print(line));

  const digests = declaredDigests(inputs.states);
  const snapshotOf = (digest: string) => buildSchemaSnapshot({ desired: digests, migrationsDigest: digest });

  if (schemaDiffIsEmpty(diff) && renames.length === 0) {
    if (!options.dryRun) writeSchemaSnapshot(run.io, inputs.snapshotPath, snapshotOf(migrationsDigest(inputs.migrations)));
    say(`no changes — ${migrationsDir} already produces every declared schema`);
    return { path: null, snapshotPath: options.dryRun ? null : inputs.snapshotPath, plan: [], warnings: [], sql: "", dryRun: options.dryRun };
  }

  if (diff.destructive.length > 0) {
    const digest = destructivePlanDigest(diff);
    const lines = diff.destructive.join("\n  ");
    if (options.allowDestructive === undefined) {
      for (const line of plan) say(`  ${line}`);
      throw new CliError(
        "invalid-args",
        `the change discards data:\n  ${lines}\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
      );
    }
    if (options.allowDestructive !== digest) {
      for (const line of plan) say(`  ${line}`);
      throw new CliError(
        "invalid-args",
        `--allow-destructive ${options.allowDestructive} is not the plan you approved — the destructive set is now (${digest}):\n  ${lines}\nRead it again, then pass --allow-destructive ${digest}.`,
      );
    }
  }

  const body = emitMigrationSql(diff, baseline, desired, renames);
  const file = migrationFileName(nextMigrationNumber(inputs.migrations), options.name ?? "schema");
  const path = join(migrationsDir, file);
  const stamp = { desired: digests, baseline: migrationsDigest(inputs.migrations), forge: forgeVersion(run.io) };
  const sql = `${formatComposeHeader(stamp, body)}${body}`;

  // Linted as the file, not as the bare body: the stamp is what says this is generated, and without
  // it every emitted `CREATE TABLE` reads as DDL in a custom migration.
  const errors = lintMigration("<composed>", sql).filter((finding) => finding.level === "error");
  if (errors.length > 0) {
    throw new CliError(
      "invalid-args",
      `the composed migration fails lint — this is a forge bug, and the file was not written:\n${errors.map(formatLintFinding).join("\n")}`,
    );
  }

  if (options.dryRun) {
    say(`would write ${path}:`);
    for (const line of plan) say(`  ${line}`);
    for (const line of warnings) warn(line);
    return { path: null, snapshotPath: null, plan, warnings, sql, dryRun: true };
  }

  const proven = proveEmitted(run, inputs, sql, desired);

  run.io.mkdir(migrationsDir);
  run.io.writeText(path, sql);
  const next = [...inputs.migrations, { name: file.slice(0, -".sql".length), sql }];
  // The proof's replay is exactly the baseline the next compose or `--check --replay` will want, so it is cached under that key now.
  cachedSchemaModel(run, "baseline", scratchModelKey(scratchWranglerVersion(run), migrationsDigest(next)), false, () => proven);
  writeSchemaSnapshot(run.io, inputs.snapshotPath, snapshotOf(migrationsDigest(next)));
  say(`wrote ${path}`);
  for (const line of plan) say(`  ${line}`);
  for (const line of warnings) warn(line);
  return { path, snapshotPath: inputs.snapshotPath, plan, warnings, sql, dryRun: false };
}
