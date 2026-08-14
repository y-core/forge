import type { Cookie } from "@remix-run/cookie";
import type { Middleware } from "@remix-run/fetch-router";
import type { Session, SessionStorage } from "@remix-run/session";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";

/** Typed accessor for the session variable set by `sessionMiddleware`. @public */
export const sessionCtx = contextVar<Session>("session");

/** Reads the session cookie on the way in and persists it on the way out when dirty or destroyed. @public */
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
    setPendingHeader(context, "set-cookie", serializedCookie, { append: true });
    return res;
  };
}
