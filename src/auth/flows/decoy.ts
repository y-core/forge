import { base64urlEncode, randomBytes } from "../../crypto/mod";
import { decodeAuthToken, encodeAuthToken } from "../keys/token";
import type { AuthKeyRing, UserStore } from "../types";
import type { AuthIssueOutcome } from "./types";

const DECOY_PAYLOAD_BYTES = 24;
/** A canonical id no UUIDv7 generator produces, so the decoy read costs an index lookup and finds nothing. */
const DECOY_USER_ID = "00000000-0000-7000-8000-000000000000";
const DECOY_TTL_MS = 60_000;

/** Performs the sealing a real challenge performs and delivers nothing — the unknown-address branch. @internal */
export async function issueAuthDecoy(keys: AuthKeyRing, at: number): Promise<AuthIssueOutcome> {
  // The branch that finds nothing must cost what the branch that finds a user costs. Deleting this
  // because it "does no work" puts the latency oracle back the moment a caller awaits the promise.
  await encodeAuthToken(keys, "verify", base64urlEncode(randomBytes(DECOY_PAYLOAD_BYTES)), DECOY_TTL_MS, { now: at });
  return "decoyed";
}

/** Performs the row read and the opening a verification performs and establishes nothing — the unknown-address branch. @internal */
export async function verifyAuthDecoy(keys: AuthKeyRing, users: UserStore, at: number): Promise<void> {
  // Without this, the branch finding no user returns after one lookup while the branch finding one
  // opens a sealed token — a latency oracle answering the question the response itself refuses.
  const token = await encodeAuthToken(keys, "verify", base64urlEncode(randomBytes(DECOY_PAYLOAD_BYTES)), DECOY_TTL_MS, { now: at });
  await users.findById(DECOY_USER_ID);
  await decodeAuthToken(keys, "verify", token, { now: at });
}
