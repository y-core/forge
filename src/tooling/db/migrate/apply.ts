import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import { timeTravelInfo } from "../bookmark";
import { confirmPrinter } from "../context";
import { refuseSchemaDrift, schemaDrift } from "../drift";
import { INVENTORY_SELECT, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { ApplyPlan, Bookmark, DbIo, DbRunContext, Home, LintFinding, Migration } from "../types";
import { executeSql, queryRows, queryRowsIfTable } from "../wrangler";
import { applyMigrations } from "./applier";
import { certifyFingerprintSql, compareChecksums, RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "./checksum";
import { ensureCompanionTables } from "./companions";
import { migrationsDigest, readMigrations } from "./files";
import { schemaFingerprint } from "./fingerprint";
import { formatLintFinding, lintMigrations } from "./lint";
import { acquireApplyLock } from "./lock";
import { planApply } from "./plan";
import { rehearseMigrations } from "./rehearse";
import type { MigrateOptions, MigrateOutcome, RehearsalOutcome, TargetFacts } from "./types";

/** Aborts on a lint error, and on a warning against a deployed database that was not allowed through. */
function enforceLint(run: DbRunContext, findings: readonly LintFinding[], allowWarnings: boolean): void {
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length > 0) {
    throw new CliError("invalid-args", `${errors.length} lint error(s) in the migrations:\n${errors.map(formatLintFinding).join("\n")}`);
  }
  const warnings = findings.filter((f) => f.level === "warning");
  if (warnings.length === 0) return;
  if (isRemotePlace(run.config.target.place) && !allowWarnings) {
    throw new CliError(
      "invalid-args",
      `${warnings.length} lint warning(s) against ${run.config.target.place}. Read them, then pass --allow-warnings to apply anyway:\n${warnings.map(formatLintFinding).join("\n")}`,
    );
  }
  for (const warning of warnings) run.io.log(formatLintFinding(warning));
}

/** Asks before migrating anything but the developer's own local database. */
async function confirmApply(run: DbRunContext, plan: ApplyPlan, bookmarked: boolean): Promise<void> {
  const place = run.config.target.place;
  if (place === "local") return;
  const undo = isRemotePlace(place) && bookmarked ? "`forge db bookmark restore`" : "`forge db reset` and `forge db restore`";
  await confirm({
    verb: "migrate",
    what: `${run.home.database} (${place})`,
    detail: plan.pending.map((m) => m.name).join(", "),
    consequence: `Migrations are forward-only; the undo is ${undo}.`,
    yes: run.yes,
    print: confirmPrinter(run),
    cancelMessage: "Migration cancelled; the database is unchanged.",
  });
}

/** The drift refusal, naming each applied migration whose file is no longer on disk. */
function refuseDrift(run: DbRunContext, drift: readonly string[]): never {
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) has applied migrations that are no longer on disk:\n  ${drift.join("\n  ")}\nRestore the file from version control, or reset the database; forge will not apply over an unknown history.`,
  );
}

/** Refuses an applied migration whose file no longer hashes to what forge recorded when it ran. */
function refuseEditedHistory(run: DbRunContext, mismatched: readonly string[]): void {
  if (mismatched.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) has applied migrations whose files were edited after they were applied:\n  ${mismatched.join("\n  ")}\nRestore each file from version control to the bytes _forge_migrations recorded, or reset the database; forge will not apply over an edited history.`,
  );
}

/** Refuses a pending generated migration whose stamp names a different history than the files before it; one already applied only warns. */
function checkStamps(run: DbRunContext, discovered: readonly Migration[], pending: readonly Migration[], applied: ReadonlySet<string>): void {
  const pendingNames = new Set(pending.map((m) => m.name));
  const refused: { name: string; detail: string }[] = [];
  discovered.forEach((migration, index) => {
    if (migration.origin !== "generated" || migration.stamp === null || migration.stamp.baseline === "") return;
    const digest = migrationsDigest(discovered.slice(0, index));
    if (digest === migration.stamp.baseline) return;
    const detail = `${migration.name} (stamped ${migration.stamp.baseline.slice(0, 12)}, on disk ${digest.slice(0, 12)})`;
    if (pendingNames.has(migration.name)) refused.push({ name: migration.name, detail });
    else if (applied.has(migration.name)) {
      run.io.log(`warning: ${detail} was composed against a different migration history than is now on disk, and is already applied here`);
    }
  });
  const first = refused[0];
  if (first === undefined) return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}): ${refused.length} pending generated migration(s) were composed against a different migration history than is now on disk:\n  ${refused.map((r) => r.detail).join("\n  ")}\nCompose again, or once the files before it are correct, restamp with \`forge db migrate compose --restamp ${first.name}\`.`,
  );
}

/** Reads what the target records about itself, one tolerant read each, so a database forge has never migrated answers too. @internal */
export function readTargetFacts(io: DbIo, home: Home): TargetFacts {
  return {
    recorded: toRecordedChecksums(queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT) ?? []),
    inventory: toSchemaObjects(queryRows(io, home, INVENTORY_SELECT)),
  };
}

/** Checks the history against what forge recorded and applies every pending migration under a lock, each with its own history row. @public */
export async function runMigrate(run: DbRunContext, options: MigrateOptions): Promise<MigrateOutcome> {
  const { config, home, io } = run;
  const remote = isRemotePlace(config.target.place);
  if (!options.lint && remote) {
    throw new CliError("invalid-args", "--no-lint is local-only; on a deployed target use --allow-warnings to accept warnings.");
  }
  const say = (line: string) => {
    if (!run.json) run.print(line);
  };

  const discovered = readMigrations(run);

  // Taken before the first read and against the app's own home, because `lock.ts` keys on
  // `home.dir` and a lock under `.forge/scratch/` would exclude nothing. A dry run takes none.
  const release = options.dryRun ? () => {} : acquireApplyLock(io, home);
  try {
    const facts = readTargetFacts(io, home);
    const applied = facts.recorded.map((record) => record.appliedName);

    const plan = planApply({ discovered, applied, ...(options.to === undefined ? {} : { to: options.to }) });
    if (plan.drift.length > 0) refuseDrift(run, plan.drift);
    refuseEditedHistory(run, compareChecksums(facts.recorded, discovered));
    const drift = schemaDrift(facts.recorded, facts.inventory);
    const actualFingerprint = drift.actual;
    refuseSchemaDrift(run, drift, options.allowDrift, "pass --allow-drift to apply anyway; the apply certifies the fingerprint again.");
    checkStamps(run, discovered, plan.pending, new Set(applied));

    // Only the pending files are linted, so a rule added since an old apply cannot newly abort every
    // one. `--no-lint` judges the SQL; `generated-edited` and `custom-ddl` judge the file itself —
    // whether it is the one compose wrote, and whether its DDL came from a declaration at all — so
    // both run regardless. Skipping `custom-ddl` would let an object no schema.sql declares into the
    // database, which a later compose reads as a deletion.
    const unskippable = new Set(["generated-edited", "custom-ddl"]);
    const findings = lintMigrations(plan.pending);
    enforceLint(run, options.lint ? findings : findings.filter((f) => unskippable.has(f.rule)), options.allowWarnings);

    const skipped = plan.skipped.map((m) => m.name);
    const names = plan.pending.map((m) => m.name);

    // Before the confirmation: a rehearsal that fails leaves the target untouched, and there is
    // nothing to ask about until the migrations are known to apply to rows like its own.
    let rehearsed: RehearsalOutcome | undefined;
    if (options.rehearse && plan.pending.length > 0 && !options.dryRun) {
      rehearsed = rehearseMigrations(run, plan.pending, options.artifact, applied);
      say(`rehearsal ✓ ${rehearsed.applied.length} migration(s) over ${rehearsed.rows} row(s) restored from ${rehearsed.artifact}`);
    }

    if (options.dryRun) {
      const would =
        names.length === 0
          ? `${home.database} (${config.target.place}) is up to date`
          : `would apply ${names.length} to ${home.database} (${config.target.place}): ${names.join(", ")}`;
      say(would);
      if (options.rehearse && names.length > 0) say("--rehearse restores an artifact and applies to it, so a dry run does not rehearse");
      return { applied: [], skipped, dryRun: true };
    }

    if (plan.pending.length === 0) {
      ensureCompanionTables(io, home);
      if (options.allowDrift && drift.recorded !== actualFingerprint) {
        // The fingerprint rides on the last applied row, so with none applied there is nothing to certify it on.
        if (applied.length === 0)
          say(`${actualFingerprint} was not certified — no migration is applied, and the fingerprint rides on the last one`);
        else {
          executeSql(io, home, certifyFingerprintSql(actualFingerprint));
          say(`certified the schema fingerprint as ${actualFingerprint}`);
        }
      }
      say(`${home.database} (${config.target.place}) is up to date — ${applied.length} migration(s) applied`);
      return { applied: [], skipped, dryRun: false };
    }

    await confirmApply(run, plan, remote && options.bookmark);

    let bookmark: Bookmark | undefined;
    try {
      if (remote && options.bookmark) {
        bookmark = timeTravelInfo(io, home, undefined, config);
        say(`undo: ${bookmark.restoreCommand}`);
      }

      applyMigrations(run, home, plan.pending, { label: "migrate", record: true });

      const inventory = toSchemaObjects(queryRows(io, home, INVENTORY_SELECT));
      executeSql(io, home, certifyFingerprintSql(schemaFingerprint(inventory)));

      return {
        applied: names,
        skipped,
        ...(bookmark === undefined ? {} : { bookmark }),
        ...(rehearsed === undefined ? {} : { rehearsed }),
        dryRun: false,
      };
    } catch (error) {
      if (bookmark !== undefined) say(`the database may be part-migrated — undo with: ${bookmark.restoreCommand}`);
      throw error;
    }
  } finally {
    release();
  }
}
