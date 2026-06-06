// Canonical app-cookie API: use `createCookie`/`Cookie` (parse + serialize, signing support)
// for any application cookie. The low-level `SetCookie` builder from `@y-core/forge/http` is for
// raw header construction only — prefer `createCookie` for app code.
export { Cookie, type CookieOptions, createCookie } from "@remix-run/cookie";
export type { SessionStorage } from "@remix-run/session";
export { createSession, createSessionId, Session } from "@remix-run/session";
export { createCookieSessionStorage } from "@remix-run/session/cookie-storage";
export { createMemorySessionStorage } from "@remix-run/session/memory-storage";
export { sessionCtx, sessionMiddleware } from "./session";
export { createSignedCookie } from "./signed";
