import { openAtRestUnder, sealAtRestUnder } from "../../crypto/keyring/seal";
import type { AtRestBinding, AtRestRefusal, KeyRing } from "../../crypto/keyring/types";
import { utf8Encode } from "../../crypto/primitives/mod";
import { ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_KEY_DOMAIN } from "../keys/ring";
import type { AuthTokenPurpose } from "../keys/types";
import type { TotpSecretOpened } from "./types";

// Bound to the owner as associated data, so a sealed secret copied into another user's row will not
// open — a database write is then not enough to move a working factor between accounts.
function sealBinding(userId: string): AtRestBinding {
  return { purpose: "totpWrap" satisfies AuthTokenPurpose, context: utf8Encode(`totp-app ${userId}`) };
}

/** Seals a TOTP secret at rest as `kid(6) ‖ nonce(12) ‖ ciphertext‖tag`, under the ring's active key. @internal */
export function sealTotpSecret(ring: KeyRing, userId: string, secret: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealAtRestUnder(ring, AUTH_KEY_DOMAIN, sealBinding(userId), secret);
}

/** Opens a sealed TOTP secret, carrying through why the ring refused when it did. @internal */
export async function openTotpSecret(
  ring: KeyRing,
  userId: string,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Result<TotpSecretOpened, AtRestRefusal>> {
  const opened = await openAtRestUnder(ring, AUTH_KEY_DOMAIN, sealBinding(userId), frame);
  return opened.ok ? ok({ secret: opened.data.plaintext, stale: opened.data.kid !== ring.activeKeyId }) : opened;
}
