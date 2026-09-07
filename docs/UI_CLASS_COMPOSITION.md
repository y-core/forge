---
title: UI Class Composition
description: "The cn and cva class utilities, the conflict table and its derivation, the @utility recipe layer, and the contract a colour scheme file is declared against."
---

# UI Class Composition

> Owns how a class list is composed and how it resolves: the `cn` / `cva` utilities, the conflict
> table they read and the design system it is derived from, the `@utility` recipe layer, and the
> contract a colour scheme file is declared against.
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the `ui/core` component contract
> these classes land on, and for the caller-wins guarantee this document's precedence rules deliver;
> [`THEME_GENERATION.md`](./THEME_GENERATION.md) for the dials a scheme file is generated from and
> the contrast audit it reports against; [`UI_DESIGN_GUIDANCE.md`](./UI_DESIGN_GUIDANCE.md) for which
> utility a page should reach for; `src/ui/README.md` for worked call-site examples.

---

## 0. Quick Reference

- §1 Class Utilities: ratified public composition helpers
- §1a Conflict Resolution, the Fail-Open Boundary, and the Memo: what the resolver decides, where it stops, the ratified inversion, and the cache that replaced the no-cache ruling
- §1b Class Order Is Not Load-Bearing Within a Literal: the fixed-point invariant the gate enforces, and what a sorter cannot reach
- §1c The Table Is Derived From the Compiled Design System: the generator, the drift gate, the scale probe and its agreement condition, the equal-reach throw
- §1d A Narrower Later Utility Layers Rather Than Displaces: why `text-size-hero` and `text-size-[20px]` both survive
- §1e The `@utility` Recipe Layer: one name per state or chrome recipe, why it is a utility and not a class, the subset-group argument rule, the admission test that rules out a paint recipe, and the `--tone` mechanism
- §1f Which Utility Composes a Class, and In What Order: the four-point rule over `const`, `cva` and `cn`, and why the caller's class is last
- §2 Colour Scheme Declaration Contract: one declaration site per step, and what selects between the modes
- §2a OKLCh Solids: why a scheme's steps are written in the space the ramps are authored in
- §2b The Rejected Wide-Gamut Branch: why a second set of values would outrun the contrast audit
- §2c Status Hues Are Forge's: which colour roles an app may re-point, and which carry meaning
- §2d The dark: Variant Is Class-Driven: the takeover a consumer stylesheet inherits
- §2e A Consumer Rule Loses by Layer: why the remedy is a layer and never specificity
- §2f Scale Tokens Are Namespaced Away From Colour: the reserved `--text-size-*` spelling, and what it fixes

---

## 1. Class Utilities

`cn` and `cva` are **ratified `@public` utilities** — apps compose classes with them exactly as
forge's own components do.

### 1a. Conflict Resolution, the Fail-Open Boundary, and the Memo

**Conflict resolution is a table lookup, and the table is `src/ui/core/utils/class-groups.ts`** —
a utility mapped to the CSS concern it sets, with `cn` keeping the last utility to claim a concern.
The file is `@internal` and absent from every barrel, being data rather than API, and it is
**authoritative over any prose describing forge's covered utility surface**: a second copy of a
table is indistinguishable from an amendment the moment the two disagree. A utility's **modifier
prefix** and its **importance marker** both belong to the key, so `hover:h-5` never displaces
`h-full`.

**The coverage boundary.** The table covers every utility the stylesheet compiles to (§1c) and
nothing beyond it. A consumer's own theme name, a utility from a Tailwind release newer than that
compile, and a bespoke class alike pass through untouched, so two conflicting utilities from an
uncovered family are _both_ emitted and stylesheet order decides — the behaviour every consumer had
before conflict resolution existed. An uncovered family is a gap, not a regression — and not the
only way the table is wrong about an app's own theme, §2f being the other.

**Fail-open, and the inversion is deliberate.** An unrecognised utility is always kept, inverting
the fail-closed posture of [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §5a. The reasoning is
specific to this seam and does not generalise: the "failure" is forge's incomplete knowledge of a
third-party utility vocabulary rather than untrusted input, and there is no security boundary, since
`cn` produces a `class` attribute the renderer escapes anyway ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1a). Failing closed would silently
delete a consumer's own class or a utility from a newer Tailwind, with no fix available from outside
forge; failing open's worst case is the status quo ante.

**Importance is kept, diverging from the design reference.** A later _normal_ utility cannot displace
an earlier _important_ one, so `cn("h-full!", "h-5")` keeps both, where tailwind-merge strips
importance and drops the first. That is wrong at the cascade — `!important` wins regardless of source
order — so deleting the important utility changes what renders.

**Closed value spaces are matched by exact whole-utility entry; only open ones are matched by
prefix.** The reason is false positives: a `select-` prefix entry would let a consumer's
`select-wrapper` claim the user-select concern and silently delete a real `select-none`. A value
space that can be enumerated is enumerated.

**The ratified decision is an in-house resolver, with tailwind-merge as a design reference only.**
A Workers library pays a runtime dependency's cost into every consumer bundle and again per render
on the SSR path, against a general-purpose Tailwind parser almost none of which forge needs. The
in-house table is tractable precisely because forge is a fixed set of primitives.

**`cn` memoises, and the cache is cleared whole rather than evicted by age.** The resolver body is
the private `resolve(joined)`; `cn` joins its arguments, looks the joined string up in a module
`Map`, and calls `resolve` only on a miss. `CACHE_LIMIT` is 512, and a full map is **cleared
entirely**. Measured on one machine, pre- and post-change in a single process, so the pair is
internally comparable:

| call | prior | memo |
| --- | --- | --- |
| `cn(base)` repeated, 18-token base | 8.04 µs | 0.058 µs |
| `cn(base, "px-8")` repeated | 10.24 µs | 0.118 µs |
| `cn(base)`, distinct keys — always a miss | 10.13 µs | 10.48 µs |
| `cn(base, "px-8")`, distinct keys | 10.42 µs | 10.05 µs |

A hit is 87–138× cheaper and the miss path is unchanged within noise. Against 188 non-test call
sites, a page of ~200 elements spent on the order of 1.5 ms of Worker CPU in `cn` alone, recomputed
identically every request. **This overturns the prior no-cache ruling**, which reasoned that
Cloudflare evicts isolates often enough that a cold refill is paid rather than amortised: an isolate
serves many requests before eviction, and a miss costs exactly what an unmemoised call costs.

**Clear-on-full rather than LRU, because an LRU's per-hit bookkeeping is a material fraction of a
0.06–0.12 µs hit.** A whole-map reset is O(1) amortised and needs no ordering structure, and 512
comfortably exceeds the distinct class strings one page produces, so a full map is the rare case.
**The key is the joined string, not the argument list**, so `cn("p-4 p-8")` and `cn("p-4", "p-8")`
share one entry — sound, because `resolve` reads only the joined string.

**Reconciled with [`CODE_RULES.md`](../warden/canon/libs/CODE_RULES.md) §1, not exempted from it.** §1
forbids state that carries across requests _observably_, and nothing but `cn` reads this map: no
enumeration path, no export, no API reporting whether a string was cached. Stated rather than left to
be discovered, because the shape invites the question — **entries are class strings that may derive
from consumer props, and they do outlive the request that produced them**. What makes that acceptable
is that no read path leads out of the map, and a memo of a pure function returns what recomputation
would. Logs stay governed by [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md)'s no-PII rule; the cache
adds no log surface.

### 1b. Class Order Is Not Load-Bearing Within a Literal

**The invariant: every class literal is a fixed point of `cn`.** For any literal `L`,
`cn(L) === L`. Equivalently, no two tokens in one literal claim the same conflict group. A literal
that breaks it already contains dead code — one of the two tokens is dropped at render — so the
rule costs nothing and buys everything below.

**The gate enforces it; this paragraph does not.** `validate-class-order` judges class positions
with the real `cn`, imported rather than reimplemented, for the reason §1a gives about a second copy
of the table. It ships to consuming apps, so an app gets the same guarantee against the same
resolver. It judges _position_ only; whether a token names anything the design system compiles is
`validate-class-tokens`, which owns its own rules (`class-tokens.ts`) as a derived check does.

**The positions it reaches are the ones the formatter sorts**, which is what makes the two agree: a
quoted `class`/`className` attribute; an expression container, whose string literals — both branches
of a ternary among them — are each judged, and whose template literals are judged one chunk at a
time, split at every `${…}`, because that chunk is the unit a sorter reorders; and the argument span
of a `cn` or `cva` call, wrapped across lines or nested inside a container. A `//`- or
block-commented literal is dead code and is not judged. **One carve-out:** a span whose brackets do
not balance is skipped rather than guessed at — a fabricated literal would fail the gate on source
that does not exist.

**What that buys: the formatter may sort classes**, holding forge's literals in Tailwind's canonical
order. A sorter **reorders tokens within one literal and never moves a token between literals**, so
under the invariant sorting is provably output-preserving. It must be pointed at the same stylesheet
an app compiles, `src/ui/assets/css/tailwind.css`; given only upstream Tailwind it treats every forge
token utility as unknown and hoists it to the head of its literal.

**The agreement rests on three lists naming the same callees**, and they do: `sortTailwindcss.functions`
in `.oxfmtrc.json`, `CLASS_CALLEES` in `src/tooling/lint/ast.ts`, and the call spans
`design-parse.ts` reads are each exactly `cn` and `cva`. They were not always equal — the formatter
sorted two callees while the gate judged three, so an `asClass` span was gate-checked in an order no
sorter maintained.

**What sorting cannot touch, and this is the consumer-facing guarantee:** cross-argument precedence,
so in `cn(BASE, cls)` the caller still wins; and `cva`'s `base → variants → matching compounds → class` layering,
which is composition order rather than token order inside any one string. An app formatting its own
tree with forge's `.oxfmtrc.json` keeps both.

**Only literals in a class position are sorted.** A bare `const FOO = "…"` sits in no such
position, so forge's own class consts are wrapped — `const INPUT_BASE = cn("…")` — which reaches
them with a call the invariant proves is the identity. Two files cannot be wrapped, because reaching
`cn` would close a namespace cycle; their literals are unsorted and unreachable by any sorter, which
is exactly why they are also unbreakable by one.

### 1c. The Table Is Derived From the Compiled Design System

**The table is generated, not authored.** `gen:class-groups` compiles
`src/ui/assets/css/tailwind.css` to a Tailwind design system, asks it what each utility actually
writes, and renders `class-groups.ts` from the answers — so the table states what Tailwind states
rather than a hand-written approximation of it. `src/tooling/gate/checks/class-groups-parse.ts` is
the derivation, and is authoritative over what it authors rather than derives — the signature rule
and the shorthand closure immediately below.

**A group id is the CSS signature a utility writes: the `--tw-*` custom properties it sets when it
sets any, and its ordinary CSS properties otherwise.** Variables take precedence because `ring-2`
and `shadow-md` both write `box-shadow` and must not conflict; the variables are what tell them
apart.

**`GROUP_OVERRIDES` names which of those signatures a CSS shorthand swallows**, property identity
being unable to see that `padding` hides `padding-left`. That closure is CSS-standard fact rather
than a Tailwind one, so — unlike everything else in the table — it does not move when Tailwind
ships a minor. Its edges run one way: accepting a shorthand marks its longhands consumed, never the
reverse.

**Merging `sr-only` with `not-sr-only` into one group is forge's ruling, not a fact the design
system states** — Tailwind gives the two different signatures. Their shared id is therefore not a
CSS signature at all, so it takes part in no shorthand closure and carries no override edge.

**The rendered module interns value sets and not group ids.** The `mask-*` roots share one long
list of named values between them, so interning it removes a real repetition; a group id is its own
documentation at the point of use, and gzip already collapses the repetition an index would.

**`validate-class-groups` regenerates the table and fails the gate on any difference**, so a
`tailwindcss` release that moves the ground truth is reported rather than silently absorbed, and a
hand edit to the generated file fails the same way. It runs wherever the optional `tailwindcss` peer
resolves — skipped below the `full` tier, failed by a full run ([`TESTING.md`](./TESTING.md) §6).

**The class list is not authoritative for a root's named values.** `getClassList()` enumerates a
value scale for `left`, `right` and `inset-s` but nothing for `start` and `end` beyond three
statics — which is the whole reason `start-*` and `end-*` once failed to merge against each other
at all. A root the class list leaves with no enumerated named value is therefore asked the design
system directly, with `${root}-0` and `${root}-4`, **and gains a named group only when both probes
agree.**

**The agreement condition is what keeps the probe honest, and it is not optional.** Deriving a
named group from the statics instead handed `cursor` one, breaking the pinned ruling that
`classGroup("cursor-brand")` stays `undefined` so a consumer's bespoke class survives (§1a). A root
that genuinely takes a scale value answers both probes the same way; a root whose names are keywords
compiles nothing for either and is left alone.

**Two groups reaching exactly the same properties is a derivation-time throw, not a silent
no-edge.** Equal reach is never a legitimate table state, and a proper-subset check would emit no
edge and leave the ambiguity invisible — surfacing later as `cn` dropping both classes at runtime
depending on argument order. Throwing surfaces it as a named `validate-class-groups` failure
instead, which is how the derivation already treats its other two ambiguity conditions.

### 1d. A Narrower Later Utility Layers Rather Than Displaces

**`cn("text-size-hero", "text-size-[20px]")` keeps both, by design.** The named form writes
`font-size` and `line-height`; the arbitrary form writes only `font-size`. The later utility is
therefore strictly narrower than the earlier one, and an override edge runs from the wider group to
the narrower and not back (§1c), so it layers over it — exactly as `cn("p-4", "px-2")` does. The
reverse order does collapse, the wider group covering the narrower.

This is the resolver working, not a gap in it. Reading it as a defect leads to an edge that would
make `cn("p-4", "px-2")` drop the padding a caller asked for.

### 1e. The `@utility` Recipe Layer

**A state or chrome recipe every component needs is declared once, as an `@utility` in `forge-ui.css`, and
spelled nowhere else.** The focus ring was written four ways across twenty-seven call sites and the disabled
paint five ways before this layer existed, and the spellings had drifted: one component ringed at 20% alpha,
another at full, a third never cleared the outline. The recipes are `focus-ring`, `focus-ring-outset`,
`state-disabled`, `state-invalid`, `state-busy`, `field-chrome`, `border-field`, `otp-cells` and
`otp-editor`; `forge-ui.css`'s header is authoritative over what each one paints.

**Why an `@utility` rather than a component class.** A Tailwind utility is something `cn` can reason
about: the derivation (§1c) reads each recipe's compiled signature, so `field-chrome` gets override
edges to `h-*`, `rounded-*`, `border-*` and `px-*`, and a caller's `rounded-lg` after it still wins —
the relationship [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1c promises for every component default. A class in the `components` layer would be
invisible to the resolver, making the caller's utility fight the cascade instead.

**`focus-ring` reaches a wrapped control through `:has()`.** `Toggle`, `Switch` and `ToggleGroup.Item`
put the focus on a visually hidden input inside a label, and `&:has(:focus-visible)` paints the label,
so the recipe covers the focused element and its wrapper alike. The one spelling it cannot reach is a
_sibling_ — `Switch`'s track is not an ancestor of its input — which keeps `peer-focus-visible:ring-2`
on that track alone, with a one-line reason at the site.

**`state-disabled`, `state-invalid` and `state-busy` reach it the same way, and all three must** — a state
prop landing on a hidden inner control while the recipe sits on the wrapping label is the ordinary shape
here, not the exception. `state-busy` shipped without the branch once, and `<Switch busy>` and
`<Toggle busy>` were silently inert for as long as it did. A new state recipe carries it from the start.

**A state recipe is keyed into a slot of its own, which no Tailwind utility can reach.** The five that
paint nothing in the base state — `focus-ring`, `focus-ring-outset`, `state-busy`, `state-disabled`,
`state-invalid` — take the group `forge:<name>` rather than their compiled signature. `config/steps.ts`
names them through `FORGE_STATE_RECIPES`; `reach()` finds no CSS property in such a key, so no override
edge is derived into or out of one either.

**The signature this replaces was wrong in both directions.** `signature()` prefers a utility's `--tw-*`
variables over the CSS properties it also sets, so `state-invalid` — `border-color` _and_ `--tw-ring-color` —
collapsed to the group every `ring-*` takes, and since a caller's `class` is always last under last-wins `cn`,
`<Input class="ring-primary">` shipped a control announcing `aria-invalid` while looking valid; the reverse held
too, `state-busy`'s group subsuming a caller's `cursor-wait`. Neither is a real conflict — a recipe painting only
under `&[aria-invalid]` cannot contend with one that paints unconditionally. **A state recipe therefore travels
as one token of the base literal, never as a second `cn` argument**: slot-keyed, it contends with nothing, so its
own argument buys no separation. What earns one is a base-scope token that does contend — `slider.tsx` and
`toggle.tsx` pass `cursor-pointer` alone because `state-busy` paints `cursor: progress`.

**The four paint recipes keep their compiled signature, deliberately.** `border-field`, `field-chrome`,
`otp-cells` and `otp-editor` declare their whole payload at base scope, so a consumer's later
`rounded-lg`, `h-auto` or `w-20` should win — the override [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1c promises. A **paint** recipe would still
be wrong as an `@utility`: a pressed toggle's `background-color` is exactly what its resting state sets,
so a `state-pressed` would delete the `bg-transparent` beside it. **What works there is a shared class
const** passed as its own `cn` argument (`PRESSED_PAINT`), since each token then keeps its own scope.
Every signature and scope is pinned in `src/tooling/gate/checks/state-recipes.test.ts`.

**`--tone` is a companion mechanism, not an `@utility`.** `toneVariants` in `src/ui/core/utils/tone.ts`
sets six custom properties per tone (`--tone`, `--tone-fg`, `--tone-text`, `--tone-soft`,
`--tone-soft-fg`, `--tone-soft-border`) and one recipe per appearance reads them, so five recipes cover
thirty-five cells. Each property is its own `cn` conflict group (`arb:--tone`), which is what lets a caller
re-tone a component by passing `[--tone:…]` after it. Every cell is measured against the 1.4.3 floor in
`tone.browser.ts`, and the `warning` tone's text property deliberately reads its step-11 rather than its
fill because the fill does not clear it — [`THEME_GENERATION.md`](./THEME_GENERATION.md) §3a owns the
audited pairs behind each property.

### 1f. Which Utility Composes a Class, and In What Order

**Four ratified points deciding which of `const`, `cva` and `cn` a class expression uses**;
`src/ui/README.md` owns the worked call-site examples.

**A class string that never varies is a module-scope `const`, not a `cn` call at render** — resolved
once at load rather than once per element, and named for every call site that shares it.
`src/ui/core/utils/recipes.ts` (`PANEL_HEADER`, `FIELD_SIZE`, …) is the pattern.

**Variant axes belong in `cva`, and the caller's class goes in the resolver's own `class` slot** —
`buttonVariants({ tone, size, class: cls })`, never `cn(buttonVariants({ tone, size }), cls)`. A
`cva` resolver already ends in `cn` (`src/ui/core/utils/cva.ts`), so the outer call is a second
resolution pass over a settled string, buying the precedence the resolver already gives `class`.

**`cn` is for combining two or more independent sources** — a base plus a caller's class, a base plus
a conditional fragment, a resolver plus a non-variant class — **or for resolving conflicts inside one
string.** A single-argument `cn` is not a no-op: `cn("p-4 p-8")` returns `"p-8"`, so wrapping one
string is meaningful wherever it may carry a conflict, which is why `icon.tsx` and `form.tsx` keep
theirs (§1b gives the other reason a lone `cn` earns its place — it puts a bare const in a class
position a sorter can reach).

**The caller's class is always the last argument**, which is the whole of the caller-wins guarantee
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1c promises: `cn` keeps the last utility to claim a conflict group (§1a), and `cva` appends `class`
after base, variants and compounds. Placed earlier it loses to the component's own defaults, silently
and only for the utilities that happen to collide.

---

## 2. Colour Scheme Declaration Contract

**A scheme file declares each role step exactly once, and no forge stylesheet declares a custom
property under `.dark`.** A step whose value differs by mode is written with `light-dark()`, and the
branch is selected by `color-scheme`, which `theme-base.css` sets on the light and dark roots.

The rule is about declaration _sites_, not the selector, which is why it is stated that way and not
as "no `.dark` block": `theme-base.css` sets `color-scheme: dark` under `.dark`, which carries no
value a consumer's own scheme could half-supply. The gate enforces exactly that shape — a `.dark`
rule declaring no custom property passes.

**The two-block form is what this refuses** — the same steps under `:root`, then again under
`.dark` — because it cannot be supplied safely. Both selectors weigh 0-1-0 and both match the
document element, so source order decides, and a consumer's scheme is imported after forge's own. A
consumer supplying only the `:root` half beats forge's dark half and leaks light values into dark
mode with no error: light mode looks correct, and the defect is visible only to a reader already on
the dark theme. **A documented requirement that fails silently is a design defect rather than a
documentation gap.**

`color-scheme` is declared in `theme-base.css` rather than in the scheme files, so a scheme carries
colour and nothing structural: the scheme is the file a consumer replaces, and the mode wiring is the
file they do not. Declaring it also hands the mode to the user agent, so the UA-rendered controls
forge cannot paint follow the theme rather than contradicting it.

The generator that produces such a file — its dials, its pipeline, and the contrast audit it reports
against — is [`THEME_GENERATION.md`](./THEME_GENERATION.md)'s. **A generated scheme is
standalone-complete**: the customiser emits every property a scheme owns, because a file that is
correct only when layered over forge's default is the same silent half-supply in a different shape.

**The degradation is accepted rather than mitigated.** A browser without `light-dark()` holds the
declaration as an uninterpretable token stream, so the page loses its colours rather than falling
back to one mode. `light-dark()` is Baseline, and forge owes no compatibility shim before its first
stable release.

### 2a. OKLCh Solids

**A step is written in OKLCh**, the space its value was produced in.

The ramps in `src/ui/contracts/theme/color.ts` are authored in OKLCh, so it is the scheme's own space
and hex was a lossy render of it. Writing that space into the file makes a scheme legible and
hand-editable: shifting the hue of every step becomes a substitution rather than a regeneration. It
costs the contrast gate nothing, because the resolver already reads `oklch()`.

**The emitted OKLCh is gamut-mapped, never the raw ramp coordinate.** Chroma is reduced at constant
lightness and hue until the colour is representable in sRGB, and the reduced coordinates are what the
file carries. A raw coordinate outside sRGB renders wider on a display that can show it, and the
audited ratio would then describe a colour that reader never sees.

### 2b. The Rejected Wide-Gamut Branch

**No scheme ships a `display-p3` branch**, because the wide-gamut values a feature query would carry
are not the values forge audits. WCAG relative luminance is defined over sRGB, so a second set of
values behind a feature query is a second theme the gate does not walk and cannot measure, leaving
every pinned ratio describing the fallback alone. The gain is a slightly more saturated accent on a
wide-gamut display; the cost is that forge's accessibility claims would hold only for a branch that
reader does not receive.

The same test rejects the per-scale surface, indicator, and track properties a wider palette library
declares: forge resolves those through its semantic layer, and a step nothing reads is surface a
consumer can come to depend on before any component justifies it.

### 2c. Status Hues Are Forge's; Brand Fills Are the App's

**`--status-*` is deliberately separate from `--destructive` / `--success` / `--warning`, and the
split is an ownership one.** The latter are fills an app owns and may re-point at its brand; the
status hues are forge's, so a failure panel keeps meaning "failed" whatever `--destructive` has been
pointed at. An app that means to change what "failed" _looks like_ re-points the underlying step,
not the semantic alias.

### 2d. The dark: Variant Is Class-Driven, and That Is a Takeover

**`forge.css` redefines Tailwind's `dark:` variant to follow the theme class rather than
`prefers-color-scheme`,** because otherwise a `dark:` utility follows the _operating system_ while
every forge token follows the _user's choice_ — and the two disagree the moment someone picks a
theme that is not `system`.

**It reconfigures a consumer's own `dark:` utilities too, and nothing catches that**: forge has no
Tailwind dependency, so no gate here ever compiles CSS. Stating the takeover is the obligation this
section carries — the escape hatch is the cascade, since `@custom-variant` is last-declaration-wins.

### 2e. A Consumer Rule Loses by Layer, Not by Selector

**Every rule in `forge-ui.css` sits in `@layer components`, so a utility passed at a call site wins
over a component default** — which is what makes `class` on a forge component behave as it reads.
The consequence runs the other way too: a rule an app puts in `@layer components` is outranked by
every forge utility in `@layer utilities`, whatever its specificity. **The remedy is a layer, not a
selector** — one declared after `utilities`. Reaching for higher specificity instead appears to work
until the next utility is added.

### 2f. Scale Tokens Are Namespaced Away From Colour

**A theme token whose value is a scale step is declared in a namespace no colour utility reads. A
font-size step is `--text-size-*`, never a bare `--text-*`** — so its concern is legible from its
name, to a reader and to a table alike.

Tailwind's `--text-*` namespace carries font size while the `text-*` utility also carries colour, so
`--text-hero` and `--color-hero` produce the same class name. A conflict table cannot tell them
apart, guesses colour — what nearly every unenumerated name under `text-` is — and drops the other:
`cn("text-hero text-red-500")` returns `text-red-500` alone, in a consuming app's markup, silently.

**Forge cannot close this from its own stylesheet, which is why the answer is a namespace and not a
heuristic.** The table is derived from what `tailwind.css` compiles to (§1c), and an app's theme is not in
that compile; a discriminator inside `cn` would be forge encoding a guess about someone else's
naming. Forge reserves one root instead: `text-size` resolves to the size group the design system
itself states, so the conforming spelling merges against `text-2xl` and coexists with
`text-red-500`. A non-conforming token keeps §1a's behaviour, unchanged and still silent.

**The gate holds forge to it, and can hold nobody else to it.** `validate-css-tokens` fails any
`@theme` token forge declares in an overloaded namespace, deriving _overloaded_ from the compiled
design system rather than a hand-kept list that would age: a root whose enumerated values mean one
concern and whose other names mean another. A consumer's stylesheet is out of reach, so the
convention is published where an app reads it — the `forge.css` header and `src/ui/README.md`.
