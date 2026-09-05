---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the binding seam, the class utilities, and the colour-scheme and CSS-layering contracts."
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound
> variants, the server-side half of the signal-binding seam, the `cn` / `cva`
> class utilities, and the contract a colour scheme file is declared against.
>
> Defers to: [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for everything that runs in the
> browser and for the hard SSR/client boundary; [`STATE_ATTRIBUTES.md`](./STATE_ATTRIBUTES.md) for
> the `data-*` vocabulary a component emits and the sweep that holds it to one declaration;
> `src/ui/README.md` for the component gallery,
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
- §1i Native-Input Primitive Decisions: an axis that is not an orientation, a scroll area that hijacks nothing, the bounds content-sizing needs, and a frame clipped rather than scrolled
- §1j Derived Ids Must Be Id Tokens: why a whitespace-bearing `name` or `scope` derives no wiring, and why suppressing won
- §1k One Consumption Path, Not Two: JSX as the terminal surface, the `data-scope` route, the rejected Custom Element mirror
- §1l Chrome Navigation Announces Only What It Implements: the not-a-menubar and not-a-rail-stop rulings
- §1m The Prop Vocabulary: the seven ratified props, the ban on `variant`, and the one `size` exemption
- §1n Optional Input Props Carry an Explicit `| undefined`: why the union is universal on input types, and what the guard-form spread was hiding from a11y lint
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a The Binding Ownership Boundary: what forge owns in both directions, and what the app supplies
- §2c ui/controls — Bound Variants: the static barrel, the bespoke case, and the deliberate name collision
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3d Conflict Resolution, the Fail-Open Boundary, and the Memo: what the resolver decides, where it stops, the ratified inversion, and the cache that replaced the no-cache ruling
- §3e Class Order Is Not Load-Bearing Within a Literal: the fixed-point invariant the gate enforces, and what a sorter cannot reach
- §3f The Table Is Derived From the Compiled Design System: the generator, the drift gate, the scale probe and its agreement condition, the equal-reach throw
- §3g A Narrower Later Utility Layers Rather Than Displaces: why `text-size-hero` and `text-size-[20px]` both survive
- §3h The `@utility` Recipe Layer: one name per state or chrome recipe, why it is a utility and not a class, the subset-group argument rule, the admission test that rules out a paint recipe, and the `--tone` mechanism
- §3i Which Utility Composes a Class, and In What Order: the four-point rule over `const`, `cva` and `cn`, and why the caller's class is last
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

**The fragment case is checked in `cloneAsChild`, not at the call site.** `isValidElement` accepts a
`Fragment` — it is an element of this runtime — but a fragment carries no attributes, so cloning onto
one merges the class, the `data-slot` and every caller prop into a value the renderer never reads.
The failure is silent and total, and it is one every `asChild` compound could reach, so the guard
belongs in the one place they all pass through. `Button` reached it by wrapping its children to make
room for a loading spinner; the spinner is now injected into the cloned child instead.

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

**The order is lint-enforced, not conventional.** `forge/data-slot-before-spread` fails any JSX
element carrying a literal `data-slot` before a spread of a **bare identifier** (`{...rest}`,
`{...props}`, `{...attrs}`). A computed spread such as `{...stateAttrs({ selected })}` is outside the
rule: it is built at the call site out of values the component controls, so no caller token can hide
inside it. It is off for `*.test.tsx` alone, where a probe overrides its own caller token on purpose.

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

An unselected `Tabs.Content` is `hidden`, which is the platform's own mechanism: the initial render is
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
unrepresentable rather than silently unstyled: `Popover.Content` and `Tooltip.Content` take
`PhysicalSide`, the named member of `Side` rather than a literal union of their own, so the
projection tracks the value space it is cut from.

### 1i. Native-Input Primitive Decisions

**`Switch` takes `labelPlacement` and publishes `data-label-position`** (`before` / `after`) for the
label's side of the track. It is not an orientation: orientation is the widget's own axis, and a
switch is always horizontal — the two would fight the moment a stylesheet matched on either (§1m).

**`ScrollArea` adds no behaviour to the platform's scrolling** — no hijacking, no synthetic thumb,
no wheel listener.

**`Textarea` sizes to its content, and the two bounds that come with it are not optional.**
`field-sizing-content` takes the height away from `rows`, so `h-auto` is needed to clear the fixed
height `field-chrome` sets (§3h) and a floor and a cap are needed on either side of it: with no
floor, every consumer that passes `rows` gets a collapsed one-line box, and with no cap the control
grows without bound. `src/ui/core/textarea.tsx` is authoritative over which utilities express them.

**`OtpInput`'s frame clips its editor rather than scrolling it, and `overflow: clip` is what makes
that true.** The editor deliberately overhangs the frame's interior to leave the caret room after
the last glyph (`forge-ui.css`, `otp-editor`). Under `overflow: hidden` that frame is also a scroll
container, so revealing the caret at the clipped edge scrolls the whole grid a pad's width off its
cells — permanently, on the first full code typed. `clip` forbids scrolling and clips the same
overhang.

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

**`Navbar` keeps `<details>` for its collapsed nav, and does not consume `Drawer`.** The two are
different overlay kinds: a `Drawer` is a `<dialog>` — top layer, backdrop, inertness, a focus
trap — and the collapsed nav is a disclosure with none of those, whose open state the platform
owns with no script. Rewiring one onto the other would turn a no-JS disclosure into a modal that
needs `showModal()`, which is a behaviour change, not an extraction.

### 1m. The Prop Vocabulary

**Every presentational prop is drawn from one vocabulary**, declared in
`src/ui/contracts/vocabulary.ts` and `src/ui/contracts/state-attrs.ts`, which are authoritative over
the values themselves; `src/ui/README.md` states which component takes which.

| Prop          | What it decides                               | Declared as                 |
| ------------- | --------------------------------------------- | --------------------------- |
| `tone`        | the colour intent a surface carries           | `Tone`, `TONES`             |
| `appearance`  | how that tone is painted — the emphasis level | `Appearance`, `APPEARANCES` |
| `size`        | the control height, read from `--control-h-*` | `Size`                      |
| `shape`       | a button's footprint beyond its size          | `Shape`                     |
| `orientation` | the widget's own layout axis                  | `Orientation`               |
| `invalid`     | the control holds a validation error          | `StateAttrsProps`           |
| `busy`        | the component is waiting on work              | `StateAttrsProps`           |

**No component declares a prop named `variant`.** One name answering two questions — which colour,
and how much emphasis — is what let `secondary` mean an outlined button and a filled chip at once.
Asked separately, a pair reads identically on every component that takes it, and `toneVariants`
(§3h) is the one place either is painted.

**`orientation` carries the two layout axes and nothing else**, because a stylesheet matches
`data-orientation` on exactly that: `Switch`'s label side is `labelPlacement` (§1i), and
`FormField`'s width-driven collapse is a separate `responsive` boolean.

**One `size` is exempt: `Turnstile` forwards Cloudflare's widget sizes verbatim**, renaming a third
party's values at a mount point being how a component forge does not ship gets documented (§1f).

**`conformance.test.tsx` enforces all three by scanning the sources** under `ui/core`, `ui/chrome`
and `ui/controls`, and carries the exemption with its reason — so adding one is a visible change
rather than a quiet edit.

### 1n. Optional Input Props Carry an Explicit `| undefined`

**Every optional property of a type a consumer passes values into is declared `name?: T | undefined`** — the whole of
`src/jsx/types.ts` and every `*Props` in `src/ui`. **Internal data structures and options objects keep the bare `?:`**,
the distinction `exactOptionalPropertyTypes` is actually for. **The test is "does a consumer construct a value of this
type", not "is it named `*Props`"**: a definition object handed to a component — `NavSlot`, `NavMegaMenu`,
`ToolbarPopover` — is a consumer input as much as an attribute bag is, and the suffix reading let those three drift.

**Two reasons, and the second is a correctness one.** `renderToString` skips a null or undefined attribute value
(`src/jsx/render-to-string.ts`), so absent and `undefined` are the same state at runtime and the flag would guard a
distinction the renderer does not have. And without the union a caller under the flag writes `{...(x !== undefined ?
{ "aria-label": x } : {})}` rather than `aria-label={x}` — a spread, which `jsx-a11y` cannot see as an attribute; forge
carried forty-seven, every one unlinted, and `@types/react` writes `className?: string | undefined` for the same reason.
**A guard-form spread is therefore never the fix for such an error at a forge call site; widening the declaration is**
— what stays is the **truthiness** spread, `{...(open ? { open: true } : {})}`, an omit-when-false HTML semantic.

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

`cn` and `cva` are **ratified `@public` utilities** — apps compose classes with them exactly as
forge's own components do.

### 3d. Conflict Resolution, the Fail-Open Boundary, and the Memo

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

**`cn` memoises, and the cache is cleared whole rather than evicted by age.** The resolver body is
the private `resolve(joined)`; `cn` joins its arguments, looks the joined string up in a module
`Map`, and calls `resolve` only on a miss. `CACHE_LIMIT` is 512, and a full map is **cleared
entirely**. Measured on one machine, pre- and post-change in a single process, so the pair is
internally comparable:

| call                                      | prior    | memo     |
| ----------------------------------------- | -------- | -------- |
| `cn(base)` repeated, 18-token base        | 8.04 µs  | 0.058 µs |
| `cn(base, "px-8")` repeated               | 10.24 µs | 0.118 µs |
| `cn(base)`, distinct keys — always a miss | 10.13 µs | 10.48 µs |
| `cn(base, "px-8")`, distinct keys         | 10.42 µs | 10.05 µs |

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

**Reconciled with [`CODE_RULES.md`](../governance/CODE_RULES.md) §1, not exempted from it.** §1
forbids state that carries across requests _observably_, and nothing but `cn` reads this map: no
enumeration path, no export, no API reporting whether a string was cached. Stated rather than left to
be discovered, because the shape invites the question — **entries are class strings that may derive
from consumer props, and they do outlive the request that produced them**. What makes that acceptable
is that no read path leads out of the map, and a memo of a pure function returns what recomputation
would. Logs stay governed by [`BOUNDARIES.md`](../governance/BOUNDARIES.md)'s no-PII rule; the cache
adds no log surface.

### 3e. Class Order Is Not Load-Bearing Within a Literal

**The invariant: every class literal is a fixed point of `cn`.** For any literal `L`,
`cn(L) === L`. Equivalently, no two tokens in one literal claim the same conflict group. A literal
that breaks it already contains dead code — one of the two tokens is dropped at render — so the
rule costs nothing and buys everything below.

**The gate enforces it; this paragraph does not.** `validate-class-order` judges class positions
with the real `cn`, imported rather than reimplemented, for the reason §3d gives about a second copy
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

### 3f. The Table Is Derived From the Compiled Design System

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
resolves — skipped in a fast run without it, failed by `--full` ([`TESTING.md`](./TESTING.md) §6).

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

### 3h. The `@utility` Recipe Layer

**A state or chrome recipe every component needs is declared once, as an `@utility` in `forge-ui.css`, and
spelled nowhere else.** The focus ring was written four ways across twenty-seven call sites and the disabled
paint five ways before this layer existed, and the spellings had drifted: one component ringed at 20% alpha,
another at full, a third never cleared the outline. The recipes are `focus-ring`, `focus-ring-outset`,
`state-disabled`, `state-invalid`, `state-busy`, `field-chrome`, `border-field`, `otp-cells` and
`otp-editor`; `forge-ui.css`'s header is authoritative over what each one paints.

**Why an `@utility` rather than a component class.** A Tailwind utility is something `cn` can reason
about: the derivation (§3f) reads each recipe's compiled signature, so `field-chrome` gets override
edges to `h-*`, `rounded-*`, `border-*` and `px-*`, and a caller's `rounded-lg` after it still wins —
the relationship §1c promises for every component default. A class in the `components` layer would be
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
`rounded-lg`, `h-auto` or `w-20` should win — the override §1c promises. A **paint** recipe would still
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

### 3i. Which Utility Composes a Class, and In What Order

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
theirs (§3e gives the other reason a lone `cn` earns its place — it puts a bare const in a class
position a sorter can reach).

**The caller's class is always the last argument**, which is the whole of the caller-wins guarantee
§1c promises: `cn` keeps the last utility to claim a conflict group (§3d), and `cva` appends `class`
after base, variants and compounds. Placed earlier it loses to the component's own defaults, silently
and only for the utilities that happen to collide.

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
