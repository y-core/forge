import type { Session } from "@remix-run/session";

// An id that escaped the request must be honoured on the next one, but where the cookie value *is*
// the id a restored session reproduces it for free — dirtying then re-writes an unchanged record.
/** Wraps a session so reading its id marks it dirty, unless `cookieValue` would already reproduce that id. @internal */
export function trackSessionId(session: Session, cookieValue: string | null): Session {
  let observed = false;
  const reproducible = cookieValue !== null && cookieValue !== "" && cookieValue === session.id;
  return new Proxy(session, {
    get(target, prop) {
      if (prop === "id") {
        observed = true;
      }
      if (prop === "dirty") {
        return target.dirty || (observed && !reproducible);
      }
      // Two args, so `target` is the receiver: `Session` holds `#private` fields a proxy receiver cannot reach.
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
