import { migrationsDigest } from "../migrate/files";
import type { DbRunContext } from "../types";
import { baselineSchemaModel, declaredDigests, desiredSchemaModel, readSchemaInputs } from "./compose";
import { describeSchemaDifference } from "./introspect";
import { loadDesired } from "./scratch";
import type { SchemaCheckReport, SchemaInputs, SchemaSnapshot } from "./types";

/** Every declared schema whose digest is not what the snapshot recorded — an edited file, an upgraded library, one added or dropped. */
function movedSchemas(inputs: SchemaInputs, snapshot: SchemaSnapshot): string[] {
  const problems: string[] = [];
  const actual = declaredDigests(inputs.states);
  for (const source of Object.keys(actual)) {
    if (snapshot.desired[source] === undefined) problems.push(`${source} is declared and the snapshot has never seen it`);
    else if (snapshot.desired[source] !== actual[source]) problems.push(`${source} moved since the last compose`);
  }
  for (const source of Object.keys(snapshot.desired)) {
    if (actual[source] === undefined) problems.push(`${source} is in the snapshot and config/db.ts no longer declares it, or the file is absent`);
  }
  return problems;
}

/** Holds every declared schema against the snapshot by digest, and under `replay` the migrations against the declarations. @public */
export async function checkSchema(run: DbRunContext, options: { replay: boolean; cache: boolean }): Promise<SchemaCheckReport> {
  const inputs = readSchemaInputs(run);
  const report = { snapshotPath: inputs.snapshotPath, schemas: inputs.schemas.map((source) => source.declared) };

  // An absent file is dropped on the way in, so a declaration naming one is indistinguishable from
  // no declaration at all by the time the states are counted — and "clean" is the wrong answer.
  const missing = inputs.schemas.filter((source) => !inputs.states.some((state) => state.source === source.declared));
  if (missing.length > 0) {
    return { ...report, problems: missing.map((source) => `${source.declared} is declared in config/db.ts and no file is there to read`) };
  }

  if (inputs.snapshot === null) {
    if (inputs.states.length === 0) return { ...report, problems: null };
    if (inputs.migrations.length > 0)
      return { ...report, problems: [`${inputs.snapshotPath} does not exist — run \`forge db migrate compose\` once to write it`] };
    // A checkout that declares a schema and composes nothing — a library's. The whole check is that
    // the declarations execute, which loading them into an empty database is.
    if (options.replay) await loadDesired(run, inputs.states);
    return { ...report, snapshotPath: null, problems: [] };
  }

  const problems = movedSchemas(inputs, inputs.snapshot);
  if (inputs.snapshot.migrationsDigest !== migrationsDigest(inputs.migrations)) {
    const latest = inputs.migrations[inputs.migrations.length - 1]?.name ?? "none";
    problems.push(`the migrations changed after the last compose (latest: ${latest}) — run \`forge db migrate compose\``);
  }
  if (!options.replay || problems.length > 0) return { ...report, problems };

  // Both sides are rebuilt from what is on disk, so the check is the one that matters: the
  // migrations build what the schemas declare. Nothing stored is compared against itself.
  const loaded = await desiredSchemaModel(run, inputs, options.cache);
  const replay = await baselineSchemaModel(run, inputs, options.cache);
  problems.push(...describeSchemaDifference(replay, loaded, { left: "the replayed migrations", right: "the declared schema" }));
  return { ...report, problems };
}

/** The check as the lines `forge db schema check` prints. @internal */
export function formatSchemaCheck(report: SchemaCheckReport): string[] {
  if (report.problems === null) return ["config/db.ts names no `schemas`, and there is no snapshot — nothing to hold in step"];
  if (report.snapshotPath === null) return [`${report.schemas.join(", ")} declare a schema and compose nothing`];
  if (report.problems.length === 0) return [`${report.schemas.join(", ")} match ${report.snapshotPath}`];
  return [`${report.snapshotPath}:`, ...report.problems.map((problem) => `  ${problem}`)];
}
