---
title: The Fleet's Shared Playwright Pieces
description: "Reads the devctl Playwright servers off the environment and builds the Chromium, Firefox, WebKit and workerd projects the gate's rows select."
audience: consumer
---

# `@y-core/forge/tooling/playwright`

Every forge app's `playwright.config.ts` reads the same servers off the same variables, declares the same Chromium, Firefox, WebKit and workerd
projects, and tells a workerd-only run apart by its argv. This subpath holds those pieces, so the project names stay the ones `browserStep`,
`crossEngineStep` and `workerdStep` pass to `--project`. What is the app's own stays in its config: the `webServer`, setup projects, timeouts,
viewport and reporters.

```ts
import { defineConfig } from "@playwright/test";
import {
  chromiumProject,
  crossEngineProjects,
  playwrightServers,
  runsOnlyWorkerd,
  workerdProject,
} from "@y-core/forge/tooling/playwright";

const { maxClients, compat } = playwrightServers(process.env);
const SITE_USE = { baseURL: "https://127.0.0.1:8788", ignoreHTTPSErrors: true };
const BROWSER_SET = { testDir: "tests/browser", testMatch: "**/*.browser.ts" };

export default defineConfig({
  // A worker past the server's client limit queues at connect rather than running.
  workers: maxClients,
  projects: [
    chromiumProject(SITE_USE, BROWSER_SET),
    ...crossEngineProjects(compat, SITE_USE, BROWSER_SET),
    workerdProject(),
  ],
  ...(runsOnlyWorkerd(process.argv) ? {} : { webServer: { command: "bun run dev", port: 8788 } }),
});
```

---

## What each piece does

**`playwrightServers(env)` throws when `PW_TEST_CONNECT_WS_ENDPOINT` is unset or empty, and when `PLAYWRIGHT_SERVER_MAX_CLIENTS` is not a
positive integer.** It returns that limit as `maxClients`, and `compat`: the connection to `PLAYWRIGHT_COMPAT_WS_ENDPOINT`, carrying
`PW_TEST_CONNECT_EXPOSE_NETWORK` and `PW_TEST_CONNECT_HEADERS`, or `undefined` when the compat server is not named. A project's `connectOptions`
replaces Playwright's own connection whole, which is why the compat connection restates both. An app whose specs share one dev server passes
`workers: 1` itself instead of `maxClients`.

**`chromiumProject(use, fields)`** is `Desktop Chrome` with `channel: "chromium"` — the full browser, never the default headless shell, which
resolves no CSS anchor positioning and answers a pointer leave differently. `use` lands on top of the device; `fields` adds `testDir`, `testMatch`,
`dependencies` and any other project field.

**`crossEngineProjects(compat, use, fields)`** is Firefox and WebKit on the compat connection, or `[]` when `compat` is `undefined`. The
connection is set last, so a `use` cannot point either engine back at the primary server.

**`workerdProject(fields)`** runs `tests/workerd/**/*.workerd.ts` one spec at a time, since each serves its own Worker.

**`runsOnlyWorkerd(argv)`** holds when every `--project` named — as `--project=workerd` or `--project workerd` — is `workerd`. `webServer` is
config-level in Playwright, so this is how a config skips a dev server that run has no use for.

---

## Gotchas

**It is imported as a prebuilt `config.node.mjs`.** Playwright transpiles TypeScript only outside `node_modules`, so the `import` condition names
the bundle `bun run gen:bundles` writes, and the `types` condition names the source. `@playwright/test` stays external — the app's own install is
the one the projects are built from.
