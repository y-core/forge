/** Splits a comma-joined key-ring variable into its hex root secrets, newest first. @public */
export function parseKeyRingSecrets(value: string): [string, ...string[]] {
  if (!value.trim()) throw new Error("parseKeyRingSecrets: the key-ring value is empty");
  const secrets = value.split(",").map((entry) => entry.trim());
  if (secrets.some((entry) => !entry)) throw new Error("parseKeyRingSecrets: the key-ring value has an empty entry between its commas");
  return secrets as [string, ...string[]];
}
