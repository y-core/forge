# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **`[Unreleased]` is the only section humans edit.** `bun run release` promotes it into a dated
> version section, with the version and the date computed — never typed. Editing a released
> heading by hand puts it out of step with the tag and `package.json`, which
> `bun run verify --only validate-changelog` refuses.

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [Unreleased]

_Nothing yet._

---

## [0.1.2] — 2026-09-06

### Added

- **`validate-build-time-boundary` — a runtime module that imports build-time code now fails the
  gate.** The `src/tooling/` restructure made membership in the container _be_ the Web-APIs-only
  exemption, but nothing enforced it: a runtime namespace could import the asset pipeline and the
  only signal was `validate-namespace-graph` asking for a declared edge — which anyone could grant,
  one edge at a time. The step fails any source outside `src/tooling/` or `src/ui/assets/build/`
  that names one of their modules at value, whether by relative path, by directory (`../tooling/assets`
  → its `mod.ts`), or by published subpath (`@y-core/forge/tooling/assets`) — the last of which
  resolves to nothing relative and so was invisible to every existing check. Side-effect and dynamic
  imports count. A **type-only** import is allowed, because it is erased before anything is bundled;
  the layering it still represents stays `validate-namespace-graph`'s to judge. Specs are exempt: a
  `.test.ts` or `.browser.ts` is never in a bundle. The rule is deliberately stronger than the
  reachability `LIBRARY_ARCHITECTURE.md` §1e states — reachability from a published subpath is blind
  to a module no barrel exports yet, and over forge's own tree it computes exactly the set a
  per-file scan already sees.

- **`validate-readme-exports` — a README export table that drifts from its barrel now fails the gate.**
  `src/ui/README.md` listed 8 of `ui/controls`' 13 exports, and the drift was silent in both
  directions: a symbol added to a barrel and not to the table is undocumented for anyone who reads
  the README rather than the source, and a row naming a symbol a rename removed is an import that
  does not resolve. The new step keys on the `> Import path: … → …` line every subpath section
  already opens with, so it covers exactly where the drift was found and any other README opts in by
  adopting the anchor. A **value** export needs a table row; a **type** export needs a row or a
  `**Types:**` mention, which is how sections such as `ui/chrome` already document theirs. Thirteen
  further undocumented exports across `ui/core`, `ui/contracts`, `ui/client`, `ui/server` and
  `ui/chrome` were found by it and documented.

- **`validate-co-location` covers all of `src`, not just `src/ui`.** Sixty-three modules outside
  `src/ui` had no test beside them and nothing said so. Twenty-one carried real behaviour and now
  carry real specs — `Forge` itself, the three `jsx` runtime modules, `cli/term`'s `ansi`/`border`/
  `codes`, the Cloudflare API endpoint builders and error classification, `logging`'s level parsing,
  the `assets` and `site` config schemas, `storage/r2`'s error type, and the `types.ts` modules that
  smuggle a class or a helper. The other 42 are exempt with a stated reason: type declarations,
  constant tables, one generated file, three `bin.ts` entry points and the test fixtures. **A stale
  exempt entry fails the check**, so the list can only shrink.

- **Every gate-check module under `src/cli/pkg/gate/checks/` now has a co-located spec.** Five had
  none — `changelog.ts`, `css-sources.ts`, `design-system.ts`, `exports.ts` and
  `modern-css-rules.ts` — which is the worst failure mode a check body can have: with no spec it
  reports green either way. 87 new tests pin every finding message each one emits, and each spec
  covers the check's refusal to pass vacuously. `design-system.test.ts` skips cleanly on a machine
  without `tailwindcss`. One gap the specs found is **pinned as it behaves, not fixed**:
  `fileURLToPathish` does not percent-decode, so a `node_modules` path containing a space fails with
  `ENOENT`. (The vacuous-match gap these specs also pinned was **not** confined to `checkCssSources`
  and `checkExports`, and the sibling checks did not all have the refusal — it was 7 of 19. See the
  vacuity entry below, which fixes it and rewrites the two specs that pinned it.)

- **`validate-readme-exports` now covers `src/storage/README.md` and `src/testing/README.md`.** Both
  drifted through the September review with nothing reading them: the storage README's three
  export-shaped type tables sat under a `## Types` section _separate_ from the subpath headings, so
  an anchor could never have seen them, and roughly 29 value exports were documented only in prose.
  Each subpath section now carries the `> Import path:` anchor and its own `### Exports` table
  covering the whole barrel — including the six UUID values and two types `storage/db` re-exports
  from the sealed-internal `crypto` namespace, and `storage/r2`'s previously undocumented
  `CONTENT_TYPE_DEFAULT` and `inferContentType`. `src/testing/README.md` gains the anchor and the
  missing `FakeD1Options` row. `ReadmeExportsCheckConfig.readme` becomes **`readmes`**, a list.

- **`validate-class-tokens` — a class that names no utility now fails the gate.** `link.tsx` shipped
  `focus-ring-outset-outset`, which matches no `@utility` and no Tailwind utility, so every `Link`
  rendered `outline-none` with nothing put back and the gate stayed green: nothing in it read class
  tokens for existence. The new step compiles `src/ui/assets/css/tailwind.css` and reports any token
  the design system produces no CSS for. It reads every string literal rather than only class
  positions — that typo lived in a module-level `const` — and names a token only when some
  dash-prefix of it is a declared utility, which is what keeps prose and non-class literals out.
  Skipped, not failed, on a machine without `tailwindcss`; specs are not scanned.

- **`mountCarouselDots` — the `Carousel` dot row now follows the strip.** `Carousel` is a scroll-snap
  strip with no script, so the server's `current` dot was a guess that stopped being true the moment
  the reader pressed a dot or swiped: the slide moved and the highlight stayed on slide one. The new
  controller observes the slides **against the strip** and moves the dot row's own server-rendered
  selected class onto the dot for the most-visible slide — both spellings are read off the rendered
  row, so a theme, a size or a caller class stays the component's business. Exported from
  `@y-core/forge/ui/client` with `CarouselDotsOptions`; the showcase wires it as the `show-carousel`
  scope. **No autoplay** is added, here or anywhere: the strip advances only when the reader moves it.

### Changed

- **`validate-design`'s eleven source detectors became eleven oxlint rules, and the step now checks
  only what a per-file linter cannot.** The detectors read markup out of raw text: a tag-frame walker
  (`endOfOpeningTag`) that tracked quote and brace depth to find where an opening tag ended, an
  `indexOf("</label>")` standing in for an element's body, and a line-at-a-time scan that could not
  tell `<Card>` inside a `<Card.Content>` from `<Card>` after it. Every one of those questions is a
  `JSXOpeningElement`, an attribute list, or a parent walk. **`UI_DESIGN_GUIDANCE.md` §4b is re-cut
  to match**: the split is what a rule has to _read_ — one parsed file, or more than one — not
  markup versus class string, which was only ever a description of what the plugin happened to
  support when the boundary was drawn.

  Three consequences. **The suppression vocabulary changed**: the two live
  `/* design-allow: <id> — <why> */` comments in `src/ui/show/components.tsx` are now
  `{/* oxlint-disable-next-line forge/a11y-live-politeness -- <why> */}`, whose reason
  `forge/suppression-needs-reason` enforces. **Every migrated rule is fixable-eligible**, which a
  `CheckStep` can never be. And **two rules that were scoped by a file-path test inside the detector
  are now scoped by `.oxlintrc.json`** — `catalog-wrong-raw-input` to `src/ui/show/**`,
  `a11y-one-live-region` off for `src/ui/core/toast.tsx` — which is the same scope, stated where a
  reader looks for it.

  **`validate-design` still runs**, holding the corpus against forge's API and both rule registers
  against the plugin: neither is a per-file question. Its `RULE_ENFORCER` register now has no `gate`
  row at all, and a row that claimed one would fail by name. `design-parse.ts` keeps the class-position
  scanner, which `validate-class-order` is the other consumer of — it executes the real `cn()` on each
  literal, so it needs the literals a text scan finds.

  **One coupling had to be broken by hand.** `forge/a11y-aria-beside-data` derived its vocabulary
  from `stateAttrs(EVERY_STATE)`, and `tooling/lint` is a leaf namespace that may not import `ui`.
  The rule hand-lists the six presence flags, and `src/ui/contracts/state-attrs.test.ts` holds the
  two lists together — so a seventh flag fails a test rather than going quietly unenforced.

- **`validate-exact-assertions` became `forge/exact-markup-assertion`, and the gate lost a step.**
  The check ran a fixpoint dataflow approximation over **eight passes** of regular expressions — a
  hand-rolled `statementEnd` that guessed where a statement ended from a line-continuation pattern, a
  `receiverBefore` that guessed backwards from a `.includes(`, and a comment-blanking pass so none of
  it tripped on prose. All of it existed to answer a question about scope, which is exactly what an
  AST gives away. The rule reproduces the check's finding set on `src/ui` **exactly** — the same four
  sites, each of which was already suppressed — and is more precise in one place the regex was blunt:
  `PRODUCES_LIST` matched `.split(` anywhere in a binding's text, where the rule asks what the value
  the binding _is_, including through a `?? []` fallback. The four `/* exact-allow: exact-assertion —
<why> */` comments became `// oxlint-disable-next-line forge/exact-markup-assertion -- <why>`,
  whose reason `forge/suppression-needs-reason` now enforces rather than the check's own parser. The
  `exempt` option is gone with the step: it was empty, and `.oxlintrc.json`'s `overrides` is where a
  file is excused now. **Scope is unchanged** — an `overrides` entry holds the rule to `src/ui`'s
  test and browser files, the tree `config/steps.ts` pointed the step at.

- **The slot-clobber rule moved from `validate-jsx` to `forge/data-slot-before-spread`, and its
  hand-written JSX scanner is gone.** `jsx-parse.ts` was a 195-line character-level tag-frame scanner
  — tracking quote modes, brace depth and a tag stack — written to answer one question the AST
  answers directly: does a literal `data-slot` precede a bare-identifier spread in the same
  `JSXOpeningElement`'s attribute list? The oxlint rule is that question, so the scanner and the
  JSX-text apostrophe class of bug it kept relapsing into are both deleted. Two consequences worth
  knowing: the rule now also reads `data-slot={"card"}`, which the quote-matching scanner could not
  see, and it is **fixable-eligible** — a `CheckStep` can never carry a fixer, an oxlint rule can.
  `.oxlintrc.json` turns it off for `*.test.tsx`, which is exactly the set `validate-jsx` never
  walked. **`validate-jsx` still runs**: its other half is a file-presence check for the two JSX
  pragma lines, which no per-node rule can state.

- **`forge/optional-prop-undefined` enforces the `?: T | undefined` convention, which was asserted as
  universal with no detector.** Every other convention here carries a `detect:` command
  ([`CODE_REVIEW.md`](.decisions/governance/CODE_REVIEW.md) §3b); this one was ~90% applied with
  nothing to notice the next exception, and the exceptions kept arriving. The rule reports an
  optional property signature whose annotation admits no `undefined`, and it found **seven component
  files** the convention had missed — `field.tsx`, `field-stack.tsx`, `timeline.tsx`, `navbar.tsx`
  and the three `ui/controls` group controls — all now widened.

  **It is scoped to `ui/core`, `ui/controls` and `ui/chrome` component files, and that scope is the
  point.** Run repo-wide it reports 836 properties, almost all of them the internal option objects
  `UI_SSR_COMPONENTS.md` §1n explicitly exempts — a syntactic rule cannot tell "a consumer constructs
  a value of this type" from "this is an options bag", so the scope is stated in `.oxlintrc.json`
  rather than guessed at per node. The corpus rule lives in `reference/10-accessibility.md` because
  the reason is an accessibility one: a bare `?:` under `exactOptionalPropertyTypes` forces
  `aria-label` into a spread, and a spread is opaque to `jsx-a11y`.

  **`checkDesign` now reads `overrides[].rules` as well as the top-level block.** It previously
  treated a rule enabled only in an override as disabled and failed the gate for it — which would
  have blocked any path-scoped rule, not just this one.

- **`catalog.md` covers every published component, and a barrel export with no row now fails the
  build.** CLAUDE.md's Growth Rules name `src/ui/design/` as the single home for "which component to
  reach for", and **19 of the 58 published components had no "Job → component" row** — nine
  (`Breadcrumbs`, `Drawer`, `EmptyState`, `FileInput`, `Kbd`, `Stat`, `Status`, `Steps`, `Timeline`)
  appeared nowhere in the corpus at all, and ten more only under `reference/`. The same changeset
  that added them had built two enforcement mechanisms for two _other_ documentation surfaces — the
  README export tables and the showcase coverage contract — while the surface the Growth Rules
  actually point builders at drifted silently behind an 18-component addition. All 19 rows are
  written, and the contract lands with them rather than after them.

  **It is a `bun test` beside `show/coverage.test.tsx`, not a gate check**, because the
  component-vs-utility predicate both existing sweeps use is runtime-only — a capitalised _function_
  on the barrel — and statically `FOUC_SCRIPT` is indistinguishable from a component. Parsing differs
  from the README precedent too: `catalog.md` has no `> Import path:` anchor, no `### Exports`
  heading, and names components in **column 2**, where `parseExportsTableSymbols` hard-codes cell 1 —
  so only `rootIdentifiers` is shared, and it becomes exported for the purpose. The escape hatch is
  `CATALOG_MISSING`, modelled on `COVERAGE_MISSING`: shrink-only, every gap requiring a non-empty
  `owner`, staleness asserted. It ships **empty**.

- **The `data-*` wiring vocabulary is declared once and derived from the constants that already name
  it.** Two independent hand-written allowlists enforced the closed-world sweep — `WIRING_ATTRS` in
  `conformance.test.tsx` (32 entries) and `STRUCTURAL_ATTRS` in `contracts/state-attrs.test.ts` (55) —
  with 31 names maintained in both and no link between them. Worse, 16 of those names were **already
  exported constants** and were being restated as string literals anyway; only `data-island-state` was
  resolved through its declaration. `contracts/wiring-attrs.ts` now declares the union as a name →
  reason record, taking eleven names from their constants directly. The five declared in
  `contracts/theme/` stay literal because `ui/contracts` is a LEAF namespace and
  `validate-namespace-graph` refuses the edge to its own subnamespace — the spec asserts them against
  those constants instead, a test being outside the graph. The table is read by **tests only**, so
  the frozen-hook technique `state-attrs.ts` documents is untouched and emitters keep their literal
  keys.

  **A stale entry now fails, so the list can only shrink** — the guard the co-location and
  exact-assertion lists already had and this one did not. Five names were exempting nothing:
  `data-duration`, `data-nav` and `data-theme` appeared nowhere but the allowlists, and `data-setting`
  and `data-tool` only in `.test.tsx` files the sweep excludes. (`data-duration` traces to
  `toast-contract.ts`'s `TOAST_DURATION_KEY = "duration"`, a dataset key never spelled `data-duration`
  in source.) The assertion belongs to the **source** sweep alone, which reads every non-test file
  under `src/ui` and can tell "unused" from "not rendered here"; the render sweep mounts only
  `ui/core` and `ui/controls` and would call most of the table stale. `data-probe`, the render
  sweep's own forwarded fixture attribute, is declared as its extra. `STATE_ATTRIBUTES.md` §4 now
  describes both sweeps and their scopes rather than one, and states the wiring-versus-enum boundary:
  `data-placement`, `data-position`, `data-decoration` and `data-as` drive `cva` variants and sit in
  wiring, which is recorded rather than left silent.

- **A gate check whose scan set is empty now fails instead of reporting a green summary.** Twelve of
  the nineteen `check*` entry points could pass having walked nothing: `checkCssSources` initialised
  `registered = 0`, and a mistyped `uiDir` made the walk empty and printed
  `0 src/ui directories are @source-scanned or registered` as a **pass** — the check silently disabled
  by a config typo. Guards now cover `jsx`, `ssr-boundary`, `co-location`, `exact-assertions`,
  `namespace-graph`, `css-sources`, `docs`, `exports` and `design`, whose second source walk was
  unguarded so every corpus rule could go unapplied while the summary still counted them. One
  `scannedNothing(what, gate, verb?)` helper carries the wording, with `verb` preserving `contrast`'s
  "measured nothing" rather than forcing one word onto a unit that is a config array.

  **The guard reads the raw walk and returns before any finding accumulates**, both of which are
  load-bearing: guarding `modules.length - exempt.size` would let an all-exempt tree report
  `0 modules` green beside a wall of stale-exemption failures, and guarding late made the refusal
  _discard_ what the check had already found. Where the count is only knowable at the end, the
  refusal is additionally conditioned on there being no findings — a check already red has no green
  to refuse.

  **Three checks stay unguarded and now say why in TSDoc.** `checkClassGroups` and `checkDesignScale`
  are single-artifact diffs with no walk; `checkAssetRoot` passes with no `assets.directory` because
  a Worker with no static assets is a valid project. Two more are guarded on their _config_ instead,
  because reaching zero is supported: `checkReadmeExports`, whose `> Import path:` anchor is opt-in,
  and `checkChangelog`, where a document holding only `[Unreleased]` is a pre-first-release project.
  `ASSET_AND_BUILD_TOOLING.md` §5i is rewritten accordingly: the count in `summary` stays, now stated
  as necessary but not sufficient.

- **`contrast.ts` had an abandoned vacuity guard: `measurements.length === 0 ? findings : findings`,
  both branches identical.** It is removed rather than completed. `measurePairs` emits one
  measurement per pair per mode, so the count is `pairs.length * 2` and reaches zero only when the
  pair list is empty — which the refusal at the top of the function already covers, making any second
  guard unreachable. The dead ternary is replaced by the reasoning, and a spec pins that two rows are
  measured per pair.

- **Three specs and three fixtures were themselves relying on vacuous walks.** `css-sources.test.ts`
  and `exports.test.ts` asserted `ok === true` over a `0 …` summary in as many words ("_no refusal
  branch guards a vacuous scan_"), and `jsx.test.ts` pinned a zero-file walk as a pass; all three are
  rewritten to assert the refusal. Worse, `design.test.ts`'s fixture carried no `.tsx` source at all,
  so once the check refused an empty source walk **all three of its oxlint-config cases would have
  passed without reading a config** — the same defect the epic exists to fix, one level up in the
  specs. New vacuity specs cover `co-location`, `exact-assertions`, `ssr-boundary`, `namespace-graph`,
  `design` and `contrast`; `checkSsrBoundary`'s entry point had no spec of any kind.

- **The eight shape tokens are now held as a set, not counted in prose.** `theme-base.css` declares
  them and a shape file re-declares exactly them, and nothing checked that: a token added to the base
  and missed in `shape-compact.css` leaves that shape silently inheriting the default, and one
  carried only by the shape file is a token no other shape can override. Neither renders as a broken
  page — the value is simply wrong. A co-located spec reads the set off the declaration block's own
  banner comment and asserts equality in both directions, plus that no `theme-*.css` declares one,
  which is the assumption the contrast audit walks on. **It is a `bun test`, deliberately, not a
  `validate-css-tokens` rule**: that step is `requires`-gated on `tailwindcss` and reports _skipped_
  without it, which would hide a pure-CSS invariant behind an optional peer dependency.

- **`?: T | undefined` reaches the types a consumer constructs a value of, not just `*Props`.** Eight
  declarations still carried a bare `?:` — `Indicator.Item`'s `placement`, `Kbd`'s `size`, both
  `Menu` checkable items' `checked`, all six of `ToolbarItemStyling`, and `NavSlot`, `NavMegaMenu`
  and `ToolbarPopover` in `ui/chrome`. Under `exactOptionalPropertyTypes` each one forces a consumer
  into the guard-form spread `{...(x !== undefined ? { … } : {})}` that the convention exists to
  eliminate. The last three are why `UI_SSR_COMPONENTS.md` §1n's test changes from "every `*Props`"
  to **"does a consumer construct a value of this type"**: a definition object handed to a component
  is a consumer input as much as an attribute bag is, and reading the rule off the name let three
  such types drift.

- **A state recipe now travels as one token of the base literal, in every component that uses one.**
  `UI_SSR_COMPONENTS.md` §3h had already ruled this — a recipe painting only under `&[aria-invalid]`
  cannot contend with one that paints unconditionally, so a `cn` argument of its own buys no
  separation — but the rule sat mid-paragraph inside the `signature()` discussion and named only
  `radio-group.tsx` and `checkbox-group.tsx`. Seven files disagreed with it: `input.tsx`,
  `textarea.tsx`, `select.tsx`, `file-input.tsx`, `slider.tsx` and `toggle.tsx` passed
  `state-invalid` as a second argument. It is now a standalone statement in §3h with its own
  admission test, and every call site follows it. **The rendered class strings change token order and
  nothing else**, and each affected spec is re-pinned. What still earns its own argument is a
  base-scope token that genuinely contends: `slider.tsx` and `toggle.tsx` keep `cursor-pointer`
  separate because `state-busy` paints `cursor: progress`, which is a real conflict — `state-invalid`
  had merely been riding along in that argument.

- **`PRESSED_PAINT` moved from `state-classes.ts` into `utils/recipes.ts`,** which is where §3i
  already routes a module-scope class const. The two-line module was split from its only neighbour
  for no reason, and its presence in the co-location exempt list was a second defect: it sat under the
  `contracts/*` block whose stated reason describes `bind-contract` alone. `recipes.ts` now has a
  real spec carrying both former assertions, so the exemption is **removed** rather than re-filed —
  `config/steps.ts:82` says the list may only shrink.

- **`Table` uses the shared vocabulary helpers instead of two hand-written spreads.** A one-off
  `classProp` helper existed to omit an `undefined` class; `renderToString` already skips an
  `undefined` attribute value (§1n), so nine other sites just write `class={cls}` and these four now
  do too. `Table.Row`'s `{...(tone ? { "data-tone": tone } : {})}` becomes
  `presentationAttrs({ tone })`, the declared home for that attribute. Rendered markup is unchanged.

- **A build-time module now has a routing rule: does it drive an external builder, or is it one?**
  `src/assets` exists to shell out — Tailwind, esbuild, a font download, a file copy — and that
  orchestration is the whole warrant for its Node-API exemption, which
  [`LIBRARY_ARCHITECTURE.md`](.decisions/governance/LIBRARY_ARCHITECTURE.md) §1e states as
  reachability rather than as a path glob. Four modules compute their artifact instead of driving a
  tool and so have no reason to sit there: `build/sprites.ts` (197 lines), `build/color.ts` (172),
  `build/cursors.ts` (126) and `build/css-tokens.ts` (91) — ~586 lines behind no external builder.
  The debt is named with a `build/` directory under `src/ui/assets` as its agreed destination; the move is not scheduled,
  but the rule is settled, so no fifth module joins the list by default
  ([`ASSET_AND_BUILD_TOOLING.md`](.decisions/implementation/ASSET_AND_BUILD_TOOLING.md) §2c).

- **The comment budget is enforced everywhere outside `src/ui`.** Ten section banners, 49 TSDoc
  blocks over 400 characters, and 80 runs of three or more consecutive `//` lines were cut to one
  sentence plus a tag, or deleted where the prose restated the code or defended a choice no caller
  can observe ([`CODE_RULES.md`](.decisions/governance/CODE_RULES.md) §5b). Rationale worth keeping
  moved to its single home — the `SyncAction` vocabulary and the `ResolvedFlags` `as const` trap to
  their namespace READMEs, `RE_ANSI`'s never-scan-with-it warning to `src/cli/term/README.md`, the
  log viewer's `data-fill-viewport` requirement to `src/logging/README.md`. Upstream MIT/ISC
  attribution headers are left exactly as written: a licence notice is not prose.

- **`CODE_REVIEW.md` §3b gains a sixth detection command, and the five it had gain the `config/**`
  glob.** No command detected a long run of `//` lines at all, so the cap §5a form 3 puts on an
  inline _why_ — one or two lines — was unenforceable; and only the first command scanned `config/`,
  so `config/steps.ts`, the file with the most `//` runs in the repository, was read by nothing.

- **`src/app`'s markup assertions are exact.** Twenty-eight `toContain` calls on rendered HTML across
  `error-page.test.ts`, `app.test.ts` and `assets.test.ts` passed on the right substring with the
  wrong encoding around it — `toContain("&lt;script&gt;")` says nothing about what follows it. The
  `Forge` boundary's 500 document is short enough to assert whole; the styled error page is not, so
  each test extracts the one fragment carrying the message — `renderError`'s banner, the `<title>`,
  the `<link>`, the `<a>` — and asserts `toBe` on it, rendering once and asserting once
  ([`TESTING.md`](.decisions/governance/TESTING.md) §3b, §3c). The `not.toContain` leak checks stay:
  proving a secret appears **nowhere** in a document is not something an exact match can say.

- **Every gate check walks the filesystem through one module.** Twenty-two `readdirSync` walkers
  across twelve check modules disagreed on three axes — whether findings came back sorted, whether a
  Windows separator was normalised, and which files were excluded — and three of them were duplicated
  verbatim. `source-scan.ts` now exports `collectFiles`, `collectSource`, `listFiles` and
  `listDirectories`, and every check reaches the disk through them. **Finding order is sorted and
  path spelling posix-normalised everywhere**, which changes the order some checks reported in.
  `lineAt` and a `suppressedBy(marker)` factory join them, replacing four copies of the first and
  two character-identical copies of the second. The gate's OKLCh conversion composes its per-channel
  clipping over `assets/build`'s OKLab matrix and sRGB transfer function instead of restating them;
  the clipping behaviour, the strict alpha-rejecting parser and every pinned answer are unchanged.

- **A stale entry in the co-location exempt list now fails the check.** Nothing held an exemption
  against the modules actually walked, and the summary subtracted the list's length regardless — so
  a path left behind by a rename both under-reported the count and silently exempted nothing. The
  list can only shrink now, which is the rule the modern-CSS deferral list already followed.
  `namespace-graph` also stopped reading the 334 test files `buildGraph` immediately discards, and
  the modern-CSS check reads each file once rather than twice.

- **A `cf sync` list that 404s now reports `unavailable`, not `error`.** The four provisioning
  handlers — D1, KV, Queues, R2 — each hand-built the same ten-step ladder and their own list-failure
  row, so a not-found never became `unavailable`, no permission was ever named, and the row never
  said which surface it was compared against. They are now four specs over one
  `createProvisionedHandler`, and every list and create failure goes through the shared
  `failureRows`. **The detail text changes**: it gains the `worker script · ` / `pages project · `
  prefix, and an auth failure names the permission the surface needs.

- **`.dev.vars` values now follow dotenv's rules, which is what wrangler pushes.** An unquoted value
  ends at the first ` #`, so `API_KEY=abc123 # prod key` pushes `abc123` rather than the comment with
  it — the README's own rotation example was mis-parsed. `\n` and `\r` inside double quotes expand;
  single quotes stay literal; a quoted `#` is kept. Everything else is unchanged: the first-`=` split,
  full-line comments, the rotate markers, and the line index. `editDevVars` carries an inline comment
  across a rotation instead of dropping it.

- **`src/ui/chrome/navbar.tsx` is split at the item-tree / shell seam.** 496 lines became
  `navbar-items.tsx` (the config vocabulary and the recursive renderers) and `navbar.tsx` (the shell).
  A pure move: no renames, no signature changes, no change to the emitted markup, and
  `@y-core/forge/ui/chrome`'s exported names and shapes are unchanged. Both halves stay `.tsx`, so the
  conformance sweep over `chrome/*.tsx` keeps covering both. Code importing from the concrete module
  rather than the barrel takes the new path for the item types and for `filterAttrs`.

- **`.decisions/implementation/UI_SSR_COMPONENTS.md` §3h now carries a verdict for all nine `@utility`
  recipes.** `border-field`, `field-chrome`, `otp-cells` and `otp-editor` pass the admission test;
  `focus-ring` and `focus-ring-outset` are near misses on `state-invalid`'s shape. Every signature and
  scope behind those verdicts is pinned in `state-recipes.test.ts`, which is the only place in the
  repo that compiles the design system in a `bun test`.

- **Every optional prop forge accepts is now declared `?: T | undefined`.** Under
  `exactOptionalPropertyTypes`, a bare `?:` forced a consumer to write
  `{...(x !== undefined ? { "aria-label": x } : {})}` instead of `aria-label={x}` — and that spread
  is invisible to `jsx-a11y`, so forty-seven of forge's own attribute sites were unlinted. The
  renderer already treats an absent and an `undefined` attribute identically, so the distinction the
  flag guards does not exist here. Rendered HTML is unchanged. This is `@types/react`'s convention
  for the same reason.

- **The pressed paint shared by `Toggle`, `ToggleGroup.Item` and `Filter.Item` is one const,**
  `PRESSED_PAINT`, rather than the same `has-[:checked]:*` triple written three times. It cannot be
  an `@utility`: the class-group derivation flattens a recipe's nested declarations into a
  base-scope signature, so a paint recipe would subsume — and delete — the resting `bg-transparent`
  and `text-foreground` beside it. Recorded as an admission test in `UI_SSR_COMPONENTS.md` §3h.
  Dead `state-disabled focus-ring` tokens that `buttonVariants` already supplies are dropped from
  `ToggleGroup.Item` and `Filter.Item`; the rendered class sets are unchanged.

- **`Toggle` and `ToggleGroup.Item` take their border width from `border-field` like every other
  control.** Both hand-wrote `border`, which pins 1px and ignores `--border-width` — so a theme that
  moved the token moved four controls and left these two behind.

- **`toneTokens(tone)` returns the tone's declaration directly** instead of rendering the whole solid
  recipe through `cva` and `cn` and then filtering the paint back out by prefix. Same string, every
  tone, and a test now pins that equivalence for all seven rather than for `neutral` alone.

- **The empty `buttonPaint` recipe is gone.** Its twelve variant cells were all `""`; the two compound
  rules it existed for — `neutral/outline` and `neutral/ghost` — are now a two-entry lookup applied
  after `toneVariants`, where the override order they depend on is visible. `buttonVariants` output is
  unchanged, so its six call sites are unaffected.

- **`Dialog.Trigger`, `Dialog.Close`, `Drawer.Trigger` and `Drawer.Close` no longer drop an explicit
  `class=""`.** They tested the caller's class for truthiness, which discards an intentionally empty
  string along with an absent one; the test is now `!== undefined`.

- **`Drawer` slides in from its edge instead of appearing on the frame it opens.** 200ms in, 150ms
  out, with `display` and `overlay` riding the same duration so the panel stays painted for the whole
  exit, and the backdrop cross-fading with it. Behind `prefers-reduced-motion: no-preference`, so a
  reader who asked for less motion still gets the instant open. `<Drawer open>` — the non-modal panel
  in the page — is untouched.

- **`NumberField.Input` aligns its value to the end of the field.** Digits are compared down a column,
  not read left to right, so a number field belongs on the same alignment as a numeric table column.
  `text-end`, not `text-right`, so it mirrors in an RTL page; a caller's own `text-center` still wins
  on merge order.

- **The showcase's `Popover` band puts its triggers on a row of their own, spaced apart.** The
  `side=top` specimen opened over the band's note, which is exactly the thing a reader needs while
  looking at it.

- **The showcase's `Toast` band is one grid instead of three disconnected rows.** It was five loose
  toasts with no container, six position boxes each holding the same meaningless toast, and a
  `duration=600000` specimen nobody was ever going to watch elapse. The six boxes stay and now carry
  a tone each — neutral, success, warning, destructive, a dismissible info — so position and look are
  read in one pass. The sixth box runs the real behaviour: a dismissible `duration=5000` toast that
  the eager `toast` scope removes when it elapses, which the showcase puts back 2000ms later so the
  cycle is watchable. **The re-arm is showcase-only** (`show-toast-cycle`, in `ui/show`); `Toast`
  itself still removes a toast for good. The tone × appearance matrix is unchanged.

### Breaking Changes

- **`src/cli` and the build-time half of `src/assets` are now `src/tooling`, and eight subpaths are
  renamed.** `cli` named an _interface_ — a terminal — where the tree actually holds everything that
  runs on a developer's machine or in CI. The new container's membership _is_ the build-time
  exemption `LIBRARY_ARCHITECTURE.md` §1e states as reachability, so a Worker-reachable module under
  `src/tooling/` is now a visible contradiction rather than an argument to re-litigate per module.
  Pre-1.0, so there are no deprecation shims — update the import.

  | Was                             | Now                                                            |
  | ------------------------------- | -------------------------------------------------------------- |
  | `@y-core/forge/cli`             | `@y-core/forge/tooling/cli`                                    |
  | `@y-core/forge/cli/term`        | `@y-core/forge/tooling/term`                                   |
  | `@y-core/forge/cli/cf`          | `@y-core/forge/tooling/cf`                                     |
  | `@y-core/forge/cli/assets`      | `@y-core/forge/tooling/assets`                                 |
  | `@y-core/forge/assets/build`    | `@y-core/forge/tooling/assets`                                 |
  | `@y-core/forge/cli/pkg`         | `@y-core/forge/tooling/gate` + `@y-core/forge/tooling/release` |
  | `@y-core/forge/cli/pkg/lint`    | `@y-core/forge/tooling/lint`                                   |
  | `@y-core/forge/assets/manifest` | `@y-core/forge/assets`                                         |

- **`@y-core/forge/assets` is now runtime-only, and is the subpath a Worker imports.** Its barrel
  published `loadConfig`, which imports `node:path`, so the name promised Worker-safety the module
  could not keep. It now exports `createManifest` and `createSpriteRegistry` and nothing else; the
  config authoring surface (`defineAssetsConfig`, `loadConfig`, `AssetsConfigSchema` and the config
  types) moved to `@y-core/forge/tooling/assets` beside the pipeline that reads it. The generated
  `.forge/assets.ts` now imports `@y-core/forge/assets`; regenerate it with `forge assets build`.
  `tests/fixtures/workers-consumer/worker.ts` is the new guard — a Node built-in reached through a
  runtime subpath fails to typecheck there.

- **`@y-core/forge/cli/pkg` is split three ways.** One ~200-name barrel fused the verification gate,
  the oxlint plugin and the release workflow, with a real import cycle between the first two. The
  rule catalogs `RULE_CORPUS_PATH` / `RULE_ENFORCER` and `MODERN_CSS_RULES` now live in
  `@y-core/forge/tooling/lint`, which the gate reads one-way; the changelog and semver parsers live
  in `@y-core/forge/tooling/gate`, which `@y-core/forge/tooling/release` builds its workflow on and
  never the reverse.

- **`forgeUiSpriteSources()` moved off `@y-core/forge/ui/assets` to the new
  `@y-core/forge/ui/assets/build`.** It imports `node:path` and `node:url`, and a bundler resolves
  before it tree-shakes, so importing the parent barrel for the glyph names alone failed under
  `esbuild --platform=neutral`. The parent barrel is now runtime-neutral. The same subpath took the
  four compute-not-orchestrate modules `ASSET_AND_BUILD_TOOLING.md` §2c named as debt — the OKLCh
  conversion, the theme-token reader, the cursor baker and the SVG-symbol half of the sprite
  builder. `buildSprites` itself stayed in `tooling/assets`: it fetches, hashes and writes, which is
  orchestration by §2c's own rule.

- **`oklchToSrgb` is no longer exported from `@y-core/forge/assets/build`.** It was a second copy of
  a policy that already had a home: the same 20-iteration chroma-reduction bisection, the same
  `l >= 1` / `l <= 0` short-circuits and the same epsilon as `toSrgbGamut` in
  `ui/contracts/theme/color.ts`, which `THEME_GENERATION.md` §2b names as the owner of the arithmetic.
  It now calls `toSrgbGamut` and converts the mapped coordinate; the private `inGamut` and
  `GAMUT_EPSILON` are gone, and `clip01` stays because `toHex` also uses it. **Every pinned answer in
  `assets/build/color.test.ts` and `ui/contracts/theme/color.test.ts` is unchanged**, including the
  hue sweep that cross-checks the two implementations against each other — that sweep reaches the
  function by deep path, not through the barrel, which is what makes the barrel removal safe and
  keeps it as the proof. **Migration:** no caller exists in the fleet; the two internal callers
  (`parseColor`'s `oklch(…)` branch and `parseColorMix`'s `in oklch` branch) are unaffected. Anyone
  needing the conversion should reach for `toSrgbGamut` plus `oklabToLinearSrgb`, which is what the
  function now is. §2b is corrected accordingly: the chroma reduction was never a second policy, only
  a duplicate. The one genuinely separate policy is the gate's `oklchToPaintedHex`, which clips per
  channel because a browser does.

- **`Pagination` no longer accepts a root `size`; pass it to the children.** The prop was inert: it
  stamped `data-size` on the `<nav>`, which nothing reads — no CSS selector, no controller — while
  every child (`.Item`, `.Previous`, `.Next`) carries its own `size` and defaults to `sm`
  independently. `<Pagination size='lg'>` therefore changed an attribute and painted nothing, and
  `Carousel.Dots` was forwarding it. The root now takes no `size`, the convention `ToggleGroup`
  already sets, and `Carousel.Dots` keeps the per-item `size` — the one that works. **Migration:**
  move `size` from the root onto the items, which is where it always took effect. `.Ellipsis` also
  moves from `h-control-sm w-control-sm` to `size-control-sm`, matching `STEP_MARKER`.

- **`store.serveObject` returns `Promise<Result<Response>>`.** It was the only one of `ObjectStore`'s
  six operations not wrapped in `result()`, against its own interface TSDoc claiming _every_
  operation returns a `Result`: it caught everything and answered a bare `500` with a `null` body and
  nothing logged, so a bucket outage was indistinguishable from a bug. A key rejected by
  `normalizeKey` now carries the same `{ ok: false, error }` the store's other operations do, instead
  of a bare `400`. **No `logger` option is added** — a store reports a fault by returning it. The
  free `serveObject(backend, …)` still returns a bare `Response`: a `404` or a `416` is a rendered
  failure, not an absent value. Callers unwrap: `served.ok ? served.data : …`.

- **`oklabToLinearSrgb` and `srgbGamma` move barrels: `assets/build` → `ui/contracts/theme`.** The
  twelve-coefficient OKLab matrix and the sRGB transfer function were written out three times — in
  `ui/contracts/theme/color.ts`, in `assets/build/color.ts`, and by import in the gate's contrast
  check — which is three places to drift while every test kept passing. `ui/contracts/theme` is LEAF,
  and LEAF constrains outgoing edges only, so it is the one of the three that can hold the shared
  function; the other two import it. Import from `@y-core/forge/ui/contracts` (or the `theme` module
  directly), not from `assets/build`. **Both gamut policies stay:** the generator reduces chroma at
  constant lightness and hue per CSS Color 4, the gate clips per channel because a browser clips.

- **A stream that is not a terminal now gets no colour, whatever `TERM` advertises.**
  `resolveColorLevel` consulted `isTTY` only in its last-but-two rule, so `COLORTERM=truecolor`,
  `WT_SESSION`, kitty/ghostty/wezterm, iTerm and any `-256color` `TERM` all answered above zero for a
  redirected stream — and `cli/core/execute.ts`, which passes `process.stdout.isTTY === true`
  precisely so "the redirected stdout stays clean", got escape sequences written into the file. The
  check now sits between the CI branch and the first advertisement: **CI runners are never TTYs**, so
  a GitHub Actions or CircleCI log keeps its truecolor, and `FORCE_COLOR` still overrides everything.
  A caller that omits `isTTY` is unaffected — the gate is `=== false`, not falsy.

- **`TruncateResult` gains `index`, the offset in the input the cut was made at.** `truncate` already
  computed it and threw it away, and `wrapLines`' hard break had no way to ask: it sliced by
  `text.length`, which includes a reset `truncate` appends whenever the head bears an escape, so a
  styled word broken across lines **lost four visible characters at every break**. Any code
  constructing a `TruncateResult` literal, or asserting one with `toEqual`, adds the field.

- **`stripComments` is removed from the `cli/pkg` barrel and `blankComments` moves to
  `gate/checks/source-scan`.** The two were near-duplicates of `blankSourceComments` that differed
  only in being wrong: `stripComments` collapsed a block comment to one space, destroying the offsets
  its callers computed line numbers from. Call `blankSourceComments` for TS/TSX and `blankComments`
  for CSS, which is block comments only — `//` is not a comment there.

- **A sprite symbol's root presentation attributes are emitted on a wrapping `<g>`, not injected per
  shape.** `svgToSymbol` copied the root `fill`/`stroke`/`stroke-*` onto every shape element, which
  overrode an enclosing `<g>`'s own value — `<svg fill="none"><g fill="red"><path/></g></svg>` emitted
  the path as `fill="none"` — and, because the shape-name alternation had no trailing boundary, also
  rewrote `<linearGradient>` as if it were `<line>`. The attributes now sit once on a wrapper `<g>`
  (sharing the node with the viewBox translate when there is one, and omitted entirely when there is
  neither), so SVG's own inheritance resolves nested overrides. **Emitted sprite and cursor markup
  changes**: an icon with root attributes gains one `<g>` inside its `<symbol>`. Rendering through
  `<use>` is unaffected; CSS selecting descendants of a symbol by element still matches, but a
  selector depending on the attribute being _on the shape_ does not. `propagateRootAttrs` is removed
  (it was never exported from the `assets/build` barrel); `extractRootAttrs` now requires an
  attribute boundary, so a root `data-stroke="…"` no longer contributes a `stroke`.

- **A cursor token that resolves to an unparseable colour now throws instead of baking black.**
  `buildCursors` mapped a `parseColor` failure to `#000000` while a _missing_ token already threw, so
  a malformed value shipped a black cursor with no diagnostic. Both parse-failure paths (the
  `data-cursor-token` signal and `cssvar()`) now throw
  `[forge-assets] cursor "…" token "…" resolved to an unparseable colour: …`. The `#000000` **default**
  for a cursor that declares no `data-cursor-token` at all is unchanged.

- **`JSXElement` is branded with a private symbol, and an unrenderable tag now throws.** The brand was
  `$jsx: true`, a plain JSON value, so any `JSON.parse`'d object satisfied `isValidElement` and
  `renderToString` emitted its `type` verbatim as the tag name — `{ "type": "img src=x onerror=…" }`
  walked past escaping, `safeUrl` and the attribute-name regex. The brand alone does not close it,
  because `createElement` is public and takes an arbitrary tag string, so `renderToString` also tests
  the tag against `/^[A-Za-z][A-Za-z0-9-]*$/` and throws `Invalid JSX tag name: "…"` on a failure (the
  app's error boundary turns that into its own 500). `JSXElement` can no longer be satisfied by an
  object literal — construct elements with `createElement` or the JSX transform. `cloneElement` is
  unchanged: object spread copies enumerable symbol keys.

- **`head` is removed from `@y-core/forge/router`.** `Forge.fetch` rewrites a `HEAD` request into a
  derived `GET` before dispatch and `dispatchMatches` compares `route.method` strictly, so a route
  declared with `head(...)` could never match — the export advertised a shape that does not work.
  Nothing in forge used it. The `HEAD` branches inside `assets.ts` and `csrf.ts` stay: they encode
  HTTP method semantics for a unit that may be composed onto a bare `createRouter`.

- **The derived `GET` is copy-constructed, and the discarded body is cancelled.** `Forge.fetch` built
  the internal GET from url + headers, which dropped `signal`, `cf`, `redirect` and `credentials` —
  a handler could not observe a client disconnect and Cloudflare's request metadata was invisible.
  It is now `new Request(request, { method: "GET" })`, safe because the branch is guarded by `isHead`
  and a HEAD request carries no body. Both HEAD returns also `await res.body?.cancel()` before
  answering, instead of abandoning the stream.

- **A guard group registers each guard once, not once per path — and `Forge.use` accepts an array.**
  `applyMiddlewareChain` looped `for (path of group.paths)` and registered a fresh `originProtection`,
  `rateLimit` and `middleware[]` per path, so a group naming two overlapping patterns (`/api/*` and
  `/api/users`) ran two limiters against one request and halved the effective budget. The group's
  paths now compile into one matcher — a single path keeps today's `createMatcher` fast path, several
  use a `MultiMatcher`, `"*"` stays the catch-all, and an empty array registers nothing. `Forge.use`
  is widened to `(path: string | readonly string[], …)` rather than gaining a private registration
  path, so there stays one documented way to register, and `MiddlewareGuardGroup.paths` is now
  `readonly string[]`. Registration order changes from path-major to guard-major.

- **`PageDefinition` is a schema-gated union, and `definePage`'s `cache` no longer clobbers a
  response's own.** A page could state `honeypot`, `turnstile`, `onBotDetected`, `onValidationError`
  or `maxBytes` without a `schema`: with no schema there is no pipeline, so the options were accepted
  and silently ignored — a declared bot guard that never ran. The type is now `PageBase &
({ schema: S } & PagePipeline | { schema?: never } & { [K in keyof PagePipeline]?: never })`, the
  forbidding arm a mapped type over the same projection, and `definePage` also throws at registration
  naming the stated keys, because the union's own diagnostic is not actionable. The key list lives
  once, as `PIPELINE_ONLY_KEYS` in `pipeline.ts`. Separately, the configured `cache` is now applied
  only to a response carrying no `cache-control` of its own — a redirect or a `no-store` refusal kept
  its own header before being overwritten with the page's, which made a one-off response publicly
  cacheable. `headers` is still applied last and still wins, and the header is computed once at
  definition time rather than per request.

- **`formatValidationIssues` is removed, because it leaked the rejected value into every log.** It
  reproduced `issue.message`, which valibot interpolates the rejected value into — a schema like
  `v.regex(/^sk_live_/)` produced `Expected /^sk_live_/ but received "sk_test_SECRET"`. That string
  was the env validator's throw, so it reached `reqLog.error`, the app logger, the KV log channel
  (whose `toPersistable` strips only `stack`) and the `isDebug` 500 body: a malformed secret written
  verbatim on every request, against `BOUNDARIES` §4a. A published export whose own README said
  "never put its output in a response" was a trap on the public surface. Env validation now renders
  `field: reason` from `issue.type` — `Invalid environment: DATABASE_URL: missing`,
  `Invalid environment: API_KEY: regex` — a closed valibot vocabulary carrying neither the value nor
  the schema's text, and `issue.expected` stays out because it can be a `v.regex` source. Fixing it
  at the renderer fixes all four sinks; `describeValidationIssue` is unchanged.

- **`cors()` marks `Vary: Origin` on refused and no-`Origin` responses too.** Only the allowed branch
  carried it, so a shared cache could store a refusal — no `Access-Control-Allow-Origin`, no `Vary` —
  and replay it to an allowed origin, which is the CORS-defeating direction. The rule is whether the
  middleware's output depends on `Origin`, and it does on both branches. **The cost, stated plainly:**
  a non-wildcard `cors()` now rebuilds every response, where the refused path previously returned the
  downstream response untouched. Conversely, `origins: ["*"]` **without** credentials now emits no
  `Vary` and leaves a downstream one alone: the ACAO header is the constant `"*"`, so marking `Vary`
  only shredded the cache key. The allowlist, the preflight header object and the `join`s are all
  computed once at `cors()` time — `matchOrigin` is now one call into the same compiled matcher — and
  `createSecurityHeaders` renders its CSP from a template computed once, substituting only the nonce.

- **`verifySignedObjectUrl` returns forge's one `Result`.** `SignedUrlOk`/`SignedUrlError` are
  replaced by `SignedUrlFailure` (the three reason codes) and `SignedUrlVerdict =
Result<string, SignedUrlFailure>`, with the object key as `data` directly — a one-field success
  object beside a `data` channel was two wrappers for one value. Read `verdict.data` where you read
  `verdict.key`, and `verdict.error` where you read `verdict.reason`; the storage README example also
  stops echoing the reason code to the client, which `ERROR_HANDLING` §1c already forbids.
  `planRotation` (`@y-core/forge/cli/cf`) likewise returns `Result<string[], RotationRefusal>`, its
  two failure fields collected under `error`, and `parseChangelog`/`promoteUnreleased`
  (`@y-core/forge/cli/pkg`) return `ValidationResult<ChangelogDocument>` and
  `ValidationResult<string>` — the parse's `unreleased`/`versions`/`linkRefs` now sit under `data`
  as the new `ChangelogDocument`, and its `errors` arm is the standard `error`.

- **`bindingSchema(name, methods, label)` is exported from `@y-core/forge/context`.** The KV, D1 and
  R2 binding validators each carried a copy of the same `v.object`/`v.check` shape; each is now one
  line, with the rejection messages byte-identical. `label` carries the article ("an R2 bucket
  binding") rather than being derived from the first letter, which is a bug the day a `Hyperdrive`
  binding is added.

- **`serveObject` owns a range contract, and `ObjectStorageBackend.get` now has a throw contract.**
  A `Range` whose first-byte-pos exceeds `Number.MAX_SAFE_INTEGER` is answered `416` with **no**
  backend call, and an oversized last-byte-pos or suffix clamps to the whole object (RFC 9110): what
  reached `R2GetOptions` before was `Infinity`, which R2 answers with a `TypeError` — a 500 for a
  client's malformed header. A backend that cannot satisfy a range throws the new `@public`
  `UnsatisfiableRangeError` (`@y-core/forge/storage/r2`), which `r2Backend.get` translates the
  platform error into and which `serveObject` catches — **only** that type — spending a `head` on
  that path alone, so a satisfiable ranged read stays one round trip. `serveObject` also now emits
  `Content-Encoding` and `Content-Language` (stored by `r2Backend` and silently dropped before),
  falls back to the object's stored `Content-Disposition` when no option overrides — dropping one
  that carries a non-ASCII byte rather than throwing from `Headers.set` — and sets
  `X-Content-Type-Options: nosniff` unconditionally. Both pre-existing 416 branches now cancel the
  body they abandon.

- **`ObjectStore` listing, prefixes, bodies and prototype keys.** Four defects, one namespace:
  `r2Backend.list` now passes `include: ["httpMetadata", "customMetadata"]`, without which a list is
  silently lossier than a `head` of the same key under the default `r2_list_honor_include` flag
  (`R2ListOptions` gains `include`; `StoreListOptions` deliberately does **not**, since a caller who
  could switch it off would get this bug back). `store.list` strips the store prefix from
  `delimitedPrefixes` too — a page mixed stripped keys with unstripped folders, and a returned prefix
  fed back into `list({ prefix })` double-prefixed. `store.get` re-keys the object by re-declaring
  its getters instead of spreading it: the spread **read** `body` and `bodyUsed`, freezing
  `bodyUsed: false` forever and, on a real `R2ObjectBody`, locking the stream. And `inferContentType`
  guards with `Object.hasOwn`, so `"upload.constructor"` no longer returns the `Object` function —
  which, being non-nullish, skipped the `?? CONTENT_TYPE_DEFAULT` fallback and sent a non-string
  `contentType` to `bucket.put`.

- **The storage fakes now refuse what the platform refuses.** A fake that is green where the real
  binding throws certifies code that fails on deploy. `fakeKV.put` throws below KV's 60-second
  `expirationTtl` floor and accepts an `ArrayBufferView` or a `ReadableStream` (which also widens
  `KVNamespaceLike.put`); `fakeR2.get` throws `UnsatisfiableRangeError` for a range lying wholly
  outside the object, while still clamping an overrun — which is what R2 does; `fakeR2.list` honours
  `delimiter` and `include`; and `fakeD1.first(column)` rejects a column the row does not carry
  instead of returning `undefined` against a declared `T | null`. TTL _expiry_ is still not modelled:
  that would need a clock, and `TESTING` §7b's no-wall-clock rule stands.

- **KV log keys changed format, and the viewer opens on the newest page.** It opened on the
  **oldest**: KV lists lexicographically with no reverse option, and the key led with an ISO
  timestamp. Keys are now `{prefix}||v2||{999999999999999 - ms, padded to 15}||{rand}`, so
  lexicographic order is newest-first. `purge` slices the **tail** accordingly —
  `keys.slice(maxLogs)`, where the old code would have deleted exactly what is worth keeping. The
  list prefix carries `v2` because an old key's third segment starts with `2` and a new one with `9`,
  so under one prefix every legacy record would sort above every new one; **existing entries stop
  listing and expire by their TTL** (7 days by default), which is why there is no migration shim.
  Filtering remains per page — a paging loop would issue unbounded billed `kv.list` subrequests in
  one invocation — but the empty state now says so when a further page exists, instead of claiming
  no matches.

- **KV log metadata is capped in bytes, not UTF-16 units — and `LogRow.level` is `LogLevel`.**
  `JSON.stringify` expands a C0 control character to six bytes, so a 256-character message serialized
  to roughly 1620 bytes, KV rejected the `put`, and the record was **lost**; the test stub did not
  enforce the limit, which is why three 256-character tests could not catch it. The channel now
  measures the serialized metadata and shrinks in a fixed order — message, then prefix (previously
  uncapped), then `requestId` — flooring at `{ level, timestamp }`, and truncates by **code point**
  rather than `String.slice`, which would split a surrogate pair into a lone surrogate costing six
  escaped bytes. The code-point count is binary-searched, so the hostile input this exists for costs
  about nine `stringify` calls rather than 256. Nothing is lost: the full record still goes into the
  KV **value** (25 MiB), so the detail view is unchanged — only the row preview truncates.
  `KvLogMetadata.prefix` and `.message` are now optional (absent only at that floor), and
  `LogRow.level` is `LogLevel`, narrowed once at the trust boundary with the already-present
  `parseLogLevel`; `LEVEL_TONE` is a total `Record<LogLevel, Tone>` and its `?? "info"` is gone.

- **The gate runner can no longer report a skipped step as passed.** `StepSkip` and `Step.skip` are
  removed; a step declares one `StepRequirement` under `requires`, and what its absence means is the
  mode's answer: a fast run prints `○ <label> — skipped (<tool> not found; run \`<hint>\`)`and a`--full`run fails the step with the same hint. That closes two holes at once — the summary counted
a skipped step in`N steps passed`, and `--full`, which `prepublishOnly`runs, honoured`skip`and
so published without the drift checks ever running.`SummaryInput`now carries`passed`, `skipped`and`failedAt: { label, at }`in place of`ran` and a bare label; the failure line states a position
(`step 3 of 7`) rather than a run count, and a run whose every selected step was skipped is red:
`✗ verify — every step skipped (0 of 3 ran, …) — refusing to report a green gate that ran nothing`.
`formatSkipped`is merged into`formatMissingRequirement(label, tool, hint, mode, style?)`,
`listLabel(step, mode)`reads`requires.tool`directly, and`formatFixSummary`takes`{ gate, fixed, unfixable, skipped }`— "skipped" now means _dependency absent_ gate-wide, and a step
with no fixer is counted as having none. The`--full`requirement line is byte-identical to before.`selectSteps`loses its prerequisite refusal, whose invariant is now true by construction, and its`only`parameter narrows to`readonly string[]`.

- **`ContrastCheckConfig.palettePath` is now `() => string`.** Resolved eagerly, it threw while the
  step-table module was being imported on a machine without `tailwindcss` — before any step ran and
  before the skip could be reported. A thunk defers it past that point and keeps
  `import.meta.resolve` in the consumer's `config/steps.ts`, where it finds the consumer's copy.

- **`StepOptions` gains `requires?: StepRequirement | null`**, replacing a step's default dependency
  or, with `null`, dropping it — for a project that vendors the dependency. The four design-system
  steps (`classGroupsStep`, `designScaleStep`, `classTokensStep`, `cssTokensStep`) and `contrastStep`
  now default to a `tailwindcss` requirement rather than a `skip`; `contrastStep` attaches it only
  when it was given a `palettePath`. The `{ hint?: string }` option those builders briefly carried is
  gone with the change — `browserStep` keeps its own.

- **Correction to released entries.** The 0.1.1 notes state that `classGroupsStep`, `cssTokensStep`,
  `designScaleStep` and `classTokensStep` are "`--full` only". They are not, and were not at release:
  each runs in every mode where `tailwindcss` resolves, and is skipped in a fast run without it.
  Released headings are frozen by `validate-changelog`, so the correction is recorded here rather
  than edited into them.

- **`SpeedDial` is removed from `@y-core/forge/ui/core`,** along with `SpeedDialPlacement`. A floating
  action button earns its place only on a screen that has neither a toolbar nor a primary `Button` in
  its header — a shape the primitive set does not target — and its `asChild` action could never close
  the panel, because an invoker `command` is honoured on a `<button>` and silently ignored on an `<a>`.
  A consumer that wants the pattern composes it from `Popover` and `Button` rows, which is the same
  markup `SpeedDial` emitted. The `forge-ui-interaction-fab-one-primary` design rule is withdrawn with it.

- **`HONEYPOT_FIELD_DEFAULT` is now `"__hp_c7"` (was `"__surname"`).** A decoy named `__surname`
  matches the browser's own autofill heuristics, which ignore `autocomplete="off"` for name and
  address fields — the browser filled the decoy for any user with a saved profile and the submission
  was refused as a bot, invisibly and with no way to recover. The new default matches no heuristic.
  An app that hardcoded the old string on either side, rather than importing the constant, updates
  both halves together; an app already passing its own name — as `src/form/README.md` recommends —
  is unaffected.

### Fixed

- **The shape-token count is eight, not seven, everywhere it is stated.** `theme-base.css` declares
  `--radius`, `--radius-field`, `--radius-box`, `--radius-selector`, `--control-h-sm/md/lg` and
  `--border-width`; four places counted the three `--control-h-*` tokens as one and said "seven" —
  `shape-compact.css`'s own header, `src/ui/README.md`, and
  [`THEME_GENERATION.md`](.decisions/implementation/THEME_GENERATION.md) §1d in three places. The
  showcase already said eight, so a reader comparing the two surfaces got a contradiction about the
  one set a consumer re-declares in full.

- **A prerelease tag no longer disables the release guard.** `git tag --sort=-v:refname` puts
  `v1.0.0-rc.1` _above_ `v1.0.0` without `-c versionsort.suffix=-`, and `getLatestTag` returned
  whatever was first. `parseSemVer` rejects it, so the auto path threw an opaque parse error and —
  worse — the explicit path's not-greater guard, written `prev !== null && …`, went **vacuous**: a
  downgrade to `0.9.0` against a tagged `1.0.0` was waved through. `getLatestTag` now returns the
  first listed tag the release scheme accepts, and `resolveVersion` parses the tag once, up front,
  and **fails** on one it cannot read rather than skipping the comparison.

- **The oxlint plugin now judges a class list bound to a module-scope `const` and passed by name.**
  It read only inline literals and bare `cn`/`cva`/`asClass` arguments, so forge's own recipes —
  written once as a constant and passed by identifier — were invisible to every class rule. An
  initializer that is already a class position of its own is still judged only where it is written,
  and a `const` declared inside a function is not resolved. `color-token-only` gained the `--tone*`
  properties as declared, since `tone.ts` sets them with `[--tone:…]` utilities that never reach the
  compiled stylesheet's `@theme` and so cannot appear in the generated scale. **Class lists passed
  by name are now judged**, which can newly fail a file that has always been green.

- **`forge/color-token-only` no longer reports the shadow family as an undeclared colour.** Tailwind
  compiles a bare `shadow-(--shadow-lg)` to `--tw-shadow: var(--shadow-lg)` — the shadow value, not
  a colour — so `shadow`, `inset-shadow`, `drop-shadow` and `text-shadow` are colour positions only
  in their explicit `(color:--x)` spelling, which the rule's pattern does not match. `ring-`,
  `outline-` and `border-` are genuine colour positions and still judged.

- **`forge/spacing-scale-only` suggested the wrong sign for a negative arbitrary length.** It took
  the magnitude of the value and re-used only the utility's own `-` prefix, so `mt-[-16px]` was told
  to become `mt-4` and `-mt-[-16px]` `-mt-4` — both the opposite of what Tailwind compiles. The
  suggestion's sign is the exclusive-or of the two now.

- **`forge/platform-logical-spacing` reported utilities that do not exist.** Its value class stopped
  at `(`, `%` and `)`, so `mr-[calc(100%-1rem)]` was reported as `mr-[calc` → `me-[calc` and
  `border-r-(--w)` as `border-r-` → `border-e-`. The whole arbitrary value is carried through now.

- **`validate-docs` no longer blanks a wrapped citation as if it were code.** Any line indented four
  spaces was treated as an indented code block, with no blank-line-before and no list-context test —
  so a citation wrapped onto a continuation line and a nested `    - …` bullet escaped _every_
  downstream check: section parsing, the rot scan, link-target existence, inter-document citations
  and path resolution. Indentation is read as code where CommonMark says so now: after a blank line,
  outside a list, running on until a line starts back at the margin. `NAMESPACE_DESIGN.md`'s wrapped
  `§5c` citation is checked against its target's sections for the first time.

- **A trailing `// note` in `.oxlintrc.json` no longer fails `validate-design` with "could not be
  read".** Its JSONC strip dropped whole comment lines only, so a comment after a value left
  `JSON.parse` to throw and the step reported the config as unreadable rather than reading it. It
  uses `stripJsonc`, which is what the `cf` config writer already parses JSONC with.

- **`validate-design` now catches a hand-written `data-busy`.** Its state-attribute alternation was
  hand-listed and had never gained `busy`, which `ui/contracts` has declared since the attribute
  shipped. The alternation is derived from `stateAttrs` itself now — a presence flag is what it
  emits with an empty value — over a `Required<StateAttrsProps>` literal, so a state key added to
  the contract without a decision here fails to typecheck rather than going silently unchecked.

- **`focus-visible:ring-0` and `focus-visible:ring-offset-2` no longer count as a replacement focus
  ring.** The rule's first alternative was an unbounded prefix, so any `focus-visible…:ring…`
  satisfied it — including a zero-width ring and an offset that carries no width of its own.

- **`validate-contrast` no longer rounds a ratio before comparing it to the floor.** A pair
  measuring 4.4951:1 passed a 4.5:1 floor in the gate while the theme customiser, which compares the
  raw value, showed it red — the disagreement `THEME_GENERATION.md` §3c exists to forbid. The
  comparison is unrounded; `toFixed(2)` is still what the message prints. **A pair within 0.005 of a
  floor now fails.**

- **Only the first `:root` block of a stylesheet was read.** A second one's declarations were
  invisible to the audit even though the cascade paints them; every top-level `:root` is read now,
  in source order, with a later declaration overwriting an earlier. The block-matching regex also
  escaped only the first `.` of a selector.

- **`.dark-overlay` is no longer read as a `.dark` mode block.** The declaration-site rule keyed on
  `\.dark\b`, which a hyphenated class name satisfies.

- **A `/*` inside a string literal no longer blanks the code up to the next real comment.** Every
  gate parser reached its source through one bare `source.replace(/\/\*[\s\S]*?\*\//g, …)`, which
  cannot tell a comment opener from the same two characters inside a string. `theme-contract.ts`
  opens a string with `"/* Generated by the forge theme customiser.` and closes it seven lines
  later, so `validate-modern-css` had been reading that span as a comment and finding nothing in it.
  `blankComments` and `blankSourceComments` are now one pass that tracks strings and comments
  together, so neither can start inside the other, and `css-parse` and all four of `barrel-parse`'s
  `//` passes route through it — a block-commented `export` no longer counts as live, and a line
  carrying `https://` no longer loses its tail. **Previously-passing files may newly fail**: the
  parsers now see code a string-borne `/*` used to hide.

- **`findThemeTokens` reported the wrong line after a multi-line comment.** Its stripper replaced
  each block comment with a single space, so every line number computed from the stripped text
  shifted by the comment's height. The blanking is space-for-space and line-preserving now, which is
  what makes the reported line the line the token is written on.

- **A JSX-text apostrophe no longer hides every element after it from `findSlotClobbers`.** Its
  `skipQuoted` had neither a newline bail-out nor a fallback, so `<p>Don't close this</p>` scanned
  forward to the next `'` anywhere in the file — and an unterminated string returned the file
  length, silently ending the scan. A `'` or `"` that reaches the line end is now read as data, and
  one is treated as a string opener only inside a tag or an expression container.

- **`cf sync --commit` can write an id into a single-line entry that already ends in a comma.**
  `applyJsoncEdits` appended `, ` unconditionally in that branch, over an offset already past the
  existing comma, so `{ "binding": "CACHE", }` became `,,` — text `writeWranglerConfig`'s round-trip
  check refuses, reporting a bug in the writer. Because the resource is created on Cloudflare before
  the write, every re-run matched it by name and scheduled the same doomed edit; the id never landed
  without hand-editing. The same function's CRLF probe indexed the outer source with an offset into
  the object's interior, so an empty multi-line object in a CRLF file gained an LF — a change no
  round-trip check catches, since the text parses identically.

- **`cf sync` no longer writes `queue_id` into the wrangler config.** wrangler 4.124.0 validates
  `queues.producers` against `binding`, `queue`, `delivery_delay` and `remote`, so every run after a
  queue sync warned `Unexpected fields found in queues.producers[0] field: "queue_id"`. The field is
  still **read** — a config that already carries one resolves by id and a stale id is still named on
  its row — and the remote id still appears in the report; nothing forge writes will carry it again.

- **A `sync zone` phase that was never written no longer reports `updated`.** The commit loop skips
  an in-step phase without ever PUTting it, but a run-scoped `committed` flag was passed to every
  row, so a different drifted phase writing successfully relabelled the untouched one. The write is
  now recorded on the phase it belongs to. The `--json` output was never affected.

- **A rejected secret write no longer reports the secret as absent.** `remote` conflated "the write
  succeeded" with "the name is present remotely", so a failed PUT or PATCH against a secret the
  listing had just returned rendered `Remote: no` while the old value sat untouched on the remote.
  The Pages branch was the worse case: one rejected PATCH marked every batched write at once.

- **`cf gen env` no longer corrupts a comma before a bracket inside a string.** It stripped comments
  with a gen-local copy of `stripJsonc` and then bolted on the string-unaware
  `/,(\s*[}\]])/g` trailing-comma regex the shared parser was rewritten to eliminate, so a
  `CSP_TEMPLATE` containing `, ]` was silently rewritten while `loadWranglerConfig` read it intact.
  `readWranglerConfig` is now the shared `stripJsonc` and the gen-local copy is deleted; it was never
  exported from `mod.ts`.

- **`cf gen env` recognises every `.dev.vars` key the rest of the tool does.** `collectVars` matched
  only `/^[A-Z_][A-Z0-9_]*=/`, so `STRIPE_KEY = x` and `lower_key=1` — both accepted by dotenv, by
  wrangler and by this repo's own `parseDevVars` — were absent from the generated `EnvSchema` and the
  app booted with a var no schema knew about. It now calls `parseDevVars`, and `emit` quotes a name
  that is not a valid identifier so the generated module still parses.

- **`sanitizeSVG` strips an event handler written with whitespace around its `=`.** The `on*` rule
  required `=` to follow the attribute name immediately, so `<circle onclick = "evil()"/>` came back
  unchanged — while the `href` rule one line above already allowed the spacing. The two patterns now
  agree. The gap survived because the tests asserted `not.toContain("onclick")`, which passes against
  markup that still carries `onclick = "evil()"`; every markup assertion in `sprites.test.ts`,
  `cursors.test.ts` and `site.test.ts` is now an exact match on the whole emitted string.

- **Every `currentColor` in an icon source is resolved before rasterising, not just the first.**
  `buildIcons` used a string-pattern `replace` for the bytes it hands `sharp`, so an icon setting both
  `fill="currentColor"` and `stroke="currentColor"` reached sharp with the second unresolved and
  rendered it black. `favicon.svg` was never affected — it goes through the `<style>` injection.

- **`parseColor` accepts 3- and 4-digit hex.** `#fff` parsed as `null`, which mattered because
  Tailwind v4 emits short forms (`--color-white: #fff`) and `buildCursors` mapped the null to black.
  Each nibble is now doubled before the existing parse, so `#abc` reads as `#aabbcc` and `#abcf` as
  `#aabbccff`.

- **The `_headers` cache rule follows `paths.publicPrefix`.** `emitHeaders` wrote a rule for the
  literal `/assets/*` and was never handed the configured prefix, so a build with
  `publicPrefix: "/static"` shipped an immutable-cache rule matching none of the hashed URLs the
  manifest resolves. The rule path is now the prefix, normalised the same way `createManifest`
  normalises it (one trailing slash stripped, so `"/"` degrades to `/*`), which is what keeps the
  build-time rule and the runtime URL from disagreeing. Builds on the default prefix are unaffected.

- **A second CSS entry no longer deletes the first one's emitted file.** `buildCSS` purged _every_
  `.css` in the output directory before each build, and both `buildAll` and the `assets css` CLI
  command loop every `css[]` entry into the same public directory — so `css: [{ output: "styles.css" },
{ output: "print.css" }]` left the manifest naming two hashed files and only `print.<hash>.css` on
  disk, making `assets.path("styles.css")` a production 404. The purge is now restricted to the
  entry's own output stem, the same shape `buildSpriteGroup` already used, and it skips dotfiles.
  **Known limit:** a `.css` left behind by a config entry that has since been _removed_ is no longer
  swept — that is a `clean` command's job, not a per-entry builder's.

- **`Slider` no longer lets the class sorter resolve `cursor-pointer` against `state-busy`.** Both sat
  in one bare string literal, and `state-busy` paints `cursor: progress` conditionally — the exact
  shape [`UI_SSR_COMPONENTS.md`](.decisions/implementation/UI_SSR_COMPONENTS.md) §3h forbids, and
  which `Toggle` already handled correctly. `cursor-pointer` now travels in its own `cn` argument,
  where cross-argument precedence is what §3e guarantees a sorter cannot reach.

- **`Link` renders a focus indicator again.** Its base class was the typo `focus-ring-outset-outset`,
  which matches no `@utility`, so every `Link` in the library had `outline-none` and nothing put back.
  The `validate-design` focus-ring check did not catch it because that check only looks at class
  strings also carrying `cursor-pointer`; its `FOCUS_VISIBLE_RING` pattern additionally rejected the
  legitimate `focus-ring-outset`, and now accepts it while still rejecting an unknown suffix.

- **`<Button asChild loading loadingIcon={…}>` no longer drops every prop.** With a spinner to render,
  Button wrapped its children in a Fragment and merged onto that — and a Fragment carries no
  attributes, so the class, `data-slot`, `aria-busy` and every caller prop vanished silently. The
  spinner is now injected into the cloned child. `cloneAsChild` rejects a Fragment outright, which
  closes the same hole for every `asChild` component and makes its documented error message truthful.

- **`busy` paints on `Switch` and `Toggle`.** Both put `aria-busy` on the inner input and
  `state-busy` on the wrapping label, but the utility only matched the element carrying the attribute
  — so the prop did nothing at all. It now also matches through `:has()`, the shape `state-disabled`
  and `state-invalid` already used.

- **`CheckboxGroup` and `RadioGroup` no longer put `aria-invalid`/`aria-busy` on their `<fieldset>`.**
  Neither attribute is valid on the implicit `group` role; the `data-*` state hooks the CSS reads stay,
  and an `Item` carries the aria on the input, where the role allows it. The state spread also moved
  ahead of the caller's props, so a caller-supplied aria attribute now wins — matching how
  `aria-describedby` already behaved. `RadioGroup`'s fieldset gained the `role="radiogroup"` it was
  missing.

- **A `Filter` chip keeps a visible focus indicator in forced-colors mode.** The chip's `focus-ring` is
  a `box-shadow`, and shadows do not paint under `forced-colors: active`, so a focused chip had no
  indicator at all. §9 of `forge-ui.css` now restores an outline for `filter-item` alongside its
  chosen-state colours. `CheckboxGroup` and `RadioGroup` — the two components §9 was written about —
  gained the forced-colors browser coverage they never had.

- **`isHoneypotFilled` no longer treats a whitespace-only value as a bot signal.** A single space
  left by an extension or an autofill pass tripped the guard and refused a legitimate submission.
  The string case now trims before the length check; a `File` value is still judged on its size, so
  a zero-byte file remains "not filled".

- **`Honeypot` renders `autocomplete="new-password"` instead of `autocomplete="off"`.** `off` is the
  token browsers feel free to ignore on fields their heuristics recognise; `new-password` is the one
  they honour as _never autofill this_. Defence in depth behind the field-name change above.

---

## [0.1.1] — 2026-09-04

### Breaking Changes

- **Eight design rules moved from `validate-design` and `validate-modern-css` to forge's oxlint
  plugin, and their detectors are gone from the public surface.** `findArbitraryValues`,
  `findColorLiterals`, `findTagSizedHeadings`, `findUnguardedAnimations`, `findViewportUnits` and
  `logicalUtility` are no longer exported from `@y-core/forge/cli/pkg`, and nothing replaces them on
  that barrel — the plugin owns the detection now. `RuleId` and `RULE_CORPUS_PATH` moved from
  `gate/checks/design-parse` to `gate/checks/design-rules`, under the same names. A consuming app
  that names steps through `config/steps.ts` adds three steps — `classGroupsStep`, `cssTokensStep`
  and `designScaleStep`, each described under **Added** below — and all three are `--full` only.

- **`forge-ui-viewport-units` is retired.** Two class names are a restriction list rather than a
  rule, and `floor.md`'s prose says the same thing without an id. The guidance stays; the marker,
  the detector and the `MODERN_CSS_CITED_RULES` entry are gone. Per
  `UI_DESIGN_GUIDANCE.md` §3b the id is never reassigned, so a citation that outlived it lands on
  nothing rather than on a different rule.

### Added

- **Eight class-string rules now read the AST instead of the line.** `forge/spacing-scale-only`,
  `forge/color-token-only`, `forge/a11y-heading-size-by-class`, `forge/reduced-motion`,
  `forge/platform-entry-motion`, `forge/platform-logical-spacing`, `forge/platform-text-balance` and
  `forge/platform-text-pretty` live in `@y-core/forge/cli/pkg/lint` and run under the `lint` step.
  Three competing regex extractors became one, anchored to a real class position — a
  `class`/`className` attribute, a `class:` object property, or an argument to `cn`/`cva`/`asClass`
  — which removes a whole class of false positive by construction: `validate-modern-css` no longer
  reads the CSS property names in the generated `class-groups.ts` as class strings, nor the word
  "prose" in an English sentence.

  Four consequences worth knowing before upgrading, each of which can turn a green tree red.

  **The three Tier-B/C rules became blocking.** `validate-modern-css` forced
  `forge/platform-entry-motion` (Tier B), `forge/platform-text-balance` and
  `forge/platform-text-pretty` (Tier C) to `warn`; `lint` runs `--deny-warnings`, so each is now an
  error rather than a warning.

  **Three rules report input the old detectors passed in silence.**
  `forge/platform-text-balance` reads `text-8xl` and `text-9xl` beside the `text-2xl`–`text-7xl` it
  already covered. `forge/platform-logical-spacing` reads a negative inline margin, reporting
  `-ml-4` as `-ms-4` and `hover:-mr-2` as `hover:-me-2`. `forge/color-token-only` reports a palette
  custom property written without its namespace — `bg-(--red-500)` — because the palette is declared
  as `--color-red-500` and only that spelling resolves to a token.

  **`forge-ui-reduced-motion` was enforced twice with different scopes and is now enforced once, as
  the union** — `animate-*` _and_ `transition*`, at `error`, gated on the whole class expression so
  a `motion-reduce:` in a sibling `cn()` argument still counts.

  **The scope widened**: oxlint reads every `.ts`/`.tsx` under `src/` and `config/`, where
  `validate-design` walked only non-test `.tsx` and `validate-modern-css` only `src/ui`.
  Suppression follows the mechanism — a plugin rule takes
  `oxlint-disable-next-line forge/<key> -- <why>`, not `design-allow`, and a `design-allow` marker
  left behind for a migrated rule now suppresses nothing. Entry motion, for one, is
  `// oxlint-disable-next-line forge/platform-entry-motion -- <why>`.

- **`validate-design-scale` and `bun run gen:design-scale`.** `src/cli/pkg/lint/data/design-scale.ts`
  is generated from the compiled stylesheet and holds what the two data-driven rules resolve
  against: the `--spacing` step size, the roots that read it, the steps the scale offers, the
  colour-bearing roots and the theme's colour tokens. That file is the register — read the counts
  there rather than from prose that would drift. `spacing-scale-only` therefore names the
  utility that would replace an arbitrary value — `p-[8px]` reports `p-2` — instead of refusing
  every `px`/`rem` value on a hand-listed set of 31 roots. The step is `--full` only, for the reason
  `validate-class-groups` is: `tailwindcss` is an optional peer.

- **`validate-design` now holds each rule against the mechanism that enforces it.**
  `gate/checks/design-rules.ts` names, per corpus id, whether a check step or the plugin enforces
  it; the gate fails by name when a detector is deleted, when the plugin stops registering a rule,
  or when `.oxlintrc.json` stops enabling one. Without it a `RULE_CORPUS_PATH` row for a migrated
  rule would have asserted nothing.

- **A scale token is namespaced away from colour, and `--text-size-*` is the reserved spelling.**
  Tailwind's `--text-*` namespace carries font size while the `text-*` utility also carries colour,
  so an app's `--text-hero` produced a class indistinguishable from a colour — and `cn` read it as
  one: `cn("text-hero text-red-500")` returned `text-red-500` alone, in the app's markup, with no
  error. Declaring the step `--text-size-hero` instead gives `text-size-hero`, which the conflict
  table now resolves to the font-size group the design system itself states, so it merges against
  `text-2xl` and coexists with `text-red-500`. The convention is published in the `forge.css` header
  and `src/ui/README.md`; the reasoning is `UI_SSR_COMPONENTS.md` §5f. The arbitrary form is
  deliberately narrower and does not merge against the named one: `cn("text-size-hero
text-size-[20px]")` keeps both, because `text-size-hero` sets a line height the arbitrary value
  does not.

  Forge cannot enforce this in a consumer's stylesheet — an app's theme is not in forge's compile —
  so a token that keeps the old spelling behaves exactly as it did. **New gate step
  `validate-css-tokens`** holds forge's own `@theme` tokens to the rule, deriving the overloaded
  namespaces from the compiled design system rather than a hand-kept list. It walks the CSS
  directory recursively and fails rather than passing when the directory matched no stylesheet, so a
  mis-pointed `cssDir` reads as a failure and not as a clean run. Like the other two steps that
  compile it, it is `--full` only, because `tailwindcss` is an optional peer.

- **`@y-core/forge/cli/pkg/lint` — forge's own oxlint plugin, shipped as raw TypeScript.** oxlint's
  `jsPlugins` resolves a package subpath and loads TypeScript source directly, so the plugin needs no
  build step and no new package: it is a concrete-file subpath inside `cli/pkg`, on the
  `./ui/core/client` precedent. A consuming app names it in `.oxlintrc.json`:

  ```json
  { "jsPlugins": ["@y-core/forge/cli/pkg/lint"], "rules": { "forge/suppression-needs-reason": "error" } }
  ```

  The subpath publishes exactly two things — `lintPlugin` and the default export that aliases it,
  which is what `jsPlugins` loads. The rule objects and the oxlint ABI types the plugin is written
  against stay internal to `cli/pkg/lint/`, which has no `mod.ts` and mints no namespace: they are
  structural restatements of oxlint's own types rather than imports, because `oxlint` is a
  devDependency and a published module must not depend on one, and restating an ABI is not a
  contract forge is willing to hold a consumer to.

- **`forge/suppression-needs-reason` — every lint suppression states why.** The rule reads
  `context.sourceCode.getDisableDirectives()` and reports any `oxlint-disable*` whose justification
  is empty, so the mandatory reason is AST-anchored rather than matched by a `(?!\*/)` lookahead over
  raw lines, and it covers **every** rule rather than only `design-allow`. It composes with the
  `--report-unused-disable-directives-severity error` that `lint:types` already passes: that one says
  a suppression must still be needed, this one says it must say why.

- **`validate-class-groups` fails the gate when the committed conflict table drifts.** The step
  recompiles the stylesheet, re-derives the table and compares it to
  `src/ui/core/utils/class-groups.ts` byte for byte, so a `tailwindcss` release or a theme edit that
  moves the ground truth is reported rather than silently corrupting `cn`. It is `--full` only and
  declares `requires: { tool: "tailwindcss" }`: `tailwindcss` is an _optional_ peer, so a fast run
  on a consumer that has not installed it must not fail. `prepublishOnly` runs `verify:full`, which
  makes drift a release gate. Exposed as `classGroupsStep`, `checkClassGroups`,
  `ClassGroupsCheckConfig`, `deriveClassGroups`, `renderClassGroups`, `signature`, `reach` and
  `SHORTHAND_CLOSURE` from `@y-core/forge/cli/pkg`. The stylesheet loader the three compiling steps
  share is exported beside them, from the new `gate/checks/design-system` module: `loadDesignSystem`,
  `hasTailwind`, `canonical`, `fileURLToPathish` and the `DesignSystem` and `CssNode` types.

- **`forge release` prints the evidence for the version it derived.** A `because:` row beside
  `next:` names the commit whose `major:`/`minor:` prefix won the bump — short sha and subject — so
  a reviewer no longer re-scans `git log` to find out what asked for a version jump. Where nothing
  asked, the row says so: `no major:/minor: subject in 7 commits since v1.0.0`. The row prints in a
  real release as well as under `--dry`, and only for an automatic bump — an explicit version, a
  first release and an in-sync run print none. `VersionResult` carries the same fact as an optional
  `evidence` field for a consumer building its own release output.

- **`forge release` refuses a patch release whose public export surface shrank.** The bump is
  derived from commit subject prefixes alone, so a symbol dropped from a barrel under an unprefixed
  subject used to ship as `auto-patch` and break every consumer pinned to a `^` range. The release
  now compares the `<specifier>#<exportName>` set the latest tag published against the working
  tree's, and refuses an `auto-patch` that lost an entry, naming each one. `--allow-semver`
  overrides it. The bar is deliberately `auto-minor`: `auto-minor`, `auto-major`, an explicit
  version and a first release all pass, because a major-version decision is not one a heuristic
  over barrel names should demand. The guard fires under `--dry` too.

  It reads every non-wildcard entry in the exports map, not just the `mod.ts` barrels, so the nine
  concrete-file subpaths — `./cli/pkg/lint`, `./jsx/jsx-runtime`, `./jsx/jsx-dev-runtime`,
  `./jsx/register`, `./ui/assets/glyphs`, `./ui/chrome/client`, `./ui/client/htmx`,
  `./ui/core/client` and `./ui/show/client` — are covered rather than invisible. It also fails
  closed: a ref git cannot resolve raises `ReleaseError` kind `git-error` and a manifest it cannot
  parse raises the new kind `manifest-malformed`, where both used to read as "nothing was
  published" and let the release through. An `export { x as y }` counts as `y` alone, so renaming
  the local binding behind an unchanged public name no longer reads as a removal.

- **A `challenge="submit"` press that ends without a request now tells the page.**
  `TURNSTILE_ABANDONED_EVENT` (`"turnstile:abandoned"`) is dispatched on the **form**, bubbling and
  not cancelable, with a `TurnstileAbandonedDetail` naming the `reason` — `TurnstileAbandonReason`
  is `"timeout" | "interactive-timeout" | "error" | "unsupported" | "superseded"` — and the
  `submitter` the press was made on, re-enabled before the event fires so a handler can focus it.
  The held request is deliberately not carried: reviving it is the tokenless POST the drop exists to
  prevent. `TURNSTILE_INTERACTIVE_TIMEOUT_MS` (60s) is the new ceiling on a press held while an
  interactive challenge is up. All four are exported from `@y-core/forge/ui/contracts`.

### Fixed

- **`cn` no longer drops nine kinds of non-conflicting utility.** `class-groups.ts` merged concerns
  Tailwind keeps separate, so a class an app author wrote vanished from the rendered markup with no
  error and no gate failure: `cn("bg-red-500 bg-blend-multiply")` returned only
  `bg-blend-multiply`, and the same went for `bg-clip-*`, `bg-origin-*`, `text-shadow-*` against a
  text colour, `text-shadow-md` against `text-shadow-<color>`, `ring-offset-2` against
  `ring-offset-<color>`, the logical sides `border-be-*` and `inset-be-*` — added to Tailwind after
  the hand table was written — and `ordinal` against `tabular-nums`. All nine now keep both classes.
  `validate-class-order` could not have caught any of them: it proved class literals were fixed
  points of `cn` using the same table as its oracle, so the check and its subject failed together.

- **Twelve physical spacing utilities and an ungated transition, all of them outside the scope the
  old checks walked.** `logging/show/components.tsx` used `pr-4`, `pl-4` and `text-left` where the
  logical spellings mirror, and its `text-2xl` page heading carried no `text-balance` — invisible
  because `validate-modern-css` scanned `src/ui` alone. `http/fragment.ts`'s default error-list
  class used `pl-5`. The navbar's backdrop scrim transitioned `opacity` and `visibility` with no
  `motion-reduce:` beside it, where the panel it dims already had one.

- **`validate-class-order` refuses a green verdict on a class position it could not read.** A `cn(`
  or `class=` whose span never closes leaves every class literal inside it unjudged, which is not
  the same fact as "the classes are ordered". The step now fails, naming the file and the line, so a
  tree holding such a position fails the gate until the source is fixed rather than passing on a
  check that never ran.

- **A `challenge="submit"` press on a form htmx does not validate no longer leaves with an empty
  token.** The controller bailed on `!form.checkValidity()` without cancelling the event, on the
  assumption that htmx would halt the request — but `checkValidity()` is the static algorithm and
  ignores `novalidate`, which htmx honours, and htmx never validates a button-issued submission at
  all. On such a form the request went out with no token and the server saw a bot. Forge now mirrors
  htmx's own gate (`hx-validate` read off the issuing element only, both spellings; `formnovalidate`
  only when that element is the form), and where htmx would not have validated, the press spends a
  challenge instead — the author declaring `novalidate` has declared constraint validation is not
  the gate.

- **A second press can no longer be answered by the first press's request.** The held request and
  the control it was pressed on were separate module-level slots shared by every submitter in scope,
  so pressing Submit could be answered by the Preview control's request — htmx reads the form's
  `lastButtonClicked` back when it issues. The hold is now one record keyed to its submitter, and
  the last press wins: it displaces the first, re-arms the window, reports the displaced press as
  `superseded`, and rides the challenge already in flight, so one press remains one challenge.

- **An abandoned interactive challenge no longer wedges the form for the page's life.**
  `before-interactive-callback` stood the execute budget down entirely — the normal path under
  `appearance="interaction-only"` — leaving a press held with no ceiling. It now swaps the 15s
  budget for `TURNSTILE_INTERACTIVE_TIMEOUT_MS`, far past a deliberate click and well inside the
  token's ~300s life. A press arriving mid-interaction inherits the same ceiling.

### Changed

- **Elevation is now visible in dark mode.** Every level above a hairline was a Tailwind default
  shadow — black at 5–25% alpha — so on a near-black surface levels 2, 3 and 4 rendered nothing and
  a `Card`, a `Menu.Popup` and a `Dialog` read as coplanar. `theme-base.css` now redefines the whole
  `--shadow-*` family with Tailwind's geometry unchanged and every colour slot pointed at two new
  fixed families in `theme-colors.css`: `--cast-a1` / `-a2` / `-a4`, ink in light and `transparent`
  in dark, and `--rim-a1` / `-a2`, the reverse. In dark a level is carried by a 1px inset rim at 10%
  white plus a soft outer falloff at 5% whose radius is the level — a clean edge transition, not a
  glow. **No component class changes**, and light mode renders as it did with one exception below.
  All seven sizes are defined rather than the five forge renders, so a consumer's `shadow-2xl` is
  not the one elevation that still vanishes in dark.

- **`shadow-2xl` is marginally lighter in light mode.** Tailwind's value uses alpha `0.25`, which is
  off-grid between `--black-a4` (0.2) and `--black-a5` (0.3); it maps to `--cast-a4`. Adding an
  off-ramp alpha step would be the ad-hoc tint `forge-ui-color-scale-no-adhoc-tint` forbids, so the
  shift is taken rather than worked around. Forge itself renders no `shadow-2xl`.

- **`cn`'s conflict table is derived from the design system rather than hand-written.**
  `src/ui/core/utils/class-groups.ts` is now generated from the stylesheet `.oxfmtrc.json` already
  names, `src/ui/assets/css/tailwind.css`, by `bun run gen:class-groups`. A group id is the CSS
  signature a utility writes — its `--tw-*` variables when it sets any, its ordinary properties
  otherwise, which is what keeps `ring-2` and `shadow-md` apart though both write `box-shadow` —
  and `GROUP_OVERRIDES` states which of those signatures a CSS shorthand swallows. `cn`'s algorithm
  is unchanged, `classGroup` and `GROUP_OVERRIDES` keep their shapes, and both stay `@internal`.
  Two facts remain hand-authored, and neither moves when Tailwind ships a minor: the vars-preferred
  signature rule and the CSS shorthand closure, both stated in
  `.decisions/implementation/UI_SSR_COMPONENTS.md` §3f. **No new dependency** — `tailwindcss` is
  already a peer, and the two loader callbacks `@tailwindcss/node` exists to supply are ten lines
  of `node:fs`.

  The generated table covers every utility the stylesheet compiles to, where the hand table covered
  a fraction of them, so a few that used to fall through now resolve — `backdrop-blur`, for one.
  The artifact is correspondingly larger, and remains immaterial against an isolate limit of
  3–10 MB; `src/ui/core/utils/class-groups.ts` is the table itself.

  A root the generator cannot enumerate a scale for is now probed directly with two scale values —
  `getClassList()` reports one for `left` and none for `start` — and a derivation that would put two
  groups with identical reach into an override edge throws rather than emitting a table whose
  override runs both ways. Neither changes `cn`'s input-to-output for any class the old table
  already resolved.

- **`cn` merges four more shorthand families, so a class that survived before is now dropped.**
  Tailwind treats each as one concern and the derived table now says so: a `scroll-p*` / `scroll-m*`
  longhand under its shorthand, `basis-*` under `flex-*`, and `content-*` / `items-*` / `self-*`
  under the matching `place-*`. `cn("scroll-pt-4 scroll-p-2")` returned both and now returns
  `scroll-p-2`; `cn("items-center place-items-start")` returns `place-items-start`. Where an app
  relied on the pair surviving, order the classes so the one that must win comes last, or drop the
  shorthand.

---

## [0.1.0] — 2026-09-03

### Breaking Changes

- **`<Turnstile>` now loads Cloudflare's script eagerly, and its token reset is scoped to the
  form's own submission.** The widget used to wait for the first `focusin` inside its form; it now
  fetches `api.js` and renders at mount, which is what Cloudflare asks for and what gives a real
  submitter a challenge that is already solved when they reach the button. **Every consumer's
  widgets change behaviour on the version bump alone.** The old behaviour is `load='focus'` — give
  it to any form that is incidental to its page (a footer contact form, a demo), because eager
  means a challenge issued to everyone who loads the page, not only to those who submit. The reset
  is the second change: the controller used to reset the widget — and `form.reset()` on success —
  on **any** `htmx:afterRequest` bubbling out of the form, so every htmx request the form triggered
  burned the single-use token. It now tests the element htmx issued the request from: a form
  declaring an `hx-*` verb itself owns only the request issued by the form, and a form carrying no
  verb owns the one issued by a descendant submit control that carries it. A descendant field's own
  request no longer resets anything. An app that worked around the old reset by saving and restoring
  its fields can drop that workaround.

- **`Toolbar` (`ui/chrome`) renders `<div role="toolbar">`, not `<nav role="toolbar">`.** The
  `role` was already replacing the element's navigation landmark, so the `<nav>` bought nothing and
  misled assistive-technology users scanning by landmark. `ToolbarProps` accordingly extends the
  `div` intrinsic attributes instead of `nav`'s — a consumer spreading a nav-only attribute through
  the toolbar no longer typechecks, and selectors targeting `nav[role="toolbar"]` need the tag
  dropped.

- **The gate's `governance` step now invokes `gov sync`, not `governance-sync`.**
  `@y-core/governance` renamed its bin in v0.4.4, so `cloudflareWorkerSteps({ governance: true })`
  emits `["gov", "sync", "--check"]` with `["gov", "sync"]` as its fixer. **The preset version and
  the `@y-core/governance` pin must move together**: a sibling on the new preset with an older pin
  gets a gate invoking a binary it has not installed, and a sibling on the new pin with an older
  preset invokes one that no longer exists. Nothing enforces the pairing. Bump the pin to
  `refs/tags/v0.4.4` or later in the same change, and delete any stale
  `node_modules/.bin/governance-sync` symlink the upgrade leaves behind — it points at a module
  that lost its shebang and fails with `ENOEXEC` rather than "command not found".

- **The gate's `lint` step now runs `oxlint`, and a new `format` step runs `oxfmt`.** Consumers
  building a step table from `@y-core/forge/cli` get one more step and two more required
  devDependencies: `oxlint` (and `oxlint-tsgolint` for the type-aware step) and `oxfmt`.
  `lintStep` emits `oxlint --deny-warnings`; `formatStep` emits `oxfmt --check`, with a bare
  `oxfmt` as its fixer. `lint` is ordered **before** `format` so that under `--fix` the formatter
  writes last and owns the final byte layout. Suppression comments change spelling —
  `// biome-ignore lint/<group>/<rule>: <reason>` becomes
  `// oxlint-disable-next-line <plugin>/<rule> -- <reason>`. The two cannot coexist on one site:
  both linters read only the immediately preceding line, so a directive one line further up is
  inert.

- **Biome is gone; `@biomejs/biome` is no longer a devDependency and `biome.json` is deleted.**
  `oxfmt` replaces it for formatting and import sorting, configured by `.oxfmtrc.json`. Two
  consequences for a consuming project. First, `formatStep`'s argv changes — the label stays
  `format`, so `--only format` is unaffected, but a project that pinned the old `["biome", …]`
  array in its own step table must edit it. Pre-1.0, there is no shim. Second, **oxfmt formats by
  language, not by extension**: where Biome was restricted to `.ts`/`.tsx`, oxfmt also formats
  Markdown, CSS, JSON, YAML and TOML, so pointing it at a directory reformats far more than
  before. forge's own `format` step is now pointed at `.` rather than `src/` and `config/`.
  Import sorting moves from Biome's `organizeImports` to oxfmt's `sortImports`, which uses a
  different algorithm and inserts blank lines between import groups.

### Added

- **`<Turnstile>` takes `cData` and `responseFieldName`, the missing client halves of two server
  options forge already published.** `cData` stamps `data-cdata` and reaches Cloudflare as `cData`;
  it is what `verifyTurnstile({ expectedCData })` compares against, and until now nothing could mint
  a token carrying it, so the option was unusable. It is the only way to tie a challenge to an
  app-side record. `responseFieldName` stamps `data-response-field-name` and reaches Cloudflare as
  `response-field-name`, renaming the hidden token input so two widgets can share one form — pair it
  with the server's existing `tokenField`. A `cData` outside `TURNSTILE_CDATA_PATTERN` (new, beside
  `TURNSTILE_ACTION_PATTERN`) is reported to the console and still forwarded, as `action` already
  is, leaving the server the single enforcement point; `responseFieldName` carries no pattern,
  because it is an HTML form field name. Both props are optional and elide when absent, so existing
  markup is byte-identical. The showcase playground drives both.
- **A Turnstile page in the showcase (`/showcase/ui/turnstile`), replacing the catalog band.** One
  widget a reader reconfigures from a panel that drives every prop `TurnstileProps` declares —
  `siteKey`, `size`, `load`, `challenge`, `appearance`, `action`, `language`, `tabindex` and the
  fallback and unsupported copy — with the `<Turnstile>` call the settings correspond to printed
  beside it. The query string is the whole configuration, as on the theme page, so a setting worth
  reporting is a link. The sizes-and-modes band that used to sit on the Interactive page moves here
  intact and still owns the component's coverage axes; three further bands show the two refusal
  messages the controller reveals, the round trip through `defineAction`, and Cloudflare's dummy
  sitekeys. The panel offers nothing Cloudflare's API has that forge does not expose: an option
  forge has ruled against — `theme`, `retry`, `refreshExpired` — has no dial, because a control for
  a prop the component cannot take would document a component forge does not ship. The sitekey is a
  preset id rather than a free string, so no visitor can have a key of their own rendered under the
  host's name.

- **`registerShowcase` takes an optional `turnstileSecret`, and mounts a `turnstile-verify` action.**
  The playground's form posts to an ordinary `defineAction` route with `honeypot` and `turnstile`
  declared, and its verdict panel reports which guard refused and why — the one place the showcase
  departs from what a real route must do, since an application answers every guard identically so a
  bot cannot read the guard off the response. Without the secret the panel says it was not
  configured rather than claiming a verification that never happened. New exports from
  `@y-core/forge/ui/show`: `TurnstileDemos`, `loadTurnstileOptions`, `turnstileSiteKey`,
  `turnstileSnippet`, `TurnstileVerdictFragment`, `renderTurnstileVerdict`, `TURNSTILE_TEST_KEYS`,
  `TURNSTILE_PASS_KEY`, `TURNSTILE_DEMO_DEFAULTS`, `SHOW_TURNSTILE_VERDICT_ID`, and the types
  `TurnstileDemoOptions`, `TurnstileTestKey` and `TurnstileVerdict`. `ShowcaseData` gains a
  `turnstile` field, so an app calling `ShowcaseContent` directly passes `loadShowcase`'s output
  unchanged and nothing else.

- **`formDigits()` (`validation`) — a form value reduced to its ASCII digits.** The third form-value
  primitive beside `formText()` and `formMultilineText()`, for a control whose separators are
  cosmetic: `v.pipe(formDigits(), v.length(16))` accepts a card number however the user grouped it,
  and the length then counts digits rather than the punctuation a rendering happened to carry. It
  only removes — it never throws, coerces or refuses, so a bad value still earns a `422` from a
  composed `v.length` rather than the `500` a throwing pipe action would produce. It is destructive
  in a way its siblings are not, discarding a leading `+` among other significant characters; a
  field that must keep one stays on `formText()`.

- **`Input` takes `format` — opt-in cosmetic grouping, applied on blur.** `format='#### #### ####
####'` regroups the value when focus leaves the field, and nothing reformats as the user types, so
  the entire class of caret bugs is structurally impossible. The server renders the formatted value
  itself, so a no-JS first paint and a re-render after a failed submit already read grouped and the
  controller's first write is a no-op. **The formatted string is what the form posts** — pair the
  field with `formDigits()` on the server, which is the documented other half of the contract.
  `format` is never validation, and it does not compose with `bind`: a control carrying both is
  refused with one warning. Reach for `inputmode`, `pattern`, `autocomplete` and `maxlength` first —
  they need no script at all — and pair `format` with a `tabular-nums` class of your own.

- **`ui/contracts` exports `INPUT_FORMAT_SCOPE`, `INPUT_FORMAT_ATTR`, `applyFormat` and
  `stripFormat`.** The two pure functions both halves of the format feature share: `#` is a slot and
  every other character a literal, no `RegExp` is ever built from a template, and `applyFormat`
  always strips before it regroups — so it is idempotent, emits `""` rather than a bare skeleton that
  would defeat `required`, grows no trailing separator on a partial value, and returns the bare
  significant characters rather than truncating one that overflows the template.

- **`inputmode` and `enterkeyhint` on every element's JSX attributes.** Both are global HTML
  attributes, so both sit on `HTMLAttributes` — `<textarea inputmode='numeric'>` typechecks, not only
  `<input>`. Each is a closed literal union rather than `string`.

- **`<Turnstile>` takes `language`, `tabindex` and an `unsupported` message slot.** `language`
  pins the widget to a language the page has chosen where the browser's own would differ;
  `tabindex` sets the **widget iframe's** place in the form's tab order, which is an accessibility
  concern rather than a preference. **`tabindex` replaces the container's own `tabindex`** — the
  prop is omitted from the inherited `div` attributes, because Cloudflare's meaning is the one that
  matters on this element. `unsupported` is a second, separately overridable message, shown when
  Turnstile cannot run in the visitor's browser at all; the general fallback's "disable any ad or
  script blockers" is advice that visitor cannot act on. The other Cloudflare render parameters
  (`cData`, `retry`, `refresh-*`, `response-field-name`) stay out.

- **`<Turnstile>` reserves the widget's box, so the eager render stops shifting the page during
  first paint.** The reservation is keyed on `appearance`: `appearance="always"` holds Cloudflare's
  published dimensions, and `execute` / `interaction-only` reserve nothing, since a widget that may
  never appear would otherwise leave a permanent hole. **Consumers see a rendered `class` attribute
  on the container where there was none** — Tailwind sizing utilities, merged ahead of any `class`
  of the caller's, so a caller's own sizing still wins.

- **`mountTurnstile` copies the page's CSP nonce onto the script it injects.** A
  `script-src 'self' 'nonce-…' 'strict-dynamic'` policy now covers Cloudflare's `api.js` and
  everything it loads in turn, with no CDN origin in `script-src`. `frameSrc` and `connectSrc` still
  need `TURNSTILE_CSP` — `strict-dynamic` governs script loading only, and the challenge runs in an
  iframe. The nonce is read off an already-nonced script's **property**, never a `data-` copy: the
  browser empties the `nonce` content attribute precisely to stop the value being read back out
  through a CSS attribute selector. A page that sets no nonce is unaffected.

- **`TURNSTILE_ACTION_PATTERN` is exported from `ui/contracts`** — Cloudflare's
  `^[a-zA-Z0-9_-]{1,32}$` for the `action` prop. The controller reports a value outside it and
  **still forwards it**, so the server's `verifyTurnstile` stays the single enforcement point.

- **`<Turnstile>` takes `challenge` and `appearance`, opting a form into one challenge run at
  submit.** `challenge?: "render" | "submit"` defaults to `"render"`, which is today's behaviour
  unchanged: the challenge runs as the widget mounts and its single-use token starts its 300-second
  life there. `challenge="submit"` renders with Cloudflare's `execution: "execute"` and runs exactly
  one challenge, at the press, from htmx's `htmx:confirm` seam — for a form that takes longer to
  fill than the token lives, where the token can otherwise reach siteverify as
  `timeout-or-duplicate` and cost the reader their submission. The press is held, not gated: the
  submitter is marked `disabled` and `aria-busy` for the window, and the window always ends — on the
  token the request is issued, and on a challenge error or `TURNSTILE_EXECUTE_TIMEOUT_MS` (15 s) the
  fallback alert is revealed, the request is dropped rather than sent tokenless, and the button is
  pressable again. It needs an htmx submission on the form or a descendant; without one the
  controller reports the authoring error and falls back to `"render"`. `appearance?: "always" |
"execute" | "interaction-only"` defaults to `"always"` and is passed to Cloudflare as-is; it is
  independent of `challenge`, and `"interaction-only"` is the documented pairing for
  `challenge="submit"`. Both attributes are stamped only away from their defaults, so an opted-out
  widget renders the markup it always did.

- **`TURNSTILE_EXECUTE_TIMEOUT_MS`** — how long a `challenge="submit"` press is held before it is
  released as a failure, exported from `@y-core/forge/ui/contracts`.

- **`<Turnstile>` takes `load` and `action`.** `load?: "eager" | "focus"` picks when the script is
  fetched, defaulting to `"eager"` (see Breaking Changes). `action?: string` is written to
  `data-action` and passed to `turnstile.render`, which is what makes the server's
  `verifyTurnstile({ expectedAction })` usable: without it a token minted on one form verifies at
  any other endpoint on the same host. There is no app-triggered third load mode.

- **`TURNSTILE_SCRIPT_URL`** — the URL the controller injects, `TURNSTILE_SCRIPT_SRC` plus
  `?render=explicit`, exported from `@y-core/forge/ui/contracts`. The controller renders every
  widget itself, so Cloudflare's implicit document scan ran for nothing. `TURNSTILE_SCRIPT_SRC` is
  unchanged and is now matched as a **prefix**, so a script an app loaded with parameters of its
  own is still found rather than loaded twice.

- **`typeAwareLintStep` — type-aware linting, `fullOnly`.** `oxlint --type-aware` enables
  `no-floating-promises`, `no-misused-promises` and `await-thenable`, which Biome cannot express at
  all and which matter on a Workers isolate that tears down at end-of-response. It builds its own
  TypeScript program, so it stays off the fast loop. It also carries
  `--report-unused-disable-directives-severity error`: this run is a superset of the syntax run, so
  it is the only one that can tell a stale suppression from one a type-aware rule redeems.

- **`rasters` — SVG-to-PNG rasterization for non-square art.** A new assets config block of
  `{ from, to, width?, height? }` entries, rasterized by `buildRasters` into `paths.publicDir`
  during `buildAll` (after `copy`) and reachable alone as `forge assets build rasters`. Setting one
  dimension derives the other from the source's intrinsic ratio, so a lockup is scaled rather than
  squashed; an entry setting neither is rejected by the schema. Outputs are not content-hashed and
  do not enter the manifest — like `copy`, because a URL pasted into a mail client has to stay
  stable. `sharp` stays an optional dynamic import; `currentColor` is not substituted, so give the
  source an explicit fill.

- **`formatStep`** — the formatting half of the old `lintStep`, exported from `@y-core/forge/cli`.

- **Two rules taken from oxlint's `suspicious` category, named individually.**
  `eslint/preserve-caught-error` caught one rethrow that discarded the original stack;
  `eslint/no-shadow` caught locals shadowing an imported or same-module symbol the file also calls
  — `err` from `result` inside a `catch` in `csrf.ts`, and the exported `env()` builder in
  `config.ts`. The category itself stays **off**: enabling it would subscribe forge's published
  gate to oxc's future editorial judgement, and 312 of its 357 findings here come from three rules
  that collide with forge's own design. Reasoning is in `CODE_REVIEW.md` §7.

- **`@y-core/forge/ui/assets/css/tailwind.css` — Tailwind composed with forge, as one import.**
  It is `@import "tailwindcss"` above `forge.css`, and it replaces the two lines an app used to
  write itself. **The two-line form still works and is still correct** for an app that must pass
  Tailwind import options (`source(none)`, a prefix), because an option cannot be added to an import
  nested inside a file the app does not control — which is why `forge.css` still never imports
  Tailwind. Take one path or the other, never both: two Tailwind imports emit preflight twice. The
  value of having the file is that the composition is now stated once, in the package, where the
  app's stylesheet, its Tailwind build and forge's own class sorter all read the same one.

- **A `validate-class-order` gate step, shipped to consuming apps in `forgeChecks`.** It walks every
  class position — a `class` / `className` attribute, and every argument to `cn`, `asClass` and
  `cva` — and fails on any literal two of whose tokens claim the same conflict group, naming the
  file, the literal and the token that would be dropped. Such a literal already contains dead code:
  `cn` drops one of the two at render. Banning it is also what makes sorting a class literal
  provably output-preserving (`UI_SSR_COMPONENTS.md` §3e). The oracle is the real `cn`, imported
  rather than reimplemented. `classOrderStep({ root, sources })` is exported for a bespoke table;
  `!`-prefixed entries exclude a file or subtree, which is how a spec whose fixtures are
  deliberately self-conflicting opts out.

### Fixed

- **`<Turnstile>`'s fallback message is no longer one-way, and no longer the same message for every
  cause.** `showFallback` only ever revealed the alert; nothing took it back down. Under the new
  eager default that stranded _every_ visitor to a page with a transient Turnstile error on "disable
  any ad or script blockers", including the ones whose widget then solved itself on Cloudflare's
  automatic retry. The controller now passes a success `callback` in render mode too — previously
  only submit mode had one — and that callback re-hides the alert. Two consequences for a consumer:
  the widget div gains a second hidden `<p>` (`data-ref="turnstile-unsupported"`), and the
  `error-callback` now takes Cloudflare's error code, reports it once under the `[turnstile]`
  prefix, and **returns a non-falsy value**, which stops Cloudflare logging a warning of its own for
  each of its retries.

- **A `challenge="submit"` press is no longer held for 15 seconds on a widget that cannot answer.**
  The controller now tracks widget health as `unmounted | ready | dead`: a `turnstile.render()` that
  throws — previously swallowed with no report at all — or an `error-callback` before the press
  leaves the widget `dead`, and the next press goes through unheld for `verifyTurnstile` to refuse.
  It used to sit disabled and `aria-busy` for the full `TURNSTILE_EXECUTE_TIMEOUT_MS` with no
  request ever sent.

- **An interactive Turnstile challenge is no longer discarded after 15 seconds while the visitor is
  still solving it.** The execute timeout assumed a non-interactive challenge. When Turnstile
  presents one the visitor must click, 15 seconds is well short of a real person, and their
  submission was silently dropped with the ad-blocker message. The controller now wires
  `before-interactive-callback` — clearing the timer and dropping the busy state, so the button
  stops reading as mid-flight while they are being asked to act — and `after-interactive-callback`,
  which re-arms both. Cloudflare's own `timeout-callback` covers abandonment.

- **The widget re-renders on a theme flip, but only while no token has been issued.** A dark/light
  toggle used to leave the widget in the colours it first rendered in. It now watches
  `documentElement`'s class list and re-renders on a change — and stops doing so the moment a token
  exists, because discarding a solved token to change a colour would cost the visitor a second
  challenge, and in submit mode the one they had just passed.

- **`<Turnstile>` no longer resets the widget on expiry or timeout.** Both `refresh-expired` and
  `refresh-timeout` default to `auto`, and Cloudflare documents the timeout callback as resetting
  the widget itself, so forge's own `reset()` was redundant at best and at worst spent a second
  challenge on top of the one Turnstile had just re-presented. The two callbacks are no longer
  wired at all. **This was settled from Cloudflare's reference documentation, not observed against a
  live test sitekey** — worth one manual confirmation on a real key.

- **A `turnstile.remove()` that throws no longer aborts the rest of the controller's teardown.** It
  was called bare where `render` was wrapped, so a widget id whose container an htmx swap had
  already taken could skip `mounted.delete(container)` and leave a stale WeakMap entry that a later
  mount on the same node would be handed instead of a fresh controller.

- **`<Turnstile>`'s post-render focus guard is now armed on every render, not only on one that had
  a focus to restore.** The restore and the guard were one rule; they are two now, because a
  restore needs somewhere to restore _to_ and the guard does not. Under the new eager default the
  render lands at page entry with `body` focused, so there was no held focus and no guard — and
  Turnstile steals focus a beat after `render` returns, by which time the reader has clicked the
  first field and loses it. The guard ignores a `focusout` originating inside the widget, so
  tabbing between fields is unaffected. The accepted trade: a reader who deliberately clicks into
  the widget within five seconds of the render can have that focus pulled back to the field they
  left.

- **`cn` no longer drops a text colour standing beside `text-wrap` / `text-nowrap` /
  `text-balance` / `text-pretty`, nor a font family beside `font-stretch-*`.** The `text-`
  dispatcher classed the four wrapping modes as colours, so
  `cn("text-sm text-muted-foreground text-pretty")` rendered without the colour, and
  `font-stretch-*` fell to `font-family` the same way. Both are now their own conflict groups. The
  effect is a class kept that used to disappear: **a consumer passing either pair as `class` into a
  forge component gets a rendered `class` attribute one token longer than before**, which is the
  markup they asked for. Nothing that survived before starts being dropped.

- **`buttonVariants`' base now carries `whitespace-nowrap`.** A multi-word label used to break
  across two lines inside its own pill at narrow widths — a button is a control, and a control's
  label is not prose to be reflowed. Every consumer that added the class locally (cornellaw's FICA
  declaration buttons at 320px, for one) can drop it. The class rides the base, so `Button`,
  `ToggleGroup` items and `Toolbar` items all inherit it; a label long enough to need wrapping
  wants a shorter label, not a two-line button.

- **Seven `...(x ?? {})` spreads dropped their useless fallback**, and three `/^…/.test(s)` regexes
  became `s.startsWith(…)`. A dead `_fetchFn` binding in `kv.test.ts` was removed. All were found
  by oxlint rules Biome does not have.

- **`mock.module` is now awaited in the three test files that install a `node:child_process` stub**
  (`cf-env-command.test.ts`, `proc.test.ts`, `git.test.ts`). Each is followed immediately by a
  top-level `await import(...)` of the module under test, so awaiting the registration is what
  guarantees the stub is in place before the import resolves.

### Changed

- **The design gate enforces two accessibility rules it had only published:**
  `forge-ui-a11y-label-association` (a Floor rule, new to `floor.md`) fails a `<label>` that
  neither carries `for` nor wraps its control, and `forge-ui-a11y-live-politeness` (already a
  corpus sentence) fails an `aria-live` that is neither `polite` nor `assertive`, and requires a
  stated reason for `assertive`. Both are suppressible per-site with `design-allow` and its
  mandatory reason. Forge's own tree passes with one suppression, in the showcase's toast-position
  demo. **This is forge's own gate, not a published behaviour change** — an app inherits the rule
  ids as citable corpus, and runs the checks only if it runs forge's design step.

- **The design gate now checks six more of the accessibility rules it publishes**, taking the
  enforced set from two to eight: `forge-ui-a11y-no-aria-readonly-on-button` (the attribute on a
  `<button>` or a `role="button"` element), `-one-live-region` (a live region opened outside
  `Toast.Container`), `-aria-beside-data` (a `data-pressed`/`-checked`/`-selected`/`-disabled`/
  `-invalid` written by hand rather than emitted through `stateAttrs`), `-heading-size-by-class`
  (an `<h1>`–`<h6>` whose quoted class carries no `text-*` size), plus the two Floor ids
  `forge-ui-reduced-motion` (an `animate-*` with no `motion-safe:`/`motion-reduce:` in its variant
  chain) and `forge-ui-focus-ring` (`outline-none`/`outline-hidden` on a `cursor-pointer` target
  with no `focus-visible:` ring beside it). Each is suppressible per-site with `design-allow` and
  its mandatory reason, though on the two Floor ids a suppression is a defect to remove rather than
  an override to accept. Forge's own tree passes all six with no new suppression. The remaining ten
  published a11y ids have no mechanical form and are now recorded as review items with the reason
  each resists one — including `forge-ui-a11y-state-attrs-source`, whose finder is blocked by a
  single site. **This is forge's own gate, not a published behaviour change** — an app inherits the
  rule ids as citable corpus, and runs the checks only if it runs forge's design step.

- **`.oxlintrc.json` enables the `jsx-a11y` plugin**, so all 35 of its rules run under
  `correctness` over forge's own JSX. It is a vocabulary check — misspelled `aria-*` attributes,
  invalid role strings, malformed ARIA values — not a check on composition, which is the design
  gate's. `prefer-tag-over-role` is off (its substitutions change the element's meaning), and
  `control-has-associated-label`, `tabindex-no-positive` and `aria-proptypes` are off for test
  files, which exist to feed adversarial markup. **`.oxlintrc.json` is not published**, so this
  changes no consumer's lint result.

- **`.oxfmtrc.json` enables `sortTailwindcss` over `cn` and `cva` calls**, so forge's class
  literals are held in Tailwind's canonical order. This is forge's own formatting, not a published
  behaviour change: it moved no token between literals, so `cn`'s cross-argument precedence and
  `cva`'s `base → variants → class` layering are untouched, and every rewritten test expectation
  was proved a token permutation before it was touched. Two consequences for an app adopting the
  same config: a class const only reaches the sorter inside a call — forge's own are wrapped as
  `const INPUT_BASE = cn("…")` — and `preserveDuplicates` defaults to `false`, so an exact
  duplicate token is deleted. The sorter is pointed at the shipped
  `ui/assets/css/tailwind.css`, so it resolves forge's own token utilities rather than treating
  each as unknown.

---

## [0.0.91] — 2026-08-30

### Changed

- **`@y-core/forge/site`: `zone.apex` is now optional**, defaulting to the origin's hostname. A
  consumer states the host once; stating it twice is how the two drift, and there is no case for a
  zone whose apex is not the host the site declares itself served from. An explicit `apex` still
  wins. `ResolvedSiteConfig.zone` is a new `ResolvedZoneConfig`, whose `apex` is required.

- **`buildRedirectRule` now refuses a source host outside the apex.** It consolidates a zone onto
  one hostname and is not a general URL forwarder: a source outside the apex could never fire —
  the rule is deployed to the apex's own zone — and a source equal to the apex is a redirect loop.
  Both are refused when the rule is built rather than discovered after a commit.

- **`forge sync zone` no longer reports permanent drift on a rule it just wrote.** Rules were
  compared with `JSON.stringify`, which is key-order sensitive: Cloudflare returns
  `action_parameters` alphabetised and the builder composes them in another order, so a redirect
  rule compared unequal to itself and `--check` failed on every run. Keys are now canonicalised
  before comparison; array order is preserved, since a ruleset's rule order is meaningful.

- **`forge sync zone` reports an auth failure honestly.** It previously said "token lacks
  permission", which is a guess presented as a diagnosis: Cloudflare returns one code for a token
  it rejects and for a valid token missing a permission, as `endpoints.ts` already recorded. The
  row now names both possibilities and the code, and Cloudflare's own message is printed under the
  table where it has the width to be read. `--json` carries it as `errorDetail`.

- **`forge sync zone` credentials are environment-first.** `CLOUDFLARE_ZONE_ID` and
  `CLOUDFLARE_API_TOKEN` are refused up front when unset, with a message that names the variable
  rather than reporting a downstream auth failure. The flags remain for a one-off, but a value on a
  command line lands in shell history.

---

## [0.0.90] — 2026-08-29

### Added

- **`@y-core/forge/site` — the crawler and edge surface, derived from the route table.** A leaf
  namespace of pure string and data transforms: `defineSiteConfig` / `SiteConfigSchema` /
  `resolveSiteConfig` for the config, `renderRobotsTxt` and `renderSitemapXml` for the two
  generated files, and `resolveSitemapEntries` for the filter-and-decorate step between them.
  Parameterised and wildcard route patterns are dropped from a sitemap — there is no single URL
  they stand for.

  It takes a plain `string[]` of paths rather than a `RouteMap`, so the caller passes
  `routePaths(routes, { method: "GET" })` and the namespace stays free of a `router` dependency.

- **Zone expression builders in the same namespace.** `buildAllowRule` turns a served surface into
  the Cloudflare custom rule that actions everything the surface does not account for, replacing a
  hand-extended deny-list; `buildRedirectRule` emits a host-to-apex single redirect.
  `RESERVED_PREFIXES` — `/cdn-cgi/` and `/.well-known/` — is unioned into every allow-list whether
  the caller asks for it or not, because `/cdn-cgi/` serves Turnstile and filtering it takes down
  every form on the site. Expressions are checked against Cloudflare's 4096-character per-rule
  limit before the write rather than at the API.

- **A `site` block in the assets config**, mirroring `icons` with its own root-legal `outDir`.
  `buildAll` gains a `buildSite` step after `buildIcons`, emitting `robots.txt` and `sitemap.xml`
  into the asset-tree root — so a crawler is served static bytes and costs the Worker no
  invocation.

- **`validate-asset-root`, a new gate step in `cloudflareWorkerSteps()`.** It compares the files
  the assets pipeline writes into the asset-tree root (`icons.outputs`, plus the `site` block)
  against the `!`-prefixed entries of `assets.run_worker_first`, which were previously kept in step
  by hand. A missing exclusion fails — that is a Worker invocation bought for nothing, and a 404
  for a generated file; a `!` entry naming nothing the pipeline emits only warns, since an app may
  legitimately exclude a hand-authored file. The step runs only when both config paths are
  supplied, and reuses the existing JSONC parser rather than adding a second one.

- **`forge sync zone`** — a sibling subcommand reconciling a zone's `http_request_firewall_custom`
  and `http_request_dynamic_redirect` entry point rulesets against the `zone` block of a
  `config/site.ts`. Read-only by default, `--commit` writes, `--check` exits non-zero on drift for
  the gate, `--json` for machine output. It reuses `createCfClient`, the `Result`-returning error
  classification and the table renderer rather than adding a second stack. Credentials are
  `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN`, and the token needs both Zone WAF:Edit and
  Dynamic Redirect:Edit — no single permission covers both phases.

  `createCfClient` now takes `Pick<CfAuth, "apiToken">`: it authenticates and nothing more, so a
  zone-scoped caller no longer has to invent an account id.

- **Verified Cloudflare zone-ruleset surface**, recorded in `src/cli/sync/api/endpoints.ts`:
  the phase-addressed entrypoint paths, the fact that `PUT` replaces the whole `rules` array, the
  per-phase token permissions, and the phase ordering — `http_request_dynamic_redirect` runs
  _before_ `http_request_firewall_custom`, so a host redirect terminates before the WAF sees the
  request.

---

## [0.0.89] — 2026-08-28

### Added

- **`@y-core/forge/cli/term` — one terminal-rendering namespace.** Width measurement
  (`stringWidth`, `truncate`) that skips ANSI escapes and counts wide characters, combining marks
  and emoji sequences correctly; wrapping and alignment (`wrapLines`, `padAlign`, `terminalWidth`);
  one column engine (`renderGrid`, `definitionList`, `BORDERS`) now behind the `forge sync` tables,
  the `--help` command and flag lists, and the release summary, which were four separate padding
  expressions; and a threaded chainable styler (`resolveColorLevel`, `createColorize`, `PLAIN`)
  with 16/256/truecolor degradation. `cli/term` is a sink: it imports `node:process` and nothing
  else in the package.
- **`CliContext` — an additive third parameter on a command's `run`.** `(args, flags, ctx)`, where
  `ctx` carries `io`, a styler for stdout, a separate styler for stderr, and the terminal width.
  Optional, so a two-parameter handler stays assignable and a two-argument call still typechecks;
  `execute()` always supplies it. Two levels rather than one, because `forge verify > log.txt` must
  still colour progress on the attached stderr while the redirected stdout stays clean.
- **Repeatable flags.** A `StringFlagDef` may declare `multiple: true as const`, and
  `ResolvedFlags` then types it `string[]`. `--only`, `--resources` and `--rotate` are repeatable,
  and comma-separated lists still work: `--only a,b --only c` names three.
- **`--help` shows inherited persistent flags.** `formatHelp` reads `collectFlags(command)` rather
  than `command.flags`, so a `persistent` flag declared on an ancestor — accepted by the parser all
  along — is now documented. Descriptions wrap to the terminal width, and `default` values and type
  placeholders have a column.
- **A near miss is named.** A mistyped subcommand or long flag gets a `Did you mean …?`, where a
  mistyped subcommand previously surfaced as `Command "forge" takes no arguments, got 1`.
- **Negative numbers are values.** `--limit -5` and `--limit -1.5` now parse. A `-`-leading element
  that looks like a flag is still refused rather than swallowed, so `forge sync --config --commit`
  still says `Flag --config requires a value`.
- **Short clusters.** `-abc` expands to `-a -b -c`, and `-ab=cd` to `-a -b=cd`.
- **`forge sync` reports secrets separately from provisioned bindings.** `Synced by --commit` has
  become `Created by --commit` (secrets from `.dev.vars`) and `Provisioned by --commit` (KV, D1, R2
  and queues). The old section's note claimed that everything in it was "created as
  `PREFIX_<BINDING>` with the id written back", which was never true of a secret: a secret is not a
  binding, takes no prefix, and has no id — `engine.ts` has always excluded it from the config
  write-back, and the section note was the one place saying otherwise. `--resources` gains
  `secrets` and `provision`; `commit` still names every type it named before.
- **`forge sync` draws its tables in box-drawing characters** rather than pipes and hyphens, so a
  section is a closed shape whose start and end are visible without counting rules. Each section's
  title now stands on its own line with its rule grey beneath it, rather than the two running
  together as one sentence that regularly ran past the window.
- **`forge sync` renders to the terminal it is writing to.** The `Action` column is coloured by
  outcome — green settled, cyan waiting on `--commit`, yellow wants a look, red failed, dim nothing
  to decide — so a forty-row report is scannable. Section notes and the `Action` and `Detail`
  columns wrap to the window instead of running off it; identifier columns truncate instead, since
  a binding name broken across two lines is no longer one you can search the config for. The
  `--force` rewrite warning is yellow and the `Updated <path>` confirmation green. `--json` is
  unaffected — it selects `PLAIN` and its payload is data no styler touches.

### Breaking Changes

- **A flag repeated without `multiple` now throws, where it used to keep the last occurrence
  silently.** This is the point of the change: `forge verify --only typecheck --only
validate-exports --only validate-docs` used to run one check and report `1 of 1 steps run`,
  saying nothing about the two it dropped. A repeatable flag collects every occurrence; a
  single-valued one refuses the repeat and names what would have been lost. `selectSteps`,
  `parseResources` and `resolveRotation` are **widened** to `string | readonly string[]`, never
  narrowed, so a caller passing the comma-joined string is unaffected.
- **One `forge` binary replaces the four `forge-*` ones, and the CLI namespaces moved beneath
  `src/cli/`.** `forge-verify`, `forge-release`, `forge-assets` and `forge-cfgen` are gone; the
  package now declares a single `bin`, `forge`, whose subcommands are `verify`, `release`, `sync`,
  `assets` and `gen-env`. Rewrite every script accordingly — `forge-verify --only lint` becomes
  `forge verify --only lint`, `forge-assets build css` becomes `forge assets build css`, and
  `forge-cfgen` becomes `forge gen-env`. `createGateBinCommand()` and `createReleaseBinCommand()`
  are unchanged apart from the command `name` they carry (`"verify"` and `"release"`), so a
  repository assembling its own tree keeps working. Pre-1.0, so no shim.
- **`@y-core/forge/pkg` is now `@y-core/forge/cli/pkg`, and `@y-core/forge/validation/cli` is now
  `@y-core/forge/cli/cfgen`.** The export surface of each is byte-identical; only the subpath
  changed. `@y-core/forge/cli` still resolves, now to `src/cli/core/mod.ts`. A consuming
  `config/steps.ts` needs its one import path updated and nothing else.
- **`cloudflareWorkerSteps` emits `["forge", "assets", "types", …]` instead of `["forge-assets",
"types", …]`.** A repository on the preset picks this up by upgrading; one that pinned the old
  `cmd` array in its own step table must edit it.

- **CSP directive sources are validated, and a malformed one now throws.** Every string source in
  every directive (`scriptSrc`, `connectSrc`, `frameSrc`, `imgSrc`, `styleSrc`, `fontSrc`,
  `workerSrc`, `childSrc`) must be a single CSP source token: non-empty, and free of whitespace,
  `;`, `,` and control characters. `'unsafe-inline'` is rejected case-insensitively wherever it
  appears. The `NONCE` symbol is exempt. The rule is enforced at both factory time
  (`createSecurityHeaders`) and call time (`applySecurityHeaders`) — so a value that previously
  passed construction, or that `applySecurityHeaders` previously emitted into a live policy or
  turned into a 500, now fails loudly at the point it is supplied. A source carrying a `;` or a
  space does not widen a directive, it terminates or splits it, silently rewriting the rest of the
  policy; there is no case where accepting one was correct. Pre-1.0, so no shim.
- **`mergeSecurityHeaders` now falls back to a directive's default when the base omits it.**
  Previously each directive was concatenated from the two inputs alone, so merging onto a base that
  did not name a directive produced that directive from the override only — `mergeSecurityHeaders({},
{ styleSrc: ["https://cdn.example.com"] })` emitted `style-src https://cdn.example.com`, dropping
  `'self'`, and the same shape merging `scriptSrc` dropped both `'self'` and the nonce placeholder,
  disabling every nonced inline script. The defaults now live in one `CSP_DEFAULTS` constant and
  seed the merge, so the example above emits `style-src 'self' https://cdn.example.com`.
  `workerSrc` and `childSrc` have no default and stay absent unless provided. A base that already
  named the directive is unaffected — the emitted policy is byte-identical.
- **`isHttpsOrLoopback` now requires the scheme it claims to check.** The predicate matched on the
  host, so any scheme reached the loopback allowance: `ws://localhost:8787` and `ftp://localhost`
  were accepted as origins. It now admits `https:` on any host, and `http:` only on `localhost` or
  `127.0.0.1`. Both callers tighten with it — `deriveAllowedOrigins`' `extraOrigins` and
  `BaseUrlConfigSchema` — so a non-http(s) `BASE_URL` or extra origin that used to be accepted now
  throws at boot. Values matching the documented rule are unaffected.

### Added

- **`forge sync` — Cloudflare binding reconciliation, folded in from `@y-core/foundry`.** Compares
  the bindings a `wrangler.jsonc` declares against what exists on the account, reports the plan,
  and provisions and writes back resolved ids under `--commit`. The engine, handler registry, API
  client and JSONC round-trip writer are published at `@y-core/forge/cli/sync`; the surface, its
  flags, the `.dev.vars` marker comments and the credential requirements are documented in
  `src/cli/sync/README.md`. `@y-core/foundry` is archived — depend on forge alone.
- **App-defined commands.** `forge` loads `config/commands.ts` from the working directory after
  attaching its own, so an application's commands appear in `forge --help` and run as
  `forge <name>`. The module default-exports an array of `CommandBase`. Absent, nothing changes; a
  name colliding with a first-party command fails loudly rather than shadowing it.
- **`@y-core/forge/cli/assets`** publishes `createAssetsCommands()`, the subtree `forge assets`
  attaches, so an application can mount the asset pipeline under a command tree of its own.

- **`style-src` and `font-src` are now configurable.** Both were string literals inside `buildCsp`
  and unreachable from `SecurityHeadersOptions`, so a third-party stylesheet or font host could not
  be allowed without bypassing the facade. They are now the `styleSrc` and `fontSrc` options,
  default to `'self'` exactly as before, and are listed in `CSP_DIRECTIVES` so `mergeSecurityHeaders`
  concatenates them. **The emitted directive order and every default are byte-identical** — the
  change is purely additive, and widening them still never introduces `'unsafe-inline'`: it is now
  rejected as a directive source outright. Forge ships no named third-party origins for either; for
  fonts specifically, self-hosting via the asset pipeline's `fonts.downloads` needs no widening at
  all and is the better default for the reasons `SECURITY_HARDENING.md` §2e gives.
- **`extraOrigins` on `deriveAllowedOrigins`.** `DeriveAllowedOriginsOptions` gains
  `extraOrigins?: string[]`, appended after the base origin and the optional `www` variant and
  de-duplicated against them. Each entry must be a normalized origin (`entry === new URL(entry).origin`,
  so no path, trailing slash, credentials or redundant default port — any of which would silently never
  match `verifyOrigin`'s exact-string comparison) and must satisfy the same https-or-loopback rule
  `BaseUrlConfigSchema` applies, now shared rather than duplicated; anything else throws, which for a
  dev entrypoint is boot time. **There is deliberately no env var** — extras arrive as a parameter from
  a dev worker entry production never imports, so the production bundle structurally contains no extra
  origin. It exists for the proxy-less `wrangler dev` fallback only; the standard posture is https at
  every hop, ruled in `SECURITY_HARDENING.md` §3f. Omitting the option leaves behaviour byte-identical.

### Fixed

- **`deriveAllowedOrigins` dropped the port from the `www` variant, granting an origin the caller
  never asked to trust.** The variant was built from the protocol and hostname alone, so a
  `BASE_URL` of `https://example.com:8443` produced `https://www.example.com` — port 443 implied.
  Because `cors`/`originGuard` compare by exact string, that entry handed cross-origin write access
  to whatever real service answers on the `www` host's default port (a marketing site, a CDN host,
  an XSS-able sibling) while _failing_ to grant `https://www.example.com:8443`, the origin
  `includeWww: true` was asked for. The variant is now derived from the already-normalized
  `parsed.origin`, so the port travels with it and a redundant default port stays collapsed. Bases
  on a default port are unaffected — the emitted strings are byte-identical. Under the https-at-every-hop
  dev posture non-default ports in `BASE_URL` are routine, so this was on its way from obscure to common.
- **`BaseUrlConfigSchema` rejected `BASE_URL` with a message naming one loopback host when the rule
  accepts two.** The predicate has always allowed `http://127.0.0.1` alongside `http://localhost`,
  but the valibot issue message and the schema's TSDoc named only `localhost` — so an operator who
  set `BASE_URL=http://127.0.0.1:8787` (a value that is in fact accepted) was told it must be
  `localhost`. Both messages explaining the predicate now interpolate one shared constant and cannot
  drift again. `parseExtraOrigin`'s message is unchanged in rendered value; **the schema's message
  text has changed**, which is visible to anyone matching on the issue string — pre-1.0, so no shim.

- **The Turnstile widget stole focus from the field the user had just clicked into.** `mountTurnstile`
  arms the lazy script load on the form's first `focusin`, so the trigger _is_ that first click — and
  when Cloudflare's `render()` grabs focus into its own frame, the grab landed on the field the user
  was about to type in, every session. Nothing forge passes causes it and Turnstile exposes no render
  parameter that suppresses it. `renderWidget` now captures the active element immediately before
  `render()` and puts focus back with `preventScroll`, but only when focus actually ended up inside
  the widget and the original element is still connected — focus the user moved elsewhere in the
  meantime is left where they put it.
- **Turnstile also stole focus _after_ `render()` returned.** The synchronous restore above cannot
  see a grab the widget's iframe makes once it has finished loading, nor a blur that lands on
  `document.body`, so the field the user was typing in still lost focus a beat later. A delegated
  `focusout` listener on the form is now armed for `TURNSTILE_FOCUS_GUARD_MS` (5000 ms) after
  `render()`: it tracks the last legitimately focused field and restores focus to it when the widget
  takes it or it is dropped to the body. A deliberate move to another control is honoured, and the
  restore is one-shot.

---

## [0.0.88] — 2026-08-18

### Added

- **`cloudflareWorkerSteps` can now gate `.decisions/governance/` against the pinned corpus.** Pass
  `governance: true` and the preset inserts a `governance` step between `lint` and `test`, running
  `governance-sync --check`; its fixer is the sync itself, so `bun run fix` reconciles the tree. The
  step is **opt-in rather than on by default**: it invokes a binary from `@y-core/governance`, which
  an app that does not clone the corpus has never installed, and an always-on step would fail there
  with `command not found`. The check is what catches the failure mode the directory's
  overwrite-on-sync rule creates — an edit made in place is reverted by the next sync, and the
  reversion looks like nobody's change — and it reconciles the Guide Index with the directory in
  both directions.

---

## [0.0.87] — 2026-08-17

### Fixed

- **The browser modules typecheck again inside a Worker app.** Since 0.0.86, any app whose
  `src/client/main.ts` imports `ui/show/client`, `ui/chrome/client`, `ui/client` or
  `ui/client/htmx` reported **15 errors from inside `node_modules/@y-core/forge`** — nothing the app
  could fix on its own. Wrangler's generated `.types/cloudflare.d.ts` declares HTMLRewriter's
  `interface Element` in global scope, where TypeScript **merges** it with lib.dom's; `Element` then
  carries `append(content: string | ReadableStream | Response)` and `remove(): Element`, which breaks
  the structural `ParentNode` contract, the `E extends Element` constraint and every
  `HTMLSelectElement` cast. Three internal changes, no exported signature narrowed:
  `queryAcross(root)` and `turnstile.ts`'s `ref(scope)` take `Element | Document | DocumentFragment`
  instead of `ParentNode`; `show/client.ts` no longer names `HTMLSelectElement`; `show/lazy-panel.ts`
  calls `appendChild` instead of `append`.
- **The gate can now see that failure mode.** forge's own type program has no `wrangler types` output
  in it, so `bun run verify` was green throughout — which is how 0.0.86 shipped. A new
  `typecheck:workers-consumer` step typechecks `tests/fixtures/workers-consumer/`: a Worker app's
  `tsconfig.json` (`types: []`), a stub declaring the merging `interface Element`, and an entry
  importing the four browser subpaths exactly as an app does.

---

## [0.0.86] — 2026-08-17

### Breaking Changes

- **`NavbarProps` is now a union over `collapsedAs`/`collapsible`, and a rail drawer's sprite owes
  two more glyphs.** A rail that opens off-canvas — `collapsedAs="drawer"` with
  `collapsible="always"` — draws `panel-open`/`panel-close` rather than the hamburger, so its `icon`
  is typed `ForgeIcon<NavGlyph | NavDrawerGlyph>`. A top bar keeps its hamburger whether it opens in
  the flow or off-canvas, so every call site that existed before this release is unaffected in both
  type and markup. The pair ships
  in `src/ui/assets/core/`, so a consumer on `forgeUiSpriteSources()` gets them with no change;
  a hand-listed sprite adds two filenames.

  ```diff
    sources: [
  -   { path: "node_modules/@y-core/forge/src/ui/assets/core", files: ["chevron-down.svg", "close.svg", "hamburger.svg", "spinner.svg"] },
  +   {
  +     path: "node_modules/@y-core/forge/src/ui/assets/core",
  +     files: ["chevron-down.svg", "close.svg", "hamburger.svg", "spinner.svg", "panel-open.svg", "panel-close.svg"],
  +   },
    ]
  ```

  There is deliberately no `panel-right-*`: the pair is drawn for the leading edge and mirrored with
  `-scale-x-100` for a trailing bar and again under `rtl:`, so the two flips cancel and one pair
  serves all four cases.

- **Forge's components now emit logical spacing utilities, so a physical override no longer wins the
  `cn()` conflict.** `pl-*`/`pr-*`/`ml-*`/`border-l`/`border-r`/`rounded-l`/`rounded-r`/`text-left`
  have become `ps-*`/`pe-*`/`ms-*`/`border-s`/`border-e`/`rounded-s`/`rounded-e`/`text-start`
  throughout `ui/core`, `ui/contracts` and `ui/show`. `border-w-r` and `border-w-e` are **distinct
  conflict groups**, so an app that overrode a forge component with `border-r-0`, `pr-4` or
  `text-left` previously replaced forge's token and now merely sits beside it — both reach the
  stylesheet and the cascade, not `cn()`, decides. Restate such an override in its logical spelling.

  ```diff
  - <Alert class='pr-2 text-left' />
  + <Alert class='pe-2 text-start' />
  ```

  The gutter-reserving components (`Select`, `Toast`, `Alert`) are additionally written
  _explicitly_ logical — `ps-3 py-2 pe-10` rather than `px-3 py-2 pe-10` — so no shorthand/longhand
  pair is left for the consuming app's Tailwind build to order. One consequence is visible in
  rendered markup: `Toast` and `Alert` now drop their base `pe-*` when the dismissible variant sets
  its own, where the old `p-4` + `pr-10` pairing emitted both.

- **`mountTurnstile` is no longer exported from `@y-core/forge/ui/client`; `<Turnstile>` carries its
  own scope instead.** The widget now stamps `data-scope="turnstile"`, and
  `@y-core/forge/ui/core/client` registers it — the same wiring `Menu`, `Tabs`, `Tooltip` and
  `NumberField` have always used, none of whose controllers is public either. A global
  `mountTurnstile()` in a shared client entry ran on **every route** of an app: 598 pages of 600 paid
  for a capability two of them wanted, and each logged a "no widget under the mount root" miss. The
  capability now arrives with the component and cannot be summoned without one — a page that renders
  no `<Turnstile>` has no scope to resume, so nothing is mounted, fetched, or reported.

  ```diff
  - import { mountTurnstile, resume } from "@y-core/forge/ui/client";
  -
  - mountTurnstile();
  - resume();
  + import "@y-core/forge/ui/core/client";   // already imported by ui/chrome/client
  + import { resume } from "@y-core/forge/ui/client";
  +
  + resume();
  ```

  Delete the `mountTurnstile()` call and its import — there is nothing to replace it with. The
  contract gains `TURNSTILE_SCOPE`; the controller's argument is now a required root, and it matches
  that root itself before descending, so the scope root being the widget resolves correctly.

- **`ui/client` is cut to five complete offerings, and every remaining export carries an
  unconditional guarantee.** The barrel goes from 23 statements and 51 names to 10 and 28. Five
  guarantees now hold with no residual: every public export returns a disposer or is a pure function;
  no failure is silent; every public mount controller is idempotent per element; an effect runs
  exactly once per settled state; and overlay motion is the platform's.

- **The transition and trigger-state controllers are deleted — the platform does both.**
  `mountTransitionState`, `mountPopupTriggerState` and the `data-open` / `data-closed` /
  `data-starting-style` / `data-ending-style` / `data-popup-open` attributes are gone, along with the
  `open`, `popupOpen` and `transition` keys of `stateAttrs`. `@starting-style`,
  `transition-behavior: allow-discrete` and `overlay` cover enter, exit, asymmetric durations and exit
  timing; `:has()` covers the trigger highlight. The deleted controller re-derived the UA's own
  transition clock by string-parsing `getComputedStyle`, could not see `animation-iteration-count` at
  all, and could not keep an element in the top layer for a single frame.

  ```diff
  - <Dialog class="transition-all data-[starting-style]:opacity-0 data-[closed]:scale-95">
  + <Dialog class="transition-all transition-discrete starting:opacity-0 not-open:scale-95">
  ```

  The mechanical mappings are `data-[starting-style]:` → `starting:`, `data-[open]:` → `open:`,
  `data-[closed]:` → `not-open:`, plus `transition-discrete` on the class string and `overlay` in the
  transition list of any popover that animates out. Tailwind's `open:` variant compiles to
  `&:is([open], :popover-open, :open)`, so one variant covers `<details>`, `<dialog>` and popovers.
  A trigger that read `data-[popup-open]:` is styled by a `:has()` rule in `forge-ui.css` instead;
  `Dialog` has none, because its `::backdrop` paints over the trigger by construction.

- **`mountAnchorBinding` and the `anchor-name` / `position-anchor` block are deleted.** A popup shown
  by an invoker gets an **implicit anchor** — its invoker — for `command`/`commandfor` exactly as for
  `popovertarget`, and `position-anchor`'s initial `auto` resolves to it. The stylesheet's own names
  were _overriding_ that anchor, which is what made a JavaScript binding look necessary. Placement
  improves: each submenu now binds to its own row rather than to the parent panel's top corner.
  `Tooltip.Content` keeps `--forge-tooltip`, since it has no invoker to inherit an anchor from.

- **`bindField`, `bindGroup`, `parseControlValue` and `applyControlValue` collapse into one two-way
  `bindControls(root, signals)`.** It installs one listener on the scope root and one effect per
  field, and returns a disposer. Consumers no longer hand-write the signal → DOM write-back, and a
  button group can now express booleans, numbers and multi-select, which the previous split could not.
  Bound controls stamp `data-field` and no `data-on-*` action, so a bound-control scope must be
  `eager: true`. It crosses both boundaries the split version tripped on: the event is resolved
  without an `instanceof` check, so a control in another realm still binds, and the repaint descends
  into open shadow roots, so a bound control inside one is painted from its signal like any other.

  ```diff
  - registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } });
  + registerScope("chrome", { eager: true, setup: ({ root }) => bindControls(root, sig) });
  ```

- **Writing a signal during an `effect` or `computed` run now throws.** It previously warned, and a
  write from inside a `computed` was not even warned about. This is what makes "an effect runs exactly
  once per settled state" a guarantee: the edge that causes the double run is a _write_ edge, which
  the read graph cannot see, so topological ordering would not have fixed it. Derive with `computed`,
  command from the `on` handler, and defer with `queueMicrotask`. The refusal runs _before_ the
  equality check, so a write that happens to match the current value throws too — where the write was
  made is the rule, not what it carried.

- **`resume()` no longer wedges the page.** Installing the delegated listeners and resuming a tree are
  now two jobs: the delegation is per-document and refcounted, and the eager pass runs on every call
  over the root it was given — so `resume()` followed by `resume(shadowRoot)` now visits the shadow
  subtree instead of returning the first disposer and leaving it inert. Each disposer releases only
  the scopes its own call resumed; the **last** holder's disposer additionally disposes every scope
  still active in that document, because a lazily-resumed scope belongs to no call and would otherwise
  outlive the listeners that could reach it. Each eager `setup` runs in its own try/catch, so one
  throwing scope no longer kills every scope after it, and a later `resume()` re-attempts it.
  `data-state` that is malformed or is not a JSON object now throws instead of silently yielding an
  empty state.

- **Removed with no replacement:** `repeat` (undocumented, framework-shaped, zero callers),
  `mountActiveDescendant` / `resetActiveDescendant` (131 lines, zero callers, no Combobox exists),
  and `loadScriptOnEvent` / `loadStylesheet` / `LazyLoadOptions` — a disposer for `loadScriptOnEvent`
  is impossible in principle, since an injected script cannot be un-run.

- **Un-exported, code retained:** `mountMenu`, `mountTabs`, `mountTooltip`, `mountNumberField`,
  `withOwner` / `OwnedRun`, and the duplicate `ACTIVE_COMPOSITE_ITEM` route
  (its home is `ui/contracts`). These are mounted by forge's own scopes exactly once per root, which
  is what makes the per-element idempotence guarantee true by surface rather than by a registry per
  controller. `COLLAPSIBLE_SCOPE` and `ACCORDION_SCOPE` are gone outright: their registrations did
  nothing but mount the two deleted controllers. `DIALOG_SCOPE` and `POPOVER_SCOPE` stay — the first
  calls `showModal()` for an SSR-open modal, the second syncs `aria-expanded`.

- **`Tooltip.Content` emits `popover="hint"` instead of `popover="manual"`**, which brings
  light-dismiss and Escape from the platform and deletes a document-level `keydown` listener. Showing
  a hint leaves an open `auto` popover open — the exact property `manual` was chosen for — and opening
  an `auto` popover closes the hint. There is no fallback risk: `popover` is an enumerated attribute
  whose invalid-value default is `manual`, so a non-supporting engine gets exactly the old behaviour.

- **`--accent-9` is no longer the same colour in both modes.** `ACCENT_RAMP.dark.lightness[8]` drops
  from `0.52` to `0.5075`, so the shipped dark solid moves `#375bd7` → `#3457d3` and
  `theme-neutral.css` declares the step as `light-dark(oklch(52.00% 0.1950 267.0), oklch(50.75%
0.1950 267.0))` — the last accent step that was written bare, precisely because the two modes used
  to agree. This is what closes the `--primary-foreground` hazard recorded under **Fixed** below: one
  solid served both a near-white light foreground and a dark-mode `--gray-12` one, and dark had the
  smaller headroom. An app that copied forge's bare `oklch(52.00% 0.1950 267.0)` into its own scheme
  file keeps the old, failing dark value and must restate it in the `light-dark()` form. The
  customiser at `/showcase/ui/theme` emits the correct shape for any dials.

### Added

- **`Navbar` takes `collapsedAs`** — `"inline"` (the default, and byte-identical to today's markup)
  or `"drawer"`, which below `md` takes the collapsed panel out of the flow: a fixed panel sliding
  in from the edge `placement` implies, over a `data-slot="navbar-backdrop"` scrim, leaving the
  content behind it exactly where it was. A rail in this mode swaps its hamburger for a
  `panel-open`/`panel-close` toggle; a top bar keeps the hamburger, which is what a bar's menu reads as. Every drawer class is scoped `max-md:`, so the `≥md`
  render is untouched. The bar drops its own `backdrop-blur` below `md` because `backdrop-filter`
  establishes a containing block for `position: fixed` descendants — the same trap a consuming app
  hits by blurring the `<header>` the bar sits in, which `08-navigation.md` now documents with a
  worked pair (`forge-ui-nav-drawer-containing-block`).
- **`mountNavDrawer`** in `ui/client`, and `NAVBAR_DRAWER_ATTR` in `ui/contracts` — the modal
  behaviour a drawer owes: Escape, a focus trap over the panel's focusables, focus moved in on open
  and returned to the toggle on close, and a scroll lock written through CSSOM and restored exactly.
  The `navbar` scope mounts it for any bar carrying the attribute, so an app that already imports
  `ui/chrome/client` wires nothing.

- **`CatalogPanel`** in `ui/show` — the card-shaped catalog band, promoted from the copy
  `sections.tsx` already had so `ThemeSection`, `ResumableSection` and the six HTMX demo sections
  stop hand-rolling the same `<section>`/`<h2>`/`<p>` shape three ways. Deliberately a sibling of
  `CatalogSection` rather than four new flags on it. The container bands (`#htmx-demos`,
  `#compositions`), the `<h3>` sub-surfaces in `compositions.tsx` and the customiser's page sections
  are left alone: they are different shapes, and forcing them through a band component would be
  worse than the inconsistency.
- **`Resumable` takes a `ref`**, mapped to `data-ref` and emitted after `data-state` and before
  `class` — the same prop→attribute pattern `ToolbarAction.ref` uses. It is what let the showcase's
  last two hand-written `<div data-scope>` elements become real `<Resumable>` components; the
  attribute is absent entirely when the prop is.
- **The lazy demo proves its own retry claim.** A second anchor's first two loads reject on purpose,
  its `onError` writes each attempt to a `role='status'` line, and the third resolves — so
  `lazy()`'s `LAZY_MAX_ATTEMPTS` path is walked rather than only described. The deferred module now
  carries real content, so the deferral has a visible cost instead of setting one `textContent`.
- **`COVERAGE_MISSING` is empty**, and the showcase's thin demos are thick. The coverage test now
  renders through a real `createIcon` binding instead of a component returning `null`, which is what
  made every glyph marker measurable at all; `IconSection` draws all seven glyphs and a labelled
  `role="img"` one. Navbar and Toolbar render all four placements each — the two gaps that were
  apologies in prose the gate could not see. `Meter`, `NumberField`, `Dialog`, `Input`, `Textarea`,
  `Collapsible`, `Form`, `Honeypot` and `ThemeToggle` each gain the instances their own declared
  props owe, and each of the six original bound controls gains a second instance on its own field in
  a non-default state. Every added instance is declared as an axis in `DEMO_COVERAGE`; an instance
  with no axis is decoration. `Card` and `Field` were already complete and are untouched.
- **The theme customiser previews and measures the accent family**, so all five dials move something
  on screen. `SCALE_ROWS` is four rows — both families in both modes, accent first to match the lever
  order, every id `${family}-${mode}` — each with a visible label, because light `accent-1` and
  `gray-1` are indistinguishable side by side. A contrast side now names its `family` and may carry a
  step **per mode**, resolved through the one `sideStep(side, mode)`; that is what lets
  `--primary-foreground` (`--accent-contrast` on `--accent-9`) be measured live rather than declared
  unreachable. `liveRatios` grows from twelve entries to fourteen, `scalePairs()` from six to seven.
- **A copy control beside the generated scheme and beside the share link**, each a `Button
variant='secondary' size='sm'` that reads the DOM it sits next to — what is copied is exactly what
  is displayed — confirms in its own visible label, and announces through a sibling `role='status'`
  span rather than an `aria-label` that would breach WCAG 2.5.3. Absent or rejected
  `navigator.clipboard` (every plain-HTTP deploy) says so and leaves the label alone. The output block
  carries its own stateless `customise-copy` scope: `runAction` walks to the nearest `[data-scope]`,
  and widening the lever scope over the page would hand `bindControls` the compositions band.
- **The customiser's scale preview has an `<h2>`**, like every sibling section, and the module-local
  component is renamed `ScalePreviewSection` — `ui/show` no longer declares `PreviewSection` twice.
- **`<dialog closedby="any">` on `Dialog`** — declarative light-dismiss, which `Dialog` did not have.
- **An animated disclosure height** for `Collapsible` and `Accordion`, via `::details-content` and
  `interpolate-size: allow-keywords`. Measured: the opt-in only takes effect from `:root`, so it is
  declared there and takes effect only where an author transitions to or from a keyword.
- **`safeStorage(win)`** in `ui/client` — a realm's `localStorage` or `null`. `typeof
win.localStorage` is not a sufficient test: in Safari's private mode the property is present and
  `getItem` still throws `SecurityError`.
- **`popover="hint"`** is now accepted by the JSX `popover` attribute type, and `<dialog>` accepts
  `closedby`.
- **A bound-control band in `ui/show`** — every `@y-core/forge/ui/controls` variant under one eager
  `show-controls` scope, each with a live readout of the signal driving it, beside a native-versus-bound
  exemplar of the same control. `FormField`'s `Set` / `Legend` / `Content` / `Title` / `Separator`
  anatomy and `Label`'s required marker are demonstrated alongside it.
- **A coverage gate for the showcase** — `DEMO_COVERAGE` names every `ui/core`, `ui/controls` and
  `ui/chrome` component the catalog must demonstrate and the variant axes each must show; a test fails
  the build on any barrel export it does not declare and on any demo or axis the rendered catalog does
  not contain. `COVERAGE_MISSING` is the only excuse list, every entry owns a task, stale entries fail,
  and it is empty today ([`UI_SHOWCASE.md`](.decisions/UI_SHOWCASE.md)).
- **Catalog sections closing that gate** — the chrome navbar and toolbar, `Flash`, the lazy panel, the
  six bound controls and the native-versus-bound pair, plus the overlay, menu and variant-axis demos
  the existing sections were missing.
- **`renderAvatar` (`@y-core/forge/ui/show`)** — the showcase's `…/api/avatar` endpoint, so the
  `Avatar` demo loads an image from the app that mounts it rather than from the network.
- `NAVBAR_FILTERS_EVENT` (`@y-core/forge/ui/contracts`) — the document event the navbar scope listens
  for to re-sync its auth filters, named once so an app cannot mistype it.
- `CONTROLS_DEMO_SCOPE`, `CONTROLS_DEMO_STATE`, `ControlsDemoState` and `controlsReadout`
  (`@y-core/forge/ui/contracts`) — the bound-control band's scope name, server-rendered state and
  readout formatter, so the SSR markup and the browser scope cannot drift on them.
- `toSrgbGamut` and `oklchCss` (`@y-core/forge/ui/contracts`) — the gamut-mapped coordinate behind
  `oklchToHex`, and the `oklch()` emission format a scheme file carries. `oklchToHex`'s output is
  unchanged.
- `lightDark` (`@y-core/forge/ui/contracts`) — one value covering both modes, collapsed to the bare
  value where the two agree.
- `matchPreset`, `PRESET_CUSTOM` and `PRESET_FIELDS` (`@y-core/forge/ui/contracts`) — the preset
  picker's shared vocabulary, declared once so the SSR markup and the browser controller cannot drift
  on it.
- `PRESET_ACTION` (`@y-core/forge/ui/contracts`) — the scope action the preset picker fires, declared
  beside the rest of the picker's vocabulary so the SSR markup and the browser handler cannot drift.
- `paintedHex` (`ui/client/browser-test-helper`, test-only) — the `#rrggbb` a colour value paints as.
  A token's computed value is now the `light-dark()` text, and a non-legacy colour serializes in its
  own space, so neither `getPropertyValue` nor a computed `color` is a colour a spec can compare.
- `splitLightDark` (`@y-core/forge/pkg`) — the depth-aware value splitter the contrast parser reads
  a `light-dark()` with.
- `validate-contrast` fails any `.dark` rule that declares a custom property, in any stylesheet under
  its `cssDir`. This is the prevention the whole change is for. A `.dark` rule declaring no custom
  property is untouched, which is what lets `theme-base.css` set `color-scheme` there.
- **Two governing documents** — [`THEME_GENERATION.md`](.decisions/THEME_GENERATION.md) (the dial
  model a scheme is generated from, its emission contract and the audited contrast pairs) and
  [`UI_SHOWCASE.md`](.decisions/UI_SHOWCASE.md) (what an app supplies to mount `ui/show`, and the
  coverage contract above).

### Changed

- **The showcase reads as two rails rather than one.** `tocConfig` held the page list and the
  current page's anchors in a single `NavDefinition`; they are two axes, so they are now two bars —
  `pagesConfig`/`pageHref` on the leading edge, `sectionsConfig`/`anchorHref` on the trailing one,
  both `collapsedAs='drawer'`. The `show-toc` scope wraps only the trailing rail now, so
  `mountScrollSpy`'s `a[href^='#']` default stops sweeping up the page links it never meant to mark.
- **`Textarea` grows with its content.** The base now carries `field-sizing-content min-h-16
max-h-64`. Because `field-sizing: content` makes the `rows` attribute stop determining height, the
  floor and the cap are part of the contract rather than styling: without them a consumer passing
  `rows` would get a collapsed one-line box, and a long paste would grow without bound. Override
  either with your own `min-h-*`/`max-h-*`.
- **`Alert.Description` sets `text-pretty`**, so a description no longer ends on an orphan word.
- **`Select`'s chevron, and `Toast`'s and `Alert`'s dismiss button, are positioned with `end-*`**
  rather than `right-*`, so the reserved gutter and the control that occupies it stay on the same
  side under `dir="rtl"`.
- **Every silent failure path now throws or reports**, by one rule: _throw when the outcome is a
  property of the call site; report when it is a property of the page, the realm or the data._ A
  missing `root` in `mountScrollSpy` and an unresolvable target in `mountViewportCollapse` throw. A
  missing `IntersectionObserver`, `matchMedia` or `MutationObserver`, an absent optional widget, a
  `data-field` naming no signal, and a rejected `lazy` load with no `onError` all report.
- **`openPopoverAt` returns a disposer** instead of `void`. A second call cancels the first pending
  arm rather than arming a second listener, and the deferred show bails when the element has left the
  document — an htmx swap between the arm and the release used to call `showPopover()` on a detached
  node.
- **`isDark` is a per-document registry.** A second theme scope reports and is ignored; disposal
  promotes the next live scope, or falls back to constant `false`, rather than leaving a dangling
  reference to a dead scope's computed.

- **A colour scheme declares each step once, with `light-dark()`, and no forge stylesheet carries a
  `.dark` block of values.** The two-block form could not be supplied safely: `:root` and `.dark`
  both weigh 0-1-0 and both match `<html>`, so source order decided, and a consumer's scheme —
  imported after forge's — replaced the light half while silently keeping forge's dark one. Light
  mode looked correct and only a reader already on the dark theme saw the defect. A documented
  requirement that fails silently is a design defect rather than a documentation gap.

  ```diff
    :root {
  -   --gray-11: #646464;
  +   --gray-11: light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0));
    }
  - .dark {
  -   --gray-11: #b4b4b4;
  - }
  ```

  **Every painted colour is byte-identical to 0.0.85** — the emitted coordinates are gamut-mapped, so
  the mapping converter that writes them and the clipping converter a browser uses land on the same
  byte, which a new test asserts for all four schemes across both modes and twelve steps.

  - **Update your own scheme file** to one `:root` block, wrapping any step whose value differs by
    mode in `light-dark(light, dark)`. A step that is the same colour in both modes is written bare.
    Solid steps are now `oklch()`, the space the ramps are authored in.
  - **`theme-base.css` now sets `color-scheme`** — `light` on `:root`, `dark` on `.dark` — which is
    what selects the branch. It stays out of the scheme files deliberately: a scheme is the file a
    consumer replaces, the mode wiring is the file they do not. The visible bonus is that scrollbars
    and the UA-rendered controls forge cannot paint — the native `<select>` popup among them — now
    follow the theme rather than contradicting it.
  - **`getComputedStyle(...).getPropertyValue("--gray-11")` no longer returns a colour.**
    `light-dark()` resolves at _used_-value time, and a custom property's computed value is the
    substituted text, so a token read this way is the same string in both modes. Read the colour off
    an element that paints it instead — set `style.color = "var(--gray-11)"` on a probe and read back
    `getComputedStyle(probe).color`.
  - **A browser without `light-dark()` loses its colours** rather than falling back to one mode. This
    is accepted: `light-dark()` is Baseline, and forge owes no compatibility shim before 1.0.

- **The per-scheme alpha scale is deleted.** `--gray-a1` … `--gray-a12` and `--accent-a1` …
  `--accent-a12` are gone from all four scheme files, and `buildAlphaScale` is gone from
  `@y-core/forge/ui/contracts`. Nothing in forge ever read them, so a scheme still declaring the
  twenty-four properties compiles and renders exactly as before — the declarations are simply inert.
  The only real break is an app reading `var(--gray-a6)` in its own CSS, so sizing this upgrade is a
  grep for `--gray-a` in your own stylesheets.

  - **A scrim, or anything translucent over content it must not hide**, moves to the absolute
    `--black-a1` … `--black-a12` and `--white-a1` … `--white-a12` ramps in `theme-colors.css`. Those
    stay, and are now the whole of forge's sanctioned translucency; `--overlay` is `--black-a6`.
  - **A surface tint** — "slightly lighter", "slightly darker" — moves one step along the solid
    scale, per `forge-ui-color-scale-no-adhoc-tint`.

  A per-scheme alpha step composites over its _own_ scheme's step 1, which makes it page-relative and
  so mode-inverting: black over a light page, white over a dark one. A scrim has to darken in both
  modes, so the ramp could not express the one thing an alpha token is for. The shipped values
  carried a light-branch error besides — forge swaps steps 1 and 2 in light, and the alphas were
  transcribed from a source where step 1 is the page — so nothing correct is lost.

- **`scaleVars` returns twelve pairs rather than twenty-four, and `stepProperty(family, step)` drops
  its `kind` parameter.** Both follow from the deleted alpha scale.

- **`schemeCss` emits one `:root` block and adds `--accent-contrast`.** A generated scheme is now
  standalone-complete — a file that is correct only when layered over forge's default is the same
  silent half-supply in a different shape.

- **`scaleVars(family, solid, alpha)` is now `scaleVars(family, scales)`**, taking both modes and
  returning values that already carry their `light-dark()`.

- **`MODE_SELECTOR` is now `MODE_LABEL`** (`@y-core/forge/pkg`), carrying a mode word rather than a
  selector, there no longer being a per-mode selector to name.

- **`computed` is lazy and pull-based.** Its body no longer runs at creation, and never runs at all
  if nothing reads it — a behaviour change for any computed whose body has a side effect, which none
  should. A read re-derives only when a source it read has actually moved, so a reader can never
  observe a derived value assembled before one of its sources moved. That torn read was reachable
  whenever a computed had two sources and the second was written later in the same flush.

  ```typescript
  const sum = computed(() => x.value + y.value);
  effect(() => {
    observed = sum.value;
  });
  effect(() => {
    y.value = x.value;
  });
  x.value = 1;
  // was: observed === 1 while x === 1 and y === 1.  now: 2
  ```

  Effect-to-effect chains are unchanged and still settle rather than being glitch-free: laziness
  changes what a re-run reads, not whether it happens
  ([`UI_CLIENT_RUNTIME.md`](.decisions/UI_CLIENT_RUNTIME.md) §3a). The cycle cap is now **100 runs
  per node** per flush instead of 10 000 total, which makes the budget independent of graph size; a
  computed that reads its own value throws with the same `the graph is cyclic` message rather than
  recursing without bound.

- **The theme customiser's preset dropdown applies on change.** Picking a scheme repaints the page
  immediately through the `customise` scope — no submit, no navigation, and the `Apply` button, the
  `<form>` around the control and its five hidden dial inputs are all gone. The picker moves its two
  sliders with it — `bindControls` writes the DOM back from the signal — and falls back to `custom`
  the moment a lever is dragged off a preset. `?p=slate` still resolves server-side, so a preset link is unchanged.
  **The picker now needs JavaScript**, as the sliders beside it already did.

  It is the bound `ui/controls` `Select` on an `applyPreset` action, which writes the two gray dials
  directly — what a preset _means_ is the page's business, not the control's, and picking one is a
  command rather than a field binding. Every dial's slider is now reconciled from its signal in the
  same effect that writes the readouts, so a dial moved by anything other than its own thumb no
  longer leaves the thumb behind, and which preset the dials name is derived at paint time rather
  than stored.

- **The theme customiser's painter writes one `light-dark()` per property** and no longer watches
  `<html>`'s class list — the browser selects the branch, so the `MutationObserver` that existed only
  to re-paint on a theme toggle is deleted.

### Fixed

- **`<Dialog open>` floated over the page instead of sitting in the document flow.** `Dialog`
  documents `open` as _"Render open and non-modal"_, but `forge-ui.css` §6's `inset: 1rem; margin:
auto` — written for the modal case, as its own comment says — matched **every**
  `[data-slot~="dialog"]`. Combined with the UA's `position: absolute` for an open dialog, a
  non-modal one took the viewport gutter and centred itself over the whole page from first paint.
  The rule is now scoped to `:modal`, and a companion `:not(:modal)` rule flows a non-modal dialog
  inline with `position: static; margin: 0`. Modal dialogs are unchanged; both rules are
  `components` defaults, so a caller who wants a non-modal dialog positioned still writes
  `absolute` and wins on layer order. Found by the showcase's own new `open` demo — the first
  non-modal dialog forge had ever rendered.
- **The customiser's "No setting fails" claim was false for two of its five dials.** Measuring
  `--primary-foreground` for the first time turned up a real hazard the tool had never been able to
  show: `--accent-9` is lightness-pinned and so identical in both modes, while `--accent-contrast` is
  `--gray-1` in light but the darker `--gray-12` in dark, leaving dark the smaller headroom. Across
  the accent dial range light bottoms out at 4.85:1, but dark reaches about 4.41:1 — under the 4.5
  floor — in a band of high-chroma greens near hue 145, roughly 4.7% of the grid. The shipped defaults
  were safe throughout (5.48 light, 4.97 dark). **The ramp has since been moved to close it**: the
  dark step 9 drops to `0.5075`, no dial position on any of the four colour levers fails a floor any
  more, and the tightest point across the whole grid measures 4.59 dark against 4.84 light. The
  shipped defaults now read 5.48 light, 5.25 dark. See the `--accent-9` entry under **Breaking
  Changes** for what a consumer who copied the old value must restate.
- **Two theme toggles on one page cycled from each other's stale value.** Each `theme` scope hydrated
  its own `pref` signal from its own `data-state`, so a navbar toggle beside a settings or showcase
  toggle each mutated only its own: after cycling one, the other's next click advanced from the value
  it held before. The preference is a property of the _document_, and `ui/chrome/client.ts` now holds
  it that way — a `WeakMap<Document, …>` with a `holders` refcount, the shape `resume.ts` already uses
  for its delegated listeners. The first scope in a document builds the `pref` signal, the `matchMedia`
  listener and the two effects that paint `<html>`; every later scope takes a share and re-points its
  own `state.pref` at the shared one. Those effects are created inside a nested `withOwner`, so
  disposing the first of two toggles no longer stops the painting, and the last release drops the
  listener and the effects together. The "a second theme scope resumed on this page" warning is gone
  with the defect that motivated it ([`UI_CLIENT_RUNTIME.md`](.decisions/UI_CLIENT_RUNTIME.md) §2b).

- **`mountTurnstile(within)` searched the whole document instead of the node it was given.** It widened
  its argument to `ownerDocument(within)` before querying, so every scoped mount on a page with more
  than one `<Turnstile>` resolved to the _first_ widget: the later ones never rendered, never revealed
  their fallback, and — sharing one entry in the mounted-controller registry — disposing any of them
  removed the first one's live widget. It now looks the widget up within the passed element or
  fragment, and the fallback message up inside the widget itself; the arg-less call still widens to the
  document.

- **The showcase's Turnstile section shadowed `window.turnstile`.** Its catalog anchor was
  `id="turnstile"`, and the DOM publishes every `id` as a window property of that name, so Cloudflare's
  `api.js` found `window.turnstile` already truthy and reported "Turnstile already has been loaded" on
  a single, correct load. The anchor is now `turnstile-widget`, and a test refuses any catalog id in
  the reserved set.

- **An effect created in a scope's `setup` outlived the scope's teardown.** Only what a `setup`
  _returned_ was disposed, so an effect whose disposer was discarded stayed in its signals'
  subscriber sets forever, holding a closure over detached DOM and still running on every later write.
  The scope runtime now owns every effect created while `setup` runs and disposes it with the scope,
  which makes the leak unwritable rather than fixing the two sites that had it. A `setup` returns a
  disposer only for what the runtime cannot see — listeners, observers, timers, controller handles —
  and it runs _after_ the scope's effects are disposed, so nothing reactive is alive while an author's
  teardown mutates the DOM ([`UI_CLIENT_RUNTIME.md`](.decisions/UI_CLIENT_RUNTIME.md) §2d). Three
  adjacent defects are fixed with it: a `setup` that threw left its root marked resumed with no
  disposer — unreachable by every teardown and inert on re-resume; a throwing disposer aborted the
  teardown loop and silently skipped every scope behind it; and the `toast` scope's auto-dismiss timer
  was never cancelled, so a disposed toast still removed a detached node when it fired.

- **A signal written from inside an effect left its dependents permanently wrong.** Subscribers were
  notified inline and gated on an epoch counter that only advanced at the outermost write, so an
  effect that had already run in that epoch was skipped and never re-ran — the batch coalesced to one
  downstream run, but that run observed a torn state and was never corrected. Since `computed` is an
  effect that writes, the defect reached every derived value.

  ```typescript
  const sum = computed(() => x.value + y.value);
  effect(() => {
    x.value = trigger.value;
    y.value = trigger.value;
  });
  trigger.value = 5;
  // was: sum.value === 5, and stayed 5.  now: 10
  ```

  A write now enqueues its subscribers and drains them, so **by the time a write returns every
  dependent has observed the settled value**. Three consequences are worth knowing
  ([`UI_CLIENT_RUNTIME.md`](.decisions/UI_CLIENT_RUNTIME.md) §3a): a write inside an effect body is
  not visible to the next line of that body, only after the outermost write returns; a throwing
  effect drops the effects queued behind it until the next write, as it already did; and a genuinely
  cyclic graph — `effect(() => { s.value = s.value + 1 })` — now throws past a run cap rather than
  silently settling on a wrong value.

---

## [0.0.85] — 2026-08-14

### Fixed

- **`CheckboxGroup.Item` and `RadioGroup.Item` painted nothing.** Both named `border-input` with no
  border width and no `appearance-none`, and Tailwind's preflight sets `border-width: 0` — so the
  class was dead and the control a reader saw was the user agent's. They now draw their own box: an
  explicit `border-input` boundary (3.33:1 light / 3.76:1 dark against the page, and now an audited
  contrast pair) with a `checked:bg-primary` fill carrying the state. **This is a visible change** —
  the two controls no longer look like the platform's.

### Breaking Changes

- **`verify` and `release` are bins, not scripts a repository writes.** `forge-verify` and
  `forge-release` load their configuration and run; the two one-line binding files each consuming
  repo had to keep in step are gone, and with them the whole `scripts/` directory.

  ```diff
  - // scripts/verify.ts
  - await execute(createGateCommand({ cwd, steps: STEPS }));
  - // package.json
  - "verify": "bun run scripts/verify.ts"
  + "verify": "forge-verify"
  ```

- **`bun run lint` checks; `bun run fix` writes.**

- **`loadConfig` takes an options object with a required `root`.**

### Added

- **`forge-verify` and `forge-release` bins**, built by `createGateBinCommand` and
  `createReleaseBinCommand`. Both delegate to the existing factories once configuration is resolved,
  so there is one implementation of each run and the bin adds only `--config` and `--root`.
  `DEFAULT_STEPS_CONFIG` and `DEFAULT_RELEASE_CONFIG` name the paths they look in.

- **A pre-built step per check forge ships**, so a project names and configures a check in the step
  table rather than assembling one: `typecheckStep`, `lintStep`, `testStep`, `browserStep`,
  `exportsStep`, `namespaceGraphStep`, `jsxStep`, `docsStep`, `changelogStep`, `designStep`,
  `contrastStep`, `cssSourcesStep`.

---

## [0.0.84] — 2026-08-13

### Added

- **`@y-core/forge/pkg` now publishes the verification gate.** `createGateCommand({ cwd, gate,
steps, binDir? })` builds the `check` / `verify` verbs over a step table the consuming project
  owns — fail-fast execution, `--only` / `--list` / `--fix`, the zero-selection refusal, machine
  prerequisite probes, and the full-log file. The runner was previously `scripts/lib/gate-command.ts`,
  unreachable from the exports map.
- **`cloudflareWorkerSteps(options?)`** — the step table this fleet's Worker apps share:
  `cf:typecheck` → `types:assets` → `typecheck` → `lint` → `test`. A factory returning ordinary
  `Step` rows, spread into an app's own array. Every step is prerequisite-free, so the whole preset
  is legal in `check`.
- **`selectSteps`** plus the `Gate`, `Step`, `StepRequirement`, `Selection`, `GateCommandConfig` and
  `CloudflareWorkerStepOptions` types — an app can unit-test its own step table with no process
  spawned.

### Changed

- **`pkg`'s charter widened from release automation to project tooling** — both verbs. The
  namespace is reorganised into `gate/`, `release/` and `internal/`, still behind the single
  `src/pkg/mod.ts` barrel.

### Breaking Changes

- **Twelve plumbing symbols were removed from `@y-core/forge/pkg`**: `gitExec`,
  `isWorkingTreeClean`, `getLatestTag`, `getCommitsSinceTag`, `getLastCommitMessage`, `tagExists`,
  `createTag`, `readPackageVersion`, `updatePackageVersion`, `readRepositoryUrl`, `readChangelog`
  and `writeChangelog`. They exist only to serve the two command factories and are now `@internal`.
  What forge publishes is the policy over `git`, not a wrapper around it. `createReleaseCommand`,
  `resolveVersion`, the SemVer set and the changelog transforms are unchanged.

---

## [0.0.83] — 2026-08-12

**The semantic layer conflated a decorative hairline with a control affordance under one stop
mapping.** `--border`, `--input` and `--ring` were documented as a single concern — _"separation,
control outlines, and the focus ring"_ — and mapped accordingly: `--border` and `--input` were both
`--palette-400` in light and both `--palette-700` in dark. That is the correct value for a `Card`
edge and roughly **half** of what WCAG 1.4.11 requires of the only boundary a text field has. Every
control outline forge shipped sat at 2.36:1 in light and **1.70:1** in dark, against a 3:1 floor.
The light focus ring was worse: a 50%-alpha `color-mix` that composited to **1.63:1**, below the
border it was meant to replace, so focusing a field made its outline _fainter_.

The audit that followed — oklch → oklab → linear sRGB → WCAG relative luminance, worst case across
all five ramps in both modes — found the failures were systematic rather than local, and turned up
one **Level A** defect: `Slider` had no focus indicator at all. `appearance-none` removed the
platform's, and nothing replaced it.

**`--palette-*` is deleted rather than renamed.** The ramp existed only because the old semantic
layer needed something mode-agnostic to point at, and the step layer does that job — keeping both
would have left two indirections answering one question. Every declaration is gone from every
stylesheet forge ships.

**Tinted neutrals could not carry a scheme on their own, and that is a design-intent.** They are
calibrated to sit _under_ a saturated accent and only lean toward it; the accent carries the identity.
Forge has no accent — `--accent-12` aliases `--gray-12`, near-black — so the scheme itself has to.

**Every colour changes, and that is the largest visual change in the release.** The greys move from
the old Tailwind ramps to the new scale end to end — every surface, every border, every line of text.
It is not a re-tint of a few tokens.

### Breaking Changes

- **`--primary` is a brand colour now, not a near-black. Forge ships a real accent.** `--primary`
  resolved through `--accent-12`, which was aliased to `--gray-12` — so `Button variant='primary'`,
  the one control nearly every forge app renders, was near-black, and "theming" forge meant picking
  a shade of grey. `theme-neutral.css` declares a full `--accent-1…12` scale plus its alpha steps,
  and the semantic layer re-points:

  ```diff
  - --accent-12: var(--gray-12);          /* the alias is gone */
  - --primary:            var(--accent-12);
  - --primary-foreground: var(--gray-1);
  + --primary:            var(--accent-9);        /* Radix's `solid` step */
  + --primary-foreground: var(--accent-contrast);
  ```

  **Nothing will fail to compile. Every primary button changes colour.** If your app re-declared
  `--accent-12` to supply its own brand — the extension point the old comment named — that
  declaration now does nothing, because `--primary` no longer resolves through step 12. Re-declare
  `--accent-9` and `--accent-contrast`, or the whole `--accent-*` scale, which is what a scheme file
  is for.

  `TOKEN_CONTRACT` gains a `--primary-foreground` row, and it audits a pair that existed unaudited
  for 83 versions. `Button variant='primary'` has always been text on a filled surface, so 1.4.3 has
  always bound it; it escaped notice because near-white on near-black is so far clear of the floor
  that nobody thought to check. Pointing `--primary` at a saturated step is what makes the
  measurement matter, so the pair gets a row at the same moment it gets a colour.

> **Every consumer's rendering changes, and this time every colour does.** Five things in this
> release a compiler will tell you about: `mountNav` is removed, `Collapsible.Trigger` gains a
> required `icon`, `ToggleGroupItemSize` is removed, `ui/show`'s validate exports change shape, and
> `loadLogViewer` changes both its signature and its required options. One thing your **CSS build**
> will tell you about: `theme-zinc.css` no longer exists, so an `@import` of it fails to resolve.
> `theme-gray.css` and `theme-neutral.css` keep their filenames and are **entirely different files** —
> scheme files now, not `--palette-*` ramps — so an import of either still resolves and quietly means
> something else. Everything else is tokens and
> rendering — nothing else fails to compile and nothing throws, and four of those silent changes are
> behavioural rather than cosmetic. One further silent change is neither tokens nor rendering:
> `inlineValidation()`'s `sync` default moves from `"closest form:abort"` to `"this:abort"`, listed
> under **Fixed** because the old default threw. Read the table, then look at a dark-mode form.

- **`forge.css` now declares `@custom-variant dark (&:where(.dark, .dark *));` itself, and that is a
  takeover rather than a convenience.** The line was going to be this release's one required action;
  it is now forge's to declare, after the theme imports. An app that has already added it is
  unaffected — the declaration is identical and `@custom-variant` is last-declaration-wins, so the
  consumer's copy restates forge's. **The reconfiguration is not scoped to forge's utilities.** A
  custom variant is global, so this redefines `dark:` across the _consuming app's_ stylesheet too,
  and an app deliberately keyed to `prefers-color-scheme` loses its automatic dark theme with no
  error and no unmatched class. The escape hatch is the same cascade rule that makes a consumer's
  own copy harmless — re-declare the variant _after_ the import:

  ```css
  @import "@y-core/forge/ui/assets/css/forge.css";
  @custom-variant dark (@media (prefers-color-scheme: dark));
  ```

  Why forge takes it over at all is unchanged from what the line was always for. Forge's own colours
  are class-driven end to end — the `.dark` block re-declares the role steps and every semantic token
  resolves through them, so **forge itself now emits no `dark:` utility at all**; the status variants
  that briefly carried hand-written `dark:` halves resolve through `--status-*` instead. A consuming
  app's `dark:` utilities, though, sit on the same page as forge's tokens, and keyed off the OS
  rather than the theme class the two disagree the moment a dark-OS machine sets the toggle to
  `light`. A requirement forge holds its own half of is one fewer requirement with no diagnostic
  behind it. Forge cannot warn you in either
  direction: it has no Tailwind dependency, so nothing in its gate compiles CSS. The variant is
  written in **statement** form and in `forge.css` rather than `theme-base.css`, because
  `validate-contrast` parses the semantic layer by brace-counting `.dark { … }` and the block
  spelling would put a second thing that looks exactly like a mode block into the file that gate
  walks.

- **The per-mode override point moved from the semantic token to the role scale.** Every semantic
  token is now declared once and means the same thing in both modes, so an app that wrote
  `:root { --primary: … }` and relied on forge's `.dark` twin to flip it back gets that value in
  **both** modes — the twin it was overriding no longer exists. Nothing errors and nothing goes
  unset; the light value simply carries into dark. The replacement is to re-point the **step**,
  which is the layer that is still per-mode: `--accent-12` behind `--primary`, `--gray-11` behind
  both `--muted-foreground` and `--ring`, `--gray-10` behind `--input`. An override that was always
  meant to hold in
  both modes needs no change at all. This is the genuine breaking change of the sub-stage and the
  one no compiler will ever mention; `validate-contrast` refuses an audited token declared in
  `.dark` at all, so forge's own theme files cannot re-introduce the old shape, but a consumer's
  stylesheet is outside that gate.
- **`--input` and `--ring` are _lighter_ than the values this release's audit first landed on.**
  `--input` goes 4.34 → 3.33 in light and `--ring` 6.87 → 5.19, both still clear of the 3:1 floor
  1.4.11 binds them by, and both now measured as a single exact value rather than a worst case. The
  affordance fix is not weakened; the numbers move because the whole neutral scale moved under them.
  Against 0.0.82 a dark control still goes from a barely visible outline to a clearly visible one —
  the shipped dark `--input` measured **1.70:1**, which was not a near-miss.
- **`--muted-foreground` is the change that will be felt most widely** — 154 call sites, and where
  most text on a forge surface lands. Text has no decorative exemption, so 4.5:1 binds and the only
  lever is the foreground stop; moving the surface instead would collapse `--background` = `--card` =
  `--popover` and destroy the surface hierarchy. The cost is a narrower perceptual gap between
  `text-foreground` and `text-muted-foreground`, which slightly weakens the two-colour hierarchy
  `forge-ui-text-color-budget` relies on. Accepted, because the alternative is shipping failing body
  text.
- **`--ring` must sit one stop beyond `--input`,** and that invariant is now what fixes its value. A
  ring at the same stop as the input would make `focus:border-ring` a no-op in light; in dark it
  would make a focused control _recede_.
- **There is no longer a `--palette-*` ramp to supply, and an app that supplied one is now
  supplying nothing.** This supersedes the previous instruction that a consumer must declare
  `--palette-50` … `--palette-950`. The eleven stops are deleted, not renamed: nothing in forge
  reads them, so a stylesheet still declaring a ramp compiles, renders forge's own scale, and gives
  no sign that the ramp is inert. The extension point moved down one layer and shrank — a theme now
  re-declares `--gray-1` … `--gray-12` (and their `--gray-a*` twins) in both blocks and nothing else,
  and `theme-slate.css` is the worked example of exactly that shape. A brand _hue_ is a different
  extension point again: re-declare `--accent-12`, which `--primary` resolves through.
- **The ratios below are single exact values, not worst cases.** Forge ships four neutral scales now
  rather than five, and all four sit on one lightness ramp, so a row measured against
  `theme-neutral.css` — the default — describes `theme-stone.css`, `theme-gray.css` and
  `theme-slate.css` too, to within **0.05** at every audited step. That is a property of the
  construction, not a coincidence to re-check per scheme: `theme-gray.css` was added after the table
  below was pinned and moved none of it. An app that re-declares the steps to its own values is on
  its own ramp, lands somewhere else, and nothing checks that for you.
- **`LogViewerOptions` gains required `layout` and `context`, and `loadLogViewer` takes three
  arguments.** `renderLogViewerPage` used to build its own `<html>`/`<head>`/`<body>` — with no FOUC
  script, no dark class, and no `bg-background` on `<body>`. Dark mode was therefore unreachable
  there no matter what classes the components carried, which is the deeper half of the log-viewer
  defect above: the `@custom-variant dark` line this release requires could not have saved it. The
  shell is now the consumer's, exactly as `registerShowcase` has always taken it. `config` becomes
  the second argument, matching `definePage`'s own `(c, config, …)` shape, which `context` needs.
- **The log viewer's markup changes end to end**, which for a mounted viewer is the largest single
  rendering change in the release. Level chips are `Badge` variants (`error`→`destructive`,
  `warn`→`warning`, `info`→`info`, `debug`→`outline` — a neutral label, not a status signal). The
  table sits in `Card` + `Card.Content class='p-0'` inside a `ScrollArea`; the timestamp column
  carries `tabular-nums`; the filter submit moves to `size='sm'` `variant='primary'`; gaps move to
  the density-8 row; and the empty state now distinguishes its two causes — no entries recorded
  versus nothing matching the active filters — with a control that clears them in the second case.

Token by token. The **Was** column is 0.0.82's mapping and its worst case across the five ramps that
release shipped; the **Now** column is a role step and a single exact ratio against
`theme-neutral.css`, measured on the backdrop named beside it in `scripts/contrast-parse.ts`:

| Token                      | Mode    | Was                    | Now                               | Ratio           | Floor | Criterion |
| -------------------------- | ------- | ---------------------- | --------------------------------- | --------------- | ----- | --------- |
| `--muted-foreground`       | `:root` | `--palette-500`        | `--gray-11`                       | 4.34 → **5.19** | 4.5   | 1.4.3     |
| `--muted-foreground`       | `.dark` | `--palette-400`        | `--gray-11`                       | 3.94 → **7.67** | 4.5   | 1.4.3     |
| `--input`                  | `:root` | `--palette-400`        | `--gray-10`                       | 2.36 → **3.33** | 3     | 1.4.11    |
| `--input`                  | `.dark` | `--palette-700`        | `--gray-10`                       | 1.70 → **3.76** | 3     | 1.4.11    |
| `--ring`                   | `:root` | 50% `color-mix`        | `--gray-11`                       | 1.63 → **5.19** | 3     | 1.4.11    |
| `--ring`                   | `.dark` | `--palette-500`        | `--gray-11`                       | 3.04 → **7.67** | 3     | 1.4.11    |
| `--track`                  | `:root` | _(was `--input`)_      | `--gray-10`                       | **3.60**        | 3     | 1.4.11    |
| `--track`                  | `.dark` | _(was `--input`)_      | `--gray-10`                       | **4.46**        | 3     | 1.4.11    |
| `--destructive`            | `:root` | `--color-red-500`      | `--red-9` = `red-700`             | 4.33 → **5.63** | 4.5   | 1.4.3     |
| `--destructive`            | `.dark` | `oklch(…)` = `red-400` | `--red-9` = `red-300`             | 3.55 → **8.28** | 4.5   | 1.4.3     |
| `--destructive-foreground` | `:root` | _(did not exist)_      | `--red-contrast` = `--gray-1`     | **6.10**        | 4.5   | 1.4.3     |
| `--destructive-foreground` | `.dark` | _(did not exist)_      | `--red-contrast` = `--gray-1`     | **9.83**        | 4.5   | 1.4.3     |
| `--warning-foreground`     | `:root` | `--palette-50`         | `--yellow-contrast` = `--gray-12` | 1.83 → **8.51** | 4.5   | 1.4.3     |
| `--warning-foreground`     | `.dark` | `--palette-950`        | `--yellow-contrast` = `--gray-1`  | **12.04**       | 4.5   | 1.4.3     |

`--track` is measured thumb-on-track rather than track-on-page: the thumb is what distinguishes a
`Switch`'s off state from its on state, and it is the sole indicator of it.

**`--foreground` gets slightly stronger** — `--gray-12` measures **14.30** against `--muted`, above
what the old `--palette-950` mapping reached. It carries no contract row because no floor was ever
in question for it; it is noted because body text on a forge surface is the thing a reader will
compare first.

**The dark `--destructive` was a disguised palette reference.** It was written as the literal
`oklch(0.704 0.191 22.216)`, which is Tailwind's `red-400` to fifteen significant figures — so it
read as a bespoke colour nobody thought to check against the ramp it silently belonged to. It
measured **3.55** on `--muted`, and `text-destructive` inside a `bg-muted` panel is ordinary markup:
a recessed panel holding a validation error. `red-300` clears the worst backdrop forge puts error
text on at **8.28**, and naming it removes the last raw colour literal from the semantic layer —
which `forge-ui-color-scale-ramp-only` argues against.

- **The theme files are re-cut, and no theme file is the consumer's to import any more.**
  `forge.css` imports `theme-neutral.css` (the default scale), `theme-colors.css` (the fixed status
  hues) and `theme-base.css` (the mapping) for you, so forge renders correctly with **no theme file
  imported at all** — a setup step is deleted rather than changed. `theme-base.css` no longer
  declares a scale at all; it is the mapping layer and nothing else, which is what lets it hold no
  `.dark` block. The scheme files — `theme-neutral.css`, `theme-stone.css`, `theme-gray.css` and
  `theme-slate.css` — each declare the twelve steps and their alpha twins and nothing else.
  **`theme-zinc.css` is deleted, and that is the breaking half** — an app importing it gets a build
  error rather than a silent fallback, which is the outcome worth having. `theme-mist.css` and
  `theme-olive.css` were already removed above for a different reason: they never resolved at all.
  **`theme-gray.css` and `theme-neutral.css` keep their filenames and are different files** — scheme
  files rather than `--palette-*` ramps — so those two imports still resolve and quietly mean
  something else, which is the one move in this table a build will not flag.
  `package.json` exports `./ui/assets/css/*.css` by wildcard, so no export path changes shape and the
  export map needed no edit. The moves:

  | You imported                         | Do                                                                                                         |
  | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
  | `theme-neutral.css`                  | Drop the import — `forge.css` already imports it. Keeping it restates the default and changes nothing      |
  | `theme-gray.css`                     | Keep it for the **cool** scheme, or drop it for the achromatic default. Same filename, entirely new values |
  | `theme-zinc.css`                     | Import `theme-stone.css`, or drop the import; zinc has no successor                                        |
  | `theme-slate.css`, `theme-stone.css` | Keep the import; the values change                                                                         |

- **`theme-zinc.css` carried a live WCAG failure to its grave, and it is the sharpest argument for
  the whole change.** Its dark `--warning-foreground` rendered near-white on `orange-500` at
  **2.77:1**, while the comment on the very next line claimed 6.83. The cause is not a bad value; it
  is a cascade race. `:root` and `.dark` both weigh 0-1-0, so source order decides between them —
  and `theme-zinc.css` was imported _after_ `theme-base.css`, so zinc's `:root { --warning-foreground:
var(--palette-50); }` won in **both** modes and the base's `.dark` twin was never reached. Zinc's
  own `.dark` block said it "keeps the base's `--palette-950` foreground", which was true of the
  block and false of the page. This shipped on every release that had the file. It is what a
  mode-specific value at the semantic layer costs: correctness that depends on which stylesheet
  imported last. The step layer removes the class of bug rather than this instance of it — there is
  no per-mode declaration left at the semantic layer to race.
- **`theme-zinc.css`'s `--destructive` override goes with it.** It pinned
  `oklch(0.577 0.245 27.325)` — `red-600`, 4.33 on the page background, worse than the base value it
  was overriding.
- **The eight `--sidebar*` tokens and their eight `--color-sidebar*` bridge aliases are removed.**
  No forge component ever read one; they arrived with the inherited token set and were wired to
  nothing. The `@theme inline` bridge run is what makes Tailwind generate the utilities, so deleting
  it stops `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` and the rest of that
  family being generated at all — an app that used them loses the styling **silently**, with no
  build error and no unknown-class warning, because an unmatched utility is simply an unstyled
  class. Re-declare the eight tokens and the bridge aliases in your own stylesheet.
- **`mountNav` and `NavControllerOptions` are removed from `@y-core/forge/ui/client`.** The
  controller drove `data-ref="nav-toggle" | "nav-menu" | "nav-link"` markup **no forge component
  emits**, so it could only ever have run against a consumer's hand-written nav. Its claims are all
  held elsewhere now: `Navbar`'s collapse is a pure-CSS `<details>`, `mountScrollSpy` owns
  active-link tracking, and `mountViewportCollapse` owns viewport-driven open/close. This is the
  **loud** break in the release — the import stops resolving, so the compiler names every call site.
  An app that genuinely ran it against its own markup can vendor the ~90 lines out of git history;
  there is no shim.
- **`collapsible="always"` with no explicit `placement` now renders the left rail.** It previously
  resolved to `"top"` and rendered a full-width top strip that stayed permanently behind a hamburger,
  which is not a shape anyone asked for; it resolves to `"left"` and takes the rail classes. Two
  halves move, and **both are silent** — no compile error either way. The class string is one. The
  other is the generated ids: `idBase` falls back to the _resolved_ placement, so `navbar-menu-top-*`
  becomes `navbar-menu-left-*` and `navbar-group-top-*` becomes `navbar-group-left-*`, which breaks
  any selector, test or fragment target pinned to the old names. Pass `placement="top"` to keep the
  old rendering, or an explicit `id` to pin the old ids. `collapsible !== "always"` still defaults to
  `"top"`, and `Toolbar` is untouched.
- **`Collapsible.Trigger` now requires an `icon`.** A compile error at every call site, and that is
  the point: `list-none` on the `<summary>` deletes the UA disclosure triangle, and until now nothing
  was drawn back — a disclosure with no marker for whether it is open. The trigger now wraps its
  label in a `<span class='flex-1 pl-1'>` beside a `chevron-down` `Icon` that rotates when open.
  Forge stays icon-agnostic, so the sprite-bound `ForgeIcon` is injected rather than imported; a
  required prop is what makes the replacement unforgettable. The root's group name also changes,
  `group/collapsible` → `group/collapsible-item`, and _that_ half is silent: a consumer writing
  `group-open/collapsible:` inside a panel now matches nothing.
- **`ToggleGroupItemSize` is removed — use `ButtonSize`,** exported from both `@y-core/forge/ui/core`
  and `@y-core/forge/ui/controls`. `ToggleGroup.Item` had its own three-entry `ITEM_SIZE` map, which
  is exactly the second base string `buttonVariants` is exported to prevent; the item now resolves
  through `buttonVariants({ variant: 'ghost', size })` and takes the full six-name size scale. The
  removed type is the loud half. **The default is the silent one:** `sm` used to mean a 34px square
  and now means the button `sm` pill, `h-8 px-3 text-sm`. An icon-only item must pass
  `size='icon-sm'` to keep its box. The `[&_svg]` descendant sizing goes with the map, so an icon
  inside an item renders at its own size rather than being resized by its parent — and `Icon`
  declares no size of its own, so an icon that leaned on the item needs one at the call site.
- **`Select` routes the caller's `class` to the wrapper, not the inner `<select>`.** The wrapper owns
  the geometry — the width, and the containing block the chevron is positioned against — so
  `class='w-64'` sized the inner control and left the box that is actually laid out untouched.
  Forwarded _props_ still land on the `<select>`, which is what a caller means by every native
  attribute, `data-*` hook and ARIA relation; `class` is the one split, and `conformance.test.tsx`
  records it as a `classSlot`. A caller passing a text or padding utility now sets it on the wrapper
  and inherits it into the control; one passing a border or background utility styles the wrapper's
  box instead of the control's.
- **`Slider` no longer paints a filled-progress portion.** It dropped `accent-primary`, which is what
  Chromium and Firefox read to tint the track up to the thumb, and the authored replacement is one
  uniform `--track` bar. Silent — nothing about the markup or the type changes. A surface that used
  the fill to read the value at a glance now has only thumb position, which is what a range input
  affords natively; a fill is a component forge does not currently ship.
- **A rail's width, `shrink-0` and border move off `<Navbar>` onto the `Resumable` scope root.**
  `Navbar`'s own `class` lands on the `<details>`, two boxes inside the element the parent flex row
  lays out, so a width set there only ever looked right — every box between happened to size to its
  content — and a `shrink-0` set there guarded an element the flex algorithm was never going to
  shrink. `Resumable` takes a `class` for exactly this. Silent, and it compounds with the rail's
  height chain below: `src/ui/README.md` carries the current shape, and
  `forge-ui-nav-rail-flex-item` is the rule.
- **`@y-core/forge/ui/show`'s validate exports change shape**, so the demo's htmx round trip can
  reach the endpoint from inside the swapped fragment: `ValidateData` gains a required `paths`,
  `loadValidate(c, paths)` takes a second argument, `renderValidate(data, icon)` takes an `icon`, and
  `ValidateFragment` and `ValidateSection` both take an `icon` prop. All compile errors. The showcase
  is a reference surface rather than application infrastructure, so this is expected to reach few
  consumers.
- **`buttonVariants`' `icon-sm` is `size-8`, not `size-[34px]`.** Silent — the name and its place in
  the size scale are unchanged, and every call site keeps compiling; only the emitted class and the
  rendered box move, by two pixels. 34px was an arbitrary value wedged between `size-8` and `size-9`
  and carried a `forge-ui-spacing-scale-only` suppression to stay there. At 32px an
  icon button is exactly as tall as the `sm` text row it is meant to sit beside, which is the
  relationship `icon-sm` exists to express, and the suppression is deleted with it. Anything pinned
  to the literal `size-[34px]` string — a test assertion, a CSS selector — needs updating.
- **`Toolbar`'s flyout title and `Accordion.Content`'s `hint` are `text-xs`, not `text-[11px]`.**
  Both carried a `forge-ui-spacing-scale-only` suppression arguing the label had to read as
  subordinate to the 12px body beside it. The rule exists because scale steps differ by at least
  25%, which is what makes two sizes read as deliberate; 11px against 12px is 8%, so the pixel was
  buying no perceptible subordination and only an off-scale value. Subordination is carried by the
  channels that were always doing the work — `uppercase tracking-wider text-muted-foreground` on the
  flyout title, `text-muted-foreground` on the hint. Both suppressions are deleted, and `src/` now
  carries **zero** suppressions of `forge-ui-spacing-scale-only`. Anything pinned to the literal
  `text-[11px]` string needs updating.

### Fixed

- **`Slider` had no focus indicator — WCAG 2.4.7, Level A.** The most severe item in the audit, and
  the only Level A one. `<input type=range>` carries a UA focus ring; `appearance-none` removes it,
  and nothing put one back, so the control was completely unreachable-looking under keyboard
  navigation. It now carries `focus-visible:ring-2 focus-visible:ring-ring`.
- **`FieldError` and `Field`'s invalid state used a hardcoded `text-red-600`,** which fails in
  **both** modes — 4.33 light, 3.08 dark — and does not re-map with the theme. Both now use
  `text-destructive`. Same fix for `Label`'s required marker (`text-red-500`, 3.47) and `Turnstile`'s
  fallback message.
- **`Input`, `Textarea` and `Select` drew their focus ring with bare `focus:`,** which fires on
  mouse clicks too — the exact thing `forge-ui-interaction-focus-visible` forbids. All three now use
  `focus-visible:`. `ring-ring/20` is kept: with a solid `--ring` behind it, it finally delivers the
  20% halo the class always claimed, and compliance rests on `border-ring` rather than on the halo.
- **`Navbar` carried a dead `border-border` class** with no border-width utility beside it, so it had
  never painted anything. Removed.

- **`Alert`, `Toast` and `Badge` status variants now adapt to dark mode.** Previously a `bg-red-50`
  alert stayed a near-white rectangle on a `--palette-900` page. Nothing was illegible, but the
  surface hierarchy inverted — the status panel became the brightest thing on screen regardless of
  its importance, which is the opposite of what an `info` variant should do. Each variant now
  resolves through the `--status-*` family instead of a fixed palette utility, and the family carries
  the dark half at the `-950` surface with `-200` text (`Badge` reads the `-strong` tier, which
  starts one stop in at `-900`/`-200`). The **hue** stays fixed on purpose: a status colour has to
  stay red, blue,
  emerald or yellow whatever the app points `--destructive` at, and there is no blue, emerald or
  yellow token to reach for. Only the lightness moves. `SUCCESS_CLASSES` / `ERROR_CLASSES` in
  `@y-core/forge/http` move with them — they render on the same page in the same flow, and scoping
  the change to `ui/core` would have put an adaptive `Alert` beside a stark white banner.

  Measured in dark: text on surface is 11.14 (red), 10.35 (blue), 11.82 (emerald), 12.52 (yellow).
  No neutral ramp participates — both stops of every pair come from the status hue itself — so each
  is a single exact value rather than a worst case.

  **These pairs are gated, which the first draft of this entry said they could never be.** That
  conclusion was read off the wrong constraint: `TOKEN_CONTRACT` audits custom properties, and
  whether a colour is a custom property is a choice about the component rather than a fact about the
  gate. Once the variants resolved through `--status-*` they came inside a boundary that never moved,
  and eight `TOKEN_CONTRACT` foreground rows plus four `ACCEPTED` border rows are them. What is
  genuinely still outside stays outside: forge has no Tailwind dependency, so no gate, unit test or
  browser spec here compiles CSS, and no check proves a utility name generates a rule. The header of
  `scripts/contrast-parse.ts` records where that line now runs.

- **The rail's documented sticky behaviour was inert — it had zero travel.** `max-h-dvh` and
  `overflow-y-auto` only bite once the `<details>` has a height to cap, and a percentage height
  resolves to `auto` the moment one ancestor is `auto` — so the whole chain collapsed and the rail
  scrolled away with the page. In rail mode the scope root and the `<nav>` landmark now both carry
  `h-full`, which is the two links forge owns; the consumer owns exactly one, a definite height on
  the box the scope root is laid out in, and a stretched flex item in a `flex` row is one. The rail's
  toggle also goes `sticky top-0` with `bg-background/95`, so it stays reachable while a long rail
  scrolls its own overflow, and sits at the leading edge while collapsed (`justify-start`) and at the
  trailing edge once open (`group-open:justify-end`). Rail-scoped: `collapsible="mobile"` has nothing
  to cap and its markup is unchanged.
- **A `Dialog`'s content sat flush against its own edge, and the dialog could sit flush against the
  viewport's.** The root carried `p-0` with nothing put back, so every caller re-invented a gutter.
  It now draws only the surface, and the new `Dialog.Header` / `.Body` / `.Footer` carry the padding.
  The viewport gutter changes with it: the sheet's `max-width` / `max-height` pair becomes
  `inset: 1rem; margin: auto`, because a caller's own width — `max-w-sm`, or any later-layer rule —
  replaces a `max-*` default outright and takes the gutter with it, whereas `inset` is a different
  property and survives. Measured in a browser spec rather than asserted on markup, which cannot see
  a box.
- **`Slider`'s box breached `forge-ui-hit-target`, and its thumb failed 1.4.11 in dark mode.** The
  input was `h-2` — 8px, against a floor of the `Button` `sm` box — because it was sized to the track
  it painted. It no longer paints: the input is a transparent hit target at least 32px across in both
  orientations, and the 8px track and 16px thumb are authored `::-webkit-slider-runnable-track` /
  `::-moz-range-track` and thumb rules in `theme-base.css`, written in **logical** properties so one
  declaration serves both orientations. Sizing the input to the track is what made the two disagree —
  a horizontal `h-2` left the thumb no box while a vertical `w-5` did. The thumb gains a
  `box-shadow: 0 0 0 2px var(--background)` halo, which is forced rather than decorative: `--primary`
  on `--track` measures 3.64:1 in light but **2.06:1** in dark against a 3:1 floor, while the
  `--background` ring around it measures 4.34:1 and 6.74:1 — the same pair `Switch`'s thumb is
  already read against. Widening the fill instead would mean moving a ramp stop and repainting every
  surface that shares it.
- **`ToggleGroup.Item` had no focus indicator** — a live `forge-ui-focus-ring` breach in shipped
  code, and one a `design-allow` comment sat beside without covering. Its old base string declared no
  `focus-visible:` anything, so the only keyboard affordance was the UA outline on a button that
  styled everything else. Resolving the item through `buttonVariants` gives it the one button base's
  ring, and the `design-allow` suppression is removed rather than re-justified.
- **`mountTurnstile` reported a failure it never attempted, on any page holding an element with
  `id="turnstile"`.** The loader tested `window.turnstile` for truthiness, but the DOM exposes every
  element with an `id` as a window property of that name — so a page with a `<section
id="turnstile">`, which is not an exotic page, answered a truthy `HTMLElement`. The loader took the
  "API already present" branch, found no `render` on an element, and revealed the fallback for a
  widget whose script had never been requested. It now asks the capability
  (`typeof win.turnstile?.render === "function"`) at all three sites, through one `hasApi` predicate.
- **`inlineValidation()` defaulted `sync` to `"closest form:abort"`, which broke every field outside
  a `<form>`.** htmx resolves the selector at request time and passes the result straight to
  `getInternalData` with no null check, so a field with no enclosing form threw
  `TypeError: Cannot read properties of null` inside htmx's own trigger handler — the trigger fired,
  no request was issued, no `htmx:*` error event was raised, and nothing reached the console. The
  caller just saw a control that did nothing. The default is now `"this:abort"`, which resolves on
  any element. **Silent behaviour change, and the one thing in this release that is neither a token,
  a rendering change, nor a compile error:** a caller inside a `<form>` that relied on the old
  default for cross-field aborting now passes `sync: "closest form:abort"` explicitly.
- **The showcase's inline-validation demo sent no field value.** The `inlineValidation()` spread sat
  on a wrapper `<div>` outside the fragment. htmx sends the _triggering element's_ own value on a
  GET, so the request carried no `email` at all — and a spread outside the swap target survives the
  first swap and is then gone from the markup that came back. It now sits on the `<Input>` inside
  `ValidateFragment`. This is the surface the `sync` default above was found on: the standalone field
  has no enclosing form, so the old default threw inside htmx with nothing logged. The error state
  gains the `Icon` that `forge-ui-form-invalid-triple` requires, and the success line moves from a
  raw `text-emerald-600` to `text-success`.
- **The showcase's Turnstile demo rendered an empty box.** The controller resolves the enclosing
  `<form>` and gates Cloudflare's script on the first `focusin` within it, so a bare widget with no
  form and no focusable field could never load the script. The demo is now a real form — `Honeypot`,
  an email field, the widget, a submit — with an eager `show-turnstile` scope registered, because the
  form carries no `data-on-*` action and a lazy scope would never resume.
- **The browser harness never loaded htmx, so every `hx-*` attribute was inert under test.** htmx
  boots once off `DOMContentLoaded` and the harness injects its bundle after the document has
  finished loading. The showcase spec now exposes `forgeHtmx` and calls `htmx.process` after setting
  content, which is what let the inline-validation defect above be reproduced rather than reasoned
  about.
- **A context menu opened from `contextmenu` was light-dismissed by the platform on its own
  right-click** — it flashed and vanished. `contextmenu` fires _between_ `pointerdown` and
  `pointerup`, and the dismiss pass on that trailing release compares the popover ancestor of the
  pointerdown target with the ancestor of the pointerup target. Neither is inside a popup: nothing was
  open when the button went down, and the pointer is over the surface rather than over the panel that
  has just appeared beside it — the panel's rounded corner means even the point itself is outside the
  box. The two agree, so everything is hidden one event after it was shown. `openPopoverAt` gains
  `afterPointerUp` (default `false`), which defers the show to a one-shot **capture-phase**
  `pointerup` on the owner document: the dismiss pass runs ahead of listeners for the same event, so
  showing there is still inside that one event and before any paint, and the pass finds nothing to
  dismiss. Callers pass `event.buttons !== 0` rather than a flat `true` — a keyboard-raised
  `contextmenu` (the Menu key, `Shift+F10`) reports no buttons and is followed by no release, so an
  unconditional guard would arm a listener that the _next_ unrelated click fires. `once`, so a later
  click still light-dismisses the menu exactly as it always did.

  **No existing test caught it because the fixture had no stylesheet.** `showcase.browser.ts` mounted
  the context-menu demo without `theme-base.css`, so the coordinate rule never applied, the popup fell
  back to the UA's centred `[popover]` box — which lands _under_ the pointer — and the release hit the
  panel, making the dismiss pass decline to match. That mount now loads the theme, and three cases in
  `src/ui/core/menu-anchor.browser.ts` ("a context menu against the platform's light-dismiss pass")
  cover the guarded open, the unguarded control, and that a later click still dismisses.

- **The showcase's closed rail column stretched to the full page height,** leaving a border running
  the length of the page beside a collapsed hamburger. The column is a flex item in a `min-h-dvh`
  row, and the closed-state override only narrowed it (`w-14`), so it still stretched and still drew
  its right rule. The closed state now takes `w-auto` — the width is the toggle's own box rather than
  a second fixed track — plus `self-start` to stop the stretch and `border-r-0` to drop the rule that
  would otherwise hang beside it. The open state is unchanged.
- **A rejected `channel.read` no longer escapes the log viewer to the error boundary.** For a fragment
  request that boundary answers with a _page_, and HTMX swapped that page's body into the log table.
  The failure is now caught and rendered in place as a `destructive` `Alert` with a retry, the table's
  own shape preserved around it. On the append path the cursor the read never consumed is kept, so the
  load-more control stays and becomes its own retry — reporting the stream complete there would have
  deleted the control on a transient failure, the one outcome the reader has no way back from. The
  reason is deliberately not shown: a channel error can name a binding or a key prefix, and
  `STRUCTURED_LOGGING.md`'s no-PII rule governs a log surface.
- **Neither of the log viewer's HTMX swaps drops keyboard focus.** Both controls sat inside their own
  swap target, so every expand and every "load more" sent focus to `<body>` and a screen reader lost
  its place. The message trigger now targets a sibling detail `<tr>` shipped with the initial render
  — which is also the placeholder that stops the region jumping — and carries `aria-expanded` /
  `aria-controls`; the load-more control sits outside `#log-tbody` in the table's `<tfoot>` and is
  replaced out of band at a stable id with exactly one writer. It is a `<tr>` rather than a footer
  `<div>` for a mechanical reason: HTMX picks a fragment wrapper from the response's first tag, so a
  `<div>` sibling of `<tr>`s is hoisted out by the HTML parser and the out-of-band swap never arrives.
- **The log viewer's message trigger has a focus ring and a real hit target.** It was a raw
  `<button class='cursor-pointer text-left hover:underline'>` — `forge-ui-focus-ring` and
  `forge-ui-hit-target`, two Floor failures on one element.
- **Two browser specs were racing their own subjects** and failed under load. Both waited on a value
  that is already correct _before_ the event they actually depend on. `showcase.browser.ts`'s
  post-swap revalidation case counted requests, which the interceptor records when the request reaches
  the route handler — before the response is fulfilled and long before htmx has swapped — so the
  second `fill` could land on an input about to be replaced, taking its pending `change` with it.
  `viewport-collapse.browser.ts`'s user-override case waited on `<details>.open`, which moves
  synchronously, while `mountViewportCollapse` tells its own writes from the user's by counting
  `toggle` events — and the HTML spec _coalesces_ a pending toggle task, so a click landing before the
  controller's event was dispatched produced one event where the controller expected two, and the
  override never registered. Both now wait on the thing they depend on. No product code changed.

### Added

- **A theme customiser, at `showcaseRoutes().ui.theme` (`/showcase/ui/theme`).** Generates a
  complete forge colour scheme from hue and chroma, previews each generated scale against a single
  shared header of step numbers and on a real composed UI, reports live WCAG ratios beside it, and
  emits a paste-ready scheme file.

  Five dials — accent hue, accent chroma, gray hue, gray tint, corner radius — laid out a family to
  a row, since hue and chroma are one family's two free parameters and lightness is not among them.
  Every control id is derived through `fieldId`, so no `for=`/`id=` pair on the page agrees by
  coincidence.

  **The query string is the whole of the page's state.** No `localStorage`, no FOUC script; a scheme
  is a shareable link, and each parameter is clamped and snapped to its own dial's range so a
  hand-edited URL cannot render a scheme the sliders could not have produced. Gray chroma defaults
  to `0`, which makes the generated scale achromatic — so a bare URL renders `theme-neutral.css`
  exactly, and the shipped default is a point in the space rather than a special case outside it.

  **The preview shows two rows, not four.** An earlier draft drew every scale/surface combination,
  including a light scale on a dark surface. That was wrong rather than merely redundant: forge's
  `.dark` class swaps the scale **and** the surface together, so a light step never lands on a dark
  page, and the crossed rows invited a judgement about a state the cascade cannot produce. The two
  that remain share one header of step numbers 1…12, which is what lets a step be compared down the
  column — and is why the preview is a `table-fixed` table rather than a grid: a header grid above
  padded row boxes drifts by exactly that padding.

  Each scale sits in a rounded, bordered box painted with **that scale's own page colour**, so the
  container is the label and no caption says "dark scale, dark surface" over a visibly dark box.

  The box is drawn by the cells on its edge rather than by the `<tbody>`, because **no arrangement
  lets a row group be both bordered and rounded**: `border-radius` is defined not to apply to table
  elements in the collapsing border model, and in the separated model a row group may not carry a
  border at all. A `<td>` can do both, so the four corner cells carry one radius each and the edge
  cells carry the sides. Verified at the pixel level rather than through computed style, which
  reports a radius on a `<tbody>` that the browser never paints.

- **A finding about the token layer, worth recording because it looks like it should work.** A
  nested `.dark` does **not** flip forge's semantic tokens. `--background: var(--gray-1)` is declared
  once on `:root`, so it _computes there_ — to a literal — and inherits as that literal; a descendant
  carrying `.dark` re-declares `--gray-1` and never reaches the token above it. `.dark` works on
  `<html>` because both declarations compute on the same element, in order.

  Nothing shipped depended on this, and the customiser's preview briefly did: it carried a `dark`
  class on a row that quietly painted nothing. The row is painted from the generated scale instead,
  which is the better answer anyway — the box demonstrates the scale **using the scale**, drawing its
  page from step 1, its muted text from step 11 and its chip edges from step 6, which are the three
  steps `--background`, `--muted-foreground` and `--border` resolve through. A browser case asserts
  the computed colours, so a future attempt to express a nested dark surface with a class fails
  rather than looking right in the markup.

  **Colour is not server-rendered, and that is a CSP consequence rather than an oversight.** Forge
  ships `style-src 'self'` with no `'unsafe-inline'` and no style nonce, and `render-to-string.ts`
  drops `style` attributes for exactly that reason — so neither an inline `<style>` block nor a
  `style=` attribute can carry a generated colour to the browser. Every hex is server-rendered **as
  text**, so the page reads correctly with no JavaScript at all; the paint is done by an eager
  `customise` scope through CSSOM, which CSP does not police, and this one route accepts a single
  frame of the default scheme before it resumes. The alternative was relaxing the CSP library-wide
  for one demo page.

- **`ui/contracts/color.ts` — the scale generator, and a knowing duplication that pays for itself.**
  `oklchToHex` / `hexToOklch` / `relativeLuminance` / `contrastRatio`, plus `buildScale` and
  `buildAlphaScale`. `GRAY_RAMP` is `theme-neutral.css` measured step for step, and at chroma 0 the
  generator reproduces that file **byte for byte, all twenty-four steps, both modes**.

  `src/assets/build/color.ts` already implements the same OKLab transform and the same CSS Color 4
  gamut mapping, and duplicating a capability is against a standing rule. It is duplicated anyway,
  because the namespace graph leaves no shared home: `assets/build` has only a type-only edge to
  `assets`, and `ui/contracts` is the one namespace both `ui/client` and `ui/show` may see. The
  mitigation is that `color.test.ts` imports **both** modules and asserts they agree across a grid
  of the oklch space — tests are excluded from the namespace-graph parse, so the test crosses the
  boundary the source cannot, and drift becomes a red gate rather than a divergence nobody watches.
  Both files carry a header naming the other.

  `ACCENT_RAMP` is a **separate** lightness ramp. Not a refinement: step
  9 — the solid a brand colour is actually seen as — sits at lightness 0.5438 against the gray
  ramp's 0.6434, and a saturated hue held up at gray-9's lightness reads washed out. Asserted, so
  the two ramps cannot quietly be collapsed into one.

- **`ui/contracts/contrast-pairs.ts` — the audited pairs, extracted so the gate and the customiser
  cannot disagree about what is being measured.** `scripts/contrast-parse.ts` keeps the pinned
  values and measured ratios, which describe the scheme currently on disk; the pair definitions —
  which token, which step, what it is read against, which criterion binds it — moved to `src/`,
  because those hold for any scheme. Behaviour-neutral: `validate-contrast`'s output is
  byte-identical.

  Each side of a pair is classified `scale` or `fixed`, which turns a limitation into a result:
  eleven of the fifteen have a side on a Tailwind stop forge does not depend on, so nothing here can
  resolve them — and nothing the customiser offers can move them either. The four that remain are
  the exact scope of what the dials touch, and the customiser shows the other eleven greyed rather
  than hiding them.

- **A 12-step role scale, and it is now the bottom layer rather than the middle one.** The step
  numbering is adopted verbatim rather than invented — 1 app background, 2 subtle
  background, 3 UI element background, 4 hovered, 5 active/selected, 6 subtle borders, 7 UI element
  border and focus rings, 8 hovered border, 9 solid backgrounds, 10 hovered solid, 11 low-contrast
  text, 12 high-contrast text. Three namespaces: `--gray-*` for the neutral scale, `--accent-12`,
  and the fixed status hues `--red-*`, `--blue-*`, `--emerald-*`, `--green-9` and `--yellow-*` — plus
  the functional `--<hue>-contrast` for the foreground that sits on step 9.

  **All twelve gray steps are declared, even the ones forge does not consume.** A scale is a
  complete artifact: a consumer re-declaring it has to be told what the contract is, and a gap in the
  middle of a ramp is an anomaly rather than a saving. The status hues keep the opposite rule and
  declare only the steps forge reaches for — 2, 3, 6, 11 and 12 behind the `--status-*` family, 9 and
  `-contrast` behind `--destructive` / `--success` / `--warning` — because a status ramp with no
  consumer is `theme-mist.css`'s failure exactly.

- **`src/ui/design/` — the UI design corpus, and a new `./ui/design/*.md` export subpath.** New
  public surface: the eighteen rule files an agent or a person reads before composing a forge
  surface — `floor.md` (invariants, non-overridable), `catalog.md` (job → primitive), `tells.md`,
  `preflight.md`, and fourteen routed `reference/` files from `01-hierarchy.md` to `14-review.md` —
  entered through `index.md`, with `SKILL.md` as the Claude Code wrapper around the same corpus. It
  is judgement, not API reference; props and signatures stay in `src/ui/README.md`, and every rule
  carries a stable `forge-ui-` id so it can be cited. Consumers reach a file as
  `@y-core/forge/ui/design/floor.md`. `.decisions/UI_DESIGN_GUIDANCE.md` governs the corpus's own
  shape and is registered in the Guide Index; `cc-plan`, `cc-dev`, `cc-test` and `cc-doc` route
  through it for UI work.
- **`validate-design` — a new gate step**, and the corpus's anti-drift contract: every subpath the
  corpus cites resolves through the exports map, every symbol it imports is exported by that barrel,
  every CSS custom property it names is declared, and every rule id is well formed, unique, and
  defined where it is cited. Prose that goes stale against the code fails the gate rather than
  quietly misleading its next reader.
- **`validate-contrast` — a new gate step**, between `validate-design` and `validate-css-sources`.
  It pins the mapping every recorded ratio was measured against — both hops of it — and fails when a
  value moves until the measurement is re-derived. It deliberately builds **no** colour-resolution
  machinery: every colour forge resolves is now either a literal in a scheme file or a Tailwind
  stop it names, so nothing upstream can move a ratio without this repository changing, which makes
  pinning the mapping the complete check with no colour arithmetic at run time. What it does _not_
  do is re-measure; the
  manual procedure for that is written beside `TOKEN_CONTRACT` in `scripts/contrast-parse.ts`. It
  also reports any theme file that overrides an audited token, which is how zinc's `--warning`
  divergence stays visible.
- **`Dialog.Header`, `Dialog.Body` and `Dialog.Footer`.** The root draws only the surface; these
  three carry the gutter, so content never sits flush against the dialog's edge. `Header` is a
  `grid-cols-[1fr_auto]` row closed by a `border-b` — title on the left, a close control on the
  right — `Body` is the padded middle, and `Footer` is a `flex` action row opened by a `border-t`.
  Each is a plain `div` with a `data-slot`, so a caller composes them or ignores them.
- **`Resumable` takes a `class`, emitted on the scope root.** The scope root is a real box in its
  parent's layout — in a flex row it _is_ the flex item — so width, `shrink` and border belong there
  rather than on a component nested two boxes further in. This is what makes the rail's layout
  expressible at all; see the Breaking entry and `forge-ui-nav-rail-flex-item`.
- **The composition band moved off the showcase catalog and onto the theme customiser.** The catalog
  proves each component exists; a generated scheme has to be judged against a _composed_ UI, and the
  customiser is the one page where that judgement is the point rather than a side effect. The
  `compositions` row left `SECTIONS` with it — the rail and the catalog are both derived from that
  list, so leaving the row would have published a navigation link to an element no longer on the
  page. Its browser cases moved too, re-anchored to the neighbours the band actually has now.

### Documentation

- **`forge-ui-color-scale-adjacent-stops` now states the affordance-versus-decoration
  distinction** that its old carve-out was missing, and says plainly that the earlier wording is what
  let the defect through. The rule **id is unchanged** — `UI_DESIGN_GUIDANCE.md` §3b forbids renaming
  an id when only the sentence changes, because every citation of it would break.
- **`04-color.md`'s token table splits `--border` / `--input` / `--ring` into three rows,** which is
  precisely the conflation this release undoes. The `.dark` re-mapping table gains `--border`,
  `--input` and `--ring` rows and carries the corrected `--muted-foreground` stops, and
  `forge-ui-color-theme-muted-pair` no longer quotes the old mapping as live fact.
- **`09-interaction.md` records why `--ring` is a solid stop** rather than a tint: a focus indicator
  has a 3:1 floor of its own under 1.4.11, and an alpha value composites against whatever is behind
  it, so it cannot be expressed as one.
- **`AGENT_GUIDE.md` §8** registers `scripts/validate-contrast.ts` + `scripts/contrast-parse.ts` as
  the home of token contrast mappings and their measured ratios.
- **A new Floor rule — `forge-ui-affordance-replacement`, "replace every affordance you suppress"**
  — in `src/ui/design/floor.md`, with `preflight.md` item 21 as its check (Block 1 is now
  twenty-one items and Block 2 renumbers to 22–66). It generalises what `forge-ui-focus-ring`
  already said about `outline-none` to every suppression utility forge writes: `appearance-none` on
  a range input and on a `<select>`, `list-none` on a `<summary>` and on a list, `p-0`, `border-0`.
  Each names what forge draws back. `forge-ui-focus-ring` keeps its own id and now reads as this
  rule's `outline-none` case, which is `UI_DESIGN_GUIDANCE.md` §3b applied literally: the half that
  inherits the original meaning keeps the original id, and the generalisation mints a new one.
  Two of the defects in this release are the new rule's own clauses: `Slider`'s deleted track and
  `Collapsible.Trigger`'s deleted disclosure marker.
- **Three new Defaults in `reference/08-navigation.md`** covering the rail's layout, each with a
  wrong/right pair: `forge-ui-nav-rail-flex-item` (width and `shrink-0` go on the `Resumable` scope
  root, which is the box the flex row lays out), `forge-ui-nav-rail-persists` (a vertical rail pins
  to the viewport and scrolls its own overflow, which needs a definite height on the scope root's
  parent — forge supplies the two links above the `<details>`), and
  `forge-ui-nav-rail-collapsed-width` (collapsed the rail is one button wide, `w-14` / 56px, with
  the toggle leading; state it as an **override over a wide base** so a browser without `:has()`
  degrades to the full column rather than pinning a strip that clips the open panel).
- **`src/ui/README.md`'s rail example is rewritten around the box the parent lays out** — the
  `Resumable` wrapper, the collapsed-width override, and the `min-h-dvh` flex row that supplies the
  height link forge cannot — and it cites the three rules above. Its component table also corrects
  `Collapsible`'s compounds, which read `Collapsible.Content` for a component that has only ever
  exported `Collapsible.Panel`, and records `Resumable`'s new `class`.

---

## [0.0.82] — 2026-08-10

**Every component's `class` prop advertised an override it could not perform.** `cn` was
`classes.filter(Boolean).join(" ")` — it concatenated. So `cn("h-full", cls)` with a caller passing
`h-5` emitted `"h-full h-5"`, two utilities in the same conflict group, and which one won was
decided by their order in the generated stylesheet rather than by the caller. The prop was real, the
merge was not, and the failure is silent in exactly the way that survives review: the class _is_
present in the output, so an assertion that greps for it passes.

`cn` now resolves conflicts, and `cva` composes base → variants → `class` through it, so the later
part genuinely displaces the earlier one on any utility they both set.

**Separately, the component contracts turned out to be upheld by coincidence rather than by
anything.** `src/ui/README.md` commits every `ui/core` root to five of them — arbitrary `data-*` /
`aria-*` reach the element, a caller's `class` wins, `style` is dropped, a `data-slot` token is
emitted and an inherited one composes, and a caller's explicit state attribute beats the computed
one. Nothing checked any of it. The last held only as an accident of where each component happened
to put `{...stateAttrs(…)}` relative to `{...props}`: correct everywhere, pinned nowhere, and a
spread reordered during unrelated work would have flipped it silently.

`conformance.test.tsx` now holds every root to all five, and **derives its participant list from the
barrel** — so adding a component to `mod.ts` fails the suite until it declares how it participates,
including declaring that it does not. The sweep found one live gap (`Avatar`, below); the value of
the rest is that they stop being coincidences.

### Fixed

- **A vertical `Separator` rendered invisible in its commonest host.** It sized itself with
  `h-full`, which resolves against an ancestor with a definite height; a `flex items-center` row —
  the usual place a vertical divider goes — is auto-height, so the rule computed to zero. It now
  uses `self-stretch` and takes its height from the flex line.
- **`Slider`'s readout could disagree with its own thumb.** The thumb is positioned by the browser
  from the value it settles on after HTML's sanitization algorithm, while the readout was a string
  forge wrote on the Worker from the raw prop — and `Slider` ships no client controller, so nothing
  reconciled them afterwards. An out-of-range or unsnapped `value` therefore rendered a number the
  thumb was not pointing at. `sanitizeRangeValue` now applies the same algorithm the browser does —
  validity check with the midpoint default, clamp, then snap from the step base — reading the
  _serialized attributes_ rather than the props, so it parses byte-for-byte what the browser parses.
- **`Field` derived ids from values that cannot be ids.** HTML forbids ASCII whitespace in an `id`
  and splits every IDREF list on it, so a `name` containing a space produced an `id` no IDREF could
  name and an `aria-describedby` that silently pointed at nothing. Every derivation now routes
  through one predicate: a blank `scope` is no scope, and a `name` or `scope` that is not a single
  id token derives no id and no `aria-describedby` at all. The `name` attribute is still passed
  through as given. The whitespace set is HTML's ASCII one rather than JS `\s`, because U+00A0 and
  the Unicode spaces are legal id characters that no parser treats as separators.
- **`Avatar` accepted no native props.** `Avatar` and `Avatar.Fallback` declared closed prop types
  and hard-coded their `data-slot`, so neither forwarded attributes nor composed an inherited slot
  token. Both now extend the intrinsic `span` props and go through `slotToken`.
- **`Form` emitted `class=""`** when a caller passed no class.

### Added

- **`src/ui/core/utils/class-groups.ts`** — the Tailwind conflict-group table `cn` decides on,
  mapping a utility to the CSS concern it sets. Three properties are worth knowing before relying on
  it:
  - **It is deliberately not a complete map of Tailwind.** It covers the families forge's own
    primitives emit plus those a consumer override plausibly targets.
  - **It fails open.** An unrecognised utility is always kept, which inverts `ERROR_HANDLING.md`'s
    fail-closed posture on purpose — the gap here is incomplete knowledge of a third-party
    vocabulary, not untrusted input, and failing closed would silently delete a consumer's custom
    class or a utility from a newer Tailwind, with no error and no fix available from outside forge.
    The worst case of failing open is the behaviour that existed before conflict resolution did.
  - **Closed value spaces get exact whole-utility entries; only open ones get prefix matching.** A
    `select-` prefix entry would let a consumer's `select-wrapper` claim the user-select group and
    delete a real `select-none`.
- **`conformance.test.tsx`** — the shared sweep over `ui/core` described above. Roots only, and that
  is a decision rather than an omission: covering compound members means roughly eighty hand-written
  fixture rows guarding a table whose whole worth is that every row is identical, and the trade
  inverts at the root level where the fixture cost is ten entries and the failure it catches is a
  whole component wired up without the contracts. Compound members keep their exact-HTML pins in
  their own co-located files.
- **`.types/import-meta.d.ts`** — declares `import.meta.main` by interface merging, because
  `lib.dom.d.ts` gives `ImportMeta` only `url` and `resolve` and `"types": []` keeps any runtime's
  own declarations out.

### Changed

- **Five gate scripts became importable.** `validate-exports`, `validate-docs`, `validate-jsx`,
  `validate-namespace-graph` and `validate-css-sources` now `export function main()` returning an
  exit code, guarded by `if (import.meta.main) process.exit(main())`, rather than calling
  `process.exit` inline. A test can import a validator and read its verdict without the runner
  dying — which is what the new `validate-*.test.ts` files rest on, and what the checks added in
  0.0.83 were written against.
- **Test coverage across `ui/core` roughly tripled**, adding co-located suites for `Collapsible`,
  `Meter`, `NumberField`, `ScrollArea`, `Tabs`, `Toggle`, `cn`, `class-groups` and `cva`, plus a new
  `separator.browser.ts` covering the vertical-height fix in a real engine.

### Documentation

- **`UI_SSR_COMPONENTS.md` gains §3d, "Conflict Resolution and the Fail-Open Boundary"** — what the
  resolver decides, the two things that scope a conflict beyond the concern itself (a utility's
  modifier prefix and its importance marker), and where the table stops.
- `AGENT_GUIDE.md` registers `class-groups.ts` as the source of truth for the conflict-group table;
  `NAMESPACE_DESIGN.md`, `TESTING.md`, `ERROR_HANDLING.md`, `CLAUDE.md`, the root `README.md` and
  `src/ui/README.md` were updated alongside.

---

## [0.0.81] — 2026-08-09

**Anchored placement worked for tooltips and for nothing else.** The block in `theme-base.css` that
positioned `popover-content` and `toolbar-flyout` rested on a stated premise — _"a popover's implicit
anchor is the button named by `commandfor`"_ — that is false. The implicit anchor comes from
`popovertarget`; the Invoker Commands API sets none, and `popovertarget` appears nowhere in forge
outside `src/jsx/types.ts`. **Every `anchor()` in that block resolved to nothing** and the UA's
`[popover]` default centred the panel. `menu-popup` was never in the block at all.

Measured on Chrome 151 rather than reasoned about: an invoker-opened popup computes `position-anchor:
normal` with `CSS.supports("top", "anchor(bottom)")` true. Two things let it survive review — no
browser spec loaded any CSS, and none asserted geometry, so the suite structurally could not see this
class of defect. Both are now fixed.

**Separately, `defineAction` stopped taking a validation step it could not check.** Its `parse` and
`validate` callbacks fixed the _order_ two arbitrary functions ran in and nothing more — neither was
required to involve a schema, so `validate: (d) => ok(d)` compiled and was accepted, and a route
could declare a validation step that validated nothing. It now names a schema, and `handle` is
unreachable except through a passing `v.safeParse`. Forge reads the body itself, which is what let
the named-field readers go: they collapsed an absent field into `""` before any schema could observe
it. See **Breaking Changes**.

**The release also carries a follow-up review of the full source tree after 0.0.80,** written and
held back rather than shipped on its own. Four verified defects — plus a fifth found
while fixing the third — and every one of them is the same shape: work that was _started_ and then
left outside the thing that keeps it alive. A purge outside the promise the isolate waits on. A
rejected import with no handler on it. Timers outliving their disposer. A promise that resolved on
an appended `<link>` rather than a loaded one. Each landed with tests that fail against the previous
code; where a test could not have observed the defect, the reason is given, because that is usually
the more useful half.

### Added

- **`strictObject(entries, message?)`** (`validation`) — the strict object schema to use for anything
  parsing untrusted input. Only a field the schema _actually declares_ counts as declared, so an
  undeclared key is refused rather than silently dropped for **every** name a caller can send —
  `__proto__`, `constructor`, `toString`, `valueOf` and the rest of the inherited set included, with
  no branch naming any of them. The correction is applied at construction, so it survives `v.pipe`,
  `v.union`, `v.variant` and arbitrary nesting; a patch to a finished schema would not. Migrate
  `v.strictObject(` → `strictObject(`. Raw `v.strictObject` keeps the old behaviour — this is opt-in,
  and visible at the call site.
- **`formText()` and `formMultilineText()`** (`validation`) — the default shapes for form text: trim,
  and CRLF→LF then trim. What the fold buys is a length that means one thing, and it is the fold's
  **presence** that buys it: under `v.pipe(formMultilineText(), v.maxLength(500))` each line break
  counts once, so a 500-character limit means the same whether the newline arrived as LF or CRLF,
  instead of silently halving the budget for line breaks. Its position relative to the trim is _not_
  observable — `trim` treats `\r` and `\n` alike, so the two orderings agree on output — and
  `src/validation/form-text.ts` records that rather than arguing for one. `formText()` deliberately
  **preserves** CRLF — that is what makes it the `<input>` variant.
- **`describeValidationIssue(issue)`** (`validation`) — names the field one issue is about and
  nothing else, bounded in path depth and in per-segment length. It reproduces no part of the
  submission (`issue.message`, `issue.input`) and no part of the schema (`issue.expected`), so a
  refusal varies only with _which_ field failed. Use it for anything a caller reads;
  `formatValidationIssues` stays the internal `Invalid environment: …` diagnostic.
- **`formToObject(formData, options?)`** (`form`) — the whole-body read `defineAction` uses, now
  public for handlers outside that pipeline. Every entry passes through: absence stays absence, a
  repeated key becomes an array (not last-wins, as `Object.fromEntries` would), a `File` survives.
  `options.drop` is how a field a guard already consumed leaves before a strict schema sees it.
- **`csrfFieldCtx`** (`form`) — the form field `csrfProtection` took this request's token from,
  published above every early return in the guard. Read it with `.getOptional`: absence is
  meaningful, not an error, and says no guard ran on this request.
- **`TURNSTILE_FIELD_DEFAULT`** (`form`) — the field Cloudflare's widget writes its token into.
  `src/form/turnstile.ts` inlined that literal; it now reads the constant, so `src/form/constants.ts`
  owns all three injected field names.
- **`honeypot`, `turnstile`, `onBotDetected` on `ActionDefinition`, plus the `ActionTurnstileOptions`
  and `BotRejection` types** (`app`) — see **Breaking Changes**. `onBotDetected` receives
  `{ guard: "honeypot" }` or `{ guard: "turnstile"; reason }`, so an app can tell a siteverify outage
  from an attack while the caller-visible refusal stays identical either way.
- **`mountAnchorBinding(popup)`** (`ui/client`) — binds a popup to its invoker on `beforetoggle`,
  through CSSOM. For the popup whose trigger is known only at runtime, as `openPopoverAt` is for the
  popup with no trigger at all. `mountMenu` mounts it on **nested** popups only; every other surface
  is already correct with no JavaScript.
- **`mountMenu` handles ArrowRight and ArrowLeft, and which one opens depends on direction.** Under
  LTR, ArrowRight opens the focused submenu (through the row's own `command`, not around it) and
  ArrowLeft closes a nested panel and restores focus to its row; under RTL the two swap. The
  direction is read from the popup itself with `isRtl`, not from a global, so an RTL subtree inside an
  LTR page mirrors correctly and a runtime `dir` flip is picked up on the next press — and the read
  sits behind the key test, since `getComputedStyle` forces a style recalculation and no other key can
  consume the answer. Both keys bail on `defaultPrevented` and claim the key they consume, so a
  submenu and its parent never act on one press.
- **`isRtl(el)`** (`ui/client`) — whether an element resolves to right-to-left writing direction,
  read from the element's own computed style. Not from a global and not from the `dir` attribute: a
  single RTL subtree inside an LTR page must behave as RTL, `dir` is usually set on an ancestor, and
  CSS `direction` can set it with no attribute at all. `getComputedStyle` forces a style
  recalculation, so it is documented as a call-it-where-you-consume-it read rather than one to cache
  at mount — a cached answer goes stale the moment `dir` flips at runtime. `mountMenu` is the first
  consumer.
- **`onChannelError` on `LoggerOptions` and `RequestLoggerOptions`** (`logging`) — called when a
  channel write fails, with the rejection reason or the thrown value. Both modes are covered and
  covered identically: each channel's `write` is wrapped in its own `try`, so one channel throwing
  synchronously still leaves the rest of the fan-out to run, and an async write gets a sibling
  `.catch` attached at dispatch — a sibling and never a chain, so `pending` keeps the original
  promise and `flush` still awaits the write itself. Observing at dispatch rather than in `flush` is
  what covers writes evicted by the pending cap, which `flush` never sees and which would otherwise
  fail with nobody watching. The default reporter writes one structured `console.error` line in the
  same shape `consoleChannel` uses, so a persistence outage is visible in `wrangler tail` with no
  configuration, and `console.error` keeps it distinguishable from the log stream it reports on. It
  never reaches the request path: a hook that itself throws is swallowed. Children inherit it, and
  `requestLogger` passes it through to the per-request logger.
- **`MountOptions.css`** in the browser-test harness, and `src/ui/core/menu-anchor.browser.ts`, the
  first spec in the set to assert real geometry against the real stylesheet. Placement matrices for
  `Tooltip` (12 side × align cells) and the chrome `Toolbar` flyout (4 placements) got their first
  coverage with it.
- **`lazy` accepts an `onError` callback.** Optional, and it rides on the already-exported
  `LazyImportOptions`, so no barrel change and no existing call site changes. See _Fixed_ for where
  the rejection was going before.

### Fixed

- **A throwing schema no longer escapes `defineAction` entirely.** `v.safeParse` sat outside the
  `try`, and valibot does not catch what a pipe action throws — so a `v.transform` or `v.check` that
  throws on malformed input propagated out of the returned handler with no status, no `onError`, and
  no log. Verified against the installed valibot rather than inferred: a `v.transform` wrapping
  `JSON.parse` throws a `SyntaxError` straight out of `v.safeParse`, and a throwing `v.check`
  predicate escapes identically. The `try` now covers validation as well as `handle`, so a throwing
  schema is logged and answered `500`. **`500`, not `400`, deliberately:** `v.transform` is
  documented as non-failing and `v.rawTransform`/`addIssue` is the primitive for a transform that can
  reject, so a throw there is a schema written with the wrong primitive — a route defect. A `400`
  would present it as a successful rejection of bad input, leaving a normal-looking refusal rate and
  a broken transform nobody ever sees. The widened `try` also absorbs a throwing
  `onValidationError`, which is intended and symmetric: an app must not be able to crash the Worker
  from the arm meant to render a refusal.
- **A schema field named `constructor` reads as absent when the caller did not send it.** The body
  object was built with `Object.fromEntries`, so valibot's per-entry presence test reached
  `Object.prototype` and a field named after any inherited member resolved to the **inherited
  function** instead of being seen as missing — `Invalid type: Expected string but received Function`
  where `Invalid key: Expected "constructor" but received undefined` was correct. `v.optional` on
  such a field was therefore unsatisfiable, and under `v.unknown()` the `Object` constructor itself
  would have reached `handle` as if it were user data. `constructor` is a real field name on
  construction and contracting forms. Entries now accumulate straight into an `Object.create(null)`
  bag, which also removes the intermediate `Map` and the second full pass `Object.fromEntries` cost
  per request. The matching _entries_-side half is `strictObject` (see **Added**) — the two are
  independent and neither fix implies the other. Neither is a prototype-pollution fix: assignment on
  a prototype-less object cannot reach an inherited setter, so a caller sending `__proto__` gets an
  own key rather than a mutated prototype, exactly as before.
- **A Turnstile-protected route on a strict schema no longer refuses every legitimate submission.**
  `cf-turnstile-response` was absent from the injected-field set, so a real user solving the
  challenge had their token reach `v.strictObject` as an undeclared key —
  `Invalid key: Expected never but received "cf-turnstile-response"`, on every submission. It was
  invisible twice over: the refusal was served as `200`, and it reproduced only against a live
  Cloudflare challenge, so no unit test and no local dev run could see it. Fixed by construction
  rather than by extending a list — the pipeline verifies the token and drops the field because it
  consumed it.
- **Trimming and CRLF normalization have a home again.** Deleting the named-field reader was correct
  on its own terms but took `value.replace(/\r\n/g, "\n").trim()` with it and relocated it nowhere,
  so `v.pipe(v.string(), v.minLength(1))` began accepting `"   "` — every required-field check
  bypassable with spaces — and un-normalized CR/LF flowed into whatever a route did next. The
  replacement is `formText()` / `formMultilineText()` (see **Added**), named as the default in the
  governing doc and used in every schema example. Normalizing inside the reader was considered and
  rejected: the reader also sees `File`s and arrays, `"   "` has to stay representable for a schema
  that wants to refuse it, a normalization the schema cannot see is the defect the old reader had,
  and line-ending folding is right for a `<textarea>` and wrong for an `<input>` — a distinction the
  reader cannot make.
- **Menus, popovers and toolbar flyouts anchor to their trigger** instead of centring in the
  viewport, via an explicit `anchor-name` / `anchor-scope` / `position-anchor` binding — the pattern
  the tooltip section already had right.
- **A submenu anchors to its parent panel, and to its own row once the client bundle loads.** Naming
  the _rows_ cannot work: an open popup is in the top layer, where the resolution algorithm returns
  "the last element in tree order", so every submenu but the last binds to the wrong row
  (csswg-drafts #11602, closed as intentional).
- **`cloneAsChild` appends to `data-slot` rather than overwriting it.**
  `<Tooltip.Trigger asChild><Menu.Trigger/></Tooltip.Trigger>` used to destroy `menu-trigger`
  outright, leaving a composed button that no menu rule matched.
- **A coordinate-placed menu is guarded structurally.** `Menu.Popup` emits `data-side` even with
  `coords` set, so the anchored selectors really did match a context menu; `:not([data-coords])`
  replaces the source-order tie-break that decided it before.
- **`mountNumberField` reads its direction from a token, not from the whole attribute.** The stepper
  branch compared `dataset.slot` for equality, so an increment button carrying a second `data-slot`
  token fell through to the `else` and **stepped down** — a silent wrong-way bug, reachable through
  the `{...rest}` spread `NumberField.Increment` already accepts.
- **`mountMenu`'s ArrowRight opens a submenu and never closes one.** The row's command is
  `toggle-popover`, so pressing it with the submenu already open used to invert the key, which ARIA's
  menu pattern does not permit.
- **`mountAnchorBinding` leaves no inline `anchor-name` behind on a trigger it has stopped using.**
  It holds exactly one trigger — the one currently carrying the inline name — and unwinds it both on
  the next open, before the incoming trigger gains its own, and again on dispose. Holding _every_
  past trigger was considered and rejected on retention grounds: a menu whose rows are rebuilt
  between openings resolves a different first invoker each time, and keeping each one would pin every
  discarded row alive for as long as the popup lives — exactly the retention the `WeakMap` in this
  module was chosen to avoid.
- **A failed stylesheet load leaves no `<link>` behind.** `loadStylesheet` evicted the failed entry
  from its cache but left the dead `<link>` in the head, so the retry the eviction exists to enable
  missed the cache, fell through to the duplicate check, found that link — and **resolved for a
  stylesheet that never loaded**. The removal is what makes the eviction mean anything. The test that
  claimed to cover this passed for the wrong reason: the block's fake `querySelector` returned `null`
  unconditionally, so the duplicate check, where the whole defect lives, was never reached.
- **`lazy`'s retry waits 500ms instead of firing immediately.** `observe()` re-fires on the next
  frame for an element already on screen, so all three attempts were spent inside a few frames —
  a "retry" that could only ever recover from an outage that had already ended. The cap stays; it
  guards a different thing (a visible element would otherwise spin), and the two bounds are not
  interchangeable.
- **A throw from `lazy`'s `init` is reported instead of becoming an unhandled rejection.**
  `load().then(onFulfilled, onRejected)` attaches the rejection handler as a _sibling_ of the
  fulfilment handler, not downstream of it, so application code throwing inside `init` rejected with
  nobody attached — the exact failure the `onError` path was added to close, reintroduced one branch
  over. It now goes to `onError` and stops there: the load succeeded, so a retry would only re-run
  the same failing `init`.
- **A Turnstile poll that times out reveals the fallback.** The give-up timeout on the
  already-present-script path cleared its interval and did nothing else, unlike the two other failure
  routes — so a pre-existing script that hangs left the user with neither a widget nor a message,
  against the widget's unconditional "fails visible" promise. This branch had no test at all.
- **A selected KV log purge was detached from the Worker lifetime.** `kvLogChannel.write()` started
  the sweep with `void purge(…).catch(() => {})` and returned only the `put` promise, so
  `Logger.flush()` and `requestLogger`'s `executionCtx.waitUntil()` both observed the write as
  complete while the purge was still listing and deleting. A Workers isolate may be suspended the
  moment the tracked work finishes — which is precisely the moment the sweep dies mid-pass, and
  precisely when the soft `maxLogs`/`highWater` cap stops being enforced. "Best-effort" was meant to
  describe _whether_ the purge runs and what it does with a failure; it had quietly come to also
  describe whether it survives. `write` now awaits both, and awaits them with
  `Promise.allSettled([putPromise, purgePromise])` rather than `Promise.all`: `all` rejects the
  instant the put does, which would stop the returned promise covering the still-running sweep in the
  one case a sweep is most likely to be mid-flight. The put's rejection is then rethrown explicitly,
  so both halves of the `LogChannel.write` contract hold — cover everything, reject only for the
  record write — while the purge's own rejection stays swallowed. The cost is stated rather than
  absorbed — on
  `purgeProbability` of writes the flush window now also covers one `list` and up to 50 delete
  batches, post-response under `waitUntil` and inline on the fallback path. **The existing stub was
  structurally incapable of catching this**: its `delete` resolves in the same microtask that starts
  it, so a fire-and-forget purge finishes inside the ticks an `await channel.write(…)` already
  consumes. The regression test parks the deletes, which is the only arrangement in which a tracked
  purge and a detached one look different.
- **A failed dynamic import became an unhandled rejection and could never retry.** `lazy` calls
  `observer.disconnect()` _before_ `options.load()`, and the returned promise carried only a success
  handler — so one failed chunk fetch both raised an unhandled rejection into whatever
  application-level telemetry is listening and left the element unobserved forever, turning a
  transient network blip into a permanently dead control. The rejection now goes to `onError` and
  the element is re-observed, bounded to three `load()` calls in total. The cap is load-bearing, not
  tidiness: `observe()` invokes its callback **immediately** for an element already on screen, so an
  uncapped re-observe on a visible element is a spin loop, not a retry. The disposer sets a
  `disposed` flag, so a load still in flight when the scope tears down never re-observes.
- **`mountTurnstile`'s cleanup left up to three timers running.** The poll interval, its paired
  giving-up timeout and the script-load fallback timeout were all held in local `const`s that
  `cleanup` never saw. Removing an htmx-swapped widget therefore left closures over its document,
  form and container alive for the rest of the timeout budget, and if the Turnstile API appeared
  inside that window the controller rendered into a **detached** container — a widget nothing can
  reach to remove again. `UI_CLIENT_RUNTIME.md` §2d ("The Disposer Contract") already required a
  disposer to clear its pending timers, so this was a written-invariant violation rather than
  untidiness. All three handles are now tracked and cleared through one `clearTimers()` (the
  `clearPending()` idiom `transition.ts` already uses), and `renderWidget()` and `showFallback()`
  return early once disposed, so a late `load` or poll hit neither renders into the detached
  container nor reveals a fallback that has left the page.
- **The Turnstile poll's paired timeout stayed pending after a _successful_ poll.** Unreported,
  found while fixing the above: the success branch cleared the interval and nothing else, so the
  giving-up timeout — which had no work left to do — held the closure alive for the remainder of
  `TURNSTILE_SCRIPT_TIMEOUT_MS`. Both handles are now cleared together.
- **A concurrent `loadStylesheet` caller resolved before the stylesheet had loaded.** Idempotence
  was a `querySelector` for a matching `<link>`, and an appended link is findable _immediately_ —
  long before its `load` event fires. A second caller arriving inside that window was told the sheet
  was ready and ran its dependent code unstyled (flash, wrong layout), and an eventual load failure
  was reported only to the first caller. The in-flight promise is now cached in a
  `WeakMap<Document, Map<string, Promise<void>>>` and consulted **before** the duplicate check, so a
  caller arriving mid-load joins the real `load`/`error`. The duplicate check still runs second and
  still resolves at once for a `<link>` this function did not create — SSR markup, third-party code
  — since for those there is no event left to wait for. A failure evicts its entry, identity-checked
  so a slow failure cannot evict a newer entry for the same href, and a later call retries with a
  fresh link. Keys are the `href` string as passed; normalising a relative URL against an absolute
  one is out of scope, so two spellings of one URL remain two entries.

### Changed

- **`Logger.flush()` settles rather than rejects.** It used `Promise.all`, which was stricter than
  the best-effort contract its own TSDoc states; a single failing channel both hid the others'
  completion and surfaced as a caller-visible error. `requestLogger` additionally `.catch()`-guards
  the flush before handing it to `waitUntil`, because the `await flush` on the no-`executionCtx`
  branch sits in a `finally` — and a `finally` that throws _replaces_ what was propagating, which
  meant a log failure could discard a successful response or mask the handler error being rethrown.

- **`MenuPopupProps["side"]` takes the whole `Side`,** which now spans eight values rather than four
  — see the `Side` entry below. `navbar`'s nested `Menu.Popup` passes `side='inline-end'`, so a
  submenu opens _beside_ the panel that contains it rather than below it. The logical spelling rather
  than `right` because the panel's own edge is what "beside" means: in an RTL subtree that edge is its
  left, and the keyboard mirrors to match. The default is unchanged.

- **`Side` widened from four physical values to eight,** adding the logical `block-start`,
  `block-end`, `inline-start` and `inline-end` (`src/ui/contracts/state-attrs.ts`). Physical and
  logical spellings share one value space because they share one `data-side` attribute: the physical
  four are right wherever a popup must _not_ mirror with the reader's direction, and the logical four
  resolve against the element's own inherited directionality. A component that styles only the
  physical subset projects it with `Exclude`, so a value its stylesheet cannot express is
  unrepresentable rather than silently unstyled. The widening is what the `menu-popup` side × align
  matrix in `src/ui/assets/css/theme-base.css` exists to serve — the logical sides are resolved there
  with `:dir(ltr)` / `:dir(rtl)` pairs, because `anchor(inline-end)` is not a valid `<anchor-side>`
  and the CSS cannot express them any other way.
- **Every forge selector on `data-slot` uses `~=` instead of `=`.** Identical specificity (0,1,0), so
  nothing shifts in the cascade — but `=` no longer matches a composed element.
- **`LogChannel.write` now carries a stated contract.** A returned promise must cover **every**
  operation the write initiates, maintenance work included — `Logger.flush()` awaits what it is
  handed and nothing else, so anything left outside it can be cancelled when the isolate suspends. A
  best-effort operation still swallows its own rejection: only a failure of the record write itself
  may reject. Custom channels compile unchanged; one that detaches its own maintenance is now in
  stated violation rather than merely unlucky.

### Breaking Changes

> **Upgrading a consuming app: four of the breaks below are silent** — an implicitly-optional schema
> field, a refusal whose status is unchanged but whose body is not, a dropped `v.safeParse` config,
> and a hand-rolled `Object.fromEntries` body read that is last-wins where the removed reader was
> first-wins. Each compiles clean, returns `200`, and behaves differently in production.

- **`defineAction` takes a `schema` instead of a `parse`/`validate` pair.** The two callbacks were
  arbitrary functions the type system could say nothing about: `parse` returned `Input` and
  `validate` returned `ValidationResult<Out>`, so a `validate` that handed back its own argument
  satisfied the contract exactly as well as one that checked anything. Naming the schema makes the
  guarantee a property of the type rather than of a convention each call site has to keep — `handle`
  is now reachable only through a passing `v.safeParse`, and it receives the schema's **output**, so
  a transform arrives as the type it actually is instead of being re-asserted with a cast.

  The generic list changed shape with it, from `<Input, Bindings, ConfigData, Out>` to
  `<S extends v.GenericSchema, Bindings, ConfigData>` — so a call site naming its bindings writes
  `defineAction<typeof ContactSchema, Bindings, AppConfig>`, since TypeScript has no partial
  inference and the schema argument comes first. `createHandlerFactory`'s bound `defineAction`
  narrowed to a single parameter, and because `S` infers from `def.schema` the **bound** form needs
  no type arguments at all.

  ```ts
  // before
  export const contactAction = defineAction<ContactInput, Bindings, AppConfig>({
    parse: (formData) => readFields(formData, ["name", "email", "message"]),
    validate: (data) => validateContact(data),
    handle: async (data, c, config) => {
      /* … */
    },
  });

  // after — forge reads the body; `phone` can now genuinely be absent rather than ""
  const ContactSchema = strictObject({
    name: v.pipe(formText(), v.minLength(1)),
    email: v.pipe(formText(), v.email()),
    phone: v.optional(formText()),
    message: v.pipe(formMultilineText(), v.minLength(1)),
  });

  export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
    schema: ContactSchema,
    honeypot: CONTACT_DECOY, // required if the view renders `<Honeypot />`
    handle: async (data, c, config) => {
      /* … */
    },
  });
  ```

  `strictObject`, `formText` and `formMultilineText` all come from `@y-core/forge/validation` as
  named exports beside `v` — see **Added**. `formText()` is not optional politeness: the body read
  passes values through exactly as submitted, so a bare `v.pipe(v.string(), v.minLength(1))`
  accepts `"   "`.

  Three properties of the body read are load-bearing and are why a named-field reader could not be
  kept underneath the new shape: an **absent field stays absent** rather than becoming `""`, which is
  what keeps `v.optional` reachable and required-ness a presence check instead of a min-length check;
  a **repeated key arrives as an array**, so a scalar schema refuses it in its own words and a route
  that genuinely accepts many says so with `v.array`; and a **`File` passes through unchanged**, so an
  upload schema can see one.

  > ⚠️ **`onValidationError` now receives `readonly v.BaseIssue<unknown>[]`, not
  > `readonly string[]`.** A handler that interpolated the strings into a response will fail to
  > compile — deliberately, because a valibot issue embeds the **rejected value** and the caller's own
  > key, so how much of a caller's text travels back in a refusal is a decision only the app can make.
  > For the field name alone — what the default fragment now renders — map the issues through
  > `describeValidationIssue` (`@y-core/forge/validation`). `formatValidationIssues` reproduces
  > `issue.message` and is an internal diagnostic; do not put its output in a response.

  **`strictObject` is the recommendation, and the fields forge's own forms carry are handled for
  you.** A form submits entries the request itself does not assert — a CSRF token, a honeypot decoy,
  a CAPTCHA token — and a strict schema has no reason to declare any of them, so each is dropped
  before validation. **Each is dropped because something consumed it**, never on a guess: the
  honeypot and the Turnstile token because the pipeline checked them, `_csrf` because
  `csrfProtection` published the field it took the token from. A route that renames one of them
  declares the new name once, to the guard that reads it, and never a second time to the schema.

- **A validation refusal answers `422`, not `200`.** The default fragment carried no status and
  `fragmentResponse` defaults to `200`, so a refused write reported success — invisible to
  status-based monitoring, to a WAF rule counting non-2xx, to an analytics funnel, and to log-level
  routing alike. It is now `422`: a well-formed request the server understood and declined.
  **Breaking for anything built on the `200`** — an htmx client enumerating status codes needs a
  `422` entry with the swap it wants, and a probe treating non-2xx as failure needs to stop doing so
  for this path.

- **The refusal fragment no longer carries valibot's message — only the failing field's name.**
  Every issue used to be rendered through a formatter that reproduces `issue.message`, and valibot
  embeds the rejected value in that message with no truncation anywhere: a 50,000-character
  submitted value produced a 50,000-character response. Worse, `v.pipe(v.string(), v.regex(/…/))`
  echoed the **pattern source** — the server's own rule — beside the value, so a failing password
  field returned the plaintext and the complexity policy together. The default now renders each
  issue through the new `describeValidationIssue`, which reproduces neither the submission nor the
  schema and bounds the field path it does render, so the response cannot be lengthened by what the
  caller sent. A route that wants the old text supplies `onValidationError` and decides for itself
  what travels back. Every `<li>` was HTML-escaped before and still is — this is a disclosure and
  amplification fix, not an XSS fix.

- **The refusal carries one `<li>`, not one per failing field.** `defineAction` now passes
  `{ abortEarly: true }` — which `.decisions/INPUT_VALIDATION.md` §1b already mandated for form
  validation while the call did not pass it. Beyond closing that contradiction it closes an
  amplification: an attacker could add arbitrary extra field names to multiply the issue count, and
  every issue emitted. A form rendering a per-field list from the **default** fragment now shows the
  first failure only; supply `onValidationError` without `abortEarly` if enumerating is genuinely
  wanted, and bound it deliberately.

- **`injectedFields` is removed from `ActionDefinition`, with no shim.** The dropped-field set is
  derived from the request instead: the pipeline's own guards supply the names they were given, and
  `csrfProtection` publishes the field it took the token from on the new `csrfFieldCtx`. An
  enumerated list was already wrong on the day it shipped — it omitted the Turnstile token field —
  and getting it wrong fails silently and only in production. Delete the option. If it named a
  renamed CSRF field, that name is already declared once to `csrfProtection`'s `tokenField` and
  nothing further is needed.

  **A route with no CSRF middleware now drops nothing for CSRF.** Absent `csrfFieldCtx` means
  nothing consumed the field, so a submitted `_csrf` is an ordinary undeclared field and a strict
  schema refuses it — pointing at the missing middleware rather than absorbing its absence. A
  permissive default and a blanket `403` were both considered and rejected; see
  `.decisions/ROUTING_AND_MIDDLEWARE.md` §2b for why.

- **`honeypot` is now required for any `defineAction` route whose view renders a decoy, and
  `turnstile` for any route rendering the widget.** Both checks moved into the pipeline, and each
  field is dropped _because_ it was checked — so a route that does not name them gets neither the
  check nor the strip. This closes the sharpest consequence of the `defineAction` rewrite: the
  pipeline stripped the honeypot field **before** validation without ever checking it, and forge
  ships no honeypot or Turnstile middleware, so bot detection did not degrade on migration — it
  disappeared, with no compile error. Omitting `honeypot` now means the decoy reaches a strict
  schema that does not declare it and every submission is refused, which is loud rather than silent
  and is the intended direction to fail in.

  There is deliberately **no default** for `honeypot` and no reserved prefix. A decoy works only
  while its name is unpredictable and plausible, and forge is open source, so any name or pattern
  forge published would be a one-line bypass for every deployment at once. Hold the name as one
  app-owned constant and reference it twice — `<Honeypot field={CONTACT_DECOY} />` in the view and
  `defineAction({ honeypot: CONTACT_DECOY, … })` in the action. `<Honeypot>`'s `field` prop is a
  security feature and is neither removed nor constrained.

- **`Honeypot` no longer renders `data-slot="form-honeypot"`.** Nothing read the attribute and it
  named the decoy outright, so a bot could match the wrapper without ever inspecting the field name
  — which made hardening the _name_ largely moot. **Breaking for a consumer selector or test
  asserting on that attribute**; there is no replacement, by design.

- **`readFields` and `readTextField` are removed from `@y-core/forge/form`.** Both returned `string`
  and never `string | undefined`, mapping an absent field, a `File` and a genuinely empty string onto
  one value — an absence collapse that happened _before_ any schema could observe it, which is what
  made `v.optional` unreachable through them. `defineAction` reads the body itself now; a route
  outside that pipeline uses `parseFormData` and hands the entries to `v.safeParse` directly, which
  the `form` README shows. The namespace deliberately ships no named-field reader.

- **The `FormFieldReader` type is removed.** It was declared as
  `(formData: ReadonlyFormData, field: string) => string` and its only documented meaning was the
  shape of `readTextField`. Keeping it as a dependency-injection seam was considered and rejected: the
  signature returns `string`, so it _is_ the absence-collapse above, and publishing it as the
  extension point would have made the discarded contract the one consumers type against. No forge
  module and no consumer referenced it.

- **`scopeAttrs` and `ScopeAttrsProps` moved from `@y-core/forge/ui/server` to
  `@y-core/forge/ui/contracts`.** Both are published subpaths, so an existing import stops resolving.
  **Remedy: change the import path**; the symbols and their signatures are unchanged.

  ```ts
  // before
  import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/server";
  // after
  import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/contracts";
  ```

- **A consumer's own `[data-slot="…"]` selectors must become `[data-slot~="…"]`** wherever they can
  target an `asChild`-composed element. An exact-match selector stops matching a button that carries
  two slot tokens.
- **A consumer restating forge's anchoring by hand should delete it.** The `anchor-name` and
  placement rules an app added to work around the dead block are now shipped, and a local `anchor-name`
  on the same element will win over forge's and re-break the pairing.

### Documentation

- **`HTMX.md` §7a states why URL-valued `hx-*` attributes are deliberately unsanitized.** §7's
  argument — that a selector or JSON blob cannot be neutralized by escaping — does not reach a URL,
  which escapes fine, so the omission read as an oversight. It is not. `safeUrl` refuses by rewriting
  to `"#"`, and `"#"` is inert on an `href` (a visibly dead link) but **live** on an `hx-get`: a valid
  same-origin URL naming the current page, which htmx fetches and swaps. Sanitizing here would convert
  a loud refusal into a _successful wrong request_. Two runtime layers sit underneath and are named as
  backstops rather than controls — htmx dispatches an XHR and never navigates the value, so a
  `javascript:` pseudo-URL does not execute; and `htmx.config.selfRequestsOnly` plus a consumer's
  `connect-src` bound where a request may go. §7 is rescoped to the selector/JSON set it actually
  governs, and `hxAttrs`'s TSDoc carries the same caveat at the call site.
- **`HTMX.md` §7b names `hx-on:*` as the one attribute family htmx evaluates as JavaScript,** and
  records the decision **not** to type it. Typing it needs a template-pattern index signature on the
  htmx attribute interface — which is mixed into both the HTML and SVG bases, so every element type
  and every `ui/core` prop type inherits it. A template index signature admits every key matching its
  pattern, so a misspelled event name would stop being an error library-wide, bought for autocomplete
  on a capability forge's default `script-src` already disables (htmx compiles the body with
  `new Function`). Declined — and the absence is documented as _not_ a guard, since the renderer has
  no `on*` filter and emits the attribute verbatim.
- **Three tripwire cases in `src/jsx/render-to-string.test.ts`** pin those decisions where a future
  change would silently reverse them: a `javascript:` `hx-get` renders verbatim; one value on both
  `href` and `hx-push-url` renders `href="#"` beside an unchanged `hx-push-url`, so the two fates
  cannot drift into one; and `hx-on:click` renders verbatim, so the type omission is never mistaken
  for enforcement.
- **`SECURITY_HARDENING.md` §2d describes `safeUrl` as it behaves.** It is an allow-list on the
  scheme, not a denylist, and it strips control characters and whitespace before matching — but it
  does **not** decode HTML entities, which the previous text implied. It does not need to: the same
  pass escapes the value, so an entity-encoded payload leaves with its `&` escaped and never
  re-decodes into a scheme. `safeUrl` picks the scheme; escaping closes the entity route. §2d now also
  states that no `hx-*` attribute is covered, in either half.
- **`INPUT_VALIDATION.md` §1d, `ROUTING_AND_MIDDLEWARE.md` §2b/§5b, `NAMESPACE_DESIGN.md`'s subpath
  catalog, and `src/form/README.md` and `src/app/README.md`** all follow the `defineAction` change.
  The former §2a/§2b on `readFields`/`readTextField` are gone rather than reworded, and
  "input validation must occur before any side effect" is restated as structural — a property of the
  schema contract rather than a rule each action has to keep.
- **`INPUT_VALIDATION.md` §1a names what `validation` exports beside `v`.** The section claimed `v`
  was the whole surface, which `strictObject`, the form-text primitives and
  `describeValidationIssue` make false — and the distinction is load-bearing, because
  `strictObject` and `v.strictObject` are different functions. §1b's own snippet rendered
  `result.issues.map((i) => i.message)`, precisely the disclosure the refusal change removes, and
  now maps through `describeValidationIssue`. §1d carries the consume-then-drop rule, the
  `strictObject` recommendation with its opt-in residual stated rather than hidden, the decision
  that forge does not normalize at the reader together with the four reasons, and the `422`/`500`
  refusal shapes. §4a and §4b give the two bot checks their home inside `defineAction` and stop
  restating field-name literals `src/form/constants.ts` owns. §6b's ordered step list said a
  `defineAction` route gets "steps 1, 5 and 6 for free"; it now says **1, 2, 4, 5 and 6**, with
  step 3 (CSRF) staying middleware.
- **`INPUT_VALIDATION.md` §1d reconciles a rule that had started to read as violated.** Middleware
  still attaches to the controller action object and never goes inside `defineAction`. The line the
  rule draws is between a **transport** guard — deciding from the request's envelope, needing to
  know nothing about this route's fields — and a **body-content** guard, which reads a field that is
  part of this form's design and therefore belongs where the body is read and where the field it
  consumes is dropped in the same step.
- **`ROUTING_AND_MIDDLEWARE.md` §2b owns the derive-only rule,** including why a permissive default
  and a blanket `403` were both rejected, and stops restating a `defineAction` option list that had
  already drifted to include `injectedFields` — `ActionDefinition` and `src/app/README.md` own that
  list. §4a adds `csrfFieldCtx` to the published context accessors with the `.getOptional`
  requirement that makes its absence readable.
- **`src/form/README.md`'s hand-rolled action example was wrong twice and is replaced.** It parsed
  with `Object.fromEntries(formData.entries())` — last-wins, where the real reader groups a repeated
  key into an array — _and_ it sat under a `csrfProtection` middleware while parsing with a
  `v.strictObject`, so as written it refused 100% of requests. The primary example is now a
  `defineAction` route; a second, smaller one shows `formToObject` with the `drop` set a CSRF guard
  makes necessary, for handlers outside the pipeline.
- **`src/validation/README.md` documents the four new exports**, and two stale references to a
  `validate` hook `defineAction` no longer has are gone. `src/app/README.md`'s status table, option
  table and worked example follow the pipeline; its security notes now describe a refusal that names
  a field rather than one that quotes the caller.
- **`UI_CLIENT_RUNTIME.md` §3b documented three signatures that do not exist.** It described
  `lazy(() => import(…))` as deferring "until the browser is idle" — it is an IntersectionObserver
  keyed on a `data-ref` element, takes an options object and returns a disposer — and gave
  positional two-argument spellings for `loadScriptOnEvent` and `loadStylesheet`, the latter
  omitting the _required_ `integrity` argument. §3b now states the real signatures, notes that
  `loadStylesheet` is the one positional member of the trio and why, and documents the retry cap and
  the concurrency join described above.
- **`src/logging/README.md` and `kvLogChannel`'s TSDoc separate "best-effort" from "untracked."**
  The channel contract, the `purgeProbability` row and the retention section now each state that a
  selected sweep is inside the `write` promise, along with what that costs the flush window.

---

## [0.0.80] — 2026-08-02

A full-codebase review of 20 namespaces. Twenty-eight verified defects, seven of them
security-relevant, each landed with both a passing and a failing test. Several are described at
length because the mechanism is the interesting part — a defect that survives this long usually
does so because something about it was invisible, and that is the part worth writing down.

### Breaking Changes

- **`Form` no longer renders a honeypot; compose `<Honeypot />` yourself.** It rendered one
  _unconditionally_ — including on `method="get"`, a value the public `method?: "get" | "post"`
  union explicitly permits. On GET the browser serialises the decoy into the query string, so
  `?…&__surname=` ended up in every shareable link, bookmark, history entry and outbound `Referer`,
  and a consumer validating search params against a strict schema got a 400. The honeypot has no
  defensive value there in the first place: it flags bots submitting spam, and `isHoneypotFilled` is
  only consulted by mutation handlers. All 14 assertions in `form.test.tsx` used `method="post"` —
  the GET half of a public API union had **zero** coverage, which is why this survived.

  > ⚠️ **This degrades silently.** A POST form that is not updated loses honeypot protection with a
  > green gate and no runtime signal. To make it as loud as the design allows, the `honeypotField`
  > prop was **removed** from `FormProps` rather than deprecated, so any consumer who customised the
  > name gets a **compile-time error**. Consumers on the default get no signal — audit every
  > `<Form>` you ship.

  Migration — add one child to each mutating form:

  ```tsx
  import { Form, Honeypot } from "@y-core/forge/ui/core";

  <Form method='post' csrfToken={token}>
    <Honeypot /> {/* ← add this; pass `field` if you previously set `honeypotField` */}
    {/* … */}
  </Form>;
  ```

- **`export type * from` is now banned in barrels.** `NAMESPACE_DESIGN.md` §1b banned `export *`
  and was silent on the type-only spelling, which the matcher could not see across the `type` token
  — and `barrel-parse.test.ts` _pinned it as allowed_. Erasure at emit removes only the
  circular-dependency harm; the surface leak and the ungreppable API remain, and a barrel of nothing
  but `export type *` previously failed as the misleading "no value exports found in barrel". There
  are **zero** occurrences in `src/`, so nothing inside forge changes; a consumer whose own barrels
  are checked by this script may now fail. Name the types.

- **Header-conflict precedence in `createSecurityHeaders` is now inner-wins, and is stated.** The
  middleware queued its headers _after_ `await next()`, which made an overlapping header name
  resolve outer-wins. It now queues _before_ `next()`, alongside the nonce, so a middleware
  registered deeper writes last and wins. Nothing inside forge overlaps — `createSecurityHeaders`
  owns its 8–9 names, `requestId` owns `x-request-id`, session and flash use `set-cookie` with
  `{ append: true }` — so only consumer middleware queuing one of those names is affected. **No
  test broke and no doc promised either direction**, which was the actual problem: the behaviour is
  now pinned by test and documented in `SECURITY_HARDENING.md` §2a and `ERROR_HANDLING.md` §5b.
  See _Fixed_ for the gap the move closed on the way past.

- **`originProtection` now requires an app to list its own origin in `allowedOrigins`.** Previously
  a present `Sec-Fetch-Site` header caused an early return that skipped the `allowedOrigins` check
  **entirely**. Two things were wrong with that. `Sec-Fetch-Site` is a forbidden header name, so a
  _browser_ cannot be tricked into sending a false `same-origin` — but a non-browser client sets
  whatever it likes, and one forged header was enough to walk past the allowlist. It also put this
  tier in standing disagreement with its sibling `originGuard`, which enforces the allowlist
  unconditionally. The header is now a **veto, not a pass**: a bad value still rejects outright, but
  a good one no longer short-circuits anything. `allowedOrigins` is consulted on every mutating
  request carrying an `Origin` or `Referer`; only when both are absent does the guard fall back to
  the browser's vouching, and with no signal at all it fails closed. **This will break deployments
  that relied on the early return** — add your own origin to `allowedOrigins`.
- **`Sec-Fetch-Site: same-site` is now rejected.** The check was a denylist naming only
  `cross-site`, so `same-site` passed — and _any_ sibling subdomain produces `same-site`. A single
  XSS or a stale CNAME on one subdomain was enough to drive authenticated mutations against
  another. It is now an allowlist: only `same-origin` and `none` pass. Parity with Go's
  `http.CrossOriginProtection`. `CrossOriginResult` gains a distinct `"same-site"` error code,
  because a sibling subdomain you may partly control and an unrelated origin are different
  attackers and worth telling apart in logs.
- **A hand-built `{ text, params }` object no longer satisfies `isSqlFragment`.** The guard was a
  structural duck-type, so anything with the right shape passed — including `JSON.parse` output.
  Attacker-controlled JSON interpolated into a `` sql`…` `` template was therefore **concatenated
  into the statement text instead of bound as a parameter**: a full SQL injection through what looks
  like a value position. `SqlFragment` now carries a `unique symbol` brand that only `sql` sets and
  that `mod.ts` deliberately does **not** re-export. The security property then falls out of the
  language rather than from a rule we have to keep current: `JSON.parse` can only ever produce
  string-keyed properties, so parsed JSON is structurally incapable of carrying the brand. Only
  `sql` can mint a fragment; everything else gets bound.
- **`routePaths` now includes `ANY` routes in method-filtered results, and throws on a filtered
  miss.** Upstream `@remix-run/fetch-router` builds bare-string route definitions as method `ANY`
  and dispatches them for _every_ method. Filtering with `{method:"POST"}` used a strict `===` and
  so omitted paths that genuinely accept POST — and the documented use of that result is
  `app.use(path, csrfGuard)`, so the guard silently attached to **nothing**. An empty list is
  indistinguishable from a correctly-empty one at the call site, so a method filter that matches no
  route in a non-empty map now **throws** rather than returning `[]`. Unfiltered calls and genuinely
  empty maps still return `[]`. Any consumer computing paths for an optionally-empty route group
  will now throw where it previously got a silent empty list — that is the point, but it is a new
  failure mode.
- **`optionalGroup` actually validates its entries, and strips unknown keys.** `entries` was a type
  carrier only: the sole runtime read was `Object.keys()`, and the return was a bare cast over the
  raw input, so a number — or an entire Workers binding object — passed as a validated `string`.
  Two consequences follow from running the schemas for real, both of which surface latent
  contract violations rather than creating new ones: a `defaults` value must now satisfy its own
  entry schema, and a key that is neither required nor defaulted must be declared `v.optional(...)`
  if it may be absent. Unknown keys are **stripped** (`v.object`, not `v.strictObject`) — a Workers
  `env` legitimately carries many unrelated bindings, so erroring on them would reject essentially
  every real deployment.
- **`aria-*` attributes now serialize `false` as `"false"`.** A blanket `value === false → omit` in
  the renderer preceded the `aria-` branch, so `aria-expanded={false}` rendered **nothing** — while
  `jsx/types.ts` types these as `boolean`, so it type-checked. Per WAI-ARIA these are string-valued
  and the distinction is real: absent means "not expandable", `"false"` means "expandable,
  currently collapsed", and screen readers act on the difference. Consumers passing an explicit
  `aria-*={false}` will now see it in the output. Forge's own components are unaffected — they had
  been working around this with `String(x) as "true" | "false"` casts at five call sites, all now
  reverted, with rendered output verified byte-identical across 19 variants.
- **`definePage`'s `action` is now wired into the pipeline.** It was declared, exported, and
  documented — and never read. `method` was hardcoded `"GET"` and `actionData` always `undefined`,
  so a POST through `definePage` type-checked and was then **silently discarded with a 200**.
  Non-GET now dispatches to `action`, its result reaches the view as `actionData`, and errors route
  through the existing boundary.
- **`csrfProtection` answers `413` instead of `403` when a body exceeds its cap**, and both
  `defineAction` and `csrfProtection` accept `maxBytes`. See _Fixed_ for why one without the other
  does nothing.

### Added

- **`uuidv7()` and `createUuidv7(options?)`** (`@y-core/forge/storage/db`) — RFC 9562 UUIDv7
  generation for D1 primary keys: unique, non-sequential, and lexicographically sortable by
  creation time, so inserts append to the right edge of the primary-key B-tree and `ORDER BY id`
  doubles as a keyset cursor. The 12-bit `rand_a` field carries a monotonic counter (RFC 9562 §6.2
  Method 1) rather than randomness, which on Workers is load-bearing rather than an optimisation:
  `Date.now()` is frozen between I/O operations as a timing-attack mitigation, so every ID minted
  between two awaits reads the same millisecond and a stock UUIDv7 would emit the batch in random
  order — losing the one property it was chosen for. The counter reseeds to a random 10-bit value
  per clock advance (≥3072 increments of headroom) and borrows the next millisecond on overflow; a
  backwards clock step is absorbed the same way, so a generator never emits an ID that sorts before
  one it already emitted. `createUuidv7` takes an injected clock. Implemented in the
  sealed-internal `crypto` module so `storage/kv` or a future `auth` can consume it without a
  layering violation, and surfaced through `storage/db` alone — there is still no importable
  `crypto` path. **Not a secret:** a UUIDv7 discloses its creation time and mint rate by design.
- **`uuidv7Bytes()`, `uuidFromBytes(value)`, `uuidToBytes(id)` and `createUuidv7Bytes(options?)`**
  (`@y-core/forge/storage/db`) — the `BLOB` form of the same identifier, making the storage-density
  decision reversible per table instead of a schema-wide bet. `uuidv7Bytes` mints the same value as
  `uuidv7` from the **same shared generator**, so an application mixing the two forms still gets one
  global ordering. Bytes are most-significant first, which is the order SQLite's `memcmp` sorts a
  `BLOB` by, so ordering is identical to `TEXT`. `uuidFromBytes` accepts the `number[]` D1 returns
  for a `BLOB` column — its JSON transport has no binary type — alongside `Uint8Array` and
  `ArrayBuffer`; `uuidToBytes` parses a canonical string for binding against one, and is an encoder
  rather than a validator, so a request-supplied ID should still be checked at the boundary. On a
  100k-row table with two secondary indexes the `BLOB` form is ~27% smaller in total
  (11,640 KB vs 15,924 KB), which counts against D1's 10 GB per-database ceiling rather than
  against the bill; the price is byte arrays in every console query, log line and `json_object()`
  projection, so it is a per-table choice, not a default. Related: **`WITHOUT ROWID` is not the
  lever it looks like** — an ordinary rowid table's secondary indexes carry the implicit integer
  rowid, not the primary key, so a 36-character id costs two fixed copies per row however many
  indexes exist; `WITHOUT ROWID` appends the id to every index entry and comes out _larger_ past a
  single index.
- **`forMethod(method, middleware)`** (`@y-core/forge/router`) — wraps a middleware so it runs only
  for the given `RequestMethod` (or array of them) and calls `next()` otherwise. `app.use` is
  **path**-scoped only; dispatch never consults the method, so feeding a
  `routePaths(routes, { method: "POST" })` list into it guards those paths for every method they
  serve. With `ANY` routes now included in a concrete method filter (0.0.80, above), the
  `router/README.md` snippet that loops `csrfGuard` "onto only the mutating endpoints" was guarding
  `/health` on GET. No method-scoped registration existed anywhere in forge or the vendored
  `@remix-run/fetch-router` — `Router` has no `use` at all. Lives beside `routePaths`, so `router`
  stays a leaf namespace.
- **`Honeypot`** (`@y-core/forge/ui/core`) — the decoy field extracted out of `Form`; see _Breaking
  Changes_. Takes an optional `field` defaulting to `HONEYPOT_FIELD_DEFAULT`.
- **`fieldDescribedBy(name, options)`** (`@y-core/forge/ui/core`) — the `aria-describedby`
  computation on its own, returning `undefined` when nothing to point at renders. `fieldControlProps`
  uses it, and so do `CheckboxGroup` and `RadioGroup`, which cannot adopt `fieldControlProps`
  wholesale because a `<fieldset>` is not a labelable control.
- **`description` and `scope` props on `CheckboxGroup` and `RadioGroup`** — matching `FormField`.
  `scope` must be repeated on every `.Item`, since each item derives its own id.
- **`id` is now declared and documented on `NavbarProps`.** It was always accepted via the `<nav>`
  intrinsic and always namespaced the generated menu ids, but the escape hatch was documented only
  on an `@internal` field a consumer never sees.

### Fixed

- **A 500 could be logged and then lost.** On the guard-throw path `requestLogger`'s `finally`
  flushes _before_ the app's error boundary writes its `unhandled error` record, and `flush()`
  **splices** the pending buffer — so the boundary's record landed in a buffer nobody awaited. With
  the synchronous channel the tests use, both records are captured and everything looks fine; with a
  real asynchronous `kvLogChannel`, the boundary's record **may never persist before isolate
  teardown**. Production therefore saw two records _or_ one-plus-a-lost-one, nondeterministically.
  The boundary now schedules its own flush at the point of write, so both records sit inside an
  awaited window on both throw paths. The suite was structurally incapable of observing this; the
  regression tests use an asynchronous channel fixture, which is the only kind that can. The two
  records are still not deduplicated — they are distinguishable by `message`.
- **`closestAcross` and `contains` threw a `TypeError` on a detached subtree.** Both read
  `getRootNode().host` with no `nodeType === 11` guard — the defect fixed at one of the three sites
  in 0.0.80 and left at the other two, and `contains` was not recorded anywhere. For a detached
  subtree `getRootNode()` returns the topmost ancestor _element_; on an `<a href>` that is the URL's
  host string, and the next hop calls a method on a string. A **relative** `href` is no safer, which
  is the non-obvious half: a detached anchor resolves it against the document base URL, so `host` is
  the page's own origin rather than `""`. Both are public API. All three reads now go through one
  private `shadowHost` helper so they cannot drift again.
- **An `effect()` whose first run read a signal and then threw poisoned that signal permanently.**
  The disposer is the return value, so a throw means the caller never receives it — and the first
  run's own `cleanup` is a no-op, because `deps` is still empty when it runs. The dead node
  therefore stayed in the signal's `subs` with nothing able to remove it, and **every** later write
  to that signal re-entered it and rethrew out of the _setter_, at an arbitrary unrelated call site,
  for the signal's lifetime. `effect()` still throws — callers may rely on that — but now
  unsubscribes first, so a failed effect leaves no residue. The existing "does not stay installed"
  test could not catch this: its throwing body read no signal, so it never subscribed.
- **`CheckboxGroup` and `RadioGroup` emitted a dangling `aria-describedby`,** unconditionally
  naming a description element that renders only when the consumer supplies one — the exact defect
  fixed in `field.tsx` in 0.0.80 and not fixed in these two. A dangling IDREF is not ignored by
  assistive technology; it is reported as an error. **This shipped on the component showcase**,
  which renders both groups with no `Description` child. Separately, `itemId()` did not thread the
  `scope` param, so _every item id_ — not just the description id — collided across two same-named
  groups on one page, and a click on the second group's item resolved to the first group's. Neither
  group had a unit test; both now do.
- **The console error path dropped `name` and `stack` from unhandled errors.** `_handleError`
  logged `{ error: err.message }` to the app logger, immediately beside a line publishing the full
  `serializeError(err)` to the request logger. Redaction in forge is a **channel**-level decision —
  `consoleChannel` keeps stacks, `kvLogChannel` strips them via `persistStack: false` — and this is
  the worker log stream, not the HTTP response, which is separately guarded behind `isDebug`.
  Dropping the stack made the console the least informative sink of the three.
- **Security headers were missing from the error page when a guard threw.** They were queued only on
  the way back out of `createSecurityHeaders`, and on that path the response never comes back out —
  so a throw from any middleware registered after it produced a 500 with no CSP, no HSTS and no
  `referrer-policy`. Queuing before `next()` (see _Breaking Changes_) fixes this as a side effect;
  it is pinned by its own test.
- **`makeKVStub` in `store.test.ts` handed out the stored `ArrayBuffer` by reference,** so
  `bytesCodec().decode` wrapped it in a writable _view_ onto the stub and mutating a retrieved value
  silently rewrote the store. Byte-faithful but reference-leaky — the write side was safe only by
  accident, because `encode` already slices. No test exercised it: a latent trap rather than a live
  bug. `get` now returns a copy, and the isolation property is asserted against both this stub and
  `fakeKV` so the two cannot drift.

- **A cached session middleware leaked one tenant's KV namespace to another.**
  `createAnonymousSession` keyed its cache on `(cookieName, secure, secret)` — but the cached
  closure captured the per-request `options.kv(c)`, which is **not in that key**. Two tenants
  sharing a cookie name, secure flag and secret therefore hashed to one slot and shared one KV
  namespace: tenant B read and wrote tenant A's sessions. The general shape is worth naming —
  whenever a cache key is narrower than what the cached value closes over, you get cross-tenant
  bleed. The cache is now a `WeakMap` keyed on the `env` object itself (the scheme `csrfProtection`
  already used), which makes the key at least as wide as the capture and lets entries be collected;
  the old `Map` also grew without bound under a rotating secret.
- **A CSRF token with kid `constructor` returned 500, not 403.** `ring.keys[_kid]` on a plain object
  walks the prototype chain, so an inherited member name resolved to a truthy non-`CryptoKey`, sailed
  past the `!key` guard, and threw an uncaught `TypeError` out of `crypto.subtle.verify` — an
  unauthenticated single-request 500 on **every** guarded mutation route. Now `Object.hasOwn`.
- **`https://a/b.example.com` matched the CORS pattern `https://*.example.com`** and was reflected
  into `Access-Control-Allow-Origin`. The wildcard expanded to `[^.]+`, which happily matches `/`,
  `:` and `@` — so a path segment, userinfo or port could carry the trusted suffix. Now
  `[^./:@]+`, and `?` is escaped rather than being left to make the previous character optional.
- **`ONMOUSEOVER=` survived SVG sanitization.** The event-handler strip was the only regex in
  `sanitizeSVG` without the `i` flag — every sibling rule had it — and HTML lowercases the attribute
  back into a live handler on parse.
- **A view stored its entire backing buffer in KV.** `bytesCodec`'s `encode` returned `value.buffer`,
  ignoring `byteOffset`/`byteLength`. Because `subarray()` is zero-copy, a view shares its buffer
  with whatever else was allocated there — so storing a 2-byte view durably wrote the whole
  allocation, with the wrong length **and** disclosure of adjacent bytes, reported as `ok: true`.
  This was invisible until the KV test fake was made byte-accurate in the same window: a fake that
  decoded values through `TextDecoder` was structurally incapable of showing it.
- **A single throwing effect froze every signal on the page.** `signal.ts` incremented a batching
  `depth` and swapped the global `activeEffect` without `try/finally`, so one throw stranded
  `depth > 0` forever, froze `epoch`, and every subsequent signal write silently stopped re-running
  every effect — with no further error anywhere. The dead node also stayed installed as the global
  dependency-tracking target.
- **Every `<a href>` click threw a `TypeError` out of the delegated document listener.**
  `closestAcross` duck-typed a shadow boundary on `.host` — but `HTMLAnchorElement.host` is the
  URL's host **string**. Reaching an anchor during the climb reassigned `current` to a string, and
  the next iteration called `.getRootNode()` on it. Reachable from four controllers. Now tests
  `nodeType === 11`.
- **An invalid env produced the raw Workers 1101 page.** `resolveConfig` ran before the `try` in
  `fetch()`, so a config failure escaped past the error boundary, the logger, `_onError` and the
  hardening headers — and because `Config.get` caches only on success, it threw forever. It now
  resolves inside the `try`. The error boundary is additionally registered at an **outer** depth so
  a throwing `app.use` guard is caught with headers intact; the innermost instance is deliberately
  kept, because `createSecurityHeaders` queues its headers _after_ `await next()`, so a boundary
  sitting outside the guards would strip CSP and HSTS from every error page.
- **Every 500 was persisted with no error detail at all.** `requestLogger`'s error branch was
  unreachable — it is registered outside the innermost error boundary, so a handler throw was
  already converted to a 500 `Response` and `await next()` resolved normally. The fix publishes the
  error from the boundary that holds it onto the per-request logger, so it reaches KV with
  `requestId` correlation; `persistStack: false` still strips the stack before persistence. The
  local `catch` is **kept**: it is still reached when a throw escapes `next()` from middleware below
  the logger, and on that path it is the only thing that lands error detail inside the `waitUntil`
  flush window.
- **The first caller's `maxBytes` won permanently for the isolate.** `parseFormData` read `options`
  only when populating its cache, and `csrfProtection` always parsed first at the 100 KiB default —
  with a bare `catch {}` that swallowed the resulting 413 and answered a misleading **403**. So a
  CSRF-guarded route could never raise its cap. The cache now records the bytes actually read and
  each caller re-checks that count against its own limit; keying the cache on `maxBytes` would have
  been wrong, because a body is readable exactly once and a second caller would hit a confusing
  "body used" error instead of a 413. `csrfProtection` gained its own `maxBytes` because the
  acceptance case is unreachable without it — the guard runs first and short-circuits, so the
  handler's cap never gets a say. Both sides must be raised together.
- **A CJK filename returned 500.** `serveObject`'s "ASCII fallback" for `Content-Disposition`
  stripped only C0 controls and DEL, so non-Latin-1 characters survived and then threw on
  `Headers.set`. The fallback now folds accents via NFKD, collapses each remaining run of
  non-printable-ASCII to a single `_`, and emits `"` and `\` as quoted-pairs rather than stripping
  them. Substituting _in place_ means every ASCII character survives with no filename parsing at
  all, so the extension is preserved: `年度報告.pdf` → `_.pdf`, `invoice-年度.pdf` →
  `invoice-_.pdf`.
- **The Switch has never animated its thumb.** `peer-*` compiles to a **general-sibling**
  combinator, so it reaches only siblings of the input. The track is one and painted correctly; the
  thumb is a _child of the track_, so `peer-checked:translate-x-4` matched nothing — in any release.
  A Tailwind selector that matches nothing produces no build error, no runtime error and no visual
  artifact, and the correct sibling selector next to it kept the component looking half-alive. The
  thumb now keys off a `data-slot`-anchored descendant selector, and
  [`UI_SSR_COMPONENTS.md`](.decisions/UI_SSR_COMPONENTS.md) §1e gains the rule.
- **A ToggleGroup's highlight was frozen on whichever item the server rendered pressed.** The active
  class was applied at render as `pressed && ITEM_ACTIVE`, while the controller only writes
  `aria-pressed` / `data-pressed`. It is now unconditional and keyed on `data-[pressed]:`, which
  also raises specificity enough that `data-[pressed]:hover:` reliably beats `hover:` instead of
  depending on stylesheet emission order.
- **The first Tab keypress reselected tab 0.** `Tab` omitted `ACTIVE_COMPOSITE_ITEM`, so roving
  focus resolved its initial index to 0 regardless of the selection.
- **`asChild` turned a child `<button type="button">` into an accidental submit button.**
  `cloneAsChild` spread `type: undefined` / `disabled: undefined` over the child's own props.
  Undefined-valued keys are now dropped before the spread.
- **`aria-describedby` named a description element that did not exist.** A dangling IDREF is treated
  as an error by assistive technology rather than ignored. `FieldDescriptor` gains `description`
  (default `false`) so the attribute is emitted only when something really describes the field, and
  an opt-in `scope` so two forms with a same-named field stop colliding. Automatic uniqueness would
  need module-level mutable state, which `PRODUCTION_TS_RULES.md` §1 forbids; unscoped output is
  byte-identical to before.
- **Two `Navbar`s on one page emitted duplicate ids.** Menu ids are now namespaced by the navbar's
  own `id`, falling back to `placement` — the posture `ui/chrome/toolbar.tsx` already established.
- **htmx swaps leaked detached DOM indefinitely.** `resume.ts` pushed onto a module-level disposer
  array that only drained at whole-runtime teardown, so every swap stranded another detached tree
  and its live `MutationObserver`s; `resumed` was never cleared, so a re-mounted scope came back
  inert. Disposers are now keyed by root and swept when a replacement scope resumes — which
  `htmx:load` already triggers, so no new hook was needed.
- **`Date`, `Map` and `Set` were persisted as `{}`.** `Object.fromEntries(Object.entries(v))` clones
  property-wise, and all three hold their payload outside enumerable own properties. They now
  serialize to ISO 8601 and tagged rebuildable forms. Cycles are cut with a `WeakSet` of the
  _currently open path_, so a repeated sibling reference survives and only true ancestors become
  `"[circular]"` — the previous implementation was unbounded on a cycle.
- **`?level=` was cast straight to `LogLevel`** with no validation, and echoed back into the rendered
  filter bar. It is now validated at the boundary with the `v` facade. An invalid value **drops the
  filter and renders unfiltered** rather than erroring: the level filter _narrows_ a row set the
  caller was already authorised to read in full, so it is not an authorization input, and a 400
  would turn a stale bookmark into a broken admin page for no security gain.
- **"Load more" destroyed the rows already loaded** and dropped the active `level` / `q` filters. It
  `outerHTML`-swapped the whole tbody; it now replaces only its own `<tr>` and carries the filters
  into the next-page URL. (`beforeend` is wrong here: the control lives _inside_ the tbody it would
  append to, so it would survive below the new rows still pointing at the cursor just consumed.)
- **`withQueryParam` discarded the scheme and host of an absolute `hx-get`**, silently rewriting an
  absolute endpoint into a path-relative one.
- **An empty client-supplied `CF-Ray` became the request id.** `??` only guards `null` and
  `undefined`; empty and whitespace-only values are now treated as absent.
- **`Form` hardcoded `"_csrf"` and `"__surname"`** rather than importing the constants
  `src/form/constants.ts` owns — so renaming either would have silently disabled the honeypot with a
  green gate. The tests now interpolate the imported constants into the expected HTML, so a rename
  fails loudly.

### Changed

- **`validate-exports` catches two evasions it previously missed.** `export * as ns from` slipped
  past the `export *` ban by one token, and the `@public` lookahead was a fixed nine lines — so a
  _well-documented_ export was checked **less** than a sparse one. The window is now the TSDoc
  block's actual extent. A third defect surfaced while writing the fixtures: searching forward from
  the block's start makes an `export const` inside an `@example` look like the declaration, which
  the old code did. Neither fix flags anything new in `src/` — verified by diffing old against new
  across every source file, not inferred from a green run. The pure parsers moved to
  `scripts/barrel-parse.ts` so they can be tested at all; `validate-exports.ts` remains the entry
  point and retains every policy decision.
- **The test fakes match the real bindings.** `fakeKV` stores bytes verbatim instead of round-tripping
  them through `TextDecoder` (lossy for anything non-UTF-8) and records `expirationTtl`; `fakeR2`
  honours `range`; `fakeD1` gains opt-in failure injection so consumer error branches are reachable
  at all. Worth noting what this did **not** find: no existing test broke, because the storage suites
  hand-roll their own local stubs and never used the shared fakes. The fakes' divergence was real but
  load-bearing for nothing — which makes the hand-rolled stubs the place divergence will actually
  hide next.

### Documentation

- **`PRODUCTION_TS_RULES.md` §1e states the browser-only carve-out.** §1a's prohibition on
  module-level mutable state, and its rationale, are both scoped to _request-scoped_ data under
  Workers isolate recycling — but `ui/client` never executes in a Worker, and module state is the
  house style across seven files there with no exemption marker anywhere. The carve-out was implied
  by §1's framing plus `UI_CLIENT_RUNTIME.md` and never stated, so it kept resurfacing as a review
  finding. §4a (testability) still applies in full: page-scoped state a test can observe needs a
  reset export, as `active-descendant.ts` already ships.
- **`NAMESPACE_DESIGN.md` §1b names all three star spellings** rather than leaving the type-only
  form to the script. **`CLAUDE.md`'s Source-of-Truth Register** names both
  `scripts/validate-exports.ts` and `scripts/barrel-parse.ts` for barrel rules, with the split
  stated: the former is the entry point and holds every policy decision, the latter holds the
  matchers.
- **`src/logging/README.md` no longer claims the guard-throw path writes one error record** — it
  writes two, and the second one's flush window is now documented. `request-logger.test.ts`'s
  matching test title said "one error record" while its assertion pinned two.
- **`src/form/README.md`, `INPUT_VALIDATION.md` §4a and `src/ui/README.md`** document the required
  `<Honeypot />` composition and the migration. **`src/router/README.md`** documents `forMethod` and
  states plainly that `app.use` is path-scoped only.

---

## [0.0.79] — 2026-08-02

Released from a single change to the asset pipeline and its governing rule; the entries below are
the substance of it.

### Added

- **`generateAssetsTypes(config, options?)` and the `forge-assets types` command**
  (`@y-core/forge/assets/build`) — writes the generated assets module from `assets.config.ts` alone,
  with no CSS, JS, sprite, icon or font build and so no `tailwindcss`, `esbuild`, `sharp` or network.
  Everything in that module which carries _type_ information is derivable from config — the manifest
  keys and the sprite symbol ids that give `createIcon` its icon-name union — so a clean checkout can
  typecheck and run tests against a module no consumer commits. Only the values need a real build:
  emitted paths are the unhashed logical names and every `viewBox` is empty, and the artifact carries
  a distinct `TYPES ONLY` banner saying so, because the two artifacts are shape-identical and nothing
  else in the file distinguishes them. Both paths emit through the same function as `buildAll`, so
  they cannot drift in shape. The command is a sibling of `sprites` rather than a child of `build`,
  since it builds nothing.

### Documentation

- **`LIBRARY_ARCHITECTURE.md` §3d states where CSS source scanning stops.** Tailwind never scans
  `node_modules`, so shipping raw source ships no _rules_ — a class with no rule renders as an
  attribute that does nothing. `forge.css` carries `@source` paths written relative to itself, so
  they resolve wherever forge landed. The scope stops at `ui/` as a decision rather than as the reach
  of a relative path: a component library owes its consumers the classes its own components emit,
  while a namespace whose markup is opt-in owes them a documented `@source` requirement in its own
  README instead. `scripts/validate-css-sources.ts` enforces both halves from disk, so neither is a
  list to keep in step. `src/app`, `src/assets`, `src/http`, `src/logging` and `src/ui` READMEs follow.

---

## [0.0.78] — 2026-08-02

### Fixed

- **`forge.css` never scanned `ui/contracts`, so `Menu`'s row classes were generated for nobody.**
  The `@source` list named `core`, `chrome` and `controls` — the directory added alongside it in the
  same window was not on it. `MENU_ITEM_CLASS` in `contracts/menu-contract.ts` is the one place in
  forge those 22 utilities are _written_; `core/menu.tsx` reads it as `const ITEM_BASE =
MENU_ITEM_CLASS`, an identifier Tailwind's textual scan cannot see through. The consequence was
  wider than the constant's stated purpose suggests: **forge's own SSR `Menu.Item` lost the rules
  too**, not merely a client-built row, and with it every consumer of `core/Menu`.
  What kept it invisible is that the failure was _partial_. Most of the 22 are ordinary enough that
  unrelated scanned components — `core/popover.tsx`, `core/dialog.tsx`, `core/button.tsx` — emit
  them incidentally, so a menu still looked broadly right; only the five nothing else happened to
  use fell through, and they were `text-left` plus the `focus-visible:` and `aria-disabled:`
  affordances, i.e. exactly the keyboard-focus and disabled states a casual glance does not check.
  A stylesheet that _mostly_ works is harder to notice than one that does not.
  **`bun run check` gains `validate-css-sources`**, which reads the direction that would have caught
  it: every directory under `src/ui/` must be covered by an `@source` path or listed as class-free
  with a reason, and each class-free claim is re-tested by a literal detector so an opt-out cannot
  outlive its truth. The old failure was a new directory meeting an old list; that shape now fails
  the gate rather than the render.

---

## [0.0.77] — 2026-08-01

### Fixed

- **`Menu.Popup` rendered a closed menu permanently visible.** `POPUP_BASE` ended in `flex flex-col`,
  and a closed popover is hidden by the UA rule `[popover]:not(:popover-open) { display: none }` —
  which is **not** `!important`, so any author-origin `display` on the same element beats it. Escape
  and light-dismiss both worked, `:popover-open` went false, and the menu stayed on screen. Nothing is
  lost by removing it: every row shape already carries `flex w-full`, so the rows were block-level
  boxes stacking on their own account. **`menu.browser.ts` gains the case that would have caught it**,
  asserting the _computed_ display rather than a class — every one of the 25 existing cases read
  `:popover-open` or a state attribute, all of which were correct while the component was broken.
  The general rule: a popover or `<dialog>` must not carry a bare `display` utility.

### Added

- **`mountActiveDescendant` / `resetActiveDescendant` (`ui/client`)** — the combobox controller, and a
  sibling to `mountRovingFocus` rather than an option on it. Three properties of the roving controller
  disqualify it: `belongsToTextField` hands every arrow back to the caret whenever the caret can still
  move (so ArrowDown never reaches the ring mid-query), it calls `item.focus()` and so takes focus out
  of the field a combobox is defined by keeping it in, and its typeahead is gated off for native
  inputs. Items resolve **live**, so a list rebuilt between keystrokes needs no re-registration.
  `resetActiveDescendant` is published separately because only the consumer knows when its list
  changed — and because **reset, never clamp**: clamping keeps the highlight on whatever option now
  occupies the old index, which after a new query is a different command, and Enter would run it.
- **`menuItemAttrs()` and `MENU_ITEM_CLASS` (`ui/contracts`)** — a **client-built** menu row stamped
  from forge's own declaration. An SSR component renders on the Worker and cannot be invoked from the
  browser, so a context menu whose rows arrive from synchronous callbacks previously had no option but
  to re-type forge's class string as a literal. `ITEM_BASE` in `core/menu.tsx` now reads the published
  constant rather than keeping a private copy beside it.
- **A `flip` option on `openPopoverAt`.** Clamping and flipping both keep the panel on screen; they
  differ in where the _point_ ends up. Clamping leaves it inside the box, which for a context menu
  pre-hovers the row under the cursor; flipping mirrors the box past the point, which is the desktop
  convention. Per axis, and a flip that would not fit falls back to clamping, so "the whole panel is
  on screen" stays unconditional.
- **`Tooltip.Trigger`'s `asChild`**, same contract as `core/Button`'s. The case is an app adding
  tooltips to controls it already has: wrapping an existing button would give the row two focus stops
  and break every selector addressing it.

### Changed

- **`Tooltip.Content` is positioned at all.** It is `popover="manual"` with no `commandfor`, so it has
  no implicit anchor — and forge shipped **zero** CSS for `[data-slot="tooltip-content"]`, so every
  tooltip rendered centred in the viewport. That was **unfixable from a consuming app**, because the
  anchor name did not exist to bind to. `theme-base.css` now declares `anchor-name` on the trigger,
  `anchor-scope` on the root so many tooltips on one page stay independent, and the four sides × three
  alignments, with flip fallbacks.

## [0.0.76] — 2026-08-01

Add a logging withLevels() feature

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

   **No `tailwind-merge`, now or later.** It resolves conflicts between class _strings_; conflicts
   between CSS _layers_ are invisible to it. It would add a runtime dependency and a per-render cost
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
  Triggers are resolved document-wide via `commandfor` and filtered on the command _verb_, so a
  `Menu.Item` or `Dialog.Close` naming the same target is not mistaken for one.
- **`buttonVariants`** is exported from `ui/core`, with a new **`square`** size
  (`w-full aspect-square p-0`). `icon` and `icon-sm` name a size in pixels; `square` names a
  _relationship_ — take the parent's width, be as tall as you are wide — which is the only form an
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
  component was never _visited_: its `setup` never ran, and nothing warned. That is most of what the
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
  names a placement _mode_, sibling to `data-placement`, not to `data-side`.
- Test counts: `bun test` 1931 → **1947** across 168 files; `bun run test:browser` 260 → **290**.

## [0.0.74] — 2026-08-01

Two structural changes to `@y-core/forge/ui`, cut early because they unblocked a consumer: the DOM
contract becomes an addressable namespace of its own, and forge's stylesheets become importable at
all. Contains a **breaking change** to the cascade position of every component rule — see below.

### ⚠️ Breaking Changes

1. **`theme-base.css`'s component rules are now inside `@layer components`.** They were unlayered,
   and unlayered CSS outranks _all_ layered CSS whatever the selector weight — so those rules beat
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
  to _address_ this DOM; without an export its only option was to re-type every name as a string
  literal, becoming a third writer of the same attribute in a repository forge's gate cannot see.
  The eight contract modules moved from `src/ui/*` into `src/ui/contracts/`.
- **`@y-core/forge/ui/assets/css/*.css`** — the stylesheets are addressable, via a subpath
  **pattern** so every real file in the directory is reachable rather than merely declared.
  **`forge.css`** is the one import an app needs (tokens _and_ generated rules); **`forge-show.css`**
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
  _declared_; an expanded pattern proves each real file is _reachable_. The absence of that second
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

1. **`ToggleGroup` no longer emits `role="toolbar"`.** It emitted that for _every_ group, which
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

3. **`Navbar`'s in-menu leaves are `Menu.LinkItem`, not `data-slot="navbar-link"`.** A link _on the
   bar_ still renders `<a data-slot="navbar-link">`; a link _inside a dropdown_ is now
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
- **A browser test set behind its own verb**, `bun run test:browser` (`bun run test:install`
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
  listeners on its own document, and one inside a web component reports the focused _item_ rather
  than the shadow host.

### Fixed

- **The `navbar` scope never ran.** It was registered lazily, and a lazy scope resumes on the first
  `data-on-*` interaction inside it — but the navbar's markup emits none at all (native `<details>`,
  native popovers, plain links). Runtime auth filtering therefore silently did nothing. It is now
  eager, as is every other setup-only scope.
- **`mountRovingFocus` was not nestable.** A parent menu's item ring included its _closed_ submenu's
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
   mountTurnstile(isDark, { onSuccess: "remove" });
   // after
   mountTurnstile();
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
   verifyTurnstile(formData, secret, { expectedHostname }, "cf-turnstile-response", remoteIp);
   verifyCsrfToken(keyOrRing, token, path, 3_600_000);
   // after (0.0.67)
   verifyTurnstile(formData, secret, { expectedHostname, tokenField: "cf-turnstile-response", remoteIp });
   verifyCsrfToken(keyOrRing, token, path, { maxAgeMs: 3_600_000 });
   ```

   `csrfProtection` now takes the named, exported `CsrfProtectionOptions` type (same shape).

2. **`Config` is constructed via `createConfig()` — the public constructor is gone.**

   ```ts
   // before
   import { Config } from "@y-core/forge/config";
   const cfg = new Config(map, schema, overrides);
   // after
   import { createConfig } from "@y-core/forge/config";
   const cfg = createConfig(map, schema, overrides);
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
   validate: (data) => (data.email ? { ok: true, data } : { ok: false, errors: ["email required"] });
   // after (0.0.66)
   validate: (data) => (data.email ? { ok: true, data } : { ok: false, error: ["email required"] });
   ```

   `onValidationError(errors, c)` still receives the message array — only the union field moved.

2. **`@y-core/forge/render` removed — import renderer from `@y-core/forge/jsx`.**
   The redundant `./render` subpath is gone; its symbols are (and were already) exported by `./jsx`.

   ```ts
   // before
   import { renderPage, renderToString, type FC } from "@y-core/forge/render";
   // after
   import { renderPage, renderToString, type FC } from "@y-core/forge/jsx";
   ```

3. **`csrfProtection` — `subject` is now required.**
   Pass a session/subject resolver, or the explicit greppable `subject: false` opt-out
   (path-only tokens). Omitting `subject` is now a compile error. Closes a token-fixation
   risk where a token bound only to a path was transferable between users.

   ```ts
   // before
   csrfProtection({ secret });
   // after — bind to the session…
   csrfProtection({ secret, subject: (c) => c.session?.id });
   // …or explicitly opt out
   csrfProtection({ secret, subject: false });
   ```

4. **Cloudflare header trust is now default-**distrust** (`trustCfHeaders`).**
   `requestId` no longer echoes client-supplied `CF-Ray`, and `rateLimit`'s default key no
   longer reads `CF-Connecting-IP`, unless you opt in. On Cloudflare Workers these headers
   are trustworthy, so **CF-deployed apps must opt in**:

   ```ts
   requestId({ trustCfHeaders: true });
   rateLimit({ limiter, trustCfHeaders: true }); // else the default key throws — or pass your own `key`
   applyMiddlewareChain(app, { ...opts, trustCfHeaders: true }); // threads to both
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
   });
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
- **JSX renderer:** attribute _names_ are now validated (unsafe keys from spreads are skipped);
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

[0.1.2]: https://github.com/y-core/forge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/y-core/forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/y-core/forge/compare/v0.0.91...v0.1.0
[0.0.91]: https://github.com/y-core/forge/compare/v0.0.90...v0.0.91
[0.0.90]: https://github.com/y-core/forge/compare/v0.0.89...v0.0.90
[0.0.89]: https://github.com/y-core/forge/compare/v0.0.88...v0.0.89
[0.0.88]: https://github.com/y-core/forge/compare/v0.0.87...v0.0.88
[0.0.87]: https://github.com/y-core/forge/compare/v0.0.86...v0.0.87
[0.0.86]: https://github.com/y-core/forge/compare/v0.0.85...v0.0.86
[0.0.85]: https://github.com/y-core/forge/compare/v0.0.84...v0.0.85
[0.0.84]: https://github.com/y-core/forge/compare/v0.0.83...v0.0.84
[0.0.83]: https://github.com/y-core/forge/compare/v0.0.82...v0.0.83
[0.0.82]: https://github.com/y-core/forge/compare/v0.0.81...v0.0.82
[0.0.81]: https://github.com/y-core/forge/compare/v0.0.80...v0.0.81
[0.0.80]: https://github.com/y-core/forge/compare/v0.0.79...v0.0.80
[0.0.79]: https://github.com/y-core/forge/compare/v0.0.78...v0.0.79
[0.0.78]: https://github.com/y-core/forge/compare/v0.0.77...v0.0.78
[0.0.77]: https://github.com/y-core/forge/compare/v0.0.76...v0.0.77
[0.0.76]: https://github.com/y-core/forge/compare/v0.0.75...v0.0.76
[0.0.75]: https://github.com/y-core/forge/compare/v0.0.74...v0.0.75
[0.0.74]: https://github.com/y-core/forge/compare/v0.0.73...v0.0.74
[0.0.73]: https://github.com/y-core/forge/compare/v0.0.68...v0.0.73
[0.0.68]: https://github.com/y-core/forge/compare/v0.0.67...v0.0.68
[0.0.67]: https://github.com/y-core/forge/compare/v0.0.66...v0.0.67
[0.0.66]: https://github.com/y-core/forge/compare/v0.0.65...v0.0.66
