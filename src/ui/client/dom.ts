/**
 * Owner-document utilities — the realm- and shadow-safe replacements for the global reflexes a
 * browser controller reaches for by habit.
 *
 * Each of those reflexes has a failure mode that is invisible in the common case and total in the
 * uncommon one:
 *
 * - **Bare `document` / `window`** name the *top-level* realm. A controller mounted inside an iframe
 *   installs its listeners on the wrong document and silently never fires.
 * - **`event.target`** is retargeted at a shadow boundary: for an event that crossed one it reports
 *   the **host**, not the element the user actually hit. `composedPath()[0]` reports the real one.
 * - **`document.activeElement`** has the same problem in reverse — it stops at the host and never
 *   reports the focused item inside an open shadow root.
 * - **`instanceof HTMLElement`** is `false` for an element from another realm, because every realm
 *   has its own constructor. It compiles, it type-narrows, and it rejects a perfectly good element.
 * - **`document.getElementById`** searches the document only, and an id inside a shadow root is not
 *   in it — a `commandfor` or `aria-controls` naming a sibling in the same shadow tree resolves to
 *   `null`.
 * - **Bare `getComputedStyle`** is the top-level window's again, and a *global* direction read cannot
 *   see that one subtree of an LTR page is RTL.
 *
 * These are the primitives a composite widget is built out of: "which item has focus" and "which
 * item was hit" are the two questions a roving-focus controller exists to answer, and both are
 * wrong by default.
 */

/**
 * The document a node belongs to — **not** necessarily the global one. Falls back to the ambient
 * `document` when there is no node to ask, which is the only correct answer at that point.
 * @public
 */
export function ownerDocument(node?: Node | null): Document {
  if (!node) return document;
  // A Document's own `ownerDocument` is null, so ask for identity before delegating — otherwise an
  // iframe's document would resolve to the top-level one, which is exactly the bug being avoided.
  if (node.nodeType === 9) return node as Document;
  return node.ownerDocument ?? document;
}

/**
 * The window a node belongs to. Use it for timers, `matchMedia`, and `localStorage` so a controller
 * running in an iframe schedules and stores against its own realm.
 * @public
 */
export function ownerWindow(node?: Node | null): Window {
  return ownerDocument(node).defaultView ?? window;
}

/**
 * Whether an element resolves to right-to-left writing direction.
 *
 * Read from the element and not from a global: a single RTL subtree inside an LTR page must behave as
 * RTL, and only the resolved style knows that. The `dir` attribute is no substitute — it is usually
 * set on an ancestor, and CSS `direction` can set it without any attribute at all.
 *
 * `getComputedStyle` forces a style recalculation, so call it where the answer is actually consumed
 * rather than caching it: a mount-time read goes stale the moment `dir` flips at runtime.
 * @public
 */
export function isRtl(el: Element): boolean {
  return ownerWindow(el).getComputedStyle(el).direction === "rtl";
}

/**
 * The **deeply** focused element: descend through open shadow roots for as long as each reports an
 * active element of its own. `document.activeElement` returns the outermost host instead, so a
 * widget used inside a web component would be told the wrong element has focus.
 *
 * A closed shadow root exposes no `activeElement`, so the walk stops at its host — the only answer
 * available, and the same one the platform gives.
 * @public
 */
export function activeElement(node?: Node | null): Element | null {
  let active = ownerDocument(node).activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * The element an event actually originated from, before shadow retargeting rewrote it. Falls back
 * to `event.target` for a non-composed event and for an event not currently being dispatched, where
 * `composedPath()` is empty by specification.
 * @public
 */
export function eventTarget(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target;
}

/**
 * Narrow an event target to an element **without `instanceof`**, so an element from another realm
 * is accepted rather than silently discarded. Duck-typed on `nodeType === 1`, which every realm
 * agrees on.
 * @public
 */
export function asElement(target: EventTarget | null | undefined): HTMLElement | null {
  return (target as Node | null)?.nodeType === 1 ? (target as HTMLElement) : null;
}

/**
 * The shadow host of `node`, or `null` when `node` is not a shadow root.
 *
 * A ShadowRoot is a DOCUMENT_FRAGMENT_NODE (11) carrying `host`. The nodeType test is what keeps
 * `HTMLAnchorElement.host` out of a climb: on any `<a href>` that is the URL's host string, so a
 * `host`-only check steps off the tree onto a string and throws on the next hop. That matters for
 * a **detached** subtree in particular, where `getRootNode()` returns the topmost ancestor
 * *element* rather than a document, so an anchor can end up in root position. A relative `href` is
 * no safer than an absolute one there: the anchor resolves it against the document base URL, so
 * `host` reads the page's own origin rather than `""`. Single home for the check so the call sites
 * cannot drift apart.
 */
function shadowHost(node: Node | null | undefined): Node | null {
  if (node?.nodeType !== 11) return null;
  return ((node as Partial<ShadowRoot>).host as Node | undefined) ?? null;
}

/**
 * Shadow-safe `closest`. `Element.closest` searches only the tree its element is in, so an element
 * inside a shadow root can never find an ancestor outside it — the delegated dispatcher looking for
 * `[data-scope]`, the group binder looking for `[data-field]`, and every composite controller
 * looking for its own root all come back empty. This searches each tree in turn and steps over the
 * boundary to the host when it runs out.
 * @public
 */
export function closestAcross<E extends Element = HTMLElement>(node: Node | null | undefined, selector: string): E | null {
  let current: Node | null | undefined = node;
  while (current) {
    if (current.nodeType === 1) {
      const hit = (current as Element).closest(selector);
      if (hit) return hit as E;
    }
    // Being handed the root itself is the common case when climbing from a node whose parent *is*
    // the boundary; otherwise ask the tree for its root and step over that. Both reads go through
    // {@link shadowHost}, so neither can mistake an anchor's URL host for a shadow host.
    current = shadowHost(current) ?? shadowHost(current.getRootNode());
  }
  return null;
}

/**
 * Shadow-safe containment. `Node.contains` stops at a shadow boundary and reports `false` for a
 * child inside a descendant's shadow root; this climbs each `host` in turn instead, so "is the
 * focus still inside my widget" survives a web component in the middle.
 * @public
 */
export function contains(parent?: Node | null, child?: Node | null): boolean {
  if (!parent || !child) return false;
  let node: Node | null = child;
  while (node) {
    if (parent.contains(node)) return true;
    // Duck-typed rather than `instanceof ShadowRoot` — the same cross-realm trap this module exists
    // to close. A document root, and a detached subtree's topmost element, have no shadow host,
    // which ends the climb.
    const host = shadowHost(node.getRootNode());
    if (!host) return false;
    node = host;
  }
  return false;
}

/**
 * An element by id, resolved in the tree `node` actually lives in rather than the document.
 *
 * Ids do not cross a shadow boundary: `commandfor`, `aria-controls` and every other id reference are
 * scoped to the root that contains them, so a document-scoped lookup returns `null` for a target
 * inside a shadow tree — the failure is silent, and the caller reads it as "no such element".
 *
 * Duck-typed on the method rather than on the root's type, for the same reason {@link shadowHost}
 * tests `nodeType`: a **detached** subtree's `getRootNode()` is its topmost ancestor *element*, which
 * has no `getElementById` at all. There the owner document is the only tree left to ask, which is
 * also the answer a document-scoped lookup would have given.
 *
 * Exported for `tabs.ts` and `tooltip.ts` here, and for `ui/show`'s scope setups, which resolve the
 * same kind of id reference from inside a scope root. Deliberately carries no public tag and stays
 * out of the barrel: it is one lookup shared by a handful of controllers across an already-declared
 * `ui/show → ui/client` edge, not a capability the package offers.
 */
export function elementById(node: Node, id: string): HTMLElement | null {
  if (!id) return null;
  const root = node.getRootNode() as Partial<Document>;
  if (typeof root.getElementById === "function") return root.getElementById(id);
  return ownerDocument(node).getElementById(id);
}
