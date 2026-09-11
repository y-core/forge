import { Cookie as CookieHeader } from "@remix-run/headers/cookie";
import { SetCookie } from "@remix-run/headers/set-cookie";

import { base64DecodeOrNull, base64Encode, hmacSign, hmacVerify, importHmacKey, utf8Encode } from "../crypto/mod";
import type { CookieAttributes, SignedCookie, SignedCookieOptions, UnsignedCookie, UnsignedCookieOptions } from "./types";

// Not `crypto/mod`'s shared TEXT_DECODER: that one is lenient, so malformed bytes would decode to
// U+FFFD mojibake and flow into JSON.parse or the session store instead of answering `null`.
const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Encodes a value to its wire payload: `base64(utf8(value))`, standard alphabet, padding retained. */
function encodePayload(value: string): string {
  // A lone surrogate is unrepresentable in UTF-8: TextEncoder would substitute U+FFFD and `parse`
  // would not return what `serialize` was given, so refuse it rather than corrupt it silently.
  if (!value.isWellFormed()) {
    throw new Error("cookie value must not contain lone surrogates");
  }
  return base64Encode(utf8Encode(value));
}

/** Decodes a wire payload back to its value, answering `null` for anything that is not one. */
function decodePayload(payload: string): string | null {
  const bytes = base64DecodeOrNull(payload);
  if (bytes === null) return null;
  try {
    return STRICT_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/** Reads this cookie's raw wire value out of a `Cookie` header. */
function readWire(header: string | null, name: string): string | null {
  if (!header) return null;
  const cookies = new CookieHeader(header);
  if (!cookies.has(name)) return null;
  return cookies.get(name) ?? null;
}

/** Builds the `Set-Cookie` header value from the construction defaults merged with a per-call override. */
function setCookie(name: string, wire: string, defaults: CookieAttributes, override: CookieAttributes | undefined): string {
  // `??` per field, never `||`: `maxAge: 0` is the flash-clear path and must survive the merge.
  const domain = override?.domain ?? defaults.domain;
  const expires = override?.expires ?? defaults.expires;
  const httpOnly = override?.httpOnly ?? defaults.httpOnly;
  const maxAge = override?.maxAge ?? defaults.maxAge;
  const partitioned = override?.partitioned ?? defaults.partitioned;
  const path = override?.path ?? defaults.path;
  const sameSite = override?.sameSite ?? defaults.sameSite;
  // A partitioned cookie is only honoured alongside Secure.
  const secure = partitioned === true ? true : (override?.secure ?? defaults.secure);
  return new SetCookie({
    name,
    value: wire,
    ...(domain !== undefined ? { domain } : {}),
    ...(expires !== undefined ? { expires } : {}),
    ...(httpOnly !== undefined ? { httpOnly } : {}),
    ...(maxAge !== undefined ? { maxAge } : {}),
    ...(partitioned !== undefined ? { partitioned } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(sameSite !== undefined ? { sameSite } : {}),
    ...(secure !== undefined ? { secure } : {}),
  }).toString();
}

/** Creates an unsigned cookie: the value is base64-encoded on the wire but carries no authentication. @public */
export function createUnsignedCookie(name: string, options?: UnsignedCookieOptions): UnsignedCookie {
  if (name === "") throw new Error("createUnsignedCookie: name must not be empty");
  const defaults: CookieAttributes = { path: "/", sameSite: "Lax", ...options };

  return {
    name,
    // `async` though nothing awaits: a rejected promise, never a synchronous throw, so a caller
    // handles both cookie kinds the same way.
    async parse(header: string | null): Promise<string | null> {
      const wire = readWire(header, name);
      if (wire === null) return null;
      // `""` short-circuits both directions, so the destroy sentinel survives a round trip.
      if (wire === "") return "";
      return decodePayload(wire);
    },
    async serialize(value: string, attributes?: CookieAttributes): Promise<string> {
      return setCookie(name, value === "" ? "" : encodePayload(value), defaults, attributes);
    },
  };
}

/** Creates a cookie that is always httpOnly and HMAC-signed, verified against every secret so a rotation keeps existing cookies valid. @public */
export function createSignedCookie(name: string, options: SignedCookieOptions): SignedCookie {
  if (name === "") throw new Error("createSignedCookie: name must not be empty");
  for (const secret of options.secrets) {
    if (secret.length < 32) {
      throw new Error(`createSignedCookie: each secret must be at least 32 characters (got ${secret.length})`);
    }
  }
  const { secrets, sameSite, ...rest } = options;
  // `secure` is hardcoded, not an option: development is https at every hop, so it is correct there
  // by construction (`WORKERS_PLATFORM.md` §4e). An option to relax it only ever shipped a session
  // cookie readable in transit, from a mistyped env check that nothing else would have reported.
  const defaults: CookieAttributes = { path: "/", ...rest, sameSite: sameSite ?? "Lax", httpOnly: true, secure: true };

  // The secrets are fixed at construction, so the imported keys are too — upstream re-imported one
  // inside every sign and every unsign. Keyed by index, never by secret material.
  const keys: (Promise<CryptoKey> | undefined)[] = secrets.map(() => undefined);
  function keyFor(index: number, secret: string): Promise<CryptoKey> {
    const cached = keys[index];
    if (cached) return cached;
    // The promise, not the key: concurrent first use imports once. The `catch` clears the slot so a
    // transient failure cannot poison it for the isolate's life, and leaves no unhandled rejection.
    const pending = importHmacKey(utf8Encode(secret));
    keys[index] = pending;
    pending.catch(() => {
      if (keys[index] === pending) keys[index] = undefined;
    });
    return pending;
  }

  async function sign(payload: string): Promise<string> {
    // The HMAC covers the base64 payload, never the raw value.
    const signature = await hmacSign(await keyFor(0, secrets[0]), payload);
    return `${payload}.${base64Encode(signature).replace(/=+$/, "")}`;
  }

  async function unsign(wire: string): Promise<string | null> {
    // `lastIndexOf`, not `indexOf`: the signature is the final segment, whatever precedes it.
    const dot = wire.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = wire.slice(0, dot);
    const signature = base64DecodeOrNull(wire.slice(dot + 1));
    if (signature === null) return null;
    for (const [index, secret] of secrets.entries()) {
      if (await hmacVerify(await keyFor(index, secret), payload, signature)) return payload;
    }
    return null;
  }

  return {
    name,
    rotating: secrets.length > 1,
    async parse(header: string | null): Promise<string | null> {
      const wire = readWire(header, name);
      if (wire === null) return null;
      if (wire === "") return "";
      const payload = await unsign(wire);
      return payload === null ? null : decodePayload(payload);
    },
    async serialize(value: string, attributes?: CookieAttributes): Promise<string> {
      // `""` short-circuits both directions: the destroy path costs no encode and no HMAC.
      return setCookie(name, value === "" ? "" : await sign(encodePayload(value)), defaults, attributes);
    },
  };
}
