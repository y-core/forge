import { describe, expect, it } from "bun:test";
import { findScopes, hydrateState, scanRoot } from "./resume";
import { FakeDocument, type FakeElement, fakeTree } from "./test-dom";

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
    // The `cause` is the whole point of the throw: a browser spec cannot read it, so this is the
    // one place the chain from SyntaxError to authoring error is actually pinned.
    let caught: unknown;
    try {
      hydrateState("{nope");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("[resume] data-state is not valid JSON: {nope");
    expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("throws on JSON that parses cleanly but is not an object", () => {
    // `null` is checked before `typeof`, because `typeof null === "object"` would let it through.
    expect(() => hydrateState("null")).toThrow("[resume] data-state must be a JSON object, got: null");
    expect(() => hydrateState("5")).toThrow("[resume] data-state must be a JSON object, got: 5");
    expect(() => hydrateState('"go"')).toThrow('[resume] data-state must be a JSON object, got: "go"');
    expect(() => hydrateState("[1,2]")).toThrow("[resume] data-state must be a JSON object, got: [1,2]");
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

/** A walk root that carries `data-scope` itself, one below it, and one inside a shadow tree. */
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

  it("reports nothing for a tree with no scope in it", () => {
    const { el } = fakeTree();
    const root = el();
    root.append(el(), el());
    expect(findScopes(asParent(root))).toEqual([]);
  });
});
