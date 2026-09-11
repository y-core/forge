import { describe, expect, it } from "bun:test";

import { createSession, Session } from "@remix-run/session";

import { trackSessionId } from "./tracked";

describe("trackSessionId()", () => {
  it("reports a clean session as not dirty until its id is read", () => {
    const tracked = trackSessionId(createSession(), null);
    expect(tracked.dirty).toBe(false);

    void tracked.id;
    expect(tracked.dirty).toBe(true);
  });

  it("stays dirty once the id has been observed", () => {
    const tracked = trackSessionId(createSession(), null);
    void tracked.id;
    expect(tracked.dirty).toBe(true);
    expect(tracked.dirty).toBe(true);
  });

  it("leaves an already-dirty session dirty", () => {
    const tracked = trackSessionId(createSession(), null);
    tracked.set("role", "admin");
    expect(tracked.dirty).toBe(true);
  });

  it("returns the target's own id", () => {
    const session = createSession();
    expect(trackSessionId(session, null).id).toBe(session.id);
  });

  // The defect this closes: the documented CSRF wiring reads `.id` on every request, so a session
  // storage keyed on the id re-wrote an unchanged record on every one of them.
  it("leaves a session clean when the cookie the client holds already reproduces its id", () => {
    const session = createSession();
    const tracked = trackSessionId(session, session.id);
    void tracked.id;
    expect(tracked.dirty).toBe(false);
  });

  it("still dirties when the presented cookie names a different session, which is a storage miss", () => {
    const tracked = trackSessionId(createSession(), "a-cookie-for-a-session-that-is-gone");
    void tracked.id;
    expect(tracked.dirty).toBe(true);
  });

  it("still dirties for a storage whose cookie value is not the id, which never reproduces one", () => {
    const session = createSession();
    const tracked = trackSessionId(session, "eyJhIjoxfQ.signature");
    void tracked.id;
    expect(tracked.dirty).toBe(true);
  });

  it("leaves a reproducible session dirty once something actually changed", () => {
    const session = createSession();
    const tracked = trackSessionId(session, session.id);
    void tracked.id;
    tracked.set("role", "admin");
    expect(tracked.dirty).toBe(true);
  });

  it("does not mark a sibling wrapper dirty", () => {
    const observed = trackSessionId(createSession(), null);
    const untouched = trackSessionId(createSession(), null);
    void observed.id;
    expect(untouched.dirty).toBe(false);
  });

  it("passes get, set, flash and destroy through to the target", () => {
    const session = createSession();
    const tracked = trackSessionId(session, null);

    tracked.set("role", "admin");
    expect(tracked.get("role")).toBe("admin");
    expect(session.get("role")).toBe("admin");

    tracked.flash("notice", "Saved!");
    expect(JSON.stringify(tracked.data)).toBe(JSON.stringify(session.data));

    tracked.destroy();
    expect(tracked.destroyed).toBe(true);
    expect(session.destroyed).toBe(true);
  });

  it("preserves instanceof Session", () => {
    expect(trackSessionId(createSession(), null)).toBeInstanceOf(Session);
  });
});
