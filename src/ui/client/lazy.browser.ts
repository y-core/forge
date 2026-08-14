import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

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

    expect(result).toEqual({ loaded: true, initialisedInFrame: true });
  });

  test("returns a no-op disposer when the element's realm has no IntersectionObserver", async ({ page }) => {
    await mountFixture(page);

    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      const frameDoc = frame?.contentDocument;
      if (!frame?.contentWindow || !frameDoc) return null;

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
