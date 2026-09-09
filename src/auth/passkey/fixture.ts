import { base64urlDecode, base64urlEncode, sha256, utf8Encode } from "../../crypto/mod";
import type { AuthAlgorithm } from "../types";
import type { PasskeyAssertionCredential } from "./authenticate";
import type { PasskeyRegistrationCredential } from "./register";

/** The authenticator-data flag bits, by the name the specification gives each. @internal */
export const PASSKEY_FLAG = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40, ed: 0x80 } as const;

/** Anything this fixture's CBOR encoder writes. @internal */
export type CeremonyCborValue = number | string | Uint8Array<ArrayBuffer> | Map<CeremonyCborValue, CeremonyCborValue>;

/** A generated credential key pair, with the COSE encoding of its public half. @internal */
export interface PasskeyKeyPair {
  readonly algorithm: AuthAlgorithm;
  readonly cosePublicKey: Uint8Array<ArrayBuffer>;
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

function head(major: number, value: number): number[] {
  if (value < 24) return [(major << 5) | value];
  if (value < 0x100) return [(major << 5) | 24, value];
  if (value < 0x10000) return [(major << 5) | 25, value >> 8, value & 0xff];
  return [(major << 5) | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Encodes the CTAP2 CBOR subset a ceremony carries, so a fixture is bytes and not a mocked parser. @internal */
export function ceremonyCborEncode(value: CeremonyCborValue): Uint8Array<ArrayBuffer> {
  if (typeof value === "number") return new Uint8Array(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === "string") {
    const text = utf8Encode(value);
    return new Uint8Array([...head(3, text.byteLength), ...text]);
  }
  if (value instanceof Uint8Array) return new Uint8Array([...head(2, value.byteLength), ...value]);
  const entries = [...value.entries()];
  return new Uint8Array([
    ...head(5, entries.length),
    ...entries.flatMap(([key, item]) => [...ceremonyCborEncode(key), ...ceremonyCborEncode(item)]),
  ]);
}

/** The inverse of `unwrapEcdsaSignature` — WebCrypto signs to `r‖s`, and an authenticator sends DER. */
function wrapEcdsaSignature(raw: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const integer = (part: Uint8Array<ArrayBuffer>): number[] => {
    let start = 0;
    while (start < part.byteLength - 1 && part[start] === 0) start++;
    const body = [...part.subarray(start)];
    if (((body[0] ?? 0) & 0x80) !== 0) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

async function coseOf(algorithm: AuthAlgorithm, publicKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  if (algorithm === -8) {
    const point = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
    return ceremonyCborEncode(
      new Map<CeremonyCborValue, CeremonyCborValue>([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, point],
      ]),
    );
  }
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  if (algorithm === -7) {
    return ceremonyCborEncode(
      new Map<CeremonyCborValue, CeremonyCborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, base64urlDecode(jwk.x ?? "")],
        [-3, base64urlDecode(jwk.y ?? "")],
      ]),
    );
  }
  return ceremonyCborEncode(
    new Map<CeremonyCborValue, CeremonyCborValue>([
      [1, 3],
      [3, -257],
      [-1, base64urlDecode(jwk.n ?? "")],
      [-2, base64urlDecode(jwk.e ?? "")],
    ]),
  );
}

/** Generates a credential key pair that signs the way an authenticator of that algorithm does. @internal */
export async function createPasskeyKeyPair(algorithm: AuthAlgorithm): Promise<PasskeyKeyPair> {
  const parameters: EcKeyGenParams | RsaHashedKeyGenParams | Algorithm =
    algorithm === -7
      ? { name: "ECDSA", namedCurve: "P-256" }
      : algorithm === -8
        ? { name: "Ed25519" }
        : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = (await crypto.subtle.generateKey(parameters as EcKeyGenParams, true, ["sign", "verify"])) as CryptoKeyPair;

  return {
    algorithm,
    cosePublicKey: await coseOf(algorithm, pair.publicKey),
    async sign(data) {
      if (algorithm === -7) {
        return wrapEcdsaSignature(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data)));
      }
      const name = algorithm === -8 ? "Ed25519" : "RSASSA-PKCS1-v1_5";
      return new Uint8Array(await crypto.subtle.sign({ name }, pair.privateKey, data));
    },
  };
}

/** What one authenticator-data blob declares. @internal */
export interface AuthenticatorDataFixture {
  readonly rpId: string;
  readonly flags: number;
  readonly signCount?: number;
  readonly credentialId?: Uint8Array<ArrayBuffer>;
  readonly cosePublicKey?: Uint8Array<ArrayBuffer>;
}

/** Builds one authenticator-data blob, with the attested credential segment when a key is supplied. @internal */
export async function fakeAuthenticatorData(fixture: AuthenticatorDataFixture): Promise<Uint8Array<ArrayBuffer>> {
  const header = [...(await sha256(fixture.rpId)), fixture.flags];
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, fixture.signCount ?? 0, false);
  if (!fixture.credentialId || !fixture.cosePublicKey) return new Uint8Array([...header, ...counter]);

  const length = new Uint8Array(2);
  new DataView(length.buffer).setUint16(0, fixture.credentialId.byteLength, false);
  return new Uint8Array([...header, ...counter, ...new Uint8Array(16).fill(0x11), ...length, ...fixture.credentialId, ...fixture.cosePublicKey]);
}

/** Builds one `clientDataJSON` blob, exactly as the browser would serialise it. @internal */
export function fakeClientData(fields: { type: string; challenge: string; origin: string; crossOrigin?: boolean }): Uint8Array<ArrayBuffer> {
  return utf8Encode(JSON.stringify(fields));
}

/** What one registration ceremony fixture declares. @internal */
export interface PasskeyRegistrationFixture {
  readonly key: PasskeyKeyPair;
  readonly rpId: string;
  readonly origin: string;
  readonly challenge: string;
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly flags?: number;
  readonly signCount?: number;
  readonly fmt?: string;
  readonly attStmt?: Map<CeremonyCborValue, CeremonyCborValue>;
  readonly transports?: readonly string[];
  readonly trailing?: Uint8Array<ArrayBuffer>;
}

/** Builds the registration credential a browser would post for one ceremony. @internal */
export async function fakePasskeyRegistration(fixture: PasskeyRegistrationFixture): Promise<PasskeyRegistrationCredential> {
  const authData = await fakeAuthenticatorData({
    rpId: fixture.rpId,
    flags: fixture.flags ?? PASSKEY_FLAG.up | PASSKEY_FLAG.uv | PASSKEY_FLAG.at,
    ...(fixture.signCount === undefined ? {} : { signCount: fixture.signCount }),
    credentialId: fixture.credentialId,
    cosePublicKey: fixture.key.cosePublicKey,
  });
  const attestation = ceremonyCborEncode(
    new Map<CeremonyCborValue, CeremonyCborValue>([
      ["fmt", fixture.fmt ?? "none"],
      ["attStmt", fixture.attStmt ?? new Map()],
      ["authData", authData],
    ]),
  );
  const object = fixture.trailing ? new Uint8Array([...attestation, ...fixture.trailing]) : attestation;

  return {
    id: base64urlEncode(fixture.credentialId),
    response: {
      clientDataJSON: base64urlEncode(fakeClientData({ type: "webauthn.create", challenge: fixture.challenge, origin: fixture.origin })),
      attestationObject: base64urlEncode(object),
      ...(fixture.transports ? { transports: fixture.transports } : {}),
    },
  };
}

/** What one authentication ceremony fixture declares. @internal */
export interface PasskeyAssertionFixture {
  readonly key: PasskeyKeyPair;
  readonly rpId: string;
  readonly origin: string;
  readonly challenge: string;
  readonly credentialId: string;
  readonly flags?: number;
  readonly signCount?: number;
  readonly userHandle?: string;
  readonly signOver?: Uint8Array<ArrayBuffer>;
}

/** Builds the assertion a browser would post, signed over `authenticatorData ‖ SHA-256(clientDataJSON)`. @internal */
export async function fakePasskeyAssertion(fixture: PasskeyAssertionFixture): Promise<PasskeyAssertionCredential> {
  const authenticatorData = await fakeAuthenticatorData({
    rpId: fixture.rpId,
    flags: fixture.flags ?? PASSKEY_FLAG.up | PASSKEY_FLAG.uv,
    ...(fixture.signCount === undefined ? {} : { signCount: fixture.signCount }),
  });
  const clientData = fakeClientData({ type: "webauthn.get", challenge: fixture.challenge, origin: fixture.origin });
  const hash = await sha256(clientData);
  const signed = fixture.signOver ?? new Uint8Array([...authenticatorData, ...hash]);

  return {
    id: fixture.credentialId,
    response: {
      clientDataJSON: base64urlEncode(clientData),
      authenticatorData: base64urlEncode(authenticatorData),
      signature: base64urlEncode(await fixture.key.sign(signed)),
      ...(fixture.userHandle ? { userHandle: fixture.userHandle } : {}),
    },
  };
}
