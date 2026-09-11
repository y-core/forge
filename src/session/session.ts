import type { Middleware } from "@remix-run/fetch-router";
import { Cookie as CookieHeader } from "@remix-run/headers/cookie";
import { SetCookie } from "@remix-run/headers/set-cookie";
import type { Session, SessionStorage } from "@remix-run/session";

import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";
import { trackSessionId } from "./tracked";
import type { SessionCookieOptions, SignedCookie, UnsignedCookie } from "./types";

/** Typed accessor for the session variable set by `sessionMiddleware`. @public */
export const sessionCtx = contextVar<Session>("session");

/** Reads the session cookie on the way in and persists it on the way out only when the cookie would differ from the one the client holds, comparing wire bytes under `rotating` so a retired signature is upgraded. @public */
export function sessionMiddleware(storage: SessionStorage, cookie: SignedCookie | UnsignedCookie, options?: SessionCookieOptions): Middleware {
  const reissue = options?.reissue ?? false;
  // The cookie already knows whether a rotation is in flight, so the default is right without being
  // remembered; the option survives as an override, for a retired secret kept in the array long-term.
  const rotating = options?.rotating ?? ("rotating" in cookie && cookie.rotating);
  return async (context, next) => {
    const cookieHeader = context.request.headers.get("cookie") ?? null;
    const cookieValue = await cookie.parse(cookieHeader);
    const session = trackSessionId(await storage.read(cookieValue), cookieValue);
    sessionCtx.set(context, session);

    const res = await next();

    const saved = session.dirty || session.destroyed ? await storage.save(session) : null;
    // `??`, never `||`: `""` is the destroy sentinel. A `null` parse is a tampered or
    // retired-secret cookie and must never be re-signed back into validity.
    const value = saved ?? (cookieValue !== null && cookieValue !== "" ? cookieValue : null);
    if (value === null) return res;

    // HMAC is deterministic, so an unchanged payload re-signs to the bytes the client holds unless
    // the signing secret moved. The payload therefore decides on its own, and the signature is worth
    // computing only to tell a current secret from a retired one — which cannot arise off rotation.
    const unchanged = !reissue && value === cookieValue;
    if (unchanged && !rotating) return res;

    const fresh = await cookie.serialize(value);
    if (unchanged) {
      // The wire bytes, not the payload: `parse` verifies against every secret, so this is the one
      // comparison that can see a retired signature — which is why a rotation could never complete.
      const sent = cookieHeader === null ? null : new CookieHeader(cookieHeader).get(cookie.name);
      if (new SetCookie(fresh).value === sent) return res;
    }
    // One emit point: `setPendingHeader` and `applyPendingHeaders` both append without deduping
    // by cookie name, so a second site would double-emit under `reissue`.
    setPendingHeader(context, "set-cookie", fresh, { append: true });
    return res;
  };
}
