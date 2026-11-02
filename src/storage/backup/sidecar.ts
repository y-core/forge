import { v } from "../../validation/mod";
import { D1BackupError } from "./errors";
import { sidecarKey } from "./list";
import type { BackupBucket, D1BackupSidecar } from "./types";

const COUNT = v.pipe(v.number(), v.integer(), v.minValue(0));

const HEX = (length: number) => v.pipe(v.string(), v.regex(new RegExp(`^[0-9a-f]{${length}}$`)));

const SIDECAR = v.object({
  key: v.string(),
  databaseId: v.string(),
  bookmark: v.string(),
  takenAt: v.string(),
  size: COUNT,
  md5: HEX(32),
  sha256: HEX(64),
  schemaDigest: HEX(64),
  migrationHead: v.nullable(v.string()),
  rows: v.record(v.string(), COUNT),
  hazards: v.array(
    v.object({ table: v.string(), column: v.nullable(v.string()), kind: v.picklist(["escape", "integer", "real", "unscanned"]), count: COUNT }),
  ),
});

/** Writes a dump's sidecar beside it, which marks the dump complete. @internal */
export async function writeSidecar(bucket: BackupBucket, sidecar: D1BackupSidecar): Promise<void> {
  await bucket.put(sidecarKey(sidecar.key), JSON.stringify(sidecar), { httpMetadata: { contentType: "application/json" } });
}

/** `value` as a sidecar, or `null` when it is not one `runD1Backup` wrote. @internal */
export function readSidecarValue(value: unknown): D1BackupSidecar | null {
  const checked = v.safeParse(SIDECAR, value);
  return checked.success ? checked.output : null;
}

/** The sidecar `text` holds for the dump at `key`, refused unless it is one `runD1Backup` wrote for that dump. @internal */
export function parseSidecar(text: string, key: string): D1BackupSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const sidecar = readSidecarValue(parsed);
  if (sidecar === null || sidecar.key !== key) throw new D1BackupError("malformed", `the sidecar of ${key} is not one runD1Backup wrote`);
  return sidecar;
}

/** The sidecar of the dump at `key`, or `null` when the dump has none and so is incomplete. @public */
export async function readD1Backup(bucket: BackupBucket, key: string): Promise<D1BackupSidecar | null> {
  const object = await bucket.get(sidecarKey(key));
  return object === null ? null : parseSidecar(await object.text(), key);
}
