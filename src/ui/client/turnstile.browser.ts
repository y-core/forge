import { expect, type Page, test } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import {
  TURNSTILE_EXECUTE_TIMEOUT_MS,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_SCRIPT_URL,
} from "../contracts/turnstile-contract";
import { Turnstile } from "../core/turnstile";
import { mount } from "./browser-test-helper";
import { TURNSTILE_FOCUS_GUARD_MS } from "./turnstile";

declare global {
  interface Window {
    forgeTurnstile: typeof import("./turnstile");
    forgeResume: typeof import("./resume");
    /** Recorder installed by the fake Cloudflare script. */
    turnstileCalls: {
      renders: Array<{ sitekey: unknown; size: unknown; theme: unknown }>;
      resets: number;
      removes: number;
      executes: number;
      params: Record<string, unknown> | null;
    };
    /** The `skipConfirmation` argument of every request the held submission released. */
    turnstileIssued: boolean[];
    /** Cleanup returned by the controller, parked so a later evaluate can call it. */
    turnstileCleanup?: () => void;
    /** Delays of every `setTimeout` the page scheduled, and of every one that actually fired. */
    forgeTimers: { scheduled: number[]; fired: number[] };
    /** Reads of `window.turnstile` since the counter was last zeroed. */
    forgeTurnstileReads: { count: number };
    /** What each focus-meddling fake did when its moment came, in the order it happened. */
    turnstileFocusActs: string[];
  }
}

/** Stands in for Cloudflare's `api.js`: installs a recording `window.turnstile` and nothing else. */
const FAKE_SCRIPT = `
  window.turnstileCalls = { renders: [], resets: 0, removes: 0, executes: 0, params: null };
  window.turnstile = {
    render: function (el, params) {
      window.turnstileCalls.params = params;
      window.turnstileCalls.renders.push({ sitekey: params.sitekey, size: params.size, theme: params.theme });
      return "widget-1";
    },
    // Records only: the real challenge answers later, which is what completeChallenge stands in for.
    execute: function () { window.turnstileCalls.executes += 1; },
    reset: function () { window.turnstileCalls.resets += 1; },
    remove: function () { window.turnstileCalls.removes += 1; },
  };
`;

/** The real SSR markup: a form with a field to focus and the `<Turnstile>` widget inside it. Deferred
 * by default here, because most of what this suite exercises is what the load leads to rather than
 * what starts it — the eager default gets its own describe below. */
function formMarkup(load: "eager" | "focus" = "focus"): Promise<string> {
  return render(
    jsx("form", { id: "form", children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", size: "normal", load })] }),
  );
}

/** The same form with a second field, so a deliberate move has somewhere legitimate to land. */
function twoFieldFormMarkup(): Promise<string> {
  return render(
    jsx("form", {
      id: "form",
      children: [
        jsx("input", { id: "field", name: "email" }),
        jsx("input", { id: "field-b", name: "name" }),
        Turnstile({ siteKey: "site-key", size: "normal", load: "focus" }),
      ],
    }),
  );
}

/** A form that submits itself with htmx, which is what gives the reset a URL to test against. */
function htmxFormMarkup(): Promise<string> {
  return render(
    jsx("form", {
      id: "form",
      "hx-post": "/contact",
      children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", size: "normal", load: "focus" })],
    }),
  );
}

/** An htmx form whose challenge is deferred to the press, with the submit button the seam marks busy. */
function submitModeMarkup(options: { appearance?: "execute" | "interaction-only"; required?: boolean; htmx?: boolean } = {}): Promise<string> {
  const { appearance, required = false, htmx = true } = options;
  return render(
    jsx("form", {
      id: "form",
      ...(htmx ? { "hx-post": "/contact" } : { action: "/contact", method: "post" }),
      children: [
        jsx("input", { id: "field", name: "email", required }),
        Turnstile({ siteKey: "site-key", size: "normal", challenge: "submit", ...(appearance ? { appearance } : {}) }),
        jsx("button", { id: "submit", type: "submit", children: "Send" }),
      ],
    }),
  );
}

/** The `htmx:confirm` htmx fires before it issues a request, carrying the closure that releases it. */
const pressSubmit = (page: Page, from = "#form") =>
  page.evaluate((selector) => {
    window.turnstileIssued = window.turnstileIssued ?? [];
    const event = new CustomEvent("htmx:confirm", {
      bubbles: true,
      cancelable: true,
      detail: {
        elt: document.querySelector("#form"),
        triggeringEvent: { submitter: document.querySelector("#submit") },
        issueRequest: (skipConfirmation: boolean) => window.turnstileIssued.push(skipConfirmation),
      },
    });
    document.querySelector(selector)?.dispatchEvent(event);
    return { prevented: event.defaultPrevented, executes: window.turnstileCalls.executes };
  }, from);

/** What Cloudflare does when the deferred challenge passes: write the token input, then call back. */
const completeChallenge = (page: Page) =>
  page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "cf-turnstile-response";
    input.value = "token-1";
    document.querySelector("[data-ref='turnstile']")?.appendChild(input);
    ((window.turnstileCalls.params ?? {}).callback as (token: string) => void)("token-1");
  });

/** What the reader can see of the held window: the released requests, and the state of the button. */
const submitState = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("#submit");
    return {
      issued: window.turnstileIssued ?? [],
      executes: window.turnstileCalls.executes,
      disabled: button?.disabled ?? null,
      busy: button?.getAttribute("aria-busy"),
      token: document.querySelector<HTMLInputElement>("[name='cf-turnstile-response']")?.value ?? null,
    };
  });

/** Two independent forms, each with its own `<Turnstile>` — what a page with two widgets renders. */
function twoFormsMarkup(): Promise<string> {
  const form = (id: string, field: string, siteKey: string, size: "compact" | "normal") =>
    jsx("form", { id, children: [jsx("input", { id: field, name: "email" }), Turnstile({ siteKey, size, load: "focus" })] });
  return render(jsx("div", { children: [form("form", "field", "key-a", "normal"), form("form-b", "field-b", "key-b", "compact")] }));
}

/** The same, with the focus grab Cloudflare's widget performs as it mounts. */
const FAKE_SCRIPT_STEALING_FOCUS = `${FAKE_SCRIPT}
  var render = window.turnstile.render;
  window.turnstile.render = function (el, params) {
    var id = render(el, params);
    var inner = document.createElement('input');
    inner.id = 'widget-inner';
    el.appendChild(inner);
    inner.focus();
    return id;
  };
`;

/** Grabs focus into the widget `delay` ms after `render` returned, recording whether the grab landed. */
const stealsFocusAfter = (delay: number) => `${FAKE_SCRIPT}
  window.turnstileFocusActs = [];
  var renderThenSteal = window.turnstile.render;
  window.turnstile.render = function (el, params) {
    var id = renderThenSteal(el, params);
    var inner = document.createElement('input');
    inner.id = 'widget-inner';
    el.appendChild(inner);
    setTimeout(function () {
      inner.focus();
      window.turnstileFocusActs.push(document.activeElement === inner ? 'stole' : 'missed');
    }, ${delay});
    return id;
  };
`;

/** The grab Cloudflare's widget performs a tick after `render` has already returned. */
const FAKE_SCRIPT_STEALING_FOCUS_ASYNC = stealsFocusAfter(50);

/** The same grab, arriving long after the guard window has closed. */
const FAKE_SCRIPT_STEALING_FOCUS_LATE = stealsFocusAfter(TURNSTILE_FOCUS_GUARD_MS + 1000);

/** Drops focus asynchronously instead of taking it, which lands the document on `body`. */
const FAKE_SCRIPT_BLURRING_FOCUS_ASYNC = `${FAKE_SCRIPT}
  window.turnstileFocusActs = [];
  var renderThenBlur = window.turnstile.render;
  window.turnstile.render = function (el, params) {
    var id = renderThenBlur(el, params);
    setTimeout(function () {
      var held = document.activeElement;
      if (held && held.blur) held.blur();
      window.turnstileFocusActs.push(document.activeElement === document.body ? 'blurred' : 'missed');
    }, 50);
    return id;
  };
`;

type ScriptOutcome = "ok" | "abort" | "hang" | "steals-focus" | "steals-focus-async" | "steals-focus-late" | "blurs-focus-async";

const FAKE_SCRIPT_BODIES: Record<Exclude<ScriptOutcome, "abort" | "hang">, string> = {
  ok: FAKE_SCRIPT,
  "steals-focus": FAKE_SCRIPT_STEALING_FOCUS,
  "steals-focus-async": FAKE_SCRIPT_STEALING_FOCUS_ASYNC,
  "steals-focus-late": FAKE_SCRIPT_STEALING_FOCUS_LATE,
  "blurs-focus-async": FAKE_SCRIPT_BLURRING_FOCUS_ASYNC,
};

/** Serve the fake Cloudflare script, and seed the recorder so assertions never read `undefined`. */
async function serveScript(page: Page, outcome: ScriptOutcome = "ok"): Promise<void> {
  // A URL predicate, not the exact URL: the controller injects `?render=explicit`, and two cases
  // plant a bare-URL script of their own to stand in for one an app already loaded.
  await page.route(
    (url) => url.href.startsWith(TURNSTILE_SCRIPT_SRC),
    async (route) => {
      if (outcome === "abort") return route.abort();
      // "hang": never answer, so neither `load` nor `error` fires and only the timeout can resolve it.
      if (outcome === "hang") return;
      return route.fulfill({ contentType: "application/javascript", body: FAKE_SCRIPT_BODIES[outcome] });
    },
  );
}

/** Reset the recorder before the script has a chance to define it, so every case can read it. */
async function seedRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.turnstileCalls = { renders: [], resets: 0, removes: 0, executes: 0, params: null };
  });
}

async function mountController(page: Page, selector = "#form"): Promise<void> {
  await page.evaluate((root) => {
    window.turnstileCleanup = window.forgeTurnstile.mountTurnstile(document.querySelector(root) as HTMLElement);
  }, selector);
}

/** Real engagement: a bubbling `focusin` from the form's own field, which is what gates the load. */
async function engage(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#field")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
}

const EXPOSE = { expose: { forgeTurnstile: "./ui/client/turnstile" } };

/** The wiring a consuming app actually has: the core registrations plus `resume()`, no mount call. */
const EXPOSE_SCOPE = { expose: { forgeCoreClient: "./ui/core/client", forgeResume: "./ui/client/resume" } };

/** Count of `<script>` tags for Cloudflare's API, however the URL is parameterised. */
function scriptCount(page: Page): Promise<number> {
  return page.evaluate((src) => document.querySelectorAll(`script[src^="${src}"]`).length, TURNSTILE_SCRIPT_SRC);
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

test.describe("mountTurnstile — the eager default", () => {
  test("loads the script and renders the widget with no focus event at all", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup("eager"), EXPOSE);
    await mountController(page);

    await expect
      .poll(() => page.evaluate(() => window.turnstileCalls?.renders ?? []))
      .toEqual([{ sitekey: "site-key", size: "normal", theme: "light" }]);
    expect(await scriptCount(page)).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  });

  test("injects the explicit-render URL, so Cloudflare's own document scan has nothing to find", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup("eager"), EXPOSE);
    await mountController(page);

    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);
    expect(await page.evaluate((src) => document.querySelector<HTMLScriptElement>(`script[src^="${src}"]`)?.src, TURNSTILE_SCRIPT_SRC)).toBe(
      TURNSTILE_SCRIPT_URL,
    );
  });

  test("leaves the widget's own focus grab alone and arms no guard, having taken no focus from the user", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "steals-focus");
    await mount(page, await formMarkup("eager"), EXPOSE);
    await countTimerFirings(page);
    await mountController(page);
    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe("widget-inner");
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 0, fired: 0 });
  });

  test("still protects a focus the user already holds when the widget mounts — an htmx swap's resume", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "steals-focus");
    await mount(page, await formMarkup("eager"), EXPOSE);
    await countTimerFirings(page);
    // Focused first, so the eager load starts with the user's focus already in the form: what a
    // `resume()` after an htmx swap does, and the one case where an eager render has focus to protect.
    await page.locator("#field").focus();
    await mountController(page);
    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe("field");
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 0 });
  });
});

test.describe("mountTurnstile — engagement-gated load under load='focus'", () => {
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

  test("renders with the action the token is minted against", async ({ page }) => {
    await serveScript(page);
    const withAction = await render(
      jsx("form", {
        id: "form",
        children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", load: "focus", action: "contact-form" })],
      }),
    );
    await mount(page, withAction, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.params?.action)).toBe("contact-form");
  });

  test("passes no action at all when the widget names none, leaving the token unscoped", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => "action" in (window.turnstileCalls.params ?? {}))).toBe(false);
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

test.describe("mountTurnstile — the engaged field keeps focus", () => {
  test("restores focus to the field whose own focus triggered the load", async ({ page }) => {
    await serveScript(page, "steals-focus");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);

    // A real focus, not a synthetic `focusin`: the steal only reproduces when the browser is
    // actually holding focus on the field the user clicked into.
    await page.locator("#field").focus();
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe("field");
    await page.locator("#field").pressSequentially("typed@example.com");
    expect(await page.locator("#field").inputValue()).toBe("typed@example.com");
  });
});

test.describe("mountTurnstile — the post-render focus guard", () => {
  const focusState = (page: Page) => page.evaluate(() => ({ acts: window.turnstileFocusActs ?? [], focused: document.activeElement?.id ?? null }));

  const renderCount = (page: Page) => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0);

  test("restores focus when the widget grabs it a tick after render returned", async ({ page }) => {
    await serveScript(page, "steals-focus-async");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);

    await page.locator("#field").focus();

    await expect.poll(() => focusState(page)).toEqual({ acts: ["stole"], focused: "field" });
  });

  test("restores focus when the widget asynchronously drops it onto the body", async ({ page }) => {
    await serveScript(page, "blurs-focus-async");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);

    await page.locator("#field").focus();

    await expect.poll(() => focusState(page)).toEqual({ acts: ["blurred"], focused: "field" });
  });

  test("honours a deliberate move to another field and stays armed", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await twoFieldFormMarkup(), EXPOSE);
    await countTimerFirings(page);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => renderCount(page)).toBe(1);

    await page.locator("#field-b").focus();
    await page.clock.fastForward(10);

    expect(await timersAt(page, 0)).toEqual({ scheduled: 1, fired: 1 });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("field-b");
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 0 });
  });

  test("honours a deliberate move made after the guard window has closed", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await twoFieldFormMarkup(), EXPOSE);
    await countTimerFirings(page);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => renderCount(page)).toBe(1);

    await page.clock.fastForward(TURNSTILE_FOCUS_GUARD_MS + 1000);
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 1 });

    await page.locator("#field-b").focus();
    await page.clock.fastForward(10);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe("field-b");
  });

  test("restores to the field the user moved to, not the one that triggered the load", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "steals-focus-async");
    await mount(page, await twoFieldFormMarkup(), EXPOSE);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => renderCount(page)).toBe(1);

    await page.locator("#field-b").focus();
    await page.clock.fastForward(10);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("field-b");

    await page.clock.fastForward(100);
    await page.clock.fastForward(10);

    await expect.poll(() => focusState(page)).toEqual({ acts: ["stole"], focused: "field-b" });
  });

  test("leaves a grab arriving after the guard window with the widget", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "steals-focus-late");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => renderCount(page)).toBe(1);

    await page.clock.fastForward(TURNSTILE_FOCUS_GUARD_MS + 1100);
    await page.clock.fastForward(10);

    await expect.poll(() => focusState(page)).toEqual({ acts: ["stole"], focused: "widget-inner" });
  });

  test("cleanup disarms the guard before its window elapses", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    // Instrumented here and not a line earlier: see `countTimerFirings`.
    await countTimerFirings(page);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => renderCount(page)).toBe(1);
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 0 });

    await page.evaluate(() => window.turnstileCleanup?.());
    await page.clock.fastForward(TURNSTILE_FOCUS_GUARD_MS + 1000);

    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 0 });
  });

  test("honours a click into the widget once the guard has spent its one restore", async ({ page }) => {
    await serveScript(page, "steals-focus-async");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await page.locator("#field").focus();
    await expect.poll(() => focusState(page)).toEqual({ acts: ["stole"], focused: "field" });

    await page.locator("#widget-inner").focus();

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("widget-inner");
  });
});

test.describe("mountTurnstile — the reset is scoped to the form's own submission", () => {
  /** The `htmx:afterRequest` htmx fires once a request completes: the answered URL rides on the
   * `xhr`, and the event bubbles from whichever element issued it. */
  const afterRequest = (page: Page, options: { path: string | null; successful?: boolean; from?: string }) =>
    page.evaluate(({ path, successful, from }) => {
      const field = document.querySelector<HTMLInputElement>("#field");
      if (field) field.value = "typed@example.com";
      // `responseURL` is absolute in a real xhr, and "" for a request that never got an answer.
      const xhr = { responseURL: path === null ? "" : new URL(path, location.href).href };
      document.querySelector(from ?? "#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful, xhr }, bubbles: true }));
      return { resets: window.turnstileCalls.resets, value: field?.value };
    }, options);

  test("resets and clears the form when the answered URL is the form's own hx-post", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await afterRequest(page, { path: "/contact", successful: true })).toEqual({ resets: 1, value: "" });
  });

  test("leaves the token and the fields alone for a request the form merely triggered", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // A field-triggered reshape, bubbling to the form exactly as the submission does: burning the
    // single-use token here is what made every reshape cost the reader a fresh challenge.
    expect(await afterRequest(page, { path: "/contact/reshape", successful: true, from: "#field" })).toEqual({
      resets: 0,
      value: "typed@example.com",
    });
  });

  test("leaves the token alone when the request was never answered", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // No response means the token was never spent, so the widget still holds a usable one.
    expect(await afterRequest(page, { path: null, successful: false })).toEqual({ resets: 0, value: "typed@example.com" });
  });
});

test.describe("mountTurnstile — token lifecycle", () => {
  // This form declares no `hx-post`, so its submission has no URL to test and every completed
  // request reaching it is treated as its own — which is what a form submitting through a
  // descendant's `hx-post` needs.
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

  // Scoped to the default mode: `challenge="submit"` holds the press for a bounded window by design,
  // and its own suite below asserts that the window always ends with the button pressable again.
  test("under the default challenge='render' the submit affordance is never gated on the challenge", async ({ page }) => {
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

test.describe("mountTurnstile — the challenge runs at submit under challenge='submit'", () => {
  const rendered = (page: Page) => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0);

  test("renders in execute mode and runs no challenge until the press", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ appearance: "interaction-only" }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await page.evaluate(() => window.turnstileCalls.params?.execution)).toBe("execute");
    expect(await page.evaluate(() => window.turnstileCalls.params?.appearance)).toBe("interaction-only");
    expect(await page.evaluate(() => window.turnstileCalls.executes)).toBe(0);
    expect(await page.evaluate(() => document.querySelector("[name='cf-turnstile-response']"))).toBe(null);
  });

  test("wires no expiry or timeout reset, having no challenge to expire before the press", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await page.evaluate(() => Object.keys(window.turnstileCalls.params ?? {}).filter((key) => key.endsWith("-callback")))).toEqual([
      "error-callback",
    ]);
  });

  test("holds the press, runs one challenge, and issues the request once the token exists", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });
    // The window itself: no request yet, no token yet, and a button that says it is working.
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: true, busy: "true", token: null });

    await completeChallenge(page);

    // `true` is the `skipConfirmation` that keeps htmx from running its own `window.confirm`.
    expect(await submitState(page)).toEqual({ issued: [true], executes: 1, disabled: false, busy: null, token: "token-1" });
  });

  test("swallows a second press while the challenge is in flight, so one press is one request", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    await pressSubmit(page);
    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });
    await completeChallenge(page);

    expect(await submitState(page)).toEqual({ issued: [true], executes: 1, disabled: false, busy: null, token: "token-1" });
  });

  test("a failed challenge reveals the fallback, issues nothing, and leaves the button pressable", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await page.evaluate(() => ((window.turnstileCalls.params ?? {})["error-callback"] as () => void)());

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    // Reset, so the retry the pressable button invites starts from an unstarted widget.
    expect(await page.evaluate(() => window.turnstileCalls.resets)).toBe(1);
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });

    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 2 });
  });

  test("releases the press as a failure when the challenge never answers within the budget", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
  });

  test("spends no challenge on a form htmx would halt as invalid", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ required: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await pressSubmit(page)).toEqual({ prevented: false, executes: 0 });

    await page.locator("#field").fill("typed@example.com");
    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });
  });

  test("lets a press through unheld when the script never loaded, leaving the refusal to the server", async ({ page }) => {
    await serveScript(page, "abort");
    await mount(page, await submitModeMarkup(), EXPOSE);
    await seedRecorder(page);
    await mountController(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(await pressSubmit(page)).toEqual({ prevented: false, executes: 0 });
    await expect(page.locator("#submit")).toBeEnabled();
  });

  test("resets after the form's own submission, so the next press executes a fresh challenge", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    await pressSubmit(page);
    await completeChallenge(page);
    await page.evaluate(() => {
      const xhr = { responseURL: new URL("/contact", location.href).href };
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true, xhr }, bubbles: true }));
    });
    expect(await page.evaluate(() => window.turnstileCalls.resets)).toBe(1);

    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 2 });
  });

  test("cleanup while a press is held drops it rather than issuing from a detached form", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await page.evaluate(() => window.turnstileCleanup?.());
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS);

    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
  });

  test("refuses the mode on a native form, reporting it and rendering the challenge instead", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page);
    await mount(page, await submitModeMarkup({ htmx: false }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(warnings.filter((warning) => /\[turnstile\]/.test(warning))).toEqual([
      '[turnstile] challenge="submit" needs an htmx submission on the form; falling back to challenge="render"',
    ]);
    expect(await page.evaluate(() => "execution" in (window.turnstileCalls.params ?? {}))).toBe(false);
    expect(await pressSubmit(page)).toEqual({ prevented: false, executes: 0 });
  });

  test("under the default challenge='render' a confirm is neither held nor executed", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await pressSubmit(page)).toEqual({ prevented: false, executes: 0 });
    expect(await page.evaluate(() => "execution" in (window.turnstileCalls.params ?? {}))).toBe(false);
  });
});

test.describe("the turnstile scope — the capability arrives with the component", () => {
  /** Exactly what a consuming app's client entry does: side-effect import, then `resume()`. */
  const resumeOnly = (page: Page) => page.evaluate(() => window.forgeResume.resume());

  test("mounts with no mount call at all, from the widget's own data-scope", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE_SCOPE);

    await resumeOnly(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.renders[0])).toEqual({ sitekey: "site-key", size: "normal", theme: "light" });
  });

  test("a page that renders no widget resumes nothing, loads nothing and reports nothing", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page);
    // A page of the 598 that have no CAPTCHA: no widget markup, so no scope, so no controller.
    await mount(page, await render(jsx("form", { id: "form", children: jsx("input", { id: "field" }) })), EXPOSE_SCOPE);

    await resumeOnly(page);
    await engage(page);

    expect(warnings.filter((warning) => /\[turnstile\]/.test(warning))).toEqual([]);
    expect(await scriptCount(page)).toBe(0);
  });

  test("resume teardown disposes the widget the scope mounted", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE_SCOPE);

    await page.evaluate(() => {
      window.turnstileCleanup = window.forgeResume.resume();
    });
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const after = await page.evaluate(() => {
      window.turnstileCleanup?.();
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true } }));
      return { removes: window.turnstileCalls.removes, resets: window.turnstileCalls.resets };
    });

    expect(after).toEqual({ removes: 1, resets: 0 });
  });
});

test.describe("mountTurnstile — scoped to the node it is given", () => {
  /** A bubbling `focusin` from the named field, which is what gates that form's load. */
  const engageField = (page: Page, id: string) =>
    page.evaluate((field) => document.querySelector(`#${field}`)?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })), id);

  test("mounts only the widget inside the form it was passed", async ({ page }) => {
    await serveScript(page);
    await mount(page, await twoFormsMarkup(), EXPOSE);
    await page.evaluate(() => {
      window.turnstileCleanup = window.forgeTurnstile.mountTurnstile(document.querySelector("#form") as HTMLElement);
    });

    await engageField(page, "field");
    await engageField(page, "field-b");
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.renders)).toEqual([{ sitekey: "key-a", size: "normal", theme: "light" }]);
  });

  test("disposing one form's controller leaves the other form's widget mounted", async ({ page }) => {
    await serveScript(page);
    await mount(page, await twoFormsMarkup(), EXPOSE);
    await page.evaluate(() => {
      window.turnstileCleanup = window.forgeTurnstile.mountTurnstile(document.querySelector("#form") as HTMLElement);
      window.forgeTurnstile.mountTurnstile(document.querySelector("#form-b") as HTMLElement);
    });

    await engageField(page, "field");
    await engageField(page, "field-b");
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 2);
    expect(await page.evaluate(() => window.turnstileCalls.renders.map((entry) => entry.sitekey))).toEqual(["key-a", "key-b"]);

    const after = await page.evaluate(() => {
      window.turnstileCleanup?.();
      document.querySelector("#form")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true } }));
      document.querySelector("#form-b")?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true } }));
      return { removes: window.turnstileCalls.removes, resets: window.turnstileCalls.resets };
    });

    // One removal and one reset: A's controller is gone, and only B's still answers a submission.
    expect(after).toEqual({ removes: 1, resets: 1 });
  });
});

test.describe("mountTurnstile — lifecycle", () => {
  test("is idempotent for the same widget", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);

    const same = await page.evaluate(() => {
      const form = document.querySelector("#form") as HTMLElement;
      const first = window.forgeTurnstile.mountTurnstile(form);
      const second = window.forgeTurnstile.mountTurnstile(form);
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
        execute: () => {},
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
        window.forgeTurnstile.mountTurnstile(document.querySelector("#form") as HTMLElement)();
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

    // The scope root *is* the widget, so this also covers the self-match the scope wiring relies on.
    const threw = await page.evaluate(() => {
      try {
        window.forgeTurnstile.mountTurnstile(document.querySelector("[data-ref='turnstile']") as HTMLElement)();
        return false;
      } catch {
        return true;
      }
    });

    expect(threw).toBe(false);
    expect(await scriptCount(page)).toBe(0);
  });
});
