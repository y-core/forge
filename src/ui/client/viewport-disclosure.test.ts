import { describe, expect, it } from "bun:test";

import { MD_DOWN_QUERY, resolveDisclosure, trackViewport } from "./viewport-disclosure";

class FakeMediaQueryList {
  readonly media: string;

  constructor(media: string) {
    this.media = media;
  }

  addEventListener(): void {}
}

interface FakeWindow {
  matchMedia?: ((query: string) => unknown) | undefined;
}

class FakeDocument {
  readonly nodeType = 9;
  readonly defaultView: FakeWindow;
  readonly found: Record<string, unknown> = {};

  constructor(view: FakeWindow) {
    this.defaultView = view;
  }

  querySelector(selector: string): unknown {
    return this.found[selector] ?? null;
  }
}

function fakeDisclosure(view: FakeWindow = { matchMedia: (query) => new FakeMediaQueryList(query) }): { doc: FakeDocument; el: Element } {
  const doc = new FakeDocument(view);
  const el = { nodeType: 1, open: false, ownerDocument: doc } as unknown as Element;
  return { doc, el };
}

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

describe("MD_DOWN_QUERY", () => {
  it("matches only below Tailwind's `md` breakpoint, in `rem`", () => {
    expect(MD_DOWN_QUERY).toBe("(max-width: 47.99rem)");
  });
});

describe("resolveDisclosure", () => {
  it("returns a given element that has an `open` property", () => {
    const { el } = fakeDisclosure();

    expect(resolveDisclosure("mountTest", { element: el })).toBe(el as HTMLDetailsElement);
  });

  it("resolves a selector in the document of `within`", () => {
    const { doc, el } = fakeDisclosure();
    doc.found["#bar"] = el;

    expect(resolveDisclosure("mountTest", { selector: "#bar", within: doc as unknown as Node })).toBe(el as HTMLDetailsElement);
  });

  it("throws naming the owner and the given element when it is not a disclosure", () => {
    expect(() => resolveDisclosure("mountTest", { element: { nodeType: 1 } as unknown as Element })).toThrow(
      "mountTest: the given `element` did not resolve to a disclosure with an `open` property",
    );
  });

  it("throws naming the owner and the selector when nothing resolves", () => {
    const { doc } = fakeDisclosure();

    expect(() => resolveDisclosure("mountTest", { selector: "#missing", within: doc as unknown as Node })).toThrow(
      "mountTest: `#missing` did not resolve to a disclosure with an `open` property",
    );
  });

  it("throws naming `(none)` when given neither an element nor a selector", () => {
    expect(() => resolveDisclosure("mountTest", {})).toThrow("mountTest: `(none)` did not resolve");
  });
});

describe("trackViewport", () => {
  it("returns the disclosure realm's MediaQueryList for the query, without warning", () => {
    const { el } = fakeDisclosure();

    const { result, warnings } = captureWarnings(() => trackViewport("test-tag", el, "(max-width: 30rem)"));

    expect((result as unknown as FakeMediaQueryList).media).toBe("(max-width: 30rem)");
    expect(warnings).toEqual([]);
  });

  it("warns under the tag and returns null when the realm has no matchMedia", () => {
    const { el } = fakeDisclosure({});

    const { result, warnings } = captureWarnings(() => trackViewport("test-tag", el, MD_DOWN_QUERY));

    expect(result).toBeNull();
    expect(warnings).toEqual(["[test-tag] matchMedia is unavailable in this realm; the disclosure will not track the viewport"]);
  });

  it("warns under the tag and returns null when the MediaQueryList has no addEventListener", () => {
    const { el } = fakeDisclosure({ matchMedia: () => ({}) });

    const { result, warnings } = captureWarnings(() => trackViewport("test-tag", el, MD_DOWN_QUERY));

    expect(result).toBeNull();
    expect(warnings).toEqual(["[test-tag] this realm's MediaQueryList has no addEventListener; the disclosure will not track the viewport"]);
  });
});
