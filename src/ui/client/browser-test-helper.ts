import type { Page } from "@playwright/test";
import { build } from "esbuild";

/** Specifiers resolve from `src/`, not from this file or the calling spec — a spec in `ui/core/` and
 * one in `ui/client/` then name the same module the same way. */
const SRC_ROOT = new URL("../../", import.meta.url).pathname;

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

export interface MountOptions {
  /** Modules to publish on `window`, keyed by global name. Values are specifiers resolved from
   * `src/` — e.g. `{ forgeResume: "./ui/client/resume" }`. */
  expose?: Record<string, string>;
  /**
   * Stylesheets to load into the page, as paths resolved from `src/`.
   *
   * Served raw, with no Tailwind build: name each sheet the spec needs in `forge.css`'s import
   * order (a relative `@import` will not resolve through `addStyleTag`), and size fixtures by
   * content or inline `<style>` rather than by a utility class, which resolves to nothing.
   */
  css?: string[];
}

/** Loads `html` into the page, applies the requested stylesheets, then publishes the requested modules on `window`. */
export async function mount(page: Page, html: string, options: MountOptions = {}): Promise<void> {
  await givePageAnOrigin(page);
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

/** Puts the page on a real origin before any markup lands: `setContent` alone leaves the document on
 * `about:blank`, whose opaque origin makes any `localStorage` read throw `SecurityError`. */
async function givePageAnOrigin(page: Page): Promise<void> {
  if (page.url().startsWith(ORIGIN)) return;
  await page.route(`${ORIGIN}**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(ORIGIN);
}
