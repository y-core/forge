import { schemaFingerprintInput } from "../../../storage/db/schema";
import type { SchemaObject } from "../../../storage/db/types";
import { sha256 } from "../digest";

export { isManagedObject, MANAGED_TABLE_PREFIXES } from "../../../storage/db/schema";

/** SHA-256 over the app's own schema objects, so two databases built the same way fingerprint the same. @internal */
export function schemaFingerprint(objects: readonly SchemaObject[]): string {
  return sha256(schemaFingerprintInput(objects));
}
