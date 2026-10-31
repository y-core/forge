import { join } from "node:path";

import { D1_LIMITS } from "../../../storage/db/limits";
import { CliError } from "../../cli/errors";
import { declaredMigrations, declaredSchemas, NO_SCHEMAS, snapshotPath } from "../declared";
import { sha256 } from "../digest";
import { formatApprovalLine, migrationFindings } from "../migrate/analysis";
import { migrationChecksum, migrationFileName, migrationsDigest, nextMigrationNumber, readMigrations } from "../migrate/files";
import { isManagedObject, MANAGED_TABLE_PREFIXES } from "../migrate/fingerprint";
import { formatLintFinding, lintMigration } from "../migrate/lint";
import type { DbRunContext } from "../types";
import { executeFile } from "../wrangler";
import { readDesiredState } from "./desired";
import {
  checkSchemaRenames,
  describeSchemaDiff,
  destructivePlanDigest,
  diffSchemaModels,
  droppedObjectNames,
  formatDataDependentStep,
  parseSchemaRename,
  schemaDiffIsEmpty,
} from "./diff";
import { emitMigrationSql } from "./emit";
import { formatComposeHeader, parseMigrationHeader } from "./header";
import { readSchemaModel } from "./introspect";
import { declaredObjectNames } from "./normalize";
import { assignOwnership, attributeDrops, declaredNamesBySource } from "./ownership";
import { proveComposed } from "./proof";
import { cachedSchemaModel, forgeVersion, loadDesired, readScratchModel, replayBaseline, scratchModelKey, scratchWranglerVersion } from "./scratch";
import { buildSchemaSnapshot, readSchemaSnapshot, writeSchemaSnapshot } from "./snapshot";
import type { ComposeOptions, ComposeOutcome, DesiredState, OwnershipClaim, SchemaInputs, SchemaModel, SchemaRename } from "./types";

/** Refuses a declared object named in the space forge, SQLite and the platform keep for themselves, which no model would carry. */
function refuseReservedNames(claims: readonly OwnershipClaim[]): void {
  const problems = claims.flatMap((claim) =>
    (claim.declared ?? [])
      .filter((object) => isManagedObject(object.name))
      .map((object) => `${claim.source} declares ${object.type} \`${object.name}\``),
  );
  if (problems.length === 0) return;
  const reserved = MANAGED_TABLE_PREFIXES.map((prefix) => `\`${prefix}\``).join(", ");
  throw new CliError(
    "invalid-args",
    `${problems.join("\n")}\n${reserved} are reserved for forge, SQLite and the platform — rename it, or drop it from the schema.`,
  );
}

/** Refuses a declared table wider than D1 accepts, whichever statement — a `CREATE TABLE` or an `ADD COLUMN` — would take it there. @internal */
export function refuseWideTables(desired: SchemaModel): void {
  const wide = desired.tables.filter((table) => table.columns.length > D1_LIMITS.columns);
  if (wide.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${wide.map((table) => `${table.name} declares ${table.columns.length} columns`).join(", ")} — D1 refuses a table of more than ${D1_LIMITS.columns}, so nothing was composed; split it into tables joined on its key`,
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
  refuseReservedNames(claims);
  return { migrations: readMigrations(run), schemas, states, snapshotPath: path, snapshot: readSchemaSnapshot(run.io, path), claims };
}

/** Each declared schema with no file to read — dropped from the states on the way in, so nothing downstream can tell it was declared. @internal */
export function missingSchemas(inputs: SchemaInputs): string[] {
  return inputs.schemas
    .filter((source) => !inputs.states.some((state) => state.source === source.declared))
    .map((source) => `${source.declared} is declared in config/db.config.ts and no file is there to read`);
}

/** The replayed model of every migration on disk, from the cache when the migrations have not changed. @internal */
export function baselineSchemaModel(run: DbRunContext, inputs: SchemaInputs, cache: boolean): Promise<SchemaModel> {
  const key = scratchModelKey(scratchWranglerVersion(run), migrationsDigest(inputs.migrations));
  return cachedSchemaModel(run, "baseline", key, cache, async () => readScratchModel(run, await replayBaseline(run, inputs.migrations)));
}

/** Each declared schema's digest, keyed as `config/db.config.ts` declared it — what the snapshot records and `--check` compares against. @internal */
export function declaredDigests(states: readonly DesiredState[]): Record<string, string> {
  return Object.fromEntries(states.map((state) => [state.source, state.digest]));
}

/** The model every declared schema builds together, from the cache when none of them has changed. @internal */
export function desiredSchemaModel(run: DbRunContext, inputs: SchemaInputs, cache: boolean): Promise<SchemaModel> {
  const key = scratchModelKey(scratchWranglerVersion(run), sha256(inputs.states.map((state) => `${state.source}\0${state.digest}`).join("\0\0")));
  return cachedSchemaModel(run, "desired", key, cache, async () => readScratchModel(run, await loadDesired(run, inputs.states)));
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
  if (target.stamp === null) {
    throw new CliError("invalid-args", `${target.name} has no compose stamp — only a composed migration can be restamped; compose again instead`);
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
    return { path: null, snapshotPath: null, plan, warnings: [], causes: [], sql, dryRun: true };
  }
  run.io.writeText(target.path, sql);
  for (const line of plan) say(line);
  return { path: target.path, snapshotPath: null, plan, warnings: [], causes: [], sql, dryRun: false };
}

/** Answers an app declaring no schema with nothing to compose — unless a snapshot or a migration is history that composing nothing would drop. */
function composeFromNoSchema(run: DbRunContext, inputs: SchemaInputs, dryRun: boolean): ComposeOutcome {
  const latest = inputs.migrations[inputs.migrations.length - 1]?.name;
  const held = [
    ...(inputs.snapshot === null ? [] : [`${inputs.snapshotPath} exists`]),
    ...(latest === undefined ? [] : [`the migrations reach ${latest}`]),
  ];
  if (held.length > 0) {
    throw new CliError(
      "invalid-args",
      `${held.join(" and ")} — there is history to hold in step, so composing from no schema is refused:\n${NO_SCHEMAS}`,
    );
  }
  if (!run.json) run.print("config/db.config.ts names no `schemas`, and there is no snapshot and no migration — nothing to compose");
  return { path: null, snapshotPath: null, plan: [], warnings: [], causes: [], sql: "", dryRun };
}

/** Composes the next migration from every declared schema, proving it against a replay of the migrations before writing it. @public */
export async function composeMigration(run: DbRunContext, options: ComposeOptions): Promise<ComposeOutcome> {
  const inputs = readSchemaInputs(run);
  const missing = missingSchemas(inputs);
  if (missing.length > 0) throw new CliError("invalid-args", missing.join("\n"));
  if (options.restamp !== undefined) return restampMigration(run, inputs, options.restamp, options.dryRun);
  if (inputs.schemas.length === 0) return composeFromNoSchema(run, inputs, options.dryRun);

  const renames: SchemaRename[] = options.renames.map(parseSchemaRename);
  const migrationsDir = declaredMigrations(run).path;

  const baselineAll = await baselineSchemaModel(run, inputs, options.cache);
  const desired = await desiredSchemaModel(run, inputs, options.cache);
  refuseWideTables(desired);
  assignOwnership(inputs.claims, desired);

  let baseline = baselineAll;

  const renameProblems = checkSchemaRenames(baseline, renames);
  if (renameProblems.length > 0) throw new CliError("invalid-args", renameProblems.join("\n"));
  if (renames.length > 0) {
    // The rename runs on a real SQLite, which rewrites every index, trigger and REFERENCES that names the old name.
    const home = await replayBaseline(run, inputs.migrations);
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
    await executeFile(run.io, home, file);
    baseline = await readSchemaModel(run.io, home);
  }

  const diff = diffSchemaModels(baseline, desired);
  if (diff.refusals.length > 0) throw new CliError("invalid-args", diff.refusals.join("\n"));
  const plan = describeSchemaDiff(diff);
  const say = (line: string) => {
    if (!run.json) run.print(line);
  };
  const attributed = attributeDrops(inputs.snapshot, inputs.states, droppedObjectNames(diff));
  const causes = attributed.map(
    ({ source, objects }) =>
      `${objects.join(", ")} ${objects.length === 1 ? "was" : "were"} declared by ${source}, which config/db.config.ts no longer declares or whose file is absent — nothing declares ${objects.length === 1 ? "it" : "them"} now`,
  );
  const forgotten = Object.keys(inputs.snapshot?.declared ?? {}).filter(
    (source) => !inputs.states.some((state) => state.source === source) && !attributed.some((attribution) => attribution.source === source),
  );
  const warnings = [
    ...diff.dataDependent.map((step) => `warning: ${formatDataDependentStep(step)}`),
    ...forgotten.map((source) => `warning: ${source} is in ${inputs.snapshotPath} and config/db.config.ts no longer declares it`),
  ];
  const warn = (line: string) => (run.json ? run.io.log(line) : run.print(line));

  const digests = declaredDigests(inputs.states);
  const declared = declaredNamesBySource(inputs.claims);
  const snapshotOf = (digest: string) => buildSchemaSnapshot({ desired: digests, declared, migrationsDigest: digest });

  if (schemaDiffIsEmpty(diff) && renames.length === 0) {
    if (!options.dryRun) writeSchemaSnapshot(run.io, inputs.snapshotPath, snapshotOf(migrationsDigest(inputs.migrations)));
    say(`no changes — ${migrationsDir} already produces every declared schema`);
    for (const line of warnings) warn(line);
    return {
      path: null,
      snapshotPath: options.dryRun ? null : inputs.snapshotPath,
      plan: [],
      warnings,
      causes: [],
      sql: "",
      dryRun: options.dryRun,
    };
  }

  const file = migrationFileName(nextMigrationNumber(inputs.migrations), options.name ?? "schema");
  const path = join(migrationsDir, file);
  const findings = migrationFindings(baselineAll, desired, renames, file.slice(0, -".sql".length));
  const approvals = findings.map((finding) => formatApprovalLine(finding.change));

  const digest = destructivePlanDigest(diff, causes, approvals);
  if (findings.length > 0 && options.allowDestructive !== digest) {
    for (const line of plan) say(`  ${line}`);
    for (const line of causes) say(line);
    const blocks = [
      ...(diff.destructive.length > 0 ? [`the change discards data:\n  ${diff.destructive.join("\n  ")}`] : []),
      `the migration carries one approval line per drop and rename:\n  ${approvals.join("\n  ")}`,
    ].join("\n");
    throw new CliError(
      "invalid-args",
      options.allowDestructive === undefined
        ? `${blocks}\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`
        : `--allow-destructive ${options.allowDestructive} is not the plan you approved — the plan is now (${digest}):\n${blocks}\nRead it again, then pass --allow-destructive ${digest}.`,
    );
  }

  const body = `${approvals.map((line) => `${line}\n`).join("")}${emitMigrationSql(diff, baseline, desired, renames)}`;
  const stamp = { desired: digests, baseline: migrationsDigest(inputs.migrations), forge: forgeVersion(run.io) };
  const sql = `${formatComposeHeader(stamp, body)}${body}`;

  const errors = lintMigration("<composed>", sql);
  if (errors.length > 0) {
    throw new CliError(
      "invalid-args",
      `the composed migration fails lint — this is a forge bug, and the file was not written:\n${errors.map(formatLintFinding).join("\n")}`,
    );
  }

  if (options.dryRun) {
    say(`would write ${path}:`);
    for (const line of plan) say(`  ${line}`);
    for (const line of causes) say(line);
    for (const line of warnings) warn(line);
    return { path: null, snapshotPath: null, plan, warnings, causes, sql, dryRun: true };
  }

  const proven = await proveComposed(run, inputs, { sql, baseline: baselineAll, desired, renames, steps: diff.dataDependent });
  const written = [...warnings, ...proven.warnings];

  run.io.mkdir(migrationsDir);
  run.io.writeText(path, sql);
  const next = [...inputs.migrations, { name: file.slice(0, -".sql".length), sha256: migrationChecksum(sql) }];
  // The proof's replay is exactly the baseline the next compose or `--check --replay` will want, so it is cached under that key now.
  await cachedSchemaModel(run, "baseline", scratchModelKey(scratchWranglerVersion(run), migrationsDigest(next)), false, () =>
    Promise.resolve(proven.model),
  );
  writeSchemaSnapshot(run.io, inputs.snapshotPath, snapshotOf(migrationsDigest(next)));
  say(`wrote ${path}`);
  for (const line of plan) say(`  ${line}`);
  for (const line of causes) say(line);
  for (const line of written) warn(line);
  return { path, snapshotPath: inputs.snapshotPath, plan, warnings: written, causes, sql, dryRun: false };
}
