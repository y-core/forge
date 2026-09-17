import { Cookie as CookieHeader } from "@remix-run/headers/cookie";
import { SetCookie } from "@remix-run/headers/set-cookie";
import type { SetCookieInit } from "@remix-run/headers/set-cookie";

import { base64DecodeOrNull, base64Encode, hmacSign, hmacVerify, importHmacKey, utf8Encode } from "../crypto/mod";
import type {
  CookieAttributes,
  SignedCookie,
  SignedCookieAttributes,
  SignedCookieOptions,
  SignedCookieReading,
  UnsignedCookie,
  UnsignedCookieOptions,
} from "./types";

// Not `crypto/mod`'s shared TEXT_DECODER: that one is lenient, so malformed bytes would decode to
// U+FFFD mojibake and flow into JSON.parse or the session store instead of answering `null`.
const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

// Digits only and length-capped: `Number(segment)` alone reads `0x10`, `1e9`, `+1`, `" 1 "` and
// `Infinity` as second spellings of one instant, and therefore as second wire forms for one cookie.
const EXPIRY_SEGMENT = /^\d{1,10}$/;
const EXPIRY_LIMIT = 9_999_999_999;

// RFC 6265 §6.1's floor, measured across name, value and attributes together. Upstream names it in a
// doc-comment and enforces nothing; a browser over it discards the whole header without a word.
const COOKIE_MAX_BYTES = 4096;

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

/** Every cookie attribute resolved to the one value a call settled on, `undefined` where neither side named it. */
type ResolvedAttributes = { [field in keyof Required<CookieAttributes>]: CookieAttributes[field] | undefined };

/** Merges a per-call override over the construction defaults, one field at a time. */
function mergeAttributes(defaults: CookieAttributes, override: CookieAttributes | undefined): ResolvedAttributes {
  // `??` per field, never `||`: `maxAge: 0` is the flash-clear path and must survive the merge.
  const partitioned = override?.partitioned ?? defaults.partitioned;
  return {
    domain: override?.domain ?? defaults.domain,
    expires: override?.expires ?? defaults.expires,
    httpOnly: override?.httpOnly ?? defaults.httpOnly,
    maxAge: override?.maxAge ?? defaults.maxAge,
    partitioned,
    path: override?.path ?? defaults.path,
    sameSite: override?.sameSite ?? defaults.sameSite,
    // A partitioned cookie is only honoured alongside Secure.
    secure: partitioned === true ? true : (override?.secure ?? defaults.secure),
  };
}

/** The epoch second past which a value serialized under `attributes` stops verifying, or `null` where they bound nothing. */
function expiryOf(attributes: ResolvedAttributes): number | null {
  const now = Math.floor(Date.now() / 1000);
  let at: number;
  if (attributes.maxAge !== undefined) {
    if (!Number.isFinite(attributes.maxAge)) throw new Error(`createSignedCookie: maxAge must be a finite number (got ${attributes.maxAge})`);
    // A non-positive `maxAge` is a delete instruction rather than a lifetime, so it binds nothing:
    // embedding `exp = now` would mint a value that is already past its own expiry.
    if (attributes.maxAge <= 0) return null;
    at = now + Math.floor(attributes.maxAge);
  } else if (attributes.expires !== undefined) {
    at = Math.floor(attributes.expires.getTime() / 1000);
    if (!Number.isFinite(at)) throw new Error("createSignedCookie: expires must be a valid date");
    // Answering `null` here would spell "no lifetime configured", and a cookie asked to expire in the
    // past would instead sign every value it ever mints to verify forever.
    if (at <= now) throw new Error(`createSignedCookie: expires must be in the future (got ${attributes.expires?.toISOString()})`);
  } else {
    return null;
  }
  // Past ten digits the segment stops round-tripping, so a `maxAge` handed milliseconds would mint
  // values that never parse again — every session vanishing with nothing anywhere to read.
  if (at > EXPIRY_LIMIT) throw new Error(`createSignedCookie: the expiry must be at most ${EXPIRY_LIMIT} epoch seconds (got ${at})`);
  return at;
}

/** Builds the `Set-Cookie` header value, dropping every attribute left undefined by the merge, and refusing one no browser would store. */
function setCookie(name: string, wire: string, attributes: ResolvedAttributes): string {
  const init: Record<string, unknown> = { name, value: wire };
  for (const [field, value] of Object.entries(attributes)) {
    if (value !== undefined) init[field] = value;
  }
  const header = new SetCookie(init as SetCookieInit).toString();
  const bytes = utf8Encode(header).length;
  // Throwing here puts the failure at the write. Silently emitting it surfaces as a 403 from
  // `csrfProtection` on the next mutation, three layers from the session that was dropped.
  if (bytes > COOKIE_MAX_BYTES) {
    throw new Error(`serialize: the Set-Cookie for "${name}" must be at most ${COOKIE_MAX_BYTES} bytes, or a browser discards it (got ${bytes})`);
  }
  return header;
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
      return setCookie(name, value === "" ? "" : encodePayload(value), mergeAttributes(defaults, attributes));
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
  // by construction (`WORKERS_PLATFORM.md` §4e), and relaxing it ships a cookie readable in transit.
  const defaults: CookieAttributes = { path: "/", ...rest, sameSite: sameSite ?? "Lax", httpOnly: true, secure: true };
  // Fixed at construction because `parse` has no per-call attributes to consult: a value omitting an
  // expiry where a lifetime is configured is not a value of this cookie, and answers `null`.
  const bounded = expiryOf(mergeAttributes(defaults, undefined)) !== null;

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

  async function sign(payload: string, expiry: number | null): Promise<string> {
    // The HMAC covers the base64 payload and, where a lifetime is configured, the expiry ahead of it,
    // so `Max-Age` stops being client-advisory. Standard base64 holds no `.`, so the segments split apart.
    const covered = expiry === null ? payload : `${expiry}.${payload}`;
    const signature = await hmacSign(await keyFor(0, secrets[0]), covered);
    return `${covered}.${base64Encode(signature).replace(/=+$/, "")}`;
  }

  async function unsign(wire: string): Promise<SignedCookieReading | null> {
    // `lastIndexOf`, not `indexOf`: the signature is the final segment, whatever precedes it.
    const dot = wire.lastIndexOf(".");
    if (dot === -1) return null;
    const covered = wire.slice(0, dot);
    const signature = base64DecodeOrNull(wire.slice(dot + 1));
    if (signature === null) return null;
    let signedBy = -1;
    for (const [index, secret] of secrets.entries()) {
      if (await hmacVerify(await keyFor(index, secret), covered, signature)) {
        signedBy = index;
        break;
      }
    }
    // The signature before the expiry, always: reading the expiry off an unverified value acts on an
    // attacker's number, and answering "expired" ahead of "forged" draws a distinction no caller wants.
    if (signedBy === -1) return null;
    const current = signedBy === 0;
    if (!bounded) return { value: decodePayload(covered), current };
    const split = covered.indexOf(".");
    if (split === -1) return { value: null, current };
    const expiry = covered.slice(0, split);
    if (!EXPIRY_SEGMENT.test(expiry) || Number(expiry) * 1000 <= Date.now()) return { value: null, current };
    return { value: decodePayload(covered.slice(split + 1)), current };
  }

  async function read(header: string | null): Promise<SignedCookieReading | null> {
    const wire = readWire(header, name);
    if (wire === null) return null;
    // `""` short-circuits both directions, so the destroy sentinel survives a round trip.
    if (wire === "") return { value: "", current: true };
    // A reading, never `null`, once the name is on the header: `null` is reserved for "this cookie was
    // not sent at all", which is the one thing `parse` cannot report and a caller clearing it must know.
    return (await unsign(wire)) ?? { value: null, current: false };
  }

  return {
    name,
    rotating: secrets.length > 1,
    read,
    async parse(header: string | null): Promise<string | null> {
      return (await read(header))?.value ?? null;
    },
    async serialize(value: string, attributes?: SignedCookieAttributes): Promise<string> {
      // Re-forced over the override, not merely set in the defaults: the override wins in the merge,
      // so an `as any` or a decorating wrapper could otherwise relax what the type refuses to take.
      const merged = mergeAttributes(defaults, { ...attributes, httpOnly: true, secure: true });
      // `""` short-circuits both directions: the destroy path costs no encode and no HMAC.
      if (value === "") return setCookie(name, "", merged);
      let expiry: number | null = null;
      if (bounded) {
        expiry = expiryOf(merged);
        // `bounded` is fixed at construction but these attributes are not, so an override can leave a
        // lifetime-carrying cookie with nothing to embed — and `read` rejects exactly that value.
        if (expiry === null)
          throw new Error(`serialize: "${name}" carries a lifetime, so a non-empty value needs a positive maxAge or a future expires`);
      }
      return setCookie(name, await sign(encodePayload(value), expiry), merged);
    },
  };
}
