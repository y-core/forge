import { base64urlEncode, randomBytes } from "../../crypto/mod";
import { authNonceKey, authNonceTtlSeconds, decodeAuthToken, encodeAuthToken } from "../keys/token";
import type { AuthDecoyStores } from "./types";
import type { AuthIssueOutcome } from "./types";

const DECOY_PAYLOAD_BYTES = 24;
/** A canonical id no UUIDv7 generator produces, so the decoy read costs an index lookup and finds nothing. */
const DECOY_USER_ID = "00000000-0000-7000-8000-000000000000";
const DECOY_TTL_MS = 60_000;
// Zero, so the upsert's own condition never refuses: the branch that finds nobody must spend the
// write the branch that finds somebody spends, on every request and not only on the uncontended one.
const DECOY_COOLDOWN_MS = 0;

/** The sealed token both decoy branches spend, which is the work a real challenge spends. */
function decoyToken(stores: AuthDecoyStores, at: number): Promise<string> {
  return encodeAuthToken(stores.keys, "verify", base64urlEncode(randomBytes(DECOY_PAYLOAD_BYTES)), DECOY_TTL_MS, { now: at });
}

// One asymmetry is left, and closing it would mean sending mail to an address nobody asked about:
// the real branch ends in `AuthNotifier.send` and this one cannot. Every statement before it matches.
/** Performs the sealing and the store write a real challenge performs and delivers nothing — the unknown-address branch. @internal */
export async function issueAuthDecoy(stores: AuthDecoyStores, at: number): Promise<AuthIssueOutcome> {
  // The branch that finds nothing must cost what the branch that finds a user costs. Deleting this
  // because it "does no work" puts the latency oracle back the moment a caller awaits the promise.
  const token = await decoyToken(stores, at);
  await stores.state.issue(DECOY_USER_ID, { token, attempts: 0, issuedAt: at, expiresAt: at + DECOY_TTL_MS }, DECOY_COOLDOWN_MS);
  return "decoyed";
}

// The nonce written here is one no token will ever present again, and it expires like any other, so
// `purgeAuthEphemera` reclaims it. That is the price of the write costing what the real one costs.
/** Performs every statement a verification performs and establishes nothing — the unknown-address branch. @internal */
export async function verifyAuthDecoy(stores: AuthDecoyStores, at: number): Promise<void> {
  // Without this, the branch finding no user returns after one lookup while the branch finding one
  // spends a guess, opens a sealed token and consumes a nonce — a latency oracle answering the
  // question the response itself refuses.
  const token = await decoyToken(stores, at);
  await stores.users.findById(DECOY_USER_ID);
  await stores.state.countAttempt(DECOY_USER_ID, 1, at);
  await decodeAuthToken(stores.keys, "verify", token, { now: at });
  const nonce = await authNonceKey(stores.keys, token);
  if (nonce.ok) await stores.nonces.markConsumed(nonce.data, authNonceTtlSeconds(DECOY_TTL_MS));
  await stores.state.clear(DECOY_USER_ID);
}
