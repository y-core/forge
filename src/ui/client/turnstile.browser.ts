import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { TURNSTILE_SCRIPT_SRC, TURNSTILE_SCRIPT_TIMEOUT_MS } from "../contracts/turnstile-contract";
import { Turnstile } from "../core/turnstile";
import { mount } from "./browser-test-helper";

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
    /** Delays of every `setTimeout` the page scheduled, and of every one that actually fired. */
    forgeTimers: { scheduled: number[]; fired: number[] };
    /** Reads of `window.turnstile` since the counter was last zeroed. */
    forgeTurnstileReads: { count: number };
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

/** Counts `setTimeout` firings, not merely its scheduling. Install after `mount` and after
 * `page.clock.install()`: `setContent` discards every window mutation made before it, and wrapping
 * the clock's `setTimeout` is what keeps `fastForward` in charge of the wrapped timer. */
async function countTimerFirings(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.forgeTimers = { scheduled: [], fired: [] };
    const schedule = window.setTimeout;
    const wrapped = (handler: TimerHandler, delay?: number, ...args: unknown[]): number => {
      const wait = delay ?? 0;
      const run = typeof handler === "function" ? (handler as unknown as (...rest: unknown[]) => void) : () => {};
      const fire = () => {
        window.forgeTimers.fired.push(wait);
        run(...args);
      };
      window.forgeTimers.scheduled.push(wait);
      return schedule.call(window, fire, wait);
    };
    window.setTimeout = wrapped as typeof window.setTimeout;
  });
}

/** Delays equal to `ms`, counted on both sides of the wrapper. */
function timersAt(page: Page, ms: number): Promise<{ scheduled: number; fired: number }> {
  return page.evaluate((delay) => {
    const at = (delays: number[]) => delays.filter((each) => each === delay).length;
    return { scheduled: at(window.forgeTimers.scheduled), fired: at(window.forgeTimers.fired) };
  }, ms);
}

/** Counts reads of `window.turnstile`, which is what a live poll does and a cleared one cannot. The
 * `set` trap is mandatory: a getter-only accessor throws `TypeError` when the polling case assigns
 * the late-arriving API. Same install-after-`mount` rule as {@link countTimerFirings}. */
async function countTurnstileReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.forgeTurnstileReads = { count: 0 };
    let held: Window["turnstile"];
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      get: () => {
        window.forgeTurnstileReads.count += 1;
        return held;
      },
      set: (next: Window["turnstile"]) => {
        held = next;
      },
    });
  });
}

/** Zero the read counter, so the next assertion speaks only about what happened after this point. */
async function zeroTurnstileReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.forgeTurnstileReads.count = 0;
  });
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

  test("still loads the script on a page holding an element whose id is `turnstile`", async ({ page }) => {
    await serveScript(page);
    // The DOM exposes every element with an `id` as a window property of that name, so this section
    // *is* `window.turnstile` until Cloudflare's script overwrites it.
    await mount(page, `<section id="turnstile"></section>${await formMarkup()}`, EXPOSE);
    await mountController(page);
    await engage(page);

    await expect
      .poll(() =>
        page.evaluate(() => ({
          renders: window.turnstileCalls?.renders.length ?? 0,
          fallbackHidden: document.querySelector<HTMLElement>("[data-ref='turnstile-fallback']")?.hidden ?? null,
        })),
      )
      .toEqual({ renders: 1, fallbackHidden: true });
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

  test("reveals the fallback when a pre-existing script never defines the API", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "hang");
    await mount(page, await formMarkup(), EXPOSE);
    await seedRecorder(page);

    // A script injected by something else on the page and still in flight: the controller finds it,
    // injects none of its own, and polls.
    await page.evaluate((src) => {
      const script = document.createElement("script");
      script.src = src;
      document.head.appendChild(script);
    }, TURNSTILE_SCRIPT_SRC);

    await mountController(page);
    await engage(page);
    expect(await scriptCount(page)).toBe(1);

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

    expect(after).toEqual({ removes: 1, resets: 0 });
  });

  test("cleanup while the script is in flight cancels the fallback timeout", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "hang");
    await mount(page, await formMarkup(), EXPOSE);
    await seedRecorder(page);
    // Instrumented here and not a line earlier: see `countTimerFirings`.
    await countTimerFirings(page);
    await mountController(page);
    await engage(page);

    await page.evaluate(() => window.turnstileCleanup?.());
    await page.clock.fastForward(TURNSTILE_SCRIPT_TIMEOUT_MS);

    expect(await timersAt(page, TURNSTILE_SCRIPT_TIMEOUT_MS)).toEqual({ scheduled: 1, fired: 0 });

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
  });

  test("cleanup while polling an already-present script stops the poll", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "hang");
    await mount(page, await formMarkup(), EXPOSE);
    await seedRecorder(page);
    // Instrumented here and not a line earlier: see `countTimerFirings`.
    await countTurnstileReads(page);

    await page.evaluate((src) => {
      const script = document.createElement("script");
      script.src = src;
      document.head.appendChild(script);
    }, TURNSTILE_SCRIPT_SRC);

    await mountController(page);
    await engage(page);
    expect(await scriptCount(page)).toBe(1);

    // The poll, evidenced live before it is stopped: three ticks of the 100ms interval.
    await zeroTurnstileReads(page);
    await page.clock.fastForward(300);
    const polled = await page.evaluate(() => window.forgeTurnstileReads.count);
    expect(polled, "the poll never read `window.turnstile`, so the assertion below is vacuous").toBeGreaterThan(0);

    await page.evaluate(() => window.turnstileCleanup?.());
    await zeroTurnstileReads(page);

    await page.evaluate(() => {
      window.turnstile = {
        render: () => {
          window.turnstileCalls.renders.push({ sitekey: null, size: null, theme: null });
          return "widget-late";
        },
        reset: () => {},
        remove: () => {},
      };
    });
    await page.clock.fastForward(TURNSTILE_SCRIPT_TIMEOUT_MS);

    expect(await page.evaluate(() => window.forgeTurnstileReads.count)).toBe(0);
    expect(await page.evaluate(() => window.turnstileCalls.renders.length)).toBe(0);
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
