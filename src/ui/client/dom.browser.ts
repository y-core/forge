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
