import { expect, type Page, test } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import {
  TURNSTILE_ABANDONED_EVENT,
  TURNSTILE_ACTION_PATTERN,
  TURNSTILE_CDATA_PATTERN,
  TURNSTILE_EXECUTE_TIMEOUT_MS,
  TURNSTILE_INTERACTIVE_TIMEOUT_MS,
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
    /** Which press each released request answered, and the `skipConfirmation` it carried. */
    turnstileIssued: Array<{ from: string; skip: boolean }>;
    /** Every `turnstile:abandoned` the form dispatched, by reason and by the control pressed. */
    turnstileAbandoned: Array<{ reason: string; submitter: string | null }>;
    /** Cleanup returned by the controller, parked so a later evaluate can call it. */
    turnstileCleanup?: () => void;
    /** Delays of every `setTimeout` the page scheduled, and of every one that actually fired. */
    forgeTimers: { scheduled: number[]; fired: number[] };
    /** Reads of `window.turnstile` since the counter was last zeroed. */
    forgeTurnstileReads: { count: number };
    /** What each focus-meddling fake did when its moment came, in the order it happened. */
    turnstileFocusActs: string[];
    /** Fires the on-cue fake's focus grab, so the steal can be placed after a deliberate focus. */
    turnstileSteal?: () => void;
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

/** A form declaring no htmx verb of its own: the submit button carries the submission, and the select
 * carries a reshape request that must never be taken for one. */
function controlSubmissionMarkup(): Promise<string> {
  return render(
    jsx("form", {
      id: "form",
      children: [
        jsx("input", { id: "field", name: "email" }),
        jsx("select", { id: "reshape", name: "topic", "hx-post": "/reshape" }),
        Turnstile({ siteKey: "site-key", size: "normal", load: "focus" }),
        jsx("button", { id: "submit", type: "submit", "hx-post": "/contact", children: "Send" }),
      ],
    }),
  );
}

/** An htmx form whose challenge is deferred to the press, with the submit button the seam marks busy.
 * The options are the shapes htmx's own validation gate turns on: where the verb is declared, whether
 * the form or the press waives constraint validation, and whether a second submit control exists. */
function submitModeMarkup(
  options: {
    appearance?: "execute" | "interaction-only";
    required?: boolean;
    htmx?: boolean;
    novalidate?: boolean;
    onButton?: boolean;
    validateAttr?: boolean;
    formNoValidate?: boolean;
    second?: boolean;
  } = {},
): Promise<string> {
  const { appearance, required = false, htmx = true, novalidate = false, onButton = false } = options;
  const { validateAttr = false, formNoValidate = false, second = false } = options;
  const verb = htmx ? { "hx-post": "/contact" } : { action: "/contact", method: "post" };
  return render(
    jsx("form", {
      id: "form",
      ...(onButton ? {} : verb),
      ...(novalidate ? { novalidate: true } : {}),
      children: [
        jsx("input", { id: "field", name: "email", required }),
        Turnstile({ siteKey: "site-key", size: "normal", challenge: "submit", ...(appearance ? { appearance } : {}) }),
        ...(second ? [jsx("button", { id: "preview", type: "submit", formaction: "/preview", children: "Preview" })] : []),
        jsx("button", {
          id: "submit",
          type: "submit",
          ...(onButton ? { "hx-post": "/contact" } : {}),
          ...(validateAttr ? { "hx-validate": "true" } : {}),
          ...(formNoValidate ? { formnovalidate: true } : {}),
          children: "Send",
        }),
      ],
    }),
  );
}

/** The `htmx:confirm` htmx fires before it issues a request, carrying the closure that releases it.
 * `elt` is the element htmx names as issuing the request, `submitter` the control that was pressed,
 * and `on` the node the event is dispatched from — which is `elt` unless a case needs otherwise. */
const pressSubmit = (page: Page, options: { on?: string; elt?: string; submitter?: string } = {}) =>
  page.evaluate((opts) => {
    window.turnstileIssued = window.turnstileIssued ?? [];
    const elt = document.querySelector(opts.elt ?? "#form");
    const submitter = document.querySelector(opts.submitter ?? "#submit");
    const from = submitter?.id ?? "";
    const event = new CustomEvent("htmx:confirm", {
      bubbles: true,
      cancelable: true,
      detail: {
        elt,
        triggeringEvent: { submitter },
        issueRequest: (skipConfirmation: boolean) => window.turnstileIssued.push({ from, skip: skipConfirmation }),
      },
    });
    document.querySelector(opts.on ?? opts.elt ?? "#form")?.dispatchEvent(event);
    return { prevented: event.defaultPrevented, executes: window.turnstileCalls.executes };
  }, options);

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

/** The callbacks the controller wired, sorted, so the assertion does not depend on key order. */
const callbackKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.turnstileCalls.params ?? {})
      .filter((key) => key.endsWith("-callback"))
      .sort(),
  );

/** Fires one of the render params Cloudflare would have called, with the arguments it would pass. */
const fireCallback = (page: Page, name: string, code?: number) =>
  page.evaluate(({ key, arg }) => ((window.turnstileCalls.params ?? {})[key] as (value?: number) => unknown)(arg), { key: name, arg: code });

/** Two independent forms, each with its own `<Turnstile>` — what a page with two widgets renders. */
function twoFormsMarkup(): Promise<string> {
  const form = (id: string, field: string, siteKey: string, size: "compact" | "normal") =>
    jsx("form", { id, "hx-post": "/contact", children: [jsx("input", { id: field, name: "email" }), Turnstile({ siteKey, size, load: "focus" })] });
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

/** Grabs focus into the widget only when the test asks, so the steal can be placed after a focus the
 * reader took in the beat between `render` returning and Cloudflare's own asynchronous grab. */
const FAKE_SCRIPT_STEALING_FOCUS_ON_CUE = `${FAKE_SCRIPT}
  window.turnstileFocusActs = [];
  var renderThenWait = window.turnstile.render;
  window.turnstile.render = function (el, params) {
    var id = renderThenWait(el, params);
    var inner = document.createElement('input');
    inner.id = 'widget-inner';
    el.appendChild(inner);
    window.turnstileSteal = function () {
      inner.focus();
      window.turnstileFocusActs.push(document.activeElement === inner ? 'stole' : 'missed');
    };
    return id;
  };
`;

/** A `render` that throws, and a `remove` that throws — the two Cloudflare calls forge wraps. */
const FAKE_SCRIPT_THROWING_ON_RENDER = `${FAKE_SCRIPT}
  window.turnstile.render = function () { throw new Error('render failed'); };
`;

const FAKE_SCRIPT_THROWING_ON_REMOVE = `${FAKE_SCRIPT}
  window.turnstile.remove = function () { throw new Error('remove failed'); };
`;

type ScriptOutcome =
  | "ok"
  | "abort"
  | "hang"
  | "throws-on-render"
  | "throws-on-remove"
  | "steals-focus"
  | "steals-focus-async"
  | "steals-focus-late"
  | "steals-focus-on-cue"
  | "blurs-focus-async";

const FAKE_SCRIPT_BODIES: Record<Exclude<ScriptOutcome, "abort" | "hang">, string> = {
  ok: FAKE_SCRIPT,
  "throws-on-render": FAKE_SCRIPT_THROWING_ON_RENDER,
  "throws-on-remove": FAKE_SCRIPT_THROWING_ON_REMOVE,
  "steals-focus": FAKE_SCRIPT_STEALING_FOCUS,
  "steals-focus-async": FAKE_SCRIPT_STEALING_FOCUS_ASYNC,
  "steals-focus-on-cue": FAKE_SCRIPT_STEALING_FOCUS_ON_CUE,
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
  await page.evaluate(
    ({ root, event }) => {
      // Listened for on the document, which is where a consuming app's own handler would sit: the
      // event is dispatched on the form and bubbles.
      window.turnstileAbandoned = [];
      document.addEventListener(event, (fired) => {
        const detail = (fired as CustomEvent<{ reason: string; submitter: HTMLElement | null }>).detail;
        window.turnstileAbandoned.push({ reason: detail.reason, submitter: detail.submitter?.id ?? null });
      });
      window.turnstileCleanup = window.forgeTurnstile.mountTurnstile(document.querySelector(root) as HTMLElement);
    },
    { root: selector, event: TURNSTILE_ABANDONED_EVENT },
  );
}

/** Every dropped press the page was told about, in order. */
const abandonments = (page: Page) => page.evaluate(() => window.turnstileAbandoned ?? []);

/** What one control says about itself while a press is held. */
const buttonState = (page: Page, selector: string) =>
  page.evaluate((one) => {
    const button = document.querySelector<HTMLButtonElement>(one);
    return { disabled: button?.disabled ?? null, busy: button?.getAttribute("aria-busy") };
  }, selector);

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

  test("carries the page's CSP nonce onto the script it injects, read off the property the browser leaves", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup("eager"), EXPOSE);
    // What a nonced page actually looks like to script: the attribute emptied, the property intact.
    await page.evaluate(() => {
      const nonced = document.createElement("script");
      nonced.setAttribute("nonce", "");
      nonced.nonce = "n0nce-from-the-app";
      document.head.appendChild(nonced);
    });
    await mountController(page);

    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);
    expect(await page.evaluate((src) => document.querySelector<HTMLScriptElement>(`script[src^="${src}"]`)?.nonce, TURNSTILE_SCRIPT_SRC)).toBe(
      "n0nce-from-the-app",
    );
  });

  test("injects a bare script on a page with no nonce to copy", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup("eager"), EXPOSE);
    await mountController(page);

    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);
    expect(await page.evaluate((src) => document.querySelector(`script[src^="${src}"]`)?.hasAttribute("nonce"), TURNSTILE_SCRIPT_SRC)).toBe(false);
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

  test("leaves the widget's own focus grab alone, having taken no focus from the user, and still arms the guard", async ({ page }) => {
    await page.clock.install();
    await serveScript(page, "steals-focus");
    await mount(page, await formMarkup("eager"), EXPOSE);
    await countTimerFirings(page);
    await mountController(page);
    await expect.poll(() => page.evaluate(() => window.turnstileCalls?.renders.length ?? 0)).toBe(1);

    expect(await page.evaluate(() => document.activeElement?.id)).toBe("widget-inner");
    expect(await timersAt(page, TURNSTILE_FOCUS_GUARD_MS)).toEqual({ scheduled: 1, fired: 0 });
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

  test("reports an action outside Cloudflare's charset and forwards it regardless", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page);
    const badAction = await render(
      jsx("form", {
        id: "form",
        children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", load: "focus", action: "contact form!" })],
      }),
    );
    await mount(page, badAction, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // Forwarded, not dropped: `verifyTurnstile` stays the single point that decides an action.
    expect(await page.evaluate(() => window.turnstileCalls.params?.action)).toBe("contact form!");
    expect(warnings).toEqual([
      `[turnstile] action "contact form!" is outside Cloudflare's ${TURNSTILE_ACTION_PATTERN.source}; it is forwarded anyway and may be refused`,
    ]);
  });

  test("passes no action at all when the widget names none, leaving the token unscoped", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => "action" in (window.turnstileCalls.params ?? {}))).toBe(false);
  });

  test("renders with the customer data the token is minted with, under Cloudflare's camelCase spelling", async ({ page }) => {
    await serveScript(page);
    const withCData = await render(
      jsx("form", {
        id: "form",
        children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", load: "focus", cData: "order-4821" })],
      }),
    );
    await mount(page, withCData, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.params?.cData)).toBe("order-4821");
  });

  test("reports a cData outside Cloudflare's charset and forwards it regardless", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page);
    const badCData = await render(
      jsx("form", {
        id: "form",
        children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", load: "focus", cData: "order 4821!" })],
      }),
    );
    await mount(page, badCData, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // Forwarded, not dropped: `verifyTurnstile`'s `expectedCData` stays the single point that decides it.
    expect(await page.evaluate(() => window.turnstileCalls.params?.cData)).toBe("order 4821!");
    expect(warnings).toEqual([
      `[turnstile] cData "order 4821!" is outside Cloudflare's ${TURNSTILE_CDATA_PATTERN.source}; it is forwarded anyway and may be refused`,
    ]);
  });

  test("passes no cData at all when the widget names none", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => "cData" in (window.turnstileCalls.params ?? {}))).toBe(false);
  });

  test("renders with the response field name under Cloudflare's hyphenated spelling", async ({ page }) => {
    await serveScript(page);
    const named = await render(
      jsx("form", {
        id: "form",
        children: [
          jsx("input", { id: "field", name: "email" }),
          Turnstile({ siteKey: "site-key", load: "focus", responseFieldName: "cf-turnstile-signup" }),
        ],
      }),
    );
    await mount(page, named, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => window.turnstileCalls.params?.["response-field-name"])).toBe("cf-turnstile-signup");
  });

  test("passes no response field name at all when the widget names none, leaving Cloudflare's default", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => "response-field-name" in (window.turnstileCalls.params ?? {}))).toBe(false);
  });

  test("renders with the pinned language and the iframe tabindex the widget declared", async ({ page }) => {
    await serveScript(page);
    const localised = await render(
      jsx("form", {
        id: "form",
        children: [jsx("input", { id: "field", name: "email" }), Turnstile({ siteKey: "site-key", load: "focus", language: "en-US", tabindex: 3 })],
      }),
    );
    await mount(page, localised, EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // A number, not the attribute's string: Cloudflare reads `tabindex` as the iframe's own.
    expect(
      await page.evaluate(() => ({ language: window.turnstileCalls.params?.language, tabindex: window.turnstileCalls.params?.tabindex })),
    ).toEqual({ language: "en-US", tabindex: 3 });
  });

  test("passes neither language nor tabindex when the widget declares neither", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await page.evaluate(() => ["language", "tabindex"].filter((key) => key in (window.turnstileCalls.params ?? {})))).toEqual([]);
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

  test("re-renders in the new theme when the class flips before any token exists", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await page.evaluate(() => document.documentElement.classList.add("dark"));

    await expect.poll(() => page.evaluate(() => window.turnstileCalls.renders.map((each) => each.theme))).toEqual(["light", "dark"]);
    // The old widget goes first, or the container would carry two.
    expect(await page.evaluate(() => window.turnstileCalls.removes)).toBe(1);
  });

  test("keeps a solved token rather than spending a second challenge on a colour", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);
    await completeChallenge(page);

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    // One observer tick and one settle beat: enough for a re-render to have happened if it were going to.
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => ({ renders: window.turnstileCalls.renders.length, removes: window.turnstileCalls.removes }))).toEqual({
      renders: 1,
      removes: 0,
    });
  });

  test("ignores a class mutation that leaves the theme where it was", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await page.evaluate(() => document.documentElement.classList.add("has-sidebar"));
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => window.turnstileCalls.renders.length)).toBe(1);
  });

  test("stops watching the theme once the controller is disposed", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await page.evaluate(() => window.turnstileCleanup?.());
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => window.turnstileCalls.renders.length)).toBe(1);
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

  test("guards an eager render that landed with the body focused", async ({ page }) => {
    await serveScript(page, "steals-focus-on-cue");
    await mount(page, await formMarkup("eager"), EXPOSE);
    await mountController(page);
    await expect.poll(() => renderCount(page)).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");

    // The reader reaches the first field in the beat between `render` returning and the steal.
    await page.locator("#field").focus();
    await page.evaluate(() => window.turnstileSteal?.());

    await expect.poll(() => focusState(page)).toEqual({ acts: ["stole"], focused: "field" });
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
  /** The `htmx:afterRequest` htmx fires once a request completes, naming the issuing element on
   * `requestConfig` and bubbling from that element. */
  const afterRequest = (page: Page, options: { successful?: boolean; from?: string }) =>
    page.evaluate(({ successful, from }) => {
      const field = document.querySelector<HTMLInputElement>("#field");
      if (field) field.value = "typed@example.com";
      const elt = document.querySelector(from ?? "#form");
      elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful, requestConfig: { elt } }, bubbles: true }));
      return { resets: window.turnstileCalls.resets, value: field?.value };
    }, options);

  test("resets and clears the form when the form itself issued the request", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await afterRequest(page, { successful: true })).toEqual({ resets: 1, value: "" });
  });

  test("leaves the token and the fields alone for a request the form merely triggered", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // A field-triggered reshape, bubbling to the form exactly as the submission does: burning the
    // single-use token here is what made every reshape cost the reader a fresh challenge.
    expect(await afterRequest(page, { successful: true, from: "#field" })).toEqual({ resets: 0, value: "typed@example.com" });
  });

  test("takes a submit control's request as the form's own when the form declares no verb", async ({ page }) => {
    await serveScript(page);
    await mount(page, await controlSubmissionMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await afterRequest(page, { successful: true, from: "#submit" })).toEqual({ resets: 1, value: "" });
  });

  test("leaves a non-submit control's own request alone when the form declares no verb", async ({ page }) => {
    await serveScript(page);
    await mount(page, await controlSubmissionMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await afterRequest(page, { successful: true, from: "#reshape" })).toEqual({ resets: 0, value: "typed@example.com" });
  });
});

test.describe("mountTurnstile — token lifecycle", () => {
  test("resets the token after every submission, clearing the form only on success", async ({ page }) => {
    await serveScript(page);
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const submissionCompleted = (successful: boolean) =>
      page.evaluate((ok) => {
        const field = document.querySelector<HTMLInputElement>("#field");
        if (field) field.value = "typed@example.com";
        const elt = document.querySelector("#form");
        elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: ok, requestConfig: { elt } }, bubbles: true }));
        return { resets: window.turnstileCalls.resets, value: field?.value };
      }, successful);

    expect(await submissionCompleted(true)).toEqual({ resets: 1, value: "" });
    expect(await submissionCompleted(false)).toEqual({ resets: 2, value: "typed@example.com" });
  });

  test("wires no expiry or timeout reset, leaving both refreshes to Cloudflare's own defaults", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    expect(await callbackKeys(page)).toEqual([
      "after-interactive-callback",
      "before-interactive-callback",
      "error-callback",
      "unsupported-callback",
    ]);
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

  test("reveals the fallback when Turnstile's error-callback fires, reporting the code and claiming the error", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
    // Non-falsy, which is what stops Cloudflare logging a second warning of its own.
    expect(await fireCallback(page, "error-callback", 300010)).toBe(true);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(warnings).toEqual(["[turnstile] challenge error 300010"]);
  });

  test("takes the fallback back down when a retried challenge succeeds", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // Twice, because `retry: auto` invokes the callback once per retry for one underlying fault.
    await fireCallback(page, "error-callback", 300010);
    await fireCallback(page, "error-callback", 300010);
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(await page.locator("[data-ref='turnstile-fallback']").count()).toBe(1);

    await completeChallenge(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
  });

  test("names browser support, not blockers, when Turnstile cannot run at all", async ({ page }) => {
    await serveScript(page);
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    await fireCallback(page, "unsupported-callback");

    await expect(page.locator("[data-ref='turnstile-unsupported']")).toBeVisible();
    await expect(page.locator("[data-ref='turnstile-unsupported']")).toHaveText(
      "This browser cannot run the security challenge. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
    );
    // The blocker advice stays down: nothing the visitor disables would help.
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
  });

  test("reports a render that throws instead of swallowing it, and shows the fallback", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await serveScript(page, "throws-on-render");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(warnings.map((text) => text.split(";")[0])).toEqual(["[turnstile] turnstile.render() threw"]);
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
    expect(await submitState(page)).toEqual({
      issued: [{ from: "submit", skip: true }],
      executes: 1,
      disabled: false,
      busy: null,
      token: "token-1",
    });
  });

  test("spends no second challenge on a re-press of the same button, reporting the press it displaced", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    await pressSubmit(page);
    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });
    // Re-armed on the second press, and the first is reported lost rather than silently dropped.
    expect(await abandonments(page)).toEqual([{ reason: "superseded", submitter: "submit" }]);

    await completeChallenge(page);

    expect(await submitState(page)).toEqual({
      issued: [{ from: "submit", skip: true }],
      executes: 1,
      disabled: false,
      busy: null,
      token: "token-1",
    });
  });

  test("answers the press that displaced the first, never the earlier control's request", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ second: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    await pressSubmit(page);
    // htmx reads the form's `lastButtonClicked` back when it issues, so the earlier press's request
    // would go out under the later button's name.
    expect(await pressSubmit(page, { submitter: "#preview" })).toEqual({ prevented: true, executes: 1 });

    expect(await abandonments(page)).toEqual([{ reason: "superseded", submitter: "submit" }]);
    expect(await buttonState(page, "#submit")).toEqual({ disabled: false, busy: null });
    expect(await buttonState(page, "#preview")).toEqual({ disabled: true, busy: "true" });

    await completeChallenge(page);

    expect(await page.evaluate(() => window.turnstileIssued)).toEqual([{ from: "preview", skip: true }]);
  });

  test("a failed challenge reveals the fallback, issues nothing, and leaves the button pressable", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "error-callback", 300010);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    // No reset of its own: `retry` defaults to `auto`, so Cloudflare is already retrying, and a
    // second `reset()` would spend a further challenge on top of the one it re-presented.
    expect(await page.evaluate(() => window.turnstileCalls.resets)).toBe(0);
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
    expect(await abandonments(page)).toEqual([{ reason: "error", submitter: "submit" }]);
  });

  test("reports the press a browser Turnstile cannot run at all drops", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "unsupported-callback");

    await expect(page.locator("[data-ref='turnstile-unsupported']")).toBeVisible();
    expect(await abandonments(page)).toEqual([{ reason: "unsupported", submitter: "submit" }]);
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
  });

  test("lets a press through unheld once the widget has errored, rather than holding it for the full budget", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    await fireCallback(page, "error-callback", 300010);

    // Unheld: htmx issues the request itself and `verifyTurnstile` refuses the token-less POST,
    // rather than the press sitting disabled for the whole execute budget on a widget that is dead.
    expect(await pressSubmit(page)).toEqual({ prevented: false, executes: 0 });
    expect(await submitState(page)).toEqual({ issued: [], executes: 0, disabled: false, busy: null, token: null });
  });

  test("stands down the execute budget and the busy state while an interactive challenge is up", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "before-interactive-callback");
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });

    // Well past the budget that would have discarded the submission out from under the visitor.
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS * 2);
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });

    await fireCallback(page, "after-interactive-callback");
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: true, busy: "true", token: null });

    await completeChallenge(page);
    expect(await submitState(page)).toEqual({
      issued: [{ from: "submit", skip: true }],
      executes: 1,
      disabled: false,
      busy: null,
      token: "token-1",
    });
  });

  test("ends an interactive challenge the visitor abandoned, at the human-scale ceiling", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup({ appearance: "interaction-only" }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "before-interactive-callback");
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS * 2);
    expect(await abandonments(page)).toEqual([]);
    await expect(page.locator("#submit")).toBeEnabled();

    await page.clock.fastForward(TURNSTILE_INTERACTIVE_TIMEOUT_MS);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(await abandonments(page)).toEqual([{ reason: "interactive-timeout", submitter: "submit" }]);
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
  });

  test("keeps the human-scale ceiling for a press made while the interactive challenge is still up", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup({ appearance: "interaction-only" }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "before-interactive-callback");
    // The second press re-arms the hold, and must not re-arm it on the 15s budget the visitor is
    // in the middle of being asked to beat.
    await pressSubmit(page);
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS * 2);

    expect(await abandonments(page)).toEqual([{ reason: "superseded", submitter: "submit" }]);
    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeHidden();

    await fireCallback(page, "after-interactive-callback");
    await completeChallenge(page);

    expect(await submitState(page)).toEqual({
      issued: [{ from: "submit", skip: true }],
      executes: 1,
      disabled: false,
      busy: null,
      token: "token-1",
    });
  });

  test("re-arms the budget after an interactive challenge, so an abandoned one still ends", async ({ page }) => {
    await page.clock.install();
    await serveScript(page);
    await mount(page, await submitModeMarkup(), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);
    await pressSubmit(page);

    await fireCallback(page, "before-interactive-callback");
    await fireCallback(page, "after-interactive-callback");
    await page.clock.fastForward(TURNSTILE_EXECUTE_TIMEOUT_MS);

    await expect(page.locator("[data-ref='turnstile-fallback']")).toBeVisible();
    expect(await submitState(page)).toEqual({ issued: [], executes: 1, disabled: false, busy: null, token: null });
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
    expect(await abandonments(page)).toEqual([{ reason: "timeout", submitter: "submit" }]);
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

  test("holds an invalid press on a novalidate form, where htmx sends the request either way", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ required: true, novalidate: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    // The author declared constraint validation is not the gate, so the press spends a challenge
    // rather than letting the request leave with an empty token.
    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });

    await completeChallenge(page);

    expect(await submitState(page)).toEqual({
      issued: [{ from: "submit", skip: true }],
      executes: 1,
      disabled: false,
      busy: null,
      token: "token-1",
    });
  });

  test("holds an invalid press issued by the button, which htmx does not validate", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ required: true, onButton: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await pressSubmit(page, { elt: "#submit" })).toEqual({ prevented: true, executes: 1 });
  });

  test("holds an invalid press the control waived validation for with formnovalidate", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ required: true, formNoValidate: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await pressSubmit(page)).toEqual({ prevented: true, executes: 1 });
  });

  test("spends no challenge on a button-issued press that asks htmx to validate", async ({ page }) => {
    await serveScript(page);
    await mount(page, await submitModeMarkup({ required: true, onButton: true, validateAttr: true }), EXPOSE);
    await mountController(page);
    await expect.poll(() => rendered(page)).toBe(1);

    expect(await pressSubmit(page, { elt: "#submit" })).toEqual({ prevented: false, executes: 0 });

    await page.locator("#field").fill("typed@example.com");
    expect(await pressSubmit(page, { elt: "#submit" })).toEqual({ prevented: true, executes: 1 });
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
      const elt = document.querySelector("#form");
      elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true, requestConfig: { elt } }, bubbles: true }));
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
    // Silently: teardown runs mid-swap, and the listener the event would reach is on a page that is
    // already going away.
    expect(await abandonments(page)).toEqual([]);
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
    await mount(page, await htmxFormMarkup(), EXPOSE_SCOPE);

    await page.evaluate(() => {
      window.turnstileCleanup = window.forgeResume.resume();
    });
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const after = await page.evaluate(() => {
      window.turnstileCleanup?.();
      const elt = document.querySelector("#form");
      elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true, requestConfig: { elt } }, bubbles: true }));
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
      for (const selector of ["#form", "#form-b"]) {
        const elt = document.querySelector(selector);
        elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true, requestConfig: { elt } }, bubbles: true }));
      }
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
    await mount(page, await htmxFormMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    const after = await page.evaluate(() => {
      window.turnstileCleanup?.();
      const elt = document.querySelector("#form");
      elt?.dispatchEvent(new CustomEvent("htmx:afterRequest", { detail: { successful: true, requestConfig: { elt } }, bubbles: true }));
      return { removes: window.turnstileCalls.removes, resets: window.turnstileCalls.resets };
    });

    expect(after).toEqual({ removes: 1, resets: 0 });
  });

  test("a remove that throws still finishes the teardown, leaving the widget remountable", async ({ page }) => {
    await serveScript(page, "throws-on-remove");
    await mount(page, await formMarkup(), EXPOSE);
    await mountController(page);
    await engage(page);
    await page.waitForFunction(() => window.turnstileCalls?.renders.length === 1);

    // A second mount after the throwing teardown: it is only handed a fresh controller if the
    // WeakMap entry was deleted, which is what the throw used to skip.
    const remounted = await page.evaluate(() => {
      const form = document.querySelector("#form") as HTMLElement;
      const first = window.turnstileCleanup;
      first?.();
      const second = window.forgeTurnstile.mountTurnstile(form);
      window.turnstileCleanup = second;
      return second !== first;
    });

    expect(remounted).toBe(true);
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
