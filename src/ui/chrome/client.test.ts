import { describe, expect, it } from "bun:test";

import { resume, resumeScope } from "../client/resume";
import { FakeElement, FakeEvent, fakeTree } from "../client/test-dom";
import { ISLAND_STATE_ATTR } from "../contracts/island-contract";
import { NAVBAR_DRAWER_ATTR, NAVBAR_FILTERS_EVENT, NAVBAR_SCOPE } from "../contracts/navbar-contract";
import { THEME_SCOPE } from "../contracts/theme-toggle-contract";
import { isDark } from "./client";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

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

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
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
  readonly dataset: { scope: string; state: string };
  readonly ownerDocument: FakeDocument;

  constructor(ownerDocument: FakeDocument, scope: string, state: Record<string, unknown>) {
    this.ownerDocument = ownerDocument;
    this.dataset = { scope, state: JSON.stringify(state) };
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
    if (options.stored) this.storage.setItem(THEME_STORAGE_KEY, options.stored);
    this.defaultView = { localStorage: this.storage };
    if (options.matchMedia !== false) this.defaultView.matchMedia = () => this.mql;
  }

  addTheme(): FakeScopeRoot {
    const root = new FakeScopeRoot(this, THEME_SCOPE, { pref: DEFAULT_PREF });
    this.roots.push(root);
    return root;
  }

  querySelectorAll(): FakeScopeRoot[] {
    return this.roots;
  }

  addEventListener(): void {}

  removeEventListener(): void {}
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
  bar.append(member, admin, anyone);
  root.append(bar);
  doc.root.append(root);

  const hiddenByFilter = () => ({ member: member.hidden, admin: admin.hidden, anyone: anyone.hidden });
  return { doc, bar, anyone, hiddenByFilter };
}

describe("navbar scope — auth filters", () => {
  it("hides every filtered element the hydrated token list does not name, and nothing unfiltered", () => {
    const tree = navbarTree({ filters: ["member"] });

    const release = resume(tree.doc as never);

    expect(tree.hiddenByFilter()).toEqual({ member: false, admin: true, anyone: false });
    release();
  });

  // The listener count, not "nothing moved after release": disposing the effect owner already makes
  // a leaked listener invisible, so the outcome would hold with the removal deleted (TESTING.md §3d).
  it("re-syncs on the filters event while resumed and takes its document listener off on release", () => {
    const tree = navbarTree({ filters: ["member"] });
    const release = resume(tree.doc as never);
    const armed = tree.doc.listeners.get(NAVBAR_FILTERS_EVENT)?.length ?? 0;

    tree.doc.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: ["admin"] }));
    const live = tree.hiddenByFilter();

    release();

    expect({ armed, live, released: tree.doc.listeners.get(NAVBAR_FILTERS_EVENT)?.length ?? 0 }).toEqual({
      armed: 1,
      live: { member: true, admin: false, anyone: false },
      released: 0,
    });
  });

  it("ignores a filters event whose detail is not a token array", () => {
    const tree = navbarTree({ filters: ["member"] });
    const release = resume(tree.doc as never);

    tree.doc.dispatchEvent(new FakeEvent(NAVBAR_FILTERS_EVENT, { detail: "admin" }));

    expect(tree.hiddenByFilter()).toEqual({ member: false, admin: true, anyone: false });
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
      const pref = prefOf(doc.roots[step % 2] as FakeScopeRoot);
      if (pref) pref.value = { light: "dark", dark: "system", system: "light" }[pref.value as string] ?? DEFAULT_PREF;
      expect(doc.documentElement.getAttribute(THEME_ATTR)).toBe(expected);
    }

    dispose();
  });
});
