import { describe, expect, it } from "bun:test";
import { activeElement, asElement, closestAcross, contains, elementById, eventTarget, isRtl, ownerDocument, queryAcross, safeStorage } from "./dom";
import { FakeDocument, FakeElement, FakeEvent, fakeTree } from "./test-dom";

const asNode = (el: FakeElement) => el as unknown as Node;
const asParent = (el: FakeElement) => el as unknown as ParentNode;

describe("ownerDocument", () => {
  it("reports a document as its own, rather than delegating to the ambient one", () => {
    const doc = new FakeDocument();
    expect(ownerDocument(doc as unknown as Node)).toBe(doc as unknown as Document);
  });

  it("reports the document a node was created in", () => {
    const { doc, el } = fakeTree();
    expect(ownerDocument(asNode(el()))).toBe(doc as unknown as Document);
  });
});

describe("isRtl", () => {
  it("is false for an element with no direction of its own", () => {
    const { el } = fakeTree();
    expect(isRtl(el() as unknown as Element)).toBe(false);
  });

  it("is true only for the element the direction was set on", () => {
    const { doc, el } = fakeTree();
    const rtl = el();
    const ltr = el();
    doc.defaultView.setDirection(rtl, "rtl");
    expect(isRtl(rtl as unknown as Element)).toBe(true);
    expect(isRtl(ltr as unknown as Element)).toBe(false);
  });
});

describe("activeElement", () => {
  it("descends through every shadow root that reports a focused node", () => {
    const { doc, el } = fakeTree();
    const host = el();
    const shadow = el();
    const inner = el();
    const deepHost = el();
    const deepShadow = el();
    doc.activeElement = host;
    host.shadowRoot = shadow;
    shadow.activeElement = deepHost;
    deepHost.shadowRoot = deepShadow;
    deepShadow.activeElement = inner;
    expect(activeElement(asNode(el()))).toBe(inner as unknown as Element);
  });

  it("stops at a host whose shadow root reports nothing focused", () => {
    const { doc, el } = fakeTree();
    const host = el();
    host.shadowRoot = el();
    doc.activeElement = host;
    expect(activeElement(asNode(el()))).toBe(host as unknown as Element);
  });
});

describe("eventTarget", () => {
  it("reports the composed path's origin, before shadow retargeting rewrote the target", () => {
    const { el } = fakeTree();
    const origin = el();
    const event = new FakeEvent("click");
    event.target = origin;
    expect(eventTarget(event as unknown as Event)).toBe(origin as unknown as EventTarget);
  });

  it("falls back to the target when the composed path is empty", () => {
    const { el } = fakeTree();
    const retargeted = el();
    const event = { composedPath: () => [], target: retargeted } as unknown as Event;
    expect(eventTarget(event)).toBe(retargeted as unknown as EventTarget);
  });
});

describe("asElement", () => {
  it("accepts an element without instanceof, so a cross-realm one still narrows", () => {
    const { el } = fakeTree();
    const element = el();
    expect(asElement(element as unknown as EventTarget)).toBe(element as unknown as HTMLElement);
  });

  it("rejects a text node, null and undefined", () => {
    expect(asElement({ nodeType: 3 } as unknown as EventTarget)).toBe(null);
    expect(asElement(null)).toBe(null);
    expect(asElement(undefined)).toBe(null);
  });
});

describe("closestAcross", () => {
  it("finds an ancestor within the same tree", () => {
    const { el } = fakeTree();
    const scope = el("DIV", { "data-scope": "counter" });
    const inner = el();
    scope.append(inner);
    expect(closestAcross(asNode(inner), "[data-scope]")).toBe(scope as unknown as HTMLElement);
  });

  it("reports null rather than climbing an anchor's `host` URL string", () => {
    // A detached subtree's root is its topmost element, which can be an `<a>` — whose `host` is the
    // URL's host *string*. Without the nodeType-11 test the climb steps onto that string.
    const anchor = new FakeElement("A");
    (anchor as unknown as { host: string }).host = "example.com";
    expect(closestAcross(asNode(anchor), "[data-scope]")).toBe(null);
  });
});

describe("contains", () => {
  it("reports a descendant and rejects a sibling", () => {
    const { el } = fakeTree();
    const parent = el();
    const child = el();
    const outside = el();
    parent.append(child);
    expect(contains(asNode(parent), asNode(child))).toBe(true);
    expect(contains(asNode(parent), asNode(outside))).toBe(false);
  });

  it("is false when either side is missing", () => {
    const { el } = fakeTree();
    expect(contains(null, asNode(el()))).toBe(false);
    expect(contains(asNode(el()), null)).toBe(false);
  });
});

describe("elementById", () => {
  it("reports null for an empty id rather than searching for one", () => {
    const { el } = fakeTree();
    expect(elementById(asNode(el()), "")).toBe(null);
  });

  it("resolves in the tree the node lives in", () => {
    const { doc, el } = fakeTree();
    const target = el("DIV", { id: "panel" });
    doc.root.append(target);
    expect(elementById(asNode(target), "panel")).toBe(target as unknown as HTMLElement);
  });
});

describe("safeStorage", () => {
  it("returns a usable storage when the realm allows one", () => {
    const { doc } = fakeTree();
    const storage = safeStorage(doc.defaultView as unknown as Window);
    expect(storage).not.toBe(null);
    storage?.setItem("theme", "dark");
    expect(storage?.getItem("theme")).toBe("dark");
  });

  it("reports null when the property is present but every read throws", () => {
    const { doc } = fakeTree();
    doc.defaultView.storageMode = "throws-on-get";
    expect(safeStorage(doc.defaultView as unknown as Window)).toBe(null);
  });

  it("reports null when the property access itself throws", () => {
    const { doc } = fakeTree();
    doc.defaultView.storageMode = "throws-on-access";
    expect(safeStorage(doc.defaultView as unknown as Window)).toBe(null);
  });
});

/** A light tree of `[data-x]` rows, one of which hosts a shadow tree holding another. */
function shadowTree() {
  const { el } = fakeTree();
  const root = el("DIV", { "data-x": "" });
  const a = el("DIV", { "data-x": "", id: "a" });
  const b = el("DIV", { "data-x": "", id: "b" });
  const shadow = el();
  const s1 = el("DIV", { "data-x": "", id: "s1" });
  shadow.append(s1);
  a.shadowRoot = shadow;
  root.append(a, b);
  return { root, a, b, s1 };
}

/** `queryAcross` constrains its type parameter to `Element`, which the fake cannot satisfy. */
const across = (root: FakeElement, selector: string) => queryAcross(asParent(root), selector) as unknown as FakeElement[];

const ids = (found: FakeElement[]) => found.map((el) => el.id);

describe("queryAcross", () => {
  it("never reports the root itself, however well it matches", () => {
    const { root } = shadowTree();
    expect(across(root, "[data-x]")).not.toContain(root);
  });

  it("orders per tree rather than in document order", () => {
    // Document order is a, s1, b — the light tree is drained before any shadow tree is opened.
    const { root } = shadowTree();
    expect(ids(across(root, "[data-x]"))).toEqual(["a", "b", "s1"]);
  });

  it("reports an element that both matches and hosts, and still descends into it", () => {
    const { root, a, s1 } = shadowTree();
    const found = across(root, "[data-x]");
    expect(found).toContain(a);
    expect(found).toContain(s1);
  });

  it("reaches a shadow root nested inside a shadow root", () => {
    const { el } = fakeTree();
    const root = el();
    const host = el();
    const shallow = el();
    const inner = el();
    const deep = el();
    const target = el("DIV", { "data-deep": "", id: "target" });
    deep.append(target);
    inner.shadowRoot = deep;
    shallow.append(inner);
    host.shadowRoot = shallow;
    root.append(host);
    expect(ids(across(root, "[data-deep]"))).toEqual(["target"]);
  });

  it("cannot see into a closed shadow root", () => {
    const { root, a } = shadowTree();
    a.shadowRoot = null;
    expect(ids(across(root, "[data-x]"))).toEqual(["a", "b"]);
  });
});
