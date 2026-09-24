import { join } from "node:path";

import type { DbRunContext, Home, RecordedUnit } from "./types";
import { executeFile } from "./wrangler";

/** Stages one unit under `.forge/scratch/` and loads it, so its body and its record reach the database together. @internal */
export async function applyRecordedSql(run: DbRunContext, home: Home, unit: RecordedUnit): Promise<void> {
  const scratch = join(run.config.root, ".forge", "scratch", unit.label);
  const file = join(scratch, `${unit.name}.sql`);
  run.io.mkdir(scratch);
  // A body whose last statement omits its `;` is legal SQL and no lint rule demands one, so the record
  // is appended after a terminator forge supplies rather than glued onto that statement.
  run.io.writeText(file, unit.record === null ? unit.sql : `${unit.sql.trimEnd().replace(/;?$/, ";")}\n${unit.record}`);
  try {
    await executeFile(run.io, home, file);
  } finally {
    if (unit.remove) run.io.remove(file);
  }
}
