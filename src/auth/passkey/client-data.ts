import { timingSafeEqual, utf8Decode } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { ClientData, ClientDataExpectation, ClientDataReason, PasskeyCeremony } from "./types";

const CEREMONY_TYPE: Readonly<Record<PasskeyCeremony, string>> = { register: "webauthn.create", authenticate: "webauthn.get" };

/** Parses `clientDataJSON` bytes without judging them. @internal */
export function parseClientData(bytes: Uint8Array<ArrayBuffer>): Result<ClientData, ClientDataReason> {
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch {
    return err("malformed");
  }
  if (typeof value !== "object" || value === null) return err("malformed");
  const candidate = value as Partial<ClientData>;
  if (typeof candidate.type !== "string" || typeof candidate.challenge !== "string" || typeof candidate.origin !== "string")
    return err("malformed");
  return ok({
    type: candidate.type,
    challenge: candidate.challenge,
    origin: candidate.origin,
    ...(typeof candidate.crossOrigin === "boolean" ? { crossOrigin: candidate.crossOrigin } : {}),
    // Kept rather than dropped with the other unknown keys: `verifyClientData` refuses on it, and a
    // field this parse discarded is a field no verification could ever have judged.
    ...(typeof candidate.topOrigin === "string" ? { topOrigin: candidate.topOrigin } : {}),
  });
}

/** Verifies the client data of one ceremony against what this deployment expects. @public */
export function verifyClientData(bytes: Uint8Array<ArrayBuffer>, expected: ClientDataExpectation): Result<ClientData, ClientDataReason> {
  const parsed = parseClientData(bytes);
  if (!parsed.ok) return parsed;
  const data = parsed.data;

  if (data.type !== CEREMONY_TYPE[expected.ceremony]) return err("type-mismatch");

  // An exact string, never a prefix and never a host-only parse: `https://example.com.evil.test`
  // satisfies every relaxed form of this comparison and fails only the exact one.
  if (data.origin !== expected.origin) return err("origin-mismatch");

  // The encoded form is compared rather than the decoded bytes: decoding first would throw on input
  // an attacker fully controls, and a thrown error is not a refusal.
  if (!timingSafeEqual(data.challenge, expected.challenge)) return err("challenge-mismatch");

  // The specification permits a cross-origin ceremony; forge does not, because a credential
  // created inside a third party's iframe is one this deployment never saw the user consent to.
  if (data.crossOrigin === true) return err("cross-origin");

  // WebAuthn L3 §5.8.1 defines `topOrigin` only for a cross-origin ceremony, so one present without
  // `crossOrigin: true` is a client misreporting itself — and reporting it at all is the same claim
  // the line above refuses. Ignoring it would let that claim through unjudged.
  if (data.topOrigin !== undefined) return err("top-origin");

  return ok(data);
}
