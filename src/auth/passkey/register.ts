import { base64urlDecodeOrNull, cborDecodeFirst } from "../../crypto/mod";
import type { CborValue } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_SUPPORTED_ALGORITHMS } from "../config";
import type { AuthStoreError } from "../errors";
import type { AuthAlgorithm, AuthCredential } from "../types";
import { verifyAuthData } from "./auth-data";
import { verifyClientData } from "./client-data";
import { passkeyChallengeKey } from "./options";
import { passkeyKeyImportable } from "./signature";
import type { PasskeyRegistrationInput, PasskeyRegistrationReason, PasskeyRegistrationVerifyOptions } from "./types";

/** The same bound `authPasskeyLabelSchema` holds a rename to, applied here so the store never sees a longer one. */
const LABEL_MAX = 64;
/** Six transports are defined; the list is a browser-supplied hint and is stored verbatim, so it is bounded on both axes. */
const TRANSPORTS_MAX = 8;
const TRANSPORT_MAX = 32;

interface AttestationObject {
  readonly authData: Uint8Array<ArrayBuffer>;
}

function parseAttestationObject(bytes: Uint8Array<ArrayBuffer>): Result<AttestationObject, PasskeyRegistrationReason> {
  let decoded: { value: CborValue; bytesRead: number };
  try {
    decoded = cborDecodeFirst(bytes);
  } catch {
    return err("malformed");
  }
  // Anything past the first CBOR item is not part of the attestation object, and accepting it lets
  // one ceremony smuggle a second payload past every check that reads only the first.
  if (decoded.bytesRead !== bytes.byteLength) return err("malformed");
  if (!(decoded.value instanceof Map)) return err("malformed");

  const fmt = decoded.value.get("fmt");
  if (typeof fmt !== "string") return err("malformed");
  if (fmt !== "none") return err("unsupported-attestation");

  const attStmt = decoded.value.get("attStmt");
  if (!(attStmt instanceof Map)) return err("malformed");
  // Refused rather than ignored: a statement arriving under the one format that declares it has
  // none is malformed, and ignoring it accepts bytes no check in this deployment ever reads.
  if (attStmt.size > 0) return err("attestation-not-empty");

  const authData = decoded.value.get("authData");
  if (!(authData instanceof Uint8Array)) return err("malformed");
  return ok({ authData });
}

/** Verifies a registration ceremony and stores the credential it establishes. @public */
export async function verifyPasskeyRegistration(
  options: PasskeyRegistrationVerifyOptions,
  input: PasskeyRegistrationInput,
  at: number,
): Promise<Result<AuthCredential, PasskeyRegistrationReason | AuthStoreError>> {
  // Taken before anything is judged, so every refusal below has already spent the challenge. A
  // verifier consuming it only on success leaves one challenge open to unlimited attempts.
  const taken = await options.challenges.take(passkeyChallengeKey("register", input.sessionId));
  if (!taken.ok) return err(taken.error);
  if (taken.data === null) return err("challenge-not-found");
  if (taken.data.sessionId !== input.sessionId) return err("session-mismatch");
  if (taken.data.userId !== input.userId) return err("subject-mismatch");

  const clientDataBytes = base64urlDecodeOrNull(input.credential.response.clientDataJSON);
  if (!clientDataBytes) return err("malformed");
  const clientData = verifyClientData(clientDataBytes, { ceremony: "register", challenge: taken.data.challenge, origin: options.origin });
  if (!clientData.ok) return err(clientData.error);

  const attestationBytes = base64urlDecodeOrNull(input.credential.response.attestationObject);
  if (!attestationBytes) return err("malformed");
  const attestation = parseAttestationObject(attestationBytes);
  if (!attestation.ok) return err(attestation.error);

  const authData = await verifyAuthData(attestation.data.authData, {
    rpId: options.rpId,
    requireUserVerification: options.requireUserVerification ?? false,
    requireAttestedCredential: true,
  });
  if (!authData.ok) return err(authData.error);
  const attested = authData.data.attested;
  if (!attested) return err("malformed");
  // WebAuthn L3 §7.1 makes the two the same value, so a disagreement is a client not reporting what
  // it enrolled. The attested id is still the one stored — this refuses rather than picks a winner.
  if (input.credential.id !== attested.credentialId) return err("credential-id-mismatch");

  const algorithm: AuthAlgorithm = attested.publicKey.algorithm;
  if (!(options.algorithms ?? AUTH_SUPPORTED_ALGORITHMS).includes(algorithm)) return err("unsupported-algorithm");

  // The import every sign-in runs, run once here: structural decoding accepts an off-curve point,
  // and discovering that at the first assertion enrols a credential that refuses the user for ever.
  if (!(await passkeyKeyImportable(attested.publicKey))) return err("unsupported-key");

  const label = input.label ?? null;
  if (label !== null && label.length > LABEL_MAX) return err("malformed");
  const transports = input.credential.response.transports ?? [];
  if (transports.length > TRANSPORTS_MAX || transports.some((transport) => transport.length > TRANSPORT_MAX)) return err("malformed");

  return options.credentials.create(
    {
      userId: input.userId,
      credentialId: attested.credentialId,
      publicKey: attested.publicKeyBytes,
      algorithm,
      signCount: authData.data.signCount,
      transports,
      backupEligible: authData.data.flags.backupEligible,
      backedUp: authData.data.flags.backedUp,
      label,
    },
    at,
  );
}
