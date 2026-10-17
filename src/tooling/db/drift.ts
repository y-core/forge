import type { SchemaObject } from "../../storage/db/types";
import { CliError } from "../cli/errors";
import { certifiedFingerprint } from "./migrate/checksum";
import { schemaFingerprint } from "./migrate/fingerprint";
import type { DbRunContext, RecordedChecksum, SchemaDrift } from "./types";

/** How the schema stands against the fingerprint the last apply certified; `null` rows mean the history table is absent. @internal */
export function schemaDrift(recorded: readonly RecordedChecksum[] | null, inventory: readonly SchemaObject[]): SchemaDrift {
  const actual = schemaFingerprint(inventory);
  if (recorded === null) return { state: "unavailable", recorded: null, actual };
  const certified = certifiedFingerprint(recorded);
  if (certified === null) return { state: "unrecorded", recorded: null, actual };
  return { state: certified === actual ? "match" : "mismatch", recorded: certified, actual };
}

/** Refuses a schema that moved since the last apply certified its fingerprint. @internal */
export function refuseSchemaDrift(run: DbRunContext, drift: SchemaDrift): void {
  if (drift.state !== "mismatch") return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) schema fingerprint ${drift.actual} is not the ${drift.recorded} the last apply certified — either the schema was changed outside the migrations, or an earlier batch part-applied and is being resumed. Inspect with \`forge db migrate status\`, then restore the database to the schema its migrations describe — \`forge db bookmark restore\` on a deployed one, \`forge db reset\` and \`forge db restore\` on a local one — and run again; nothing passes this check.`,
  );
}
