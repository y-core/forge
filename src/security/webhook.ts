import { base64DecodeOrNull, base64Encode } from "../crypto/base64";
import { concatBytes, utf8Encode } from "../crypto/bytes";
import { hmacSign, importHmacKey } from "../crypto/hmac";
import { assertSecretStrength } from "../crypto/strength";
import { timingSafeEqualBytes } from "../crypto/timing";
import { err, ok } from "../result/result";
import type { Result } from "../result/types";
import type { VerifiedWebhook, WebhookRefusal, WebhookSignatureHeaders, WebhookSignOptions, WebhookVerifyOptions } from "./types";

const WEBHOOK_SECRET_PREFIX = "whsec_";
const WEBHOOK_TOLERANCE_SECONDS_DEFAULT = 300;
const WEBHOOK_MAX_BYTES_DEFAULT = 1_048_576;
const SIGNATURE_BYTES = 32;

interface SignedContent {
  readonly id: string;
  readonly timestamp: number;
  readonly body: Uint8Array;
}

interface WebhookLimits {
  readonly toleranceSeconds: number;
  readonly maxBytes: number;
  readonly now: (() => number) | undefined;
}

function decodeWebhookSecret(operation: string, secret: string): Uint8Array<ArrayBuffer> {
  const raw = secret.startsWith(WEBHOOK_SECRET_PREFIX) ? base64DecodeOrNull(secret.slice(WEBHOOK_SECRET_PREFIX.length)) : null;
  if (raw === null) throw new Error(`${operation}: a secret is not a whsec_-prefixed base64 string.`);
  assertSecretStrength(operation, raw);
  return raw;
}

function webhookSecretKeys(operation: string, secrets: readonly string[]): Promise<CryptoKey[]> {
  if (secrets.length === 0) throw new Error(`${operation}: secrets is empty — at least one active secret is needed to sign or verify.`);
  const raws = secrets.map((secret) => decodeWebhookSecret(operation, secret));
  return Promise.all(raws.map((raw) => importHmacKey(raw)));
}

function assertWholeAtLeastOne(operation: string, knob: string, value: number, unit: string, why: string): void {
  if (!Number.isInteger(value)) throw new Error(`${operation}: ${knob} is ${value}, which is not a whole number.`);
  if (value < 1) throw new Error(`${operation}: ${knob} is ${value}, below the 1-${unit} floor — ${why}.`);
}

function epochSeconds(now: (() => number) | undefined): number {
  return Math.floor((now?.() ?? Date.now()) / 1000);
}

/** Computes the Standard Webhooks HMAC-SHA256 over `id.timestamp.body`. @internal */
export function computeWebhookSignature(key: CryptoKey, content: SignedContent): Promise<Uint8Array<ArrayBuffer>> {
  return hmacSign(key, concatBytes(utf8Encode(`${content.id}.${content.timestamp}.`), content.body));
}

async function signWebhookHeaders(keys: Promise<CryptoKey[]>, options: WebhookSignOptions): Promise<WebhookSignatureHeaders> {
  const timestamp = epochSeconds(options.now);
  const body = typeof options.body === "string" ? utf8Encode(options.body) : options.body;
  const content = { id: options.id, timestamp, body };
  const macs = await Promise.all((await keys).map((key) => computeWebhookSignature(key, content)));
  return {
    "webhook-id": options.id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": macs.map((mac) => `v1,${base64Encode(mac)}`).join(" "),
  };
}

/** Signs a webhook body under every active secret, answering the three Standard Webhooks headers. @public */
export function signWebhook(options: WebhookSignOptions): Promise<WebhookSignatureHeaders> {
  if (options.id === "") throw new Error("signWebhook: id is empty — a receiver deduplicates retries on it.");
  if (options.id.includes(".")) throw new Error('signWebhook: id contains ".", which makes the signed content ambiguous.');
  const keys = webhookSecretKeys("signWebhook", options.secrets);
  return signWebhookHeaders(keys, options);
}

function parseWebhookTimestamp(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function webhookSignatureCandidates(header: string): Uint8Array<ArrayBuffer>[] {
  return header
    .split(" ")
    .filter((entry) => entry !== "")
    .flatMap((entry) => {
      const comma = entry.indexOf(",");
      if (comma === -1 || entry.slice(0, comma) !== "v1") return [];
      const mac = base64DecodeOrNull(entry.slice(comma + 1));
      return mac?.byteLength === SIGNATURE_BYTES ? [mac] : [];
    });
}

async function readWebhookBody(request: Request, maxBytes: number): Promise<Result<Uint8Array<ArrayBuffer>, "body-too-large">> {
  if (!request.body) return ok(new Uint8Array(0));

  let seen = 0;
  let overflowed = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        overflowed = true;
        controller.error(new Error("webhook body too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    return ok(new Uint8Array(await new Response(request.body.pipeThrough(counter)).arrayBuffer()));
  } catch (thrown) {
    if (overflowed) return err("body-too-large");
    throw thrown;
  }
}

async function readVerifiedWebhook(
  request: Request,
  keys: Promise<CryptoKey[]>,
  limits: WebhookLimits,
): Promise<Result<VerifiedWebhook, WebhookRefusal>> {
  const id = request.headers.get("webhook-id");
  const stamp = request.headers.get("webhook-timestamp");
  const signature = request.headers.get("webhook-signature");
  if (!id || !stamp || !signature) return err("missing-header");

  const timestamp = parseWebhookTimestamp(stamp);
  if (timestamp === null) return err("invalid-timestamp");
  const nowSeconds = epochSeconds(limits.now);
  if (nowSeconds - timestamp > limits.toleranceSeconds) return err("timestamp-too-old");
  if (timestamp - nowSeconds > limits.toleranceSeconds) return err("timestamp-too-new");

  const candidates = webhookSignatureCandidates(signature);
  if (candidates.length === 0) return err("invalid-signature");

  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limits.maxBytes) return err("body-too-large");
  const body = await readWebhookBody(request, limits.maxBytes);
  if (!body.ok) return body;

  const content = { id, timestamp, body: body.data };
  const expected = await Promise.all((await keys).map((key) => computeWebhookSignature(key, content)));
  const matches = expected.flatMap((mac) => candidates.map((candidate) => timingSafeEqualBytes(mac, candidate)));
  if (!matches.includes(true)) return err("signature-mismatch");
  return ok({ id, timestamp, body: body.data });
}

/** Verifies a Standard Webhooks request against any active secret, answering the exact signed body bytes. @public */
export function verifyWebhook(request: Request, options: WebhookVerifyOptions): Promise<Result<VerifiedWebhook, WebhookRefusal>> {
  const keys = webhookSecretKeys("verifyWebhook", options.secrets);
  const toleranceSeconds = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS_DEFAULT;
  const maxBytes = options.maxBytes ?? WEBHOOK_MAX_BYTES_DEFAULT;
  assertWholeAtLeastOne(
    "verifyWebhook",
    "toleranceSeconds",
    toleranceSeconds,
    "second",
    "a zero window refuses every webhook from a clock not in step",
  );
  assertWholeAtLeastOne("verifyWebhook", "maxBytes", maxBytes, "byte", "a zero ceiling refuses every webhook that carries a body");
  return readVerifiedWebhook(request, keys, { toleranceSeconds, maxBytes, now: options.now });
}
