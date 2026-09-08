import { defineConfig, devices } from "@playwright/test";

import { resolveChromiumPath } from "./src/tooling/gate/chromium.mjs";

/**
 * The browser set — real Chromium, one verb of its own (`bun run test:browser`).
 *
 * The gate runs it as the full-only `test:browser` row, because a browser binary is a
 * *prerequisite* — the only legitimate reason to hold a step back. Cost is never one. The workspace
 * image supplies the browser and `CHROME_PATH` names it; nothing downloads one.
 *
 * `bun test` is deliberately untouched by this set: the two never share a process, so no global is
 * ever redefined and forge's Cloudflare `Request`/`Response`/`fetch` semantics stay exactly as the
 * runtime ships them. File discovery cannot collide either — `bun test` matches `*.test.*` /
 * `*_test.*` / `*.spec.*` / `*_spec.*`, none of which is `*.browser.ts`.
 *
 * There is **no `webServer`**: specs bundle the module under test with esbuild and inject it into
 * `page.setContent()` markup (`src/ui/client/browser-test-helper.ts`). forge has no dev server and
 * needs none.
 *
 * `executablePath` is not a preference: playwright reads no environment variable for the browser
 * path, so a container that bakes Chromium in is invisible to it without this line and every spec
 * fails inside `browserType.launch()` rather than in the code under test.
 * `src/tooling/gate/checks/chromium.ts` owns that resolution, because the gate's prerequisite probe must answer
 * from the same rule. The import is the committed `chromium.mjs` bundle of it, not the source: this
 * config loads under node, which refuses to strip types under `node_modules`, and forge loading the
 * exact module a consumer loads is what makes a broken bundle fail here rather than there.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "src/**/*.browser.ts",
  fullyParallel: true,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: resolveChromiumPath() } } }],
});
