import { dirname } from "node:path";

import { CliError } from "../../cli/errors";
import { rowTypesPath } from "../declared";
import type { DbRunContext } from "../types";
import { desiredSchemaModel, missingSchemas, readSchemaInputs } from "./compose";
import { emitRowTypes } from "./row-types";
import type { RowTypesReport } from "./types";

/** Generates the row types from the declared schemas, writing the file unless `check`, and reports how it stood. @internal */
export async function generateRowTypes(run: DbRunContext, options: { check: boolean; cache: boolean }): Promise<RowTypesReport> {
  const inputs = readSchemaInputs(run);
  const path = rowTypesPath(run);
  const schemas = inputs.schemas.map((source) => source.declared);
  const missing = missingSchemas(inputs);
  if (missing.length > 0) throw new CliError("invalid-args", missing.join("\n"));
  if (inputs.schemas.length === 0) return { path, schemas, state: "undeclared" };

  const text = emitRowTypes(await desiredSchemaModel(run, inputs, options.cache));
  const actual = run.io.exists(path) ? run.io.readText(path) : null;
  if (actual === text) return { path, schemas, state: "current" };
  if (options.check) return { path, schemas, state: actual === null ? "absent" : "stale" };
  run.io.mkdir(dirname(path));
  run.io.writeText(path, text);
  return { path, schemas, state: "written" };
}

/** The line `forge db types` prints for a report. @internal */
export function formatRowTypes(report: RowTypesReport): string {
  switch (report.state) {
    case "undeclared":
      return "config/db.config.ts names no `schemas` — no row types to generate";
    case "current":
      return `${report.path} matches ${report.schemas.join(", ")}`;
    case "written":
      return `wrote ${report.path}`;
    case "absent":
      return `${report.path} does not exist — run \`forge db types\` to write it`;
    case "stale":
      return `${report.path} is not what ${report.schemas.join(", ")} generate — run \`forge db types\``;
  }
}
