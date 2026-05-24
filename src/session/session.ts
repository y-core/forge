import type { Cookie } from "@remix-run/cookie";
import type { Session, SessionStorage } from "@remix-run/session";
import type { MiddlewareHandler } from "hono";

/** Merge into your Hono app generic when using `sessionMiddleware` to type `c.get("session")`. @public */
export type SessionVariables = { Variables: { session: Session } };

export function sessionMiddleware(storage: SessionStorage, cookie: Cookie): MiddlewareHandler<SessionVariables> {
  return async (c, next) => {
    const cookieHeader = c.req.header("cookie") ?? null;
    const cookieValue = await cookie.parse(cookieHeader);
    const session = await storage.read(cookieValue);
    c.set("session", session);

    await next();

    const serialized = await storage.save(session);
    if (serialized !== null) {
      c.header("set-cookie", await cookie.serialize(serialized), { append: true });
    }
  };
}
