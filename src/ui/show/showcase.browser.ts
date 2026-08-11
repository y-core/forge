import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { DARK_CLASS, THEME_STORAGE_KEY } from "../chrome/theme";
import { mount } from "../client/browser-test-helper";
import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY } from "../contracts/overlay-contract";
import { TURNSTILE, TURNSTILE_SCRIPT_SRC } from "../contracts/turnstile-contract";
import { createIcon } from "../core/icon";
import { ShowcaseContent } from "./components";
import { renderValidate, showcasePaths } from "./route";

/**
 * The whole showcase page, driven.
 *
 * The epic's cut posture makes `ui/show` the living demo estate, and this is the one surface in
 * forge where a dozen primitives are composed together — so it is the honest place to assert the
 * property none of them can assert alone: **they coexist**. Every scope on this page resumes from
 * one `resume()` call, every controller mounts against markup it did not choose its neighbours for,
 * and driving one widget must not disturb another.
 *
 * Rendered by calling `ShowcaseContent` as a function with the same argument shape
 * `components.test.tsx` uses, so there is no bespoke fixture to drift from the real page.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    forgeHtmx: typeof import("../client/htmx");
    /** Renders recorded by the fake Cloudflare script this spec serves. Named for this spec rather
     * than reusing `turnstileCalls`, which `turnstile.browser.ts` declares globally with a wider
     * shape — one global name cannot carry two. */
    showcaseTurnstileRenders?: Array<{ sitekey: unknown; size: unknown; theme: unknown }>;
  }
}

const EXPOSE = {
  expose: {
    forgeResume: "./ui/client/resume",
    forgeCoreClient: "./ui/core/client",
    forgeChromeClient: "./ui/chrome/client",
    forgeShowClient: "./ui/show/client",
    forgeHtmx: "./ui/client/htmx",
  },
};

/**
 * Wire htmx over the markup already on the page.
 *
 * htmx boots itself once, off `DOMContentLoaded`, and the harness injects its bundle after the
 * document has finished loading — so nothing on this page is wired unless it is asked for
 * explicitly. Without this call every `hx-*` attribute the showcase renders is inert and a case
 * driving one asserts nothing.
 *
 * The page sits on a real origin (`givePageAnOrigin`), which is what satisfies htmx's
 * `selfRequestsOnly`: it compares `location.origin` against the resolved request URL, and an
 * `about:blank` document would fail that check for every root-relative path the showcase uses.
 */
async function processHtmx(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeHtmx.htmx.process(document.body));
}

const icon = createIcon("/sprite.svg", {
  "icon-spinner": "0 0 24 24",
  "icon-chevron-down": "0 0 24 24",
  "icon-sun": "0 0 24 24",
  "icon-moon": "0 0 24 24",
  "icon-monitor": "0 0 24 24",
  "icon-hamburger": "0 0 24 24",
  "icon-close": "0 0 24 24",
});

/**
 * The two tokens the theme cases read back, in both modes, as the shipped token layer declares them.
 *
 * Nothing is injected to make these resolve. This spec used to supply an eleven-stop `--palette-*`
 * ramp, because the semantic layer mapped every token onto one and shipped none of the stops — a
 * consuming app chose them, and the harness runs no Tailwind build, so the `--color-slate-*` a
 * shipped `theme-*.css` aliased did not exist to alias. Both halves of that are gone: the ramp has
 * been deleted and `theme-neutral.css` carries a literal twelve-step scale, so the shipped files
 * alone resolve every token here. Re-pointing the fixture at the new scale was not an
 * alternative — `mount` adds the stylesheet *after* the markup, and between two `:root` blocks of
 * equal weight source order decides, so an injected step would simply lose to the shipped one.
 *
 * The mapping is two hops and they are two files: `theme-base.css` says `--background: var(--gray-1)`
 * and `--ring: var(--gray-11)`, and `theme-neutral.css` says what those steps are worth in each
 * block. The values below are those two steps, pinned rather than read from the file so that a step
 * edited without intent fails here instead of agreeing with itself.
 */
const TOKENS = { light: { background: "#f9f9f9", ring: "#646464" }, dark: { background: "#111111", ring: "#b4b4b4" } } as const;

/**
 * Every utility the rail's geometry is built from, restated as a real rule.
 *
 * The harness runs no Tailwind build, so `class="w-64"` styles nothing — a case that measures a box
 * has to supply the rules it measures or it measures the browser's defaults. Restating them here
 * rather than loading a built stylesheet keeps the dependency visible: each rule below is one the
 * markup names, and a case fails if the markup stops naming it.
 *
 * The collapsed width is keyed off the class token itself rather than a hand-escaped class selector,
 * so a renamed token takes the rule with it. Its `:has()` argument carries the specificity that puts
 * it above `.w-64`, which is the same order the built stylesheet would emit.
 */
const GEOMETRY_STYLE = `<style>
  body { margin: 0 }
  .flex { display: flex }
  .min-h-dvh { min-height: 100dvh }
  .flex-1 { flex: 1 1 0% }
  .min-w-0 { min-width: 0 }
  .shrink-0 { flex-shrink: 0 }
  .h-full { height: 100% }
  .sticky { position: sticky }
  .top-0 { top: 0 }
  .left-0 { left: 0 }
  .max-h-dvh { max-height: 100dvh }
  .overflow-y-auto { overflow-y: auto }
  .p-3 { padding: 0.75rem }
  .hidden { display: none }
  [open] .group-open\\:flex { display: flex }
  .w-64 { width: 16rem }
  [class~="has-[[data-slot~=navbar]:not([open])]:w-auto"]:has([data-slot~="navbar"]:not([open])) { width: auto }
  [class~="has-[[data-slot~=navbar]:not([open])]:self-start"]:has([data-slot~="navbar"]:not([open])) { align-self: flex-start }
</style>`;

/** The token layer: the scale, then the mapping that points a semantic name at a step. Both halves
 * are needed for `getComputedStyle` to answer a colour, and neither carries a component rule — the
 * `themed` cases read tokens and measure no box. */
const TOKEN_CSS = ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css"];

interface MountShowcaseOptions {
  /** Load the shipped token layer, so semantic tokens resolve to real colours and a case may
   * read computed style rather than markup. */
  themed?: boolean;
  /** Supply the layout utilities the page's classes name, so a case may measure a box. Without it
   * every element is at its browser default size and a measurement means nothing. */
  geometry?: boolean;
}

async function mountShowcase(page: Page, options: MountShowcaseOptions = {}): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
  const themed = options.themed === true;
  const prelude = options.geometry === true ? GEOMETRY_STYLE : "";
  await mount(page, prelude + html, themed ? { ...EXPOSE, css: TOKEN_CSS } : EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
  await processHtmx(page);
}

/** `data-slot` is a token list, so focus is asserted on the parsed tokens rather than the raw value. */
function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

test.describe("the showcase page as a whole", () => {
  test("resumes every scope it stamps without a single unregistered-scope warning", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
    });

    await mountShowcase(page);

    // A component whose markup names a scope has to guarantee the scope exists. This is the page
    // that would catch a primitive shipped with a `data-scope` nobody registers.
    expect(warnings.filter((text) => text.includes("[resume]"))).toEqual([]);
  });

  test("makes every toolbar on the page exactly one tab stop", async ({ page }) => {
    await mountShowcase(page);

    const stops = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-slot~='toolbar']")].map(
        (rail) => [...rail.querySelectorAll<HTMLElement>("[data-toolbar-item]")].filter((item) => item.tabIndex === 0).length,
      ),
    );

    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((count) => count === 1)).toBe(true);
  });
});

test.describe("primitives coexisting on one page", () => {
  test("driving the tabs leaves the toolbar's tab stop where it was", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex);
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("tab");
    // Two composites are mounted on one page; a controller that queried the document rather than its
    // own root would move the other one's tab stop too.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex)).toBe(before);
  });

  test("the tabs select as focus moves, and only one panel is visible", async ({ page }) => {
    await mountShowcase(page);

    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    const state = await page.evaluate(() => ({
      selected: [...document.querySelectorAll("[data-slot~='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").length,
      visible: [...document.querySelectorAll<HTMLElement>("[data-slot~='tabs-panel']")].filter((el) => !el.hidden).length,
    }));

    expect(state).toEqual({ selected: 1, visible: 1 });
  });

  test("opening the showcase menu focuses its first row and Escape gives the trigger back", async ({ page }) => {
    await mountShowcase(page);

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");

    await expect.poll(() => focusedSlots(page)).toContain("menu-trigger");
  });

  test("a menu open on the page does not steal the toolbar's keys", async ({ page }) => {
    await mountShowcase(page);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("toolbar-button");
  });

  test("the native disclosures publish their open state through the shared protocol", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector("[data-slot~='collapsible']")?.hasAttribute("data-open"));
    await page.click("[data-slot~='collapsible-trigger']");

    // `<details>` owns open and closed; the transition controller only publishes them for CSS. This
    // is the assertion that the controller is actually mounted on the real page.
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-slot~='collapsible']")?.hasAttribute("data-open"))).toBe(!before);
  });

  test("the number field's steppers are live, which only an eager scope makes true", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot~='number-field-input']")?.value);
    await page.click("[data-slot~='number-field-increment']");

    // The steppers carry no `data-on-*` action, so a lazy scope would have nothing to resume it and
    // the buttons would sit inert on the page.
    const after = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot~='number-field-input']")?.value);
    expect(after).not.toBe(before);
  });
});

test.describe("the showcase's own filter island", () => {
  /** The labels of the filter items still shown, and the count the island renders beside them. */
  function shown(page: Page): Promise<{ labels: string[]; count: string | null | undefined }> {
    return page.evaluate(() => ({
      labels: [...document.querySelectorAll<HTMLElement>("[data-filter-item]")]
        .filter((el) => !el.hidden)
        .map((el) => (el.textContent ?? "").trim()),
      count: document.querySelector("[data-ref='count']")?.textContent,
    }));
  }

  test("typing in the filter hides the items that do not match and updates the count", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);
    expect(all.labels.length).toBeGreaterThan(1);

    await page.fill("#filter-input", all.labels[0] ?? "");

    const after = await shown(page);
    expect(after.labels.length).toBeLessThan(all.labels.length);
    expect(after.count).toBe(String(after.labels.length));
  });

  test("clearing the filter restores every item", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);

    await page.fill("#filter-input", "zzz-matches-nothing");
    expect((await shown(page)).labels).toEqual([]);
    await page.fill("#filter-input", "");

    // A scope like any other, mounted alongside a dozen controllers — its own state has to survive
    // being one island among many.
    expect(await shown(page)).toEqual(all);
  });
});

// ─── The inline-validation demo, driven ──────────────────────────────────────

const VALIDATE_FIELD = "#show-validate-field";
const VALIDATE_INPUT = `${VALIDATE_FIELD} input[name='email']`;
const SHOWCASE_PATHS = showcasePaths("/showcase");

/**
 * Answer the validate endpoint with the fragment the real route would have produced, and record
 * every request that reached it.
 *
 * Registered after `mountShowcase`, so it takes precedence over the harness's origin-wide stub —
 * which would otherwise hand htmx an empty document to swap in and hide the failure this describes.
 */
async function interceptValidate(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === SHOWCASE_PATHS.validate,
    async (route) => {
      const url = new URL(route.request().url());
      requested.push(url.href);
      const response = await renderValidate({ email: url.searchParams.get("email") ?? "", paths: SHOWCASE_PATHS }, icon);
      await route.fulfill({ contentType: "text/html", body: await response.text() });
    },
  );
  return requested;
}

/** What the field announces about its own validity, read from the DOM rather than the markup string. */
function validateFieldState(page: Page) {
  return page.evaluate(
    ({ field, input }) => ({
      dataInvalid: document.querySelector(field)?.hasAttribute("data-invalid") ?? null,
      ariaInvalid: document.querySelector(input)?.getAttribute("aria-invalid"),
      error: document.querySelector(`${field} [data-slot~='field-error']`)?.textContent?.trim() ?? null,
      errorIcons: document.querySelectorAll(`${field} [data-slot~='field-error'] [data-slot~='icon']`).length,
    }),
    { field: VALIDATE_FIELD, input: VALIDATE_INPUT },
  );
}

/**
 * Type a value into the demo field the way a reader leaves it: filled, then blurred.
 *
 * Playwright's `fill` emits `input` alone — the browser itself emits `change` only when the control
 * loses focus — so a case that filled and waited would sit through the whole poll on a field whose
 * trigger has not fired yet.
 */
async function typeEmail(page: Page, value: string): Promise<void> {
  await page.fill(VALIDATE_INPUT, value);
  await page.locator(VALIDATE_INPUT).blur();
}

test.describe("the showcase's inline-validation demo", () => {
  test("sends the field's own value, which only attributes on the control can do", async ({ page }) => {
    await mountShowcase(page);
    const requested = await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    // The whole defect in one assertion: attributes on a wrapper make htmx serialise the wrapper,
    // which has no value, so the endpoint is asked to validate an empty string forever.
    await expect.poll(() => requested.length).toBe(1);
    const sent = new URL(requested[0] ?? "");
    expect({ path: sent.pathname, params: [...sent.searchParams] }).toEqual({ path: SHOWCASE_PATHS.validate, params: [["email", "not-an-email"]] });
  });

  test("swaps back a field that carries all three invalid signals", async ({ page }) => {
    await mountShowcase(page);
    await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    // `data-invalid`, `aria-invalid` and a glyph together — colour alone says nothing to a reader
    // who cannot see it, and the two attributes come from two different mechanisms.
    await expect
      .poll(() => validateFieldState(page))
      .toEqual({ dataInvalid: true, ariaInvalid: "true", error: "Please enter a valid email address.", errorIcons: 1 });
  });

  test("keeps validating after a swap, which attributes outside the swapped fragment would not", async ({ page }) => {
    await mountShowcase(page);
    const requested = await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    // Waited on the *swapped-in* state, not on `requested.length`. `interceptValidate` records a
    // request when it reaches the route handler, which is before the response is fulfilled and well
    // before htmx has swapped — so waiting on the counter returns mid-swap, and the second `fill`
    // would land on the input that is about to be replaced. Its `change` then dies with the element
    // and no second request is ever sent. `data-invalid` only appears once the fragment is in the
    // DOM, so polling it is what proves the swap finished.
    await expect
      .poll(() => validateFieldState(page))
      .toEqual({ dataInvalid: true, ariaInvalid: "true", error: "Please enter a valid email address.", errorIcons: 1 });
    expect(requested.length).toBe(1);

    await typeEmail(page, "user@example.com");

    // The swap replaces the field the attributes sit on, so the fragment has to render them again —
    // attributes placed in the section would be destroyed here and validation would work once.
    await expect.poll(() => requested.length).toBe(2);
    await expect.poll(() => validateFieldState(page)).toEqual({ dataInvalid: false, ariaInvalid: null, error: null, errorIcons: 0 });
  });
});

// ─── The Turnstile demo, driven ──────────────────────────────────────────────

/** Cloudflare's documented always-passes test key, which is what the section renders. */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";
const TURNSTILE_SCOPE = "[data-scope='show-turnstile']";
const TURNSTILE_FIELD = `${TURNSTILE_SCOPE} input[name='turnstile-email']`;

/** Stands in for Cloudflare's `api.js`: installs a recording `window.turnstile` and nothing else. */
const FAKE_TURNSTILE_SCRIPT = `
  window.showcaseTurnstileRenders = [];
  window.turnstile = {
    render: function (el, params) {
      window.showcaseTurnstileRenders.push({ sitekey: params.sitekey, size: params.size, theme: params.theme });
      return "widget-1";
    },
    reset: function () {},
    remove: function () {},
  };
`;

/**
 * Answer Cloudflare's script URL with the recorder above.
 *
 * The route is the whole reason this case may exist: the controller performs a genuine `<script>`
 * load, and without an interception the showcase's own markup would reach the real endpoint from
 * the test suite. Nothing else is faked — the form, the `focusin`, the injection and the load event
 * are the platform's.
 */
async function serveTurnstileScript(page: Page): Promise<void> {
  await page.route(TURNSTILE_SCRIPT_SRC, (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_TURNSTILE_SCRIPT }));
}

/** What the demo widget has actually done: the renders recorded, and whether the failure message
 * the component ships hidden is still hidden. */
function turnstileState(page: Page) {
  return page.evaluate(
    ({ fallbackRef }) => ({
      renders: window.showcaseTurnstileRenders ?? [],
      fallbackHidden: document.querySelector<HTMLElement>(`[data-ref='${fallbackRef}']`)?.hidden ?? null,
    }),
    { fallbackRef: TURNSTILE.fallback },
  );
}

test.describe("the showcase's Turnstile demo", () => {
  test("renders the widget once a reader engages with the form it sits in", async ({ page }) => {
    await mountShowcase(page);
    await serveTurnstileScript(page);

    // The gate, asserted before it is opened: the third-party cost is deferred until intent to
    // submit, so a reader who only scrolls past the section loads nothing.
    expect(await turnstileState(page)).toEqual({ renders: [], fallbackHidden: true });

    await page.focus(TURNSTILE_FIELD);

    // The whole defect in one assertion: `mountTurnstile` resolves the enclosing form and gates the
    // load on `focusin` within it, so a section with no form — or a form with nothing to focus —
    // renders a permanently empty box and records no render at all.
    await expect
      .poll(() => turnstileState(page))
      .toEqual({ renders: [{ sitekey: TURNSTILE_TEST_KEY, size: "normal", theme: "light" }], fallbackHidden: true });
  });

  test("puts the widget between the field and the submit control", async ({ page }) => {
    await mountShowcase(page);

    const order = await page.evaluate(
      ({ scope, widgetRef }) => {
        const form = document.querySelector(scope);
        if (!form) return null;
        return [...form.querySelectorAll("input[type='email'], [data-ref], button")]
          .map((el) => (el.getAttribute("data-ref") === widgetRef ? "widget" : el.tagName === "BUTTON" ? "submit" : el.getAttribute("type")))
          .filter((name) => name === "widget" || name === "submit" || name === "email");
      },
      { scope: TURNSTILE_SCOPE, widgetRef: TURNSTILE.widget },
    );

    // A challenge that appears above the submit control does not push the button the reader is
    // already reaching for; below the field, so the widget is not the first thing in the form.
    expect(order).toEqual(["email", "widget", "submit"]);
  });
});

// ─── The context-menu island across a shadow boundary ────────────────────────

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

const CONTEXT_SURFACE = "[data-scope='show-context-menu']";
const CONTEXT_POPUP_ID = "show-context-menu-popup";

/**
 * The showcase, with the context-menu demo left where it was rendered or relocated into an open
 * shadow root before anything resumes.
 *
 * The demo's scope resolves its popup from the id serialised into `data-state`, and a document-scoped
 * lookup answers `null` for an id living in a shadow tree — so `setup` returned before ever binding
 * `contextmenu`, and a right-click fell straight through to the browser's own menu. Relocating the
 * real page's own markup rather than hand-rolling a fixture keeps that failure attached to the demo
 * the epic actually ships.
 */
async function mountContextMenu(page: Page, tree: Tree): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
  // The one mount in this spec that loads the stylesheet, and it is load-bearing rather than
  // incidental. Unstyled, the coordinate rule never applies and the popup falls back to the UA's
  // centred `[popover]` box — which sits *under* the pointer, so the release that ends the
  // right-click lands on the panel and the platform's light-dismiss pass declines to match. The demo
  // then appears to work in the harness while flashing and vanishing on the real page, which is
  // exactly what happened. Placed at the point, the release lands on the surface and these cases see
  // what a reader sees.
  //
  // `forge-ui.css` and not the token sheets: the rule wanted is `[popover][data-coords]`,
  // which lives there and names only `--anchor-x` / `--anchor-y` — properties `openPopoverAt` writes
  // through CSSOM rather than ones the token layer declares.
  await mount(page, html, { ...EXPOSE, css: ["./ui/assets/css/forge-ui.css"] });
  if (tree === "shadow") {
    await page.evaluate(
      ({ surfaceSelector, popupId }) => {
        const surface = document.querySelector(surfaceSelector);
        const popup = document.getElementById(popupId);
        if (!surface || !popup) throw new Error("the showcase no longer renders the context-menu demo");
        const host = document.createElement("div");
        host.id = "ctx-host";
        surface.before(host);
        // Moved rather than cloned: exactly one element carries each id, and the document is left
        // holding none of them — which is what makes the document-scoped lookup answer null.
        host.attachShadow({ mode: "open" }).append(surface, popup);
      },
      { surfaceSelector: CONTEXT_SURFACE, popupId: CONTEXT_POPUP_ID },
    );
  }
  await page.evaluate(() => window.forgeResume.resume());
}

/** Right-click the surface at a point the case can name, and report that point in viewport
 * coordinates — the same ones `clientX`/`clientY` hand the controller. */
async function rightClickSurface(page: Page): Promise<{ x: number; y: number }> {
  const surface = page.locator(CONTEXT_SURFACE);
  // Centred rather than merely scrolled into view, so the click point has the whole lower half of the
  // viewport beneath it and the placement clamp below stays the identity.
  await surface.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await surface.boundingBox();
  if (!box) throw new Error("the context-menu surface has no box");
  // The centre, not a fixed offset from the corner: the harness loads no stylesheet, so the surface
  // is whatever height its one line of text gives it and a corner offset lands on the next element.
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y, { button: "right" });
  return { x, y };
}

/** Whether the popup is open, where it was placed, and the two measurements the placement assertion
 * needs in order to be exact rather than recomputed. */
function contextPopupState(page: Page, tree: Tree) {
  return page.evaluate(
    ({ where, popupId, xProp, yProp }) => {
      const root: ParentNode | null | undefined = where === "shadow" ? document.querySelector("#ctx-host")?.shadowRoot : document;
      if (!root) throw new Error("no tree to read: the shadow root was never attached");
      const popup = root.querySelector<HTMLElement>(`#${popupId}`);
      if (!popup) throw new Error("the context-menu popup is not in the tree the case mounted it into");
      const rect = popup.getBoundingClientRect();
      return {
        open: popup.matches(":popover-open"),
        x: popup.style.getPropertyValue(xProp),
        y: popup.style.getPropertyValue(yProp),
        size: { width: Math.round(rect.width), height: Math.round(rect.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    },
    { where: tree, popupId: CONTEXT_POPUP_ID, xProp: ANCHOR_X_PROPERTY, yProp: ANCHOR_Y_PROPERTY },
  );
}

test.describe("the showcase's context-menu island across a shadow boundary", () => {
  test("a right-click inside an open shadow root opens the popup at the pointer", async ({ page }) => {
    await mountContextMenu(page, "shadow");

    // Asserted, not assumed: it is the precondition that makes this case about a shadow boundary at
    // all. With the popup id visible to the document, a document-scoped lookup would pass too.
    expect(await page.evaluate((popupId) => document.getElementById(popupId) === null, CONTEXT_POPUP_ID)).toBe(true);
    await expect.poll(async () => (await contextPopupState(page, "shadow")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "shadow");
    // `openPopoverAt` clamps the panel onto the screen, so the coordinates are only the click point
    // when the panel fits below and to the right of it. Pinned rather than recomputed: reimplementing
    // the clamp here would make the assertion agree with the controller by construction.
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });

  test("the identical markup in the light DOM opens the popup at the pointer", async ({ page }) => {
    // The parity half. Without it a regression that broke the ordinary document path could hide
    // behind a green shadow case, because the shadow lookup and the document lookup are one call.
    await mountContextMenu(page, "light");

    await expect.poll(async () => (await contextPopupState(page, "light")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "light");
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });
});

// ─── The component catalog's table of contents ───────────────────────────────

/**
 * Two handles, because the rail is two elements with two different jobs. The landmark is what a
 * reader navigates by, so the entries are addressed through it — a selector that fails the moment
 * the catalog stops being navigation. The disclosure is what opens and closes, and `open` lives on
 * the `<details>`, which is the element carrying the id.
 */
const TOC_NAV = "nav[aria-label='Component catalog']";
const TOC_RAIL = "#showcase-toc";
const TOC_LINK = `${TOC_NAV} a[href^='#']`;

test.describe("the component catalog's table of contents", () => {
  test("hands the keyboard a link the browser itself agrees is focus-visible, over a ring colour that resolves", async ({ page }) => {
    await mountShowcase(page, { themed: true });

    // The rail is DOM-first and its disclosure toggle is the page's first focusable, so the catalog
    // is two presses in: the toggle, then the first entry.
    await page.keyboard.press("Tab");
    expect(await focusedSlots(page)).toContain("navbar-toggle");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate((selector) => {
      const link = document.activeElement;
      if (!(link instanceof HTMLElement)) return null;
      const classes = link.className.split(/\s+/);
      return {
        isTocLink: link.matches(selector),
        // The browser's own answer, not a class-name reading of it: `:focus-visible` matching is the
        // precondition every `focus-visible:` utility on this link is gated on.
        focusVisible: link.matches(":focus-visible"),
        // A ring drawn from an unresolved token paints nothing, so the colour has to arrive through
        // the cascade at this element rather than merely be named by it.
        ring: getComputedStyle(link).getPropertyValue("--ring").trim(),
        // The pair, together. Dropping the ring while keeping the outline suppression is the exact
        // shape of the regression that leaves these links with no focus affordance at all.
        suppressesOutline: classes.includes("outline-none"),
        drawsRing: classes.includes("focus-visible:ring-2") && classes.includes("focus-visible:ring-ring"),
      };
    }, TOC_LINK);

    // Light, because nothing has clicked the toggle: the theme scope reconciles the server's
    // `system` default against `prefers-color-scheme`, which the harness leaves at light.
    expect(focused).toEqual({ isTocLink: true, focusVisible: true, ring: TOKENS.light.ring, suppressesOutline: true, drawsRing: true });
  });

  test("collapses and re-opens the rail from its own toggle", async ({ page }) => {
    await mountShowcase(page);

    const railOpen = () => page.evaluate((selector) => document.querySelector<HTMLDetailsElement>(selector)?.open, TOC_RAIL);
    // The rail ships open, and at this viewport the viewport-collapse controller leaves it that way.
    expect(await railOpen()).toBe(true);

    await page.click("[data-slot~='navbar-toggle']");
    expect(await railOpen()).toBe(false);

    await page.click("[data-slot~='navbar-toggle']");
    // Open and closed belong to `<details>`; the controller above only ever hands them back.
    expect(await railOpen()).toBe(true);
  });

  test("points every entry at a section that is actually on the page", async ({ page }) => {
    await mountShowcase(page);

    const state = await page.evaluate((selector) => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>(selector)];
      return {
        total: links.length,
        dangling: links.map((link) => link.getAttribute("href") ?? "").filter((href) => document.getElementById(href.slice(1)) === null),
      };
    }, TOC_LINK);

    // A nav is only navigation while its targets exist; a renamed section id turns an entry into a
    // link that scrolls nowhere and reports nothing.
    expect(state.total).toBeGreaterThan(0);
    expect(state.dangling).toEqual([]);
  });
});

// ─── The table of contents as a column ───────────────────────────────────────

/** The flex item the column's sizing lives on — the scope root, not the navbar inside it. */
const TOC_SCOPE = "[data-scope='show-toc']";
const TOC_TOGGLE = "[data-slot~='navbar-toggle']";
/** Every entry currently carrying the scroll spy's marker, by href. */
const TOC_MARKED = `${TOC_NAV} a[aria-current='location']`;

/** The floor an interactive target is held to: the `Button` `sm` box, which is `h-8`. */
const HIT_TARGET_FLOOR = 32;

/**
 * The rail's geometry, measured rather than read off class names.
 *
 * Every case here mounts with `geometry`, because the class strings the SSR tests pin are inert
 * until something resolves them — `sticky top-0 max-h-dvh overflow-y-auto` on the disclosure did
 * nothing at all for as long as the boxes above it had no height, and no class-string assertion
 * could have said so.
 */
test.describe("the table of contents as a column", () => {
  test("sizes the column on the scope root, and the landmark inside fills it in both axes", async ({ page }) => {
    await mountShowcase(page, { geometry: true });

    const box = await page.evaluate((scope) => {
      const root = document.querySelector(scope);
      const nav = root?.querySelector("nav");
      if (!(root instanceof HTMLElement) || !(nav instanceof HTMLElement)) return null;
      const column = root.getBoundingClientRect();
      const landmark = nav.getBoundingClientRect();
      return {
        column: Math.round(column.width),
        navWidth: Math.round(landmark.width),
        navFillsHeight: Math.round(landmark.height) === Math.round(column.height),
        columnHasHeight: column.height > 0,
      };
    }, TOC_SCOPE);

    // 16rem wide, and a landmark that reaches the full height of the column: the height chain the
    // sticky disclosure travels within, and the width it needs no class to inherit.
    expect(box).toEqual({ column: 256, navWidth: 256, navFillsHeight: true, columnHasHeight: true });
  });

  test("keeps the rail pinned to the top of the viewport once the reader scrolls past it", async ({ page }) => {
    await mountShowcase(page, { geometry: true });

    const railTop = () =>
      page.evaluate((selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN), TOC_RAIL);
    expect(await railTop()).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 1200));

    // The property the placement string always claimed and never delivered: a sticky box travels
    // within its containing block, so a rail whose ancestors have no height scrolls away with the
    // page. Both halves in one assertion — a rail that stayed at 0 because nothing scrolled would
    // pass the second on its own.
    expect({ scrolled: Math.round(await page.evaluate(() => window.scrollY)), top: await railTop() }).toEqual({ scrolled: 1200, top: 0 });
  });

  test("shrinks to the toggle's own box when the rail is closed, leaving the control that reopens it hittable", async ({ page }) => {
    await mountShowcase(page, { geometry: true });
    await page.click(TOC_TOGGLE);

    const collapsed = await page.evaluate(
      ({ scope, toggle, rail, floor }) => {
        const root = document.querySelector(scope);
        const control = document.querySelector(toggle);
        if (!(root instanceof HTMLElement) || !(control instanceof HTMLElement)) return null;
        const box = control.getBoundingClientRect();
        const column = root.getBoundingClientRect();
        return {
          open: document.querySelector<HTMLDetailsElement>(rail)?.open,
          // Both axes, as one comparison against the control rather than as two pinned numbers: what
          // the closed column owes is that it is the toggle and nothing else, and a pinned width
          // would go on passing while a full-height strip ran down the page beside it.
          columnIsTheToggle: Math.round(column.width) === Math.round(box.width) && Math.round(column.height) === Math.round(box.height),
          clearsHitTarget: box.width >= floor && box.height >= floor,
        };
      },
      { scope: TOC_SCOPE, toggle: TOC_TOGGLE, rail: TOC_RAIL, floor: HIT_TARGET_FLOOR },
    );

    // The column gives the page back every pixel the closed rail is not using — `w-auto` on the
    // inline axis, `self-start` on the block one, since a stretched flex item would otherwise hold
    // the full `min-h-dvh` height under a 46px control. It still clears the hit-target floor: a strip
    // whose control cannot be hit is a rail that cannot reopen.
    expect(collapsed).toEqual({ open: false, columnIsTheToggle: true, clearsHitTarget: true });
  });

  test("marks the entry for the section the reader has scrolled to, and only that one", async ({ page }) => {
    await mountShowcase(page, { geometry: true });
    const marked = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].map((el) => el.getAttribute("href")), TOC_MARKED);

    await page.evaluate(() => {
      const section = document.getElementById("toolbar");
      if (!section) throw new Error("the showcase no longer renders the toolbar section");
      // A little past the section's own top, so the section above it is clear of the observation
      // band rather than touching it at the edge.
      window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + 20);
    });

    // The rail's scope is eager, so the spy came up on the same `resume()` every other scope on this
    // page did — nothing here mounts it by hand, which is the half a unit test cannot assert.
    await expect.poll(marked).toEqual(["#toolbar"]);
  });
});

// ─── The theme toggle, driven ────────────────────────────────────────────────

const THEME_TOGGLE = "[data-scope='theme'] button";

/** What the page says its theme is: the class strategy's switch, the persisted choice, and the two
 * tokens the switch re-maps. */
function themeState(page: Page): Promise<{ dark: boolean; stored: string | null; background: string; ring: string }> {
  return page.evaluate(
    ({ key, darkClass }) => {
      const root = document.documentElement;
      const styles = getComputedStyle(root);
      return {
        dark: root.classList.contains(darkClass),
        stored: localStorage.getItem(key),
        background: styles.getPropertyValue("--background").trim(),
        ring: styles.getPropertyValue("--ring").trim(),
      };
    },
    { key: THEME_STORAGE_KEY, darkClass: DARK_CLASS },
  );
}

test.describe("the showcase's theme toggle", () => {
  test("cycles the persisted preference and puts the dark class on the document root", async ({ page }) => {
    await mountShowcase(page);

    const seen = [await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)];
    for (let i = 0; i < 3; i++) {
      await page.click(THEME_TOGGLE);
      seen.push(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY));
    }

    // The server default is `system`, and the scope reconciles it into storage before any click.
    expect(seen).toEqual(["system", "light", "dark", "system"]);
  });

  test("re-maps the semantic tokens through the dark class, with no media query and no dark: variant involved", async ({ page }) => {
    await mountShowcase(page, { themed: true });

    await page.click(THEME_TOGGLE);
    const light = await themeState(page);
    await page.click(THEME_TOGGLE);
    const dark = await themeState(page);

    // The class is only half the claim. The tokens have to actually land on different scale steps,
    // because that re-mapping is the entire mechanism — no utility on the page carries a `dark:`
    // variant, so a class that toggled without moving the tokens would re-theme nothing. The
    // semantic layer is now declared once for both modes, which makes this the case that proves the
    // `.dark` block really does carry the whole difference.
    expect(light).toEqual({ dark: false, stored: "light", background: TOKENS.light.background, ring: TOKENS.light.ring });
    expect(dark).toEqual({ dark: true, stored: "dark", background: TOKENS.dark.background, ring: TOKENS.dark.ring });
  });
});
