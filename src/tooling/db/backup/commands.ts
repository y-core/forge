import { createCommand } from "../../cli/command";
import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase } from "../../cli/types";
import { confirmPrinter, sharedDbFlags, withDbRun } from "../context";
import type { DbContextOverrides, RestoreRoute, SharedDbFlags } from "../types";
import { runBackup } from "./backup";
import { executeReset, prepareReset } from "./reset";
import { executeRestore, prepareRestore } from "./restore";

function readRoute(value: unknown): RestoreRoute {
  if (value === "full" || value === "migrations") return value;
  throw new CliError("invalid-args", `--route ${String(value)} is not a route — use full (the artifact's own schema, then its rows) or migrations`);
}

/** The `forge db` verbs this directory owns: backup, restore and reset. @internal */
export function createBackupCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  const backup = createCommand({
    name: "backup",
    description: "Write a verified backup artifact, proving by both restore routes that it rebuilds",
    flags: {
      ...sharedDbFlags,
      out: {
        type: "string" as const,
        description: "Directory the artifact is created in. Defaults to the host config's backupsDir, else .forge/backups",
      },
      "no-verify": { type: "boolean" as const, description: "Skip the rebuild proof. The artifact records that nothing about it was proven" },
      label: { type: "string" as const, description: "A note recorded in the manifest, for saying what this backup was taken before" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const outcome = await runBackup(run, { out: flags.out ?? null, verify: flags["no-verify"] !== true, label: flags.label ?? null });
        if (run.json) run.print(JSON.stringify({ directory: outcome.directory, manifest: outcome.manifest }));
        else {
          run.print(`✓ ${outcome.directory}`);
          for (const route of outcome.manifest.verified) run.print(`  route ${route.route}: ${route.divergent} divergent`);
          for (const warning of outcome.manifest.warnings) run.print(`  ! ${warning}`);
        }
      });
    },
  });

  const restore = createCommand({
    name: "restore",
    description: "Load one backup artifact into an empty database. Asks first",
    flags: {
      ...sharedDbFlags,
      artifact: { type: "string" as const, required: true, description: "The artifact directory holding manifest.json" },
      route: {
        type: "string" as const,
        default: "migrations",
        description: "full loads the artifact's schema then its rows; migrations applies the migrations directory then loads data",
      },
      expect: { type: "string" as const, description: "The database name the artifact must have been taken from" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const route = readRoute(flags.route);
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const plan = await prepareRestore(run, { artifact: flags.artifact, route, expect: flags.expect });
        await confirm({
          verb: "restore",
          what: `${plan.artifact} into ${run.home.database} (${run.config.target.place}) by route ${route}`,
          detail: `${plan.rows} row(s) across ${plan.expectedTables.length} table(s), artifact verified`,
          consequence: "A restore adds rows and never removes them, so the target must already be empty and a partial load has no repair path.",
          yes: run.yes,
          print: confirmPrinter(run),
          cancelMessage: "Restore cancelled; the database is unchanged.",
        });
        const outcome = await executeRestore(run, plan);
        if (run.json) run.print(JSON.stringify(outcome));
        else {
          for (const table of outcome.tables) run.print(`  ${table.matches ? "✓" : "✗"} ${table.name} — ${table.rows} rows`);
          run.print(`✓ ${outcome.database} matches the manifest in ${outcome.artifact}`);
        }
      });
    },
  });

  const reset = createCommand({
    name: "reset",
    description: "Remove a local database's state files, so a restore has an empty target. Asks first",
    flags: {
      ...sharedDbFlags,
      expect: {
        type: "string" as const,
        required: true,
        description: "The database name this target must have, so a stale --target cannot aim the reset",
      },
      backup: {
        type: "string" as const,
        description: "The artifact this reset relies on; defaults to the most recent verified backup of this database",
      },
      "allow-unbacked": { type: "boolean" as const, description: "Empty a database that holds rows and has no verified backup" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const plan = await prepareReset(run, { expect: flags.expect, allowUnbacked: flags["allow-unbacked"] === true, backup: flags.backup });
        await confirm({
          verb: "reset",
          what: `${run.home.database} (${run.config.target.place})`,
          detail: `${plan.rows} row(s), ${plan.backedUpBy === null ? "no artifact relied on" : `backed up by ${plan.backedUpBy}`}`,
          consequence: "Its local state files are removed and miniflare recreates it empty. Nothing here restores them.",
          yes: run.yes,
          print: confirmPrinter(run),
          cancelMessage: "Reset cancelled; the database is unchanged.",
        });
        const outcome = await executeReset(run, plan);
        if (run.json) run.print(JSON.stringify(outcome));
        else if (outcome.removed === null) run.print(`✓ ${outcome.database} has no local state to remove`);
        else {
          if (outcome.backedUpBy !== null) run.print(`  backed up by ${outcome.backedUpBy}`);
          run.print(`✓ removed ${outcome.removed} (${outcome.rows} rows) — miniflare recreates it on next use`);
        }
      });
    },
  });

  return [backup, restore, reset];
}
