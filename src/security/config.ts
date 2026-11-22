import { base64DecodeOrNull } from "../crypto/primitives/base64";
import { SECRET_MIN_BYTES } from "../crypto/primitives/strength";
import { safeCheck, v } from "../validation/mod";

/** The prefix every Standard Webhooks secret carries before its base64 payload. @internal */
export const WEBHOOK_SECRET_PREFIX = "whsec_";

function isLongEnoughWebhookSecret(entry: string): boolean {
  if (!entry.startsWith(WEBHOOK_SECRET_PREFIX)) return false;
  const raw = base64DecodeOrNull(entry.slice(WEBHOOK_SECRET_PREFIX.length));
  return raw !== null && raw.byteLength >= SECRET_MIN_BYTES;
}

/** Valibot schema validating a webhook-secret variable: comma-separated `whsec_` secrets, each base64 of at least 32 bytes. @public */
export const WebhookSecretSchema = v.pipe(
  v.string(),
  v.trim(),
  safeCheck(
    (value: string) => value.split(",").every((entry) => isLongEnoughWebhookSecret(entry.trim())),
    `must be comma-separated secrets, each whsec_ followed by base64 of at least ${SECRET_MIN_BYTES} bytes`,
  ),
);

/** Splits a comma-joined webhook-secret variable into its `whsec_` secrets, in order. @public */
export function parseWebhookSecrets(value: string): [string, ...string[]] {
  if (!value.trim()) throw new Error("parseWebhookSecrets: the webhook-secret value is empty");
  const secrets = value.split(",").map((entry) => entry.trim());
  if (secrets.some((entry) => !entry)) throw new Error("parseWebhookSecrets: the webhook-secret value has an empty entry between its commas");
  return secrets as [string, ...string[]];
}
