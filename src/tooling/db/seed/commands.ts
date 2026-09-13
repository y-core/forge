import { addCommand, createCommand } from "../../cli/command";
import { confirm } from "../../cli/confirm";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase, ResolvedFlags } from "../../cli/types";
import { confirmPrinter, resolveDbContext, sharedDbFlags } from "../context";
import type { DbContextOverrides, DbRunContext, SharedDbFlags } from "../types";
import { runSeedApply, runSeedReset, runSeedStatus } from "./apply";

const dirFlag = { type: "string" as const, description: "Run just this directory, instead of every one `config/db.ts` names" };

function where(run: DbRunContext): { target: string; database: string } {
  return { target: run.config.target.place, database: run.home.database };
}

const applyFlags = {
  ...sharedDbFlags,
  dir: dirFlag,
  only: { type: "string" as const, description: "Run just this seed, as `<dir>:<name>` or a name no two directories share" },
  rerun: {
    type: "boolean" as const,
    description: "Run a seed that already ran, including one whose file changed since — with `--only` to name it",
  },
  "allow-pending": { type: "boolean" as const, description: "Seed although a migration is pending, onto the older schema" },
  "allow-drift": { type: "boolean" as const, description: "Seed although the schema was changed outside the migrations" },
  "allow-warnings": { type: "boolean" as const, description: "Seed a deployed database despite lint warnings, which otherwise abort" },
  "no-bookmark": { type: "boolean" as const, description: "Skip the Time Travel bookmark a deployed seed captures as its undo" },
};

/** What `db seed apply` does, which the bare `db seed` runs too. */
async function applySeeds(flags: ResolvedFlags<typeof applyFlags>, ctx: CliContext | undefined, overrides: DbContextOverrides): Promise<void> {
  const run = await resolveDbContext(flags as SharedDbFlags, ctx, overrides);
  const outcome = await runSeedApply(run, {
    dir: flags.dir,
    only: flags.only,
    rerun: Boolean(flags.rerun),
    allowPending: Boolean(flags["allow-pending"]),
    allowDrift: Boolean(flags["allow-drift"]),
    allowWarnings: Boolean(flags["allow-warnings"]),
    bookmark: !flags["no-bookmark"],
  });
  if (run.json) {
    run.print(JSON.stringify({ ...where(run), ...outcome }));
    return;
  }
  for (const name of outcome.excluded) run.print(`excluded ${name}`);
  for (const name of outcome.applied) run.print(`applied ${name}`);
  run.print(`${outcome.applied.length} applied, ${outcome.skipped.length} already in`);
}

function createApplyCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "apply",
    description: "Run every seed that has not run yet, recording each by name and content hash",
    flags: applyFlags,
    run: (_args, flags, ctx?: CliContext) => applySeeds(flags, ctx, overrides),
  });
}

function createStatusCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "status",
    description: "Print which seeds would run, which are already in, and which changed since they ran",
    flags: {
      ...sharedDbFlags,
      dir: dirFlag,
      check: { type: "boolean" as const, description: "Exit non-zero when a seed would run or has changed since it ran. For CI" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const run = await resolveDbContext(flags as SharedDbFlags, ctx, overrides);
      const plan = runSeedStatus(run, { dir: flags.dir });
      const outstanding = plan.apply.length + plan.changed.length;
      if (run.json) {
        run.print(
          JSON.stringify({
            ...where(run),
            apply: plan.apply.map((seed) => `${seed.source}:${seed.name}`),
            skip: plan.skip.map((seed) => `${seed.source}:${seed.name}`),
            changed: plan.changed.map((seed) => `${seed.source}:${seed.name}`),
            excluded: plan.excluded.map((seed) => `${seed.source}:${seed.name}`),
          }),
        );
        if (flags.check && outstanding > 0)
          throw new CliError("invalid-args", `${outstanding} seed(s) pending or changed on ${run.home.database} (${run.config.target.place}).`);
        return;
      }
      for (const seed of plan.apply) run.print(`pending  ${seed.source}:${seed.name}`);
      for (const seed of plan.skip) run.print(`applied  ${seed.source}:${seed.name}`);
      for (const seed of plan.changed) run.print(`changed  ${seed.source}:${seed.name}`);
      for (const seed of plan.excluded) run.print(`excluded ${seed.source}:${seed.name}`);
      if (flags.check && outstanding > 0) {
        throw new CliError(
          "invalid-args",
          `${outstanding} seed(s) pending or changed on ${run.home.database} (${run.config.target.place}) — apply them with \`forge db seed apply\`.`,
        );
      }
    },
  });
}

function createResetCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "reset",
    description: "Forget every seed record, so the next apply runs them all again. Asks first",
    flags: { ...sharedDbFlags, dir: { type: "string" as const, description: "Forget just this directory's seed records" } },
    run: async (_args, flags, ctx?: CliContext) => {
      const run = await resolveDbContext(flags as SharedDbFlags, ctx, overrides);
      await confirm({
        verb: "clear the seed history of",
        what: `${run.home.database} (${run.config.target.place})${flags.dir === undefined ? "" : ` in ${flags.dir}`}`,
        consequence: "The rows the seeds themselves wrote stay; every seed simply runs again on the next apply.",
        yes: run.yes,
        print: confirmPrinter(run),
        cancelMessage: "Reset cancelled; the seed history is unchanged.",
      });
      runSeedReset(run, flags.dir);
      if (run.json) run.print(JSON.stringify({ ...where(run), dir: flags.dir ?? null, reset: true }));
      else run.print("seed history cleared — the rows the seeds wrote are untouched");
    },
  });
}

/** The `forge db` verbs this directory owns. @internal */
export function createSeedCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  const seed = createCommand({
    name: "seed",
    description: "Apply name-keyed idempotent seed files, and read or clear what has run",
    flags: applyFlags,
    run: (_args, flags, ctx?: CliContext) => applySeeds(flags, ctx, overrides),
  });
  addCommand(seed, createApplyCommand(overrides));
  addCommand(seed, createStatusCommand(overrides));
  addCommand(seed, createResetCommand(overrides));
  return [seed];
}
