import type { AuthAlgorithm } from "./types";

// `-8` is omitted because advertising an algorithm this runtime may not be able to verify is
// fail-open: the browser enrols an Ed25519 credential and the account is then locked out for good.
/** The COSE algorithms a passkey ceremony advertises unless a consumer opts into more. @public */
export const AUTH_SUPPORTED_ALGORITHMS: readonly AuthAlgorithm[] = [-7, -257];

/** The one role forge sources itself, and the name a `for-roles` policy is written against. @public */
export const AUTH_ADMIN_ROLE = "admin";

/** A key id is eight base64url characters, which is exactly the six kid bytes a token frame carries. @public */
export const AUTH_KEY_ID_LENGTH = 8;

/** Shortest expiration Workers KV accepts — session storage's floor, and the one a ceremony borrows. @public */
export const AUTH_KV_MIN_TTL_SECONDS = 60;

/** Digits in an emailed one-time code. @public */
export const AUTH_OTP_DIGITS = 6;

// Five minutes, not the ten NIST SP 800-63B §5.1.3.2 allows: the ceiling is what a deployment may
// raise this to, and a live code is a code an attacker has that long to spend.
/** How long an emailed one-time code stays valid, in milliseconds. @public */
export const AUTH_OTP_TTL_MS = 300_000;

/** How many guesses one code allows before it is refused outright. @public */
export const AUTH_OTP_MAX_ATTEMPTS = 3;

// A cooldown and not a count: any per-identity ceiling is a lockout an attacker spends on the
// victim's behalf, since issuing needs only an address.
/** How long one identity must wait between issued codes, in milliseconds. @public */
export const AUTH_OTP_COOLDOWN_MS = 60_000;

/** How long an authenticator-app factor stays refused once its guess budget is spent, in milliseconds. @public */
export const AUTH_TOTP_LOCKOUT_MS = 900_000;

// An absolute bound, not a sliding one: a session that is merely used often is a session an
// attacker who took it can keep alive forever. Seven days is the ceiling, whatever the activity.
/** How long a signed-in session stays valid from the moment it was established, in milliseconds. @public */
export const AUTH_SESSION_MAX_MS = 604_800_000;

/** How recent a step-up a state-changing request must carry, in milliseconds, unless a mount says otherwise. @public */
export const AUTH_FRESH_STEP_UP_MS = 900_000;

/** Bytes of entropy in a WebAuthn ceremony challenge — 32, twice the specification's floor. @public */
export const AUTH_PASSKEY_CHALLENGE_BYTES = 32;

/** Fewest bytes a configured challenge may carry — the WebAuthn specification's own floor. @public */
export const AUTH_PASSKEY_CHALLENGE_MIN_BYTES = 16;

/** How long a stored ceremony challenge stays valid, in seconds. @public */
export const AUTH_PASSKEY_TTL_SECONDS = 300;

/** Shortest ceremony lifetime a deployment may configure — a minute, below which a slow authenticator loses the race. @public */
export const AUTH_PASSKEY_TTL_MIN_SECONDS = AUTH_KV_MIN_TTL_SECONDS;

/** Longest ceremony lifetime a deployment may configure — a replayable challenge should not outlive an emailed code. @public */
export const AUTH_PASSKEY_TTL_MAX_SECONDS = 600;
