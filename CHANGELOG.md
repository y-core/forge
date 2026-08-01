# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [0.0.73] — 2026-08-01

The Base UI refactor of `@y-core/forge/ui`. Eleven new SSR primitives, seven new client controllers,
and a real composite-widget layer — one tab stop per widget, arrow keys, typeahead, RTL, focus
restoration — so a segmented control or a toolbar is a **primitive** rather than styled initial
markup. A second test runner drives real Chromium. Contains **breaking changes** to `ToggleGroup`,
`Switch` and `Navbar`'s in-menu markup — see below.

Base UI was read as an implementation specification: its DOM contracts, accessibility behaviour and
testing discipline. None of its React architecture came with it — no contexts, no hooks, no render
props, no portals, and above all **no JavaScript re-creation of native `dialog`, `popover`,
`details` or `select`**. Every overlay here is the platform's.

### ⚠️ Breaking Changes

1. **`ToggleGroup` no longer emits `role="toolbar"`.** It emitted that for *every* group, which
   announced a segmented control as a toolbar and offered assistive technology the wrong interaction
   model. It now emits **no `role`** — a `<fieldset>` already has an implicit `group` — and
   `aria-orientation` went with it, since ARIA does not define that for `group`. A widget that really
   is a toolbar uses the new `Toolbar`, which brings the keyboard behaviour the role promises.

   ```tsx
   // before — announced as a toolbar, with no keyboard behaviour to match
   <ToggleGroup>…</ToggleGroup>
   // after — a group, and it says which kind
   <ToggleGroup type='single'>…</ToggleGroup>
   ```

   Migration: add `type="single"` (default) or `type="multiple"`. If the widget genuinely is a
   toolbar, use `Toolbar` instead. A stylesheet matching `[data-slot='toggle-group'][role='toolbar']`
   or `[aria-orientation]` on a group must move to `[data-orientation]`.

2. **`Switch` renames `data-orientation` to `data-label-position`** (values `before` / `after`). The
   old attribute conflated two different things: a switch's own axis, which is always horizontal, and
   where its label sits. It now emits both honestly — `data-orientation="horizontal"` per the shared
   state-attribute table, and `data-label-position` for the label. Migration: a stylesheet matching
   `[data-slot='switch'][data-orientation='label-before']` becomes
   `[data-slot='switch'][data-label-position='before']`. The `orientation` **prop** is unchanged.

3. **`Navbar`'s in-menu leaves are `Menu.LinkItem`, not `data-slot="navbar-link"`.** A link *on the
   bar* still renders `<a data-slot="navbar-link">`; a link *inside a dropdown* is now
   `<a role="menuitem" data-slot="menu-link-item">`, because a row in a `role="menu"` has to be a
   menu item. Nested dropdown triggers likewise become `data-slot="menu-submenu-trigger"`, and the
   `<div data-slot="popover">` wrapper around a nested submenu is gone — a wrapping element inside a
   `role="menu"` breaks its content model. Migration: a stylesheet or test selecting
   `[data-slot='navbar-link']` inside a dropdown selects `[data-slot='menu-link-item']` instead.
   `NavDefinition` and all nine exported `Navbar` types are unchanged.

4. **`ThemeToggle` no longer carries `aria-label="Toggle theme"`.** A static label never told anyone
   which theme was active. The accessible name now comes from an `sr-only` span inside each of the
   three `theme-*-icon` spans, so it tracks the theme by the same CSS that switches the glyph — with
   no JavaScript, and correct at first paint. Migration: a test asserting that `aria-label` asserts
   the accessible name instead.

### Added

- **Eleven `ui/core` primitives.** `Toolbar`, `Menu`, `Tabs`, `Toggle`, `Collapsible`, `Tooltip`,
  `CheckboxGroup`, `RadioGroup`, `Meter`, `NumberField`, `ScrollArea` — all exported from
  `@y-core/forge/ui/core`, all with a `ui/show` section.
  - `Menu` is built on the Popover and Invoker Commands APIs: opening, closing, light-dismiss and
    Escape involve **no JavaScript at all**. Its items are identified by ARIA role, so a row built in
    the browser is navigable the moment it is a correctly-roled menu item. `Menu.LinkItem` is a real
    `<a>` for rows that navigate; `Menu.SubmenuTrigger` is the roled trigger a nested popup needs.
  - `Collapsible` and `Accordion` are native `<details>`; `Tooltip` is `popover="hint"`, so it does
    not dismiss the menu beneath it; `Meter` is a native `<meter>`, distinct from `Progress`.
- **Seven client controllers**, all `@public`, all returning a disposer:
  `mountRovingFocus`, `mountTransitionState`, `mountMenu`, `mountTabs`, `mountTooltip`,
  `mountNumberField`, and the owner-document utilities (`ownerDocument`, `ownerWindow`,
  `activeElement`, `eventTarget`, `asElement`, `closestAcross`, `contains`).
  - `mountRovingFocus` is the composite controller: one tab stop, arrow keys, Home/End, typeahead,
    RTL, disabled-item skip and focus restoration, as **one function over a DOM subtree**. Items are
    resolved live on every interaction, so a widget whose rows are rebuilt between openings needs no
    re-mounting.
- **`ToggleGroup` gains `type`** (`"single" | "multiple"`, published as `data-multiple`), and
  **`bindGroup` now reconciles pressed state across the whole group** — writing `aria-pressed` and
  `data-pressed` on every item, not just the signal. That reconciliation used to be documented as
  "stays app-side", which is why a segmented control was styled markup rather than a primitive.
- **`data-pressed` and the shared state-attribute table.** Fourteen styling hooks — `data-open` /
  `data-closed` / `data-pressed` / `data-checked` / `data-selected` / `data-disabled` /
  `data-invalid` / `data-orientation` / `data-side` / `data-align` / `data-starting-style` /
  `data-ending-style` / `data-popup-open` / `data-anchor-hidden` — declared once for both tiers, so
  the SSR component and the browser controller cannot drift. Boolean states are emitted **by
  presence** (`data-open=""`), never `"true"`.
- **A browser test set behind its own verb**, `bun run test:browser` (`bun run browser:install`
  first). A `*.browser.ts` file runs in real Chromium; `bun test` is untouched, and the two never
  share a process. **260 cases**, including a cross-cutting corpus for the scenarios no single
  component owns: nested overlays, a trigger removed while its popup is open, a widget in a form
  across submit and reset, a widget inside a shadow root, focus restoration across unmount, and RTL.
- **`ui/show` is the complete demo estate**, and it is now checked rather than asserted: a test reads
  the published `ui/core` surface and requires a catalog section for every component. Nine sections
  were missing and were added.

### Changed

- **`@y-core/forge/ui/chrome/client` now side-effect-imports `@y-core/forge/ui/core/client`.** Chrome
  markup names the `menu` and `toolbar` scopes, and a component whose markup names a scope must
  guarantee the scope exists. Without it, an app importing only the chrome island got `resume()`
  warnings and a navbar and toolbar that were dead to the keyboard. Importing both remains harmless.
- **`chrome/Toolbar` adopts the toolbar contracts.** The rail emits `role="toolbar"`,
  `data-scope="toolbar"` and `data-orientation` / `aria-orientation` (`vertical` for a left or right
  rail), every action and popover trigger carries `data-toolbar-item`, and separators are
  `<hr aria-orientation>`. The whole rail is now **one tab stop** with arrow-key navigation. All
  eleven exported types are unchanged, and the flyout markup is untouched — its CSS anchoring cannot
  be expressed through the generic `Popover`.
- **`chrome/Navbar` composes `core/Menu`.** Its dropdowns get arrow navigation, typeahead and focus
  restoration, and their `data-closed` attribute stops lying — nothing previously mounted transition
  state for them. It deliberately does **not** claim `role="menubar"`: forge has no menubar
  controller, and the role without the behaviour announces a keyboard interface that is not there.
- **Every controller resolves its globals from a node** rather than reaching for `document`,
  `window`, `event.target` or `instanceof HTMLElement`. A widget inside an iframe now installs its
  listeners on its own document, and one inside a web component reports the focused *item* rather
  than the shadow host.

### Fixed

- **The `navbar` scope never ran.** It was registered lazily, and a lazy scope resumes on the first
  `data-on-*` interaction inside it — but the navbar's markup emits none at all (native `<details>`,
  native popovers, plain links). Runtime auth filtering therefore silently did nothing. It is now
  eager, as is every other setup-only scope.
- **`mountRovingFocus` was not nestable.** A parent menu's item ring included its *closed* submenu's
  rows, so arrow navigation walked into a `display: none` subtree and focus went nowhere. Items are
  now filtered to what is actually rendered, which also excludes a `hidden` filtered-out navbar row.
- **Two nested composites both consumed the same key.** `keydown` bubbles from an open submenu to the
  popup containing it, so both controllers moved focus and the inner move was immediately
  overwritten. The outer one now stands down when the event was already handled.
- **`localStorage` on an opaque origin.** The theme scope's storage reads are unchanged, but the test
  harness now serves pages from a real origin, which is what surfaced the two fixes above.

### Removed

- **Every hand-rolled DOM mock.** The stub documents, elements, media queries and storage that stood
  in for a browser in `resume`, `turnstile`, `nav` and `chrome/client` tests are gone, replaced by
  browser specs. Two of the theme cases they replaced were unreachable from a stub at any price: a
  `prefers-color-scheme` the browser actually resolves, and a live media change arriving after
  resume — which is the only reason the scope listens for `change` at all.

---

## [0.0.68] — 2026-07-17

Turnstile refactor: a server-rendered `<Turnstile>` mount point plus a rewritten, resilient
`mountTurnstile()` controller, and a honeypot-default alignment fix. Contains **breaking changes**
for apps that mount Turnstile or rely on the built-in honeypot — see the migration guide below.

### ⚠️ Breaking Changes

1. **`mountTurnstile()` is now arg-less.** The `isDark` argument, the `options` argument, and the
   `TurnstileOptions` type (with its `widgetSelector` / `submitSelector` / `formSelector` /
   `resultSelector` / `onSuccess` options) are removed, as is the submit-button gating. The controller
   now finds the widget and its enclosing `<form>` on its own (`widget.closest("form")`) — nothing to
   configure — reads the theme from `.dark` on `<html>` at render time, and no longer disables the
   submit button (the server `verifyTurnstile` is the single fail-closed enforcement point).

   ```ts
   // before
   mountTurnstile(isDark, { onSuccess: "remove" })
   // after
   mountTurnstile()
   ```

   Migration: call `mountTurnstile()` with no arguments, and render the new `<Turnstile siteKey=… />`
   component inside the form in place of any hand-authored `.cf-turnstile` markup (the controller owns
   rendering, so the auto-render class is intentionally omitted).

2. **`<Form>`'s default honeypot field is now `__surname`** (was `surname`), aligning it with
   `HONEYPOT_FIELD_DEFAULT` and `isHoneypotFilled`'s default — previously the component rendered
   `surname` while the verifier checked `__surname`, so the built-in honeypot never fired. Both sides
   now default to `__surname` and remain overridable: `<Form honeypotField="…">` on the markup and
   `isHoneypotFilled(formData, "…")` on the check. Migration: if you relied on the honeypot, ensure
   both sides use the same field name (the new default requires no action; a custom name must be passed
   to both).

### Added

- **`Turnstile` SSR component** (`@y-core/forge/ui/core`) — a server-rendered `[data-ref='turnstile']`
  mount point carrying `data-sitekey` / `data-size` and a hidden fallback message. Props:
  `{ siteKey: string; size?: "compact" | "flexible" | "normal"; children?: JSXNode }` (`children`
  overrides the default fallback text). Place it inside the `<form>`.
- **Resilient `mountTurnstile()` behavior** — engagement-gated script load (loads once on the first
  `focusin` within the form, never on page load or scroll), token reset after every completed
  submission (success or error, via `htmx:afterRequest`) and on expiry/timeout (fixes spent-token
  `403`-on-retry), a visible fallback message on load/render failure, and no submit-button gating.

### Fixed

- **The built-in honeypot never fired.** `<Form>` rendered its honeypot input as `surname` while
  `isHoneypotFilled` checked `__surname`, so submissions were never rejected. Both sides now default
  to `__surname` (see Breaking Changes) — the honeypot works out of the box.

### Internal

- `mountTurnstile` is now unit-tested against a hand-rolled DOM mock (engagement-gated load, render,
  token reset on `htmx:afterRequest`/expiry, fallback-on-failure, idempotent mount, teardown), and the
  `Turnstile` component has exact-match SSR render tests. Internal `ui/turnstile-contract.ts` holds the
  data-ref/script constants shared by the component and controller (not part of the public surface).

---

## [0.0.67] — 2026-07-17

Project Improvement: testing/DX helpers, API-ergonomics normalization, and dead-code/housekeeping.
Additive test infrastructure, plus a handful of **breaking changes** for apps on `0.0.66` —
see the migration guide below.

### ⚠️ Breaking Changes — migration from 0.0.66

1. **Form verification APIs take an options object only.** The trailing positionals and the
   `number | options` union are gone.

   ```ts
   // before (0.0.66)
   verifyTurnstile(formData, secret, { expectedHostname }, "cf-turnstile-response", remoteIp)
   verifyCsrfToken(keyOrRing, token, path, 3_600_000)
   // after (0.0.67)
   verifyTurnstile(formData, secret, { expectedHostname, tokenField: "cf-turnstile-response", remoteIp })
   verifyCsrfToken(keyOrRing, token, path, { maxAgeMs: 3_600_000 })
   ```
   `csrfProtection` now takes the named, exported `CsrfProtectionOptions` type (same shape).

2. **`Config` is constructed via `createConfig()` — the public constructor is gone.**

   ```ts
   // before
   import { Config } from "@y-core/forge/config"
   const cfg = new Config(map, schema, overrides)
   // after
   import { createConfig } from "@y-core/forge/config"
   const cfg = createConfig(map, schema, overrides)
   ```

3. **`htmlResponse` / `fragmentResponse` now throw if you pass a `content-type` header.**
   Previously it was silently discarded (these helpers always emit `text/html`). Remove any
   `content-type` key from the `headers` argument — passing one is now a thrown `Error`.

4. **`Config.get(env)` caches per-`env` instead of first-env-wins.** Different `env` objects now
   resolve independently — no `reset()` needed between them. Only affects tests that relied on the
   old single-slot cache; production (one stable `env`) is unchanged.

5. **Removed exports (all unused/leaked — no runtime behavior lost):**
   - `@y-core/forge/config`: `applyMapping` (now internal).
   - `@y-core/forge/form`: the `CsrfConfig` / `TurnstileConfig` types (orphaned; the runtime path
     uses the `*Schema` valibot schemas).
   - `@y-core/forge/validation/cli`: the codegen internals `REGISTRY`, `emit`, `stripJsonc`,
     `collectBindings`, `collectVars`, `HEADER`, `DEFAULT_OPTIONS` (now `@internal`; `createGenEnv`/
     `loadOptions`/`readWranglerConfig`/`GenOptions` remain public).
   - `createObjectStore` (R2) no longer accepts a `logger` option — it never emitted logs.

### Added

- **Test doubles & helpers in `@y-core/forge/testing`:** `fakeD1` (programmable in-memory D1
  stub — records `calls`, returns configured rows), `fakeR2` (functional in-memory R2 bucket),
  `render` (SSR render-to-string), `mapHandler` (single-route registrar), and `buildRequest(path, opts?)`
  (kills `new Request("http://test/…", {…})` boilerplate). `fakeKV.list` now supports **cursor
  pagination** (`list_complete:false` + `cursor`).
- **`CsrfProtectionOptions`** (`@y-core/forge/form`) and **`SignedCookieOptions`**
  (`@y-core/forge/session`) are now exported named types.
- TSDoc + `@public` tags added to ~20 previously-undocumented exports (heaviest in `security` and
  `config`).

### Changed

- `Forge.map` is now fully typed — the internal `any` cast and `void`-return erasure are gone; the
  router's real signature flows through.
- Logging: `flush()`'s best-effort contract is documented (writes evicted by the pending-cap are
  fire-and-forget); the KV purge window is a named `PURGE_LIST_LIMIT`.

### Internal

- The full test suite's HTML assertions were migrated from substring `toContain` to exact-match
  (catches extra/injected attributes); new coverage for the assets build pipeline (`css`/`fonts`/
  `icons`/`copy`/`state`), `context/pending-headers`, the app error-boundary/HEAD paths, the theme
  FOUC script, and a `http/headers` facade-contract test.
- `validation/cli/cf-env-gen.ts` split into a data module (`cf-env-registry.ts`) + codegen module;
  assets-CLI config plumbing deduped.

---

## [0.0.66] — 2026-07-17

Project Improvement: catalog integrity, namespace layering, a unified
error model, security hardening, and UI component API consistency. This release contains
**breaking changes** for apps on `0.0.65` — see the migration guide below.

### ⚠️ Breaking Changes — migration from 0.0.65

1. **Error model unified — `ValidationResult` failure field renamed `errors` → `error`.**
   `ValidationResult<T>` is now a domain alias of the one `Result` primitive
   (`Result<T, readonly string[]>`), so its failure channel is `error`, not `errors`.
   This affects every consumer `validate` hook and any code reading it.

   ```ts
   // before (0.0.65)
   validate: (data) => data.email ? { ok: true, data } : { ok: false, errors: ["email required"] }
   // after (0.0.66)
   validate: (data) => data.email ? { ok: true, data } : { ok: false, error: ["email required"] }
   ```
   `onValidationError(errors, c)` still receives the message array — only the union field moved.

2. **`@y-core/forge/render` removed — import renderer from `@y-core/forge/jsx`.**
   The redundant `./render` subpath is gone; its symbols are (and were already) exported by `./jsx`.

   ```ts
   // before
   import { renderPage, renderToString, type FC } from "@y-core/forge/render"
   // after
   import { renderPage, renderToString, type FC } from "@y-core/forge/jsx"
   ```

3. **`csrfProtection` — `subject` is now required.**
   Pass a session/subject resolver, or the explicit greppable `subject: false` opt-out
   (path-only tokens). Omitting `subject` is now a compile error. Closes a token-fixation
   risk where a token bound only to a path was transferable between users.

   ```ts
   // before
   csrfProtection({ secret })
   // after — bind to the session…
   csrfProtection({ secret, subject: (c) => c.session?.id })
   // …or explicitly opt out
   csrfProtection({ secret, subject: false })
   ```

4. **Cloudflare header trust is now default-**distrust** (`trustCfHeaders`).**
   `requestId` no longer echoes client-supplied `CF-Ray`, and `rateLimit`'s default key no
   longer reads `CF-Connecting-IP`, unless you opt in. On Cloudflare Workers these headers
   are trustworthy, so **CF-deployed apps must opt in**:

   ```ts
   requestId({ trustCfHeaders: true })
   rateLimit({ limiter, trustCfHeaders: true })   // else the default key throws — or pass your own `key`
   applyMiddlewareChain(app, { ...opts, trustCfHeaders: true })  // threads to both
   ```
   Off Cloudflare (the unsafe case), leave it off: `requestId()` mints a fresh UUID and
   `rateLimit` requires an explicit `key`.

5. **Log viewer is now secure-by-construction — `loadLogViewer` returns a `Response`.**
   The render components (`LogViewerContent`, `LogTable`, `LogDetailCell`, …) and the
   `renderLogFragment`/`renderLogDetailFragment` helpers are now internal — rendering log
   records is only possible through the auth-gated loader. `LogViewerOptions` gained a
   required `icon`. Mount it as a single loader:

   ```ts
   // before: loader returned data, your view rendered LogViewerContent / renderLogFragment
   // after:
   export const logsPage = definePage({
     loader: (c) => loadLogViewer(c, { channel, access, icon: chevronDownIcon }),
     view: (_c, _cfg, s) => s.data, // loader returns a Response and short-circuits
   })
   ```

6. **JSX `style` prop removed from the attribute types.**
   Inline `style` was already silently dropped at render (CSP `style-src 'self'`); it is now a
   compile error so the type matches runtime. Move inline styles to CSS classes.

7. **Guard-result types carry the reason code in `.error` (was `.reason`); `CopResult` → `CrossOriginResult`.**
   `CsrfResult`, `TurnstileResult`, `OriginResult`, and `CrossOriginResult` are now
   `GuardResult` aliases. Most callers only branch on `.ok` (unaffected); if you read the
   failure code, use `.error`. The internal `CopResult` type was renamed `CrossOriginResult`.

8. **KV log persistence no longer stores error stacks by default.**
   `kvLogChannel` strips `stack` from persisted records (7-day KV retention) unless you opt in
   with `persistStack: true`. `consoleChannel` is unchanged (stacks kept for local debugging).
   Wrap any channel with the new `withRedaction(channel, fn)` for custom PII redaction.

Minor: `htmlResponse` now always emits `content-type: text/html; charset=utf-8` (previously
uppercase `UTF-8` when called without a `headers` argument) — only matters if you assert exact
header casing.

### Added

- **`ok()` / `err()` result constructors and the `GuardResult<R>` type** (`@y-core/forge/result`) —
  build result values without ad-hoc object literals; `GuardResult<R> = Result<void, R>` for
  predicate/authorization checks.
- **Bound `Input` and `Textarea`** in `@y-core/forge/ui/controls` (fills the form-field gap
  alongside `Select`/`Slider`/`Switch`/`ToggleGroup`).
- **`cn` / `asClass` / `cva`** ratified as public utilities on `@y-core/forge/ui/core`.
- **Universal DOM attribute pass-through** — all `ui/core` components (`card`, `alert`, `toast`,
  `accordion`, `popover`, `badge`, `spinner`, `separator`, `skeleton`, …) now forward
  `id`/`data-*`/`aria-*`/event attributes; no more re-wrapping to attach `hx-*`/`data-*`.
- **`withRedaction(channel, fn)`** log-channel wrapper and **`persistStack`** option
  (`@y-core/forge/logging`).
- **`trustCfHeaders`** options on `requestId`, `rateLimit`, and `applyMiddlewareChain`.
- **Icon `role="img"`** emitted automatically when `aria-label` is present.
- `validateBindings` / `validateEnv` / `ConfigKey` are now also importable from
  `@y-core/forge/context` (the canonical home); the `@y-core/forge/app` re-exports still work.
- Client `resume()` now `console.warn`s when it encounters a `data-scope` with no registered
  scope (catches a forgotten `import "@y-core/forge/ui/core/client"`).

### Changed

- **Origin-guard tiering:** `originProtection` (recommended combined default) now exempts safe
  methods before the Sec-Fetch-Site check, aligning with `originGuard`; `crossOriginProtection`
  (Sec-Fetch-Site only) and `originGuard` (Origin/Referer only) documented as the lower tiers.
- **JSX renderer:** attribute *names* are now validated (unsafe keys from spreads are skipped);
  enumerated attributes (`draggable`/`spellcheck`/`contenteditable`) emit `="true"`/`="false"`
  instead of a bare name.
- `Button asChild` still throws on a non-element child (ratified as a programming-error
  invariant) — the error message is now more actionable.
- `serveObject` (R2) now catches async backend failures and returns a `500` Response instead of
  leaking an unhandled rejection.
- `ScopeDefinition.on` is now optional (setup-only client scopes no longer write `on: {}`).
- `chrome/client`'s `isDark` is a stable accessor (was a reassigned exported `let`); behavior
  unchanged (reads `false` until resume).

### Fixed

- **Native Invoker Command bridge fired nothing.** `resume()` now listens for `command` in the
  **capture phase** — the platform dispatches `CommandEvent` with `bubbles:false`, so the prior
  bubble-phase delegated listener never saw it and every custom `--action` (button / menu-item
  activation via `commandAttrs`) was dead. Built-in commands (`toggle-popover`, …) are unaffected.
- **Popover panels and toolbar flyouts no longer run off-screen.** `[data-slot="popover-content"]`
  and `[data-slot="toolbar-flyout"]` gain `position-try-fallbacks: flip-block, flip-inline` so an
  anchored panel flips to the opposite side instead of overflowing a viewport edge when its trigger
  sits near the bottom or right of the screen.
- `ui/client/lazy.ts` now `CSS.escape`s interpolated `ref`/`scriptSrc`/`href` in `querySelector`
  strings (a quote no longer breaks the selector).
- `timingSafeEqualBytes` falls back to a constant-time JS comparison when
  `crypto.subtle.timingSafeEqual` is unavailable instead of throwing.
- `htmlResponse` charset casing normalized (see Breaking Changes, minor).

### Internal / Tooling

- **`validate-exports`** now runs reverse passes — every `src/**/mod.ts` must be an export target
  or on a sealed-internal allowlist, and every `files[]` entry must exist on disk — and correctly
  attributes `@public` symbols in single-file export subpaths (e.g. `./ui/chrome/client`).
- Catalog integrity: removed the dead `templates/` `files[]` entry; `crypto` documented as a
  sealed-internal namespace.
- The error-model doctrine, the `result` namespace as a foundational primitive, and the origin
  guard / CF-header trust / `asChild` contracts are ratified across the `.decisions/` docs.
- Duplicated `toError` in `app/forge-app.ts` removed; the shared env-validation throw wrapper
  extracted to `validation/parse-env.ts`.

[0.0.68]: https://github.com/y-core/forge/compare/v0.0.67...HEAD
[0.0.67]: https://github.com/y-core/forge/compare/v0.0.66...v0.0.67
[0.0.66]: https://github.com/y-core/forge/compare/v0.0.65...v0.0.66
