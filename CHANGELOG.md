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
mapping.** `--border`, `--input` and `--ring` were documented as a single concern — *"separation,
control outlines, and the focus ring"* — and mapped accordingly: `--border` and `--input` were both
`--palette-400` in light and both `--palette-700` in dark. That is the correct value for a `Card`
edge and roughly **half** of what WCAG 1.4.11 requires of the only boundary a text field has. Every
control outline forge shipped sat at 2.36:1 in light and **1.70:1** in dark, against a 3:1 floor.
The light focus ring was worse: a 50%-alpha `color-mix` that composited to **1.63:1**, below the
border it was meant to replace, so focusing a field made its outline *fainter*.

The audit that followed — oklch → oklab → linear sRGB → WCAG relative luminance, worst case across
all five ramps in both modes — found the failures were systematic rather than local, and turned up
one **Level A** defect: `Slider` had no focus indicator at all. `appearance-none` removed the
platform's, and nothing replaced it.

**`--palette-*` is deleted rather than renamed.** The ramp existed only because the old semantic
layer needed something mode-agnostic to point at, and the step layer does that job — keeping both
would have left two indirections answering one question. Every declaration is gone from every
stylesheet forge ships.

**Tinted neutrals could not carry a scheme on their own, and that is a design-intent.** They are 
calibrated to sit *under* a saturated accent and only lean toward it; the accent carries the identity. 
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
  is for. See `MIGRATION.md`.

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
> under **Fixed** because the old default threw. Read the table, then look at a dark-mode form, then
> read [`MIGRATION.md`](MIGRATION.md).

- **`forge.css` now declares `@custom-variant dark (&:where(.dark, .dark *));` itself, and that is a
  takeover rather than a convenience.** The line was going to be this release's one required action;
  it is now forge's to declare, after the theme imports. An app that has already added it is
  unaffected — the declaration is identical and `@custom-variant` is last-declaration-wins, so the
  consumer's copy restates forge's. **The reconfiguration is not scoped to forge's utilities.** A
  custom variant is global, so this redefines `dark:` across the *consuming app's* stylesheet too,
  and an app deliberately keyed to `prefers-color-scheme` loses its automatic dark theme with no
  error and no unmatched class. The escape hatch is the same cascade rule that makes a consumer's
  own copy harmless — re-declare the variant *after* the import:

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
  walks. See [`MIGRATION.md`](MIGRATION.md).
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
  stylesheet is outside that gate. See [`MIGRATION.md`](MIGRATION.md).
- **`--input` and `--ring` are *lighter* than the values this release's audit first landed on.**
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
  would make a focused control *recede*.
- **There is no longer a `--palette-*` ramp to supply, and an app that supplied one is now
  supplying nothing.** This supersedes the previous instruction that a consumer must declare
  `--palette-50` … `--palette-950`. The eleven stops are deleted, not renamed: nothing in forge
  reads them, so a stylesheet still declaring a ramp compiles, renders forge's own scale, and gives
  no sign that the ramp is inert. The extension point moved down one layer and shrank — a theme now
  re-declares `--gray-1` … `--gray-12` (and their `--gray-a*` twins) in both blocks and nothing else,
  and `theme-slate.css` is the worked example of exactly that shape. A brand *hue* is a different
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
  See [`MIGRATION.md`](MIGRATION.md).
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

| Token | Mode | Was | Now | Ratio | Floor | Criterion |
|---|---|---|---|---|---|---|
| `--muted-foreground` | `:root` | `--palette-500` | `--gray-11` | 4.34 → **5.19** | 4.5 | 1.4.3 |
| `--muted-foreground` | `.dark` | `--palette-400` | `--gray-11` | 3.94 → **7.67** | 4.5 | 1.4.3 |
| `--input` | `:root` | `--palette-400` | `--gray-10` | 2.36 → **3.33** | 3 | 1.4.11 |
| `--input` | `.dark` | `--palette-700` | `--gray-10` | 1.70 → **3.76** | 3 | 1.4.11 |
| `--ring` | `:root` | 50% `color-mix` | `--gray-11` | 1.63 → **5.19** | 3 | 1.4.11 |
| `--ring` | `.dark` | `--palette-500` | `--gray-11` | 3.04 → **7.67** | 3 | 1.4.11 |
| `--track` | `:root` | *(was `--input`)* | `--gray-10` | **3.60** | 3 | 1.4.11 |
| `--track` | `.dark` | *(was `--input`)* | `--gray-10` | **4.46** | 3 | 1.4.11 |
| `--destructive` | `:root` | `--color-red-500` | `--red-9` = `red-700` | 4.33 → **5.63** | 4.5 | 1.4.3 |
| `--destructive` | `.dark` | `oklch(…)` = `red-400` | `--red-9` = `red-300` | 3.55 → **8.28** | 4.5 | 1.4.3 |
| `--destructive-foreground` | `:root` | *(did not exist)* | `--red-contrast` = `--gray-1` | **6.10** | 4.5 | 1.4.3 |
| `--destructive-foreground` | `.dark` | *(did not exist)* | `--red-contrast` = `--gray-1` | **9.83** | 4.5 | 1.4.3 |
| `--warning-foreground` | `:root` | `--palette-50` | `--yellow-contrast` = `--gray-12` | 1.83 → **8.51** | 4.5 | 1.4.3 |
| `--warning-foreground` | `.dark` | `--palette-950` | `--yellow-contrast` = `--gray-1` | **12.04** | 4.5 | 1.4.3 |

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

  | You imported | Do |
  |---|---|
  | `theme-neutral.css` | Drop the import — `forge.css` already imports it. Keeping it restates the default and changes nothing |
  | `theme-gray.css` | Keep it for the **cool** scheme, or drop it for the achromatic default. Same filename, entirely new values |
  | `theme-zinc.css` | Import `theme-stone.css`, or drop the import; zinc has no successor |
  | `theme-slate.css`, `theme-stone.css` | Keep the import; the values change |

- **`theme-zinc.css` carried a live WCAG failure to its grave, and it is the sharpest argument for
  the whole change.** Its dark `--warning-foreground` rendered near-white on `orange-500` at
  **2.77:1**, while the comment on the very next line claimed 6.83. The cause is not a bad value; it
  is a cascade race. `:root` and `.dark` both weigh 0-1-0, so source order decides between them —
  and `theme-zinc.css` was imported *after* `theme-base.css`, so zinc's `:root { --warning-foreground:
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
  class. Re-declare the eight tokens and the bridge aliases in your own stylesheet;
  [`MIGRATION.md`](MIGRATION.md) carries the block to paste.
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
  other is the generated ids: `idBase` falls back to the *resolved* placement, so `navbar-menu-top-*`
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
  `group/collapsible` → `group/collapsible-item`, and *that* half is silent: a consumer writing
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
  Forwarded *props* still land on the `<select>`, which is what a caller means by every native
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
  on a wrapper `<div>` outside the fragment. htmx sends the *triggering element's* own value on a
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
  right-click** — it flashed and vanished. `contextmenu` fires *between* `pointerdown` and
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
  unconditional guard would arm a listener that the *next* unrelated click fires. `once`, so a later
  click still light-dismisses the menu exactly as it always did.

  **No existing test caught it because the fixture had no stylesheet.** `showcase.browser.ts` mounted
  the context-menu demo without `theme-base.css`, so the coordinate rule never applied, the popup fell
  back to the UA's centred `[popover]` box — which lands *under* the pointer — and the release hit the
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
  request that boundary answers with a *page*, and HTMX swapped that page's body into the log table.
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
  that is already correct *before* the event they actually depend on. `showcase.browser.ts`'s
  post-swap revalidation case counted requests, which the interceptor records when the request reaches
  the route handler — before the response is fulfilled and long before htmx has swapped — so the
  second `fill` could land on an input about to be replaced, taking its pending `change` with it.
  `viewport-collapse.browser.ts`'s user-override case waited on `<details>.open`, which moves
  synchronously, while `mountViewportCollapse` tells its own writes from the user's by counting
  `toggle` events — and the HTML spec *coalesces* a pending toggle task, so a click landing before the
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
  once on `:root`, so it *computes there* — to a literal — and inherits as that literal; a descendant
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
  pinning the mapping the complete check with no colour arithmetic at run time. What it does *not*
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
  parent's layout — in a flex row it *is* the flex item — so width, `shrink` and border belong there
  rather than on a component nested two boxes further in. This is what makes the rail's layout
  expressible at all; see the Breaking entry and `forge-ui-nav-rail-flex-item`.
- **The composition band moved off the showcase catalog and onto the theme customiser.** The catalog
  proves each component exists; a generated scheme has to be judged against a *composed* UI, and the
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
merge was not, and the failure is silent in exactly the way that survives review: the class *is*
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
  *serialized attributes* rather than the props, so it parses byte-for-byte what the browser parses.
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
positioned `popover-content` and `toolbar-flyout` rested on a stated premise — *"a popover's implicit
anchor is the button named by `commandfor`"* — that is false. The implicit anchor comes from
`popovertarget`; the Invoker Commands API sets none, and `popovertarget` appears nowhere in forge
outside `src/jsx/types.ts`. **Every `anchor()` in that block resolved to nothing** and the UA's
`[popover]` default centred the panel. `menu-popup` was never in the block at all.

Measured on Chrome 151 rather than reasoned about: an invoker-opened popup computes `position-anchor:
normal` with `CSS.supports("top", "anchor(bottom)")` true. Two things let it survive review — no
browser spec loaded any CSS, and none asserted geometry, so the suite structurally could not see this
class of defect. Both are now fixed.

**Separately, `defineAction` stopped taking a validation step it could not check.** Its `parse` and
`validate` callbacks fixed the *order* two arbitrary functions ran in and nothing more — neither was
required to involve a schema, so `validate: (d) => ok(d)` compiled and was accepted, and a route
could declare a validation step that validated nothing. It now names a schema, and `handle` is
unreachable except through a passing `v.safeParse`. Forge reads the body itself, which is what let
the named-field readers go: they collapsed an absent field into `""` before any schema could observe
it. See **Breaking Changes**.

**The release also carries a follow-up review of the full source tree after 0.0.80,** written and
held back rather than shipped on its own. Four verified defects — plus a fifth found
while fixing the third — and every one of them is the same shape: work that was *started* and then
left outside the thing that keeps it alive. A purge outside the promise the isolate waits on. A
rejected import with no handler on it. Timers outliving their disposer. A promise that resolved on
an appended `<link>` rather than a loaded one. Each landed with tests that fail against the previous
code; where a test could not have observed the defect, the reason is given, because that is usually
the more useful half.

### Added

- **`strictObject(entries, message?)`** (`validation`) — the strict object schema to use for anything
  parsing untrusted input. Only a field the schema *actually declares* counts as declared, so an
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
  instead of silently halving the budget for line breaks. Its position relative to the trim is *not*
  observable — `trim` treats `\r` and `\n` alike, so the two orderings agree on output — and
  `src/validation/form-text.ts` records that rather than arguing for one. `formText()` deliberately
  **preserves** CRLF — that is what makes it the `<input>` variant.
- **`describeValidationIssue(issue)`** (`validation`) — names the field one issue is about and
  nothing else, bounded in path depth and in per-segment length. It reproduces no part of the
  submission (`issue.message`, `issue.input`) and no part of the schema (`issue.expected`), so a
  refusal varies only with *which* field failed. Use it for anything a caller reads;
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
  `LazyImportOptions`, so no barrel change and no existing call site changes. See *Fixed* for where
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
  per request. The matching *entries*-side half is `strictObject` (see **Added**) — the two are
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
  the *rows* cannot work: an open popup is in the top layer, where the resolution algorithm returns
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
  the next open, before the incoming trigger gains its own, and again on dispose. Holding *every*
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
  `load().then(onFulfilled, onRejected)` attaches the rejection handler as a *sibling* of the
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
  describe *whether* the purge runs and what it does with a failure; it had quietly come to also
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
  `observer.disconnect()` *before* `options.load()`, and the returned promise carried only a success
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
- **The Turnstile poll's paired timeout stayed pending after a *successful* poll.** Unreported,
  found while fixing the above: the success branch cleared the interval and nothing else, so the
  giving-up timeout — which had no work left to do — held the closure alive for the remainder of
  `TURNSTILE_SCRIPT_TIMEOUT_MS`. Both handles are now cleared together.
- **A concurrent `loadStylesheet` caller resolved before the stylesheet had loaded.** Idempotence
  was a `querySelector` for a matching `<link>`, and an appended link is findable *immediately* —
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
  branch sits in a `finally` — and a `finally` that throws *replaces* what was propagating, which
  meant a log failure could discard a successful response or mask the handler error being rethrown.

- **`MenuPopupProps["side"]` takes the whole `Side`,** which now spans eight values rather than four
  — see the `Side` entry below. `navbar`'s nested `Menu.Popup` passes `side='inline-end'`, so a
  submenu opens *beside* the panel that contains it rather than below it. The logical spelling rather
  than `right` because the panel's own edge is what "beside" means: in an RTL subtree that edge is its
  left, and the keyboard mirrors to match. The default is unchanged.

- **`Side` widened from four physical values to eight,** adding the logical `block-start`,
  `block-end`, `inline-start` and `inline-end` (`src/ui/contracts/state-attrs.ts`). Physical and
  logical spellings share one value space because they share one `data-side` attribute: the physical
  four are right wherever a popup must *not* mirror with the reader's direction, and the logical four
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

> **Upgrading a consuming app: read [`MIGRATION.md`](MIGRATION.md) as well as this section.** The
> entries below are the record of what changed; the guide is the procedure, and it covers the four
> breaks that are **silent** — an implicitly-optional schema field, a refusal whose status is
> unchanged but whose body is not, a dropped `v.safeParse` config, and a hand-rolled
> `Object.fromEntries` body read that is last-wins where the removed reader was first-wins. Each
> compiles clean, returns `200`, and behaves differently in production. It closes with an audit
> checklist of concrete greps.

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
    handle: async (data, c, config) => { /* … */ },
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
    handle: async (data, c, config) => { /* … */ },
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
  field is dropped *because* it was checked — so a route that does not name them gets neither the
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
  — which made hardening the *name* largely moot. **Breaking for a consumer selector or test
  asserting on that attribute**; there is no replacement, by design.

- **`readFields` and `readTextField` are removed from `@y-core/forge/form`.** Both returned `string`
  and never `string | undefined`, mapping an absent field, a `File` and a genuinely empty string onto
  one value — an absence collapse that happened *before* any schema could observe it, which is what
  made `v.optional` unreachable through them. `defineAction` reads the body itself now; a route
  outside that pipeline uses `parseFormData` and hands the entries to `v.safeParse` directly, which
  the `form` README shows. The namespace deliberately ships no named-field reader.

- **The `FormFieldReader` type is removed.** It was declared as
  `(formData: ReadonlyFormData, field: string) => string` and its only documented meaning was the
  shape of `readTextField`. Keeping it as a dependency-injection seam was considered and rejected: the
  signature returns `string`, so it *is* the absence-collapse above, and publishing it as the
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
  a loud refusal into a *successful wrong request*. Two runtime layers sit underneath and are named as
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
  `new Function`). Declined — and the absence is documented as *not* a guard, since the renderer has
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
  key into an array — *and* it sat under a `csrfProtection` middleware while parsing with a
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
  omitting the *required* `integrity` argument. §3b now states the real signatures, notes that
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
  *unconditionally* — including on `method="get"`, a value the public `method?: "get" | "post"`
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
    <Honeypot />          {/* ← add this; pass `field` if you previously set `honeypotField` */}
    {/* … */}
  </Form>;
  ```

- **`export type * from` is now banned in barrels.** `NAMESPACE_DESIGN.md` §1b banned `export *`
  and was silent on the type-only spelling, which the matcher could not see across the `type` token
  — and `barrel-parse.test.ts` *pinned it as allowed*. Erasure at emit removes only the
  circular-dependency harm; the surface leak and the ungreppable API remain, and a barrel of nothing
  but `export type *` previously failed as the misleading "no value exports found in barrel". There
  are **zero** occurrences in `src/`, so nothing inside forge changes; a consumer whose own barrels
  are checked by this script may now fail. Name the types.

- **Header-conflict precedence in `createSecurityHeaders` is now inner-wins, and is stated.** The
  middleware queued its headers *after* `await next()`, which made an overlapping header name
  resolve outer-wins. It now queues *before* `next()`, alongside the nonce, so a middleware
  registered deeper writes last and wins. Nothing inside forge overlaps — `createSecurityHeaders`
  owns its 8–9 names, `requestId` owns `x-request-id`, session and flash use `set-cookie` with
  `{ append: true }` — so only consumer middleware queuing one of those names is affected. **No
  test broke and no doc promised either direction**, which was the actual problem: the behaviour is
  now pinned by test and documented in `SECURITY_HARDENING.md` §2a and `ERROR_HANDLING.md` §5b.
  See *Fixed* for the gap the move closed on the way past.

- **`originProtection` now requires an app to list its own origin in `allowedOrigins`.** Previously
  a present `Sec-Fetch-Site` header caused an early return that skipped the `allowedOrigins` check
  **entirely**. Two things were wrong with that. `Sec-Fetch-Site` is a forbidden header name, so a
  *browser* cannot be tricked into sending a false `same-origin` — but a non-browser client sets
  whatever it likes, and one forged header was enough to walk past the allowlist. It also put this
  tier in standing disagreement with its sibling `originGuard`, which enforces the allowlist
  unconditionally. The header is now a **veto, not a pass**: a bad value still rejects outright, but
  a good one no longer short-circuits anything. `allowedOrigins` is consulted on every mutating
  request carrying an `Origin` or `Referer`; only when both are absent does the guard fall back to
  the browser's vouching, and with no signal at all it fails closed. **This will break deployments
  that relied on the early return** — add your own origin to `allowedOrigins`.
- **`Sec-Fetch-Site: same-site` is now rejected.** The check was a denylist naming only
  `cross-site`, so `same-site` passed — and *any* sibling subdomain produces `same-site`. A single
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
  and dispatches them for *every* method. Filtering with `{method:"POST"}` used a strict `===` and
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
  `defineAction` and `csrfProtection` accept `maxBytes`. See *Fixed* for why one without the other
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
  indexes exist; `WITHOUT ROWID` appends the id to every index entry and comes out *larger* past a
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
- **`Honeypot`** (`@y-core/forge/ui/core`) — the decoy field extracted out of `Form`; see *Breaking
  Changes*. Takes an optional `field` defaulting to `HONEYPOT_FIELD_DEFAULT`.
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
  flushes *before* the app's error boundary writes its `unhandled error` record, and `flush()`
  **splices** the pending buffer — so the boundary's record landed in a buffer nobody awaited. With
  the synchronous channel the tests use, both records are captured and everything looks fine; with a
  real asynchronous `kvLogChannel`, the boundary's record **may never persist before isolate
  teardown**. Production therefore saw two records *or* one-plus-a-lost-one, nondeterministically.
  The boundary now schedules its own flush at the point of write, so both records sit inside an
  awaited window on both throw paths. The suite was structurally incapable of observing this; the
  regression tests use an asynchronous channel fixture, which is the only kind that can. The two
  records are still not deduplicated — they are distinguishable by `message`.
- **`closestAcross` and `contains` threw a `TypeError` on a detached subtree.** Both read
  `getRootNode().host` with no `nodeType === 11` guard — the defect fixed at one of the three sites
  in 0.0.80 and left at the other two, and `contains` was not recorded anywhere. For a detached
  subtree `getRootNode()` returns the topmost ancestor *element*; on an `<a href>` that is the URL's
  host string, and the next hop calls a method on a string. A **relative** `href` is no safer, which
  is the non-obvious half: a detached anchor resolves it against the document base URL, so `host` is
  the page's own origin rather than `""`. Both are public API. All three reads now go through one
  private `shadowHost` helper so they cannot drift again.
- **An `effect()` whose first run read a signal and then threw poisoned that signal permanently.**
  The disposer is the return value, so a throw means the caller never receives it — and the first
  run's own `cleanup` is a no-op, because `deps` is still empty when it runs. The dead node
  therefore stayed in the signal's `subs` with nothing able to remove it, and **every** later write
  to that signal re-entered it and rethrew out of the *setter*, at an arbitrary unrelated call site,
  for the signal's lifetime. `effect()` still throws — callers may rely on that — but now
  unsubscribes first, so a failed effect leaves no residue. The existing "does not stay installed"
  test could not catch this: its throwing body read no signal, so it never subscribed.
- **`CheckboxGroup` and `RadioGroup` emitted a dangling `aria-describedby`,** unconditionally
  naming a description element that renders only when the consumer supplies one — the exact defect
  fixed in `field.tsx` in 0.0.80 and not fixed in these two. A dangling IDREF is not ignored by
  assistive technology; it is reported as an error. **This shipped on the component showcase**,
  which renders both groups with no `Description` child. Separately, `itemId()` did not thread the
  `scope` param, so *every item id* — not just the description id — collided across two same-named
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
  `referrer-policy`. Queuing before `next()` (see *Breaking Changes*) fixes this as a side effect;
  it is pinned by its own test.
- **`makeKVStub` in `store.test.ts` handed out the stored `ArrayBuffer` by reference,** so
  `bytesCodec().decode` wrapped it in a writable *view* onto the stub and mutating a retrieved value
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
  kept, because `createSecurityHeaders` queues its headers *after* `await next()`, so a boundary
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
  them. Substituting *in place* means every ASCII character survives with no filename parsing at
  all, so the extension is preserved: `年度報告.pdf` → `_.pdf`, `invoice-年度.pdf` →
  `invoice-_.pdf`.
- **The Switch has never animated its thumb.** `peer-*` compiles to a **general-sibling**
  combinator, so it reaches only siblings of the input. The track is one and painted correctly; the
  thumb is a *child of the track*, so `peer-checked:translate-x-4` matched nothing — in any release.
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
  *currently open path*, so a repeated sibling reference survives and only true ancestors become
  `"[circular]"` — the previous implementation was unbounded on a cycle.
- **`?level=` was cast straight to `LogLevel`** with no validation, and echoed back into the rendered
  filter bar. It is now validated at the boundary with the `v` facade. An invalid value **drops the
  filter and renders unfiltered** rather than erroring: the level filter *narrows* a row set the
  caller was already authorised to read in full, so it is not an authorization input, and a 400
  would turn a stale bookmark into a broken admin page for no security gain.
- **"Load more" destroyed the rows already loaded** and dropped the active `level` / `q` filters. It
  `outerHTML`-swapped the whole tbody; it now replaces only its own `<tr>` and carries the filters
  into the next-page URL. (`beforeend` is wrong here: the control lives *inside* the tbody it would
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
  *well-documented* export was checked **less** than a sparse one. The window is now the TSDoc
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
  module-level mutable state, and its rationale, are both scoped to *request-scoped* data under
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
  Everything in that module which carries *type* information is derivable from config — the manifest
  keys and the sprite symbol ids that give `createIcon` its icon-name union — so a clean checkout can
  typecheck and run tests against a module no consumer commits. Only the values need a real build:
  emitted paths are the unhashed logical names and every `viewBox` is empty, and the artifact carries
  a distinct `TYPES ONLY` banner saying so, because the two artifacts are shape-identical and nothing
  else in the file distinguishes them. Both paths emit through the same function as `buildAll`, so
  they cannot drift in shape. The command is a sibling of `sprites` rather than a child of `build`,
  since it builds nothing.

### Documentation

- **`LIBRARY_ARCHITECTURE.md` §3d states where CSS source scanning stops.** Tailwind never scans
  `node_modules`, so shipping raw source ships no *rules* — a class with no rule renders as an
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
  forge those 22 utilities are *written*; `core/menu.tsx` reads it as `const ITEM_BASE =
  MENU_ITEM_CLASS`, an identifier Tailwind's textual scan cannot see through. The consequence was
  wider than the constant's stated purpose suggests: **forge's own SSR `Menu.Item` lost the rules
  too**, not merely a client-built row, and with it every consumer of `core/Menu`.
  What kept it invisible is that the failure was *partial*. Most of the 22 are ordinary enough that
  unrelated scanned components — `core/popover.tsx`, `core/dialog.tsx`, `core/button.tsx` — emit
  them incidentally, so a menu still looked broadly right; only the five nothing else happened to
  use fell through, and they were `text-left` plus the `focus-visible:` and `aria-disabled:`
  affordances, i.e. exactly the keyboard-focus and disabled states a casual glance does not check.
  A stylesheet that *mostly* works is harder to notice than one that does not.
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
  asserting the *computed* display rather than a class — every one of the 25 existing cases read
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
  differ in where the *point* ends up. Clamping leaves it inside the box, which for a context menu
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
