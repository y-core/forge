import type { Page } from "@playwright/test";
import { build } from "esbuild";

/**
 * Harness for the browser set (`bun run test:browser`).
 *
 * A browser spec puts real SSR markup in a real page, loads the real module, dispatches a real
 * event, and asserts the DOM that resulted. Nothing here fakes a DOM API — the point of the set is
 * that the platform answers, not a model of it.
 *
 * Not published: covered by the `!**\/*-test-helper.ts` negation in `package.json` `files`.
 */

/** Specifiers resolve from `src/`, not from this file or the calling spec — a spec in `ui/core/` and
 * one in `ui/client/` then name the same module the same way. */
const SRC_ROOT = new URL("../../", import.meta.url).pathname;

const bundles = new Map<string, Promise<string>>();

/**
 * Bundle every requested module into **one** IIFE.
 *
 * One bundle rather than one per module, because esbuild gives each bundle its own copy of every
 * shared dependency. Two separately-bundled modules that both reach `signal.ts` get two subscriber
 * registries, so a signal written through one is invisible to an effect registered through the
 * other — a failure that looks like a bug in the code under test and is not.
 */
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
   * Stylesheets to load into the page, as paths resolved from `src/` — the same convention `expose`
   * uses, so `"./ui/assets/css/theme-base.css"` names the shipped file rather than a copy.
   *
   * **The file is served to the browser raw: no Tailwind build runs.** Two consequences decide how a
   * fixture using this must be written:
   *
   * - `@theme inline` is an unknown at-rule, so the CSS parser discards the whole block. `@layer
   *   components` is a real at-rule and is honoured. What survives is therefore exactly the component
   *   rules under test, which is what a placement spec wants to measure.
   * - **No Tailwind utility resolves.** `class="w-40"` styles nothing. Size a fixture by its content
   *   or by an inline `<style>` in the markup string, never by a utility class.
   */
  css?: string[];
}

/**
 * Load `html` into the page, apply the requested stylesheets, and publish the requested modules on
 * `window`.
 *
 * Order is the contract: content, then CSS, then the bundle. The bundle goes last for the same
 * reason a real page defers it — the markup exists before any controller can see it — and the CSS
 * goes *before* it so a controller that runs on `beforetoggle` and reads or writes computed style
 * sees the real cascade rather than an unstyled document.
 */
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

/** A URL no request ever leaves the browser for — the route below answers it. */
const ORIGIN = "http://forge.test/";

/**
 * Put the page on a real origin before any markup lands.
 *
 * `page.setContent()` alone leaves the document on `about:blank`, whose origin is **opaque**, and
 * reading `localStorage` on an opaque origin throws `SecurityError` rather than returning null. No
 * real page behaves that way, so a controller that stores anything — the theme scope does — could
 * not run at all under the harness while working perfectly in production. One intercepted request
 * buys the storage the same semantics a served page has; `setContent` then replaces the document
 * without changing the origin.
 */
async function givePageAnOrigin(page: Page): Promise<void> {
  if (page.url().startsWith(ORIGIN)) return;
  await page.route(`${ORIGIN}**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(ORIGIN);
}
