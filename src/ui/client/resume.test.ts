import { describe, expect, it } from "bun:test";

import { FakeDocument, FakeElement, fakeTree } from "./dom.fixture";
import { disposeScopesIn, findScopes, hydrateState, registerScope, resume, resumeScope, scanRoot, sweepDetachedScopes } from "./resume";
import { effect } from "./signal";

const asParent = (el: FakeElement) => el as unknown as ParentNode;

describe("hydrateState", () => {
  it("yields nothing when there is no data-state to read", () => {
    expect(hydrateState(undefined)).toEqual({});
    expect(hydrateState("")).toEqual({});
  });

  it("rebuilds each key into a signal holding its value", () => {
    const state = hydrateState('{"count":3,"open":false,"label":"go"}');
    expect(state.count?.value).toBe(3);
    expect(state.open?.value).toBe(false);
    expect(state.label?.value).toBe("go");
  });

  it("throws on malformed JSON, carrying the parse error as the cause", () => {
    let caught: unknown;
    try {
      hydrateState("{nope");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("[resume] data-island-state is not valid JSON: {nope");
    expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("throws on JSON that parses cleanly but is not an object", () => {
    expect(() => hydrateState("null")).toThrow("[resume] data-island-state must be a JSON object, got: null");
    expect(() => hydrateState("5")).toThrow("[resume] data-island-state must be a JSON object, got: 5");
    expect(() => hydrateState('"go"')).toThrow('[resume] data-island-state must be a JSON object, got: "go"');
    expect(() => hydrateState("[1,2]")).toThrow("[resume] data-island-state must be a JSON object, got: [1,2]");
  });
});

describe("scanRoot", () => {
  const doc = new FakeDocument() as unknown as Document;

  it("scans the whole document when there is no walk root", () => {
    expect(scanRoot(undefined, doc)).toBe(doc as unknown as ParentNode);
  });

  it("honours a fragment or a document as the walk root", () => {
    const fragment = { nodeType: 11 } as unknown as Node;
    const other = { nodeType: 9 } as unknown as Node;
    expect(scanRoot(fragment, doc)).toBe(fragment as unknown as ParentNode);
    expect(scanRoot(other, doc)).toBe(other as unknown as ParentNode);
  });

  it("falls back to the document for a plain element", () => {
    expect(scanRoot({ nodeType: 1 } as unknown as Node, doc)).toBe(doc as unknown as ParentNode);
  });
});

function scopeTree() {
  const { el } = fakeTree();
  const root = el("DIV", { "data-scope": "root", id: "root" });
  const child = el("DIV", { "data-scope": "child", id: "child" });
  const host = el();
  const shadow = el();
  const inner = el("DIV", { "data-scope": "inner", id: "inner" });
  shadow.append(inner);
  host.shadowRoot = shadow;
  root.append(child, host);
  return { root, host };
}

const ids = (found: HTMLElement[]) => found.map((el) => el.id);

describe("findScopes", () => {
  it("includes the walk root itself, which querySelectorAll never reports", () => {
    const { root } = scopeTree();
    expect(ids(findScopes(asParent(root)))).toContain("root");
  });

  it("drains the light tree before opening any shadow tree", () => {
    const { root } = scopeTree();
    expect(ids(findScopes(asParent(root)))).toEqual(["root", "child", "inner"]);
  });

  it("reaches a shadow root nested inside a shadow root", () => {
    const { el } = fakeTree();
    const root = el();
    const host = el();
    const shallow = el();
    const inner = el();
    const deep = el();
    deep.append(el("DIV", { "data-scope": "deep", id: "deep" }));
    inner.shadowRoot = deep;
    shallow.append(inner);
    host.shadowRoot = shallow;
    root.append(host);
    expect(ids(findScopes(asParent(root)))).toEqual(["deep"]);
  });

  it("cannot see into a closed shadow root", () => {
    const { root, host } = scopeTree();
    host.shadowRoot = null;
    expect(ids(findScopes(asParent(root)))).toEqual(["root", "child"]);
  });

  it("queries the trees the caller supplies instead of walking for its own", () => {
    const { root } = scopeTree();
    const { el } = fakeTree();
    const elsewhere = el();
    elsewhere.append(el("DIV", { "data-scope": "elsewhere", id: "elsewhere" }));
    expect(ids(findScopes(asParent(root), [asParent(elsewhere) as unknown as Element]))).toEqual(["root", "elsewhere"]);
  });

  it("reports nothing for a tree with no scope in it", () => {
    const { el } = fakeTree();
    const root = el();
    root.append(el(), el());
    expect(findScopes(asParent(root))).toEqual([]);
  });
});

describe("sweepDetachedScopes", () => {
  it("disposes only the scopes whose root has left its document, once, leaving the connected one active", () => {
    const disposed: string[] = [];
    registerScope("sweep-probe", {
      setup:
        ({ root }) =>
        () =>
          disposed.push(root.id),
    });
    const { doc, el } = fakeTree();
    const connected = el("DIV", { "data-scope": "sweep-probe", id: "connected" });
    doc.body.append(connected);
    const detached = new FakeElement("DIV", { "data-scope": "sweep-probe", id: "detached" });
    new FakeElement().append(detached);
    const asRoot = (node: FakeElement) => node as unknown as HTMLElement;
    resumeScope(asRoot(connected));
    resumeScope(asRoot(detached));
    detached.remove();

    sweepDetachedScopes();
    sweepDetachedScopes();

    expect(disposed).toEqual(["detached"]);
    disposeScopesIn(asRoot(connected));
    expect(disposed).toEqual(["detached", "connected"]);
  });
});

describe("the setup signal", () => {
  const asRoot = (node: FakeElement) => node as unknown as HTMLElement;

  function signalProbe(name: string, eager = false): Map<string, AbortSignal> {
    const handed = new Map<string, AbortSignal>();
    registerScope(name, {
      eager,
      setup: ({ root, signal }) => {
        handed.set(root.id, signal);
      },
    });
    return handed;
  }

  it("is live while the scope is mounted", () => {
    const handed = signalProbe("signal-live");
    const { el } = fakeTree();
    const root = el("DIV", { "data-scope": "signal-live", id: "live" });

    resumeScope(asRoot(root));

    expect(handed.get("live")?.aborted).toBe(false);
    disposeScopesIn(asRoot(root));
  });

  it("aborts when disposeScopesIn reaches the scope from an ancestor", () => {
    const handed = signalProbe("signal-dispose-in");
    const { el } = fakeTree();
    const container = el();
    const root = el("DIV", { "data-scope": "signal-dispose-in", id: "inner" });
    container.append(root);
    resumeScope(asRoot(root));

    disposeScopesIn(asRoot(container));

    expect(handed.get("inner")?.aborted).toBe(true);
  });

  it("aborts for a detached root on the sweep, and stays live for a connected one", () => {
    const handed = signalProbe("signal-sweep");
    const { doc, el } = fakeTree();
    const connected = el("DIV", { "data-scope": "signal-sweep", id: "connected" });
    doc.body.append(connected);
    const detached = new FakeElement("DIV", { "data-scope": "signal-sweep", id: "detached" });
    new FakeElement().append(detached);
    resumeScope(asRoot(connected));
    resumeScope(asRoot(detached));
    detached.remove();

    sweepDetachedScopes();

    expect({ detached: handed.get("detached")?.aborted, connected: handed.get("connected")?.aborted }).toEqual({
      detached: true,
      connected: false,
    });
    disposeScopesIn(asRoot(connected));
  });

  it("aborts for an eager scope when the disposer resume() returned runs", () => {
    const handed = signalProbe("signal-eager", true);
    const doc = new FakeDocument();
    const root = new FakeElement("DIV", { "data-scope": "signal-eager", id: "eager" });
    root.ownerDocument = doc;
    doc.root.append(root);

    const release = resume(doc as unknown as Node);
    const before = handed.get("eager")?.aborted;
    release();

    expect({ before, after: handed.get("eager")?.aborted }).toEqual({ before: false, after: true });
  });

  it("aborts after the scope's effects are disposed and before the setup's own disposer runs", () => {
    const order: string[] = [];
    registerScope("signal-order", {
      setup: ({ state, signal }) => {
        const count = state.count as { value: number };
        effect(() => {
          order.push(`effect saw ${count.value}`);
        });
        signal.addEventListener("abort", () => {
          count.value = 2;
          order.push("abort");
        });
        return () => {
          order.push(`setup disposer, aborted: ${signal.aborted}`);
        };
      },
    });
    const { el } = fakeTree();
    const root = el("DIV", { "data-scope": "signal-order", "data-island-state": '{"count":1}' });
    resumeScope(asRoot(root));

    disposeScopesIn(asRoot(root));

    expect(order).toEqual(["effect saw 1", "abort", "setup disposer, aborted: true"]);
  });

  it("aborts the signal a throwing setup captured, and resumeScope rethrows", () => {
    let captured: AbortSignal | undefined;
    const failure = new Error("setup failed");
    registerScope("signal-throws", {
      setup: ({ signal }) => {
        captured = signal;
        throw failure;
      },
    });
    const { el } = fakeTree();
    const root = el("DIV", { "data-scope": "signal-throws" });

    expect(() => resumeScope(asRoot(root))).toThrow(failure);
    expect(captured?.aborted).toBe(true);
  });
});
