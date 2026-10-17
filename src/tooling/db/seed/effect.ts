import { CliError } from "../../cli/errors";
import { copyTargetSchema } from "../migrate/analysis";
import { describeSchemaDifference, readSchemaModel } from "../schema/introspect";
import type { DbRunContext, Home, SchemaObject, Seed } from "../types";

const ROW_CONSTRAINT = /\(extended: SQLITE_CONSTRAINT_(?:FOREIGNKEY|UNIQUE|NOTNULL|CHECK)\)/;

/** True for the error local D1 answers a statement a row constraint stopped — the refusal the seed check passes over when the statement writes no schema. @internal */
export function isRowConstraintRefusal(error: unknown): boolean {
  return error instanceof Error && ROW_CONSTRAINT.test(error.message);
}

const SCHEMA_WRITING_OPCODES = new Set(["ParseSchema", "CreateBtree", "Destroy", "DropTable", "DropIndex", "DropTrigger"]);
const SCHEMA_COOKIE = 1;

/** True when a program `EXPLAIN` answers creates, drops or reloads a schema object, or sets the schema cookie. @internal */
export function isSchemaWritingProgram(program: readonly Record<string, unknown>[]): boolean {
  return program.some(({ opcode, p2 }) => SCHEMA_WRITING_OPCODES.has(String(opcode)) || (opcode === "SetCookie" && p2 === SCHEMA_COOKIE));
}

/** A seed as `--only` names it: its directory, then its name. @internal */
export const seedName = (seed: Seed): string => `${seed.source}:${seed.name}`;

async function readStatementProgram(run: DbRunContext, home: Home, statement: string): Promise<Record<string, unknown>[] | null> {
  try {
    const [program = []] = await run.io.d1(home, [`EXPLAIN ${statement}`]);
    return program.length === 0 ? null : program;
  } catch {
    return null;
  }
}

/** Runs each seed, expanded, one statement at a time on a copy of the target's schema, refusing one that changes it, or fails other than on a row constraint a statement writing no schema met. @internal */
export async function refuseSchemaChangingSeeds(
  run: DbRunContext,
  seeds: readonly Seed[],
  expanded: ReadonlyMap<Seed, string>,
  inventory: readonly SchemaObject[],
): Promise<void> {
  if (seeds.length === 0) return;
  const target = `${run.home.database} (${run.config.target.place})`;
  const home = await copyTargetSchema(run, inventory, "seed");
  const before = await readSchemaModel(run.io, home);
  for (const seed of seeds) {
    for (const statement of await run.io.splitD1(home, expanded.get(seed) ?? seed.sql)) {
      try {
        await run.io.d1(home, [statement]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const quoted = `\`${statement.trim().slice(0, 200)}\``;
        if (isRowConstraintRefusal(error)) {
          const program = await readStatementProgram(run, home, statement);
          if (program === null) {
            throw new CliError(
              "invalid-args",
              `${seedName(seed)} fails a row constraint on a copy of ${target}'s schema at ${quoted}, and its program could not be read to show it writes no schema, so no seed was applied:\n${detail}`,
            );
          }
          if (!isSchemaWritingProgram(program)) continue;
          throw new CliError(
            "invalid-args",
            `${seedName(seed)} writes the schema of ${target} at ${quoted}, which a row constraint stopped on the copy but need not stop on the target, and only a composed migration may — no seed was applied:\n${detail}\nMove the change to schema.sql and compose it; a seed writes rows (DATABASE_MANAGEMENT.md §7a).`,
          );
        }
        throw new CliError(
          "invalid-args",
          `${seedName(seed)} fails on a copy of ${target}'s schema at ${quoted}, so no seed was applied — fix the statement:\n${detail}`,
        );
      }
    }
    const after = await readSchemaModel(run.io, home);
    const changed = describeSchemaDifference(before, after, { left: "the schema before it", right: "the schema after it" });
    if (changed.length === 0) continue;
    throw new CliError(
      "invalid-args",
      `${seedName(seed)} changes the schema of ${target}, and only a composed migration may — no seed was applied:\n  ${changed.join("\n  ")}\nMove the change to schema.sql and compose it; a seed writes rows (DATABASE_MANAGEMENT.md §7a).`,
    );
  }
}
