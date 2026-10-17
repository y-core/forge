import { CliError } from "../cli/errors";
import { clearLocalState } from "./home";
import { runMigrate } from "./migrate/apply";
import { readSeeds, runSeedApply } from "./seed/apply";
import type { DbRunContext, StandbyResetOptions, StandbyResetOutcome } from "./types";

/** Empties a standby database, applies every migration, then applies every seed, so what it holds depends on nothing a previous run left. @public */
export async function runStandbyReset(run: DbRunContext, options: StandbyResetOptions): Promise<StandbyResetOutcome> {
  // Named before `clearLocalState` refuses, because its message is about a generated home and would
  // send a caller who aimed at `local` looking for the wrong thing.
  if (run.config.target.place !== "standby") {
    throw new CliError(
      "invalid-args",
      `standby reset only builds a standby database, and --target names ${run.config.target.place} — pass --target standby[:<database>]`,
    );
  }
  if (options.seed && readSeeds(run, options.dir).length === 0) {
    throw new CliError(
      "invalid-args",
      `standby reset found no seeds${options.dir === undefined ? " in any directory config/db.ts names" : ` in ${options.dir}`} — add one, or pass --no-seed to build the standby database with every table empty`,
    );
  }
  await clearLocalState(run.io, run.home);

  const migrated = await runMigrate(run, { dryRun: false, bookmark: false, rehearse: false });
  if (!options.seed) return { database: run.home.database, applied: migrated.applied, seeded: [], excluded: [] };

  const seeded = await runSeedApply(run, { ...(options.dir === undefined ? {} : { dir: options.dir }), rerun: false, bookmark: false });
  return { database: run.home.database, applied: migrated.applied, seeded: seeded.applied, excluded: seeded.excluded };
}
