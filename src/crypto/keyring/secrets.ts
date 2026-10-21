import { v } from "../../validation/mod";

const KEY_RING_SECRET_PATTERN = /^(?:[0-9a-fA-F]{2}){32,}(?:\s*,\s*(?:[0-9a-fA-F]{2}){32,})*$/;

/** Valibot schema validating a key-ring variable: comma-separated hex secrets, newest first, of at least 32 bytes each. @public */
export const KeyRingSecretSchema = v.pipe(
  v.string(),
  v.trim(),
  v.regex(KEY_RING_SECRET_PATTERN, "must be comma-separated secrets, each an even number of hex characters, at least 64 (32 bytes)"),
);

/** Splits a comma-joined key-ring variable into its hex root secrets, newest first. @public */
export function parseKeyRingSecrets(value: string): [string, ...string[]] {
  if (!value.trim()) throw new Error("parseKeyRingSecrets: the key-ring value is empty");
  const secrets = value.split(",").map((entry) => entry.trim());
  if (secrets.some((entry) => !entry)) throw new Error("parseKeyRingSecrets: the key-ring value has an empty entry between its commas");
  return secrets as [string, ...string[]];
}
