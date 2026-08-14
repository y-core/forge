/** The document a node belongs to, falling back to the ambient one when there is no node to ask. @public */
export function ownerDocument(node?: Node | null): Document {
  if (!node) return document;
  // A Document's own `ownerDocument` is null, so identity is checked before delegating — otherwise
  // an iframe's document resolves to the top-level one.
  if (node.nodeType === 9) return node as Document;
  return node.ownerDocument ?? document;
}

/** The window a node belongs to, for timers, `matchMedia` and storage scoped to its own realm. @public */
export function ownerWindow(node?: Node | null): Window {
  return ownerDocument(node).defaultView ?? window;
}

/** Whether an element resolves to right-to-left writing direction. @public */
export function isRtl(el: Element): boolean {
  return ownerWindow(el).getComputedStyle(el).direction === "rtl";
}

/** The deeply focused element, descending through open shadow roots that report an active element. @public */
export function activeElement(node?: Node | null): Element | null {
  let active = ownerDocument(node).activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The element an event originated from, before shadow retargeting rewrote it. @public */
export function eventTarget(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target;
}

/** Narrows an event target to an element without `instanceof`, so a cross-realm element is accepted. @public */
export function asElement(target: EventTarget | null | undefined): HTMLElement | null {
  return (target as Node | null)?.nodeType === 1 ? (target as HTMLElement) : null;
}

/** The shadow host of `node`, or `null` when `node` is not a shadow root. */
function shadowHost(node: Node | null | undefined): Node | null {
  // The nodeType test keeps `HTMLAnchorElement.host` — the URL's host *string* — out of a climb: in
  // a detached subtree `getRootNode()` returns the topmost element, which can be an anchor.
  if (node?.nodeType !== 11) return null;
  return ((node as Partial<ShadowRoot>).host as Node | undefined) ?? null;
}

/** Shadow-safe `closest`, searching each tree in turn and stepping over the boundary to the host. @public */
export function closestAcross<E extends Element = HTMLElement>(node: Node | null | undefined, selector: string): E | null {
  let current: Node | null | undefined = node;
  while (current) {
    if (current.nodeType === 1) {
      const hit = (current as Element).closest(selector);
      if (hit) return hit as E;
    }
    current = shadowHost(current) ?? shadowHost(current.getRootNode());
  }
  return null;
}

/** Shadow-safe containment, climbing each `host` in turn where `Node.contains` stops at the boundary. @public */
export function contains(parent?: Node | null, child?: Node | null): boolean {
  if (!parent || !child) return false;
  let node: Node | null = child;
  while (node) {
    if (parent.contains(node)) return true;
    const host = shadowHost(node.getRootNode());
    if (!host) return false;
    node = host;
  }
  return false;
}

/** An element by id, resolved in the tree `node` lives in rather than in the document. */
export function elementById(node: Node, id: string): HTMLElement | null {
  if (!id) return null;
  const root = node.getRootNode() as Partial<Document>;
  // Duck-typed on the method: a detached subtree's root is its topmost element, which has no
  // `getElementById` at all.
  if (typeof root.getElementById === "function") return root.getElementById(id);
  return ownerDocument(node).getElementById(id);
}
