import { restoreReportKey } from "../../../storage/backup/list";
import { addCommand, createCommand } from "../../cli/command";
import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase } from "../../cli/types";
import { confirmPrinter, sharedDbFlags, withDbRun } from "../context";
import { isRemotePlace } from "../target";
import type { DbContextOverrides, SharedDbFlags } from "../types";
import { listDumps, pullDump, pushDump } from "./copy";
import { describeRestore, describeSidecar } from "./describe";
import { openBackupPorts, resolveDumpSource } from "./dumps";
import { describePromotion, executePromotion, preparePromotion } from "./promote";
import { executeReset, prepareReset } from "./reset";
import { restoreD1Backup } from "./restore";
import { D1PruneError, takeD1Backup } from "./run";

const D1_NAME_LIMIT = 64;

function readKeep(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new CliError("invalid-args", `--keep takes a number of dumps, not ${value}`);
  return Number(value);
}

function rerun(error: unknown, verb: "backup" | "restore"): unknown {
  if (!(error instanceof CliError) || error.kind !== "external" || error instanceof D1PruneError) return error;
  const left = verb === "backup" ? "no sidecar was written, so this run left no complete dump" : "the restore did not finish";
  const into = verb === "restore" ? " into a new or empty database" : "";
  return new CliError("external", `${error.message}\n${left} — run \`forge db ${verb}\` again${into}`, { cause: error });
}

function readInto(value: string | undefined): string | null {
  if (value === undefined || value === "fresh") return null;
  const standby = /^standby:(.+)$/.exec(value)?.[1];
  if (standby === undefined) throw new CliError("invalid-args", `--into takes fresh or standby:<id>, not ${value}`);
  return standby;
}

const bucketFlag = { bucket: { type: "string" as const, description: "The R2 binding the dumps are in. Defaults to BACKUPS" } };

const dumpFlags = {
  ...bucketFlag,
  prefix: { type: "string" as const, description: "The prefix forge db backup was given. Defaults to d1-backups" },
};

/** The `forge db` verbs this directory owns: backup, restore, reset and promote. @internal */
export function createBackupCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  const backup = createCommand({
    name: "backup",
    description: "Export the database through D1's own dumper into R2, beside a sidecar of what it holds, and report what it stored",
    flags: {
      ...sharedDbFlags,
      ...dumpFlags,
      keep: { type: "string" as const, description: "How many complete dumps of this database to keep, the newest first. Defaults to every one" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const keep = readKeep(flags.keep);
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const source = resolveDumpSource(run, flags);
        const ports = await openBackupPorts(run, source);
        const sidecar = await takeD1Backup({
          databaseId: source.databaseId,
          prefix: source.prefix,
          at: run.io.now(),
          ...ports,
          ...(keep === undefined ? {} : { keep }),
        }).catch((error: unknown) => {
          throw rerun(error, "backup");
        });
        if (run.json) run.print(JSON.stringify(sidecar));
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
    description: "Import one R2 dump into a new or empty database, check it against the dump's sidecar, and keep the report beside the dumps",
    flags: {
      ...sharedDbFlags,
      ...dumpFlags,
      from: { type: "string" as const, required: true, description: "The R2 dump's key" },
      into: {
        type: "string" as const,
        description:
          "fresh (default) creates a database over REST; standby:<id> imports into an empty one — locally standby:<binding>, the only choice",
      },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const standby = readInto(flags.into);
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        if (standby === null && !isRemotePlace(run.config.target.place)) {
          throw new CliError(
            "invalid-args",
            "a local target cannot create a database — pass --into standby:<binding> to import into an empty standby",
          );
        }
        const into = standby === null ? { fresh: `${run.home.database}-restore-${run.io.now().getTime()}` } : { standby };
        if ("fresh" in into && into.fresh.length > D1_NAME_LIMIT) {
          throw new CliError(
            "invalid-args",
            `${run.home.database} is too long to restore fresh — ${into.fresh} would pass D1's ${D1_NAME_LIMIT}-character database name limit, so pass --into standby:<id>`,
          );
        }
        const source = resolveDumpSource(run, flags);
        const ports = await openBackupPorts(run, source);
        const report = await restoreD1Backup({ bucket: ports.bucket, key: flags.from, into, transfer: ports.transfer }).catch((error: unknown) => {
          throw rerun(error, "restore");
        });
        await ports.bucket.put(restoreReportKey(source.prefix, source.databaseId, report.databaseId), JSON.stringify(report), {
          httpMetadata: { contentType: "application/json" },
        });
        if (run.json) run.print(JSON.stringify(report));
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
      ...dumpFlags,
      restored: {
        type: "string" as const,
        description: "The id of the database `forge db restore` restored into; its report must show no mismatch",
      },
      "database-id": {
        type: "string" as const,
        description: "With --database-name: point the binding at this database instead, as a swap back does",
      },
      "database-name": { type: "string" as const, description: "With --database-id: that database's name" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      return withDbRun(flags as unknown as SharedDbFlags, ctx, overrides, async (run) => {
        const plan = await preparePromotion(run, {
          restored: flags.restored,
          databaseId: flags["database-id"],
          databaseName: flags["database-name"],
          bucket: flags.bucket,
          prefix: flags.prefix,
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
