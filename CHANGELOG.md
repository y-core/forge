# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **`[Unreleased]` is the only section humans edit.** `bun run release` promotes it into a dated
> version section, with the version and the date computed — never typed. Editing a released
> heading *or its body* by hand is refused by the changelog check: the release records each
> section's digest in `config/changelog-sections.json`, so a later edit no longer matches what
> shipped. Write the change under `[Unreleased]` instead.

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [Unreleased]

_Nothing yet._

---

## [0.6.1] — 2026-10-30

### Breaking Changes

- **`validate-features` is gone, with `featuresStep`, `checkFeatures`, `FeaturesCheckConfig` and the preset's `features` option.** It ran the
  whole `unit` gate once per curated skeleton, and could not pass for an app with `design` set, since the skeleton is not a git work tree. To keep
  the import boundary reading `config/features.ts`, move the flag onto it: `importBoundary: { guarded, features: true }`.
- **The `deploy` tier is gone; its rows start at `release`.** `GATE_TIERS` is `static`, `unit`, `runtime`, `release`, and `--tier deploy` is
  refused. `test:browser`, `validate-dev-bundle` and `validate-changelog` now run at `release`. Delete the `verify:deploy` script, and point a
  tag's CI at `verify:release`.
- **Firefox and WebKit are no longer a gate row at any tier.** `browserSteps`, `isBrowserEngine` and `BrowserEngine` are removed, and
  `browserStep` takes no `projects`: it runs Chromium alone. The preset's `browser` option is a boolean; replace `browser: { engines }` with
  `browser: true`. Run the other engines through a cron table: add `config/cron.ts` default-exporting `[crossEngineStep()]` and a
  `"verify:cron": "forge verify --config config/cron.ts --tier release"` script.

### Added

- **`crossEngineStep()` runs Firefox and WebKit as one row, `test:browser:cross-engine`, behind the `playwright-compat` server.** It defaults to
  `release`, runs whole, and its `report.json` entry lists each failing spec with its engine. It belongs in a table other than `config/steps.ts`.
- **Forge's own `config/cron.ts` and `verify:cron`**, which replace the `test:browser:cross-engine` script. task-forge's cron runs
  `verify:release` and then `verify:cron` on each repository that declares both.
- **A table other than `config/steps.ts` leaves the verify receipt alone.** `forge verify --config config/cron.ts` neither records a green run
  nor clears a standing one, so a red cron run never makes `--reuse` re-run the gate. `GateCommandConfig.receipt: false` does the same for a
  table handed to `createGateCommand`.

---

## [0.6.0] — 2026-10-29

### Breaking Changes

- **The browser set leaves the `runtime` tier: `test:browser` runs from `deploy`.** A bare `verify` runs no browser spec; `verify:deploy` is the
  first tier with Chromium, and the other engines stay at `release`. The whole suite was the gate's slowest row, and narrowing it bought almost
  nothing because its reach was the Worker's whole import graph. A broken page is now caught by a nightly `verify:release` rather than at task
  close. No `config/steps.ts` change is needed: `cloudflareWorkerSteps` and `browserSteps` carry the new tier.
- **`browserStep` and `browserSteps` take no `narrow` or `widen`.** Nothing narrows a row that starts at `deploy`. Delete either option from the
  call.
- **`buildScale` and the `Dials` type are no longer exported from `@y-core/forge/ui/contracts/theme`.** `buildScale` measured unfloored chroma,
  so it disagreed by a byte with the hex a scheme file paints. Read `buildTheme(dials)[family][mode].solid` instead.
- **A mounted `Tabs` leaves an unselected panel `hidden="until-found"` with `tabindex="-1"`, not `hidden=""`**, and find-in-page or a fragment
  link into it selects its tab. A disabled tab's panel is `hidden=""`. `forge-ui.css` no longer sets `display: none` on an `until-found` panel,
  which kept find-in-page from revealing it; the panel is positioned out of flow and its padding, border and margin are zeroed instead, so the
  root's `gap` does not count it. Update a test that expects `hidden=""`.
- **`createFlash` takes `ring: KeyRingResolver<Bindings>` in place of a `KeyRing`**, resolved from each request's context as
  `createAnonymousSession`'s is. Build the flasher once at module scope: `createFlash({ ring: createKeyRingResolver<Env>((c) => …) })`, or pass
  `ring: () => ring` to keep a ring imported elsewhere.
- **`isBareSpecifier` is no longer exported from `@y-core/forge/tooling/gate`.** An `@import` id that starts with neither `.` nor `/`
  names a package; test that inline.
- **`createBoundControl` and `createBoundCompound` are no longer exported from `@y-core/forge/ui/controls`.** They were internal factories; the
  bound controls the barrel exports are the whole API.
- **`applyFormat` from `@y-core/forge/ui/contracts` leaves a value with more characters than the template has slots unchanged**, instead of
  returning its bare characters, and a letter or digit literal typed where the template has a slot, such as the `1` of `+1`, is kept as content.
  A separator is still removed wherever it is typed, so `123-4567` under `####-####` regroups as `1234-567`.
- **`Turnstile` reserves the widget's box on an inner `[data-ref="turnstile-frame"]` element**, so a `class` passed to `Turnstile` no longer sizes
  the reserved box.
- **`FormField` takes no `name`.** It never wired anything. Pass the `name` to `FormField.Label`, `.Description` and `.Error` and to the control's
  `field` descriptor, which derive the `id`, `for` and `aria-describedby`, and delete it from the root.
- **The bound `Input` from `@y-core/forge/ui/controls` no longer accepts `format`.** Passing both is a type error; a bound field's value is its
  signal's.
- **`Carousel` takes no `snap`.** It only stamped a `data-snap` that nothing read, so the slides never moved. Pass `snap` to each `Carousel.Item`
  and delete it from the root.
- **A control's `field` descriptor takes the error message as `error`, and no longer accepts `invalid`.** A non-blank `error` emits `aria-invalid`
  and adds the error id to `aria-describedby`; a blank one (`""`, whitespace only, an empty array) marks nothing, so the control never names a
  `FormField.Error` that rendered nothing. Replace `field={{ name, invalid: Boolean(error) }}` with `field={{ name, error }}`. `FormField`'s own
  `invalid` is unchanged.
- **`CheckboxGroup` and `RadioGroup` take the error message as `error`, and no longer accept `invalid`.** A non-blank `error` stamps `data-invalid`
  and adds the error id to the fieldset's `aria-describedby`; a blank one (`""`, whitespace only, an empty array) marks nothing, so the group never
  names a `.Error` that rendered nothing. Replace `invalid={Boolean(error)}` on the root with `error={error}`. An `.Item`'s own `invalid` is
  unchanged.
- **The chrome `Toolbar` no longer adds an `active` class to an action whose `active` is set.** The item is marked by `aria-pressed` and
  `data-pressed`, which forge now paints. Move any `.active` rule of your own to `[data-pressed]`.
- **`Tooltip`, `Popover` and `Menu` render their roots and panels as `<span>`, and `Menu.GroupLabel` as `<span>`, instead of `<div>`**, so one
  placed inside a `<p>` no longer splits the paragraph. A selector of yours that names the tag, such as `div[data-slot="menu"]`, stops matching;
  key it on `[data-slot]` alone.
- **An `alert` `Dialog` closes on Escape alone, and a backdrop click no longer closes it.** It renders `closedby="closerequest"`, following APG's
  alert dialog.
- **`mountTabs` reads the arrow-key axis from the tablist's `aria-orientation`**, and no longer from the root's `data-orientation`. Hand-written
  `Tabs` markup must set `aria-orientation="vertical"` on the `role="tablist"` element for ArrowUp and ArrowDown to move between vertical tabs.
  Markup that `Tabs` renders already does this.
- **`Menu.Group` renders `<span role="group">` and `Menu.Separator` renders `<span role="separator">`, instead of `<fieldset>` and `<hr>`**, so a
  grouped or separated menu inside a `<p>` no longer splits the paragraph. A selector of yours on `fieldset` or `hr` inside a menu stops
  matching; use `[data-slot~="menu-group"]` or `[data-slot~="menu-separator"]`. `MENU_GROUP_SELECTOR` no longer matches `fieldset`.
  `Menu.Group`'s `disabled` still disables its rows: it sets `aria-disabled` on the group and passes `disabled` to each `Menu.Item`,
  `.CheckboxItem`, `.RadioItem` and `.SubmenuTrigger` that leaves its own unset. A `Menu.LinkItem` is not disabled by its group.
- **`bindAttr` and `bindAttrAttr` refuse `hx-vals`, `hx-headers`, `hx-confirm`, `hx-trigger`, `hx-config` and every `hx-status:*` rule**, in
  the `hx-` and `data-hx-` spellings and with a `:inherited` or `:append` suffix, because htmx evaluates their values as script or swap
  configuration. `bindAttrAttr` throws on one and `bindAttr` warns and
  skips it. Write these attributes in markup, or bind a signal to an attribute htmx does not evaluate.
- **A custom `--command` runs the handler of the scope holding its `commandfor` target**, with `el` still the invoker. Before, the handler was
  looked up from the invoker, so an invoker inside one scope that names an element in another now runs the other scope's handler.
- **`splitLightDark` is no longer exported from `@y-core/forge/tooling/gate`.** Import it from `@y-core/forge/ui/contracts/theme`, beside
  `lightDark`, which is now its only home.
- **`FOUC_SCRIPT` has changed.** A CSP that lists its hash in `script-src` must list the new one; compute it from the exported constant.
- **`Dialog.Trigger`, `Dialog.Close`, `Drawer.Trigger`, `Drawer.Close`, `Popover.Trigger`, `Menu.Trigger` and a bare `Tooltip.Trigger`
  render the `sm` button box**: a control height, padding, a transparent border and the focus ring, where they used to render an unstyled button
  24px tall. Your `class` is merged over it, so your padding still wins while the height holds the 28px Floor. A trigger you styled as a link or
  sized below 28px renders taller; restyle it through `class`.
- **A chrome `Toolbar` flyout is built from `Popover`'s parts, and its `data-side` names the side the panel opens on**, no longer the rail's
  edge: a `left` rail's flyout carries `data-side="right"`. A stylesheet of yours keyed on the old value must swap it for its opposite. The flyout
  root is a `<span>` whose `data-slot` also holds `popover`; the panel's holds `popover-content` and the panel carries `data-scope="popover"` and
  `data-align="start"`; the trigger's holds `popover-trigger`. A selector naming `div[data-slot~="toolbar-popover"]` stops matching; key it on
  `[data-slot]` alone.
- **A `Navbar`'s position classes are on its outermost `<div data-scope="navbar">`**; a `class` passed to `Navbar` no longer changes where it
  sticks.
- **`Toolbar.Input` takes a `size` of `sm`, `md` or `lg`** (default `sm`, matching the toolbar's buttons) in place of the native numeric `size`
  attribute; set a width with `class` instead.
- **A Firefox or WebKit row from `browserSteps` probes `PLAYWRIGHT_COMPAT_WS_ENDPOINT`**, devctl's `playwright-compat` server, instead of
  `PW_TEST_CONNECT_WS_ENDPOINT`, and fails naming it when unset or unreachable. An app listing those engines points its `firefox` and `webkit`
  projects there through `use.connectOptions`, as the `tooling/gate` README shows.
- **`browserStep` refuses `projects` that run on different Playwright servers**, such as `["chromium", "firefox"]`. Give each engine its own row
  with `browserSteps`.
- **`data-state` is a state attribute, not a presentational one.** `STATE_ATTRS.state` and `stateAttrs({ state })` replace
  `PRESENTATION_ATTRS.state` and `presentationAttrs({ state })`, and an empty `state` now emits nothing.
- **`RULE_ENFORCER` in `@y-core/forge/tooling/lint` maps each rule to a list of enforcers** instead of one, and `RuleEnforcer` gains
  `"faded-text"`. `forge-ui-contrast-floor` lists `["contrast", "faded-text"]`. Read `RULE_ENFORCER[id].includes("lint")` where you compared
  `RULE_ENFORCER[id] === "lint"`. Its value type excludes `"gate"`, which only a `MODERN_CSS_RULES` row carries, so routing a corpus rule to
  the gate no longer compiles.
- **An unselected `Tabs.Content` renders `hidden="until-found"` instead of a bare `hidden`.** This shipped in 0.5.15, whose section does not
  record it. With no script, a find-in-page match inside an unselected panel reveals it, in an engine that implements `until-found`. A test of
  server-rendered markup that expects `hidden=""` must expect `hidden="until-found"`, except on a `Tabs.Content` given `disabled`.

### Added

- **`validate-modern-css` warns on geometry keyed on `:popover-open` or `[open]`** (`forge-ui-platform-exit-geometry`). Since 0.5.15 an overlay
  stays painted through its exit fade after the open state ends, so a `width`, `inset`, `padding` or `transform` declared there collapses mid-exit.
  Move it to the base selector and key only `opacity`, `overlay` and `display` on the open state. A property the stylesheet transitions is not
  reported.
- **`forge verify --report <dir>`** writes `report.json` — tier, `HEAD`, tree, start time, duration, verdict, and each step's status, duration
  and log — and every step's whole log into `<dir>`, whatever the verdict. A browser row also lists its failing tests by engine, spec, title and
  first error line, read from Playwright's JSON reporter; a run that never reached a test is `setup` rather than `failed`. The types are
  `GateRunReport`, `StepReport`, `StepStatus`, `TestFailure` and `StepResults` from `@y-core/forge/tooling/gate`.
- **`bun run verify:deploy`** in forge's own scripts, the tier the canon names.
- **`RULE_ENFORCER` routes `forge-ui-hit-target` to a new `"browser"` enforcer**, in `@y-core/forge/tooling/lint`, and `RuleId` and
  `RuleEnforcer` gain the matching members. Forge's browser set now measures every published `ui/core` and `ui/chrome` pointer target against the
  absolute 28px Floor, under both the default shape and `shape-compact.css`.
- **`NavbarAction` and `MenuItemAttrs` types in `@y-core/forge/ui/contracts`**; `menuItemAttrs` returns `MenuItemAttrs`.
- **A sticky top `Navbar` reserves its height as `scroll-padding-top`**; `--forge-navbar-height` sizes the bar and the reserve.
- **`toneSurface` in `@y-core/forge/ui/core`** — `toneVariants`' paint without the hover fill, for a static toned panel.
- **`fadedTextStep`, `checkFadedText` and `fadedText` in `@y-core/forge/tooling/gate`.** The `validate-faded-text` row fails a fade below full
  strength — an `opacity-*` or a text colour's `/alpha` modifier on a class string, or either in a stylesheet's `@apply` — unless a disabled state
  or an audited alpha pair holds it. Its config type is `FadedTextCheckConfig`.
- **`crossEngineTagsStep` and `checkCrossEngineTags` in `@y-core/forge/tooling/gate`.** The `validate-cross-engine-tags` row fails an untagged
  top-level browser spec block that reads an engine-computed value, and `@cross-engine` spelled anywhere but a top-level block's
  `{ tag: "@cross-engine" }`. The parts are exported too: `validateCrossEngineTags` judges one spec, `findCrossEngineUnits` and
  `findEngineReaders` read its blocks and engine reads, `resolveFixtureReaders` follows a `*.fixture.ts` import, and the types are
  `CrossEngineTagsCheckConfig` and `CrossEngineUnit`.
- **`Tabs.Content` takes `disabled`**, rendering `hidden=""` so find-in-page cannot reveal a disabled tab's panel before `mountTabs` runs. Pair it
  with the `disabled` on that panel's `Tabs.Tab`.
- **`findStylesheetComments` in `@y-core/forge/tooling/gate`** returns every block comment in a stylesheet with its opening line.
- **`FILTER_SCOPE`, `OTP_INPUT_SCOPE` and `OTP_LENGTH_ATTR` in `@y-core/forge/ui/contracts`**, the scope names `Filter` and `OtpInput` stamp and
  the attribute carrying an OTP field's length.
- **JSX intrinsic elements type 13 more ARIA 1.2 attributes**, among them `aria-roledescription`, `aria-pressed`, `aria-modal` and `aria-sort`,
  so a value of the wrong type is a compile error instead of passing unchecked.
- **`forge/a11y-state-attrs-source` (`forge-ui-a11y-state-attrs-source`) reports a Tailwind variant that styles from an `aria-*` state
  `STATE_ATTRS` gives a `data-*` hook**, such as `aria-selected:` or `aria-[checked]:`. `MENU_ITEM_CLASS` now reserves the checkable row's gutter
  by role.
- **`Drawer` takes `alert` and `described` and has a `.Description`**, as `Dialog` does.
- **JSX types accept `hidden="until-found"`, and the renderer emits it as written on any element**; `hidden={true}` still renders a bare
  `hidden`. Since 0.5.15, unrecorded there.
- **`BrowserEngine`, `isBrowserEngine` and `StepReach` are exported from `@y-core/forge/tooling/gate`.** Since 0.5.15, unrecorded there.
- **`@y-core/forge/relax` arms an app's own development relaxation.** It publishes `isDevBuildArmed` and `whenArmed`, so a dev module is
  `whenArmed(isDevBuildArmed, relaxed, strict)` and no longer redeclares `__FORGE_DEV__`. It resolves under `forge cf dev` and in Bun, and a Worker
  built without `forge-dev` fails to resolve it. Put an app's relaxations on one `#app/relax` pair (`src/app/relax.dev.ts` /
  `src/app/relax.strict.ts`); see `src/relax/README.md`.

### Changed

- **`@y-core/forge/auth/client` imports `@y-core/forge/ui/core/client`**, so the turnstile scope no longer needs a separate import.
- **`forge-ui-a11y-one-live-region` reports an `<output>` that states neither `aria-live` nor `role`**, since it is an implicit `role="status"`
  live region. Give a readout `aria-live="off"`, or speak through `announce()`. **`forge-ui-a11y-live-politeness` accepts `aria-live="off"`**, which
  it used to report.
- **A contrast pair's foreground may carry an `alpha`.** The contrast check measures it composited over the background, using `compositeOver` from
  `@y-core/forge/tooling/gate`, and reports a translucent background as unresolved.
- **`Carousel` and `Carousel.Item` take their `carousel` and `slide` role descriptions from `LABEL_DEFAULTS`** as `carouselRoleDescription` and
  `carouselSlideRoleDescription`, so a catalogue typed `Record<keyof typeof LABEL_DEFAULTS, string>` needs both keys.
- **`Dock` takes a fixed height per `size`** (3rem, 3.5rem, 4.5rem, plus the safe-area inset) instead of growing with its content, so the page can
  reserve exactly that height.
- **`forge-ui-focus-ring` and the other class rules judge a module-scope `*_CLASS` or `*_CLASSES` string where it is declared**, and follow a
  chain of same-file constants to the class list it names. A class constant that suppresses the outline with no ring is reported even when nothing
  in its own file uses it.
- **Hovering a `Toast` or `Alert` dismiss draws a 1px outline in the glyph's colour.** There is no background tint, so the glyph's contrast is the
  same hovered as at rest.
- **The `Navbar` drawer opens and closes on Drawer's `--forge-motion-enter` / `--forge-motion-exit`**, and fades in place under reduced motion
  instead of snapping.
- **`Navbar` renders `data-side` with its placement on its `<details>`.**
- **`NumberField`'s steppers take a `size` and are as tall as an input of that size**: a default stepper is now 40px rather than 32px.
- **`Toggle` and `Toolbar.Input` use `Button`'s padding scale**: padding follows the size (12/16/24px). A `Toggle` label no longer wraps, and its
  colour changes transition.
- **`Stack`'s back layers no longer fade, and the `Navbar` menu chevron paints at full strength.**
- **The comment budget reports a count with up to three words before its noun**, such as "the four shipped schemes", and a comma after the noun no
  longer counts as the start of an enumeration.
- **`forge-ui-platform-accent-color` in `validate-modern-css` reports an `<input type={…}>` whose binding is typed as `"checkbox"` or `"radio"`**,
  such as a component factory's parameter, so a hand-styled checkable built through one is reported like a literal `type="checkbox"`, and a braced
  string literal such as `type={"checkbox"}`.
- **`schemeCss` emits no header comment beyond its `modern-css-allow` waiver**, the form forge's own scheme files take, so a generated scheme
  passes forge's stylesheet comment budget. The dial values a file was made from travel in the `dialQuery` link instead.
- **The default accent is desaturated.** `theme-neutral.css` declares the accent ramp at chroma 0.115 instead of 0.195, so the default
  `--primary` paints `#4b65ab` in light and `#4861a7` in dark instead of `#375bd7` and `#3457d3`, and the accent chroma dial's fallback is 115.
  To keep the old blue, generate a scheme at `accentChroma` 195 or re-declare `--primary`.
- **`mountTabs` hides every panel its selected tab does not name when it mounts.** A panel that a fragment link or find-in-page revealed before
  the controller ran is hidden again, so the server's selection is what shows. Since 0.5.15, unrecorded there.

### Fixed

- **A `watches` glob whose directory exists but holds no matching file yet no longer fails the gate.** A glob is stale only when its literal
  directory is gone, so a markdown source such as `src` with no `.md` in it passes, and a renamed `docs/` is still refused.
- **`buildTheme`'s `solid` hex is the colour its `oklch()` paints, at every dial.** Each step's chroma is cut toward zero to the places
  `schemeCss` prints rather than rounded, and `solid` is measured from that printed coordinate, so the live readout and swatches no longer differ
  from the pasted file by a byte. A generated chroma figure can print up to 0.0001 lower than before; `theme-neutral.css` is unchanged.
- **A `--forge-navbar-height` under 1.75rem no longer shrinks a `Navbar` below the 28px Floor.** The bar's row, its drawer toggle, the
  panel's clearance and the scroll-padding reserve hold at 1.75rem.
- **Every flash call in one request reaches the next page, including calls made together.** `createFlash` merges them into one `Set-Cookie` in call order, dropping the oldest
  messages past 4096 bytes; before, the browser kept only the last.
- **`Input`'s `format` no longer deletes a digit literal's digit from the value.** With `format='+1 (###) ###-####'`, `4155551212` now groups as
  `+1 (415) 555-1212` instead of `+1 (455) 552-2`.
- **A form control under `Tooltip.Trigger asChild` or `Toolbar.Button asChild` keeps its own `type`.** Switch, Toggle, Slider, Input,
  CheckboxGroup.Item and RadioGroup.Item no longer render `type="button"`.
- **`<Button asChild disabled>` or `loading` onto a link component is inert.** A router `Link` carrying an `href` renders `aria-disabled="true"`
  with no `href`, instead of a live `<a href disabled>`.
- **`Turnstile` recognises a form submitted through `hx-action`.** In submit mode the press is held for the challenge, and the widget resets after
  a submission and clears the form after a 2xx, as it does for a verb attribute.
- **A second reveal of `Turnstile`'s fallback message is announced again**, after a retry or a swap, rather than only the first time.
- **A revealed `Turnstile` fallback no longer overlaps the control below the widget.** The messages render below the widget's frame, outside it.
- **`Filter`'s `×` empties the group even when the server checked a chip, and every chip stays reachable by arrow keys**; the clear needs
  `@y-core/forge/ui/core/client`.
- **`OtpInput` accepts a code pasted with spaces or dashes.** It no longer renders `pattern` or `maxlength`. With `ui/core/client` imported, the
  field keeps the first `length` digits as they are typed or pasted, and without it the code posts as typed for `formDigits()` to reduce.
- **`Field` names the control it wraps.** A `Select`, `Slider`, `Switch` or `Input` carrying an `id` or a `field` is labelled by the caption
  through `aria-labelledby`; before, it had no accessible name.
- **A `CheckboxGroup.Item` or `RadioGroup.Item` whose `value` is `error` or `description` renders no `id`**, rather than one equal to the group's
  error or description id.
- **A vertical `FormField` no longer overrides its children's widths.** A `Select class='w-40'` renders 160px wide, and `FormField.Label` is as wide
  as its text.
- **Picking the `"false"` item of a `RadioGroup` or `ToggleGroup` bound to a boolean signal sets the signal `false`**; before, it stayed `true`
  while the screen showed the other choice.
- **`bindControls` repaints every bound control after a form reset the reader clicks, and after resetting a form the root wraps**, so the controls
  and their signals agree; before, only a scripted reset of a form around the root repainted.
- **A bound `Slider`'s `<output>` follows a signal write**, rather than keeping the value it last showed.
- **`bindAttr` writes a boolean bound to an `aria-*` attribute as `"true"` or `"false"`**, rather than removing it or writing `""`, so a bound
  `aria-disabled` now blocks the click it should.
- **`Slider`'s `output` readout is no longer a second live region.** The `<output>` carries `aria-live="off"`, so the value is read from the range
  input and no longer announced on every step beside `<Announcer />`.
- **The `Toast` and `Alert` dismiss buttons paint at full strength.** The × and its focus ring were drawn at half opacity, about 2.5:1 on the light
  soft tones; they now take the panel's own text colour. `Alert`'s dismiss is a 32×32 target, and a dismissible `Alert` reserves `pe-10` to clear
  it.
- **`FormField.Error` renders nothing when its message is blank** (no children, `""`, an empty array or whitespace only) rather than an empty
  paragraph carrying the field's error id. `CheckboxGroup.Error` and `RadioGroup.Error` behave the same.
- **A control focused beneath the `Dock` now scrolls clear of it.** While the bar shows, the page reserves its height as `scroll-padding-bottom` on
  `<html>` and `padding-bottom` on `<body>`, and gives it back above `hideAbove`. A `pb-*` utility on your `<body>` replaces that padding.
- **A caller's `aria-describedby` no longer replaces the ids forge derives.** `Tooltip.Trigger` (plain and `asChild`), the `CheckboxGroup` and
  `RadioGroup` roots and `Dialog` now merge it into one list, the caller's ids first and each id once, so the tooltip, the group's error and the
  dialog's description stay announced. An empty or whitespace-only `aria-describedby` on one of them that leaves nothing behind is omitted rather
  than rendered as `""`. `fieldDescribedBy` and `fieldControlProps` also drop an id the caller repeats, and a field control (`Input`, `Select`,
  `Textarea` and the rest built on `fieldControlProps`) omits a blank `aria-describedby` the same way.
- **A caller's `aria-labelledby` no longer replaces the id forge derives.** `Dialog`, `Drawer`, a triggered `Menu.Popup` and `Tabs.Content` merge
  it the same way, the caller's ids first, so the dialog's title, the menu's trigger and the panel's tab still name them.
- **`asChild` on `Button`, `Link`, `Breadcrumbs`, `Pagination`, `Toolbar` and `Tooltip.Trigger` keeps the child's own `aria-describedby` /
  `aria-labelledby`** and lists the compound's ids after it, instead of replacing it.
- **The selected `Tabs.Tab` is marked by more than colour.** It draws a 2px bottom rule in its own text colour, clearing 3:1 against its fill and
  the page in both themes, and under forced colors that rule is `CanvasText` while an unselected tab draws none. Before, its only cue was a 1.08:1
  fill, and in High Contrast every tab looked the same. Every tab is 2px taller, so selecting one never shifts the row.
- **Without script, revealing another `Tabs.Content` by its fragment or by find-in-page hides the server-selected panel**, and its tab drops the
  selected fill, text colour and bar, under forced colors too; `aria-selected` is unchanged until `mountTabs` runs. A caller's override of the
  selected fill now needs `data-selected:not-tabs-revealed:`, because an `aria-selected:` class no longer replaces `Tabs.Tab`'s own. Each set
  reacts only to its own panels — a `Tabs.Content` directly inside `Tabs`, a `Tabs.Tab` directly inside `Tabs.List` — so revealing a nested set's
  panel no longer hides the outer panel that holds it, and following an outer tab no longer hides the inner set's selected panel.
- **A focused menu row draws forge's focus ring.** `Menu.Item`, `.CheckboxItem`, `.RadioItem`, `.LinkItem`, `.SubmenuTrigger` and any row
  wearing `MENU_ITEM_CLASS` show a 2px ring inside the row. Before, focus was only a 1.1:1 tint.
- **A checked `Menu.CheckboxItem` or `Menu.RadioItem` shows a tick.** Every checkable row keeps room for it, so checking a row never moves its
  label. The tick is drawn in the row's text colour and stays visible under forced colors. Before, checked and unchecked rows looked the same.
- **A pressed `Toolbar.Button` or `Toolbar.Link` draws a 2px bar along its bottom edge in its text colour.** Under forced colors it paints
  `Highlight`, with a `CanvasText` focus outline outside it. Only an item given `pressed` carries the cue. Before, pressed and unpressed items were
  identical.
- **The current link in a `Navbar` dropdown, and any `Menu.LinkItem` with `aria-current`, is set semibold on the accent fill**, as the bar's own
  links are.
- **`Alert.Description` and `Toast.Description` paint at full strength**, clearing 4.5:1 on every soft tone in both themes. At 90% opacity the
  light secondary tone measured about 4.2:1.
- **Opening a `Navbar` drawer always moves focus into the panel.** `mountNavDrawer` timed its wait from the panel, which has no transition, rather
  than from `::details-content`, so focus sometimes stayed on the summary.
- **An arrow key pressed on a control that is not one of a composite's items reaches that control.** A `<select>` or radio inside an open
  `Toolbar` flyout keeps its own arrow keys; before, the toolbar swallowed them and moved focus to a rail button.
- **Disabling the item that holds a composite's tab stop at runtime moves the tab stop to the next enabled item.** Before, Tab skipped the
  composite.
- **A `Menu` whose first item is hidden opens with focus on the first visible item.** Before, focus stayed on the trigger and ArrowDown did
  nothing.
- **A popup opened by `openPopoverAt` is anchored to its trigger again the next time the trigger opens it.** `openPopoverAt` removes the
  `data-coords` it added once the popup has closed, and keeps one set in markup. Before, every later trigger open landed at the viewport's top-left
  corner.
- **A context menu that `flip` or the viewport clamp moved grows from the corner nearest the pointer**, rather than always from its top-left.
- **Selecting a tab leaves a nested `Tabs` alone, and checking a radio row leaves a submenu's radios alone.** Before, the outer set deselected
  every inner tab and hid its panel, and the parent menu unchecked the submenu's choice.
- **A composite revealed after focus moved into it keeps its tab stop on the focused item.** Before, a `Menu` whose `toggle` handler focused a row
  reset the stop to the first row once shown, so the next arrow key started from there.
- **`mountNavDrawer`'s default panel is the first child of the disclosure holding a focusable control**, skipping the `<summary>` and a
  `navbar-backdrop` slot. Before, an unmarked backdrop placed before the panel was taken for it, and Tab cycled on the summary alone. It now warns
  when no panel with a focusable control resolves.
- **A non-modal `open` `Dialog` or `Drawer` stays open on an outside click and on Escape.** Before, clicking a nearby input or pressing Escape
  anywhere closed it; a modal open still light-dismisses.
- **A busy trigger under `Tooltip.Trigger` shows its tooltip on hover**, as a disabled one does. Before, `state-busy` blocked the pointer events
  that open it.
- **An open trigger is highlighted over its own utilities.** A `Toolbar` flyout trigger and a `Menu.SubmenuTrigger` paint the open state while
  their panel is open, where their own transparent fill used to win.
- **A compound root's `type`, `orientation` and `size` now reach its parts.** These props are fill-ins only: a prop set on the part itself
  still wins. The same holds for the bound `ToggleGroup` and `RadioGroup` from `@y-core/forge/ui/controls`.
  - `ToggleGroup type='multiple'` renders checkboxes. Before, it rendered radios.
  - `Tabs orientation='vertical'` renders a vertical `Tabs.List`, and ArrowDown moves the selection. The selected tab draws its cue on the
    inline-end side.
  - A vertical `Toolbar`'s `.Separator` runs across the toolbar. Before, it ran along it.
  - `RadioGroup`'s `size` sizes its items.
- **`CheckboxGroup`'s `size` sizes its items**, and the bound `CheckboxGroup` from `@y-core/forge/ui/controls` does the same. Before, a root
  `size` never reached them.
- **On WebKit, a `Filter` chip or single-select `ToggleGroup` chip reached by an arrow key shows the focus ring.** WebKit does not count that
  focus as `:focus-visible`, so the chip used to show none.
- **On Firefox, closing a `Navbar` drawer with Escape returns focus to its toggle.** Before, focus sometimes landed on `<body>`. A click on the
  backdrop also returns focus to the toggle.
- **A `computed` created in a scope's `setup` is released when the scope is disposed**, as an effect already was, and keeps its last value from
  then on. Before, every swapped-out island left its computeds subscribed to any signal that outlived it.
- **An htmx swap no longer copies a `style` attribute your script wrote onto the new element**, which raised a CSP `style-src-attr` violation on
  every swap. A morph never applies or removes a `style` attribute, so a style your script wrote survives it.
- **`Turnstile` counts `hx-get` and `hx-query` as an htmx submission**, in the plain and `data-hx-` spellings, as htmx 4 does. A form using one
  is held in submit mode and reset after its submission, and no longer warns that it has no htmx submission. A GET form carries the token in its
  URL.
- **An outer `Tabs` drives its own tablist when a nested `Tabs`' tablist comes first in the document.** Before, it mounted on the nested one and
  drove the inner set.
- **A custom `--command` from an invoker outside every scope reaches its target's handler**, so a `Toolbar` action with `dispatch: "command"` placed
  outside the scope it names now runs. Before, it ran nothing.
- **`change`, `submit`, `reset` and a custom `command` fired inside an open shadow root reach the scope's handler.** These events never leave the
  shadow tree, so the document's listener never saw them. `resume()` now also listens inside every open shadow root it finds; call
  `resume(shadowRoot)` for one attached later. `bindControls` likewise reads a `change` and repaints on a `reset` inside the open shadow roots under
  its root when it mounts.
- **`resume()` sweeps detached scopes once per call**, rather than once for every scope it resumes, so boot no longer slows with the square of
  the number of scopes.
- **An effect that reads `isDark` before `resume()` re-runs when a theme scope resumes and whenever the theme changes.** Before, it recorded `false`
  and never ran again.
- **A stored theme other than `light`, `dark` or `system` is read as `system`**, by `FOUC_SCRIPT` and by `ThemeToggle`, so the toggle keeps its icon
  and accessible name. Storage that throws on read or write, or is full, no longer breaks the toggle, and `FOUC_SCRIPT` no longer throws in a
  realm without `matchMedia`.
- **`bindAttr` writes a boolean bound to `draggable`, `contenteditable` or `spellcheck` as `"true"` or `"false"`**, as the renderer does. Before,
  `true` wrote `""`, which leaves `draggable` in its default state rather than on.
- **Security: `bindAttr` removes `hx-action`, `hx-get`, `hx-post`, `hx-put`, `hx-patch`, `hx-delete` or `hx-query` while its bound value is a
  `js:` or `javascript:` URL**, and warns once, so htmx sends nothing; a later safe value writes it back. This covers the `data-hx-` spelling, any
  `:inherited` or `:append` suffix and any case. Before, htmx ran the bound value as script on the next request. Values the renderer emits are
  unchanged.
- **A closed `Menu` adds no document listeners and starts no roving-focus observers.** Both start on the first open, and the document listeners
  are removed on close, so a click no longer costs a query per menu on the page.
- **A popover's open state reaches only the invokers whose `aria-controls` names it**, found by one lookup rather than a scan of every
  `[aria-controls]` on the page.
- **A `ui/core` `Input` given `data-field` by hand and a `format` renders its value raw**, so it no longer regroups and then ungroups as the
  binding mounts. It keeps `data-format`, and the client still warns once that format and bind do not compose.
- **`translate={false}` renders `translate="no"`, and `true` renders `"yes"`; `autocapitalize` takes a boolean as `"on"` or `"off"`.** Before,
  `false` dropped the attribute. `bindAttr` writes both the same way, and both props accept a boolean.
- **`cn` keeps utilities that set different properties.** `space-x-4` with `space-x-reverse`, `border-dashed` with `divide-solid`,
  `outline-offset-2` with `outline-hidden`, and `bg-background` with an arbitrary gradient, `bg-[image:…]`, `bg-[size:…]` or `bg-[position:…]`
  now all survive a merge. A bare integer width that Tailwind accepts but does not list, such as `border-3`, `ring-3`, `outline-3`,
  `decoration-4` or `stroke-4`, replaces the root's width and no longer its colour. Before, `cn` dropped one class of each pair.
- **`buildCursors` bakes a token written `light-dark(a, b)`**, taking `b` for a theme whose stylesheet declares `color-scheme: dark` and `a` for
  every other. Before, it threw. A cursor SVG containing a nested `<svg>` is no longer cut short at the inner `</svg>`.
- **Sprite icons no longer break or recolour one another.** The sprite builder prefixes every id inside an icon with the icon's symbol id and
  rewrites the references to it, so two icons that both declare `id="grad"` keep their own gradients. It also reads the `viewBox` and the
  presentation attributes from the root `<svg>`, in either quote style, rather than from the first match in the file, and keeps the content after
  a nested `</svg>`.
- **Security: the sprite and cursor SVG sanitizer writes a `<`, a `>` or a bare `&` in text as `&lt;`, `&gt;` or `&amp;`**, so a stray `<` beside
  an element it drops can no longer join the following text into a live tag such as `<img onerror>`. This flaw predates this release cycle.
- **`Table`'s `zebra` stripes skip a selected row and a toned row**, so neither is hidden under the stripe. Under `pinRows` the scroll wrapper
  takes its parent's `max-height`, so the header sticks inside a parent of bounded height; before, it scrolled away.
- **`Button shape="square"` renders square**, as wide as its container and as tall as it is wide. Before, it kept the control height.
- **`Meter` paints the region HTML's own `<meter>` reports.** Some combinations change colour: a `value` at `max` with no thresholds is now
  optimum rather than suboptimum, and where `optimum` lies outside `low`..`high`, a `value` on the far threshold is suboptimum, as Chromium and
  WebKit paint it.
- **A disabled `Select` is dimmed once, to half opacity**, matching a disabled `Input`. Before, it was dimmed twice.
- **`Indicator` placements mirror in a right-to-left context.** Before, every placement sat about one item width off.
- **A bare `Switch` in a vertical `FormField` keeps its own width**, so its click target no longer spans the row.
- **A chrome `Toolbar` flyout trigger is the same 40px as the rail's actions**, where it rendered 32px, and the flyout opens 0.375rem from the
  rail. **The flyout's accessible name is its label alone**; a `titleAction` no longer joins it, as in "Layers Add layer". **A toolbar action given
  a `data-slot` in `data` keeps `toolbar-action` beside it**, where the caller's value used to replace it.
- **`Breadcrumbs.Link` is a control-height target**, 32px tall, or 28px under `shape-compact.css`, where it was the 20px text line. A trail row grows
  to match.
- **A small `OtpInput` is a 32px hit target**, or 28px under `shape-compact.css`. The editor now reaches over the frame's border, where it sat
  inside it and lost two border widths at every size.
- **`CheckboxGroup.Item`, `RadioGroup.Item` and `Switch` clear the 28px Floor**: the label is at least the `sm` control height (32px, or 28px
  under `shape-compact.css`), and a Switch with no label text is that wide as well. The track is unchanged. A vertical group's items now sit with
  no gap between their taller rows.
- **`Alert`, `Toast`, `Badge` and a toned `Table` row no longer recolour on hover.** They took the hover fill meant for a toned button, which read as
  a button and, on a light solid primary panel, dropped the dismiss glyph to 4.28:1. `toneVariants` keeps its hover fill.
- **`Navbar` with `placement` `top` or `bottom` now sticks to its edge.**
- **A bottom `Navbar` reserves its height at the foot of the page**, and beside a `Dock` the two reserves add up instead of one replacing the
  other.
- **A `left` or `right` `Navbar` on a phone reserves its height at the edge it pins to**, so a focused control scrolls clear of it. Below `md` it
  sits on the top or bottom edge and is sized from `--forge-navbar-height`; at `md` and up it is a column and reserves nothing.
- **An open `Navbar` drawer's first and last links are clear of its toggle on a phone.** The toggle used to cover the edge of the link nearest the
  bar, so a tap there closed the drawer. The toggle now fills the bar's `--forge-navbar-height` row, and the panel starts below it, or ends above
  it on a bottom bar.
- **A `collapsible="always"` left or right `Navbar` rail opened as a drawer on a phone no longer hides its first link under the toggle.** Below
  `md` the rail's toggle is `--forge-navbar-height` tall, and the open panel starts below it; at `md` and up the toggle is unchanged.
- **`Card`, `Dialog`, `Popover.Content`, `Menu.Popup`, the chrome `Toolbar` flyout, the `NumberField` steppers, `Toolbar.Input` and the
  `CheckboxGroup` / `RadioGroup` boxes follow `--border-width`** instead of staying 1px under a shape that thickens borders. `Toolbar.Input` is the
  toolbar's 32px control height rather than 30px.
- **The testing canon names Chromium as the browser set's engine and Firefox and WebKit as opt-in sign-off.** The apps `TESTING.md` §6e and
  `CONFIG_BASELINE.md` said every spec runs on every engine at release, while `cloudflareWorkerSteps({ browser: true })` emits Chromium alone.
  `CONFIG_BASELINE.md`'s `test:browser` script now matches `browserStep`'s argv.
- **`ToggleGroup`'s first item follows `--border-width` on its leading edge**, where it stayed 1px under a shape that thickens borders.
- **A bottom `Navbar`, a `right` one on a phone, and a `side="bottom"` `Drawer` panel rest on top of a showing `Dock`** instead of under it.
- **An `OtpInput` paints its cell rules on Firefox**, where the frame showed its border and no rule between the cells.
- **`validate-design` compiles a `tsx` fence against the step tsconfig's ambient `*.d.ts` files**, so a fence naming a workerd global such as
  `ExecutionContext` is checked against its declaration, and a compiler diagnostic outside a fence now fails the check instead of being dropped.
- **A busy `CheckboxGroup` or `RadioGroup` root emits `aria-busy="true"` beside `data-busy`, and an invalid `RadioGroup` root emits
  `aria-invalid="true"`**, as ARIA 1.2 allows on those roles. A `CheckboxGroup` root still marks invalidity with `data-invalid` alone, because ARIA
  1.2 deprecates `aria-invalid` on the `group` role.
- **In an engine without `popover="hint"`, a `Tooltip` closes on Escape and on a press outside it, and opening one closes any other open
  tip.** Since 0.5.15, unrecorded there.
- **`Popover`, `Menu` and `Toolbar` flyout panels anchor to their trigger in an engine whose `position-anchor` initial value is `normal`**,
  because the rule now names `position-anchor: auto`. Since 0.5.15, unrecorded there.
- **A focused `focus-ring` element shows an indicator in forced-colors mode.** It draws a transparent 2px outline beside the inset ring, which is
  a box shadow and does not render there. Since 0.5.15, unrecorded there.
- **In forced-colors mode, forge's system-colour rules for `CheckboxGroup`, `RadioGroup`, `Switch`, `Toggle`, `ToggleGroup`, `Filter`, `Slider`
  and `Table.Row` win over those components' own `bg-*` and `outline-none` utilities**, because the rules sit in `@layer utilities`. Since
  0.5.15, unrecorded there.

---

## [0.5.16] — 2026-10-25

### Fixed

- **`forge release` signs its commit under `commit.gpgsign`, as `git commit` did.** In 0.5.15 it was built unsigned whatever the setting, and a signing
  failure now stops the release before `HEAD` moves.
- **`forge release` reports an index the post-commit sync left truncated.** A sync that read `.git/index` as missing used to report success with
  every other tracked file staged for deletion; it is now `index-stale`, naming `git reset -q`.

---

## [0.5.15] — 2026-10-25

### Breaking Changes

- **`zone.allow.paths` is required, and `forge cf sync zone` no longer falls back to the GET-only `pages`.** Pass `routePaths(routes)` across
  every method.
- **`browserStep` requires the Playwright server and never a local browser.** With `PW_TEST_CONNECT_WS_ENDPOINT` unset the step fails instead of
  probing for an installed engine. `browserStep`'s `hint` option, `hasChromium`, `hasBrowserEngine`, `resolveChromiumPath`, `egressProxy` and the
  `@y-core/forge/tooling/gate/chromium` subpath are removed.
- **`forge verify` runs one tier — `static`, `unit`, `runtime`, `deploy` or `release` — chosen with `--tier`; `--mode` and `--full` are
  removed.** A bare `verify` is now `runtime`: it adds the browser, workerd and database rows on their primary engine, narrowed to the pending
  changes, and fails rather than skips a row whose prerequisite is absent. Rename the scripts `verify:quality` to `verify:static` and `verify:full`
  to `verify:release`, and add `verify:unit` and `verify:deploy`. `GateMode` and `GATE_MODES` are `GateTier` and `GATE_TIERS`, `selectSteps`
  takes `tier`, a check's `run` receives one, and a receipt carries `tier` and the `base` commit a `runtime` run read its changes against. A table
  that states `tier: "quality"` or `"standard"` states `"static"` or `"unit"`; a `"full"` row moves to whichever tier `TESTING.md` §6c's lines
  put it in. `browserSteps({ engines })` emits `test:browser` for the primary engine at `runtime` and `test:browser:<engine>` for each other engine
  at `release`, and `cloudflareWorkerSteps({ browser: { engines } })` is built on it. At `runtime`, `browserStep` and `workerdStep` first run
  their narrowed command with `--list` and report the row untouched when it lists no spec, and `StepProbe` is exported for a step of your own.
  A step's new top-level `widen: (cwd) => paths`, taken by `browserStep`, `browserSteps` and `workerdStep`, names paths whose change runs a
  narrowed or untouched row whole, and a `widen` that rejects does too; build one from the new `importClosure` (exported by
  `@y-core/forge/tooling/assets`) and `workerMainClosure` (by `@y-core/forge/tooling/gate`). `cloudflareWorkerSteps` widens its browser and
  workerd rows by the import closure of the wrangler config's `main`, so a change to app source runs them whole and only a spec-only edit narrows,
  and `dbSteps` widens by its `forge` command's source entry. With `assetConfig` set, the browser rows also widen by everything the asset build
  reads, and the workerd row does too when the wrangler config has an `assets` block. Drop `watches` from a Playwright row. `dbSteps` replaces
  its `watches` option with `exercises` and `graph`, which watch the namespaces it runs through the namespace graph; without them it runs on every
  change. A `watches` or `narrow.wide` glob that matches no file fails the gate, naming the row and the glob.
- **`tailwind.css` imports Tailwind with `source(none)`, so a build scans only what an `@source` line names.** An app that relied on automatic
  detection loses the classes of every file no `@source` names. Add `@source` lines for your own source directories to your stylesheet, as the
  `ui` README's “Tell Tailwind which directories to scan” shows; under `cloudflareWorkerSteps` with `design` set, the new `validate-css-coverage`
  row names each uncovered file and the line to add. An app that imports `forge.css` under its own Tailwind import keeps
  `source(none)` there, since the row fails a stylesheet that leaves detection on.
- **An opt-in namespace's classes come from its own `sources.css`, not from a `node_modules` path in your stylesheet.** Replace each
  `@source "…/node_modules/@y-core/forge/src/<namespace>"` line with `@import "@y-core/forge/<namespace>/sources.css";`, for `auth`, `app`,
  `logging` and `render/htmx`. The new files' paths resolve under any install layout, a git dependency included.

### Added

- **`cssCoverageStep` checks an app's `@source` coverage**, as the `validate-css-coverage` row. It fails a stylesheet that leaves automatic
  detection on and each class-declaring source file no `@source` covers, and warns on a scanned directory that declares no class.
  `checkCssCoverage` and `CssCoverageCheckConfig` are exported beside it from `@y-core/forge/tooling/gate`.
- **`assetInputs(root, assetConfigPath, files)` in `@y-core/forge/tooling/assets` lists every repository file an asset build reads**, for a
  `widen` of your own. It rejects on an input that does not resolve.
- **Overlays open and close with motion.** A modal `Dialog`, `Popover`, `Menu`, `Tooltip` and the `Toolbar` flyout fade and scale (150ms in,
  100ms out), and a `Toast` fades in. Popups scale from the side of their anchor, and a context menu from the point that was clicked. Retime
  all of them with `--forge-motion-enter` / `--forge-motion-exit`. On a component whose custom motion leaves `scale` or `opacity` out of
  `transition-property`, set `--forge-motion-scale: 1` or `--forge-motion-opacity: 1`. A caller's `transition-none` still opens one
  instantly.
- **A timed `Toast` pauses while it is hovered, while it holds keyboard focus, or while its page is hidden**, and then runs only the time it
  had left. A toast that arrives on a hidden page waits for it to be shown.
- **A dismissed `Toast` or `Alert` fades out before it is removed.** It is marked `data-dismissing` and `inert` at once, and focus moves to a
  toast that is not fading, or to the region. `STATE_ATTRS` lists `data-dismissing`.
- **Moving from one `Tooltip` to the next opens it at once.** While another tip is open, or for 300ms after one closes, the next one skips its
  delay and fade and carries `data-instant`, which `STATE_ATTRS` now lists.
- **`@y-core/forge/tooling/db/host` carries `forgeSchema` and `DbHostConfig`** for a `config/db.ts` that node loads. **`testing/d1` re-exports
  `sql`**, so a node spec builds the fragment `explainPlan` takes without importing `storage/db`.
- **`crypto/keyring` exports `KeyRingSecretSchema`**, which validates a comma-joined ring of hex secrets from env and, like
  `parseKeyRingSecrets`, ignores surrounding whitespace. `CsrfConfigSchema.secret` is built on it.

### Changed

- **A non-modal `<Drawer open>` docks at its edge** (`position: fixed`, `z-40`, below toasts) instead of flowing in the page, and slides out from that edge
  on `close()`. It still has no backdrop and leaves the page usable.
- **Under `prefers-reduced-motion: reduce`, overlays fade instead of changing instantly.** Only the scale and the Drawer's slide are dropped.
  `forge-ui-reduced-motion` now allows replacing a scale or slide with an opacity fade, and `09-interaction.md` counts changes started
  together on one duration and one easing as one motion moment.

### Fixed

- **`mountTurnstile` under `challenge="submit"` replays a held press in Firefox when Turnstile answers inside `execute()`.** The replay now runs
  on a task of its own instead of inside the submission it replays, which Firefox sent nothing for.
- **Parameterised, wildcard and optional routes are allowed at the edge.** `buildAllowExpression` emits them as `strict wildcard` clauses
  instead of literal paths.
- **`mountNavDrawer` focuses the panel's first control once it becomes focusable after `toggle`.** It retries each frame for the length of
  the panel's transition.
- **`openTestD1()` with no options loads a `config/db.ts` written as the README shows, under node.** An existing `config/db.ts` must import
  `forgeSchema` and `DbHostConfig` from `@y-core/forge/tooling/db/host` instead of `@y-core/forge/tooling/db`.
- **`testing/d1` and `testing/harness` typecheck under `"types": []`** with only `/// <reference types="@y-core/forge/testing/node" />`.
- **The admin user search reads through the `email_key` index instead of scanning every user.**
- **`render/markdown` exports `DEFAULT_MARKDOWN_HANDLERS`**, so a handler override can fall back to the default one. It is frozen, and has no
  `table`, `linkReference`, `imageReference` or `footnoteReference` handler, because those need per-render state.
- **A wrong authenticator-app or recovery code no longer says to ask for a new code.** Only an emailed code is told to ask for another.
- **The `render/pdf` README gives Arimo's licence as SIL OFL 1.1**, not Apache-2.0.
- **A PDF `Table` takes JSX in its `header` and `rows` cells.** It used to fail typecheck and throw a `TypeError` at render.
- **`render/pdf` exports `WIN_ANSI_CHARACTERS`**, the characters WinAnsi encodes, for a font subset's `covering`.
- **A PDF form field placed outside the 12-column row, or given a span that isn't a whole number from 1 to 12, throws a `RangeError` naming
  its label**, instead of rendering clipped or at zero or negative width. A field with no `span` fills the rest of its row.
- **A zone's edge rule allows `/robots.txt` and the sitemap without listing them in `files`.**
- **`buildAllowExpression` refuses a route, file or prefix holding a character a browser would percent-encode**, such as `/café/:id`,
  with a `ZonePatternError`. The edge rule would never have matched it. Write the path percent-encoded instead.
- **The service-worker example in the `tooling/assets` README typechecks**, under the worker's own tsconfig the README now shows.
- **`validate-asset-root` knows about `sw.js`.** With a service worker, a missing `!/sw.js` under `run_worker_first` fails, and a present one
  no longer warns.

- **`forge release` no longer commits an empty tree when `.git/index` reads as missing.** The release commit is built against a private index, and
  a commit that changes a path it never staged, or none, is refused before tagging as the new `commit-mismatch` `ReleaseErrorKind`. An index
  left stale after a correct commit is reported as `index-stale`, and the tag is still cut. The commit no longer runs git hooks.

---

## [0.5.14] — 2026-10-20

### Added

- **`ServeWorkerOptions.dev` serves a harness Worker as `forge cf dev` builds it**, each `#relax/*` import resolved to its development module
  with `__FORGE_DEV__` defined, so a workerd spec driving a relaxation — Cloudflare's Turnstile testing secrets, say — can pass. Without it the
  harness stays strict. Harness starts in one process now run one at a time, because the build conditions are read from the shared process
  environment.

### Fixed

- **The app canon no longer describes the removed development model.** `APP_ARCHITECTURE.md` §1c is now _Development Relaxations Are Modules the
  Build Selects_, in place of the separate dev entry. `WORKERS_PLATFORM.md` §3b is now _An Absent Limiter Fails Closed_: a `503` everywhere but
  `forge cf dev`. `CODE_REVIEW.md` §6 replaces its dev-entry and rate-limit rows to match. `TESTING.md` §2d takes the log store as its optional
  binding, and `BOUNDARIES.md` §5b, in both the app and library canon, names the storage resolver as where `required: false` lives.

---

## [0.5.13] — 2026-10-20

### Breaking Changes

- **Forge owns the Turnstile wiring, so `turnstile: {}` is a complete configuration** on `defineAction`, `definePage`, `AuthWebOptions` and
  `defineApproval`. Each key is read only where it is used, the site key from `TURNSTILE_SITE_KEY` for a widget and the secret from
  `TURNSTILE_SECRET_KEY` for a check, and a missing or blank one throws `Invalid environment: <KEY>: missing`, so the request answers 500
  rather than rendering an unguarded form. The token is pinned to `c.url.hostname`, and `CF-Connecting-IP` is sent as `remoteip` when present.
  `ActionTurnstileOptions.secretKey` and `.verify`, and `AuthTurnstileOptions.keys` and `.verify`, are optional overrides, `verify` merged over
  the defaults; neither carries a relaxation, since Cloudflare's testing secrets are accepted only under `forge cf dev` (see the next entry).
  **Migration:** delete every hand-written `keys`, `secretKey` and `verify` callback that only reads `c.env.TURNSTILE_*`, `c.url.hostname` or
  `CF-Connecting-IP`, leaving `turnstile: {}` or only the constraints that differ. Delete any `dev` passed through `verify`. Name the bindings
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, or keep a `keys`/`secretKey` override for other names. Render a consumer-built widget's site
  key from `readTurnstileKey(c, "siteKey")`.

- **`@y-core/forge/dev` is removed: a development relaxation is a module the build selects, so a deployed Worker holds none of them.**
  `devAllowance`, `DevAllowance` and `DevAllowanceOptions` are gone, with every option that took one — `AppOptions.dev`, `ErrorPageOptions.dev`,
  `RateLimitOptions.dev`, `DeriveAllowedOriginsOptions.dev` and `TurnstileVerifyOptions.dev` — and `CrossOriginProtectionOptions`, so
  `crossOriginProtection()` and `checkCrossOriginProtection(request)` take none. `Forge.setErrorDetail` is removed with no replacement. Each hook
  now imports its relaxation through forge's package `imports` map: the `forge-dev` condition resolves it to a `*.dev.ts` beside the hook, and
  every other resolution to a strict stub, and the `*.dev.ts` relaxes only in a build that defines `__FORGE_DEV__` as `true`. The new
  `forge cf dev` (`createDevCommand` in `@y-core/forge/tooling/cf`) runs `wrangler dev` with both set, in wrangler's process only; wrangler's own
  flags follow `--`. Under it, and under nothing else, an absent rate-limiter binding is skipped with a warning, `crossOriginProtection` accepts a
  request with no Fetch Metadata headers, `originProtection` and `originGuard` admit the origins the `FORGE_DEV_ORIGINS` binding lists, Turnstile
  accepts Cloudflare's published testing secrets, and the fallback 500 and `createErrorPage` disclose the thrown message, escaped. A plain
  `wrangler dev` relaxes none of them. In the gate, the new `validate-dev-bundle` row, on the `full` tier of `cloudflareWorkerSteps`, bundles
  `main` with esbuild and fails when a module from a dev-only directory or a `*.dev.ts` module reaches the output, or when the shell's
  `WRANGLER_BUILD_CONDITIONS` names `forge-dev`. It refuses a Worker config that sets `alias`, `build`, `define` or `rules`, or whose
  `compatibility_flags` carries `nodejs_compat` or `nodejs_compat_v2`, at the top level or in an `env.*` block, since it models none of them.
  `DevBoundaryCheckConfig.devEntries` is removed, `isDevEntry` is renamed `isDevModule(file)`, and rule B of `validate-dev-boundary` now fails
  only a production module importing a `*.dev.ts`, a type import included — a `*.dev.ts` may import another. **Migration:** delete
  `worker.dev.ts`, and any script or Worker config that names it, and delete every `devAllowance` call and `dev` option. In the `dev` script,
  replace `wrangler dev` with `forge cf dev`, keeping the asset build before it. Move `extraOrigins` into `.dev.vars` as `FORGE_DEV_ORIGINS`,
  comma-separated. Call `crossOriginProtection()` bare. Rename each dev-only file of your own to `*.dev.ts` and drop any `devEntries`; dev-only
  code the shared path calls goes behind your own `imports` alias, as `src/tooling/cf/README.md` shows. Run `forge verify --full` once to see
  the bundle row's verdict on your `main`.

- **The gate's import checks follow a `#` specifier through the root `package.json` `imports` map, so `PackagingCheckConfig.imports` is
  removed.** `validate-namespace-graph`, `validate-import-boundary` and `validate-ssr-boundary` judge every target an entry resolves to under any
  condition; rules B and C of `validate-dev-boundary` judge the target the deployed bundle resolves, and rule B also fails each `imports` entry
  whose deploy target is a `*.dev.ts`. The packaging check reads the map itself, and the `PackageImports` type is exported from
  `@y-core/forge/tooling/gate`. **Migration:** delete the `imports` field from every packaging check config.

### Added

- **`readTurnstileKey(c, key, override?)` in `@y-core/forge/app` reads a Turnstile key the way forge reads it.** It answers one key,
  `"siteKey"` or `"secretKey"`, from its own binding alone, or from `override` when one is given, and its error names only that key.

### Fixed

- **`INPUT_VALIDATION.md` §4a said an omitted `expectedHostname` only logs a warning.** `verifyTurnstile` refuses it as `hostname-mismatch`
  without calling siteverify, and the section now says so.

- **The apps canon's `CONFIG_BASELINE.md` names `forge cf dev` as the `dev` script's server.** It still named `wrangler dev`, which runs
  every relaxation strict. The consumer `CLAUDE.md` seed and the scripts table in `src/tooling/db/README.md` say the same now.

- **The changelog check refuses a released section deleted together with its digest.** It reads the `v*` tags in the repository and fails
  on a tagged version with no section, unless it is older than the oldest heading, so only the oldest releases may be trimmed. Without
  readable tags the rule does not run. `ChangelogCheckConfig.tagPrefix` names the prefix, defaulting to `v`.

---

## [0.5.12] — 2026-10-20

### Fixed

- **A resend refused by the Turnstile challenge shows "Verification failed. Please try again."**, the copy the other auth forms give the same
  refusal, rather than the submission copy that told the visitor to fix input they typed correctly. A resend whose body cannot be read keeps the
  submission copy.
- **Erratum for 0.5.11.** Its entry said the `expectedHostname` guard still runs under the testing-secret allowance, which reads as if the
  siteverify `hostname` were still compared. It is not: under the allowance `verifyTurnstile` skips the hostname, action and cdata comparisons,
  as 0.5.10 already did for the hostname. The `success` check and the fail-closed refusal of an empty `expectedHostname` still run. The 0.5.11
  entry also left out these changes:
  - auth forms refused by the Turnstile challenge show "Verification failed. Please try again." instead of the field's own copy, and the verify
    page shows its recovery-code copy only for a submission it could not read;
  - `defineApproval` refuses a wrong code with "Approval failed. Please try again." instead of "That is not a valid administrator code.";
  - a local `forge db` load whose commit is refused replays the file under a foreign-key watch and names the first statement that left a row
    with no parent.

---

## [0.5.11] — 2026-10-20

### Fixed

- **`verifyTurnstile` no longer compares `expectedAction` or `expectedCData` under the testing-secret dev allowance**, so auth's guarded
  forms pass under Cloudflare's testing keys. Siteverify answers those keys with no `action` or `cdata`; the `success` check and the
  `expectedHostname` guard still run.

---

## [0.5.10] — 2026-10-18

### Breaking Changes

- **`config/cf.ts` is no longer read, and `CfHostConfig`, `D1Placement`, `D1Jurisdiction` and `D1LocationHint` are removed** from
  `@y-core/forge/tooling/cf`. `forge cf sync` creates a D1 database with its name alone, and no longer holds its jurisdiction or read replication
  or provisions a `<name>-preview` database. **Migration:** delete `config/cf.ts`. Create a database that needs a jurisdiction or a location hint
  before the first sync, under the name `cf sync` expects (`wrangler d1 create MYAPP_DB --jurisdiction eu`), and `cf sync` adopts it. Turn read
  replication on in the Cloudflare dashboard, and create a preview database with `wrangler d1 create` and set `preview_database_id` yourself.

### Changed

- **`forge db` refusing a `preview` target with no real `preview_database_id` points at `wrangler d1 create`**, since `forge cf sync` no longer
  provisions one.

---

## [0.5.9] — 2026-10-18

### Breaking Changes

- **`CsrfRingResolver` and `AuthRingResolver` are removed** in favour of `KeyRingResolver` from `@y-core/forge/crypto/keyring`, which takes an
  `AppContext<Bindings>`, so a resolver reads `c.env` with no cast. **Migration:** rename the type, then drop any `(c as any).env` cast.

### Added

- **`createKeyRingResolver` and `KeyRingResolver`** in `@y-core/forge/crypto/keyring`. The resolver resolves a ring once per `env` object, so
  the subkeys and imported keys cached on it survive across requests. `defineApproval` now resolves its ring this way.
- **`FrontmatterRule.fileName`** in `@y-core/forge/warden/checks` narrows a `requiredFrontmatter` rule to documents of one file name, such as
  `README.md`.
- **`findSplitRuleMarkers`** in `@y-core/forge/tooling/gate` returns each `<!-- rule:… -->` marker that spans a line break or never closes.

### Fixed

- **A `requiredFrontmatter` rule holds every document it names**, not only numbered ones. A source README with its keys collapsed onto one line
  passed `validate-docs` while the index read a garbage title and no description; it now fails on the missing keys.
- **`validate-design` fails on a rule marker split across lines.** The marker reader works one line at a time, so a reflow that wrapped
  `<!-- rule:… -->` dropped the id from the defined set without a finding. `forge-ui-tell-heading-skip` had been dropped that way.

---

## [0.5.8] — 2026-10-18

### Breaking Changes

- **`forge db deploy` is removed, with `runDeploy`, `DeployOptions` and `DeployOutcome`**, from `@y-core/forge/tooling/db`. Its one check
  `migrate` lacked moves there: `forge db migrate` refuses a migration the entry's wrangler history table (`migrations_table`, else
  `d1_migrations`) records and forge never applied, on every target and under `--dry-run`, and `forge db migrate status --check` exits 1 on
  one, its `--json` report carrying `wranglerHistory`. **Migration:** set the Workers Builds deploy command to
  `forge db migrate --target remote --yes && wrangler deploy`; a `--check-only` step becomes
  `forge db migrate status --check --target remote` ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9a).

---

## [0.5.7] — 2026-10-18

### Breaking Changes

- **`AuthWebOptions.bootstrapSecret` is removed**, in `@y-core/forge/auth/web`. The first-admin claim is now gated by an administrator approval:
  the `admin.elevate` group in `AUTH_ROUTE_GROUPS`, and `AUTH_VIEW_GUARDS.adminElevate`, end with the new `"require-approval"` guard.
  `createAdminElevateActions(...).submit` and `loadAdminElevate` answer 404 unless `requireApproval` admitted the request, which it records on
  `approvalCtx`, so a route of your own mounting them must run `requireApproval` ahead of them. **Migration:** define the approval with
  `defineApproval`, reading the code you held as the bootstrap secret, with the `rateLimit` you want on the prompt and the key ring your
  `csrfProtection` uses as `ring`, and pass it to `createAuthGuards` as `approval`. Mount its prompt with `registerApproval`. Without an
  approval, both elevate routes send an anonymous visitor to sign-in and answer a signed-in one with 404, as they did with no secret
  ([`AUTH_MOUNTING.md`](docs/AUTH_MOUNTING.md) §3).

- **`authAdminElevateSchema` is `{ confirm: "yes" }` alone, losing `secret`**, and `AdminElevateView` no longer renders a secret field.
  `AdminElevateViewProps.fieldError` is removed. A `views.adminElevate` override that rendered either must drop it.

- **The `forge db lint` rule `pragma-ignored` is renamed `pragma-unsupported`, with no alias.** It is now an error on any `PRAGMA` outside
  D1's supported set, which D1 refuses with `SQLITE_AUTH`, and an error too on `PRAGMA foreign_keys`, which D1 ignores because it always
  enforces foreign keys. `PRAGMA optimize` and the inspection pragmas are no longer flagged. **Migration:** rename any reference to `pragma-ignored`, and
  remove a refused pragma from a migration ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §5).

- **`D1Client` methods fail with a `D1Failure` and carry `meta` on both branches**, in `@y-core/forge/storage/db`: each now returns
  `D1Outcome<T>`, a `Result<T, D1Failure>` with `meta: { attempts }`. `D1Failure` extends `Error`, so `error.message` and `error.cause` still
  read as before, but an error is no longer the thrown D1 error itself — it is that error's `cause`. **Migration:** a test comparing a whole
  outcome with `toEqual` adds `meta`; code matching a D1 message string branches on `error.kind` instead.

- **The default database layout moves under `config/db/`**, in `@y-core/forge/tooling/db`: migrations default to `config/db/migrations` and the
  snapshot to `config/db/schema.snapshot.json`. Every `forge db` verb now refuses a `d1_databases` entry whose `migrations_dir`, resolved from
  the wrangler config's directory, is not that directory, or whose `migrations_pattern` is not that directory's `*.sql`, naming the key to set.
  `forge db standby reset` fails when it finds no seed, unless `--no-seed` is given. **Migration:** either move
  `migrations/` to `config/db/migrations/` and `schema.snapshot.json` to `config/db/`, or set `migrations` and `snapshot` in `config/db.ts` to
  where they are now. Then set `"migrations_dir"` on each `d1_databases` entry to the same directory. Replace a `node_modules/@y-core/forge/…`
  path in `schemas` with `forgeSchema("auth")` and run `forge db migrate compose` once, so the snapshot records the new key
  ([`src/tooling/db/README.md`](src/tooling/db/README.md) section "Declaring what forge reads").

- **`dbSchemaStep` is renamed `dbSteps` and adds `db:lint`**, which runs `forge db lint` against the local database in `full`, behind the
  installed workerd runtime, in `@y-core/forge/tooling/gate`. `cloudflareWorkerSteps({ db: true })` emits all three rows. **Migration:** rename the import
  ([`src/tooling/gate/README.md`](src/tooling/gate/README.md)).

- **`VerifyViewProps.reissueAfterMs` is replaced by `resendWaitMs`**, the time left in the reissue window, and the `resent` redirect now carries
  when the code was asked for (`?resent=<ms>`). A `views.verify` override that read `reissueAfterMs` reads `resendWaitMs` instead, which is
  absent once the window has passed.

- **Backup artifacts are `formatVersion` 8**: the manifest gains `via` (`read` or `export`) and `bookmark`. **Migration:** take each backup
  again; `forge db restore` refuses a version-7 artifact by name.

- **`forge db migrate compose --rename` now needs `--allow-destructive <digest>`**, as a drop does. **Migration:** run the compose, read the
  plan it prints, and pass the digest it names.

- **`forge db lint` judges a target**: it reads the migrations the target (`--target`, `local` by default) does not hold yet, and takes no file
  arguments and no `--strict`. The `drop-column`, `rename`, `table-rebuild` and `unique-index-on-existing-table` rules are removed, and every rule
  is an error. **Migration:** drop file arguments and `--strict` from scripts; a drop or rename is approved by compose
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **Every migration must carry a valid compose stamp**, in `@y-core/forge/tooling/db`. `forge db migrate compose --custom`,
  `ComposeOptions.custom`, `MigrationOrigin`, `Migration.origin` and the `custom-ddl` lint rule are removed. `forge db lint`,
  `forge db migrate`, `forge db standby reset` and `forge db deploy` refuse a pending migration with no `forge:compose` stamp, or one edited
  since compose wrote it, before anything is applied. **Migration:** change `schema.sql` and compose. A data step is a seed
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **`drop-no-if-exists` no longer runs over a seed**, in `@y-core/forge/tooling/db`; the schema check refuses any drop a seed makes
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **No `forge db` flag passes a migration or seed refusal**, in `@y-core/forge/tooling/db`. `--no-lint` (migrate, standby reset),
  `--allow-warnings` (migrate, deploy, seed), `--allow-drift` (migrate, seed) and `--allow-pending` (seed) are removed, and so are
  `MigrateOptions.lint`, `allowWarnings` and `allowDrift`, `DeployOptions.allowWarnings`, `StandbyResetOptions.lint` and the matching
  `runSeedApply` options. Every seed rule is an error on every place, `LintLevel` and `LintFinding.level` are removed, a printed finding loses
  its level prefix, and `forge db lint --json` drops `errors` and `warnings`. A moved fingerprint is refused until the database is restored; a
  fingerprint never certified is still certified by a `forge db migrate` with nothing pending. **Migration:** drop the flags and fields; write a
  seed's `INSERT` as `OR IGNORE` or `ON CONFLICT`; restore a drifted database ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **`DbIo` gains `splitD1`**, the statements a local home's own handle cuts SQL into. **Migration:** a `DbIo` written by hand implements it.

### Added

- **`forge db seed apply` refuses a seed that changes the schema**, judged by running it on a scratch copy of the target's schema one statement
  at a time. A row-constraint failure there is passed over, and any other error refuses the seed, naming the statement. `standby reset`'s seeds
  are held to it too ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **`forge db lint`, `migrate`, `deploy` and `standby reset` refuse a drop or rename its file does not approve**, judged on a scratch copy of the
  target's schema, on every target ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **Compose writes one approval line per drop and rename**, in `@y-core/forge/tooling/db`: `forge db migrate compose --allow-destructive
  <digest>` is asked for whenever the plan drops a table, a column or a view, or renames one, and writes `-- forge:drops` and `-- forge:renames`
  lines under the header, inside the stamp. The analysis pairs each line with what the file does, one to one
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **`forge db backup --via export`** has `wrangler d1 export` write the rows of a database too large to read, keeping the artifact layout `forge db
  restore` reads. It records a deployed database's Time Travel bookmark, and refuses a virtual table and each value the export would not reproduce:
  a `\n` or `\r` escape beside its real control character, an integer past ±2^53, and an integral REAL outside REAL affinity. It reads the export
  back a page at a time, checks each table's count taken just before the export, and refuses a schema change between its two exports even under
  `--no-verify`; it never compares the rows' contents with the source, and pays off only for a remote one
  ([`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §5b).

- **`forge db deploy` applies pending migrations, then runs `wrangler deploy`**, as the Workers Builds deploy command. It refuses a deployed
  database with a migration no longer on disk, an edited one, a moved fingerprint or a row forge never applied in wrangler's history table, the entry's `migrations_table` or `d1_migrations`. A token
  Cloudflare refuses names `Account → D1 → Edit`, in `forge db migrate` too, and says whether anything had been applied by then.
  `--check-only` stops after the checks. A failed deploy after an apply prints the bookmark's restore command. With migrations pending it asks
  first, as `forge db migrate --target remote` does; a Workers Builds deploy passes `--yes`. `forge cf sync --commit` notes
  that D1 write access is unverified unless it created a database ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9a).

- **`forge cf sync` holds each `env.<name>` block's D1 entries to the account**: it reports an environment with no `d1_databases` or missing a
  top-level binding, writes back a `database_id` its `database_name` resolves and a stale `preview_database_id` a `<name>-preview` database
  replaces, and reports an id that resolves to nothing. A handler may now carry `reconcileConfig`, a `ConfigPass` over the whole config
  ([`src/tooling/cf/README.md`](src/tooling/cf/README.md) section "Placing a D1 database").

- **`forge cf sync` places D1 databases**, from a new `config/cf.ts` (`CfHostConfig`, in `@y-core/forge/tooling/cf`). A database is created with
  its declared jurisdiction and location hint; a jurisdiction mismatch is `refused`, a replication mismatch is `drift` and set on `--commit`, and
  `preview: true` provisions `<name>-preview` and writes back `preview_database_id`
  ([`src/tooling/cf/README.md`](src/tooling/cf/README.md) section "Placing a D1 database").

- **`forgeSchema`, `standbyHome` and `standbyStatePath` in `@y-core/forge/tooling/db`.** `forgeSchema("auth")` names forge's schema in
  `DbHostConfig.schemas` by its package specifier. `standbyStatePath(config)` is the directory a standby database persists under, for a script
  that reaches it with wrangler.

- **`d1Sessions` in `@y-core/forge/storage/db` reads your own writes from a D1 replica**: one session per request, `first-primary` for a write
  and, under a `bookmark` carrier, the incoming bookmark or `first-unconstrained` for a read, with the bookmark returned in that header or cookie;
  without a carrier every session starts `first-primary`. It queues the bookmark for
  Forge to merge, so a WebSocket `101` keeps its socket, and sets the cookie only when the bookmark moves, since a cookie makes a `public`
  response `private`. `resolveD1Client` and `defineD1Binding`'s client query through the request's session. `createD1Client` now takes a `D1Queryable` — a binding or a session — and
  `fakeD1` gains `withSession` and records each constraint on `sessions` ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g).

- **The opt-in lint rule `forge/sql-delete-authorised`** reports a `sql` `DELETE` with no `// row-removal-authorised-by:` comment on the line
  before it ([`src/tooling/lint/README.md`](src/tooling/lint/README.md) section "Scoping a rule to part of the tree").

- **`explainPlan`, `usesIndex` and `scansTable` in `@y-core/forge/testing/d1`** assert a query's plan on the test database, so a query that
  loses its index fails a test ([`src/testing/README.md`](src/testing/README.md) section "Asserting that a query uses its index").

- **`D1Client` reports cost and placement, and logs one `d1.query` record per call**, in `@y-core/forge/storage/db`: `meta.cost`
  (`rowsRead`, `rowsWritten`, `durationMs`) and `meta.servedBy` (`region`, `primary`) where D1 reports them, and a record carrying the SQL text,
  cost and placement but never a bound value, at `warn` past the new `slowQueryMs` option. A batch logs `d1.query` with `op: "batch"` rather than
  `d1.batch` ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1a).

- **`D1Client` refuses a statement over D1's limits before sending it**, in `@y-core/forge/storage/db`: more than 100 bound parameters or
  100,000 bytes of UTF-8 fails with a `limit` `D1Failure` and `meta.attempts` 0, naming the `json_each` idiom, which binds a list as one
  parameter. `D1_LIMITS` holds the limits, and `forge db lint` gains `table-too-wide` for a table of more than 100 columns
  ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1h).

- **`defineD1Binding` in `@y-core/forge/storage/db` wires a D1 binding in one declaration**: its `spec` for the boot binding check, the
  schema-health monitor as `globals`, the `<name>` and `<name>:schema` checks as `health`, and a `client(c)`. `schemaHealthCheck` and
  `schemaHealthMonitor` take `recheckMs` (60 s by default) and read the schema again after it, so drift that starts mid-isolate is seen, and its
  monitor and schema check share one schema read per `recheckMs` window
  ([`src/storage/README.md`](src/storage/README.md) section "Mounting a D1 database").

- **`@y-core/forge/testing/d1`: `openTestD1` runs a test against wrangler's local D1 with every migration applied**, in wrangler's number order,
  from the directory `config/db.ts` names, loaded and refused as `forge db` loads it; `hostConfig` names another module. A handle has its own
  database; `reset()` empties it and re-applies the migrations without restarting. Node-only, off the `testing` barrel
  ([`src/testing/README.md`](src/testing/README.md) section "Running queries against real D1 in tests").

- **Typed D1 failures and retry, in `@y-core/forge/storage/db`.** `classifyD1Error` and `D1Failure` sort a D1 error into `constraint`,
  `transient`, `overloaded`, `limit`, `timeout`, `guard` or `unavailable`. `execute` and `batch` take `{ idempotent: true }`, which retries a
  `transient` failure with jittered backoff and never any other kind ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g).

- **`forge db compose` ends a migration that creates or changes an index with `PRAGMA optimize;`**, so the planner's statistics follow the new
  index ([`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4).

- **Administrator approval in `@y-core/forge/auth/web`: `defineApproval`, `requireApproval` and `registerApproval`.** `requireApproval` holds
  any route until the session has presented a configured code inside the approval's window, and sends it to the prompt `registerApproval`
  mounts. With the code unset, every approved route and the prompt answer 404. The prompt is `ApprovalView` over `approvalSchema`, with types
  `Approval`, `ApprovalOptions` and `ApprovalViewProps`. The window defaults to `APPROVAL_TTL_MS`, exported from `@y-core/forge/auth`.
  `defineApproval` requires `origin`, `rateLimit` and `ring`, and throws without any of them; forge picks no numbers. The session holds a keyed
  digest of the code under `ring`, never the code, so changing the code ends every approval made under the old one. Signing in or out clears
  the approval ([`src/auth/README.md`](src/auth/README.md) section "Requiring administrator approval on a route").

- **A Turnstile challenge on the anonymous auth forms, in `@y-core/forge/auth/web`: `AuthWebOptions.turnstile`.** It covers sign-in, sign-up,
  and the verify page's code and resend forms (`AuthTurnstileFlow`), narrowed by `flows`, with forge naming each form's action in
  `AUTH_TURNSTILE_ACTIONS`. A refused challenge answers `422` with the form re-rendered, the resend form included; only a resend's
  account-dependent outcomes share the `resent` redirect. An unreadable resend body is logged at `warn` as `auth.resend.unreadable`
  ([`AUTH_MOUNTING.md`](docs/AUTH_MOUNTING.md) §8).

### Fixed

- **`forge db restore` and `forge db reset` check a table without holding all its rows in memory.**

- **`forge db backup` refuses a schema change made while it reads the rows, even under `--no-verify`.**

- **The verify page's resend button re-enables once the reissue window has passed.** It was disabled for as long as `?resent` stayed in the
  URL, reloads included; the server now works out the remaining wait from when the resend was asked for, and "You can ask again in" names it.

- **The auth README and `src/auth/schema.sql` no longer call the schema's foreign keys documentation.** D1 always enforces them, so each
  `ON DELETE CASCADE` fires; a workerd test now holds that with no pragma set.

- **`schemaHealthCheck` keeps a newer schema check when an older one settles after it.** A check that finished on a mismatch or an error
  cleared the cache whether or not a later check had replaced it, so the next poll read the schema a third time.

---

## [0.5.6] — 2026-10-16

### Added

- **`@y-core/forge/testing/form`, a node-loadable bundle of what a workerd spec submits a form with.** It carries `mintTestCsrfToken`,
  `CSRF_FIELD_DEFAULT`, `CSRF_HEADER_DEFAULT` and `FORM_MAX_BYTES_DEFAULT`; `mintTestCsrfToken` stays on the `./testing` barrel too.
- **`forge.node` in `package.json` declares every subpath a Node process imports, and the gate holds the export map to it.** The new
  `validate-node-exports` row (`nodeExportsStep`, `checkNodeExports`) fails a listed subpath whose `import` is not a generated `.mjs`, naming it and
  `bun run gen:bundles`, and an `.mjs` export the list leaves out. `nodeBundles` derives each bundle row and its watched files from the list, so
  adding a Node-reached export needs no edit to `config/bundles.ts` ([`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md) §2n).

### Fixed

- **A consumer's workerd spec could load nothing from forge but `serveWorker`.** Every other surface it needed was TypeScript source, which node
  refuses under `node_modules` with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, so the spec never ran. Forge's workerd suite now installs the
  tarball `bun pm pack` makes and loads every `forge.node` subpath under node, so a surface left unbundled fails in forge. **Migration:** import the CSRF
  helpers and the form defaults in a workerd spec from `@y-core/forge/testing/form`, and keep any helper a spec imports free of
  `@y-core/forge/testing`.

### Changed

- **The consumer pin form has one home, `FORGE_CONSUMPTION.md` §4c:** the released tarball by URL. Forge's
  other mentions cite it, and the ones that described a `codeload` tarball are corrected.
- **The bundle drift rows are renamed to `validate-<subpath>-bundle`**, derived from the subpath: `validate-lint-plugin` is
  `validate-tooling-lint-plugin-bundle`, and `validate-chromium-bundle`, `validate-totp-bundle`, `validate-harness-bundle` and
  `validate-wrangler-bundle` gain their full subpath. A `verify --only` naming an old label must use the new one.
- **`./tooling/lint/plugin` and `./tooling/gate/chromium` gain a `types` condition**, the `.ts` entry each bundle is built from; the `import`
  target is unchanged.

---

## [0.5.5] — 2026-10-16

### Added

- **`--elevation`, a ninth shape token.** Every length in `--shadow-2xs` through `--shadow-2xl` is multiplied by it, so a shape file's
  `:root { --elevation: 0; }` flattens every recipe without restating the seven shadows in `@theme inline`. It defaults to `1`, which renders
  exactly as before; the focus ring is an `inset-ring` and is unaffected. An application's own shape file must now declare it too.

### Fixed

- **`Accordion`, `Collapsible`, `CheckboxGroup` and the `Toast` and `Alert` close buttons ignored the shape radius.** They carried bare
  `rounded`, a literal `0.25rem`, so a square shape kept a 4px corner on them. A unit test now refuses any radius utility in a `ui` source
  that does not compile to a shape token.

### Changed

- **Those five corners are now `rounded-sm`, `calc(var(--radius) - 4px)`** — 6px at the default `--radius` rather than 4px.

---

## [0.5.4] — 2026-10-15

### Changed

- **`serveWorker` always serves plain http.** A config's `dev.local_protocol: "https"` made the origin https on a self-signed certificate
  that `fetch` refuses; it is now ignored, so drop any `ignoreHTTPSErrors` a harness test carried for it.
- **`serveWorker` writes a copy of the config beside it, `.wrangler-harness-<uuid>.json`, and `harness.close()` deletes it.** A run killed
  before `close()` leaves one behind: add `.wrangler-harness-*.json` to `.gitignore`.

### Fixed

- **`serveWorker` with `entry` now starts under a config that declares `secrets.required`.** wrangler refused it with `assigned to
  Environment Variable and Secret bindings`, because the inline config kept the declaration while every secret, and `SITE_ORIGIN`, arrived
  as a var.
- **`vars`, `secrets` and `SITE_ORIGIN` now bind over `.dev.vars` under `entry`.** The app's `.dev.vars` was read for the inline config and
  replaced each value of the same name, so a test ran on the developer's local secrets and the served origin was not the Worker's
  `SITE_ORIGIN`.

---

## [0.5.3] — 2026-10-15

### Fixed

- **`@y-core/forge/testing/harness` now loads from a consumer's Playwright `workerd` project.** Node refused to strip types under
  `node_modules`, so the import died with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The subpath is now a committed bundle,
  `src/testing/harness.mjs`, held to its source by the new `validate-harness-bundle` row.

---

## [0.5.2] — 2026-10-15

### Breaking Changes

- **`AuthNotifier.send` takes a second argument, `signal: AbortSignal`**, in `@y-core/forge/auth`. Forge aborts it once the delivery deadline
  passes; pass it to your mailer's request. A `send` that keeps one parameter still type-checks, but is never told to stop.

- **`PasskeyRealm` requires `requestTimeoutMs`, and `runPasskeyCeremony` takes a fourth argument, `signal?: AbortSignal`**, in
  `@y-core/forge/auth/client`; both are `@internal`. Aborting the signal rejects the ceremony with its reason, and nothing navigates after it.

- **`validateNoMutualValuePairs` is now `validateNoValueCycles`** in `@y-core/forge/tooling/gate`, and fails a cycle of `value` edges of any
  length rather than only a pair. Each finding's `file` reads `edges a → b → a`, starting from the alphabetically first namespace.

- **`@y-core/forge/testing/workerd` is removed, with `startDevServer`, `DevServer` and `DevServerOptions`.** Start a Worker under test with
  `serveWorker` from `@y-core/forge/testing/harness` and run that suite under node; under bun the harness answers no request. `@y-core/forge/testing/node` now
  declares only what `@y-core/forge/testing/snapshot` reaches.

- **`workerdStep` runs `playwright test --project=workerd`** in `@y-core/forge/tooling/gate`, and its `parallel` option is gone. Declare a
  `workerd` project in your `playwright.config.ts`; `sources`, when given, narrow it. `browserStep` now runs `--project=chromium`.

- **The optional `wrangler` peer floor rises from `>=4.0.0` to `>=4.99.0`**, the first release with `createTestHarness`.

### Added

- **`healthCheck(checks, { timeoutMs })` bounds each check** in `@y-core/forge/app`, typed `HealthCheckOptions`. A check still pending after
  `timeoutMs` — 5 s by default — counts as `false`.

- **The signup, signin and email-change flows take a `logger` option** in `@y-core/forge/auth`. Deferred work that throws is logged there as
  `error`, or to the console when it is left out.

- **A scope's `setup` receives a `signal`** in `@y-core/forge/ui/client`, aborted when the scope is disposed. Hand it to `fetch` and to
  `addEventListener` instead of tracking a disposed flag.

- **`captureStreams(cmd, args, opts)` runs a tool with stdout and stderr captured apart** in `@y-core/forge/tooling/cli`, returning a
  `StreamCapture` of `{ code, exited, stdout, stderr }`. `exited` is false on a spawn error or a kill by signal, so a caller can tell a real
  exit 1 from a child that never answered.

- **`run`, `capture` and `captureStreams` take a `timeoutMs` option** in `@y-core/forge/tooling/cli`. A child still running at the deadline is
  killed with `SIGKILL` and reported as a non-zero exit; without the option no deadline applies.

- **`runUnchecked(cmd, args, opts)` runs a tool with inherited stdio and returns how it exited instead of throwing** in
  `@y-core/forge/tooling/cli`, as a `RunOutcome` of `{ code, exited, spawnError? }`. The barrel also exports the `SpawnSync`, `SpawnOptions`
  and `SpawnOutcome` types every spawning helper takes as its seam.

- **`serveWorker(options)` starts a Worker under wrangler's `createTestHarness`** in the new node-only subpath `@y-core/forge/testing/harness`,
  and resolves to `{ harness, origin }` once it answers. `entry` serves a test-only module in place of the config's `main` under the same
  bindings, and the Worker reads `origin` as `SITE_ORIGIN`. It replaces `startDevServer`'s `entry` and `siteOrigin`.

### Changed

- **`engines.bun` stays `>=1.4.0`, and its reason is now the Bun the release gate runs on**, which is `packageManager`'s version. It no longer
  rests on `bun test --parallel`, which `workerdStep` stopped running. The two versions now move together (`BUILD_TOOLING.md` §2m).

### Fixed

- **The apps canon's `TESTING.md` names `createTestHarness` as what takes a per-run server's port.** It still credited a library dev-server
  helper, which forge no longer ships.

- **A gate run no longer leaves its steps' temp files behind.** `createGateCommand` in `@y-core/forge/tooling/gate` runs each spawned step and
  fixer with `TMPDIR` set to a directory of its own and removes it when the step exits. A failed step's full log is still kept.

- **Deferred auth work that throws no longer rejects the promise handed to `defer`.** A store or notifier failure inside a signup, signin or
  email-change deferral is logged and settles as unavailable, and a rejecting `send` in the email-OTP factor gives the cooldown back.

- **A health check that never settles no longer hangs the endpoint**; it answers `503` with that check `false`.

- **`verifyTurnstile` returns `"timeout"` when the siteverify body stalls**, not only when the request does. The deadline now covers reading the
  response.

- **`rateLimit` answers `503` when the rate-limit binding throws**, and logs the failure as `error`, rather than failing the request with an
  unhandled error.

- **A KV log purge deletes every batch when one delete fails**, and the write then rejects naming the keys it could not delete, so the failure
  reaches `onChannelError`. A purge whose listing fails rejects the write too, where it was silently dropped.

- **A passkey request that never answers no longer leaves the button busy.** Each of the ceremony's two requests gives up after 15 s and reports
  the ceremony as failed, and disposing `mountPasskey` mid-ceremony reports nothing and does not navigate.

- **`mountTurnstile`'s disposer removes the script's `load` and `error` listeners**, which stayed attached to the injected script for the life of
  the page.

- **A failed key-ring or stand-in token resolution is retried** on the next request rather than cached, and concurrent cold requests share one
  resolution.

- **A Cloudflare API request that never answers no longer hangs the command.** Each request the `tooling/cf` client makes gives up after 30 s
  and reports a network error, `timed out after 30000ms`.

- **A remote asset download that stalls no longer hangs the build.** `fetchURL` gives the whole download, every redirect and the body included,
  120 s by default, settable with `timeoutMs`, and then fails naming the URL.

- **Waiting for the dev-server startup lock no longer spins or waits forever.** A waiter whose lock file vanished between two reads now sleeps
  before retrying, and a waiter still blocked by a live holder gives up, naming the holder's pid, once the wait outlasts twice the lock's
  staleness window.

---

## [0.5.1] — 2026-10-14

### Added

- **`PdfArchival` admits the PDF/A-3 levels `a-3b`, `a-3u` and `a-3a`** in `@y-core/forge/render/pdf`, for an archive that asks for part 3. A
  part 3 render declares `pdfaid:part` 3, is refused and audited on the same rules as its part 2 level, and is valid with no file attached.

- **`attachments` embeds files in a PDF as associated files** in `@y-core/forge/render/pdf`, each a `PdfAttachment` with a name, a MIME type, its
  bytes, a `PdfAttachmentRelationship` and a modification date. An archival render admits them only at a part 3 level. A render at any level
  refuses a missing name, MIME type or date, or a name used twice, on the new `attachment` error kind; `auditPdf` reports the same faults under
  `attachment`. The `/ID` covers the attached files.

- **`@y-core/forge/render/pdf/attachments` reads the files a PDF embeds** with `readPdfAttachments(bytes, limits)`, returning each as a
  `PdfAttachment`. It runs on Web APIs alone, caps the input size, the object count, each stream's inflated size and the total it decodes,
  stored streams included, under `PdfAttachmentLimits` — 6 MiB for each byte limit and 100,000 objects by default, sized for a Worker's
  isolate — and returns every refusal as a failed `Result`. Entries naming one embedded stream share its bytes. It reads a PDF's attachments
  only, never the rest of the file.

---

## [0.5.0] — 2026-10-08

### Added

- **`parseWranglerConfig` loads under node from `@y-core/forge/tooling/cf/wrangler`**, so a `playwright.config.ts` can read `wrangler.jsonc`
  without running under bun. The subpath is a committed bundle that exports `parseWranglerConfig` alone.

- **`_headers` carries the request-independent security headers on every rule**, so an app can serve its hashed assets and icons without running
  the Worker. `defineAssetsConfig({ securityHeaders })` takes the options the app passes `createSecurityHeaders`, and each rule gains HSTS,
  `nosniff`, `Cross-Origin-Resource-Policy` and a fixed `default-src 'none'; frame-ancestors 'none'; sandbox` CSP. `assetSecurityHeaders` in
  `@y-core/forge/security` returns the same set.

- **`cloudflareWorkerSteps()` emits both import-boundary rows an app used to append by hand.** `ssrBoundary.serverDirs` adds
  `validate-client-boundary`, which fails a module under `clientDirs` importing one of those directories at value. `vendorDir` adds
  `validate-vendor-boundary`, which fails a module in that tree importing a directory or source file beside it under its parent.

- **`derivePseudonym` in `@y-core/forge/crypto/keyring` derives a keyed, non-reversible id under the app's own ring**, so an app stops hand-rolling
  HMAC and hex over WebCrypto. It answers 64 lowercase hex characters, the same for the same ring, purpose and value:
  `await derivePseudonym(ring, { purpose: "notes-store", value: userId })` replaces an `importKey` / `sign` / hex pair. Rotating the ring changes
  every pseudonym; pin `{ ...ring, activeKeyId: oldKeyId }` to keep reading an old one. The result differs from a hand-rolled HMAC of the same id,
  so anything named by the old value is orphaned.

- **`WranglerConfig` types the `assets` block** as `WranglerAssetsConfig`, exported from `@y-core/forge/tooling/cf`.

### Fixed

- **`signoutClearsSiteData` no longer stalls the sign-out navigation about five seconds in Chromium**, which holds any response carrying
  `Clear-Site-Data: "storage"`. The sign-out now sends `"cache"`, and the next auth page posts to the new `auth.signoutSiteData` route for
  `"storage"`, once and without anything waiting on it.

- **A well-formed authenticator-app code that enrolment refuses now reads "That code did not match"**, rather than the message for a malformed
  code, which sent the user to re-check digits that were already the right shape.

- **Removing a user that an app table still references is refused with a message, not a 503.** When a foreign key to `auth_users(id)` refuses
  the delete, `AdminUserStore.remove` answers `referenced`, deletes nothing, and the admin page answers 409 asking for the account's records to
  be removed or transferred first.

- **A failed key derivation or import under a `KeyRing` is retried on the next request instead of failing every one until the isolate
  restarts.** CSRF tokens, R2 signed URLs, signed cookies, `derivePseudonym` and `sealAtRest` all resolve their keys this way.

### Breaking Changes

- **`@y-core/forge/keyring` moves to `@y-core/forge/crypto/keyring`.** Its exports are unchanged; replace `from "@y-core/forge/keyring"` with
  `from "@y-core/forge/crypto/keyring"`. The old subpath is removed with no alias. `crypto` is now a container with no import path of its own,
  like `storage` and `render`.

- **`keyRingSecrets` is renamed `parseKeyRingSecrets`.** It behaves as before; replace each call, and its errors now name `parseKeyRingSecrets`.

- **`AUTH_KEY_ID_LENGTH` is removed from `@y-core/forge/auth`.** A key id is still eight base64url characters, and `importAuthKeyRing` and
  `importKeyRing` derive every one, so an app has no length to check.

- **An icon prefix inside the asset prefix is now refused at build.** `loadConfig` and `buildAll` throw when any icon would be served under
  `paths.publicPrefix`, because each such icon matched both `_headers` rules and Cloudflare comma-joined every security header, voiding its
  `Cross-Origin-Resource-Policy`. Move the icons to a prefix of their own, such as `/static`. A `paths.publicPrefix` of `"/"` covers every path,
  so it is refused beside any icon, a `root: true` one included.

- **`createSignoutActions` returns `signoutSiteData` beside `signout`, and `authRoutes` declares `signoutSiteData: post("/signout/site-data")`.** An
  app that maps the auth routes itself maps the new action too; one using `registerAuth` gets it. **With `signoutClearsSiteData`, the
  `"storage"` half of the clear now needs the auth pages to import `@y-core/forge/auth/client` before `resume()` and to run JavaScript**, because
  that module sends the second request. An app that does not load it, such as one offering email codes and no passkeys, gets no error: sign-out
  still sends `"cache"`, but IndexedDB, `localStorage`, Cache Storage and the service workers survive it. Add the import to the auth pages' bundle.

- **`AuthStoreErrorCode` gains `"reference"` and `AdminUserOutcome` gains `"referenced"`.** A store error from a foreign-key refusal, including an
  insert naming an owner that does not exist, now carries `reference` where it carried `unavailable`. An exhaustive switch over either union
  needs the new case; a custom `AdminUserStore.remove` answers `referenced` when a foreign key refuses the user row.

- **CSRF tokens and R2 signed URLs sign under a `KeyRing` from `@y-core/forge/crypto/keyring`.** `importCsrfKey`, `importCsrfKeyRing`,
  `importSignedUrlKeyRing` and the type `HmacKeyRing` are removed, as is `CsrfTokenOptions.kid`: the token carries the ring's active key id. The
  CSRF resolver option is `ring` on `csrfProtection`, `csrfMinter` and `authNav`, typed `CsrfRingResolver` in place of `CsrfSecretResolver`;
  `createCsrfToken`, `verifyCsrfToken`, `createSignedObjectUrl` and `verifySignedObjectUrl` take the ring instead of a `CryptoKey`. Replace
  `secret: () => importCsrfKey(env.CSRF_SECRET)` with `ring: () => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET))`, importing both from
  `@y-core/forge/crypto/keyring`. **The existing `CSRF_SECRET` value is accepted unchanged**, and `CsrfConfigSchema` also accepts a
  comma-separated list, newest first, to rotate. **Every CSRF token and signed URL issued before the deploy stops verifying**: a form rendered
  before it is refused once on submit, for at most the token's one-hour life. Tests keep `mintTestCsrfToken(hexSecret, …)` as it is.

- **Signed cookies sign under a `KeyRing`: `createSignedCookie`, `createAnonymousSession` and `createFlash` take `ring` in place of their
  secrets.** Replace `secrets: [env.SESSION_SECRET]` with `ring: await importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET))`, and the anonymous
  session's `secret: (c) => …` with `ring: (c) => importKeyRing(parseKeyRingSecrets(c.env.SESSION_SECRET))`; the flash cookie's `secrets` becomes
  `ring` the same way, and the session's ring serves it. **`SESSION_SECRET` and `FLASH_SECRET` must now be hex of at least 64 characters**,
  comma-joined newest first to rotate. A value already in that form works unchanged; a shorter or non-hex one throws at import. Every app's
  `.dev.vars.example` already documents that format, but an env schema validating `minLength(32)` lets a value through that now throws, so raise
  it to the hex rule. **Every existing
  session, anonymous-session and flash cookie is invalid after the deploy**: each signed-in user signs in once more. The cookie value is
  `<payload>.<kid>.<sig>`, so a test that signs a cookie by hand passes a ring to `createSignedCookie` rather than building the value. Mark
  `SESSION_SECRET` and `CSRF_SECRET` `# forge:ring` in `.dev.vars`, not `# forge:generate`, so `forge cf sync --local --rotate` prepends a key
  rather than replacing the ring.

- **The type `AuthKeyRing` is removed; use `KeyRing` from `@y-core/forge/crypto/keyring`.** It had the same shape. `importAuthKeyRing` returns a
  `KeyRing`, and its key ids and tokens are unchanged, so nothing changes at runtime. Replace `import type { AuthKeyRing } from
  "@y-core/forge/auth"` with `import type { KeyRing } from "@y-core/forge/crypto/keyring"`.

- **`AuthOptions.secret` is renamed `ring`, and its type `AuthSecretResolver` is renamed `AuthRingResolver`**, so every option that takes a key
  ring is named `ring`. Replace `{ secret: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) }` with
  `{ ring: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) }`. The `AUTH_SECRET` value and every token and sealed factor are unchanged.

- **The gate checks and `forge cf gen env` read `wrangler.jsonc` through one loader, which validates it.** A config with no string `name`, or one
  failing the loader's schema another way, now fails `validate-asset-root`, `validate-exposure`, `validate-compatibility` and
  `validate-dev-boundary` as unparseable, and `forge cf gen env` throws on it. A gate test fixture that writes a wrangler config without `name`
  needs one. `readWranglerConfig` is removed from `@y-core/forge/tooling/cf`; use `loadWranglerConfig(path).config`.

- **`lintPluginStep`, `chromiumBundleStep` and `totpBundleStep` are replaced by `bundleStep(label, config)`** in `@y-core/forge/tooling/gate`.
  No consuming app calls them.

[0.6.1]: https://github.com/y-core/forge/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/y-core/forge/compare/v0.5.16...v0.6.0
[0.5.16]: https://github.com/y-core/forge/compare/v0.5.15...v0.5.16
[0.5.15]: https://github.com/y-core/forge/compare/v0.5.14...v0.5.15
[0.5.14]: https://github.com/y-core/forge/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/y-core/forge/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/y-core/forge/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/y-core/forge/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/y-core/forge/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/y-core/forge/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/y-core/forge/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/y-core/forge/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/y-core/forge/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/y-core/forge/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/y-core/forge/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/y-core/forge/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/y-core/forge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/y-core/forge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/y-core/forge/compare/v0.4.4...v0.5.0
