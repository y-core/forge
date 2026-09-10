import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { test as playwrightTest } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build } from "esbuild";

import type { MountOptions } from "./types";

/** Specifiers resolve from `src/`, not from this file or the calling spec — a spec in `ui/core/` and
 * one in `ui/client/` then name the same module the same way. */
const SRC_ROOT = new URL("../../", import.meta.url).pathname;

// playwright 1.62 declares `reducedMotion`, `forcedColors` and `contrast` in `types/test.d.ts` but
// builds none of them into `_combinedContextOptions` (`playwright/lib/index.js`), so
// `test.use({ reducedMotion: "reduce" })` type-checks and emulates nothing — a spec written against
// the reduced-motion branch of `forge-ui.css` would silently exercise the no-preference one. These
// re-declare the three as real options and apply them per page, the one form that does reach the
// browser. A spec that needs any of them must take `test` from here, not from `@playwright/test`.
/** `@playwright/test`'s `test`, with the media options playwright leaves unimplemented reinstated. */
export const test = playwrightTest.extend<{
  reducedMotion: "reduce" | "no-preference" | null;
  forcedColors: "active" | "none" | null;
  contrast: "more" | "no-preference" | null;
}>({
  reducedMotion: [null, { option: true }],
  forcedColors: [null, { option: true }],
  contrast: [null, { option: true }],
  page: async ({ page, reducedMotion, forcedColors, contrast }, use) => {
    if (reducedMotion !== null || forcedColors !== null || contrast !== null) {
      await page.emulateMedia({ reducedMotion, forcedColors, contrast });
    }
    await use(page);
  },
});

const bundles = new Map<string, Promise<string>>();

/** Bundles every requested module into one IIFE — separate bundles would each get their own copy of
 * `signal.ts`, so a signal written through one would be invisible to an effect in the other. */
function bundleModules(expose: Record<string, string>): Promise<string> {
  const entries = Object.entries(expose).sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify(entries);
  const cached = bundles.get(key);
  if (cached) return cached;

  const contents = entries
    .map(([name, specifier], i) => `import * as m${i} from ${JSON.stringify(specifier)};\nwindow[${JSON.stringify(name)}] = m${i};`)
    .join("\n");

  const pending = build({
    stdin: { contents, resolveDir: SRC_ROOT, loader: "ts", sourcefile: "browser-test-entry.ts" },
    bundle: true,
    format: "iife",
    target: "chrome120",
    write: false,
    logLevel: "silent",
  }).then((result) => result.outputFiles[0]?.text ?? "");

  bundles.set(key, pending);
  return pending;
}

/** Loads `html` into the page, applies the requested stylesheets, then publishes the requested modules on `window`. */
export async function mount(page: Page, html: string, options: MountOptions = {}): Promise<void> {
  await givePageAnOrigin(page, options.origin ?? ORIGIN);
  await page.setContent(html);
  for (const href of options.css ?? []) {
    await page.addStyleTag({ path: new URL(href, `file://${SRC_ROOT}`).pathname });
  }
  const expose = options.expose;
  if (expose && Object.keys(expose).length > 0) {
    await page.addScriptTag({ content: await bundleModules(expose) });
  }
}

/** The rendered class list of the element carrying `slot` in its `data-slot`, un-escaped back from HTML. */
export function classesOf(html: string, slot: string): string[] {
  const match = new RegExp(`data-slot="(?:[^"]*\\s)?${slot}(?:\\s[^"]*)?"[^>]*?class="([^"]*)"`).exec(html);
  if (!match?.[1]) throw new Error(`no class attribute on [data-slot~='${slot}']`);
  return match[1].replaceAll("&amp;", "&").split(" ");
}

/** The token sheets a themed spec mounts, so the two showcase specs cannot name a different pair. */
export const THEME_TOKEN_CSS = ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css"];

/** A colour token as the `#rrggbb` the browser paints it. */
export function paintedToken(page: Page, property: string): Promise<string> {
  return paintedHex(page, `var(${property})`);
}

// Two conversions a spec must not do for itself. A token's *computed* value is the substituted text
// — `light-dark()` resolves at used-value time — so it has to be painted before it is a colour at
// all; and a non-legacy colour serializes in its own space, so a computed `oklch()` is not
// comparable to an `rgb()`. The canvas answers with the bytes the browser actually paints, which is
// the same `#rrggbb` the scheme generator produces.
/** The `#rrggbb` a CSS colour value paints as — `"var(--gray-11)"`, an `oklch()`, a hex. */
export function paintedHex(page: Page, value: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement("div");
    probe.style.color = color;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d canvas context");
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }, value);
}

/** `CSS.escape` for a utility class name, which the page has and the test runtime does not. */
export function escapeClass(cls: string): string {
  return cls.replace(/[[\]:&~=.*>+,()#%'"^$|{}/\\?!@`\s]/g, (ch) => `\\${ch}`);
}

/** A URL no request ever leaves the browser for — the route below answers it. */
const ORIGIN = "http://forge.test/";

/** The same host over https, which is what makes the page a secure context. @internal */
export const SECURE_ORIGIN = "https://forge.test/";

/** Puts the page on a real origin before any markup lands: `setContent` alone leaves the document on
 * `about:blank`, whose opaque origin makes any `localStorage` read throw `SecurityError`. */
async function givePageAnOrigin(page: Page, origin: string): Promise<void> {
  if (page.url().startsWith(origin)) return;
  await page.route(`${origin}**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(origin);
}

const TAILWIND_ENTRY = resolve(SRC_ROOT, "ui/assets/css/tailwind.css");

/** The stylesheet compiled against exactly `candidates` — the browser suite ships no Tailwind build of its own. */
export async function compiledCss(candidates: readonly string[]): Promise<string> {
  const { compile } = (await import("tailwindcss")) as {
    compile: (css: string, options: unknown) => Promise<{ build: (candidates: string[]) => string }>;
  };
  const loadStylesheet = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
    const path = id.startsWith("tailwindcss")
      ? new URL(import.meta.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id)).pathname
      : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf-8") };
  };
  const sheet = await compile(readFileSync(TAILWIND_ENTRY, "utf-8"), { base: dirname(TAILWIND_ENTRY), loadStylesheet });
  return sheet.build([...candidates]);
}
