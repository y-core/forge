import type { Cookie } from "@remix-run/cookie";
import type { SessionStorage } from "@remix-run/session";
import type { MiddlewareHandler } from "hono";

export type { SessionStorage } from "@remix-run/session";
export { createSession, createSessionId, Session } from "@remix-run/session";
export { createCookieSessionStorage } from "@remix-run/session/cookie-storage";
export { createMemorySessionStorage } from "@remix-run/session/memory-storage";

export function sessionMiddleware(storage: SessionStorage, cookie: Cookie): MiddlewareHandler {
  return async (c, next) => {
    const cookieHeader = c.req.header("cookie") ?? null;
    const cookieValue = await cookie.parse(cookieHeader);
    const session = await storage.read(cookieValue);
    c.set("session", session);

    await next();

    const serialized = await storage.save(session);
    if (serialized !== null) {
      c.header("set-cookie", await cookie.serialize(serialized));
    }
  };
}
