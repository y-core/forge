import { expect, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * The owner-document utilities against the platform that defines them.
 *
 * Every case below pairs the utility with the bare global it replaces and asserts they **disagree**.
 * That pairing is the point: a test that only checked `activeElement(host)` returns the inner button
 * would pass against an implementation that forgot shadow DOM entirely. Asserting that
 * `document.activeElement` reports the *host* at the same moment is what makes the case falsifiable.
 */

declare global {
  interface Window {
    forgeDom: typeof import("./dom");
  }
}

const EXPOSE = { expose: { forgeDom: "./ui/client/dom" } };

/** A host element with an open shadow root containing a focusable button and a nested div. */
const SHADOW_FIXTURE = `
  <div id="host"></div>
  <script>
    const root = document.querySelector("#host").attachShadow({ mode: "open" });
    root.innerHTML = '<div id="inner-wrap"><button id="inner">inside</button></div>';
  </script>
`;

test.describe("activeElement", () => {
  test("reaches into an open shadow root where document.activeElement stops at the host", async ({ page }) => {
    await mount(page, SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      const host = document.querySelector("#host");
      const inner = host?.shadowRoot?.querySelector<HTMLElement>("#inner");
      inner?.focus();
      return { utility: window.forgeDom.activeElement(document)?.id ?? null, bareGlobal: document.activeElement?.id ?? null };
    });

    // The disagreement IS the assertion: the bare global names the host, the utility names the item.
    expect(result).toEqual({ utility: "inner", bareGlobal: "host" });
  });

  test("returns the plain focused element when no shadow root is involved", async ({ page }) => {
    await mount(page, '<button id="plain">go</button>', EXPOSE);

    const id = await page.evaluate(() => {
      document.querySelector<HTMLElement>("#plain")?.focus();
      return window.forgeDom.activeElement(document)?.id ?? null;
    });

    expect(id).toBe("plain");
  });
});

test.describe("eventTarget", () => {
  test("returns the element actually hit, where event.target reports the retargeted host", async ({ page }) => {
    await mount(page, SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      return new Promise<{ utility: string | null; bareGlobal: string | null }>((resolve) => {
        document.addEventListener(
          "click",
          (event) => {
            resolve({
              utility: (window.forgeDom.eventTarget(event) as Element | null)?.id ?? null,
              bareGlobal: (event.target as Element | null)?.id ?? null,
            });
          },
          { once: true },
        );
        const host = document.querySelector("#host");
        host?.shadowRoot?.querySelector<HTMLElement>("#inner")?.click();
      });
    });

    expect(result).toEqual({ utility: "inner", bareGlobal: "host" });
  });

  test("falls back to event.target for a non-composed event", async ({ page }) => {
    await mount(page, '<div id="plain"></div>', EXPOSE);

    const id = await page.evaluate(() => {
      return new Promise<string | null>((resolve) => {
        const el = document.querySelector("#plain");
        el?.addEventListener("ping", (event) => resolve((window.forgeDom.eventTarget(event) as Element | null)?.id ?? null));
        el?.dispatchEvent(new CustomEvent("ping", { composed: false }));
      });
    });

    expect(id).toBe("plain");
  });
});

/**
 * A `[data-scope]` wrapper whose shadow root holds a button and an `<a href>` pointing at a real
 * origin, so `link.host` is the non-empty string `"example.com"` — an anchor is the one element in
 * the platform whose `host` property is a URL component rather than a shadow host.
 */
const ANCHOR_SHADOW_FIXTURE = `
  <div data-scope="demo" id="scope"><div id="widget"></div></div>
  <script>
    const root = document.querySelector("#widget").attachShadow({ mode: "open" });
    root.innerHTML = '<button id="btn">go</button><a id="link" href="https://example.com/deep">link</a>';
  </script>
`;

test.describe("closestAcross", () => {
  test("resolves a delegated click on an <a href> instead of throwing on its URL host", async ({ page }) => {
    await mount(page, ANCHOR_SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      return new Promise<{ scope: string | null; anchorHost: string; error: string | null }>((resolve) => {
        const widget = document.querySelector("#widget");
        const link = widget?.shadowRoot?.querySelector<HTMLAnchorElement>("#link");
        document.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            const anchorHost = link?.host ?? "";
            try {
              const hit = window.forgeDom.closestAcross(window.forgeDom.eventTarget(event) as Node, "[data-scope]");
              resolve({ scope: hit?.id ?? null, anchorHost, error: null });
            } catch (error) {
              resolve({ scope: null, anchorHost, error: String(error) });
            }
          },
          { once: true },
        );
        link?.click();
      });
    });

    // `anchorHost` is asserted, not incidental: it is the truthy value that made the climb step off
    // the tree onto a string and throw on the next hop.
    expect(result).toEqual({ scope: "scope", anchorHost: "example.com", error: null });
  });

  test("crosses a shadow boundary where Element.closest is confined to its own tree", async ({ page }) => {
    await mount(page, ANCHOR_SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      const btn = document.querySelector("#widget")?.shadowRoot?.querySelector("#btn");
      if (!btn) return null;
      return { utility: window.forgeDom.closestAcross(btn, "[data-scope]")?.id ?? null, bareGlobal: btn.closest("[data-scope]")?.id ?? null };
    });

    expect(result).toEqual({ utility: "scope", bareGlobal: null });
  });

  test("returns null when the climb reaches the document without a match", async ({ page }) => {
    await mount(page, '<div id="wrap"><a id="link" href="https://example.com/deep">link</a></div>', EXPOSE);

    const isNull = await page.evaluate(() => window.forgeDom.closestAcross(document.querySelector("#link"), "[data-scope]") === null);

    expect(isNull).toBe(true);
  });

  // The three cases above all climb from an **attached** node, so the `getRootNode()` fallback is
  // never reached with anything but a Document. Detached is where it bites: the root is the topmost
  // ancestor *element*, and on an anchor with an absolute URL its `host` is a non-empty string.
  test("terminates on a detached subtree rooted at an <a href> with an absolute URL", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const result = await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://example.com/deep";
      const leaf = document.createElement("span");
      link.append(leaf);
      try {
        const hit = window.forgeDom.closestAcross(leaf, "[data-scope]");
        return { hit: hit?.id ?? null, rootHost: link.host, connected: leaf.isConnected, error: null };
      } catch (error) {
        return { hit: null, rootHost: link.host, connected: leaf.isConnected, error: String(error) };
      }
    });

    // `rootHost` is asserted for the same reason as above: it is the truthy string the unguarded
    // read stepped onto, throwing `TypeError: current.getRootNode is not a function` next hop.
    expect(result).toEqual({ hit: null, rootHost: "example.com", connected: false, error: null });
  });

  // A *relative* href is no safer here, which is the non-obvious half. An attached anchor's `host`
  // is `""` only when the URL fails to parse; a detached anchor resolves the relative href against
  // the document base and reports the page's own origin — truthy, and equally fatal unguarded.
  test("terminates on a detached subtree rooted at an <a href> with a relative URL", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const result = await page.evaluate(() => {
      const link = document.createElement("a");
      link.setAttribute("href", "/relative");
      const leaf = document.createElement("span");
      link.append(leaf);
      try {
        const hit = window.forgeDom.closestAcross(leaf, "[data-scope]");
        return { hit: hit?.id ?? null, rootHostEmpty: link.host === "", error: null };
      } catch (error) {
        return { hit: null, rootHostEmpty: link.host === "", error: String(error) };
      }
    });

    expect(result).toEqual({ hit: null, rootHostEmpty: false, error: null });
  });
});

test.describe("contains", () => {
  test("climbs the shadow host where Node.contains stops at the boundary", async ({ page }) => {
    await mount(page, SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      const host = document.querySelector("#host");
      const inner = host?.shadowRoot?.querySelector("#inner");
      if (!host || !inner) return null;
      return { utility: window.forgeDom.contains(document.body, inner), bareGlobal: document.body.contains(inner) };
    });

    expect(result).toEqual({ utility: true, bareGlobal: false });
  });

  test("still answers no for an element that is genuinely outside", async ({ page }) => {
    await mount(page, `${SHADOW_FIXTURE}<div id="outside"></div>`, EXPOSE);

    const result = await page.evaluate(() => {
      const host = document.querySelector("#host");
      const outside = document.querySelector("#outside");
      return outside ? window.forgeDom.contains(host, outside) : null;
    });

    expect(result).toBe(false);
  });

  // `contains` carried the identical unguarded `.host` read, and unlike `closestAcross` it was
  // recorded nowhere. Same fixture, same failure: a detached subtree under an absolute-URL anchor.
  test("answers no for a detached subtree rooted at an <a href> rather than throwing", async ({ page }) => {
    await mount(page, '<div id="parent"></div>', EXPOSE);

    const result = await page.evaluate(() => {
      const parent = document.querySelector("#parent");
      const link = document.createElement("a");
      link.href = "https://example.com/deep";
      const leaf = document.createElement("span");
      link.append(leaf);
      try {
        return { contained: window.forgeDom.contains(parent, leaf), rootHost: link.host, error: null };
      } catch (error) {
        return { contained: null, rootHost: link.host, error: String(error) };
      }
    });

    expect(result).toEqual({ contained: false, rootHost: "example.com", error: null });
  });

  test("still answers yes within a detached subtree, where no boundary is crossed", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const contained = await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://example.com/deep";
      const leaf = document.createElement("span");
      link.append(leaf);
      return window.forgeDom.contains(link, leaf);
    });

    expect(contained).toBe(true);
  });

  test("answers no for a null parent or child rather than throwing", async ({ page }) => {
    await mount(page, '<div id="plain"></div>', EXPOSE);

    const result = await page.evaluate(() => {
      const el = document.querySelector("#plain");
      return [window.forgeDom.contains(null, el), window.forgeDom.contains(el, null), window.forgeDom.contains(el, el)];
    });

    expect(result).toEqual([false, false, true]);
  });
});

test.describe("ownerDocument / ownerWindow", () => {
  test("resolve an iframe's own realm, not the top-level one", async ({ page }) => {
    await mount(page, '<iframe id="frame" srcdoc="<button id=\'framed\'>go</button>"></iframe>', EXPOSE);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      if (!frame) return null;
      if (!frame.contentDocument?.querySelector("#framed")) {
        await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      }
      const framed = frame.contentDocument?.querySelector("#framed");
      if (!framed) return null;
      return {
        sameDocumentAsTop: window.forgeDom.ownerDocument(framed) === document,
        isFrameDocument: window.forgeDom.ownerDocument(framed) === frame.contentDocument,
        sameWindowAsTop: window.forgeDom.ownerWindow(framed) === window,
        isFrameWindow: window.forgeDom.ownerWindow(framed) === frame.contentWindow,
      };
    });

    expect(result).toEqual({ sameDocumentAsTop: false, isFrameDocument: true, sameWindowAsTop: false, isFrameWindow: true });
  });

  test("resolve a document argument to itself rather than delegating to the global", async ({ page }) => {
    await mount(page, '<iframe id="frame" srcdoc="<p>hi</p>"></iframe>', EXPOSE);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      if (!frame) return null;
      if (!frame.contentDocument?.body.firstChild) {
        await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      }
      const frameDoc = frame.contentDocument;
      // A Document's own `ownerDocument` is null; without the identity check this would silently
      // resolve to the top-level document.
      return frameDoc ? window.forgeDom.ownerDocument(frameDoc) === frameDoc : null;
    });

    expect(result).toBe(true);
  });

  test("fall back to the ambient realm for a null node", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const result = await page.evaluate(() => ({
      doc: window.forgeDom.ownerDocument(null) === document,
      win: window.forgeDom.ownerWindow(null) === window,
    }));

    expect(result).toEqual({ doc: true, win: true });
  });
});

test.describe("asElement", () => {
  test("accepts an element from another realm that instanceof HTMLElement rejects", async ({ page }) => {
    await mount(page, '<iframe id="frame" srcdoc="<button id=\'framed\'>go</button>"></iframe>', EXPOSE);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      if (!frame) return null;
      if (!frame.contentDocument?.querySelector("#framed")) {
        await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      }
      const framed = frame.contentDocument?.querySelector("#framed");
      if (!framed) return null;
      return { utility: window.forgeDom.asElement(framed)?.id ?? null, bareGlobal: framed instanceof HTMLElement };
    });

    // The cross-realm constructor check says "not an element" about an element.
    expect(result).toEqual({ utility: "framed", bareGlobal: false });
  });

  test("rejects a non-element target", async ({ page }) => {
    await mount(page, "<div></div>", EXPOSE);

    const result = await page.evaluate(() => [
      window.forgeDom.asElement(null),
      window.forgeDom.asElement(document),
      window.forgeDom.asElement(document.createTextNode("x")),
    ]);

    expect(result).toEqual([null, null, null]);
  });
});

test.describe("elementById", () => {
  test("resolves an id inside a shadow root, where document.getElementById cannot see it", async ({ page }) => {
    await mount(page, SHADOW_FIXTURE, EXPOSE);

    const result = await page.evaluate(() => {
      const wrap = document.querySelector("#host")?.shadowRoot?.querySelector("#inner-wrap");
      if (!wrap) return null;
      return { utility: window.forgeDom.elementById(wrap, "inner")?.id ?? null, bareGlobal: document.getElementById("inner")?.id ?? null };
    });

    // The disagreement IS the assertion, exactly as for the utilities above. Ids do not cross a shadow
    // boundary, so a `commandfor` naming a sibling in the same shadow tree resolves to nothing through
    // the document — and the caller reads that silence as "no such element".
    expect(result).toEqual({ utility: "inner", bareGlobal: null });
  });

  test("resolves a document-scoped id exactly as the document lookup would", async ({ page }) => {
    await mount(page, '<div id="wrap"><button id="target">go</button></div>', EXPOSE);

    const result = await page.evaluate(() => {
      const wrap = document.querySelector("#wrap");
      if (!wrap) return null;
      return { utility: window.forgeDom.elementById(wrap, "target")?.id ?? null, bareGlobal: document.getElementById("target")?.id ?? null };
    });

    // The widening half: nothing about the ordinary case changes, so no existing caller moves.
    expect(result).toEqual({ utility: "target", bareGlobal: "target" });
  });

  // A **detached** subtree is where the duck-typed method test earns its place: `getRootNode()` there
  // returns the topmost ancestor *element*, which has no `getElementById` at all. A root-type check —
  // or no check — reaches for a method that is not there and throws.
  test("falls back to the owner document for a detached subtree, whose root is an Element", async ({ page }) => {
    await mount(page, '<div id="wrap"><button id="target">go</button></div>', EXPOSE);

    const result = await page.evaluate(() => {
      const detachedRoot = document.createElement("div");
      const leaf = document.createElement("span");
      detachedRoot.append(leaf);
      const root = leaf.getRootNode() as Partial<Document> & { nodeType: number };
      const probe = { rootIsElement: root.nodeType === 1, rootHasLookup: typeof root.getElementById, connected: leaf.isConnected };
      try {
        return { ...probe, found: window.forgeDom.elementById(leaf, "target")?.id ?? null, error: null };
      } catch (error) {
        return { ...probe, found: null, error: String(error) };
      }
    });

    // `rootHasLookup` is asserted, not incidental: it is the whole reason the `typeof` guard exists,
    // and without it here the case reads as an ordinary fallback rather than as the guard it pins.
    // Delete the guard and this becomes `TypeError: root.getElementById is not a function`.
    expect(result).toEqual({ rootIsElement: true, rootHasLookup: "undefined", connected: false, found: "target", error: null });
  });

  test("answers null for an empty id rather than asking the tree for one", async ({ page }) => {
    await mount(page, '<div id="wrap"><button id="target">go</button></div>', EXPOSE);

    // The shape a caller hands in when the attribute is absent: `el.getAttribute("commandfor") ?? ""`.
    const result = await page.evaluate(() => {
      const wrap = document.querySelector("#wrap");
      return wrap ? window.forgeDom.elementById(wrap, "") : "no wrap";
    });

    expect(result).toBe(null);
  });
});

test.describe("resume — shadow delegation", () => {
  test("dispatches an action for a trigger inside a shadow root", async ({ page }) => {
    await mount(
      page,
      `<div data-scope="demo" id="scope"></div>
       <script>
         const root = document.querySelector("#scope").attachShadow({ mode: "open" });
         root.innerHTML = '<button id="btn" data-on-click="act">go</button>';
       </script>`,
      { expose: { forgeDom: "./ui/client/dom", forgeResume: "./ui/client/resume" } },
    );

    const calls = await page.evaluate(() => {
      const seen: string[] = [];
      window.forgeResume.registerScope("demo", {
        on: {
          act: () => {
            seen.push("act");
          },
        },
      });
      window.forgeResume.resume();
      const scope = document.querySelector("#scope");
      scope?.shadowRoot?.querySelector<HTMLElement>("#btn")?.click();
      return seen;
    });

    // Before A3 this was empty: `event.target` reported the scope root, which carries no
    // `data-on-click`, so the delegated dispatcher found nothing to run.
    expect(calls).toEqual(["act"]);
  });
});

declare global {
  interface Window {
    forgeResume: typeof import("./resume");
  }
}
