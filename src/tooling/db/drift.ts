import type { SchemaObject } from "../../storage/db/types";
import { CliError } from "../cli/errors";
import { certifiedFingerprint, RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "./migrate/checksum";
import { schemaFingerprint } from "./migrate/fingerprint";
import { INVENTORY_SELECT, toSchemaObjects } from "./sql";
import type { DbIo, DbRunContext, Home, RecordedChecksum, SchemaDrift } from "./types";
import { queryRows, queryRowsIfTable } from "./wrangler";

/** How the schema stands against the fingerprint the last apply certified; `null` rows mean the history table is absent. @internal */
export function schemaDrift(recorded: readonly RecordedChecksum[] | null, inventory: readonly SchemaObject[]): SchemaDrift {
  const actual = schemaFingerprint(inventory);
  if (recorded === null) return { state: "unavailable", recorded: null, actual };
  const certified = certifiedFingerprint(recorded);
  if (certified === null) return { state: "unrecorded", recorded: null, actual };
  return { state: certified === actual ? "match" : "mismatch", recorded: certified, actual };
}

/** The same comparison for a verb holding neither read already. @internal */
export async function readDrift(io: DbIo, home: Home): Promise<SchemaDrift> {
  const rows = await queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT);
  const inventory = toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT));
  return schemaDrift(rows === null ? null : toRecordedChecksums(rows), inventory);
}

/** Refuses a schema that moved since the last apply certified its fingerprint, unless the run allowed it; `remedy` is what this verb offers. @internal */
export function refuseSchemaDrift(run: DbRunContext, drift: SchemaDrift, allowDrift: boolean, remedy: string): void {
  if (drift.state !== "mismatch" || allowDrift) return;
  throw new CliError(
    "invalid-args",
    `${run.home.database} (${run.config.target.place}) schema fingerprint ${drift.actual} is not the ${drift.recorded} the last apply certified — either the schema was changed outside the migrations, or an earlier batch part-applied and is being resumed. Inspect with \`forge db migrate status\`, then ${remedy}`,
  );
}
