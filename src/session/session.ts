import type { Cookie } from "@remix-run/cookie";
import type { Middleware } from "@remix-run/fetch-router";
import type { Session, SessionStorage } from "@remix-run/session";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";

/** Typed accessor for the session variable set by `sessionMiddleware`. @public */
export const sessionCtx = contextVar<Session>("session");

/**
 * Reads the session cookie on the way in and persists it on the way out.
 *
 * Persistence is skipped entirely for a session that was neither modified nor destroyed
 * (`dirty`/`destroyed`), so unchanged requests emit no `Set-Cookie` — this avoids a
 * cache-defeating cookie write per request for server-side stores. Callers that rely on
 * sliding expiry must touch the session (e.g. `session.set`) to mark it dirty. @public
 */
export function sessionMiddleware(storage: SessionStorage, cookie: Cookie): Middleware {
  return async (context, next) => {
    const cookieHeader = context.request.headers.get("cookie") ?? null;
    const cookieValue = await cookie.parse(cookieHeader);
    const session = await storage.read(cookieValue);
    sessionCtx.set(context, session);

    const res = await next();

    if (!session.dirty && !session.destroyed) {
      return res;
    }
    const serialized = await storage.save(session);
    if (serialized === null) {
      return res;
    }
    const serializedCookie = await cookie.serialize(serialized);
    // Queue on the pending channel; the single `applyHeaders` pass flushes it onto the response.
    setPendingHeader(context, "set-cookie", serializedCookie, { append: true });
    return res;
  };
}
