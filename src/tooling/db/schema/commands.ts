import { addCommand, createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import type { CliContext, CommandBase, ResolvedFlags } from "../../cli/types";
import { sharedDbFlags, withDbRun } from "../context";
import type { DbContextOverrides, SharedDbFlags } from "../types";
import { checkSchema, formatSchemaCheck } from "./check";
import { formatRowTypes, generateRowTypes } from "./row-types-file";

const cacheFlag = { "no-cache": { type: "boolean" as const, description: "Replay into the scratch database even when a cached model matches" } };

const checkFlags = {
  ...sharedDbFlags,
  replay: { type: "boolean" as const, description: "Also replay the migrations and load the declared schemas, and compare both to the snapshot" },
  ...cacheFlag,
};

const typesFlags = {
  ...sharedDbFlags,
  check: {
    type: "boolean" as const,
    description: "Write nothing, and exit non-zero when the file is absent or not what the declared schemas generate. For CI",
  },
  ...cacheFlag,
};

/** What `db schema check` does, which the bare `db schema` runs too. */
async function runCheck(flags: ResolvedFlags<typeof checkFlags>, ctx: CliContext | undefined, overrides: DbContextOverrides): Promise<void> {
  return withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
    const report = await checkSchema(run, { replay: Boolean(flags.replay), cache: !flags["no-cache"] });
    if (run.json) run.print(JSON.stringify(report));
    else for (const line of formatSchemaCheck(report)) run.print(line);
    if (report.problems !== null && report.problems.length > 0)
      throw new CliError("invalid-args", "the declared schemas, the snapshot and the migrations are not in step — see above.");
  });
}

/** The `forge db schema` group: the check, and the bare verb that runs it. */
function createSchemaCommand(overrides: DbContextOverrides): CommandBase {
  const schema = createCommand({
    name: "schema",
    description: "Check every declared schema against the snapshot and the migrations",
    flags: checkFlags,
    run: (_args, flags, ctx?: CliContext) => runCheck(flags, ctx, overrides),
  });

  addCommand(
    schema,
    createCommand({
      name: "check",
      description: "Check every declared schema against the snapshot and the migrations, exiting non-zero when they are out of step. For CI",
      flags: checkFlags,
      run: (_args, flags, ctx?: CliContext) => runCheck(flags, ctx, overrides),
    }),
  );

  return schema;
}

/** The `forge db types` verb: the row interfaces generated from the declared schemas, or under `--check` held against them. */
function createTypesCommand(overrides: DbContextOverrides): CommandBase {
  return createCommand({
    name: "types",
    description: "Generate one row interface per declared table, and a Tables map, for D1Client.query<T>",
    flags: typesFlags,
    run: (_args, flags, ctx?: CliContext) =>
      withDbRun(flags as SharedDbFlags, ctx, overrides, async (run) => {
        const report = await generateRowTypes(run, { check: Boolean(flags.check), cache: !flags["no-cache"] });
        run.print(run.json ? JSON.stringify(report) : formatRowTypes(report));
        if (report.state === "absent" || report.state === "stale")
          throw new CliError("invalid-args", "the row types are not what the declared schemas generate — see above.");
      }),
  });
}

/** The `forge db` verbs this directory owns. @internal */
export function createSchemaCommands(overrides: DbContextOverrides = {}): CommandBase[] {
  return [createSchemaCommand(overrides), createTypesCommand(overrides)];
}
