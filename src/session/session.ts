import type { Middleware } from "@remix-run/fetch-router";
import type { Session, SessionStorage } from "@remix-run/session";

import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";
import { trackSessionId } from "./tracked";
import type { SessionCookieOptions, SignedCookie } from "./types";

/** Typed accessor for the session variable set by `sessionMiddleware`. @public */
export const sessionCtx = contextVar<Session>("session");

/** Reads the session cookie on the way in and persists it on the way out only when the cookie would differ from the one the client holds, re-issuing under `rotating` so a retired signature is upgraded. @public */
export function sessionMiddleware(storage: SessionStorage, cookie: SignedCookie, options?: SessionCookieOptions): Middleware {
  const reissue = options?.reissue ?? false;
  // The cookie already knows whether a rotation is in flight, so the default is right without being
  // remembered; the option survives as an override, for a retired secret kept in the array long-term.
  const rotating = options?.rotating ?? cookie.rotating;
  return async (context, next) => {
    const reading = await cookie.read(context.request.headers.get("cookie") ?? null);
    const cookieValue = reading?.value ?? null;
    const session = trackSessionId(await storage.read(cookieValue), cookieValue);
    sessionCtx.set(context, session);

    const res = await next();

    const saved = session.dirty || session.destroyed ? await storage.save(session) : null;
    // `??`, never `||`: `""` is the destroy sentinel. A `null` parse is a tampered or
    // retired-secret cookie and must never be re-signed back into validity.
    const value = saved ?? (cookieValue !== null && cookieValue !== "" ? cookieValue : null);
    if (value === null) return res;

    const unchanged = !reissue && value === cookieValue;
    // The cookie reports which secret verified the value outright: re-signing to compare wire bytes
    // could never see it once an embedded expiry makes those bytes differ every second.
    const retired = rotating && reading !== null && !reading.current;
    if (unchanged && !retired) return res;

    // One emit point: `setPendingHeader` and `applyPendingHeaders` both append without deduping
    // by cookie name, so a second site would double-emit under `reissue`.
    setPendingHeader(context, "set-cookie", await cookie.serialize(value, value === "" ? { maxAge: 0 } : undefined), { append: true });
    return res;
  };
}
