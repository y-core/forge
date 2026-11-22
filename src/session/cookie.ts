import { signWithKeyRing, verifyWithKeyRing } from "../crypto/keyring/sign";
import { base64DecodeOrNull, base64Encode } from "../crypto/primitives/mod";
import {
  COOKIE_ATTRIBUTES_DEFAULT,
  decodePayload,
  encodePayload,
  mergeAttributes,
  readWire,
  refuseHostPrefixScope,
  refuseInsecurePrefix,
  setCookie,
} from "../http/cookie";
import type { CookieAttributes, ResolvedAttributes } from "../http/types";
import type { SignedCookie, SignedCookieAttributes, SignedCookieOptions, SignedCookieReading } from "./types";

// Digits only and length-capped: `Number(segment)` alone reads `0x10`, `1e9`, `+1`, `" 1 "` and
// `Infinity` as second spellings of one instant, and therefore as second wire forms for one cookie.
const EXPIRY_SEGMENT = /^\d{1,10}$/;
const EXPIRY_LIMIT = 9_999_999_999;

const SIGNED_COOKIE_PURPOSE = "signed-cookie";

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

/** Creates a cookie that is always httpOnly and HMAC-signed under a key ring, naming the signing key id on the wire. @public */
export function createSignedCookie(name: string, options: SignedCookieOptions): SignedCookie {
  if (name === "") throw new Error("createSignedCookie: name must not be empty");
  const { ring, sameSite, ...rest } = options;
  // `secure` is hardcoded, not an option: development is https at every hop, so it is correct there
  // by construction (`WORKERS_PLATFORM.md` §4e), and relaxing it ships a cookie readable in transit.
  const defaults: CookieAttributes = {
    path: COOKIE_ATTRIBUTES_DEFAULT.path,
    ...rest,
    sameSite: sameSite ?? COOKIE_ATTRIBUTES_DEFAULT.sameSite,
    httpOnly: COOKIE_ATTRIBUTES_DEFAULT.httpOnly,
    secure: COOKIE_ATTRIBUTES_DEFAULT.secure,
  };
  refuseHostPrefixScope("createSignedCookie", name, defaults);
  refuseInsecurePrefix("createSignedCookie", name, defaults);
  // Fixed at construction because `parse` has no per-call attributes to consult: a value omitting an
  // expiry where a lifetime is configured is not a value of this cookie, and answers `null`.
  const bounded = expiryOf(mergeAttributes(defaults, undefined)) !== null;
  const purpose = `${SIGNED_COOKIE_PURPOSE}/${name}`;

  async function sign(operation: string, payload: string, expiry: number | null): Promise<string> {
    const kid = ring.activeKeyId;
    // The HMAC covers the expiry, so `Max-Age` stops being client-advisory. Neither standard base64
    // nor a base64url kid holds a `.`, so the segments split apart.
    const signed = `${expiry === null ? payload : `${expiry}.${payload}`}.${kid}`;
    const { mac } = await signWithKeyRing(operation, ring, purpose, signed);
    return `${signed}.${base64Encode(mac).replace(/=+$/, "")}`;
  }

  async function unsign(operation: string, wire: string): Promise<SignedCookieReading | null> {
    const dot = wire.lastIndexOf(".");
    if (dot === -1) return null;
    const signed = wire.slice(0, dot);
    const signature = base64DecodeOrNull(wire.slice(dot + 1));
    if (signature === null) return null;
    const kidDot = signed.lastIndexOf(".");
    if (kidDot === -1) return null;
    const covered = signed.slice(0, kidDot);
    const kid = signed.slice(kidDot + 1);
    // The signature before the expiry, always: reading the expiry off an unverified value acts on an
    // attacker's number, and answering "expired" ahead of "forged" draws a distinction no caller wants.
    if ((await verifyWithKeyRing(operation, ring, purpose, kid, signed, signature)) !== "verified") return null;
    const current = kid === ring.activeKeyId;
    if (!bounded) return { value: decodePayload(covered), current };
    const split = covered.indexOf(".");
    if (split === -1) return { value: null, current };
    const expiry = covered.slice(0, split);
    if (!EXPIRY_SEGMENT.test(expiry) || Number(expiry) * 1000 <= Date.now()) return { value: null, current };
    return { value: decodePayload(covered.slice(split + 1)), current };
  }

  async function readAs(operation: string, header: string | null): Promise<SignedCookieReading | null> {
    const wire = readWire(header, name);
    if (wire === null) return null;
    // `""` short-circuits both directions, so the destroy sentinel survives a round trip.
    if (wire === "") return { value: "", current: true };
    // A reading, never `null`, once the name is on the header: `null` is reserved for "this cookie was
    // not sent at all", which is the one thing `parse` cannot report and a caller clearing it must know.
    return (await unsign(operation, wire)) ?? { value: null, current: false };
  }

  return {
    name,
    rotating: Object.keys(ring.keys).length > 1,
    maxAge: rest.maxAge,
    read(header: string | null): Promise<SignedCookieReading | null> {
      return readAs("read", header);
    },
    async parse(header: string | null): Promise<string | null> {
      return (await readAs("parse", header))?.value ?? null;
    },
    async serialize(value: string, attributes?: SignedCookieAttributes): Promise<string> {
      // Re-forced over the override, not merely set in the defaults: the override wins in the merge,
      // so an `as any` or a decorating wrapper could otherwise relax what the type refuses to take.
      const merged = mergeAttributes(defaults, { ...attributes, httpOnly: true, secure: true });
      refuseHostPrefixScope("serialize", name, merged);
      refuseInsecurePrefix("serialize", name, merged);
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
      return setCookie(name, await sign("serialize", encodePayload(value), expiry), merged);
    },
  };
}
