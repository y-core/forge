import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { DARK_CLASS, THEME_STORAGE_KEY } from "../chrome/theme";
import { mount, paintedHex } from "../client/browser-test-helper";
import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY } from "../contracts/overlay-contract";
import { TURNSTILE, TURNSTILE_SCRIPT_SRC } from "../contracts/turnstile-contract";
import { createIcon } from "../core/icon";
import { ShowcaseContent } from "./components";
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

interface MountShowcaseOptions {
  /** Load the shipped token layer, so semantic tokens resolve to real colours. */
  themed?: boolean;
  /** Supply the layout utilities the page's classes name, so a case may measure a box. */
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

    await expect.poll(() => page.evaluate(() => document.querySelector("[data-slot~='collapsible']")?.hasAttribute("data-open"))).toBe(!before);
  });

  test("the number field's steppers are live, which only an eager scope makes true", async ({ page }) => {
    await mountShowcase(page);

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
    await mountShowcase(page);
    const requested = await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    await expect.poll(() => requested.length).toBe(1);
    const sent = new URL(requested[0] ?? "");
    expect({ path: sent.pathname, params: [...sent.searchParams] }).toEqual({ path: SHOWCASE_PATHS.validate, params: [["email", "not-an-email"]] });
  });

  test("swaps back a field that carries all three invalid signals", async ({ page }) => {
    await mountShowcase(page);
    await interceptValidate(page);

    await typeEmail(page, "not-an-email");

    await expect
      .poll(() => validateFieldState(page))
      .toEqual({ dataInvalid: true, ariaInvalid: "true", error: "Please enter a valid email address.", errorIcons: 1 });
  });

  test("keeps validating after a swap, which attributes outside the swapped fragment would not", async ({ page }) => {
    await mountShowcase(page);
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

/** Answers Cloudflare's script URL with the recorder above, so no case reaches the real endpoint. */
async function serveTurnstileScript(page: Page): Promise<void> {
  await page.route(TURNSTILE_SCRIPT_SRC, (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_TURNSTILE_SCRIPT }));
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
    await mountShowcase(page);
    await serveTurnstileScript(page);

    expect(await turnstileState(page)).toEqual({ renders: [], fallbackHidden: true });

    await page.focus(TURNSTILE_FIELD);

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

    expect(order).toEqual(["email", "widget", "submit"]);
  });
});

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

const CONTEXT_SURFACE = "[data-scope='show-context-menu']";
const CONTEXT_POPUP_ID = "show-context-menu-popup";

/** The showcase, with the context-menu demo left in place or relocated into an open shadow root. */
async function mountContextMenu(page: Page, tree: Tree): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
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

const TOC_NAV = "nav[aria-label='Component catalog']";
const TOC_RAIL = "#showcase-toc";
const TOC_LINK = `${TOC_NAV} a[href^='#']`;

test.describe("the component catalog's table of contents", () => {
  test("hands the keyboard a link the browser itself agrees is focus-visible, over a ring colour that resolves", async ({ page }) => {
    await mountShowcase(page, { themed: true });

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
    }, TOC_LINK);

    expect(focused).toEqual({ isTocLink: true, focusVisible: true, suppressesOutline: true, drawsRing: true });
    expect(await paintedToken(page, "--ring")).toBe(TOKENS.light.ring);
  });

  test("collapses and re-opens the rail from its own toggle", async ({ page }) => {
    await mountShowcase(page);

    const railOpen = () => page.evaluate((selector) => document.querySelector<HTMLDetailsElement>(selector)?.open, TOC_RAIL);
    expect(await railOpen()).toBe(true);

    await page.click("[data-slot~='navbar-toggle']");
    expect(await railOpen()).toBe(false);

    await page.click("[data-slot~='navbar-toggle']");
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

    expect(state.total).toBeGreaterThan(0);
    expect(state.dangling).toEqual([]);
  });
});

/** The flex item the column's sizing lives on — the scope root, not the navbar inside it. */
const TOC_SCOPE = "[data-scope='show-toc']";
const TOC_TOGGLE = "[data-slot~='navbar-toggle']";
/** Every entry currently carrying the scroll spy's marker, by href. */
const TOC_MARKED = `${TOC_NAV} a[aria-current='location']`;

/** The floor an interactive target is held to: the `Button` `sm` box, which is `h-8`. */
const HIT_TARGET_FLOOR = 32;

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

    expect(box).toEqual({ column: 256, navWidth: 256, navFillsHeight: true, columnHasHeight: true });
  });

  test("keeps the rail pinned to the top of the viewport once the reader scrolls past it", async ({ page }) => {
    await mountShowcase(page, { geometry: true });

    const railTop = () =>
      page.evaluate((selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN), TOC_RAIL);
    expect(await railTop()).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 1200));

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
          columnIsTheToggle: Math.round(column.width) === Math.round(box.width) && Math.round(column.height) === Math.round(box.height),
          clearsHitTarget: box.width >= floor && box.height >= floor,
        };
      },
      { scope: TOC_SCOPE, toggle: TOC_TOGGLE, rail: TOC_RAIL, floor: HIT_TARGET_FLOOR },
    );

    expect(collapsed).toEqual({ open: false, columnIsTheToggle: true, clearsHitTarget: true });
  });

  test("marks the entry for the section the reader has scrolled to, and only that one", async ({ page }) => {
    await mountShowcase(page, { geometry: true });
    const marked = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].map((el) => el.getAttribute("href")), TOC_MARKED);

    await page.evaluate(() => {
      const section = document.getElementById("toolbar");
      if (!section) throw new Error("the showcase no longer renders the toolbar section");
      window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + 20);
    });

    await expect.poll(marked).toEqual(["#toolbar"]);
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
    await mountShowcase(page);

    const seen = [await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)];
    for (let i = 0; i < 3; i++) {
      await page.click(THEME_TOGGLE);
      seen.push(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY));
    }

    expect(seen).toEqual(["system", "light", "dark", "system"]);
  });

  test("re-maps the semantic tokens through the dark class, with no media query and no dark: variant involved", async ({ page }) => {
    await mountShowcase(page, { themed: true });

    await page.click(THEME_TOGGLE);
    const light = await themeState(page);
    await page.click(THEME_TOGGLE);
    const dark = await themeState(page);

    expect(light).toEqual({ dark: false, stored: "light", background: TOKENS.light.background, ring: TOKENS.light.ring });
    expect(dark).toEqual({ dark: true, stored: "dark", background: TOKENS.dark.background, ring: TOKENS.dark.ring });
  });
});
