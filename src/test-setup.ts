/**
 * `bun test` preload. **Deliberately inert — it defines no global, and must not start.**
 *
 * forge has two test sets, and the division between them is the reason this file stays empty:
 *
 * - **`bun run check` → `bun test`.** Runs everywhere, needs nothing installed, and executes in a
 *   pristine Bun realm. That realm *is* the assertion for most of this library: forge is a
 *   Cloudflare Workers framework, so `Request`, `Response`, `Headers`, `FormData` and `fetch` are
 *   the product, not scaffolding. A DOM registrator preloaded here would redefine 582 globals and
 *   shadow eleven of those natives, which is why one is not. This set proves **markup and pure
 *   logic**: an SSR component by its exact HTML string (entities and all), a parser by its output.
 *
 * - **`bun run test:browser` → `playwright test`** over the `*.browser.ts` files under `src/`. A
 *   separate process driving real Chromium, so it can never disturb the set above. This set proves
 *   **behaviour**: a controller is mounted against the same SSR markup the string tests assert, a
 *   real event is dispatched, and the resulting DOM is the assertion. It stands outside
 *   `bun run check` only because a browser binary is a prerequisite (`bun run browser:install`) —
 *   never because of cost.
 *
 * Neither set substitutes for the other, and a controller is not proven by a string. The two
 * matchers cannot collide: `bun test` collects `*.test.*` / `*_test.*` / `*.spec.*` / `*_spec.*`,
 * and a browser spec is none of those.
 *
 * Harness: `src/ui/client/browser-test-helper.ts`. Placement and conventions: `.decisions/TESTING.md`.
 */
export {};
