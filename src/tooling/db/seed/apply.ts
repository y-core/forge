import { join } from "node:path";

import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import { timeTravelInfo } from "../bookmark";
import { confirmPrinter } from "../context";
import { declaredPath, declaredSeeds } from "../declared";
import { readDrift, refuseSchemaDrift } from "../drift";
import { RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "../migrate/checksum";
import { ensureCompanionTables } from "../migrate/companions";
import { readMigrations } from "../migrate/files";
import { formatLintFinding } from "../migrate/lint";
import { acquireApplyLock } from "../migrate/lock";
import { planApply } from "../migrate/plan";
import { applyRecordedSql } from "../recorded";
import { quoteSqlLiteral } from "../sql";
import { isRemotePlace } from "../target";
import type { Bookmark, DbRunContext, LintFinding, Seed, SeedOutcome, SeedPlan, SeedRecord } from "../types";
import { executeSql, queryRowsIfTable } from "../wrangler";
import { discoverSeeds, expandSeedEnv } from "./files";
import { lintSeed, lintSeeds } from "./lint";
import { planSeeds, recordSeedSql } from "./plan";

function readSeedHistory(run: DbRunContext): SeedRecord[] {
  const rows = queryRowsIfTable(run.io, run.home, "SELECT source, name, sha256, applied_at FROM _forge_seed_history ORDER BY source, name");
  if (rows === null) return [];
  return rows.map((row) => ({
    source: String(row.source ?? ""),
    name: String(row.name),
    sha256: String(row.sha256),
    appliedAt: Number(row.applied_at),
  }));
}

/** Every seed on disk: each declared directory's, in the order `config/db.ts` names them, with `--dir` overriding the lot. @public */
export function readSeeds(run: DbRunContext, dir?: string | undefined): readonly Seed[] {
  const sources = dir === undefined ? declaredSeeds(run) : [declaredPath(run.config.root, dir)];
  return sources.flatMap((source) => discoverSeeds(run.io, source));
}

function refusePendingMigrations(run: DbRunContext): void {
  const recorded = toRecordedChecksums(queryRowsIfTable(run.io, run.home, RECORDED_CHECKSUM_SELECT) ?? []);
  const plan = planApply({ discovered: readMigrations(run), applied: recorded.map((record) => record.appliedName) });
  if (plan.pending.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) has ${plan.pending.length} pending migration(s): ${plan.pending.map((m) => m.name).join(", ")}. Run \`forge db migrate\` first, or pass --allow-pending to seed the older schema anyway.`,
  );
}

const seedName = (seed: Seed) => `${seed.source}:${seed.name}`;

const findingKey = (finding: LintFinding) => `${finding.file}:${finding.line}:${finding.rule}`;

function seedFindings(seeds: readonly Seed[], expanded: ReadonlyMap<Seed, string>): LintFinding[] {
  const written = lintSeeds(seeds);
  const seen = new Set(written.map(findingKey));
  const substituted = seeds.flatMap((seed) => lintSeed(seed.path, expanded.get(seed) ?? seed.sql));
  return [...written, ...substituted.filter((finding) => !seen.has(findingKey(finding)))];
}

function enforceSeedLint(run: DbRunContext, findings: readonly LintFinding[], allowWarnings: boolean): void {
  const warnings = findings.filter((f) => f.level === "warning");
  if (warnings.length === 0) return;
  if (isRemotePlace(run.config.target.place) && !allowWarnings) {
    throw new CliError(
      "invalid-args",
      `${warnings.length} lint warning(s) against ${run.config.target.place}. Read them, then pass --allow-warnings to seed anyway:\n${warnings.map(formatLintFinding).join("\n")}`,
    );
  }
  for (const warning of warnings) run.io.log(formatLintFinding(warning));
}

async function confirmSeed(run: DbRunContext, plan: SeedPlan): Promise<void> {
  const place = run.config.target.place;
  await confirm({
    verb: "seed",
    what: `${run.home.database} (${place})`,
    detail: plan.apply.map(seedName).join(", "),
    consequence: "Seeds are ordinary SQL against a deployed database; the undo is `forge db bookmark restore`.",
    yes: run.yes,
    print: confirmPrinter(run),
    cancelMessage: "Seed cancelled; the database is unchanged.",
  });
}

/** Applies every seed that has not run, records each one, and refuses a changed seed unless `rerun` said so; a deployed run confirms, bookmarks, and refuses lint warnings. @internal */
export async function runSeedApply(
  run: DbRunContext,
  options: {
    dir?: string | undefined;
    only?: string | undefined;
    rerun: boolean;
    allowPending: boolean;
    allowDrift: boolean;
    allowWarnings: boolean;
    bookmark: boolean;
  },
): Promise<SeedOutcome> {
  if (!options.allowPending) refusePendingMigrations(run);
  // A seed writes rows into whatever schema is there. Held before the lint and the confirmation, so a
  // schema nothing explains stops the run with nothing written rather than halfway through the set.
  refuseSchemaDrift(
    run,
    readDrift(run.io, run.home),
    options.allowDrift,
    "pass --allow-drift to seed anyway; a seed certifies no fingerprint, so `forge db migrate` goes on refusing until an apply explains the schema.",
  );
  const remote = isRemotePlace(run.config.target.place);
  const say = run.json ? (line: string) => run.io.log(line) : run.print;
  const seeds = readSeeds(run, options.dir);
  const plan = planSeeds(seeds, readSeedHistory(run), { only: options.only, rerun: options.rerun, place: run.config.target.place });
  for (const seed of plan.excluded) {
    run.io.log(
      `excluded from ${run.config.target.place}: ${seedName(seed)} — add \`-- forge:places ${run.config.target.place}\` on line 1 to include it`,
    );
  }
  // Every seed is expanded before anything is linted, asked, bookmarked or loaded, so a missing
  // variable refuses with nothing run and the rules see the SQL that will reach the database.
  const expanded = new Map(plan.apply.map((seed) => [seed, expandSeedEnv(seed.sql, run.io.env)]));
  enforceSeedLint(run, seedFindings(plan.apply, expanded), options.allowWarnings);
  if (remote && plan.apply.length > 0) await confirmSeed(run, plan);

  // Taken for every place, as `migrate` does: both verbs contend on one file under the checkout, and
  // rows a seed writes during a remote migration's table rebuild are lost with the table it drops.
  const release = acquireApplyLock(run.io, run.home, "seed");
  let bookmark: Bookmark | undefined;
  const applied: string[] = [];
  try {
    ensureCompanionTables(run.io, run.home);
    if (remote && plan.apply.length > 0 && options.bookmark) {
      bookmark = timeTravelInfo(run.io, run.home, undefined, run.config);
      say(`undo: ${bookmark.restoreCommand}`);
    }

    for (const seed of plan.apply) {
      applyRecordedSql(run, run.home, {
        label: join("seed", seed.source.replace(/[^A-Za-z0-9_-]+/g, "_")),
        name: seed.name,
        sql: expanded.get(seed) ?? seed.sql,
        record: recordSeedSql(seed, run.io.now().getTime()),
        // The expanded text holds whatever the environment held, so it does not outlive the load.
        remove: true,
      });
      applied.push(seedName(seed));
    }
  } catch (error) {
    if (bookmark !== undefined) say(`the database may be part-seeded — undo with: ${bookmark.restoreCommand}`);
    throw error;
  } finally {
    release();
  }

  const outcome: SeedOutcome = {
    applied,
    skipped: plan.skip.map(seedName),
    changed: plan.changed.map(seedName),
    excluded: plan.excluded.map(seedName),
    ...(bookmark === undefined ? {} : { bookmark }),
  };
  if (plan.changed.length > 0 && !options.rerun) {
    for (const seed of plan.changed)
      say(`changed ${seedName(seed)} — applied before and edited since; re-run it with --rerun --only ${seedName(seed)}`);
    throw new CliError(
      "invalid-args",
      `${plan.changed.length} seed(s) changed since they were applied and were not run. Re-run each with --rerun --only <dir>:<name>.`,
    );
  }
  return outcome;
}

/** Reads which seeds would run, which are already in, and which changed since they ran. @internal */
export function runSeedStatus(run: DbRunContext, options: { dir?: string | undefined }): SeedPlan {
  return planSeeds(readSeeds(run, options.dir), readSeedHistory(run), { rerun: false, place: run.config.target.place });
}

/** Forgets one directory's seed records, or every one, so the next apply runs them again. @internal */
export function runSeedReset(run: DbRunContext, source?: string | undefined): void {
  const release = acquireApplyLock(run.io, run.home, "seed");
  try {
    ensureCompanionTables(run.io, run.home);
    const where = source === undefined ? "" : ` WHERE source = ${quoteSqlLiteral(source)}`;
    executeSql(run.io, run.home, `DELETE FROM _forge_seed_history${where};`);
  } finally {
    release();
  }
}
