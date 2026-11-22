import { base64DecodeOrNull, base64Encode } from "../crypto/primitives/base64";
import { utf8Encode } from "../crypto/primitives/bytes";
import { Cookie as CookieHeader, SetCookie } from "./headers";
import type { SetCookieInit } from "./headers";
import type { CookieAttributes, ResolvedAttributes, UnsignedCookie, UnsignedCookieOptions } from "./types";

/** The attributes every framework-set cookie carries unless its caller overrides them. @public */
export const COOKIE_ATTRIBUTES_DEFAULT = { path: "/", sameSite: "Lax", httpOnly: true, secure: true } as const satisfies CookieAttributes;

// Not `crypto/primitives`' shared TEXT_DECODER: that one is lenient, so malformed bytes would decode to
// U+FFFD mojibake and flow into JSON.parse or the session store instead of answering `null`.
const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

// RFC 6265 §6.1's floor, measured across name, value and attributes together. Upstream names it in a
// doc-comment and enforces nothing; a browser over it discards the whole header without a word.
const COOKIE_MAX_BYTES = 4096;

const HOST_PREFIX = /^__host-/i;
const SECURE_REQUIRED_PREFIX = /^__(?:host|secure)-/i;

/** Encodes a value to its wire payload: `base64(utf8(value))`, standard alphabet, padding retained. @internal */
export function encodePayload(value: string): string {
  // A lone surrogate is unrepresentable in UTF-8: TextEncoder would substitute U+FFFD and `parse`
  // would not return what `serialize` was given, so refuse it rather than corrupt it silently.
  if (!value.isWellFormed()) {
    throw new Error("cookie value must not contain lone surrogates");
  }
  return base64Encode(utf8Encode(value));
}

/** Decodes a wire payload back to its value, answering `null` for anything that is not one. @internal */
export function decodePayload(payload: string): string | null {
  const bytes = base64DecodeOrNull(payload);
  if (bytes === null) return null;
  try {
    return STRICT_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/** Reads this cookie's raw wire value out of a `Cookie` header. @internal */
export function readWire(header: string | null, name: string): string | null {
  if (!header) return null;
  const cookies = new CookieHeader(header);
  if (!cookies.has(name)) return null;
  return cookies.get(name) ?? null;
}

/** Merges a per-call override over the construction defaults, one field at a time. @internal */
export function mergeAttributes(defaults: CookieAttributes, override: CookieAttributes | undefined): ResolvedAttributes {
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

/** Refuses a `__Host-` name scoped wider than a browser stores it under: with a domain, or on any path but `/`. @internal */
export function refuseHostPrefixScope(caller: string, name: string, attributes: { domain?: string | undefined; path?: string | undefined }): void {
  if (!HOST_PREFIX.test(name)) return;
  if (attributes.domain !== undefined)
    throw new Error(`${caller}: "${name}" is a __Host- cookie, so it must not carry a domain (got ${attributes.domain})`);
  if (attributes.path !== "/") throw new Error(`${caller}: "${name}" is a __Host- cookie, so its path must be "/" (got ${attributes.path})`);
}

/** Refuses a `__Host-` or `__Secure-` name without `Secure`, which a browser drops on arrival. @internal */
export function refuseInsecurePrefix(caller: string, name: string, attributes: { secure?: boolean | undefined }): void {
  if (!SECURE_REQUIRED_PREFIX.test(name) || attributes.secure === true) return;
  const prefix = HOST_PREFIX.test(name) ? "__Host-" : "__Secure-";
  throw new Error(`${caller}: "${name}" is a ${prefix} cookie, so it must be Secure (got secure: ${attributes.secure})`);
}

/** Builds the `Set-Cookie` header value, dropping every attribute left undefined by the merge, and refusing one no browser would store. @internal */
export function setCookie(name: string, wire: string, attributes: ResolvedAttributes): string {
  const init: Record<string, unknown> = { name, value: wire };
  for (const [field, value] of Object.entries(attributes)) {
    if (value !== undefined) init[field] = value;
  }
  const header = new SetCookie(init as SetCookieInit).toString();
  const bytes = utf8Encode(header).length;
  // Throwing here puts the failure at the write. Silently emitting it surfaces as a 403 from
  // the CSRF policy on the next mutation, three layers from the session that was dropped.
  if (bytes > COOKIE_MAX_BYTES) {
    throw new Error(`serialize: the Set-Cookie for "${name}" must be at most ${COOKIE_MAX_BYTES} bytes, or a browser discards it (got ${bytes})`);
  }
  return header;
}

/** Creates an unsigned cookie: the value is base64-encoded on the wire but carries no authentication. @public */
export function createUnsignedCookie(name: string, options?: UnsignedCookieOptions): UnsignedCookie {
  if (name === "") throw new Error("createUnsignedCookie: name must not be empty");
  const defaults: CookieAttributes = { path: COOKIE_ATTRIBUTES_DEFAULT.path, sameSite: COOKIE_ATTRIBUTES_DEFAULT.sameSite, ...options };
  if (SECURE_REQUIRED_PREFIX.test(name)) defaults.secure ??= true;
  refuseHostPrefixScope("createUnsignedCookie", name, defaults);
  refuseInsecurePrefix("createUnsignedCookie", name, defaults);

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
      const merged = mergeAttributes(defaults, attributes);
      refuseHostPrefixScope("serialize", name, merged);
      refuseInsecurePrefix("serialize", name, merged);
      return setCookie(name, value === "" ? "" : encodePayload(value), merged);
    },
  };
}
