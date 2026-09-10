import { base64urlEncode, decodeCosePublicKey, sha256, timingSafeEqualBytes } from "../../crypto/mod";
import type { CosePublicKey } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { AuthData, AuthDataExpectation, AuthDataFlags, AuthDataReason } from "./types";

const RP_ID_HASH_BYTES = 32;
const FLAGS_OFFSET = RP_ID_HASH_BYTES;
const SIGN_COUNT_OFFSET = FLAGS_OFFSET + 1;
const HEADER_BYTES = SIGN_COUNT_OFFSET + 4;
const AAGUID_BYTES = 16;
/** WebAuthn L3 §7.1 caps a credential id here; a zero-length one is still a valid lookup key, so both ends are refused. */
const CREDENTIAL_ID_MAX_BYTES = 1023;

function readFlags(byte: number): AuthDataFlags {
  return {
    userPresent: (byte & 0x01) !== 0,
    userVerified: (byte & 0x04) !== 0,
    backupEligible: (byte & 0x08) !== 0,
    backedUp: (byte & 0x10) !== 0,
    attestedCredentialData: (byte & 0x40) !== 0,
  };
}

/** Parses authenticator data without judging it. @internal */
export function parseAuthData(bytes: Uint8Array<ArrayBuffer>): Result<AuthData, AuthDataReason> {
  if (bytes.byteLength < HEADER_BYTES) return err("malformed");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the length check above puts this index in range
  const flags = readFlags(bytes[FLAGS_OFFSET]!);
  const base = { rpIdHash: bytes.slice(0, RP_ID_HASH_BYTES), flags, signCount: view.getUint32(SIGN_COUNT_OFFSET, false) };
  if (!flags.attestedCredentialData) return ok(base);

  if (bytes.byteLength < HEADER_BYTES + AAGUID_BYTES + 2) return err("malformed");
  const idLength = view.getUint16(HEADER_BYTES + AAGUID_BYTES, false);
  if (idLength === 0 || idLength > CREDENTIAL_ID_MAX_BYTES) return err("malformed");
  const idStart = HEADER_BYTES + AAGUID_BYTES + 2;
  if (bytes.byteLength < idStart + idLength) return err("malformed");

  // The COSE key is followed by the extension bytes with no length between them, so the boundary
  // comes from the decoder reporting where it stopped — never from re-encoding to measure.
  const keyStart = idStart + idLength;
  let decoded: { key: CosePublicKey; bytesRead: number };
  try {
    decoded = decodeCosePublicKey(bytes.slice(keyStart));
  } catch {
    return err("unsupported-key");
  }

  return ok({
    ...base,
    attested: {
      credentialId: base64urlEncode(bytes.subarray(idStart, idStart + idLength)),
      publicKey: decoded.key,
      publicKeyBytes: bytes.slice(keyStart, keyStart + decoded.bytesRead),
    },
  });
}

/** Verifies authenticator data against what this deployment expects. @public */
export async function verifyAuthData(bytes: Uint8Array<ArrayBuffer>, expected: AuthDataExpectation): Promise<Result<AuthData, AuthDataReason>> {
  const parsed = parseAuthData(bytes);
  if (!parsed.ok) return parsed;
  const data = parsed.data;

  // Hashed and compared as bytes. Comparing it as text, or trying to recover a name from it, is
  // what makes a credential minted for another relying party look valid here.
  if (!timingSafeEqualBytes(data.rpIdHash, await sha256(expected.rpId))) return err("rp-id-mismatch");

  if (!data.flags.userPresent) return err("user-not-present");
  if (expected.requireUserVerification && !data.flags.userVerified) return err("user-not-verified");

  // The specification defines this combination as invalid: a credential that is not eligible for
  // backup cannot be backed up. Accepting it is accepting an authenticator lying about its state.
  if (!data.flags.backupEligible && data.flags.backedUp) return err("invalid-backup-state");

  if (expected.requireAttestedCredential && !data.attested) return err("malformed");

  return ok(data);
}
