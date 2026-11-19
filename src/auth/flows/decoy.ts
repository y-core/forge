import { base64urlEncode, randomBytes, sha256 } from "../../crypto/primitives/mod";
import { AUTH_OTP_GUESS_WINDOW_MS } from "../config";
import { authStandInToken, decodeAuthToken, encodeAuthToken } from "../keys/token";
import type { AuthDecoyStores } from "./types";
import type { AuthIssueOutcome } from "./types";

const DECOY_PAYLOAD_BYTES = 24;
/** A canonical id no UUIDv7 generator produces, so the decoy read costs an index lookup and finds nothing. */
const DECOY_USER_ID = "00000000-0000-7000-8000-000000000000";
const DECOY_TTL_MS = 60_000;
// Zero, so the upsert's own condition never refuses: the branch that finds nobody must spend the
// write the branch that finds somebody spends, on every request and not only on the uncontended one.
const DECOY_COOLDOWN_MS = 0;

/** The binding both decoy branches hash, as long as the one `authOtpBinding` mints, so its SHA-256 costs what a real caller's costs. */
const DECOY_BINDING = "0".repeat(43);

/** The guess ceiling the decoy spends, matching what a real verification spends against a live row. */
const DECOY_MAX_ATTEMPTS = 1;

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
  const binding = await sha256(DECOY_BINDING);
  const token = await decoyToken(stores, at);
  const written = await stores.state.issue(
    DECOY_USER_ID,
    { token, attempts: 0, issuedAt: at, expiresAt: at + DECOY_TTL_MS },
    DECOY_COOLDOWN_MS,
    binding,
  );
  // Reported rather than discarded: `auth_otp_state.user_id` references `auth_users` and
  // `DECOY_USER_ID` names no row, so where foreign keys are enforced this write does not land.
  return written.ok ? "decoyed" : "unavailable";
}

// Equalised against the *refusal*, not against success — and against the one profile every refusal
// now has: two statements and one AEAD open, whatever the row it was refused against looked like.
/** Spends what a refused verification spends and establishes nothing — the unknown-address branch. @internal */
export async function verifyAuthDecoy(stores: AuthDecoyStores, at: number): Promise<void> {
  const binding = await sha256(DECOY_BINDING);
  // The same stand-in a refusal with no row to read opens, so this branch seals nothing either.
  const token = await authStandInToken(stores.keys, "verify");
  // The outcomes are deliberately not read: neither statement against an absent row loses anything,
  // and branching on what they said is the oracle this function exists to close.
  await stores.state.countAttempt(DECOY_USER_ID, DECOY_MAX_ATTEMPTS, at, AUTH_OTP_GUESS_WINDOW_MS, binding);
  await stores.state.read(DECOY_USER_ID, at, binding);
  await decodeAuthToken(stores.keys, "verify", token, { now: at });
}
