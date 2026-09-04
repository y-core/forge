---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the binding seam, the class utilities, and the colour-scheme and CSS-layering contracts."
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound
> variants, the server-side half of the signal-binding seam, the `cn` / `asClass` / `cva`
> class utilities, and the contract a colour scheme file is declared against.
>
> Defers to: [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for everything that runs in the
> browser and for the hard SSR/client boundary; `src/ui/README.md` for the component gallery,
> props, and worked usage; [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d for automatic
> URL sanitization; [`NAMESPACES.md`](./NAMESPACES.md) §5b for the one-import rule
> that governs the `ui/core` / `ui/controls` name collision.
>
> Components produce a forge element tree that `renderToString` (`@y-core/forge/jsx`) serializes
> to `SafeHtml`. The JSX runtime is forge's own — set
> `/** @jsxImportSource @y-core/forge/jsx */` at the top of each `.tsx` file.

---

## 0. Quick Reference

- §1 ui/core Component Contract: the rules every SSR component obeys
- §1a Dropped and Unsanitized Pass-Through Attributes: why `style` never arrives, and the one family left unsanitized
- §1c Button and the asChild Invariant: the ratified throw, and the `data-slot` token list
- §1e Switch and Slider — CSS-Only Controls: the `peer-*` trap, the sanitized readout, the declined formatter seam
- §1f Turnstile — Server-Rendered Mount Point: deliberate omission of auto-render
- §1g Composite Widgets: the markers that make many focusable items one tab stop
- §1h Overlays and Disclosures: native popover and `<details>`; how a popup's side resolves against the reader's direction
- §1i Native-Input Primitive Decisions: an axis that is not an orientation, and a scroll area that hijacks nothing
- §1j Derived Ids Must Be Id Tokens: why a whitespace-bearing `name` or `scope` derives no wiring, and why suppressing won
- §1k One Consumption Path, Not Two: JSX as the terminal surface, the `data-scope` route, the rejected Custom Element mirror
- §1l Chrome Navigation Announces Only What It Implements: the not-a-menubar and not-a-rail-stop rulings
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a The Binding Ownership Boundary: what forge owns in both directions, and what the app supplies
- §2c ui/controls — Bound Variants: the static barrel, the bespoke case, and the deliberate name collision
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3d Conflict Resolution and the Fail-Open Boundary: what the resolver decides, where it stops, and the ratified inversion
- §3e Class Order Is Not Load-Bearing Within a Literal: the fixed-point invariant the gate enforces, and what a sorter cannot reach
- §3f The Table Is Derived From the Compiled Design System: the generator, the drift gate, the scale probe and its agreement condition, the equal-reach throw
- §3g A Narrower Later Utility Layers Rather Than Displaces: why `text-size-hero` and `text-size-[20px]` both survive
- §4 State Attribute Contract: one declaration two tiers must agree on
- §4a Presence, Not Value: why `data-selected` and never `data-selected="true"`
- §4b ARIA States Are Not Styling Hooks: why both are emitted
- §4c The Caller Is Authoritative: class precedence and state precedence as one rule
- §5 Colour Scheme Declaration Contract: one declaration site per step, and what selects between the modes
- §5a OKLCh Solids: why a scheme's steps are written in the space the ramps are authored in
- §5b The Rejected Wide-Gamut Branch: why a second set of values would outrun the contrast audit
- §5c Status Hues Are Forge's: which colour roles an app may re-point, and which carry meaning
- §5d The dark: Variant Is Class-Driven: the takeover a consumer stylesheet inherits
- §5e A Consumer Rule Loses by Layer: why the remedy is a layer and never specificity
- §5f Scale Tokens Are Namespaced Away From Colour: the reserved `--text-size-*` spelling, and what it fixes

---

## 1. ui/core Component Contract

### 1a. Dropped and Unsanitized Pass-Through Attributes

**`style` is dropped deliberately** — forge's CSP carries no `style-src 'unsafe-inline'`, so an
inline style attribute could never take effect. Use `class` and the theme tokens.

The renderer HTML-escapes forwarded values and routes URL-bearing attributes through `safeUrl`, so
a `javascript:`-style value collapses to `"#"`. **This is automatic; components never call it**
([`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d). htmx selector and JSON attributes are
**not** sanitized — [`HTMX.md`](./HTMX.md) §7 owns that trust obligation.

### 1c. Button and the `asChild` Invariant

**`asChild` requires exactly one JSX element child.** A string, number, fragment, array, or
empty child is a programming error and **`Button` throws rather than degrading** — a ratified
invariant, consistent with [`ERROR_HANDLING.md`](../governance/ERROR_HANDLING.md) §5a.

**`data-slot` is a token list, and every compound merges into it rather than replacing it** — under
`asChild` and on plain render alike. Composing two compounds produces one element that genuinely is
both: `<Tooltip.Trigger asChild><Menu.Trigger/></Tooltip.Trigger>` renders a single button carrying
`data-slot="menu-trigger tooltip-trigger"`. Overwriting silently unmade the inner compound — every
rule and query keyed on the child's own slot stopped matching.

**Every forge selector on `data-slot` therefore uses `~=`, not `=`.** The two have identical
specificity (0,1,0), so nothing about the cascade shifts; `=` is simply wrong on a composed element.
A consumer keying on `[data-slot="…"]` exactly must make the same change to keep matching one.

**`anchor-name` does not union across rules**, so a composed element named by two rules leaves the
cascade to pick one. `forge-ui.css` therefore declares forge's one named anchor on the tooltip
trigger slot alone, and the set is closed because `Tooltip.Trigger` is the only trigger compound
offering `asChild`, which makes it always the outer wrapper.

**The recipe is to destructure the inherited `"data-slot"` out of props and rewrite the literal in
place** as `data-slot={slotToken("own-token", inherited)}`, own token first (`slotToken` is owned by
`src/ui/core/utils/as-child.ts`). A bare literal instead loses the compound's own token to any caller
that passes `data-slot`, because the rest-props spread that follows it wins. Rewriting in place —
rather than merging through a spread-last helper — keeps the attribute's serialized position.

**The order is gate-enforced, not conventional.** `validate-jsx` fails any JSX element carrying a
literal `data-slot` before a spread of a **bare identifier** (`{...rest}`, `{...props}`,
`{...attrs}`). A computed spread such as `{...stateAttrs({ selected })}` is deliberately outside the
rule: it is built at the call site out of values the component itself controls, so no caller token
can hide inside it. There is no per-site suppression.

### 1e. Switch and Slider — CSS-Only Controls

**A decorative element nested inside another cannot use `peer-*`, and the failure is silent.**
`peer-*` compiles to a general-sibling combinator, so it reaches only siblings of the input. The
track is one and uses `peer-checked:` directly; the **thumb is a child of the track**, so a `peer-`
utility on it matches nothing — no build error, no visual hint beyond the state never moving. The
thumb keys off a `data-slot`-anchored descendant selector instead.

**`Slider`'s `output` prop carries the _sanitized_ value rather than the raw `value` prop** — the
string HTML's value-sanitization algorithm for `input[type=range]` settles on, which is what
positions the thumb; a readout taken from the prop can disagree with the thumb permanently, and
`Slider` ships no client controller to reconcile them. The algorithm is module-local to `slider.tsx`
and takes the serialized attribute string rather than the prop, so it parses byte-for-byte what the
browser parses. **Mirroring that readout on input is a consumer concern** — forge stays markup-only
(§1a). This is §1h's "a server may only stamp what it can keep true" resolving _toward_ stamping.

**`output` stays a boolean, and the unformatted readout is a decision rather than a gap** — no
formatting hook, no locale, no unit; a consumer wanting `"50%"` composes their own `<output>`, as
`Meter.Value`'s caller-supplied children already make presenting a number composition rather than
configuration. **Any future formatter seam receives the _sanitized_ string, never the raw prop.**

### 1f. Turnstile — Server-Rendered Mount Point

**`Turnstile` deliberately omits Cloudflare's `cf-turnstile` auto-render class** — the client
controller owns rendering, so the widget lifecycle is deterministic rather than implicit. **`siteKey`
is injected server-side from the Worker env, never hardcoded**, and the markup is inert without the
controller, whose options arrive as `data-` attributes
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2c).

**Options are stamped only away from their defaults.** A page that opts into none renders the markup
it always did, which is what makes a new option additive rather than a change to every widget.

### 1g. Composite Widgets

A **composite** is a widget made of many focusable items that behaves as **one tab stop**, and every
composite shares one roving-focus controller ([`src/ui/README.md`](../../src/ui/README.md)). **The
markup declares which elements are items; the controller never guesses.** How it declares them
differs by widget, deliberately.

**`Toolbar` uses an explicit `data-toolbar-item` marker rather than a `data-slot` prefix**, because
`Toolbar.Group` and `Toolbar.Separator` are slots that must _not_ be focus stops and a prefix
selector cannot express the exception. The marker is public, so any foreign element inside a toolbar
opts in by carrying it.

**`Menu` identifies items by ARIA role rather than by a forge-specific attribute**, which is
load-bearing for a menu whose rows are built in the browser: a runtime-constructed row is navigable
the moment it is a correctly-roled menu item, with nothing forge-specific to remember to stamp. Any
row that must participate therefore carries the role — including a navigating `<a>` and a nested
popup's trigger, which a bare `Menu.Trigger` would leave unroled and the parent's arrow navigation
would skip.

**`ToggleGroup` announces what it actually is.** It emits no `role` at all, because `<fieldset>`
already has an implicit `group`; a hardcoded `role="toolbar"` would announce a segmented control as
a toolbar and offer the wrong interaction model. Its `type` prop is published as `data-multiple`,
present exactly when several items may be pressed at once, and that is what the client reads to
decide whether a click replaces the pressed item or adds to it (§2a).

An unselected `Tabs.Panel` is `hidden`, which is the platform's own mechanism: the initial render is
correct with no JavaScript, and the controller flips the same attribute.

### 1h. Overlays and Disclosures

**Nothing here re-creates a platform overlay in JavaScript.** The overlays are built on the native
Popover API, `<dialog>` and `<details>`, so the top layer, light-dismiss, Escape, exclusive-open and
the disclosure toggle are all the platform's and cost nothing. **`<details>` owns open and closed and
nothing mirrors them** — style the native `[open]`. `Menu` opens, closes and dismisses with **no
JavaScript at all**, through invoker commands against a `popover="auto"` popup; the client adds only
what ARIA's menu pattern asks for and the platform does not supply (§1g). **`Tooltip` is
`popover="manual"` deliberately**: `auto` would put it in the platform's exclusive-open stack, so
opening a tooltip would close an open menu beneath it. `Accordion` is not a composite — each item is
its own disclosure and tab stop, as a native `<details>` list is.

**An overlay whose behaviour is wholly the platform's stamps no scope.** `Dialog`, `Popover`,
`Accordion` and `Collapsible` ship neither scope nor controller. `Menu` and `Tooltip` stamp one
because they add a keyboard layer, and it is eager by necessity rather than taste
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c).

**A server may only stamp what it can keep true.** Placement is decided at render and fixed for the
element's life, so it is stamped; **open state is not**, because that would assert a fact the
platform owns and the component cannot follow. Open state is read from the element itself —
`:popover-open`, or `[open]` on a `<dialog>` or `<details>` — which is the one source that cannot
drift. An initial `open` is forwarded, because `<dialog open>` and `<details open>` are attributes
the server genuinely sets and the platform maintains from there.

**A side is stamped at SSR, where the Worker cannot know the reader's direction, so `Side` carries
physical and logical spellings in one value space** (`src/ui/contracts/state-attrs.ts`). The
physical members stay, because a popup that must _not_ mirror needs them, and there is deliberately
no separate logical type: splitting it would let a caller hold a value the attribute cannot express.

**The mechanism is physical declarations selected by `:dir()`, not logical CSS**
(`src/ui/assets/css/forge-ui.css`). Both shorter spellings are wrong and both are tempting.
`anchor(inline-end)` is outright invalid — `<anchor-side>` has no logical keywords. And
`inset-inline-start: anchor(start)` parses but resolves against the **containing block's** writing
mode; a top-layer popup's containing block is the viewport, whose direction is the root element's, so
a `dir="rtl"` subtree inside an LTR document resolves to the LTR answer — the original bug
reintroduced through its own fix. `:dir()` asks the _tree_, which is the only thing that knows.
`position-try-fallbacks` needs nothing added: `flip-inline` transforms _used_ declarations after the
cascade settles, so `:dir()` selection happens first. Only the inline axis mirrors, so only the rows
resolving on it are `:dir()`-keyed.

**A component projects the subset its stylesheet can render**, so an unrenderable value is
unrepresentable rather than silently unstyled — narrowed with `Exclude<Side, …>` so the projection
tracks future growth of `Side`, rather than with an independent literal union.

### 1i. Native-Input Primitive Decisions

**`Switch` publishes `data-label-position`** (`before` / `after`) for the label's placement relative
to the track. It is not `data-orientation`: orientation is the widget's own axis, and a switch is
always horizontal — the two would fight the moment a stylesheet matched on either.

**`ScrollArea` adds no behaviour to the platform's scrolling** — no hijacking, no synthetic thumb,
no wheel listener.

### 1j. Derived Ids Must Be Id Tokens

**Every id forge derives for a form field must be a single id token, and a field whose `name` — or
whose non-blank `scope` — is not one derives no `id`, no `for` and no `aria-describedby` at all.**
HTML forbids ASCII whitespace inside an id and splits every IDREF list on it, so such an id can be
_declared_ but never _named_: the browser tokenizes the reference into fragments matching nothing,
and deriving the same unusable string on both halves does not redeem it. The field still renders and
its `name` is still passed through; only the wiring is withheld. `src/ui/core/field.tsx` owns the
predicates and the character set, and is authoritative over any prose restating it.

**The hostile set is exactly HTML's ASCII whitespace, and JS `\s` is the wrong class for it.** `\s`
also matches U+00A0 and the Unicode spaces, which are legal id characters no parser treats as a
separator — so splitting an IDREF on one breaks a _resolvable_ id into pieces, manufacturing the
dangling reference this rule exists to prevent.

**Suppressing beats sanitizing**, because collapsing whitespace would have forge rewrite caller
input, which it does not do (§1e emits the caller's `value` verbatim), and any collapse maps
distinct names onto one id so two distinguishable fields silently share wiring. **Suppressing beats
throwing**, because §1c's ratified throw is for a component that cannot render at all — here it
renders correctly and only the association is unexpressible, a degraded field rather than a broken
one.

**A blank `scope` is no scope; a whitespace-bearing one is not.** Blank falls back to the unscoped
id, because the caller named no scope. A non-blank scope that is not an id token **suppresses
instead of falling back**, since the unscoped id is precisely the one the scope exists to avoid
colliding with — falling back would re-create the cross-wiring the prop was introduced to fix.

**The rule governs references forge emits, not ids it merely declares.** An id that is declared and
never named by any IDREF stays outside the rule and round-trips a `value` verbatim; giving any such
id a reference means routing it through the same gate first.

---

### 1k. One Consumption Path, Not Two

**JSX is the only component surface, and that is terminal** — there is no Custom Element mirror and
none will be added. A consumer without the forge JSX runtime hand-writes the DOM contract instead
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §5). That path is supported rather than tolerated,
and reaches forge markup inside a consumer's own open shadow root.

**Form participation is the platform's.** Every form control wraps a real `<input>` (§1e), so it
submits, restores and validates with no script; a form-associated element would hand-maintain
`setFormValue` and `setValidity` to reach less, and lose it entirely without JS.

**Rejected — Custom Elements as a second path.** Three costs, each sufficient: the spec's mandated
hyphenated name moves the namespace out of the import and into every consumer's markup as a vendor
prefix; the registry is process-global and early-binding, reintroducing global mutable state
([`CODE_RULES.md`](../governance/CODE_RULES.md) §1) plus collision and FOUC failure modes
late-binding delegation does not have; and the audience does not exist under the no-build-step
constraint ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §2), since a consumer able to load
the registering module already runs the bundler that compiles the JSX. **Form-associated elements for
the form controls alone** are rejected for the narrower version of the same reason.

### 1l. Chrome Navigation Announces Only What It Implements

**`Navbar` is not a `role="menubar"`, and that is a decision rather than an omission.** A menubar
owes its triggers a roving tab stop of their own, forge ships no menubar controller, and claiming
the role without the behaviour announces a keyboard interface that is not there. A bar-level link
stays a plain link for the same reason. **A flyout's title action is likewise not a rail stop**:
roving focus queries the whole rail subtree, so marking that button would splice flyout content
into the rail's arrow-key ring (§1g).

---

## 2. The Signal-Binding Seam

### 2a. The Binding Ownership Boundary

**Forge owns the whole binding in both directions; the app supplies the signal record and whatever
domain effects it layers on top.** The SSR side stamps the field name and the browser side binds it —
one delegated listener on the scope root for DOM → signal, one effect per field for signal → DOM.
**Value parsing and pressed-state reconciliation are forge's, not the app's**, the alternative having
every consumer hand-write the write-back.

**The signal is the state and the DOM is a paint of it.** Nothing is read back out of
`aria-pressed`, so a signal-driven repaint restores a group after markup that was replaced wholesale
— which a design keeping pressed state in the DOM cannot do at all. Each paint is guarded by a
differs-check, which is load-bearing rather than an optimisation: assigning `value` mid-drag resets a
range input. **Both directions cross an open shadow boundary**, the repaint walking into every open
shadow root under the scope root rather than running one flat `querySelectorAll`, which a selector
cannot make cross. A closed root is stepped over, the same answer the platform gives everywhere else.

**A button group can express any value its signal can hold**, the type being inferred from the
signal's current value rather than pinned by the markup. Only a split that pinned the type ahead of
the signal would limit a button group to strings.

**Failure follows the throw-or-report rule.** A `data-field` naming no signal in the record is a
property of the markup rather than of the call, so it reports and the rest of the widget keeps
working.

### 2c. `ui/controls` — Bound Variants

**The static `ui/controls` barrel is the only bound-control API — there is no runtime factory to
call.** The single-element wrappers come from an internal, unexported factory, so their shape is
uniform. **`ToggleGroup` is bespoke rather than factory-built**: its binding lives on the `.Item`
sub-component rather than the root and it stamps an extra `data-value`, which the single-element
factory cannot express.

**No bound control stamps a `data-on-*` action**, `bindControls` listening once on the scope root
instead, so a bound-control scope must be `eager: true` — which
[`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c already requires of any markup carrying no
`data-on-*` action of its own.

**The name collision with `ui/core` is intentional and must not be renamed.**
[`NAMESPACES.md`](./NAMESPACES.md) §5b owns the resulting rule: a module imports a
given control name from exactly one of the two barrels, never both.

### 2d. Scoped Components Require the Client Scope Import

Some `ui/core` components render a **resumable scope**, whose behaviour wakes only once the matching
scope is registered. The registrations live in `@y-core/forge/ui/core/client`, a side-effect module
an app must import once in the client entry, before calling `resume()`.

Without it the markup still renders but no handler is registered, so **`resume()` warns on every
`data-scope` it finds unregistered. Treat that warning as a missing client-entry import or a
scope-name typo — never as an expected runtime condition.**

---

## 3. Class Utilities

`cn`, `asClass`, and `cva` are **ratified `@public` utilities** — apps compose classes with them
exactly as forge's own components do.

### 3d. Conflict Resolution and the Fail-Open Boundary

**Conflict resolution is a table lookup, and the table is `src/ui/core/utils/class-groups.ts`** —
a utility mapped to the CSS concern it sets, with `cn` keeping the last utility to claim a concern.
The file is `@internal` and absent from every barrel, being data rather than API, and it is
**authoritative over any prose describing forge's covered utility surface**: a second copy of a
table is indistinguishable from an amendment the moment the two disagree. A utility's **modifier
prefix** and its **importance marker** both belong to the key, so `hover:h-5` never displaces
`h-full`.

**The coverage boundary.** The table covers every utility the stylesheet compiles to (§3f) and
nothing beyond it. A consumer's own theme name, a utility from a Tailwind release newer than that
compile, and a bespoke class alike pass through untouched, so two conflicting utilities from an
uncovered family are _both_ emitted and stylesheet order decides — the behaviour every consumer had
before conflict resolution existed. An uncovered family is a gap, not a regression — and not the
only way the table is wrong about an app's own theme, §5f being the other.

**Fail-open, and the inversion is deliberate.** An unrecognised utility is always kept, inverting
the fail-closed posture of [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5a. The reasoning is
specific to this seam and does not generalise: the "failure" is forge's incomplete knowledge of a
third-party utility vocabulary rather than untrusted input, and there is no security boundary, since
`cn` produces a `class` attribute the renderer escapes anyway (§1a). Failing closed would silently
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

**No cache, also deliberately.** A memo keyed on the argument list is unbounded mutable module state
needing its own eviction policy ([`CODE_RULES.md`](../governance/CODE_RULES.md) §1), and Cloudflare
evicts isolates aggressively enough that a cold refill is paid often rather than amortised. It stays
retrofittable behind the unchanged signature.

### 3e. Class Order Is Not Load-Bearing Within a Literal

**The invariant: every class literal is a fixed point of `cn`.** For any literal `L`,
`cn(L) === L`. Equivalently, no two tokens in one literal claim the same conflict group. A literal
that breaks it already contains dead code — one of the two tokens is dropped at render — so the
rule costs nothing and buys everything below.

**The gate enforces it; this paragraph does not.** `validate-class-order` judges class positions
with the real `cn`, imported rather than reimplemented, for the reason §3d gives about a second copy
of the table. It ships to consuming apps, so an app gets the same guarantee against the same
resolver.

**The positions it reaches are the ones the formatter sorts**, which is what makes the two agree: a
quoted `class`/`className` attribute; an expression container, whose string literals — both branches
of a ternary among them — are each judged, and whose template literals are judged one chunk at a
time, split at every `${…}`, because that chunk is the unit a sorter reorders; and the argument span
of a `cn`, `asClass` or `cva` call, wrapped across lines or nested inside a container. A `//`- or
block-commented literal is dead code and is not judged. **One carve-out:** a span whose brackets do
not balance is skipped rather than guessed at — a fabricated literal would fail the gate on source
that does not exist.

**What that buys: the formatter may sort classes**, holding forge's literals in Tailwind's canonical
order. A sorter **reorders tokens within one literal and never moves a token between literals**, so
under the invariant sorting is provably output-preserving. It must be pointed at the same stylesheet
an app compiles, `src/ui/assets/css/tailwind.css`; given only upstream Tailwind it treats every forge
token utility as unknown and hoists it to the head of its literal.

**What sorting cannot touch, and this is the consumer-facing guarantee:** cross-argument precedence,
so in `cn(BASE, asClass(cls))` the caller still wins; and `cva`'s `base → variants → class` layering,
which is composition order rather than token order inside any one string. An app formatting its own
tree with forge's `.oxfmtrc.json` keeps both.

**Only literals in a class position are sorted.** A bare `const FOO = "…"` sits in no such
position, so forge's own class consts are wrapped — `const INPUT_BASE = cn("…")` — which reaches
them with a call the invariant proves is the identity. Two files cannot be wrapped, because reaching
`cn` would close a namespace cycle; their literals are unsorted and unreachable by any sorter, which
is exactly why they are also unbreakable by one.

### 3f. The Table Is Derived From the Compiled Design System

**The table is generated, not authored.** `gen:class-groups` compiles
`src/ui/assets/css/tailwind.css` to a Tailwind design system, asks it what each utility actually
writes, and renders `class-groups.ts` from the answers — so the table states what Tailwind states
rather than a hand-written approximation of it. `src/cli/pkg/gate/checks/class-groups-parse.ts` is
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
hand edit to the generated file fails the same way. The step compiles CSS, and `tailwindcss` is an
optional peer, so it runs under `--full` only ([`TESTING.md`](./TESTING.md) §6).

**The class list is not authoritative for a root's named values.** `getClassList()` enumerates a
value scale for `left`, `right` and `inset-s` but nothing for `start` and `end` beyond three
statics — which is the whole reason `start-*` and `end-*` once failed to merge against each other
at all. A root the class list leaves with no enumerated named value is therefore asked the design
system directly, with `${root}-0` and `${root}-4`, **and gains a named group only when both probes
agree.**

**The agreement condition is what keeps the probe honest, and it is not optional.** Deriving a
named group from the statics instead handed `cursor` one, breaking the pinned ruling that
`classGroup("cursor-brand")` stays `undefined` so a consumer's bespoke class survives (§3d). A root
that genuinely takes a scale value answers both probes the same way; a root whose names are keywords
compiles nothing for either and is left alone.

**Two groups reaching exactly the same properties is a derivation-time throw, not a silent
no-edge.** Equal reach is never a legitimate table state, and a proper-subset check would emit no
edge and leave the ambiguity invisible — surfacing later as `cn` dropping both classes at runtime
depending on argument order. Throwing surfaces it as a named `validate-class-groups` failure
instead, which is how the derivation already treats its other two ambiguity conditions.

### 3g. A Narrower Later Utility Layers Rather Than Displaces

**`cn("text-size-hero", "text-size-[20px]")` keeps both, by design.** The named form writes
`font-size` and `line-height`; the arbitrary form writes only `font-size`. The later utility is
therefore strictly narrower than the earlier one, and an override edge runs from the wider group to
the narrower and not back (§3f), so it layers over it — exactly as `cn("p-4", "px-2")` does. The
reverse order does collapse, the wider group covering the narrower.

This is the resolver working, not a gap in it. Reading it as a defect leads to an edge that would
make `cn("p-4", "px-2")` drop the padding a caller asked for.

---

## 4. State Attribute Contract

**State attributes are the styling hooks CSS matches on to react to a component's state, and they
are declared once, in `src/ui/contracts/state-attrs.ts`, which both tiers import.** Neither the
server-rendered component nor the browser controller owns the contract: a state attribute is written
in **two places that cannot see each other**, and drift is _silent_ — the selector stops matching, so
the component looks unstyled rather than broken. The same argument produced the delegated-event
vocabulary ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c). The declaration is authoritative
over any prose naming forge's state attributes, and nothing here enumerates it, for the reason §3d
gives about `class-groups.ts`.

**Adding a styling hook means adding it to that declaration first.** A component that emits a state
attribute outside the table fails a conformance test — smuggling a hook past it is the exact failure
the single declaration exists to prevent.

**And a declared name with no producer is removed.** A hook that is never emitted is the _inverse_
of the drift above and just as misleading: a consumer styles against it and gets a rule that can
never match — so a hook is added with its producer, never ahead of it. The question such a hook has
to answer is whether it describes a state a selector cannot already reach. Where the answer is yes
it gets a controller rather than a deletion; where a selector already reaches the state — `:has()`
reading a popup's own `:popover-open` from the trigger's rule — it goes.

**`data-selected` is not `data-checked`.** ARIA models tab selection as `aria-selected`, not
`aria-checked`, so reusing `data-checked` would announce a tab as a radio; and calling it structural
rather than a state would be false, because it is precisely a state a stylesheet reacts to.

### 4a. Presence, Not Value

**Boolean states are emitted by presence, with an empty value — `data-selected=""`, never
`data-selected="true"`.** `[data-selected]` is a cheaper and a more honest selector, and a false state
emits nothing at all. The valued attributes — `data-orientation`, `data-side`, `data-align` — are the
exception, because they carry a choice rather than a flag.

**A state the platform already exposes is not in the table** (§1h); republishing it as a `data-` flag
would be a second copy of a fact forge does not own.

### 4b. ARIA States Are Not Styling Hooks

**A component emits both** — `aria-pressed="true"` beside `data-pressed` — and that duplication is
deliberate. `aria-*` keeps its `"true"` / `"false"` string form because WAI-ARIA requires it, and the
whole point of the `data-` hook beside it is that **CSS should not have to read ARIA**: a stylesheet
matching `[aria-pressed="true"]` couples presentation to an accessibility contract, so the day the
correct ARIA for a widget changes, the styling breaks with it. The two are reconciled together by one
function, so a controller can never write one without the other.

**`aria-orientation` is emitted on both axes, including the role's default**, where the design
reference omits the default value. An attribute present exactly when a caller passed a non-default
is one a test has to assert two ways and a reader has to know a role table to interpret.

### 4c. The Caller Is Authoritative

**The caller is authoritative over both the class list and the state attributes** — the same
principle as class precedence (§3d) on a different mechanism. A component spreads its state
attributes **before** the forwarded caller props, so a duplicate key resolves to the caller's, and
the `ui/core` conformance sweep asserts it for every participating component.

---

## 5. Colour Scheme Declaration Contract

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

### 5a. OKLCh Solids

**A step is written in OKLCh**, the space its value was produced in.

The ramps in `src/ui/contracts/theme/color.ts` are authored in OKLCh, so it is the scheme's own space
and hex was a lossy render of it. Writing that space into the file makes a scheme legible and
hand-editable: shifting the hue of every step becomes a substitution rather than a regeneration. It
costs the contrast gate nothing, because the resolver already reads `oklch()`.

**The emitted OKLCh is gamut-mapped, never the raw ramp coordinate.** Chroma is reduced at constant
lightness and hue until the colour is representable in sRGB, and the reduced coordinates are what the
file carries. A raw coordinate outside sRGB renders wider on a display that can show it, and the
audited ratio would then describe a colour that reader never sees.

### 5b. The Rejected Wide-Gamut Branch

**No scheme ships a `display-p3` branch**, because the wide-gamut values a feature query would carry
are not the values forge audits. WCAG relative luminance is defined over sRGB, so a second set of
values behind a feature query is a second theme the gate does not walk and cannot measure, leaving
every pinned ratio describing the fallback alone. The gain is a slightly more saturated accent on a
wide-gamut display; the cost is that forge's accessibility claims would hold only for a branch that
reader does not receive.

The same test rejects the per-scale surface, indicator, and track properties a wider palette library
declares: forge resolves those through its semantic layer, and a step nothing reads is surface a
consumer can come to depend on before any component justifies it.

### 5c. Status Hues Are Forge's; Brand Fills Are the App's

**`--status-*` is deliberately separate from `--destructive` / `--success` / `--warning`, and the
split is an ownership one.** The latter are fills an app owns and may re-point at its brand; the
status hues are forge's, so a failure panel keeps meaning "failed" whatever `--destructive` has been
pointed at. An app that means to change what "failed" _looks like_ re-points the underlying step,
not the semantic alias.

### 5d. The dark: Variant Is Class-Driven, and That Is a Takeover

**`forge.css` redefines Tailwind's `dark:` variant to follow the theme class rather than
`prefers-color-scheme`,** because otherwise a `dark:` utility follows the _operating system_ while
every forge token follows the _user's choice_ — and the two disagree the moment someone picks a
theme that is not `system`.

**It reconfigures a consumer's own `dark:` utilities too, and nothing catches that**: forge has no
Tailwind dependency, so no gate here ever compiles CSS. Stating the takeover is the obligation this
section carries — the escape hatch is the cascade, since `@custom-variant` is last-declaration-wins.

### 5e. A Consumer Rule Loses by Layer, Not by Selector

**Every rule in `forge-ui.css` sits in `@layer components`, so a utility passed at a call site wins
over a component default** — which is what makes `class` on a forge component behave as it reads.
The consequence runs the other way too: a rule an app puts in `@layer components` is outranked by
every forge utility in `@layer utilities`, whatever its specificity. **The remedy is a layer, not a
selector** — one declared after `utilities`. Reaching for higher specificity instead appears to work
until the next utility is added.

### 5f. Scale Tokens Are Namespaced Away From Colour

**A theme token whose value is a scale step is declared in a namespace no colour utility reads. A
font-size step is `--text-size-*`, never a bare `--text-*`** — so its concern is legible from its
name, to a reader and to a table alike.

Tailwind's `--text-*` namespace carries font size while the `text-*` utility also carries colour, so
`--text-hero` and `--color-hero` produce the same class name. A conflict table cannot tell them
apart, guesses colour — what nearly every unenumerated name under `text-` is — and drops the other:
`cn("text-hero text-red-500")` returns `text-red-500` alone, in a consuming app's markup, silently.

**Forge cannot close this from its own stylesheet, which is why the answer is a namespace and not a
heuristic.** The table is derived from what `tailwind.css` compiles to (§3f), and an app's theme is not in
that compile; a discriminator inside `cn` would be forge encoding a guess about someone else's
naming. Forge reserves one root instead: `text-size` resolves to the size group the design system
itself states, so the conforming spelling merges against `text-2xl` and coexists with
`text-red-500`. A non-conforming token keeps §3d's behaviour, unchanged and still silent.

**The gate holds forge to it, and can hold nobody else to it.** `validate-css-tokens` fails any
`@theme` token forge declares in an overloaded namespace, deriving _overloaded_ from the compiled
design system rather than a hand-kept list that would age: a root whose enumerated values mean one
concern and whose other names mean another. A consumer's stylesheet is out of reach, so the
convention is published where an app reads it — the `forge.css` header and `src/ui/README.md`.
