import { utf8Encode } from "../../crypto/mod";
import { openAtRest, sealAtRest } from "../keys/token";
import type { AuthKeyRing } from "../types";

// Bound to the owner as associated data, so a sealed secret copied into another user's row will not
// open — a database write is then not enough to move a working factor between accounts.
function sealContext(userId: string): Uint8Array<ArrayBuffer> {
  return utf8Encode(`totp-app ${userId}`);
}

/** Seals a TOTP secret at rest as `kid(6) ‖ nonce(12) ‖ ciphertext‖tag`, under the ring's active key. @internal */
export function sealTotpSecret(ring: AuthKeyRing, userId: string, secret: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealAtRest(ring, "totpWrap", sealContext(userId), secret);
}

/** Opens a sealed TOTP secret, answering `null` when the frame, the key or the owner does not match. @internal */
export function openTotpSecret(ring: AuthKeyRing, userId: string, frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  return openAtRest(ring, "totpWrap", sealContext(userId), frame);
}
