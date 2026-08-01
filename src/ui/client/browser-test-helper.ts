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
}

/**
 * Load `html` into the page and publish the requested modules on `window`.
 *
 * The bundle is injected after the content, matching how a real page loads a deferred client
 * bundle: the markup exists before any controller can see it.
 */
export async function mount(page: Page, html: string, options: MountOptions = {}): Promise<void> {
  await givePageAnOrigin(page);
  await page.setContent(html);
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
