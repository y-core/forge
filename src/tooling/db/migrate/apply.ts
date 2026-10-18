import { D1_WRITE_PERMISSION } from "../../cf/api/endpoints";
import { wranglerAuthRefused } from "../../cf/api/errors";
import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import { timeTravelInfo } from "../bookmark";
import { wranglerHistoryTable } from "../config";
import { confirmPrinter } from "../context";
import { refuseSchemaDrift, schemaDrift } from "../drift";
import { sqlIdentifierEquals } from "../schema/normalize";
import { INVENTORY_SELECT, quoteSqlIdentifier, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { ApplyPlan, Bookmark, DbIo, DbRunContext, Home, LintFinding, Migration, WranglerHistory } from "../types";
import { executeSql, queryRows, queryRowsIfTable } from "../wrangler";
import { analyseMigrations, formatMigrationChange } from "./analysis";
import { applyMigrations } from "./applier";
import { certifyFingerprintSql, compareChecksums, RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "./checksum";
import { ensureCompanionTables } from "./companions";
import { migrationsDigest, readMigrations } from "./files";
import { schemaFingerprint } from "./fingerprint";
import { formatLintFinding, lintMigrations } from "./lint";
import { acquireApplyLock } from "./lock";
import { planApply } from "./plan";
import { rehearseMigrations } from "./rehearse";
import type { MigrateOptions, MigrateOutcome, MigrationFinding, PendingLintOutcome, RehearsalOutcome, TargetFacts } from "./types";

/** Aborts on any lint finding: every rule is an error. */
function enforceLint(run: DbRunContext, findings: readonly LintFinding[]): void {
  if (findings.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${findings.length} lint finding(s) in the pending migrations, so nothing was applied:\n${findings.map(formatLintFinding).join("\n")}`,
  );
}

/** Asks before migrating anything but the developer's own local database. */
async function confirmApply(run: DbRunContext, plan: ApplyPlan, bookmarked: boolean, findings: readonly MigrationFinding[]): Promise<void> {
  const place = run.config.target.place;
  if (place === "local") return;
  const undo = isRemotePlace(place) && bookmarked ? "`forge db bookmark restore`" : "`forge db reset` and `forge db restore`";
  await confirm({
    verb: "migrate",
    what: `${run.home.database} (${place})`,
    detail: plan.pending
      .map((m) => {
        const own = findings.filter((f) => f.migration === m.name);
        return own.length === 0 ? m.name : `${m.name} (${own.map((f) => formatMigrationChange(f.change)).join("; ")})`;
      })
      .join(", "),
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

/** Refuses a migration wrangler recorded against the target that forge never applied, naming the one fix the target's state allows. */
function refuseWranglerHistory(run: DbRunContext, history: WranglerHistory, forgeApplied: boolean): void {
  if (history.unapplied.length === 0) return;
  const place = run.config.target.place;
  const restore = isRemotePlace(place) ? "`forge db bookmark restore`" : "`forge db reset` and `forge db restore`";
  const fix = forgeApplied
    ? `Restore the database to a point before that run with ${restore}`
    : `Drop ${history.table} before bringing the database under forge`;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${place}) has migrations ${history.table} records that forge never applied — \`wrangler d1 migrations apply\` ran against it:\n  ${history.unapplied.join("\n  ")}\n${fix}; forge will not apply over a history it did not write.`,
  );
}

/** Refuses a pending migration compose did not write, or one edited since it did, before anything is applied. @internal */
export function refuseUncomposed(run: DbRunContext, pending: readonly Migration[]): void {
  const found = lintMigrations(pending).filter((f) => f.rule === "generated-edited");
  if (found.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) has ${found.length} pending migration(s) compose did not write, or that were edited after it wrote them, so nothing was applied:\n${found.map(formatLintFinding).join("\n")}`,
  );
}

/** Refuses a pending generated migration whose stamp names a different history than the files before it; one already applied only warns. */
function checkStamps(run: DbRunContext, discovered: readonly Migration[], pending: readonly Migration[], applied: ReadonlySet<string>): void {
  const pendingNames = new Set(pending.map((m) => m.name));
  const refused: { name: string; detail: string }[] = [];
  discovered.forEach((migration, index) => {
    if (migration.stamp === null || migration.stamp.baseline === "") return;
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
export async function readTargetFacts(io: DbIo, home: Home): Promise<TargetFacts> {
  return {
    recorded: toRecordedChecksums((await queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT)) ?? []),
    inventory: toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT)),
  };
}

/** The migrations the entry's wrangler history table records that forge never applied; read only when the target holds that table. @internal */
export async function readWranglerHistory(run: DbRunContext, facts: TargetFacts): Promise<WranglerHistory> {
  const table = wranglerHistoryTable(run.config);
  const held = facts.inventory.some((object) => object.type === "table" && sqlIdentifierEquals(object.name, table));
  if (!held) return { table, unapplied: [] };
  const rows = await queryRows(run.io, run.home, `SELECT name FROM ${quoteSqlIdentifier(table)} ORDER BY id`);
  const applied = new Set(facts.recorded.map((record) => record.appliedName));
  const unapplied = rows.map((row) => String(row.name ?? "").replace(/\.sql$/, "")).filter((name) => !applied.has(name));
  return { table, unapplied };
}

/** What `forge db lint` judges: the migrations the target does not hold yet, by the rules and then by the analysis. @internal */
export async function lintPendingMigrations(run: DbRunContext): Promise<PendingLintOutcome> {
  const facts = await readTargetFacts(run.io, run.home);
  const plan = planApply({ discovered: readMigrations(run), applied: facts.recorded.map((record) => record.appliedName) });
  const pending = plan.pending.map((migration) => migration.name);
  const findings = lintMigrations(plan.pending);
  if (findings.length > 0) return { pending, findings, approved: [] };
  return { pending, findings: [], approved: await analyseMigrations(run, plan.pending, facts.inventory) };
}

/** Checks the history against what forge recorded and applies every pending migration under a lock, each with its own history row. @public */
export async function runMigrate(run: DbRunContext, options: MigrateOptions): Promise<MigrateOutcome> {
  const { config, home, io } = run;
  const remote = isRemotePlace(config.target.place);
  const say = (line: string) => {
    if (!run.json) run.print(line);
  };

  const discovered = readMigrations(run);

  // Taken before the first read and against the app's own home, because `lock.ts` keys on
  // `home.dir` and a lock under `.forge/scratch/` would exclude nothing. A dry run takes none.
  const release = options.dryRun ? () => {} : acquireApplyLock(io, home);
  try {
    const facts = await readTargetFacts(io, home);
    const applied = facts.recorded.map((record) => record.appliedName);

    const plan = planApply({ discovered, applied, ...(options.to === undefined ? {} : { to: options.to }) });
    if (plan.drift.length > 0) refuseDrift(run, plan.drift);
    refuseEditedHistory(run, compareChecksums(facts.recorded, discovered));
    refuseWranglerHistory(run, await readWranglerHistory(run, facts), applied.length > 0);
    refuseUncomposed(run, plan.pending);
    const drift = schemaDrift(facts.recorded, facts.inventory);
    refuseSchemaDrift(run, drift);
    checkStamps(run, discovered, plan.pending, new Set(applied));

    enforceLint(run, lintMigrations(plan.pending));
    const findings = await analyseMigrations(run, plan.pending, facts.inventory);

    const skipped = plan.skipped.map((m) => m.name);
    const names = plan.pending.map((m) => m.name);

    // Before the confirmation: a rehearsal that fails leaves the target untouched, and there is
    // nothing to ask about until the migrations are known to apply to rows like its own.
    let rehearsed: RehearsalOutcome | undefined;
    if (options.rehearse && plan.pending.length > 0 && !options.dryRun) {
      rehearsed = await rehearseMigrations(run, plan.pending, options.artifact, applied);
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
      await ensureCompanionTables(io, home);
      // Never a mismatch: certifying one here would pass the drift refusal with no migration to explain it.
      if (drift.state === "unrecorded" && applied.length > 0) {
        await executeSql(io, home, certifyFingerprintSql(drift.actual));
        say(`certified the schema fingerprint as ${drift.actual}`);
      }
      say(`${home.database} (${config.target.place}) is up to date — ${applied.length} migration(s) applied`);
      return { applied: [], skipped, dryRun: false };
    }

    await confirmApply(run, plan, remote && options.bookmark, findings);
    await ensureCompanionTables(io, home).catch((error: unknown) => {
      throw refusedWrite(error, "Nothing was applied.");
    });

    let bookmark: Bookmark | undefined;
    try {
      if (remote && options.bookmark) {
        bookmark = timeTravelInfo(io, home, undefined, config);
        say(`undo: ${bookmark.restoreCommand}`);
      }

      await applyMigrations(run, home, plan.pending, { label: "migrate", record: true });

      const inventory = toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT));
      await executeSql(io, home, certifyFingerprintSql(schemaFingerprint(inventory)));

      return {
        applied: names,
        skipped,
        ...(bookmark === undefined ? {} : { bookmark }),
        ...(rehearsed === undefined ? {} : { rehearsed }),
        dryRun: false,
      };
    } catch (error) {
      if (bookmark !== undefined) say(`the database may be part-migrated — undo with: ${bookmark.restoreCommand}`);
      throw refusedWrite(error, "The migrations before the refused write may be applied.");
    }
  } finally {
    release();
  }
}

/** A wrangler auth refusal restated as the missing token permission, with what the run had applied by then; any other error unchanged. */
function refusedWrite(error: unknown, applied: string): unknown {
  if (!(error instanceof CliError) || !wranglerAuthRefused(error.message)) return error;
  return new CliError("invalid-args", `the API token cannot write D1 — add ${D1_WRITE_PERMISSION} to it, then run again. ${applied}`, {
    cause: error,
  });
}
