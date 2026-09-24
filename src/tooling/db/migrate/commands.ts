import { resolve } from "node:path";

import { addCommand, createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase, ResolvedFlags } from "../../cli/types";
import { sharedDbFlags, withDbRun } from "../context";
import { schemaDrift } from "../drift";
import { composeMigration } from "../schema/compose";
import { readSeeds } from "../seed/apply";
import { lintSeeds } from "../seed/lint";
import { formatTarget } from "../target";
import type { DbContextOverrides, DbRunContext, LintFinding, SharedDbFlags, StatusReport } from "../types";
import { readTargetFacts, runMigrate } from "./apply";
import { compareChecksums } from "./checksum";
import { readMigrations } from "./files";
import { formatLintFinding, lintMigration, lintMigrations } from "./lint";
import { migrationStatusExitCode, formatStatus, statusRows } from "./status";

const migrateFlags = {
  ...sharedDbFlags,
  "dry-run": { type: "boolean" as const, description: "Report what would be applied and change nothing" },
  to: { type: "string" as const, description: "Stop after this migration, named as its number or its full name" },
  "no-lint": { type: "boolean" as const, description: "Apply without checking the pending migrations for destructive SQL first" },
  "allow-warnings": { type: "boolean" as const, description: "Apply to a deployed database despite lint warnings, which otherwise abort" },
  "allow-drift": {
    type: "boolean" as const,
    description: "Apply although the schema was changed outside the migrations; the apply re-records the fingerprint",
  },
  "no-bookmark": { type: "boolean" as const, description: "Skip the Time Travel bookmark a deployed apply captures as its undo" },
  rehearse: {
    type: "boolean" as const,
    description: "Apply to a copy restored from a backup artifact first, and report, before touching the target",
  },
  artifact: {
    type: "string" as const,
    description: "The artifact --rehearse restores; implies --rehearse, and defaults to the most recent verified backup of this database",
  },
};

/** What `db migrate apply` does, which the bare `db migrate` runs too. */
async function applyMigrations(
  flags: ResolvedFlags<typeof migrateFlags>,
  ctx: CliContext | undefined,
  overrides: DbContextOverrides,
): Promise<void> {
  return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
    const outcome = await runMigrate(run, {
      dryRun: Boolean(flags["dry-run"]),
      ...(flags.to === undefined ? {} : { to: flags.to }),
      lint: !flags["no-lint"],
      allowWarnings: Boolean(flags["allow-warnings"]),
      allowDrift: Boolean(flags["allow-drift"]),
      bookmark: !flags["no-bookmark"],
      rehearse: Boolean(flags.rehearse) || flags.artifact !== undefined,
      ...(flags.artifact === undefined ? {} : { artifact: flags.artifact }),
    });

    if (run.json) {
      run.print(JSON.stringify({ target: formatTarget(run.config.target), database: run.home.database, ...outcome }));
      return;
    }
    if (outcome.rehearsed !== undefined) {
      run.print(`rehearsed on ${outcome.rehearsed.rows} row(s) from ${outcome.rehearsed.artifact}`);
    }
    if (outcome.applied.length > 0) run.print(`applied ${outcome.applied.length}: ${outcome.applied.join(", ")}`);
    if (outcome.skipped.length > 0) run.print(`left for a later run: ${outcome.skipped.join(", ")}`);
  });
}

/** The `forge db migrate apply` verb: forward-only, linted, checksummed, and locked while it runs. */
function createApplyCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "apply",
    description: "Apply every pending migration to the target database, recording a checksum and a schema fingerprint for each",
    flags: migrateFlags,
    run: (_args, flags, ctx?: CliContext) => applyMigrations(flags, ctx, overrides),
  });
}

/** The `forge db migrate compose` verb, which writes the next file: composed from the desired state, or a custom stub. */
function createComposeCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "compose",
    description:
      "Write the app's next migration from the difference between the migrations on disk and every declared schema.sql, proving it on a replay first",
    args: { kind: "max", max: 1 },
    flags: {
      ...sharedDbFlags,
      custom: {
        type: "boolean" as const,
        description: "Write a hand-edited migration stub instead — for a data move compose cannot express. Needs a name",
      },
      "dry-run": { type: "boolean" as const, description: "Print the plan and the SQL, and write nothing" },
      "allow-destructive": {
        type: "string" as const,
        description: "Compose a change that drops a table or a column: the digest the refusal printed, so the approval is for that plan alone",
      },
      rename: {
        type: "string" as const,
        multiple: true,
        description: "`old:new` renames a table, `table.old:new` a column; repeatable. Never inferred",
      },
      "no-cache": { type: "boolean" as const, description: "Replay into the scratch database even when a cached model matches" },
      restamp: {
        type: "string" as const,
        description: "Rewrite a generated migration's stamp to the history now on disk, leaving its body untouched",
      },
    },
    run: async (args, flags, ctx?: CliContext) => {
      return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
        const outcome = await composeMigration(run, {
          name: args[0],
          custom: Boolean(flags.custom),
          dryRun: Boolean(flags["dry-run"]),
          allowDestructive: flags["allow-destructive"],
          renames: flags.rename ?? [],
          cache: !flags["no-cache"],
          restamp: flags.restamp,
        });
        if (run.json) run.print(JSON.stringify(outcome));
        else if (outcome.dryRun && outcome.sql !== "") run.print(outcome.sql);
        else if (outcome.path !== null && outcome.plan[0]?.startsWith("custom migration"))
          run.print(`wrote ${outcome.path} — fill it in, then \`forge db lint\``);
      });
    },
  });
}

/** Measures the target database against the migrations on disk. */
async function readStatusReport(run: DbRunContext): Promise<StatusReport> {
  const { config, home, io } = run;
  const discovered = readMigrations(run);
  const { recorded, inventory } = await readTargetFacts(io, home);
  const drift = schemaDrift(recorded, inventory);

  const applied = recorded.map((record) => ({ name: record.appliedName, appliedAt: new Date(record.appliedAt).toISOString() }));
  const mismatched = compareChecksums(recorded, discovered);
  const all = statusRows({ discovered, applied, mismatched });

  return {
    target: formatTarget(config.target),
    database: home.database,
    rows: all,
    pending: all.filter((row) => row.state === "pending").length,
    checksums: { mismatched },
    drift: all.filter((row) => row.state === "drift").map((row) => row.name),
    fingerprint: { recorded: drift.recorded, actual: drift.actual, matches: drift.state !== "mismatch" },
  };
}

/** The `forge db migrate status` verb, whose `--check` is the CI gate. */
function createStatusCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "status",
    description: "Report which migrations are applied, which are pending, and where the database and the files disagree",
    flags: { ...sharedDbFlags, check: { type: "boolean" as const, description: "Exit non-zero when anything is pending or out of step. For CI" } },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
        const report = await readStatusReport(run);
        run.print(run.json ? JSON.stringify(report) : formatStatus(report, run.style));
        if (flags.check && migrationStatusExitCode(report) === 1) {
          throw new CliError("invalid-args", `${report.database} (${report.target}) is not in step with its migrations — see the report above.`);
        }
      });
    },
  });
}

/** The `forge db lint` verb, over named files or over the migrations directory. */
function createLintCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "lint",
    description: "Check migrations for SQL that is destructive, unbounded, unbackupable, or that D1 refuses",
    args: { kind: "min", min: 0 },
    flags: {
      ...sharedDbFlags,
      strict: { type: "boolean" as const, description: "Fail on a warning as well as on an error" },
      dir: { type: "string" as const, description: "With --seeds: check just this directory's seeds" },
      seeds: {
        type: "boolean" as const,
        description: "Check the seeds instead: an INSERT that is not safe to run twice, and the destructive rules at warning level",
      },
    },
    run: async (args, flags, ctx?: CliContext) => {
      return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
        const wanted = flags.dir;
        const findings: LintFinding[] =
          args.length > 0
            ? args.flatMap((file) => {
                const path = resolve(run.config.root, file);
                return lintMigration(path, run.io.readText(path));
              })
            : flags.seeds
              ? lintSeeds(readSeeds(run, wanted))
              : lintMigrations(readMigrations(run));

        const errors = findings.filter((f) => f.level === "error").length;
        const warnings = findings.length - errors;

        if (run.json) run.print(JSON.stringify({ findings, errors, warnings }));
        else if (findings.length === 0) run.print("no findings");
        else for (const finding of findings) run.print(formatLintFinding(finding));

        if (errors > 0 || (Boolean(flags.strict) && warnings > 0)) {
          throw new CliError(
            "invalid-args",
            `lint found ${errors} error(s) and ${warnings} warning(s)${flags.strict ? ", and --strict fails on both" : ""}.`,
          );
        }
      });
    },
  });
}

/** The `forge db migrate` group: its three verbs, and `apply` again as the group's own run, so the bare verb still applies. */
function createMigrateCommand(overrides: DbContextOverrides): CommandBase {
  const migrate = createCommand({
    name: "migrate",
    description: "Compose migrations from the declared schema, apply them forward-only, and report where the files and the database disagree",
    flags: migrateFlags,
    run: (_args, flags, ctx?: CliContext) => applyMigrations(flags, ctx, overrides),
  });
  addCommand(migrate, createApplyCommand(overrides));
  addCommand(migrate, createComposeCommand(overrides));
  addCommand(migrate, createStatusCommand(overrides));
  return migrate;
}

/** The `forge db` verbs this directory owns. @internal */
export function createMigrateCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  return [createMigrateCommand(overrides), createLintCommand(overrides)];
}
