# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [0.0.75] — 2026-08-01

The client halves the Base UI refactor was missing. Four components that stamped a styling hook and
had nothing to update it now have controllers; `data-popup-open` gets its first producer; scope
discovery learns to see into shadow roots; the compound button bases are unified on one exported
`cva`; and a popover can finally be placed at a coordinate rather than against an invoker. Contains a
**breaking change** to the toolbar's class strings — see below.

### ⚠️ Breaking Changes

1. **`Toolbar.Button` and `Toolbar.Link` render `core/Button`'s classes, not the toolbar's own.**
   `core/toolbar.tsx` declared a private `ITEM_BASE`; it is gone, and both items now resolve through
   the newly-exported `buttonVariants` at `variant="ghost"`, `size="sm"` by default. This is a real
   visual change, not a reshuffle.

   ```
   before: inline-flex items-center justify-center gap-2 rounded-md px-2 py-1 text-sm text-foreground
           outline-none cursor-pointer hover:bg-accent hover:text-accent-foreground
           focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50

   after:  inline-flex items-center justify-center rounded-lg font-medium transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
           disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm
   ```

   Concretely: `rounded-md` → `rounded-lg`, `px-2 py-1` → `h-8 px-3`, `gap-2` and `cursor-pointer`
   dropped, `font-medium` and `transition-colors` added, and hover no longer sets
   `text-accent-foreground`. Migration: a stylesheet or test pinning the old string updates to the
   new one; a caller that wants the old geometry passes `size` and a `class` rather than relying on
   the default. `chrome/Toolbar`'s **rail separators** also change shape, from `w-6 h-px` /
   `h-6 w-px` to `Toolbar.Separator`'s own `h-px w-full` / `h-5 w-px`, with only the margins left as
   a caller class.

   **No `tailwind-merge`, now or later.** It resolves conflicts between class *strings*; conflicts
   between CSS *layers* are invisible to it. It would add a runtime dependency and a per-render cost
   on a Workers SSR path and fix nothing.

2. **`Popover.Content` no longer emits `data-closed` at render.** It emitted a hardcoded
   `open: false` that was never updated — a lie from first render that stayed wrong for the whole
   time the popover was open. The new eager `popover` scope reconciles `data-open` / `data-closed`
   from the element's own `:popover-open`, so the pair is correct at every instant instead of at
   none. Migration: nothing, if you run the `ui/core/client` side-effect import. Without it, markup
   that used to carry a (wrong) `data-closed` now carries neither attribute — which is the honest
   answer for a page with no client half.

### Added

- **`openPopoverAt(el, x, y, options?)`** in `ui/client` — opens a native popover at a viewport
  coordinate, clamped on screen. For the one case CSS Anchor Positioning cannot serve: a **context
  menu has no invoker**, so every anchored rule resolves to nothing and the UA's `[popover]` default
  centres the panel. Coordinates travel as `--anchor-x` / `--anchor-y` written through **CSSOM**,
  never a generated `style` attribute — forge's CSP carries no `style-src 'unsafe-inline'`. Opt in
  with `Menu.Popup`'s new **`coords`** prop, or the `data-coords` attribute directly.
- **`mountPopupTriggerState(popup)`** in `ui/client` — the first producer of `data-popup-open`, the
  trigger's own state while its popup is open. CSS has no selector that walks from a popup to its
  trigger, so "the button that stays lit while its flyout is up" was previously inexpressible.
  Triggers are resolved document-wide via `commandfor` and filtered on the command *verb*, so a
  `Menu.Item` or `Dialog.Close` naming the same target is not mistaken for one.
- **`buttonVariants`** is exported from `ui/core`, with a new **`square`** size
  (`w-full aspect-square p-0`). `icon` and `icon-sm` name a size in pixels; `square` names a
  *relationship* — take the parent's width, be as tall as you are wide — which is the only form an
  app whose icon rail is a design token can consume without overriding the class it just asked for.
- **`Toolbar.Button` and `Toolbar.Link` take `variant`, `size`, `pressed` and `asChild`.** `pressed`
  emits `aria-pressed`, `data-pressed` **and** `ACTIVE_COMPOSITE_ITEM` together — never one without
  the others — so the rail's boot tab stop lands on the active tool rather than on whichever item is
  first. `asChild` is `core/Button`'s exact contract, extracted and shared: exactly one JSX element
  child, or it throws.
- **`DIALOG_SCOPE`, `POPOVER_SCOPE`** (new `contracts/overlay-contract.ts`), **`ACCORDION_SCOPE`** and
  **`ToggleAction`** (`contracts/toggle-contract.ts`), and **`POPOVER_COORDS_ATTR`** /
  `ANCHOR_X_PROPERTY` / `ANCHOR_Y_PROPERTY`, all from `ui/contracts`.
- `ACTIVE_COMPOSITE_ITEM` is now also exported from **`ui/contracts`**. It is unchanged in
  `ui/client`; the declaration simply moved to where an SSR component can reach it.

### Fixed

- **`resume()` could not find an eager scope inside a shadow root.** Discovery used a flat
  `querySelectorAll`, which does not cross a shadow boundary, so a scope rendered inside a web
  component was never *visited*: its `setup` never ran, and nothing warned. That is most of what the
  UI refactor added — `toolbar`, `menu`, `tabs`, `tooltip`, `collapsible`, `number-field`, `theme`
  and `navbar` are all eager. A `core/Menu` inside a web component rendered, opened and
  light-dismissed (all platform) with **no arrow navigation, no typeahead and no focus restoration**
  (all forge). The eager pass now walks the tree and descends into every open `shadowRoot`; a closed
  root is stepped over. `resume(within)` additionally accepts a `ShadowRoot`, so a web component can
  resume only its own subtree.
- **`Dialog`, `Popover` and `Accordion.Item` had no client half at all.** Each stamped state at
  render and then never moved: `Dialog` froze at its `open` prop, `Popover.Content` was hardcoded
  wrong, and `Accordion.Item` emitted **no** `data-open` / `data-closed` ever, so a stylesheet keyed
  on the pair matched nothing at any point in the component's life. All three now stamp a scope and
  mount `mountTransitionState`, which publishes from the element's own state and never decides it.
- **`Toggle` was a button that announced its own behaviour and had none.** It stamped
  `TOGGLE_SCOPE` but no `data-on-click`, and a lazy scope resumes only on a `data-on-*` interaction —
  so nothing could ever resume it and the eager pass skipped it too. The component now emits the
  action itself instead of leaving it to the caller.
- **`chrome/Toolbar` stopped hand-rolling the primitives it sits next to.** A fourth button base
  (`TRIGGER_CLS`), a separator with a different class set from `Toolbar.Separator`, and two
  hand-stamped `TOOLBAR_ITEM_ATTR`s are all deleted in favour of `core/Toolbar`. The rail keeps its
  own `<nav>` root, because the flyout's `data-placement` anchoring is CSS the generic `Popover`
  cannot express.

### Internal / Tooling

- `ACTIVE_COMPOSITE_ITEM` moved from `client/composite.ts` to a new
  `contracts/composite-contract.ts`. It had **zero producers** despite being documented, and the
  reason was structural: an SSR component cannot import a module that names `document`.
- `core/utils/as-child.ts` holds the one `asChild` model, called by `Button`, `Toolbar.Button` and
  `Toolbar.Link` rather than reimplemented per compound.
- `core/toolbar.test.tsx` is new — `core/Toolbar`'s SSR markup previously had no unit coverage at all.
- The `data-*` conformance guard gained `data-coords` as a declared **structural** attribute: it
  names a placement *mode*, sibling to `data-placement`, not to `data-side`.
- Test counts: `bun test` 1931 → **1947** across 168 files; `bun run test:browser` 260 → **290**.

## [0.0.74] — 2026-08-01

Two structural changes to `@y-core/forge/ui`, cut early because they unblocked a consumer: the DOM
contract becomes an addressable namespace of its own, and forge's stylesheets become importable at
all. Contains a **breaking change** to the cascade position of every component rule — see below.

### ⚠️ Breaking Changes

1. **`theme-base.css`'s component rules are now inside `@layer components`.** They were unlayered,
   and unlayered CSS outranks *all* layered CSS whatever the selector weight — so those rules beat
   every Tailwind utility unconditionally, including the ones forge's own components set on the very
   elements they select. A `max-w-sm` on a `<dialog>` read as an override and never was one. Layering
   puts a component default where a caller's utility can win, which is the relationship a default is
   supposed to have.

   Migration: a rule of your own that used to beat a forge component rule by being unlayered still
   does. A forge rule you were **relying on to beat your own utility** now loses to it — raise your
   own specificity, or move your rule out of a layer. The `:root`, `.dark` and `@theme inline` blocks
   deliberately stay unlayered: a custom-property declaration is not a cascade participant in this
   sense, and `@theme` is a Tailwind at-rule that must be seen at the top level.

### Added

- **`@y-core/forge/ui/contracts`** — a subpath of its own for the DOM contract both tiers share:
  `STATE_ATTRS`, `stateAttrs`, `applyStateAttrs`, `SCOPE_EVENTS`, and the scope-name and selector
  constants each keyboard primitive shares between its SSR and its client half. A consuming app has
  to *address* this DOM; without an export its only option was to re-type every name as a string
  literal, becoming a third writer of the same attribute in a repository forge's gate cannot see.
  The eight contract modules moved from `src/ui/*` into `src/ui/contracts/`.
- **`@y-core/forge/ui/assets/css/*.css`** — the stylesheets are addressable, via a subpath
  **pattern** so every real file in the directory is reachable rather than merely declared.
  **`forge.css`** is the one import an app needs (tokens *and* generated rules); **`forge-show.css`**
  covers the showcase.
- **`@source` paths in `forge.css`, resolved relative to itself.** Tailwind v4's automatic content
  scan **ignores `node_modules`**, so without them none of forge's classes were ever generated: the
  markup rendered and every class on it had no rule. A consumer build produced **2** utilities from
  forge's components before this; it produces **302** after. Relative-to-itself is the only form that
  survives pnpm, a workspace, a git dependency and a monorepo alike.

### Removed

- **`data-anchor-hidden`.** It was declared in `STATE_ATTRS` and in the doc table and written by
  **nothing** — no component, no controller. A declared hook that is never emitted is as misleading
  as a hook that drifted: a consumer styles against it and gets a rule that can never match. Removed
  while the table was still new, because after publication a deletion is a breaking change.

### Internal / Tooling

- **`validate-exports` expands subpath patterns from disk.** A literal key proves a subpath was
  *declared*; an expanded pattern proves each real file is *reachable*. The absence of that second
  check is what let forge ship 73 versions of unaddressable stylesheets.
- `validate-docs` and `NAMESPACE_DESIGN.md` §3a updated for the new namespace.

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

[0.0.75]: https://github.com/y-core/forge/compare/v0.0.74...v0.0.75
[0.0.74]: https://github.com/y-core/forge/compare/v0.0.73...v0.0.74
[0.0.73]: https://github.com/y-core/forge/compare/v0.0.68...v0.0.73
[0.0.68]: https://github.com/y-core/forge/compare/v0.0.67...v0.0.68
[0.0.67]: https://github.com/y-core/forge/compare/v0.0.66...v0.0.67
[0.0.66]: https://github.com/y-core/forge/compare/v0.0.65...v0.0.66
