import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { TURNSTILE_SCRIPT_SRC, TURNSTILE_SCRIPT_TIMEOUT_MS } from "../contracts/turnstile-contract";
import { Turnstile } from "../core/turnstile";
import { mount } from "./browser-test-helper";

/**
 * `mountTurnstile()` in a real browser, against the real `<Turnstile>` markup.
 *
 * Two things are faked and nothing else. **The network** — `page.route` intercepts Cloudflare's
 * script URL, so the controller performs a genuine `<script>` load whose outcome the test chooses
 * (served, aborted, or never answered). **The `window.turnstile` global** — a third-party API, not
 * a DOM feature, which is the shape `TESTING.md` §4's fakes-over-mocks rule already covers. The
 * DOM, the events, the timers and the form are all the platform's.
 */

declare global {
  interface Window {
    forgeTurnstile: typeof import("./turnstile");
    /** Recorder installed by the fake Cloudflare script. */
    turnstileCalls: {
      renders: Array<{ sitekey: unknown; size: unknown; theme: unknown }>;
      resets: number;
      removes: number;
      params: Record<string, unknown> | null;
    };
    /** Cleanup returned by the controller, parked so a later evaluate can call it. */
    turnstileCleanup?: () => void;
  }
}

/** Stands in for Cloudflare's `api.js`: installs a recording `window.turnstile` and nothing else. */
const FAKE_SCRIPT = `
  window.turnstileCalls = { renders: [], resets: 0, removes: 0, params: null };
  window.turnstile = {
    render: function (el, params) {
      window.turnstileCalls.params = params;
      window.turnstileCalls.renders.push({ sitekey: params.sitekey, size: params.size, theme: params.theme });
      return "widget-1";
    },
    reset: function () { window.turnstileCalls.resets += 1; },
    remove: function () { window.turnstileCalls.removes += 1; },
  };
`;

/** The real SSR markup: a form with a field to focus and the `<Turnstile>` widget inside it. */
function formMarkup(): Promise<string> {
  return render(
    jsx("form", { id: "form", children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", size: "normal" })] }),
  );
}

/** Serve the fake Cloudflare script, and seed the recorder so assertions never read `undefined`. */
async function serveScript(page: Page, outcome: "ok" | "abort" | "hang" = "ok"): Promise<void> {
  await page.route(TURNSTILE_SCRIPT_SRC, async (route) => {
    if (outcome === "abort") return route.abort();
    // "hang": never answer, so neither `load` nor `error` fires and only the timeout can resolve it.
    if (outcome === "hang") return;
    return route.fulfill({ contentType: "application/javascript", body: FAKE_SCRIPT });
  });
}

/** Reset the recorder before the script has a chance to define it, so every case can read it. */
async function seedRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.turnstileCalls = { renders: [], resets: 0, removes: 0, params: null };
  });
}

async function mountController(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.turnstileCleanup = window.forgeTurnstile.mountTurnstile();
  });
}

/** Real engagement: a bubbling `focusin` from the form's own field, which is what gates the load. */
async function engage(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#field")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
}

const EXPOSE = { expose: { forgeTurnstile: "./ui/client/turnstile" } };

/** Count of `<script>` tags the controller injected for Cloudflare's API. */
function scriptCount(page: Page): Promise<number> {
  return page.evaluate((src) => document.querySelectorAll(`script[src="${src}"]`).length, TURNSTILE_SCRIPT_SRC);
}

test.describe("mountTurnstile — engagement-gated load", () => {
  test("injects no script until the form is engaged", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);

    expect(await scriptCount(page)).toBe(0);
  });

  test("loads the script exactly once, however many times the form is engaged", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);

    await engage(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await scriptCount(page)).toBe(1);
    expect(await page.evaluate(() => document.querySelector<HTMLScriptElement>(`script[src*="turnstile"]`)?.async)).toBe(true);
  });
});

test.describe("mountTurnstile — rendering", () => {
  test("renders with the sitekey, size and the light theme", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.renders[0])).toEqual({ sitekey: "site-key", size: "normal", theme: "light" });
  });

  test("renders with the dark theme when <html> carries the dark class", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.renders[0]?.theme)).toBe("dark");
  });
});

test.describe("mountTurnstile — token lifecycle", () => {
  test("resets the token after every submission, clearing the form only on success", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const afterSuccess = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#field");
      if (field) field.value = "typed@example.com";
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true } }));
      return { resets: window.turnstileCalls.resets, value: field?.value };
    });
    expect(afterSuccess).toEqual({ resets: 1, value: "" });

    const afterFailure = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#field");
      if (field) field.value = "typed@example.com";
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: false } }));
      return { resets: window.turnstileCalls.resets, value: field?.value };
    });
    // Token still reset on failure; the fields are preserved so the user can correct them.
    expect(afterFailure).toEqual({ resets: 2, value: "typed@example.com" });
  });

  test("resets the token when Turnstile's expired-callback fires", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const resets = await page.evaluate(() => {
      const params = window.turnstileCalls.params ?? {};
      (params["expired-callback"] as () => void)();
      (params["timeout-callback"] as () => void)();
      return window.turnstileCalls.resets;
    });

    expect(resets).toBe(2);
  });
});

test.describe("mountTurnstile — fails visible", () => {
  test("reveals the fallback when the script request fails", async ({ page }) => {
    await serveScript(page, "abort");
    await mount(page, await formMarkup(), EXPOSE);
    await seedRecorder(page);
    await mountController(page);
    await engage(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
  });

  test("reveals the fallback when the script never answers within the timeout budget", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "hang");
    await mount(page, await formMarkup(), EXPOSE);
    await seedRecorder(page);
    await mountController(page);
    await engage(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
    await page.clock.fastForward(TURNSTILE_SCRIPT_TIMEOUT_MS);
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
  });

  test("reveals the fallback when Turnstile's error-callback fires", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
    await page.evaluate(() => {
      const params = window.turnstileCalls.params ?? {};
      (params["error-callback"] as () => void)();
    });
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
  });

  test("the submit affordance is never gated on the challenge", async ({ page }) => {
    await serveScript(page, "abort");
    const html = await render(
      jsx("form", {
        id: "form",
        children: [
          jsx("input", { id: "field", name: "email" }),
          Turnstile({ siteKey: "site-key" }),
          jsx("button", { id: "submit", type: "submit", children: "Send" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await seedRecorder(page);
    await mountController(page);
    await engage(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    await expect(page.locator("#submit")).toBeEnabled();
  });
});

test.describe("mountTurnstile — lifecycle", () => {
  test("is idempotent for the same widget", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);

    const same = await page.evaluate(() => {
      const first = window.forgeTurnstile.mountTurnstile();
      const second = window.forgeTurnstile.mountTurnstile();
      window.turnstileCleanup = first;
      return first === second;
    });

    expect(same).toBe(true);
  });

  test("cleanup detaches the form listeners and removes the rendered widget", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const after = await page.evaluate(() => {
      window.turnstileCleanup?.();
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true } }));
      return { removes: window.turnstileCalls.removes, resets: window.turnstileCalls.resets };
    });

    // `remove` ran once; the detached `htmx:afterRequest` listener produced no further reset.
    expect(after).toEqual({ removes: 1, resets: 0 });
  });

  test("returns a no-op cleanup and loads nothing when no widget is present", async ({ page }) => {
    await serveScript(page);
    await mount(page, await render(jsx("form", { id: "form", children: jsx("input", { id: "field" }) })), EXPOSE);

    const threw = await page.evaluate(() => {
      try {
        window.forgeTurnstile.mountTurnstile()();
        return false;
      } catch {
        return true;
      }
    });

    expect(threw).toBe(false);
    expect(await scriptCount(page)).toBe(0);
  });

  test("returns a no-op cleanup when the widget has no enclosing form", async ({ page }) => {
    await serveScript(page);
    await mount(page, await render(Turnstile({ siteKey: "site-key" })), EXPOSE);

    const threw = await page.evaluate(() => {
      try {
        window.forgeTurnstile.mountTurnstile()();
        return false;
      } catch {
        return true;
      }
    });

    expect(threw).toBe(false);
    expect(await scriptCount(page)).toBe(0);
  });
});
