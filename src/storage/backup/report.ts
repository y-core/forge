import { v } from "../../validation/mod";
import type { D1RestoreReport } from "./types";

const REPORT = v.object({
  databaseId: v.string(),
  name: v.string(),
  key: v.string(),
  bookmark: v.nullable(v.string()),
  queries: v.pipe(v.number(), v.integer(), v.minValue(0)),
  mismatches: v.array(v.string()),
});

/** `value` as a restore report, or `null` when it is not one `runD1Restore` answered. @internal */
export function readRestoreReportValue(value: unknown): D1RestoreReport | null {
  const checked = v.safeParse(REPORT, value);
  return checked.success ? checked.output : null;
}
