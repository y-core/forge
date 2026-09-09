import { describe, expect, it } from "bun:test";

import { createSession, Session } from "@remix-run/session";

import { trackSessionId } from "./tracked";

describe("trackSessionId()", () => {
  it("reports a clean session as not dirty until its id is read", () => {
    const tracked = trackSessionId(createSession());
    expect(tracked.dirty).toBe(false);

    void tracked.id;
    expect(tracked.dirty).toBe(true);
  });

  it("stays dirty once the id has been observed", () => {
    const tracked = trackSessionId(createSession());
    void tracked.id;
    expect(tracked.dirty).toBe(true);
    expect(tracked.dirty).toBe(true);
  });

  it("leaves an already-dirty session dirty", () => {
    const tracked = trackSessionId(createSession());
    tracked.set("role", "admin");
    expect(tracked.dirty).toBe(true);
  });

  it("returns the target's own id", () => {
    const session = createSession();
    expect(trackSessionId(session).id).toBe(session.id);
  });

  it("does not mark a sibling wrapper dirty", () => {
    const observed = trackSessionId(createSession());
    const untouched = trackSessionId(createSession());
    void observed.id;
    expect(untouched.dirty).toBe(false);
  });

  it("passes get, set, flash and destroy through to the target", () => {
    const session = createSession();
    const tracked = trackSessionId(session);

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
    expect(trackSessionId(createSession())).toBeInstanceOf(Session);
  });
});
