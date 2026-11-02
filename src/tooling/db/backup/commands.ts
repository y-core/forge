import { addCommand, createCommand } from "../../cli/command";
import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase } from "../../cli/types";
import { confirmPrinter, sharedDbFlags, withDbRun } from "../context";
import { isRemotePlace } from "../target";
import type { DbContextOverrides, SharedDbFlags } from "../types";
import { listDumps, pullDump, pushDump } from "./copy";
import { dumpDatabaseId, resolveDumpSource } from "./dumps";
import { describePromotion, executePromotion, preparePromotion } from "./promote";
import { executeReset, prepareReset } from "./reset";
import { BACKUP_WORKFLOW, describeRestore, describeSidecar, followWorkflow, RESTORE_WORKFLOW } from "./workflow";

function readPort(value: string | undefined): number {
  if (value === undefined) return 8787;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65_535) throw new CliError("invalid-args", `--port takes a TCP port, not ${value}`);
  return Number(value);
}

function readInto(value: string | undefined): string | null {
  if (value === undefined || value === "fresh") return null;
  const standby = /^standby:(.+)$/.exec(value)?.[1];
  if (standby === undefined) throw new CliError("invalid-args", `--into takes fresh or standby:<id>, not ${value}`);
  return standby;
}

const bucketFlag = {
  bucket: { type: "string" as const, description: "The R2 binding the dumps are in. Defaults to BACKUPS, or the config's only one" },
};

const dumpFlags = { ...bucketFlag, prefix: { type: "string" as const, description: "The prefix runD1Backup was given. Defaults to d1-backups" } };

const workflowFlags = {
  workflow: {
    type: "string" as const,
    description: "The Workflow to start, by name or binding. Defaults to its conventional name, or the config's only one",
  },
  port: { type: "string" as const, description: "Against a local database: the port `forge cf dev` serves on. Defaults to 8787" },
};

/** The `forge db` verbs this directory owns: backup, restore, reset and promote. @internal */
export function createBackupCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  const backup = createCommand({
    name: "backup",
    description: "Run the app's d1-backup Workflow, which stores D1's dump and its sidecar in R2, and report what it stored",
    flags: { ...sharedDbFlags, ...workflowFlags },
    run: async (_args, flags, ctx?: CliContext) => {
      const port = readPort(flags.port);
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const { instance, output: sidecar } = await followWorkflow(run, BACKUP_WORKFLOW, { workflow: flags.workflow, port, params: {} });
        const expected = dumpDatabaseId(run);
        if (sidecar.databaseId !== expected) {
          throw new CliError(
            "external",
            `${instance} dumped database ${sidecar.databaseId}, not ${run.home.database} (${expected}) — the Workflow is wired to another database, so ${run.home.database} is not backed up`,
          );
        }
        if (run.json) run.print(JSON.stringify({ instance, sidecar }));
        else for (const line of describeSidecar(sidecar)) run.print(line);
      });
    },
  });

  addCommand(
    backup,
    createCommand({
      name: "list",
      description: "List the database's dumps in R2, newest first, each with its size, when it was taken, and whether its sidecar was written",
      flags: { ...sharedDbFlags, ...dumpFlags },
      run: async (_args, flags, ctx?: CliContext) => {
        return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
          const source = resolveDumpSource(run, flags);
          const records = await listDumps(run, source);
          if (run.json) return run.print(JSON.stringify(records));
          if (records.length === 0)
            return run.print(`no dump of ${run.home.database} under ${source.binding}:${source.prefix}/${source.databaseId}/`);
          for (const record of records) {
            run.print(`${record.key}  ${record.size} bytes  ${record.takenAt}  ${record.complete ? "complete" : "incomplete — no sidecar"}`);
          }
        });
      },
    }),
  );

  addCommand(
    backup,
    createCommand({
      name: "pull",
      description: "Copy one R2 dump and its sidecar to disk, refusing the copy unless its sha256 and size match the sidecar",
      args: { kind: "exact", count: 1 },
      flags: {
        ...sharedDbFlags,
        ...bucketFlag,
        out: { type: "string" as const, description: "The directory the dump and its sidecar are written to. Defaults to the current one" },
      },
      run: async ([key = ""], flags, ctx?: CliContext) => {
        return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
          const copy = await pullDump(run, resolveDumpSource(run, flags), key, flags.out ?? ".");
          if (run.json) run.print(JSON.stringify(copy));
          else run.print(`✓ pulled ${copy.key} to ${copy.path} (${copy.size} bytes, sha256 ${copy.sha256}), its sidecar to ${copy.sidecar}`);
        });
      },
    }),
  );

  addCommand(
    backup,
    createCommand({
      name: "push",
      description: "Upload a pulled dump and its sidecar back to R2 under the dump's own key, checked by sha256. Never replaces an object",
      args: { kind: "exact", count: 1 },
      flags: { ...sharedDbFlags, ...bucketFlag },
      run: async ([file = ""], flags, ctx?: CliContext) => {
        return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
          const copy = await pushDump(run, resolveDumpSource(run, flags), file);
          if (run.json) run.print(JSON.stringify(copy));
          else run.print(`✓ pushed ${copy.path} to ${copy.key} (${copy.size} bytes, sha256 ${copy.sha256}), its sidecar beside it`);
        });
      },
    }),
  );

  const restore = createCommand({
    name: "restore",
    description: "Run the app's d1-restore Workflow on one R2 dump, importing it into a new or empty database, and report every mismatch",
    flags: {
      ...sharedDbFlags,
      ...workflowFlags,
      from: { type: "string" as const, required: true, description: "The R2 dump's key" },
      into: {
        type: "string" as const,
        description: "fresh (default) has the Workflow create a database; standby:<id> imports into an empty one — the only choice locally",
      },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const into = readInto(flags.into);
      const port = readPort(flags.port);
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        if (into === null && !isRemotePlace(run.config.target.place)) {
          throw new CliError("invalid-args", "a dev session cannot create a database — pass --into standby:<id> to import into an empty standby");
        }
        const params = into === null ? { key: flags.from } : { key: flags.from, standby: into };
        const { instance, output: report } = await followWorkflow(run, RESTORE_WORKFLOW, { workflow: flags.workflow, port, params });
        if (run.json) run.print(JSON.stringify({ instance, report }));
        else for (const line of describeRestore(report)) run.print(line);
        if (report.mismatches.length > 0)
          throw new CliError("external", `${report.name} differs from the dump's sidecar; the live database is untouched`);
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
      dump: { type: "string" as const, description: "The R2 dump this reset relies on; defaults to the newest complete dump of this database" },
      ...dumpFlags,
      "allow-unbacked": { type: "boolean" as const, description: "Empty a database that holds rows and has no verified backup" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const plan = await prepareReset(run, {
          expect: flags.expect,
          allowUnbacked: flags["allow-unbacked"] === true,
          dump: flags.dump,
          bucket: flags.bucket,
          prefix: flags.prefix,
        });
        await confirm({
          verb: "reset",
          what: `${run.home.database} (${run.config.target.place})`,
          detail: `${plan.rows} row(s), ${plan.backedUpBy === null ? "no dump relied on" : `backed up by ${plan.backedUpBy}`}`,
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

  const promote = createCommand({
    name: "promote",
    description: "Point the deployed app's D1 binding at a restored database, keeping the old one. Asks first, then leaves the deploy to you",
    flags: {
      ...sharedDbFlags,
      instance: {
        type: "string" as const,
        description: "The d1-restore instance whose report names the restored database; it must show no mismatch",
      },
      workflow: { type: "string" as const, description: "With --instance: the restore Workflow, by name or binding. Defaults to d1-restore" },
      "database-id": {
        type: "string" as const,
        description: "With --database-name: point the binding at this database instead, as a swap back does",
      },
      "database-name": { type: "string" as const, description: "With --database-id: that database's name" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const plan = await preparePromotion(run, {
          instance: flags.instance,
          workflow: flags.workflow,
          databaseId: flags["database-id"],
          databaseName: flags["database-name"],
        });
        await confirm({
          verb: "promote",
          what: `${plan.binding} in ${plan.configPath} from ${plan.from.name} (${plan.from.databaseId}) to ${plan.to.name} (${plan.to.databaseId})`,
          detail: `${plan.from.name} is kept as it was, as the fallback`,
          consequence: "Once you deploy, every request reads the restored database.",
          yes: run.yes,
          print: confirmPrinter(run),
          cancelMessage: "Promotion cancelled; the config is unchanged.",
        });
        executePromotion(run, plan);
        if (run.json) run.print(JSON.stringify({ binding: plan.binding, from: plan.from, to: plan.to }));
        else for (const line of describePromotion(plan)) run.print(line);
      });
    },
  });

  return [backup, restore, reset, promote];
}
