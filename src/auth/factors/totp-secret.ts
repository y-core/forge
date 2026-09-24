import { utf8Encode } from "../../crypto/mod";
import { ok } from "../../result/result";
import type { Result } from "../../result/types";
import { openAtRest, sealAtRest } from "../keys/token";
import type { AuthAtRestRefusal } from "../keys/types";
import type { AuthKeyRing } from "../types";
import type { TotpSecretOpened } from "./types";

// Bound to the owner as associated data, so a sealed secret copied into another user's row will not
// open — a database write is then not enough to move a working factor between accounts.
function sealContext(userId: string): Uint8Array<ArrayBuffer> {
  return utf8Encode(`totp-app ${userId}`);
}

/** Seals a TOTP secret at rest as `kid(6) ‖ nonce(12) ‖ ciphertext‖tag`, under the ring's active key. @internal */
export function sealTotpSecret(ring: AuthKeyRing, userId: string, secret: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealAtRest(ring, "totpWrap", sealContext(userId), secret);
}

/** Opens a sealed TOTP secret, carrying through why the ring refused when it did. @internal */
export async function openTotpSecret(
  ring: AuthKeyRing,
  userId: string,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Result<TotpSecretOpened, AuthAtRestRefusal>> {
  const opened = await openAtRest(ring, "totpWrap", sealContext(userId), frame);
  return opened.ok ? ok({ secret: opened.data.plaintext, stale: opened.data.kid !== ring.activeKeyId }) : opened;
}
