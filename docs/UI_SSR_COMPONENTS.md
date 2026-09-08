---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the ui/controls bound variants, and the server-side half of the signal-binding seam."
audience: consumer
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound
> variants, and the server-side half of the signal-binding seam.
>
> Defers to: [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) for the `cn` / `cva` utilities,
> the conflict table, the `@utility` recipe layer, and the colour-scheme declaration contract;
> [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for everything that runs in the
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
invariant, consistent with [`ERROR_HANDLING.md`](../warden/canon/libs/ERROR_HANDLING.md) §5a.

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
composite shares one roving-focus controller ([`src/ui/README.md`](../src/ui/README.md)). **The
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
height `field-chrome` sets ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1e) and a floor and a cap are needed on either side of it: with no
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
([`CODE_RULES.md`](../warden/canon/libs/CODE_RULES.md) §1) plus collision and FOUC failure modes
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
`src/ui/contracts/vocabulary.ts` and `state-attrs.ts` — authoritative over the values; `src/ui/README.md` maps prop to component.

| Prop | What it decides | Declared as |
| --- | --- | --- |
| `tone` | the colour intent a surface carries | `Tone`, `TONES` |
| `appearance` | how that tone is painted — the emphasis level | `Appearance`, `APPEARANCES` |
| `size` | the control height, read from `--control-h-*` | `Size` |
| `shape` | a button's footprint beyond its size | `Shape` |
| `orientation` | the widget's own layout axis | `Orientation` |
| `invalid` | the control holds a validation error | `StateAttrsProps` |
| `busy` | the component is waiting on work | `StateAttrsProps` |

**No component declares a prop named `variant`.** One name answering two questions — which colour and
how much emphasis — is what let `secondary` mean an outlined button and a filled chip at once. Asked
separately the pair reads identically everywhere, and `toneVariants` ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1e) paints both.

**`orientation` carries the two layout axes and nothing else**, because a stylesheet matches
`data-orientation` on exactly that: `Switch`'s label side is `labelPlacement` (§1i), `FormField`'s
width-driven collapse a separate `responsive` boolean.

**Two props sit outside the table.** `Turnstile`'s `size` is Cloudflare's, verbatim (§1f). `level`
picks the heading tag on `EmptyState.Title` (default `3`) and `Dialog`/`Drawer.Title` (default `2`),
and nothing else — `data-slot`, the class and the derived `id` are identical at every level, so
`aria-labelledby` still resolves. It is the tool `forge-ui-heading-order` needed. Not `as`, which
already names a type scale on `FormField.Legend`.

**`conformance.test.tsx` enforces all three** by scanning `ui/core`, `ui/chrome` and `ui/controls`,
carrying each exemption with its reason — so adding one is visible, not a quiet edit.

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
