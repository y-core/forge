import { defineConfig, devices } from "@playwright/test";

/**
 * The browser set — real Chromium, one verb of its own (`bun run test:browser`).
 *
 * It sits outside `bun run check` because a browser binary is a *prerequisite*
 * (`bun run test:install`), which is the only legitimate reason a set stands outside the gate.
 * Cost is never one.
 *
 * `bun test` is deliberately untouched by this set: the two never share a process, so no global is
 * ever redefined and forge's Cloudflare `Request`/`Response`/`fetch` semantics stay exactly as the
 * runtime ships them. File discovery cannot collide either — `bun test` matches `*.test.*` /
 * `*_test.*` / `*.spec.*` / `*_spec.*`, none of which is `*.browser.ts`.
 *
 * There is **no `webServer`**: specs bundle the module under test with esbuild and inject it into
 * `page.setContent()` markup (`src/ui/client/browser-test-helper.ts`). forge has no dev server and
 * needs none.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "src/**/*.browser.ts",
  fullyParallel: true,
  reporter: "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
