import { createCookie } from "@remix-run/cookie";

import type { SignedCookieOptions } from "./types";

/** Creates a cookie that is always httpOnly, secure, and HMAC-signed via the provided secrets. @public */
export function createSignedCookie(name: string, options: SignedCookieOptions) {
  for (const secret of options.secrets) {
    if (secret.length < 32) {
      throw new Error(`createSignedCookie: each secret must be at least 32 characters (got ${secret.length})`);
    }
  }
  return createCookie(name, { ...options, httpOnly: true, secure: true, sameSite: options.sameSite ?? "Lax" });
}
