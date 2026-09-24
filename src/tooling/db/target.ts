import type { DbTarget, Home, Place } from "./types";

const PLACES: readonly Place[] = ["local", "standby", "remote", "preview"];

// A name reaches an argv position, where a leading hyphen would be read by wrangler as a flag.
/** What a D1 database name may be, here and in the wrangler config alike. @internal */
export const DATABASE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses `place[:database]`, returning null when the spec is not one so the caller phrases the refusal. @internal */
export function parseTarget(spec: string): DbTarget | null {
  const separator = spec.indexOf(":");
  const place = separator === -1 ? spec : spec.slice(0, separator);
  const database = separator === -1 ? null : spec.slice(separator + 1);
  if (!PLACES.includes(place as Place)) return null;
  if (database !== null && !DATABASE_NAME.test(database)) return null;
  return { place: place as Place, database };
}

/** The inverse of `parseTarget`, so a manifest records a target the CLI accepts back. @internal */
export function formatTarget(target: DbTarget): string {
  return target.database === null ? target.place : `${target.place}:${target.database}`;
}

/** The message a target spec that is not one is refused with. @internal */
export function describeTargetGrammar(spec: string): string {
  return `--target ${spec} is not a target — use place[:database], place being ${PLACES.join(", ")}`;
}

/** True for a place that names a deployed database. @internal */
export function isRemotePlace(place: Place): boolean {
  return place === "remote" || place === "preview";
}

/** Why a remote target is refused — an id that is not a D1 id — or null when it may be used. @internal */
export function refuseRemote(place: Place, databaseId: string | null): string | null {
  if (!isRemotePlace(place)) return null;
  const field = place === "preview" ? "preview_database_id" : "database_id";
  if (databaseId === null || databaseId === "")
    return `${place} is refused while wrangler.jsonc has no ${field} — run \`forge cf sync --commit\` to provision it, then retry`;
  if (!UUID.test(databaseId)) {
    return `${place} is refused while wrangler.jsonc's ${field} is the placeholder ${databaseId} — run \`forge cf sync --commit\` to provision it, then retry`;
  }
  return null;
}

/** The flags every wrangler call against a home carries, so a run can never straddle two databases. @internal */
export function wranglerPlaceFlags(home: Home): string[] {
  const flags = ["-c", home.configPath];
  if (home.env !== null) flags.push("-e", home.env);
  if (home.place === "remote") flags.push("--remote");
  else if (home.place === "preview") flags.push("--remote", "--preview");
  else flags.push("--local", ...(home.persistTo === null ? [] : ["--persist-to", home.persistTo]));
  return flags;
}
