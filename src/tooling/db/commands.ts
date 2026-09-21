import { addCommand, createCommand } from "../cli/command";
import { confirm } from "../cli/confirm";
import { CliError } from "../cli/errors";
import type { CliContext, CommandBase } from "../cli/types";
import { createBackupCommands } from "./backup/commands";
import { timeTravelInfo, timeTravelRestore } from "./bookmark";
import { confirmPrinter, sharedDbFlags, withDbRun } from "./context";
import { createMigrateCommands } from "./migrate/commands";
import { createSchemaCommands } from "./schema/commands";
import { createSeedCommands } from "./seed/commands";
import { runStandbyReset } from "./standby";
import type { DbContextOverrides, DbRunContext, SharedDbFlags } from "./types";

function where(run: DbRunContext): { target: string; database: string } {
  return { target: run.config.target.place, database: run.home.database };
}

/** The `forge db bookmark` verbs: D1 Time Travel, which is the undo for a deployed database. */
function createBookmarkCommands(overrides: DbContextOverrides): CommandBase {
  const bookmark = createCommand({
    name: "bookmark",
    description: "D1 Time Travel: capture a restore point on the deployed database, or return to one",
  });

  addCommand(
    bookmark,
    createCommand({
      name: "info",
      description: "Print the bookmark for now, or for --timestamp, and the command that restores to it",
      flags: {
        ...sharedDbFlags,
        timestamp: { type: "string" as const, description: "An ISO 8601 instant or a Unix timestamp to bookmark instead of now" },
      },
      run: async (_args, flags, ctx?: CliContext) => {
        return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
          const info = timeTravelInfo(run.io, run.home, flags.timestamp, run.config);
          if (run.json) run.print(JSON.stringify({ target: run.config.target.place, database: run.home.database, ...info }));
          else run.print(`bookmark ${info.bookmark}\nrestore with: ${info.restoreCommand}`);
        });
      },
    }),
  );

  addCommand(
    bookmark,
    createCommand({
      name: "restore",
      description: "Return the deployed database to a bookmark or a timestamp. Asks first",
      flags: {
        ...sharedDbFlags,
        bookmark: { type: "string" as const, description: "A bookmark from `db bookmark info` or from a `db migrate` run" },
        timestamp: { type: "string" as const, description: "An ISO 8601 instant or a Unix timestamp within the retention window" },
      },
      run: async (_args, flags, ctx?: CliContext) => {
        if ((flags.bookmark === undefined) === (flags.timestamp === undefined)) {
          throw new CliError("invalid-args", "Name the point to return to with exactly one of --bookmark or --timestamp.");
        }
        return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
          const point = flags.bookmark === undefined ? { timestamp: flags.timestamp ?? "" } : { bookmark: flags.bookmark };
          await confirm({
            verb: "restore",
            what: `${run.home.database} (${run.config.target.place}) to ${"bookmark" in point ? point.bookmark : point.timestamp}`,
            consequence:
              "Every write since that point is discarded. Capture the current point first with `forge db bookmark info` if you may want it back.",
            yes: run.yes,
            print: confirmPrinter(run),
            cancelMessage: "Restore cancelled; the database is unchanged.",
          });
          const output = timeTravelRestore(run.io, run.home, point);
          if (run.json) run.print(JSON.stringify({ target: run.config.target.place, database: run.home.database, restored: point }));
          else run.print(output === "" ? "restored" : output);
        });
      },
    }),
  );

  return bookmark;
}

/** The `forge db standby` verbs: the second local database, rebuilt from the migrations and the seeds alone. */
function createStandbyCommands(overrides: DbContextOverrides): CommandBase {
  const standby = createCommand({
    name: "standby",
    description: "Build and manage the second local database, which nothing it holds can reach the app's own state from",
  });

  addCommand(
    standby,
    createCommand({
      name: "reset",
      description: "Empty the standby database, apply every migration, then apply every seed. Asks first",
      flags: {
        ...sharedDbFlags,
        // The verb refuses every other place, so the shared `local` default would only ever be a typo.
        target: { ...sharedDbFlags.target, default: "standby" },
        dir: { type: "string" as const, description: "Seed just this directory, instead of every one `config/db.ts` names" },
        "no-seed": { type: "boolean" as const, description: "Stop after the migrations, leaving every table empty" },
        "no-lint": { type: "boolean" as const, description: "Apply without checking the pending migrations for destructive SQL first" },
      },
      run: async (_args, flags, ctx?: CliContext) => {
        return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
          await confirm({
            verb: "rebuild",
            what: `${run.home.database} (${run.config.target.place})`,
            consequence: "Every row in it is discarded; what it holds afterwards comes from the migrations and the seeds alone.",
            yes: run.yes,
            print: confirmPrinter(run),
            cancelMessage: "Reset cancelled; the standby database is unchanged.",
          });
          const outcome = await runStandbyReset(run, { dir: flags.dir, seed: !flags["no-seed"], lint: !flags["no-lint"] });
          if (run.json) run.print(JSON.stringify({ ...where(run), ...outcome }));
          else run.print(`${outcome.database}: ${outcome.applied.length} migration(s), ${outcome.seeded.length} seed(s)`);
        });
      },
    }),
  );

  return standby;
}

/** The `forge db` command tree: migrate, lint, schema, backup, restore, reset, seed, standby and bookmark. @public */
export function createDbCommands(overrides: DbContextOverrides = {}): CommandBase {
  const db = createCommand({
    name: "db",
    description: "Manage a D1 database: declared schema composed into forward-only migrations, verified backups, and idempotent seeds",
  });
  for (const command of createMigrateCommands(overrides)) addCommand(db, command);
  for (const command of createSchemaCommands(overrides)) addCommand(db, command);
  for (const command of createBackupCommands(overrides)) addCommand(db, command);
  for (const command of createSeedCommands(overrides)) addCommand(db, command);
  addCommand(db, createStandbyCommands(overrides));
  addCommand(db, createBookmarkCommands(overrides));
  return db;
}
