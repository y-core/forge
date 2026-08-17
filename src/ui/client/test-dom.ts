/** A fake DOM for the client controllers' unit tests — the slice they touch, and nothing else.
 *
 * Hand-rolled rather than happy-dom: forge ships no DOM implementation as a dependency, and
 * `TESTING.md` prefers a fake whose behaviour the test can read to a library whose it cannot. */

type Listener = (event: FakeEvent) => void;

/** The event shape the controllers read: a type, a target, and the bits `preventDefault` needs. */
export class FakeEvent {
  defaultPrevented = false;
  target: FakeElement | null = null;

  readonly type: string;

  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  composedPath(): FakeElement[] {
    return this.target ? [this.target] : [];
  }
}

/** A minimal element: attributes, children, listeners, and the queries the controllers run. */
export class FakeElement {
  readonly nodeType = 1;
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  parent: FakeElement | null = null;
  textContent = "";
  hidden = false;
  disabled = false;
  readOnly = false;
  checked = false;
  value = "";
  tabIndex = 0;
  id = "";
  focused = false;
  shadowRoot: FakeElement | null = null;
  ownerDocument: FakeDocument | null = null;
  /** A shadow root reports its own focused node; a plain element's stays null. */
  activeElement: FakeElement | null = null;

  readonly tagName: string;

  constructor(tagName = "DIV", attrs: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attrs)) this.attrs.set(name, value);
    this.id = attrs.id ?? "";
  }

  append(...kids: FakeElement[]): this {
    for (const kid of kids) {
      kid.parent = this;
      kid.ownerDocument = this.ownerDocument;
      this.children.push(kid);
    }
    return this;
  }

  // Modelled because `show/lazy-panel.ts` calls it rather than `append`, which a Worker type program
  // resolves to HTMLRewriter's string-only signature.
  appendChild(kid: FakeElement): FakeElement {
    this.append(kid);
    return kid;
  }

  remove(): void {
    if (!this.parent) return;
    const at = this.parent.children.indexOf(this);
    if (at >= 0) this.parent.children.splice(at, 1);
    this.parent = null;
  }

  get isConnected(): boolean {
    return this.parent !== null || this.ownerDocument !== null;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  toggleAttribute(name: string, force?: boolean): void {
    const next = force ?? !this.attrs.has(name);
    if (next) this.attrs.set(name, "");
    else this.attrs.delete(name);
  }

  get dataset(): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [name, value] of this.attrs) {
      if (!name.startsWith("data-")) continue;
      out[name.slice(5).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())] = value;
    }
    return out;
  }

  /** Supports the shapes the controllers actually use: `[attr]`, `[attr='v']`, `tag`, and lists. */
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const one = part.trim();
      if (one === "*") return true;
      if (one.startsWith("#")) return this.id === one.slice(1);
      const attr = /^\[([a-z-]+)(?:~?=['"]?([^'"\]]*)['"]?)?\]$/.exec(one);
      if (attr === null) return one.toUpperCase() === this.tagName;
      const [, name = "", expected] = attr;
      const actual = this.attrs.get(name);
      if (actual === undefined) return false;
      if (expected === undefined) return true;
      return one.includes("~=") ? actual.split(/\s+/).includes(expected) : actual === expected;
    });
  }

  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  contains(node: FakeElement | null): boolean {
    for (let cur = node; cur; cur = cur.parent) if (cur === this) return true;
    return false;
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((kid) => [kid, ...kid.descendants()]);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return selector === "*" ? this.descendants() : this.descendants().filter((el) => el.matches(selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  }

  /** Fires `event` here and then at every ancestor, which is the bubbling the controllers rely on.
   *
   * A controller may dispatch a *real* `Event` — `mountNumberField` re-fires `input` and `change`
   * after stepping — whose `target` is a readonly getter, so only a fake one is retargeted. */
  dispatchEvent(event: FakeEvent | Event): void {
    if (event instanceof FakeEvent) event.target ??= this;
    for (let node: FakeElement | null = this; node; node = node.parent) {
      for (const listener of [...(node.listeners.get(event.type) ?? [])]) listener(event as FakeEvent);
    }
    // Then the document, which is where the delegated scope runtime listens.
    if (event instanceof FakeEvent) this.ownerDocument?.dispatchEvent(event);
  }

  focus(): void {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  getRootNode(): FakeElement | FakeDocument {
    return this.ownerDocument ?? this;
  }
}

/** Just enough document for `ownerDocument`, `ownerWindow` and `elementById`. */
export class FakeDocument {
  readonly nodeType = 9;
  activeElement: FakeElement | null = null;
  readonly body = new FakeElement("BODY");
  readonly root = new FakeElement("HTML");
  readonly defaultView: FakeWindow;

  constructor() {
    this.defaultView = new FakeWindow(this);
    this.body.ownerDocument = this;
    this.root.ownerDocument = this;
  }

  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  /** Document-level listeners, which is where `resume()` installs its whole delegation. */
  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  }

  dispatchEvent(event: FakeEvent): void {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
  }

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(tagName.toUpperCase());
    element.ownerDocument = this;
    return element;
  }

  getElementById(id: string): FakeElement | null {
    return this.root.descendants().find((el) => el.id === id) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector);
  }
}

/** A window whose timers a test drives by hand, so no test ever waits on a real clock. */
export class FakeWindow {
  private seq = 0;
  readonly timers = new Map<number, () => void>();

  readonly document: FakeDocument;

  constructor(document: FakeDocument) {
    this.document = document;
  }

  setTimeout(fn: () => void, _ms?: number): number {
    this.seq += 1;
    this.timers.set(this.seq, fn);
    return this.seq;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  /** Runs every pending timer, in the order they were armed. */
  flush(): void {
    const pending = [...this.timers.entries()].sort(([a], [b]) => a - b);
    this.timers.clear();
    for (const [, fn] of pending) fn();
  }

  /** Per-element writing direction, defaulting to `ltr` so an unregistered element reads as it always did. */
  readonly directions = new WeakMap<object, string>();

  /** How `localStorage` behaves: available, present but throwing on read, or throwing on the property access itself. */
  storageMode: "ok" | "throws-on-get" | "throws-on-access" = "ok";

  private readonly store = new Map<string, string>();

  setDirection(el: object, direction: string): void {
    this.directions.set(el, direction);
  }

  getComputedStyle(el?: object): { direction: string } {
    return { direction: (el && this.directions.get(el)) || "ltr" };
  }

  /** A getter, because `throws-on-access` has to fail before any method is reached — which is the
   * opaque-origin shape `safeStorage` exists to survive. */
  get localStorage(): Storage {
    if (this.storageMode === "throws-on-access") throw new Error("SecurityError");
    const store = this.store;
    const throwsOnGet = this.storageMode === "throws-on-get";
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => {
        if (throwsOnGet) throw new Error("SecurityError");
        return store.get(key) ?? null;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as Storage;
  }
}

/** A document with `root` attached, plus a helper to build elements inside it. */
export function fakeTree(): { doc: FakeDocument; el: (tag?: string, attrs?: Record<string, string>) => FakeElement } {
  const doc = new FakeDocument();
  return {
    doc,
    el: (tag = "DIV", attrs = {}) => {
      const element = new FakeElement(tag, attrs);
      element.ownerDocument = doc;
      return element;
    },
  };
}
