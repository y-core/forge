import type { MiddlewareHandler } from "hono";
import { CSRF_FIELD_DEFAULT } from "./constants";
import type { CsrfResult } from "./types";

function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const padded2 = remainder ? padded + "=".repeat(4 - remainder) : padded;
  const binary = atob(padded2);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Imports a hex-encoded secret as a Web Crypto HMAC-SHA256 key for CSRF operations. @public */
export async function importCsrfKey(hexSecret: string): Promise<CryptoKey> {
  const pairs = hexSecret.match(/.{2}/g);
  if (!pairs || pairs.length < 16)
    throw new Error("CSRF secret must be at least 32 hex characters (16 bytes)");
  const bytes = new Uint8Array(pairs.map((h) => Number.parseInt(h, 16)));
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Creates a signed CSRF token embedding path, timestamp, and 16 random bytes. @public */
export async function createCsrfToken(key: CryptoKey, path: string): Promise<string> {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const payload = `${path}|${timestamp}|${randomHex}`;
  const payloadEncoded = base64urlEncode(new TextEncoder().encode(payload));
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigEncoded = base64urlEncode(new Uint8Array(sigBuffer));
  return `${payloadEncoded}.${sigEncoded}`;
}

/** Verifies a CSRF token; checks expiry and path before the HMAC signature to avoid timing oracles. @public */
export async function verifyCsrfToken(
  key: CryptoKey,
  token: string,
  path: string,
  maxAgeMs = 3_600_000,
): Promise<CsrfResult> {
  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return { ok: false, reason: "invalid-format" };
  }

  const payloadEncoded = token.slice(0, dotIdx);
  const sigEncoded = token.slice(dotIdx + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sigEncoded);
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  let payloadStr: string;
  try {
    payloadStr = new TextDecoder().decode(base64urlDecode(payloadEncoded));
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  const parts = payloadStr.split("|");
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid-format" };
  }

  // Check expiry and path before signature to avoid leaking whether the signature was valid.
  const [tokenPath, timestampStr] = parts;
  const timestamp = Number(timestampStr);
  if (!Number.isInteger(timestamp) || Date.now() - timestamp > maxAgeMs) {
    return { ok: false, reason: "expired" };
  }

  if (tokenPath !== path) {
    return { ok: false, reason: "path-mismatch" };
  }

  const sigBuffer = sigBytes.buffer.slice(
    sigBytes.byteOffset,
    sigBytes.byteOffset + sigBytes.byteLength,
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuffer,
    new TextEncoder().encode(payloadStr),
  );
  if (!valid) {
    return { ok: false, reason: "invalid-signature" };
  }

  return { ok: true };
}

/** Middleware that sets a CSRF token on GET requests and verifies it on mutations. @public */
export function csrfProtection(options: {
  secret: CryptoKey;
  tokenField?: string;
  headerName?: string;
}): MiddlewareHandler {
  const { secret, tokenField = CSRF_FIELD_DEFAULT, headerName = "X-CSRF-Token" } = options;

  return async (c, next) => {
    const method = c.req.method.toUpperCase();

    if (method === "GET" || method === "HEAD") {
      const token = await createCsrfToken(secret, c.req.path);
      c.set("csrfToken", token);
      return next();
    }

    const headerToken = c.req.header(headerName);
    let token: string | undefined = headerToken ?? undefined;

    if (!token) {
      try {
        const cloned = c.req.raw.clone();
        const formData = await cloned.formData();
        token = formData.get(tokenField)?.toString() ?? undefined;
      } catch {
        // body cannot be parsed as form data — token stays undefined
      }
    }

    const result = await verifyCsrfToken(secret, token ?? "", c.req.path);
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }

    return next();
  };
}
