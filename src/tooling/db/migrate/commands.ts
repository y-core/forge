import { addCommand, createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase, ResolvedFlags } from "../../cli/types";
import { sharedDbFlags, withDbRun } from "../context";
import { composeMigration } from "../schema/compose";
import { readSeeds } from "../seed/apply";
import { lintSeeds } from "../seed/lint";
import { formatTarget } from "../target";
import type { DbContextOverrides, LintFinding, SharedDbFlags } from "../types";
import { formatMigrationChange } from "./analysis";
import { lintPendingMigrations, runMigrate } from "./apply";
import { formatLintFinding } from "./lint";
import { formatStatus, migrationStatusExitCode, readStatusReport } from "./status";

const migrateFlags = {
  ...sharedDbFlags,
  "dry-run": { type: "boolean" as const, description: "Report what would be applied and change nothing" },
  to: { type: "string" as const, description: "Stop after this migration, named as its number or its full name" },
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

/** The `forge db migrate compose` verb, which writes the next file composed from the desired state. */
function createComposeCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "compose",
    description:
      "Write the app's next migration from the difference between the migrations on disk and every declared schema.sql, proving it on a replay first",
    args: { kind: "max", max: 1 },
    flags: {
      ...sharedDbFlags,
      "dry-run": { type: "boolean" as const, description: "Print the plan and the SQL, and write nothing" },
      "allow-destructive": {
        type: "string" as const,
        description:
          "Compose a change that drops a table, a column or a view, or renames one: the digest the refusal printed, so the approval is for that plan alone",
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
          dryRun: Boolean(flags["dry-run"]),
          allowDestructive: flags["allow-destructive"],
          renames: flags.rename ?? [],
          cache: !flags["no-cache"],
          restamp: flags.restamp,
        });
        if (run.json) run.print(JSON.stringify(outcome));
        else if (outcome.dryRun && outcome.sql !== "") run.print(outcome.sql);
      });
    },
  });
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

/** The `forge db lint` verb, over the migrations the target does not hold yet, or over the seeds. */
function createLintCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "lint",
    description:
      "Check the migrations the target does not hold yet — the stamp, the lint rules, and every drop or rename against the target's schema — or, with --seeds, the seeds",
    flags: {
      ...sharedDbFlags,
      dir: { type: "string" as const, description: "With --seeds: check just this directory's seeds" },
      seeds: {
        type: "boolean" as const,
        description: "Check the seeds instead: an INSERT that is not safe to run twice, and the destructive rules",
      },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
        if (flags.seeds) {
          const findings: LintFinding[] = lintSeeds(readSeeds(run, flags.dir));
          if (run.json) run.print(JSON.stringify({ findings }));
          else if (findings.length === 0) run.print("no findings");
          else for (const finding of findings) run.print(formatLintFinding(finding));
          if (findings.length > 0) throw new CliError("invalid-args", `lint found ${findings.length} finding(s) in the seeds.`);
          return;
        }

        const { database } = run.home;
        const place = run.config.target.place;
        const { pending, findings, approved } = await lintPendingMigrations(run);
        if (run.json) {
          run.print(JSON.stringify({ target: formatTarget(run.config.target), database, pending, findings, approved }));
        } else {
          if (findings.length === 0) run.print(`${pending.length} pending migration(s) on ${database} (${place}) — no findings`);
          else for (const finding of findings) run.print(formatLintFinding(finding));
          for (const finding of approved) run.print(`approved ${finding.migration}: ${formatMigrationChange(finding.change)}`);
        }
        if (findings.length > 0) {
          throw new CliError(
            "invalid-args",
            `lint found ${findings.length} finding(s) in the migrations ${database} (${place}) does not hold yet.`,
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
