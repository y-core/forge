import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * `lazy` across a realm boundary, in real Chromium.
 *
 * The unit set drives a fake observer on the ambient global, so it cannot tell which realm the real
 * one came from. Only a second document can: `lazy` accepts `within`, so the module may be mounted
 * from the top-level page onto an element living inside an iframe, and the observer has to be the
 * *element's* — a top-level constructor is a different object in a realm that need not even have one.
 *
 * The framed realm is made the only one that can answer, by removing the constructor from the
 * top-level global before mounting. That is a realm a controller genuinely meets — an older embedder,
 * or a document whose globals were pruned — and it makes the assertion a behavioural one: the module
 * either loaded against the framed element or it did not.
 */

declare global {
  interface Window {
    forgeLazy: typeof import("./lazy");
  }
}

const EXPOSE = { expose: { forgeLazy: "./ui/client/lazy" } };

/** The iframe sits at the top of the page so its content is inside the viewport the observer uses. */
const FIXTURE = `
<style>body { margin: 0 }</style>
<iframe id="frame" style="width: 320px; height: 240px; border: 0" srcdoc="<div data-ref='widget' style='height: 60px'>widget</div>"></iframe>
`;

/** The framed document, once the `srcdoc` content has actually parsed. */
async function mountFixture(page: Page): Promise<void> {
  await mount(page, FIXTURE, EXPOSE);
  await page.evaluate(async () => {
    const frame = document.querySelector<HTMLIFrameElement>("#frame");
    if (frame && !frame.contentDocument?.querySelector("[data-ref='widget']")) {
      await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    }
  });
}

test.describe("lazy across realms", () => {
  test("observes in the element's own realm, so a framed widget still loads", async ({ page }) => {
    await mountFixture(page);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      const frameDoc = frame?.contentDocument;
      if (!frameDoc) return null;

      // The top-level realm loses the constructor, so anything `lazy` builds from it fails outright
      // and only the framed realm can drive the load.
      Reflect.deleteProperty(window, "IntersectionObserver");

      let loaded = false;
      let initialisedInFrame: boolean | null = null;
      window.forgeLazy.lazy({
        ref: "widget",
        within: frameDoc,
        load: () => {
          loaded = true;
          return Promise.resolve({ ok: true });
        },
        init: (_mod, el) => {
          initialisedInFrame = el.ownerDocument === frameDoc;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      return { loaded, initialisedInFrame };
    });

    // `init` running at all is the whole assertion: the observer fired for an element it could only
    // have been given by the framed realm, and handed back that realm's element.
    expect(result).toEqual({ loaded: true, initialisedInFrame: true });
  });

  test("returns a no-op disposer when the element's realm has no IntersectionObserver", async ({ page }) => {
    await mountFixture(page);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      const frameDoc = frame?.contentDocument;
      if (!frame?.contentWindow || !frameDoc) return null;

      // Only the framed realm is pruned this time. The top-level one keeps a perfectly good
      // constructor, which is exactly the one that must not be reached for.
      Reflect.deleteProperty(frame.contentWindow, "IntersectionObserver");

      let loaded = false;
      const dispose = window.forgeLazy.lazy({
        ref: "widget",
        within: frameDoc,
        load: () => {
          loaded = true;
          return Promise.resolve({ ok: true });
        },
        init: () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      dispose();
      return { loaded, disposerRan: true };
    });

    expect(result).toEqual({ loaded: false, disposerRan: true });
  });
});
