import type { CookieOptions } from "@remix-run/cookie";
import { createCookie } from "@remix-run/cookie";

type SignedCookieOptions = Omit<CookieOptions, "httpOnly" | "secure" | "secrets"> & {
  secrets: [string, ...string[]];
  sameSite?: "Strict" | "Lax";
};

/** Creates a cookie that is always httpOnly, secure, and HMAC-signed via the provided secrets. */
export function createSignedCookie(name: string, options: SignedCookieOptions) {
  return createCookie(name, {
    ...options,
    httpOnly: true,
    secure: true,
    sameSite: options.sameSite ?? "Lax",
  });
}
