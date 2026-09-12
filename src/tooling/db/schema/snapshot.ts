import { CliError } from "../../cli/errors";
import type { DbIo } from "../types";
import type { SchemaModel, SchemaSnapshot } from "./types";

/** Bumped when the snapshot's fields change, so one written under another shape is recomposed rather than misread. @internal */
export const SCHEMA_SNAPSHOT_VERSION = 5;

/** True when parsed JSON carries the four object lists a schema model is, which a half-written scratch cache may not. @internal */
export function isSchemaModel(value: unknown): value is SchemaModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Partial<Record<keyof SchemaModel, unknown>>;
  return ["tables", "indexes", "triggers", "views"].every((key) => Array.isArray(model[key as keyof SchemaModel]));
}

/** The snapshot on disk, or null when nothing has been composed yet. @internal */
export function readSchemaSnapshot(io: DbIo, path: string): SchemaSnapshot | null {
  if (!io.exists(path)) return null;
  let parsed: Partial<SchemaSnapshot>;
  try {
    parsed = JSON.parse(io.readText(path)) as Partial<SchemaSnapshot>;
  } catch (error) {
    throw new CliError(
      "invalid-args",
      `${path} is not JSON (${error instanceof Error ? error.message : String(error)}) — delete it and compose again`,
    );
  }
  if (parsed.version !== SCHEMA_SNAPSHOT_VERSION) {
    throw new CliError(
      "invalid-args",
      `${path} was written under snapshot version ${String(parsed.version)}, and this forge reads ${SCHEMA_SNAPSHOT_VERSION} — delete it and compose again`,
    );
  }
  if (typeof parsed.desired !== "object" || parsed.desired === null || typeof parsed.migrationsDigest !== "string") {
    throw new CliError("invalid-args", `${path} is missing a field a snapshot carries — delete it and compose again`);
  }
  return { version: parsed.version, desired: parsed.desired, migrationsDigest: parsed.migrationsDigest };
}

/** The snapshot's one spelling: two-space JSON and a trailing newline. @internal */
export function formatSchemaSnapshot(snapshot: SchemaSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Writes the snapshot, leaving its bytes alone when they already agree. @internal */
export function writeSchemaSnapshot(io: DbIo, path: string, snapshot: SchemaSnapshot): void {
  const text = formatSchemaSnapshot(snapshot);
  if (io.exists(path) && io.readText(path) === text) return;
  io.writeText(path, text);
}

/** A snapshot from its parts, versioned. @internal */
export function buildSchemaSnapshot(fields: { desired: Readonly<Record<string, string>>; migrationsDigest: string }): SchemaSnapshot {
  return { version: SCHEMA_SNAPSHOT_VERSION, ...fields };
}
