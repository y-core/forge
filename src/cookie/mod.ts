export { Cookie, type CookieOptions, createCookie } from "@remix-run/cookie";

import type { CookieOptions } from "@remix-run/cookie";
import { createCookie } from "@remix-run/cookie";

type SignedCookieOptions = Omit<CookieOptions, "httpOnly" | "secure" | "secrets"> & {
  secrets: [string, ...string[]];
  sameSite?: "Strict" | "Lax";
};

export function createSignedCookie(name: string, options: SignedCookieOptions) {
  return createCookie(name, {
    ...options,
    httpOnly: true,
    secure: true,
    sameSite: options.sameSite ?? "Lax",
  });
}
