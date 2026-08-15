import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { DARK_CLASS, THEME_STORAGE_KEY } from "../chrome/theme";
import { mount, paintedHex } from "../client/browser-test-helper";
import { CONTROLS_DEMO_SCOPE, CONTROLS_DEMO_STATE, controlsReadout } from "../contracts/controls-demo-contract";
import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY } from "../contracts/overlay-contract";
import { TURNSTILE, TURNSTILE_SCRIPT_SRC } from "../contracts/turnstile-contract";
import { createIcon } from "../core/icon";
import { PAGE_ORDER, ShowcaseContent, type ShowcasePage } from "./components";
import {
  LAZY_DEMO_LOADED,
  LAZY_DEMO_PENDING,
  LAZY_DEMO_REF,
  LAZY_DEMO_STATUS_REF,
  LAZY_PANEL_ROWS,
  LAZY_RETRY_FAILURES,
  LAZY_RETRY_LOADED,
  LAZY_RETRY_PENDING,
  LAZY_RETRY_REF,
  LAZY_RETRY_STATUS_REF,
  lazyRetryAttempt,
} from "./lazy-contract";
import { renderValidate, showcasePaths } from "./route";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    forgeHtmx: typeof import("../client/htmx");
    /** Renders recorded by the fake Cloudflare script this spec serves. */
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

// htmx boots itself once off `DOMContentLoaded`, and the harness injects its bundle after the
// document has loaded — without this call every `hx-*` attribute on the page is inert.
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
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
});

// Read as painted colours, not as declaration text: a scheme declares each step once with
// `light-dark()`, which resolves at used-value time, so `getPropertyValue` on a token returns the
// same unresolved function in both modes and would measure nothing.
/** The two tokens the theme cases read back, as the mode-resolved colour a reader actually sees. */
const TOKENS = { light: { background: "#f9f9f9", ring: "#646464" }, dark: { background: "#111111", ring: "#b4b4b4" } } as const;

/** A colour token as the `#rrggbb` the browser paints it. */
function paintedToken(page: Page, property: string): Promise<string> {
  return paintedHex(page, `var(${property})`);
}

// The harness runs no Tailwind build, so the utilities the markup names style nothing unless a case
// supplies them; a measurement without these rules measures the browser's defaults.
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

/** The token layer: the scale, then the mapping that points a semantic name at a step. */
const TOKEN_CSS = ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css"];

/** forge's own rules — the ones no `class=` can express, and the only place dialog positioning lives. */
const COMPONENT_CSS = "./ui/assets/css/forge-ui.css";

interface MountShowcaseOptions {
  /** Load the shipped token layer, so semantic tokens resolve to real colours. */
  themed?: boolean;
  /** Supply the layout utilities the page's classes name, so a case may measure a box. */
  geometry?: boolean;
  /** Load `forge-ui.css`, for a case reading a rule the component cannot carry in a `class`. */
  components?: boolean;
}

async function mountShowcase(page: Page, which: ShowcasePage, options: MountShowcaseOptions = {}): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon, page: which }));
  const themed = options.themed === true;
  const prelude = options.geometry === true ? GEOMETRY_STYLE : "";
  const css = [...(themed ? TOKEN_CSS : []), ...(options.components === true ? [COMPONENT_CSS] : [])];
  await mount(page, prelude + html, css.length === 0 ? EXPOSE : { ...EXPOSE, css });
  await page.evaluate(() => window.forgeResume.resume());
  await processHtmx(page);
}

/** `data-slot` is a token list, so focus is asserted on the parsed tokens rather than the raw value. */
function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

test.describe("the showcase page as a whole", () => {
  for (const which of PAGE_ORDER) {
    test(`resumes every scope the ${which} page stamps without a single unregistered-scope warning`, async ({ page }) => {
      const warnings: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
      });

      await mountShowcase(page, which);

      expect(warnings.filter((text) => text.includes("[resume]"))).toEqual([]);
    });
  }

  test("makes every toolbar on the page exactly one tab stop", async ({ page }) => {
    await mountShowcase(page, "interactive");

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
    await mountShowcase(page, "interactive");

    const before = await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex);
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("tab");
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex)).toBe(before);
  });

  test("the tabs select as focus moves, and only one panel is visible", async ({ page }) => {
    await mountShowcase(page, "interactive");

    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    const state = await page.evaluate(() => {
      const widget = document.activeElement?.closest("[data-slot~='tabs']");
      if (!widget) return null;
      return {
        selected: [...widget.querySelectorAll("[data-slot~='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").length,
        visible: [...widget.querySelectorAll<HTMLElement>("[data-slot~='tabs-panel']")].filter((el) => !el.hidden).length,
      };
    });

    expect(state).toEqual({ selected: 1, visible: 1 });
  });

  test("opening the showcase menu focuses its first row and Escape gives the trigger back", async ({ page }) => {
    await mountShowcase(page, "interactive");

    await page.click("[data-slot~='menu-trigger'][commandfor='show-file-menu']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");

    await expect.poll(() => focusedSlots(page)).toContain("menu-trigger");
  });

  test("a menu open on the page does not steal the toolbar's keys", async ({ page }) => {
    await mountShowcase(page, "interactive");
    await page.click("[data-slot~='menu-trigger'][commandfor='show-file-menu']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("toolbar-button");
  });

  test("the native disclosures toggle open on their own, with no controller", async ({ page }) => {
    await mountShowcase(page, "index");

    const isOpen = () => page.evaluate(() => document.querySelector<HTMLDetailsElement>("[data-slot~='collapsible']")?.open);
    const before = await isOpen();
    await page.click("[data-slot~='collapsible-trigger']");

    await expect.poll(isOpen).toBe(!before);
  });

  test("the number field's steppers are live, which only an eager scope makes true", async ({ page }) => {
    await mountShowcase(page, "interactive");

    const before = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot~='number-field-input']")?.value);
    await page.click("[data-slot~='number-field-increment']");

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
    await mountShowcase(page, "runtime");
    const all = await shown(page);
    expect(all.labels.length).toBeGreaterThan(1);

    await page.fill("#filter-input", all.labels[0] ?? "");

    const after = await shown(page);
    expect(after.labels.length).toBeLessThan(all.labels.length);
    expect(after.count).toBe(String(after.labels.length));
  });

  test("clearing the filter restores every item", async ({ page }) => {
    await mountShowcase(page, "runtime");
    const all = await shown(page);

    await page.fill("#filter-input", "zzz-matches-nothing");
    expect((await shown(page)).labels).toEqual([]);
    await page.fill("#filter-input", "");

    expect(await shown(page)).toEqual(all);
  });
});

const VALIDATE_FIELD = "#show-validate-field";
const VALIDATE_INPUT = `${VALIDATE_FIELD} input[name='email']`;
const SHOWCASE_PATHS = showcasePaths("/showcase");

/** Answers the validate endpoint with the fragment the real route would produce, recording every request. */
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

/** Types a value into the demo field the way a reader leaves it: filled, then blurred. */
// Playwright's `fill` emits `input` alone; the browser emits `change` only when the control blurs.
async function typeEmail(page: Page, value: string): Promise<void> {
  await page.fill(VALIDATE_INPUT, value);
  await page.locator(VALIDATE_INPUT).blur();
}

test.describe("the showcase's inline-validation demo", () => {
  test("sends the field's own value, which only attributes on the control can do", async ({ page }) => {
    await mountShowcase(page, "htmx");
    const requested = await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    await expect.poll(() => requested.length).toBe(1);
    const sent = new URL(requested[0] ?? "");
    expect({ path: sent.pathname, params: [...sent.searchParams] }).toEqual({ path: SHOWCASE_PATHS.validate, params: [["email", "not-an-email"]] });
  });

  test("swaps back a field that carries all three invalid signals", async ({ page }) => {
    await mountShowcase(page, "htmx");
    await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    await expect
      .poll(() => validateFieldState(page))
      .toEqual({ dataInvalid: true, ariaInvalid: "true", error: "Please enter a valid email address.", errorIcons: 1 });
  });

  test("keeps validating after a swap, which attributes outside the swapped fragment would not", async ({ page }) => {
    await mountShowcase(page, "htmx");
    const requested = await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    // Polls the swapped-in state rather than `requested.length`: the counter increments before htmx
    // has swapped, so the second `fill` would land on an input about to be replaced.
    await expect
      .poll(() => validateFieldState(page))
      .toEqual({ dataInvalid: true, ariaInvalid: "true", error: "Please enter a valid email address.", errorIcons: 1 });
    expect(requested.length).toBe(1);

    await typeEmail(page, "user@example.com");

    await expect.poll(() => requested.length).toBe(2);
    await expect.poll(() => validateFieldState(page)).toEqual({ dataInvalid: false, ariaInvalid: null, error: null, errorIcons: 0 });
  });
});

/** Cloudflare's documented always-passes test key, which is what the section renders. */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";
// The demo forms carry no scope of the showcase's own: `<Turnstile>` stamps `data-scope="turnstile"`
// on itself, so the widget is what resumes and the enclosing form is found from there.
const TURNSTILE_SCOPE = "form:has([data-scope='turnstile'])";
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

/** Answers Cloudflare's script URL with the recorder above, so no case reaches the real endpoint. */
async function serveTurnstileScript(page: Page): Promise<{ requests: () => number }> {
  let requests = 0;
  await page.route(TURNSTILE_SCRIPT_SRC, (route) => {
    requests += 1;
    return route.fulfill({ contentType: "application/javascript", body: FAKE_TURNSTILE_SCRIPT });
  });
  return { requests: () => requests };
}

/** What the demo widget has done: the renders recorded, and whether the failure message is hidden. */
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
    await mountShowcase(page, "interactive");
    await serveTurnstileScript(page);

    expect(await turnstileState(page)).toEqual({ renders: [], fallbackHidden: true });

    await page.focus(TURNSTILE_FIELD);

    await expect
      .poll(() => turnstileState(page))
      .toEqual({ renders: [{ sitekey: TURNSTILE_TEST_KEY, size: "normal", theme: "light" }], fallbackHidden: true });
  });

  test("mounts each demo form's own widget, on one shared load of Cloudflare's script", async ({ page }) => {
    await mountShowcase(page, "interactive");
    const script = await serveTurnstileScript(page);

    for (const name of ["turnstile-email", "turnstile-email-compact", "turnstile-email-flexible"]) {
      await page.focus(`${TURNSTILE_SCOPE} input[name='${name}']`);
    }

    // One render per demo: the controller used to widen its lookup to the document and resolve all
    // three scopes to the first widget. Sorted, because the arrival order is not a guarantee — the
    // first mount injects the script and the others poll for it on their own 100ms interval.
    await expect
      .poll(async () => (await turnstileState(page)).renders.map((entry) => entry.size).sort())
      .toEqual(["compact", "flexible", "normal"]);
    expect(script.requests()).toBe(1);
  });

  test("puts the widget between the field and the submit control", async ({ page }) => {
    await mountShowcase(page, "interactive");

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

    expect(order).toEqual(["email", "widget", "submit"]);
  });
});

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

const CONTEXT_SURFACE = "[data-scope='show-context-menu']";
const CONTEXT_POPUP_ID = "show-context-menu-popup";

/** The showcase, with the context-menu demo left in place or relocated into an open shadow root. */
async function mountContextMenu(page: Page, tree: Tree): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon, page: "interactive" }));
  // Unstyled, the `[popover][data-coords]` rule never applies and the popup falls back to the UA's
  // centred box under the pointer, where the right-click release light-dismisses it.
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
        host.attachShadow({ mode: "open" }).append(surface, popup);
      },
      { surfaceSelector: CONTEXT_SURFACE, popupId: CONTEXT_POPUP_ID },
    );
  }
  await page.evaluate(() => window.forgeResume.resume());
}

/** Right-clicks the surface at a nameable point, reported in viewport coordinates. */
async function rightClickSurface(page: Page): Promise<{ x: number; y: number }> {
  const surface = page.locator(CONTEXT_SURFACE);
  await surface.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await surface.boundingBox();
  if (!box) throw new Error("the context-menu surface has no box");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y, { button: "right" });
  return { x, y };
}

/** Whether the popup is open, where it was placed, and the measurements the placement assertion needs. */
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

    expect(await page.evaluate((popupId) => document.getElementById(popupId) === null, CONTEXT_POPUP_ID)).toBe(true);
    await expect.poll(async () => (await contextPopupState(page, "shadow")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "shadow");
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });

  test("the identical markup in the light DOM opens the popup at the pointer", async ({ page }) => {
    await mountContextMenu(page, "light");

    await expect.poll(async () => (await contextPopupState(page, "light")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "light");
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });
});

const PAGES_NAV = "nav[aria-label='Showcase pages']";
const TOC_NAV = "nav[aria-label='On this page']";
const PAGES_RAIL = "#showcase-pages";
const TOC_RAIL = "#showcase-toc";
const TOC_LINK = `${TOC_NAV} a[href^='#']`;
const PAGES_LINK = `${PAGES_NAV} a`;

test.describe("the component catalog's table of contents", () => {
  test("hands the keyboard a link the browser itself agrees is focus-visible, over a ring colour that resolves", async ({ page }) => {
    await mountShowcase(page, "index", { themed: true });

    await page.keyboard.press("Tab");
    expect(await focusedSlots(page)).toContain("navbar-toggle");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate((selector) => {
      const link = document.activeElement;
      if (!(link instanceof HTMLElement)) return null;
      const classes = link.className.split(/\s+/);
      return {
        isTocLink: link.matches(selector),
        focusVisible: link.matches(":focus-visible"),
        suppressesOutline: classes.includes("outline-none"),
        drawsRing: classes.includes("focus-visible:ring-2") && classes.includes("focus-visible:ring-ring"),
      };
    }, PAGES_LINK);

    expect(focused).toEqual({ isTocLink: true, focusVisible: true, suppressesOutline: true, drawsRing: true });
    expect(await paintedToken(page, "--ring")).toBe(TOKENS.light.ring);
  });

  test("collapses and re-opens each rail from its own toggle, leaving the other alone", async ({ page }) => {
    await mountShowcase(page, "index");

    const open = (rail: string) => page.evaluate((selector) => document.querySelector<HTMLDetailsElement>(selector)?.open, rail);
    const toggle = (rail: string) => page.click(`${rail} [data-slot~='navbar-toggle']`);
    expect({ pages: await open(PAGES_RAIL), toc: await open(TOC_RAIL) }).toEqual({ pages: true, toc: true });

    await toggle(TOC_RAIL);
    expect({ pages: await open(PAGES_RAIL), toc: await open(TOC_RAIL) }).toEqual({ pages: true, toc: false });

    await toggle(TOC_RAIL);
    expect({ pages: await open(PAGES_RAIL), toc: await open(TOC_RAIL) }).toEqual({ pages: true, toc: true });
  });

  test("splits the two navigations across the content: pages leading, anchors trailing", async ({ page }) => {
    await mountShowcase(page, "index", { geometry: true });

    const layout = await page.evaluate(
      ({ pages, toc, pagesLink, tocLink }) => {
        const x = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().x ?? Number.NaN;
        const hrefs = (selector: string) => [...document.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href") ?? "");
        return {
          pagesX: x(pages),
          mainX: x("#main-content"),
          tocX: x(toc),
          pageHrefs: hrefs(pagesLink),
          anchorsAreFragments: hrefs(tocLink).every((href) => href.startsWith("#")),
          anchorCount: hrefs(tocLink).length,
        };
      },
      { pages: PAGES_RAIL, toc: TOC_RAIL, pagesLink: PAGES_LINK, tocLink: `${TOC_NAV} a` },
    );

    expect(layout.pagesX).toBeLessThan(layout.mainX);
    expect(layout.tocX).toBeGreaterThan(layout.mainX);
    expect(layout.pageHrefs).toEqual(["/showcase", "/showcase/interactive", "/showcase/runtime", "/showcase/htmx", "/showcase/chrome"]);
    expect(layout.anchorCount).toBeGreaterThan(0);
    expect(layout.anchorsAreFragments).toBe(true);
  });

  test("points every entry at a section that is actually on the page", async ({ page }) => {
    await mountShowcase(page, "index");

    const state = await page.evaluate((selector) => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>(selector)];
      return {
        total: links.length,
        dangling: links.map((link) => link.getAttribute("href") ?? "").filter((href) => document.getElementById(href.slice(1)) === null),
      };
    }, TOC_LINK);

    expect(state.total).toBeGreaterThan(0);
    expect(state.dangling).toEqual([]);
  });
});

/** The flex item the column's sizing lives on — the scope root, not the navbar inside it. */
const TOC_SCOPE = "[data-scope='show-toc']";
const TOC_TOGGLE = `${TOC_SCOPE} [data-slot~='navbar-toggle']`;
/** Every entry currently carrying the scroll spy's marker, by href. */
const TOC_MARKED = `${TOC_NAV} a[aria-current='location']`;

/** The floor an interactive target is held to: the `Button` `sm` box, which is `h-8`. */
const HIT_TARGET_FLOOR = 32;

test.describe("the table of contents as a column", () => {
  test("sizes the column on the scope root, and the landmark inside fills it in both axes", async ({ page }) => {
    await mountShowcase(page, "index", { geometry: true });

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

    expect(box).toEqual({ column: 256, navWidth: 256, navFillsHeight: true, columnHasHeight: true });
  });

  test("keeps the rail pinned to the top of the viewport once the reader scrolls past it", async ({ page }) => {
    await mountShowcase(page, "index", { geometry: true });

    const railTop = () =>
      page.evaluate((selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN), TOC_RAIL);
    expect(await railTop()).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 1200));

    expect({ scrolled: Math.round(await page.evaluate(() => window.scrollY)), top: await railTop() }).toEqual({ scrolled: 1200, top: 0 });
  });

  test("shrinks to the toggle's own box when the rail is closed, leaving the control that reopens it hittable", async ({ page }) => {
    await mountShowcase(page, "index", { geometry: true });
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
          columnIsTheToggle: Math.round(column.width) === Math.round(box.width) && Math.round(column.height) === Math.round(box.height),
          clearsHitTarget: box.width >= floor && box.height >= floor,
        };
      },
      { scope: TOC_SCOPE, toggle: TOC_TOGGLE, rail: TOC_RAIL, floor: HIT_TARGET_FLOOR },
    );

    expect(collapsed).toEqual({ open: false, columnIsTheToggle: true, clearsHitTarget: true });
  });

  test("marks the entry for the section the reader has scrolled to, and only that one — on the trailing rail alone", async ({ page }) => {
    await mountShowcase(page, "interactive", { geometry: true });
    const marked = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].map((el) => el.getAttribute("href")), TOC_MARKED);

    await page.evaluate(() => {
      const section = document.getElementById("menu");
      if (!section) throw new Error("the interactive page no longer renders the menu section");
      window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + 20);
    });

    await expect.poll(marked).toEqual(["#menu"]);
    // The spy's scope wraps the trailing rail alone, and its selector is fragments only — the page
    // rail it used to sweep up by accident is now out of reach twice over.
    expect(await page.evaluate((selector) => document.querySelectorAll(selector).length, `${PAGES_NAV} a[aria-current]`)).toBe(0);
  });
});

// The harness runs no Tailwind build, so the drawer's `max-md:` utilities style nothing unless the
// case supplies them; these are the rules the two rails' overlay geometry is measured against.
const DRAWER_STYLE = `<style>
  @media (max-width: 47.99rem) {
    .max-md\\:w-auto { width: auto }
    .max-md\\:fixed { position: fixed }
    .max-md\\:inset-y-0 { top: 0; bottom: 0 }
    .max-md\\:start-0 { inset-inline-start: 0 }
    .max-md\\:end-0 { inset-inline-end: 0 }
    .max-md\\:relative { position: relative }
    .max-md\\:z-50 { z-index: 50 }
    .max-md\\:z-40 { z-index: 40 }
    .max-md\\:flex { display: flex }
    .max-md\\:w-72 { width: 18rem }
    .max-md\\:max-h-none { max-height: none }
    .max-md\\:overflow-visible { overflow: visible }
    .max-md\\:invisible { visibility: hidden }
    .max-md\\:-translate-x-full { transform: translateX(-100%) }
    .max-md\\:translate-x-full { transform: translateX(100%) }
    [open] .max-md\\:group-open\\:visible { visibility: visible }
    [open] .max-md\\:group-open\\:translate-x-0 { transform: translateX(0) }
  }
</style>`;

test.describe("the two rails as edge drawers on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  /** Each rail's panel: the element right after that rail's backdrop. */
  const panelOf = (rail: string) => `${rail} [data-slot~='navbar-backdrop'] + div`;

  async function mountPhone(page: Page): Promise<void> {
    const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon, page: "index" }));
    await mount(page, GEOMETRY_STYLE + DRAWER_STYLE + html, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  test("shuts both rails on load, so neither reserves a column the panel has left", async ({ page }) => {
    await mountPhone(page);

    const state = await page.evaluate(
      ({ pages, toc }) => ({
        open: [pages, toc].map((selector) => document.querySelector<HTMLDetailsElement>(selector)?.open),
        drawers: [pages, toc].map((selector) => document.querySelector(selector)?.hasAttribute("data-navbar-drawer")),
        mainWidth: Math.round(document.getElementById("main-content")?.getBoundingClientRect().width ?? 0),
      }),
      { pages: PAGES_RAIL, toc: TOC_RAIL },
    );

    expect({ open: state.open, drawers: state.drawers }).toEqual({ open: [false, false], drawers: [true, true] });
    expect(state.mainWidth).toBeGreaterThan(200);
  });

  test("opens each rail from its own edge, over content that does not move", async ({ page }) => {
    await mountPhone(page);
    const mainTop = () => page.evaluate(() => Math.round(document.getElementById("main-content")?.getBoundingClientRect().top ?? Number.NaN));
    const box = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el === null) throw new Error(`no element for ${sel}`);
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x), right: Math.round(rect.right), width: Math.round(rect.width), viewport: window.innerWidth };
      }, selector);
    const before = await mainTop();

    await page.click(`${PAGES_RAIL} [data-slot~='navbar-toggle']`);
    const pages = await box(panelOf(PAGES_RAIL));
    expect({ x: pages.x, width: pages.width, mainMoved: (await mainTop()) !== before }).toEqual({ x: 0, width: 288, mainMoved: false });

    await page.click(`${PAGES_RAIL} [data-slot~='navbar-toggle']`);
    await page.click(`${TOC_RAIL} [data-slot~='navbar-toggle']`);
    const toc = await box(panelOf(TOC_RAIL));

    expect({ right: toc.right, width: toc.width, mainMoved: (await mainTop()) !== before }).toEqual({
      right: toc.viewport,
      width: 288,
      mainMoved: false,
    });
  });
});

const CONTROLS_BAND = `[data-scope='${CONTROLS_DEMO_SCOPE}']`;
const BOUND_TEXT_INPUT = `${CONTROLS_BAND} [data-slot~='input'][data-field='text']`;
const BOUND_SWITCH = `${CONTROLS_BAND} label[data-slot~='switch']`;

/** What a bound field's readout currently says, which only the scope's effect writes. */
function readout(page: Page, field: string): Promise<string | null> {
  return page.textContent(`${CONTROLS_BAND} [data-bind-text='${field}']`);
}

test.describe("the showcase's bound-control band", () => {
  test("mirrors what the reader types into the bound text input", async ({ page }) => {
    await mountShowcase(page, "runtime");
    expect(await readout(page, "text")).toBe(controlsReadout(CONTROLS_DEMO_STATE.text));

    await page.fill(BOUND_TEXT_INPUT, "Grace Hopper");

    await expect.poll(() => readout(page, "text")).toBe("Grace Hopper");
  });

  test("flips the switch readout on each click, and back again", async ({ page }) => {
    await mountShowcase(page, "runtime");
    expect(await readout(page, "enabled")).toBe(controlsReadout(CONTROLS_DEMO_STATE.enabled));

    await page.click(BOUND_SWITCH);
    await expect.poll(() => readout(page, "enabled")).toBe("off");

    await page.click(BOUND_SWITCH);
    await expect.poll(() => readout(page, "enabled")).toBe("on");
  });
});

const THEME_TOGGLE = "[data-scope='theme'] button";

/** What the page says its theme is: the class switch, the persisted choice, and the re-mapped tokens. */
async function themeState(page: Page): Promise<{ dark: boolean; stored: string | null; background: string; ring: string }> {
  const state = await page.evaluate(
    ({ key, darkClass }) => ({ dark: document.documentElement.classList.contains(darkClass), stored: localStorage.getItem(key) }),
    { key: THEME_STORAGE_KEY, darkClass: DARK_CLASS },
  );
  return { ...state, background: await paintedToken(page, "--background"), ring: await paintedToken(page, "--ring") };
}

test.describe("the showcase's theme toggle", () => {
  test("cycles the persisted preference and puts the dark class on the document root", async ({ page }) => {
    await mountShowcase(page, "chrome");

    const seen = [await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)];
    for (let i = 0; i < 3; i++) {
      await page.click(THEME_TOGGLE);
      seen.push(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY));
    }

    expect(seen).toEqual(["system", "light", "dark", "system"]);
  });

  test("re-maps the semantic tokens through the dark class, with no media query and no dark: variant involved", async ({ page }) => {
    await mountShowcase(page, "chrome", { themed: true });

    await page.click(THEME_TOGGLE);
    const light = await themeState(page);
    await page.click(THEME_TOGGLE);
    const dark = await themeState(page);

    expect(light).toEqual({ dark: false, stored: "light", background: TOKENS.light.background, ring: TOKENS.light.ring });
    expect(dark).toEqual({ dark: true, stored: "dark", background: TOKENS.dark.background, ring: TOKENS.dark.ring });
  });
});

const NAVBAR_BAND = "[data-scope='show-navbar']";
const ADMIN_FILTER = `${NAVBAR_BAND} button[data-filters='user admin']`;
const SIGNED_OUT_FILTER = `${NAVBAR_BAND} button[data-filters='']`;
const DEMO_ADMIN_LINK = "#show-navbar-top a[data-filter='admin']";
const TOOLBAR_RAIL = "#show-toolbar-rail";
const TOOLBAR_PANEL = "[data-ref='toolbar-panel']";

/** Whether the filtered demo link is showing, alongside every catalog-rail link the event must not touch. */
function chromeFilterState(page: Page): Promise<{ admin: boolean; catalogHidden: boolean[] }> {
  return page.evaluate(
    ({ link, catalog }) => ({
      admin: (document.querySelector<HTMLElement>(link)?.hidden ?? true) !== false,
      catalogHidden: [...document.querySelectorAll<HTMLElement>(catalog)].map((el) => el.hidden === true),
    }),
    { link: DEMO_ADMIN_LINK, catalog: TOC_LINK },
  );
}

const panelHidden = (page: Page) => page.evaluate((selector) => document.querySelector<HTMLElement>(selector)?.hidden, TOOLBAR_PANEL);

test.describe("the showcase's chrome band", () => {
  test("shows and re-hides the filtered navbar link as the filter buttons publish tokens, leaving the catalog rail alone", async ({ page }) => {
    await mountShowcase(page, "chrome");
    const untouched = (await chromeFilterState(page)).catalogHidden.map(() => false);
    expect(await chromeFilterState(page)).toEqual({ admin: true, catalogHidden: untouched });

    await page.click(ADMIN_FILTER);
    await expect.poll(() => chromeFilterState(page)).toEqual({ admin: false, catalogHidden: untouched });

    await page.click(SIGNED_OUT_FILTER);
    await expect.poll(() => chromeFilterState(page)).toEqual({ admin: true, catalogHidden: untouched });
  });

  test("hides the panel from the scope-dispatched toggle and restores it from the command-dispatched reset", async ({ page }) => {
    await mountShowcase(page, "chrome");
    expect(await panelHidden(page)).toBe(false);

    await page.click(`${TOOLBAR_RAIL} [data-ref='toggle']`);
    await expect.poll(() => panelHidden(page)).toBe(true);

    await page.click(`${TOOLBAR_RAIL} [data-ref='reset']`);
    await expect.poll(() => panelHidden(page)).toBe(false);
  });
});

// The non-modal dialog is rendered `open`, so it is on screen from first paint. Its positioning is
// `forge-ui.css` §6's alone — the UA makes every open dialog `position: absolute`, and an unscoped
// gutter rule floated this one over the whole page.
test.describe("the showcase's dialog band", () => {
  const INLINE = "#show-dialog-inline";

  test("flows the non-modal dialog inside its own section rather than over the page", async ({ page }) => {
    await mountShowcase(page, "interactive", { components: true });

    const placement = await page.evaluate((selector) => {
      const dialog = document.querySelector<HTMLElement>(selector);
      const section = document.getElementById("dialog");
      if (dialog === null || section === null) return null;
      const box = dialog.getBoundingClientRect();
      const within = section.getBoundingClientRect();
      return {
        position: getComputedStyle(dialog).position,
        margin: getComputedStyle(dialog).margin,
        containedVertically: box.top >= within.top - 1 && box.bottom <= within.bottom + 1,
      };
    }, INLINE);

    expect(placement).toEqual({ position: "static", margin: "0px", containedVertically: true });
  });

  test("still gives a modal dialog the viewport gutter it centres in", async ({ page }) => {
    await mountShowcase(page, "interactive", { components: true });

    await page.click("[data-slot~='dialog-trigger']");

    const modal = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("#show-dialog");
      if (dialog === null) return null;
      const style = getComputedStyle(dialog);
      return { matchesModal: dialog.matches(":modal"), position: style.position, top: style.top };
    });

    // `fixed`, not `absolute`: the UA promotes a top-layer dialog, and `inset: 1rem` is then the
    // viewport gutter the rule is named for.
    expect(modal).toEqual({ matchesModal: true, position: "fixed", top: "16px" });
  });
});

const LAZY_PANEL = `[data-ref='${LAZY_DEMO_REF}']`;
const LAZY_STATUS = `[data-ref='${LAZY_DEMO_STATUS_REF}']`;
const LAZY_RETRY_PANEL = `[data-ref='${LAZY_RETRY_REF}']`;
const LAZY_RETRY_STATUS = `[data-ref='${LAZY_RETRY_STATUS_REF}']`;

test.describe("the showcase's lazy band", () => {
  test("holds the panel module back until the panel is first scrolled into view", async ({ page }) => {
    await mountShowcase(page, "runtime");

    expect(await page.textContent(LAZY_STATUS)).toBe(LAZY_DEMO_PENDING);

    await page.locator(LAZY_PANEL).scrollIntoViewIfNeeded();

    await expect.poll(() => page.textContent(LAZY_STATUS)).toBe(LAZY_DEMO_LOADED);
  });

  test("renders nothing of the module's payload until the module has arrived", async ({ page }) => {
    await mountShowcase(page, "runtime");

    expect(await page.locator(`${LAZY_PANEL} li`).count()).toBe(0);

    await page.locator(LAZY_PANEL).scrollIntoViewIfNeeded();

    await expect.poll(() => page.locator(`${LAZY_PANEL} li`).count()).toBe(LAZY_PANEL_ROWS.length);
  });

  // The prose says a rejected load is retried; this is the anchor that makes it true. Each rejection
  // reaches `onError`, which is the only channel a caller learns an attempt failed on at all.
  test("retries the failing anchor to the attempt limit, then loads it", async ({ page }) => {
    await mountShowcase(page, "runtime");

    expect(await page.textContent(LAZY_RETRY_STATUS)).toBe(LAZY_RETRY_PENDING);

    // Re-scrolled on every poll: `lazy()` retries by re-observing, and the *other* panel's payload
    // lands between attempts and grows the page — an anchor pushed below the fold would never see a
    // second intersection, and the retry would stall rather than fail.
    const status = async () => {
      await page.locator(LAZY_RETRY_PANEL).scrollIntoViewIfNeeded();
      return page.textContent(LAZY_RETRY_STATUS);
    };

    await expect.poll(status).toBe(lazyRetryAttempt(LAZY_RETRY_FAILURES));
    await expect.poll(status, { timeout: 10_000 }).toBe(LAZY_RETRY_LOADED);
    expect(await page.locator(`${LAZY_RETRY_PANEL} li`).count()).toBe(LAZY_PANEL_ROWS.length);
  });
});
