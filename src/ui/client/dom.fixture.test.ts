import { describe, expect, it } from "bun:test";

import { FakeDocument, FakeEvent, fakeTree } from "./dom.fixture";

describe("FakeElement listeners under a signal", () => {
  it("adds nothing for a signal that is already aborted", () => {
    const { el } = fakeTree();
    const target = el();
    const heard: string[] = [];

    target.addEventListener("click", () => heard.push("click"), { signal: AbortSignal.abort() });
    target.dispatchEvent(new FakeEvent("click"));

    expect(heard).toEqual([]);
    expect(target.listeners.get("click") ?? []).toEqual([]);
  });

  it("hears the event while the signal is live, and stops once it aborts", () => {
    const { el } = fakeTree();
    const target = el();
    const lifetime = new AbortController();
    const heard: number[] = [];

    target.addEventListener("click", () => heard.push(heard.length), { signal: lifetime.signal });
    target.dispatchEvent(new FakeEvent("click"));
    lifetime.abort();
    target.dispatchEvent(new FakeEvent("click"));

    expect(heard).toEqual([0]);
    expect(target.listeners.get("click")).toEqual([]);
  });

  it("removes only the listener the aborted signal was given", () => {
    const { el } = fakeTree();
    const target = el();
    const lifetime = new AbortController();
    const heard: string[] = [];

    target.addEventListener("click", () => heard.push("signalled"), { signal: lifetime.signal });
    target.addEventListener("click", () => heard.push("plain"));
    lifetime.abort();
    target.dispatchEvent(new FakeEvent("click"));

    expect(heard).toEqual(["plain"]);
  });

  it("accepts a boolean capture flag and keeps the listener", () => {
    const { el } = fakeTree();
    const target = el();
    const heard: string[] = [];

    target.addEventListener("click", () => heard.push("click"), true);
    target.dispatchEvent(new FakeEvent("click"));

    expect(heard).toEqual(["click"]);
  });
});

describe("FakeDocument listeners under a signal", () => {
  it("adds nothing for a signal that is already aborted", () => {
    const doc = new FakeDocument();
    const heard: string[] = [];

    doc.addEventListener("keydown", () => heard.push("keydown"), { capture: true, signal: AbortSignal.abort() });
    doc.dispatchEvent(new FakeEvent("keydown"));

    expect(heard).toEqual([]);
    expect(doc.listeners.get("keydown") ?? []).toEqual([]);
  });

  it("stops hearing the event once the signal aborts", () => {
    const doc = new FakeDocument();
    const lifetime = new AbortController();
    const heard: number[] = [];

    doc.addEventListener("keydown", () => heard.push(heard.length), { signal: lifetime.signal });
    doc.dispatchEvent(new FakeEvent("keydown"));
    lifetime.abort();
    doc.dispatchEvent(new FakeEvent("keydown"));

    expect(heard).toEqual([0]);
    expect(doc.listeners.get("keydown")).toEqual([]);
  });

  it("stops hearing an event bubbled up from an element once the signal aborts", () => {
    const { doc, el } = fakeTree();
    const child = el();
    const lifetime = new AbortController();
    const heard: string[] = [];

    doc.addEventListener("click", () => heard.push("doc"), { signal: lifetime.signal });
    lifetime.abort();
    child.dispatchEvent(new FakeEvent("click"));

    expect(heard).toEqual([]);
  });
});

describe("FakeWindow.fetch under a signal", () => {
  const PATH = "/slow";

  it("rejects at once with the reason of a signal aborted before the call, and still records the request", async () => {
    const { doc } = fakeTree();
    const win = doc.defaultView;
    win.replies.set(PATH, { body: { ok: true } });
    const reason = new Error("gone before it started");

    await expect(win.fetch(PATH, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(win.requests.map((request) => request.url)).toEqual([PATH]);
  });

  it("leaves a hung reply pending until its signal aborts, then rejects with the signal's reason", async () => {
    const { doc } = fakeTree();
    const win = doc.defaultView;
    win.replies.set(PATH, { hang: true });
    const lifetime = new AbortController();
    const reason = new Error("caller gave up");
    let settled: "pending" | "resolved" | "rejected" = "pending";
    let rejection: unknown;

    const pending = win.fetch(PATH, { signal: lifetime.signal }).then(
      () => {
        settled = "resolved";
      },
      (error: unknown) => {
        settled = "rejected";
        rejection = error;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe("pending");

    lifetime.abort(reason);
    await pending;

    expect(settled).toBe("rejected");
    expect(rejection).toBe(reason);
  });

  it("rejects a hung reply with the TimeoutError a deadline signal aborts with", async () => {
    const { doc } = fakeTree();
    const win = doc.defaultView;
    win.replies.set(PATH, { hang: true });

    const rejection = await win.fetch(PATH, { signal: AbortSignal.timeout(1) }).catch((error: unknown) => error);

    expect((rejection as DOMException).name).toBe("TimeoutError");
  });

  it("answers an ordinary reply under a live signal as it does without one", async () => {
    const { doc } = fakeTree();
    const win = doc.defaultView;
    win.replies.set(PATH, { status: 201, body: { id: 7 } });

    const response = await win.fetch(PATH, { signal: new AbortController().signal });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 7 });
  });
});

describe("FakeWindow clock", () => {
  it("runs only the timers that fall due, in due order, at their due time", () => {
    const win = new FakeDocument().defaultView;
    const ran: Array<[string, number]> = [];
    win.setTimeout(() => ran.push(["late", win.performance.now()]), 300);
    win.setTimeout(() => ran.push(["early", win.performance.now()]), 100);
    win.setTimeout(() => ran.push(["later", win.performance.now()]), 900);

    win.advance(500);

    expect(ran).toEqual([
      ["early", 100],
      ["late", 300],
    ]);
    expect(win.performance.now()).toBe(500);
  });

  it("runs a timer armed by another inside the same advance once it falls due", () => {
    const win = new FakeDocument().defaultView;
    const ran: number[] = [];
    win.setTimeout(() => win.setTimeout(() => ran.push(win.performance.now()), 50), 100);

    win.advance(200);

    expect(ran).toEqual([150]);
  });

  it("never runs a cleared timer", () => {
    const win = new FakeDocument().defaultView;
    const ran: string[] = [];
    const id = win.setTimeout(() => ran.push("cleared"), 10);
    win.clearTimeout(id);

    win.advance(100);

    expect(ran).toEqual([]);
  });

  it("delivers a window event to the listeners registered under a live signal only", () => {
    const win = new FakeDocument().defaultView;
    const heard: string[] = [];
    const lifetime = new AbortController();
    win.addEventListener("blur", () => heard.push("blur"), { signal: lifetime.signal });

    win.dispatchEvent(new FakeEvent("blur"));
    lifetime.abort();
    win.dispatchEvent(new FakeEvent("blur"));

    expect(heard).toEqual(["blur"]);
  });
});

describe("FakeElement.isConnected", () => {
  it("holds only while the element's top ancestor is its document's root or body", () => {
    const { doc, el } = fakeTree();
    const owned = el();
    const child = el();
    doc.body.append(owned);
    owned.append(child);
    const attached = child.isConnected;

    owned.remove();

    expect({ attached, removed: child.isConnected, unattached: el().isConnected }).toEqual({ attached: true, removed: false, unattached: false });
  });
});
