import { v } from "../../validation/mod";
import { D1BackupError } from "./errors";
import type { BackupBucket, D1RestoreReport } from "./types";

const REPORT = v.object({
  databaseId: v.string(),
  name: v.string(),
  key: v.string(),
  bookmark: v.nullable(v.string()),
  queries: v.pipe(v.number(), v.integer(), v.minValue(0)),
  mismatches: v.array(v.string()),
});

/** `value` as a restore report, or `null` when it is not one `forge db restore` wrote. @internal */
export function readRestoreReportValue(value: unknown): D1RestoreReport | null {
  const checked = v.safeParse(REPORT, value);
  return checked.success ? checked.output : null;
}

/** The restore report kept at `key`, or `null` when there is none; one that is not a report `forge db restore` wrote is refused as malformed. @internal */
export async function readRestoreReport(bucket: BackupBucket, key: string): Promise<D1RestoreReport | null> {
  const object = await bucket.get(key);
  if (object === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await object.text());
  } catch {
    parsed = null;
  }
  const report = readRestoreReportValue(parsed);
  if (report === null) throw new D1BackupError("malformed", `${key} is not a restore report forge db restore wrote`);
  return report;
}
