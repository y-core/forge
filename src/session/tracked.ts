import type { Session } from "@remix-run/session";

/** Wraps a session so reading its id marks it dirty: an id that escaped the request must be persisted. @internal */
export function trackSessionId(session: Session): Session {
  let observed = false;
  return new Proxy(session, {
    get(target, prop) {
      if (prop === "id") {
        observed = true;
      }
      if (prop === "dirty") {
        return target.dirty || observed;
      }
      // Two args, so `target` is the receiver: `Session` holds `#private` fields a proxy receiver cannot reach.
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
