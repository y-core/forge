import { describe, expect, it } from "bun:test";

import { FakeElement, FakeEvent, fakeTree } from "../client/dom.fixture";
import { resume, resumeScope } from "../client/resume";
import { effect } from "../client/signal";
import { ISLAND_STATE_ATTR } from "../contracts/island-contract";
import { NAVBAR_DRAWER_ATTR, NAVBAR_FILTERS_EVENT, NAVBAR_SCOPE } from "../contracts/navbar-contract";
import { THEME_SCOPE } from "../contracts/theme-toggle-contract";
import { isDark } from "./client";
import { DARK_CLASS, DEFAULT_THEME_PREF, THEME_ATTR, THEME_PREFS, THEME_STORAGE_KEY } from "./theme";

class FakeClassList {
  readonly tokens = new Set<string>();
  toggles = 0;

  toggle(token: string, force: boolean): void {
    this.toggles += 1;
    if (force) this.tokens.add(token);
    else this.tokens.delete(token);
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

class FakeHtml {
  readonly nodeType = 1;
  readonly classList = new FakeClassList();
  private readonly attrs = new Map<string, string>();
  sets = 0;

  setAttribute(name: string, value: string): void {
    this.sets += 1;
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
}

class FakeStorage {
  private readonly items = new Map<string, string>();
  writes = 0;
  /** The `DOMException` name a theme-key `getItem` or `setItem` throws, mirroring blocked or full storage. */
  throwOnRead: string | null = null;
  throwOnWrite: string | null = null;

  getItem(key: string): string | null {
    if (this.throwOnRead !== null && key === THEME_STORAGE_KEY) throw new DOMException("denied", this.throwOnRead);
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnWrite !== null && key === THEME_STORAGE_KEY) throw new DOMException("denied", this.throwOnWrite);
    this.writes += 1;
    this.items.set(key, value);
  }
}

class FakeMediaQueryList {
  matches = false;
  private readonly listeners = new Set<() => void>();
  added = 0;
  removed = 0;

  addEventListener(_type: string, listener: () => void): void {
    this.added += 1;
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.removed += 1;
    this.listeners.delete(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeScopeRoot {
  readonly nodeType = 1;
  readonly isConnected = true;
  readonly shadowRoot = null;
  readonly parentNode = null;
  readonly dataset: { scope: string; state: string };
  readonly ownerDocument: FakeDocument;

  constructor(ownerDocument: FakeDocument, scope: string, state: Record<string, unknown>) {
    this.ownerDocument = ownerDocument;
    this.dataset = { scope, state: JSON.stringify(state) };
  }

  /** The root doubles as its own `cycleTheme` trigger, so a click on it reaches the scope's action. */
  closest(selector: string): this | null {
    return selector === "[data-on-click]" || selector === "[data-scope]" ? this : null;
  }

  getAttribute(name: string): string | null {
    return name === "data-on-click" ? "cycleTheme" : null;
  }

  getRootNode(): FakeDocument {
    return this.ownerDocument;
  }
}

class FakeDocument {
  readonly nodeType = 9;
  readonly documentElement = new FakeHtml();
  readonly storage = new FakeStorage();
  readonly mql = new FakeMediaQueryList();
  readonly roots: FakeScopeRoot[] = [];
  readonly defaultView: { localStorage: FakeStorage; matchMedia?: (query: string) => FakeMediaQueryList };

  constructor(options: { stored?: string; matchMedia?: boolean } = {}) {
    if (options.stored !== undefined) this.storage.setItem(THEME_STORAGE_KEY, options.stored);
    this.defaultView = { localStorage: this.storage };
    if (options.matchMedia !== false) this.defaultView.matchMedia = () => this.mql;
  }

  addTheme(): FakeScopeRoot {
    const root = new FakeScopeRoot(this, THEME_SCOPE, { pref: DEFAULT_THEME_PREF });
    this.roots.push(root);
    return root;
  }

  querySelectorAll(): FakeScopeRoot[] {
    return this.roots;
  }

  private readonly listeners: Array<[string, (event: unknown) => void]> = [];

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.push([type, listener]);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const at = this.listeners.findIndex(([t, l]) => t === type && l === listener);
    if (at !== -1) this.listeners.splice(at, 1);
  }

  click(root: FakeScopeRoot): void {
    const event = { type: "click", target: root, composedPath: () => [root], preventDefault() {}, stopImmediatePropagation() {} };
    for (const [type, listener] of [...this.listeners]) if (type === "click") listener(event);
  }
}

const asDocument = (doc: FakeDocument) => doc as unknown as Document;
const prefOf = (root: FakeScopeRoot) => resumeScope(root as unknown as HTMLElement)?.pref;

function captureWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

describe("isDark — stable accessor", () => {
  it("reads false until the theme scope resumes (no theme scope resumed here)", () => {
    expect(isDark.value).toBe(false);
  });
});

describe("isDark — reactive across resume and release", () => {
  it("re-runs an effect registered before resume when the theme turns dark, and again on the last release", () => {
    const seen: boolean[] = [];
    const stop = effect(() => {
      seen.push(isDark.value);
    });
    const doc = new FakeDocument({ stored: "dark" });
    doc.addTheme();

    const dispose = resume(asDocument(doc));
    const resumed = [...seen];
    dispose();

    expect({ resumed, released: seen }).toEqual({ resumed: [false, true], released: [false, true, false] });
    stop();
  });
});

describe("theme scope — the stored preference", () => {
  for (const stored of THEME_PREFS) {
    it(`seeds the stored preference ${JSON.stringify(stored)} unchanged`, () => {
      const doc = new FakeDocument({ stored });
      doc.addTheme();
      const dispose = resume(asDocument(doc));

      expect(prefOf(doc.roots[0] as FakeScopeRoot)?.value).toBe(stored);

      dispose();
    });
  }

  for (const stored of ["auto", ""]) {
    it(`seeds an unknown stored value ${JSON.stringify(stored)} as the system preference`, () => {
      const doc = new FakeDocument({ stored });
      doc.addTheme();
      const dispose = resume(asDocument(doc));

      expect({ pref: prefOf(doc.roots[0] as FakeScopeRoot)?.value, attr: doc.documentElement.getAttribute(THEME_ATTR) }).toEqual({
        pref: DEFAULT_THEME_PREF,
        attr: DEFAULT_THEME_PREF,
      });

      dispose();
    });
  }

  for (const name of ["SecurityError", "QuotaExceededError"]) {
    it(`resumes on the system preference when reading the stored value throws ${name}`, () => {
      const doc = new FakeDocument({ stored: "dark" });
      doc.storage.throwOnRead = name;
      doc.addTheme();
      const dispose = resume(asDocument(doc));

      expect(prefOf(doc.roots[0] as FakeScopeRoot)?.value).toBe(DEFAULT_THEME_PREF);

      dispose();
    });

    it(`keeps cycling and painting when persisting throws ${name}`, () => {
      const doc = new FakeDocument({ stored: "light" });
      doc.storage.throwOnWrite = name;
      doc.addTheme();
      const { result: dispose } = captureWarnings(() => resume(asDocument(doc)));

      captureWarnings(() => doc.click(doc.roots[0] as FakeScopeRoot));

      expect({ pref: prefOf(doc.roots[0] as FakeScopeRoot)?.value, dark: doc.documentElement.classList.contains(DARK_CLASS) }).toEqual({
        pref: "dark",
        dark: true,
      });

      dispose();
    });
  }
});

describe("theme scope — one preference per document", () => {
  it("hands every theme root in a document the same pref signal", () => {
    const doc = new FakeDocument({ stored: "light" });
    doc.addTheme();
    doc.addTheme();
    const dispose = resume(asDocument(doc));

    const [a, b] = doc.roots;
    expect(prefOf(a as FakeScopeRoot)).toBe(prefOf(b as FakeScopeRoot));

    dispose();
  });

  it("paints the document once per change however many roots share the preference", () => {
    const doc = new FakeDocument({ stored: "light" });
    doc.addTheme();
    doc.addTheme();
    const dispose = resume(asDocument(doc));
    const sets = doc.documentElement.sets;
    const toggles = doc.documentElement.classList.toggles;
    const writes = doc.storage.writes;

    const pref = prefOf(doc.roots[0] as FakeScopeRoot);
    if (pref) pref.value = "dark";

    expect(isDark.value).toBe(true);
    expect(doc.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
    expect(doc.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect({
      sets: doc.documentElement.sets - sets,
      toggles: doc.documentElement.classList.toggles - toggles,
      writes: doc.storage.writes - writes,
    }).toEqual({ sets: 1, toggles: 1, writes: 1 });

    dispose();
  });

  it("reports no second-scope conflict, because there is none to report", () => {
    const doc = new FakeDocument({ stored: "light" });
    doc.addTheme();
    doc.addTheme();

    const { result: dispose, warnings } = captureWarnings(() => resume(asDocument(doc)));

    expect(warnings.filter((warning) => /second theme scope/.test(warning))).toEqual([]);

    dispose();
  });

  it("keeps painting after the first of two scopes is disposed", () => {
    const doc = new FakeDocument({ stored: "light" });
    doc.addTheme();
    const disposeFirst = resume(asDocument(doc));
    doc.addTheme();
    const disposeSecond = resume(asDocument(doc));

    disposeFirst();
    const pref = prefOf(doc.roots[1] as FakeScopeRoot);
    if (pref) pref.value = "dark";

    expect(isDark.value).toBe(true);
    expect(doc.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(doc.documentElement.getAttribute(THEME_ATTR)).toBe("dark");

    disposeSecond();
  });

  it("removes the media listener only when the last scope releases the document", () => {
    const doc = new FakeDocument({ stored: "system" });
    doc.addTheme();
    const disposeFirst = resume(asDocument(doc));
    doc.addTheme();
    const disposeSecond = resume(asDocument(doc));
    expect(doc.mql.added).toBe(1);

    disposeFirst();
    expect(doc.mql.removed).toBe(0);

    disposeSecond();
    expect(doc.mql.removed).toBe(1);
  });

  it("follows a live colour-scheme change once, through the shared signal", () => {
    const doc = new FakeDocument({ stored: "system" });
    doc.addTheme();
    doc.addTheme();
    const dispose = resume(asDocument(doc));
    const toggles = doc.documentElement.classList.toggles;

    doc.mql.emit(true);

    expect(isDark.value).toBe(true);
    expect(doc.documentElement.classList.toggles - toggles).toBe(1);

    dispose();
  });

  it("returns isDark to false on the last release and re-seeds from storage on the next resume", () => {
    const doc = new FakeDocument({ stored: "dark" });
    doc.addTheme();
    const dispose = resume(asDocument(doc));
    expect(isDark.value).toBe(true);

    dispose();
    expect(isDark.value).toBe(false);

    const again = resume(asDocument(doc));
    expect(isDark.value).toBe(true);
    expect(prefOf(doc.roots[0] as FakeScopeRoot)?.value).toBe("dark");

    again();
  });

  it("keeps two documents on independent preferences", () => {
    const light = new FakeDocument({ stored: "light" });
    light.addTheme();
    const disposeLight = resume(asDocument(light));

    const dark = new FakeDocument({ stored: "dark" });
    dark.addTheme();
    const disposeDark = resume(asDocument(dark));

    expect(isDark.value).toBe(true);
    expect(light.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(dark.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(prefOf(light.roots[0] as FakeScopeRoot)).not.toBe(prefOf(dark.roots[0] as FakeScopeRoot));

    disposeDark();
    expect(isDark.value).toBe(false);

    disposeLight();
  });

  it("reports a realm without matchMedia once per document, not once per scope", () => {
    const doc = new FakeDocument({ stored: "system", matchMedia: false });
    doc.addTheme();
    doc.addTheme();

    const { result: dispose, warnings } = captureWarnings(() => resume(asDocument(doc)));

    expect(warnings.filter((warning) => /matchMedia is unavailable/.test(warning))).toHaveLength(1);

    dispose();
  });
});

/** A `<details>` bar: the drawer and viewport-collapse controllers both duck-type on `open`. */
class FakeBar extends FakeElement {
  open = true;
}

class FakeMql {
  readonly matches = false;

  addEventListener(): void {}

  removeEventListener(): void {}
}

function navbarTree(options: { drawer?: boolean; filters?: string[] } = {}) {
  const { doc, el } = fakeTree();
  (doc.defaultView as unknown as { matchMedia: () => FakeMql }).matchMedia = () => new FakeMql();

  const root = el("DIV", { "data-scope": NAVBAR_SCOPE, [ISLAND_STATE_ATTR]: JSON.stringify({ filters: options.filters ?? [] }) });
  const bar = new FakeBar("DETAILS", { "data-slot": "navbar", ...(options.drawer === true ? { [NAVBAR_DRAWER_ATTR]: "" } : {}) });
  bar.ownerDocument = doc;
  const member = el("A", { "data-filter": "member" });
  const admin = el("A", { "data-filter": "admin" });
  const anyone = el("A", { "data-on-click": "closeNav" });
  const nobody = el("A", { "data-filter": "" });
  bar.append(member, admin, anyone, nobody);
  root.append(bar);
  doc.root.append(root);

  const hiddenByFilter = () => ({ member: member.hidden, admin: admin.hidden, anyone: anyone.hidden, nobody: nobody.hidden });
  return { doc, root, bar, anyone, hiddenByFilter };
}

describe("navbar scope — auth filters", () => {
  it("hides every filtered element the hydrated token list does not name, and nothing unfiltered", () => {
    const tree = navbarTree({ filters: ["member"] });

    const release = resume(tree.doc as never);

    expect(tree.hiddenByFilter()).toEqual({ member: false, admin: true, anyone: false, nobody: true });
    release();
  });

  // The listener count, not "nothing moved after release": disposing the effect owner already makes
  // a leaked listener invisible, so the outcome would hold with the removal deleted (TESTING.md §3d).
  it("re-syncs on the filters event while resumed and takes its root and document listeners off on release", () => {
    const tree = navbarTree({ filters: ["member"] });
    const listening = () => ({
      root: tree.root.listeners.get(NAVBAR_FILTERS_EVENT)?.length ?? 0,
      document: tree.doc.listeners.get(NAVBAR_FILTERS_EVENT)?.length ?? 0,
    });
    const release = resume(tree.doc as never);
    const armed = listening();

    tree.doc.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));
    const live = tree.hiddenByFilter();

    release();

    expect({ armed, live, released: listening() }).toEqual({
      armed: { root: 1, document: 1 },
      live: { member: true, admin: false, anyone: false, nobody: true },
      released: { root: 0, document: 0 },
    });
  });

  it("ignores a filters event whose detail is not a token array", () => {
    const tree = navbarTree({ filters: ["member"] });
    const release = resume(tree.doc as never);

    tree.doc.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: "admin" }));

    expect(tree.hiddenByFilter()).toEqual({ member: false, admin: true, anyone: false, nobody: true });
    release();
  });
});

function twoNavbarTree() {
  const { doc, el } = fakeTree();
  (doc.defaultView as unknown as { matchMedia: () => FakeMql }).matchMedia = () => new FakeMql();

  const navbar = () => {
    const root = el("DIV", { "data-scope": NAVBAR_SCOPE, [ISLAND_STATE_ATTR]: JSON.stringify({ filters: ["member"] }) });
    const member = el("A", { "data-filter": "member" });
    const admin = el("A", { "data-filter": "admin" });
    root.append(member, admin);
    doc.root.append(root);
    return { root, member, hidden: () => ({ member: member.hidden, admin: admin.hidden }) };
  };
  const first = navbar();
  const second = navbar();
  const outside = el("P");
  doc.body.append(outside);
  doc.root.append(doc.body);

  const hidden = () => ({ first: first.hidden(), second: second.hidden() });
  return { doc, first, second, outside, hidden };
}

describe("navbar scope — targeted filters", () => {
  const seeded = { member: false, admin: true };
  const repainted = { member: true, admin: false };

  it("re-syncs only the bar the event is dispatched on", () => {
    const tree = twoNavbarTree();
    const release = resume(tree.doc as never);

    tree.first.root.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));

    expect(tree.hidden()).toEqual({ first: repainted, second: seeded });
    release();
  });

  it("re-syncs only the bar that holds the element the event is dispatched on", () => {
    const tree = twoNavbarTree();
    const release = resume(tree.doc as never);

    tree.second.member.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));

    expect(tree.hidden()).toEqual({ first: seeded, second: repainted });
    release();
  });

  it("re-syncs every bar when the event is dispatched on the document", () => {
    const tree = twoNavbarTree();
    const release = resume(tree.doc as never);

    tree.doc.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));

    expect(tree.hidden()).toEqual({ first: repainted, second: repainted });
    release();
  });

  it("ignores an event dispatched on an element outside every bar", () => {
    const tree = twoNavbarTree();
    const release = resume(tree.doc as never);

    tree.outside.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));

    expect(tree.hidden()).toEqual({ first: seeded, second: seeded });
    release();
  });
});

describe("navbar scope — the drawer gate", () => {
  it("arms the drawer only on a bar carrying the drawer attribute, and disarms it on release", () => {
    const armed = navbarTree({ drawer: true });
    const plain = navbarTree();

    const releaseArmed = resume(armed.doc as never);
    const releasePlain = resume(plain.doc as never);
    const mounted = { armed: armed.doc.listeners.get("keydown")?.length ?? 0, plain: plain.doc.listeners.get("keydown")?.length ?? 0 };

    releaseArmed();
    releasePlain();

    expect({ mounted, disarmed: armed.doc.listeners.get("keydown")?.length ?? 0 }).toEqual({ mounted: { armed: 1, plain: 0 }, disarmed: 0 });
  });
});

describe("navbar scope — closeNav", () => {
  it("shuts the disclosure when a link inside it fires the action", () => {
    const tree = navbarTree();
    const release = resume(tree.doc as never);
    const before = tree.bar.open;

    tree.anyone.dispatchEvent(new FakeEvent("click"));

    expect({ before, after: tree.bar.open }).toEqual({ before: true, after: false });
    release();
  });
});

describe("theme scope — the cycle", () => {
  it("advances the shared preference from whichever root fired", () => {
    const doc = new FakeDocument({ stored: "light" });
    doc.addTheme();
    doc.addTheme();
    const dispose = resume(asDocument(doc));

    const cycle = ["dark", "system", "light"];
    for (const [step, expected] of cycle.entries()) {
      // Alternating roots is the regression: each used to advance its own signal from a stale value.
      doc.click(doc.roots[step % 2] as FakeScopeRoot);
      expect(doc.documentElement.getAttribute(THEME_ATTR)).toBe(expected);
    }

    dispose();
  });
});
