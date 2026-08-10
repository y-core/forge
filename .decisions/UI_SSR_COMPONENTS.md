---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the binding seam, and the class utilities."
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound
> variants, the server-side half of the signal-binding seam, and the `cn` / `asClass` / `cva`
> class utilities.
>
> Defers to: [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for everything that runs in the
> browser and for the hard SSR/client boundary; `src/ui/README.md` for the component gallery,
> props, and worked usage; [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d for automatic
> URL sanitization; [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5b for the one-import rule
> that governs the `ui/core` / `ui/controls` name collision.
>
> Components produce a forge element tree that `renderToString` (`@y-core/forge/jsx`) serializes
> to `SafeHtml`. The JSX runtime is forge's own — set
> `/** @jsxImportSource @y-core/forge/jsx */` at the top of each `.tsx` file.

---

## 0. Quick Reference

- §1 ui/core Component Contract: the rules every SSR component obeys
- §1a Dropped and Unsanitized Pass-Through Attributes: why `style` never arrives, and the one
  attribute family left unsanitized
- §1c Button and the asChild Invariant: the ratified throw, and the `data-slot` token list
- §1e Switch and Slider — CSS-Only Controls: the `peer-*` trap, the sanitized readout, and the
  declined formatter seam
- §1f Turnstile — Server-Rendered Mount Point: deliberate omission of auto-render
- §1g Composite Widgets: the markers that make many focusable items one tab stop
- §1h Overlays and Disclosures: native popover and native `<details>`; how a popup's side resolves
  against the reader's direction
- §1i Native-Input Primitive Decisions: an axis that is not an orientation, and a scroll area that
  hijacks nothing
- §1j Derived Ids Must Be Id Tokens: why a whitespace-bearing `name` or `scope` derives no wiring,
  and why suppressing beat sanitizing and throwing
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a The Binding Ownership Boundary: what forge owns, what the app supplies, and why `bindGroup`
  exists
- §2c ui/controls — Bound Variants: the static barrel, the bespoke case, and the deliberate
  name collision
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3d Conflict Resolution and the Fail-Open Boundary: what the resolver decides, where it stops,
  and the ratified inversion of the fail-closed posture
- §4 State Attribute Contract: one declaration two tiers must agree on
- §4a Presence, Not Value: why `data-open` and never `data-open="true"`
- §4b ARIA States Are Not Styling Hooks: why both are emitted
- §4c The Caller Is Authoritative: class precedence and state precedence as one rule

---

## 1. ui/core Component Contract

### 1a. Dropped and Unsanitized Pass-Through Attributes

**`style` is dropped deliberately** — forge's CSP carries no `style-src 'unsafe-inline'`, so an
inline style attribute could never take effect. Use `class` and the theme tokens.

The renderer HTML-escapes forwarded values and routes URL-bearing attributes through `safeUrl`, so
a `javascript:`-style value collapses to `"#"`. **This is automatic; components never call it.** See
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d.

htmx selector and JSON attributes are **not** sanitized — [`HTMX.md`](./HTMX.md) §7 owns that
trust obligation.

### 1c. Button and the `asChild` Invariant

**`asChild` requires exactly one JSX element child.** A string, number, fragment, array, or
empty child is a programming error and **`Button` throws rather than degrading** — a ratified
invariant, consistent with [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §2a.

**`data-slot` is a token list, and `asChild` appends to it rather than replacing it.** Composing two
compounds produces one element that genuinely is both: `<Tooltip.Trigger asChild><Menu.Trigger/>
</Tooltip.Trigger>` renders a single button carrying `data-slot="menu-trigger tooltip-trigger"`.
Overwriting silently unmade the inner compound — every rule and query keyed on the child's own slot
stopped matching, and the menu lost the `anchor-name` that positions its popup
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2j).

**Every forge selector on `data-slot` therefore uses `~=`, not `=`.** The two have identical
specificity (0,1,0), so nothing about the cascade shifts; `=` is simply wrong on a composed element.
A consumer keying on `[data-slot="…"]` exactly must make the same change to keep matching one.

**`anchor-name` does not union across rules.** Two rules each naming the same composed element leave
the cascade to pick one, so `theme-base.css` spells out the trigger pairs explicitly. The set is
closed because `Tooltip.Trigger` is the only one of the four trigger compounds that offers `asChild`,
which makes it always the outer wrapper.

**The merge is not specific to `asChild` — every compound merges on plain render too.** A `ui/core`
or `ui/chrome` compound destructures an inherited `"data-slot"` out of its props and writes
`data-slot={slotToken("own-token", inherited)}`, own token first. A bare literal instead loses the
compound's own token to any caller that passes `data-slot`, because the rest-props spread that
follows it wins. `slotToken` is owned by `src/ui/core/utils/as-child.ts`.

**The attribute order is gate-enforced, not conventional.** `scripts/validate-jsx.ts` — matchers in
`scripts/jsx-parse.ts` — fails on any JSX element carrying a literal `data-slot` before a spread of
a **bare identifier** (`{...rest}`, `{...props}`, `{...attrs}`). A computed spread such as
`{...stateAttrs({ open })}` is deliberately outside the rule: it is built at the call site out of
values the component itself controls, so no caller token can hide inside it. There is no per-site
suppression, matching `validate-exports.ts` and `validate-docs.ts`.

**The destructure preserves attribute position, which is why it is the recipe.** The JSX transform
merges duplicate keys in source order — a later spread overwrites the *value* but keeps the *first*
insertion position — so a literal rewritten in place serializes byte-identically. A spread-last
props helper would achieve the same merge while moving `data-slot` after `class` in every rendered
string, for no behavioural gain.

### 1e. Switch and Slider — CSS-Only Controls

**The track and the thumb need different selectors, and this is easy to get wrong.** `peer-*`
compiles to a **general-sibling** combinator (`:is(:where(.peer):checked ~ *)`), so it reaches only
elements that are siblings of the input. The track is such a sibling and uses `peer-checked:`
directly. The **thumb is a child of the track**, so a `peer-` utility on it matches nothing at all —
silently, with no build error and no visual hint beyond the state never moving. The thumb therefore
keys off a descendant selector anchored on `data-slot`:

```
[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&]:translate-x-4
```

A decorative element nested inside another decorative element cannot use `peer-*`. Reach for a
`data-slot`-anchored descendant selector instead.

**`Slider`'s `output` prop carries the *sanitized* value rather than the raw `value` prop** — the
string HTML's value-sanitization algorithm for `input[type=range]` settles on, which is the same
string that positions the thumb, since a readout taken from the prop can disagree with the thumb
permanently and `Slider` ships no client controller to reconcile the two after paint. The algorithm
lives in `slider.tsx`'s module-local `sanitizeRangeValue`, `@internal` and in no barrel; it takes the
serialized attribute string, not the prop, so it parses byte-for-byte what the browser parses.
**Mirroring that readout on input is a consumer concern** — forge stays markup-only (§1a). This is
§1h's "a server may only stamp what it can keep true" resolving *toward* stamping: the sanitized
value is a total function of attributes forge emits in the same breath, with nothing from the client
environment entering it.

**`output` stays a boolean, and the unformatted readout is a decision rather than a gap** — no
formatting hook, no locale, no unit; a consumer wanting `"50%"` composes their own `<output>`
alongside the `Slider`. **`Meter` is the precedent and the argument**: `Meter.Value` has no
formatting seam either, its text being caller-supplied children, so presenting a number is already
composition rather than configuration, and a formatter prop here would make the two disagree about
who owns it. **Any future formatter seam receives the *sanitized* string, never the raw prop** — the
prop reintroduces the readout/thumb divergence sanitization exists to close.

### 1f. Turnstile — Server-Rendered Mount Point

**`Turnstile` deliberately omits Cloudflare's `cf-turnstile` auto-render class** — the client
controller owns rendering, so the widget lifecycle is deterministic rather than implicit.

**`siteKey` is injected server-side from the Worker env — never hardcoded.** The markup is inert
on its own; pair it with the client controller
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2c).

### 1g. Composite Widgets

A **composite** is a widget made of many focusable items that behaves as **one tab stop**.
`Toolbar`, `Menu`, `Tabs` and `ToggleGroup` are the four, and they share one controller
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §6b). **The markup declares which elements are
items; the controller never guesses.** How it declares them differs by widget, and each choice is
deliberate.

**`Toolbar` uses an explicit `data-toolbar-item` marker rather than a `data-slot` prefix** because
`Toolbar.Group` and `Toolbar.Separator` are toolbar slots that must *not* be focus stops, and a
prefix selector cannot express the exception. The marker is public: any foreign element inside a
toolbar opts in by carrying it, which is how an icon rail keeps its own buttons and still becomes
one tab stop.

**`Menu` identifies items by ARIA role** (`menuitem` / `menuitemcheckbox` / `menuitemradio`) **rather
than by a forge-specific attribute**, and that is load-bearing for a menu whose rows are built in the
browser: a runtime-constructed row is navigable the moment it is a correctly-roled menu item, with
nothing forge-specific to remember to stamp. `Menu.LinkItem` is an `<a role="menuitem">` for rows
that navigate — it keeps middle-click, open-in-new-tab and no-JavaScript navigation, all of which a
`<button>` drops — and `Menu.SubmenuTrigger` is the roled trigger a nested popup needs, since a bare
`Menu.Trigger` carries no role and would be skipped by the parent's arrow navigation.

**`ToggleGroup` announces what it actually is.** It emits no `role` at all — `<fieldset>` already
has an implicit `group` — where it previously hardcoded `role="toolbar"` for every group, which
announced a segmented control as a toolbar and offered the wrong interaction model. Its `type` prop
(`"single" | "multiple"`) is published as `data-multiple`, present exactly when several items may be
pressed at once, and that is what the client reads to decide whether a click replaces the pressed
item or adds to it (§2a).

An unselected `Tabs.Panel` is `hidden`, which is the platform's own mechanism: the initial render is
correct with no JavaScript, and the controller flips the same attribute.

### 1h. Overlays and Disclosures

**Nothing here re-creates a platform overlay in JavaScript.** `Menu` and `Tooltip` are built on the
native Popover API, `Dialog` on native `<dialog>`, and `Collapsible` on native `<details>`, so the
top layer, light-dismiss, Escape, exclusive-open and the disclosure toggle are all the platform's
and cost nothing.

- **`Menu`** — opening, closing and dismissing involve **no JavaScript at all**, being
  `command="toggle-popover"` / `command="hide-popover"` against a `popover="auto"` popup; the client
  adds only what ARIA's menu pattern asks for and the platform does not supply (§1g).
- **`Collapsible`** — **`<details>` owns open and closed**; the controller only *publishes* them as
  state attributes for CSS to react to (§4).
- **`Tooltip`** — a `popover="hint"` surface, so it does not close the menu or dialog beneath it.
- **`Accordion`** — not a composite: each item is its own disclosure and its own tab stop, because
  that is what a native `<details>` list is.

**Every overlay stamps a scope, and every one of those scopes is eager.** `Dialog` stamps
`DIALOG_SCOPE`, `Popover.Content` stamps `POPOVER_SCOPE` (both in
`contracts/overlay-contract.ts`), and each `Accordion.Item` stamps `ACCORDION_SCOPE` beside
`Collapsible`'s in `contracts/toggle-contract.ts`. Eager out of *necessity*, not taste: an overlay's
markup carries no `data-on-*` action at all — opening, closing, Escape and light-dismiss are the
platform's — so a lazy scope would have nothing to resume it, and every state attribute would stay
frozen at its server-rendered value (§2d). `NumberField`'s steppers are eager for the same reason.

**A server may only stamp what it can keep true.** `Popover.Content` emits `side` and `align`,
decided at render and fixed for the element's life, and emits **no** `data-open` / `data-closed`: it
would be asserting a fact the platform owns and the component cannot follow. The scope's controller
reconciles the pair from the element's own `:popover-open` at mount and on every state change.
`Dialog` and `Accordion.Item` do stamp an initial value, because `<dialog open>` and `<details open>`
are attributes the server genuinely sets — and the same controller then keeps them honest.

**A side is stamped at SSR, where the Worker cannot know the reader's direction, so `Side` carries
physical and logical spellings in one value space** (`src/ui/contracts/state-attrs.ts`). The
physical members stay, because a popup that must *not* mirror still needs them; there is
deliberately no separate logical type, since `data-side` is one attribute with one value space and
splitting the type would let a caller hold a value the attribute cannot express.

**The mechanism is physical declarations selected by `:dir()`, not logical CSS**
(`src/ui/assets/css/theme-base.css`). Both shorter spellings are wrong, and both are reliably
tempting. `anchor(inline-end)` is outright invalid — `<anchor-side>` has no logical keywords.
`inset-inline-start: anchor(start)` parses, but logical properties and `anchor()` resolve against
the **containing block's** writing mode, and a top-layer `position: fixed` popup's containing block
is the viewport, whose direction is the root element's: a `dir="rtl"` subtree inside an LTR document
resolves to the LTR answer, which is the original bug reintroduced through its own fix. `:dir()`
asks the *tree*, and the tree is the only thing that knows.

**Align runs on the axis perpendicular to the side, and is read in whichever vocabulary the side
used.** `inline-*` sides therefore align on the block axis, which does not mirror, so they join the
physical alignment rows verbatim; `block-*` sides align on the inline axis, which does, so those
rows are `:dir()`-keyed. `block-*` **placement** rows carry no `:dir()` at all — direction mirrors
the inline axis only, and `horizontal-tb` is the only writing mode forge ships.

`position-try-fallbacks` needs nothing added for any of this: `flip-inline` transforms *used*
declarations after the cascade has settled, so `:dir()` selection happens first and the flip
operates on its result.

**A component projects the subset its stylesheet can render.** `Tooltip`'s own block is a complete
*physical* matrix, so `tooltip.tsx` narrows its prop with `Exclude<Side, …>` — a logical value there
would match no rule and the popup would centre. Make the same projection for any component whose
rules cover one vocabulary only, so an unrenderable value is unrepresentable rather than silently
unstyled. `popover.tsx` narrows too but differently: `PopoverSide` is an independent literal union
rather than a projection of `Side`, so it does not track future growth of `Side` the way the
tooltip's does.

### 1i. Native-Input Primitive Decisions

**`Switch` publishes `data-label-position`** (`before` / `after`) for the label's placement relative
to the track. It is not `data-orientation`: orientation is the widget's own axis, and a switch is
always horizontal — the two would fight the moment a stylesheet matched on either.

**`ScrollArea` adds no behaviour to the platform's scrolling** — no scroll hijacking, no synthetic
thumb, no wheel listener.

### 1j. Derived Ids Must Be Id Tokens

**Every id forge derives for a form field must be a single id token, and a field whose `name` — or
whose non-blank `scope` — is not one derives no `id`, no `for` and no `aria-describedby` at all.**
HTML forbids ASCII whitespace inside an id and splits every IDREF list on it, so an id built from
such a value can be *declared* but never *named*: the browser tokenizes the reference into fragments
that match nothing. Deriving the same unusable string on both halves does not redeem it — the harm
is the platform's tokenization, not a disagreement between forge's two code paths. The field itself
still renders, and its `name` attribute is still passed through as the caller wrote it; only the
wiring is withheld. The predicates and the character set are `field.tsx`'s TSDoc to state, not this
document's.

**The hostile set is exactly HTML's ASCII whitespace, and JS `\s` is the wrong class for it.** `\s`
also matches U+00A0 and the Unicode spaces, which are legal id characters that no parser treats as a
separator. Using it was an active defect rather than a loose approximation: splitting an IDREF on a
non-breaking space breaks a resolvable id into pieces, so the declaration and the reference stop
agreeing byte-for-byte and forge manufactures the dangling reference the rule exists to prevent.

**Suppressing beat sanitizing** — collapsing whitespace would have forge rewrite caller input, which
it does not do (§1e emits the caller's `value` verbatim and lets only the readout follow the
platform), and any collapse maps distinct names onto one id, so two fields that were distinguishable
would silently share wiring.

**Suppressing beat throwing.** The ratified throw of §1c is for a component that cannot render at
all ([`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §2a); this component renders correctly and
only the association is unexpressible, which is a degraded field rather than a broken one.

**A blank `scope` is no scope; a whitespace-bearing one is not.** Blank falls back to the unscoped
id, because the caller named no scope. A non-blank scope that is not an id token **suppresses
instead of falling back**, since the unscoped id is precisely the one the scope exists to avoid
colliding with — falling back would re-create the cross-wiring the prop was introduced to fix.

**The rule governs references forge emits, not ids it merely declares.** The groups' per-item id is
declared and never named by any IDREF — the input is wrapped in its `<label>` — so it stays outside
the rule and round-trips a `value` verbatim. Giving any such id a reference means routing it through
the same gate first.

---

## 2. The Signal-Binding Seam

### 2a. The Binding Ownership Boundary

**Forge owns the generic glue between a control and a reactive signal; the app supplies the
signal record and any domain effects layered on it.** `fieldAttr` stamps the field name on the SSR
side and `bindField` reads it in the browser; **domain effects — persist, render, readouts,
pressed-state reconciliation — stay app-side** as additional effects on the same signals.

**`bindGroup` exists because button groups cannot express boolean or number values.** It resolves
the nearest `[data-field][data-value]` ancestor — handling inner `<svg>` / `<span>` click targets —
and writes the raw `data-value` string, bypassing value parsing.

### 2c. `ui/controls` — Bound Variants

**The static `ui/controls` barrel is the only bound-control API — there is no runtime factory to
call.** The single-element wrappers are built from an **internal** `createBoundControl` factory
(`@internal`, not exported), so their shape is uniform.

**`ToggleGroup` is bespoke, not factory-built** — its binding lives on the `.Item` sub-component
rather than the root, it stamps an extra `data-value`, and it delegates on `onClick`; the
single-element factory cannot express that shape.

**The name collision with `ui/core` is intentional and must not be renamed.**
[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5b owns the resulting rule: a module imports a
given control name from exactly one of the two barrels, never both.

### 2d. Scoped Components Require the Client Scope Import

Some `ui/core` components render a **resumable scope** — a region stamped with `data-scope` and
a serialized `data-state` whose behaviour wakes only once the matching scope is registered. The
scope registrations live in `@y-core/forge/ui/core/client`, a side-effect module an app must import
once in the client entry, before calling `resume()`.

Without it the markup still renders but no handler is registered, so **`resume()` warns on every
`data-scope` it finds unregistered. Treat that warning as a missing client-entry import or a
scope-name typo — never as an expected runtime condition.**

---

## 3. Class Utilities

`cn`, `asClass`, and `cva` are **ratified `@public` utilities** — apps compose classes with them
exactly as forge's own components do.

### 3d. Conflict Resolution and the Fail-Open Boundary

**Conflict resolution is a table lookup, and the table is `src/ui/core/utils/class-groups.ts`.** It
maps a utility to the name of the CSS concern it sets; `cn` keeps the last utility to claim a
concern and drops the earlier ones. The file is `@internal` and deliberately absent from every
barrel — it is data, not API — and it is **authoritative over any prose describing forge's covered
utility surface**. Nothing here enumerates it, and nothing anywhere else may: a second copy of a
table is indistinguishable from an amendment the moment the two disagree.

Two things scope a conflict beyond the concern itself: a utility's **modifier prefix** and its
**importance marker** both belong to the key, so `hover:h-5` never displaces `h-full`.

**The coverage boundary.** The table covers the families forge's own primitives emit plus those a
consumer override plausibly targets. **It is not a complete map of Tailwind and will never be.** A
utility outside it passes through untouched — so two conflicting utilities from an uncovered family
are *both* emitted and stylesheet order decides between them. That is the behaviour every consumer
already had before conflict resolution existed; an uncovered family is a gap, not a regression.

**Fail-open, and the inversion is deliberate.** An unrecognised utility is always kept, which
inverts the fail-closed posture of [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4a. The reasoning is
specific to this seam and does not generalise:

- The "failure" is **forge's incomplete knowledge of a third-party utility vocabulary**, not
  untrusted input. Nothing here is deciding whether to trust a caller.
- There is **no security boundary**. `cn` produces a `class` attribute the renderer escapes anyway
  (§1a), so dropping a token buys no safety.
- Failing closed would mean **silently deleting** a consumer's own class or a utility from a newer
  Tailwind — no error, no signal, and no fix available from outside forge.
- Failing open's worst case is the status quo ante, which every consumer already lives with.

**Importance is kept, diverging from the stated design reference.** forge keeps `!important` in the
conflict key, so a later *normal* utility cannot displace an earlier *important* one and
`cn("h-full!", "h-5")` keeps both. tailwind-merge strips importance and would drop the first. That
behaviour is wrong at the cascade — `!important` wins regardless of source order — so deleting the
important utility changes what renders. Where the reference is wrong about CSS, forge does not
follow it.

**Closed value spaces are matched by exact whole-utility entry; only open ones are matched by
prefix.** The reason is false positives: a `select-` prefix entry would let a consumer's
`select-wrapper` claim the user-select concern and silently delete a real `select-none`. A value
space that can be enumerated is enumerated.

**Known limitations.** Some covered utilities occupy a concern alone with no override edge to a
related one, so both survive — `cn("sr-only", "w-full")` emits both. Which families are covered at
all is `class-groups.ts`'s answer, not this document's.

**Extending the table is a data edit, not a decision.** Adding a family is one line in
`class-groups.ts` plus a test case, and needs no governing-document change, because additions
strictly **narrow** behaviour: a family moves from pass-through to resolved, and nothing that was
previously dropped starts surviving.

**The ratified decision is an in-house resolver, with tailwind-merge as a design reference only.**
The runtime dependency was declined: a Workers library pays its cost into every consumer bundle and
again per render on the SSR path, against a general-purpose Tailwind parser almost none of which
forge needs. The in-house table is tractable precisely because forge is a fixed set of primitives
rather than a general Tailwind consumer, which is what makes a bounded table a real option here and
not elsewhere.

**No cache was added, also deliberately.** A memo keyed on the argument list would be unbounded
mutable module state needing its own eviction policy — against
[`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1 — and Cloudflare evicts isolates
aggressively enough that a cold refill is paid often rather than amortised. It is retrofittable
behind the unchanged signature if a profile ever demands one.

---

## 4. State Attribute Contract

**State attributes are the styling hooks CSS matches on to react to a component's state**, and they
are declared **once**, in a module both tiers import. It earns a section of its own rather than a
place under §1 because it is not an SSR concern: it is the one contract the server-rendered
component and the browser controller must agree on, and neither owns it.

The reason is that a state attribute is written in **two places that cannot see each other** — an
SSR component that runs on the Worker, and a client controller that runs in the browser. Nothing but
a shared declaration keeps those in step, and drift here is *silent*: the selector simply stops
matching, so the component looks unstyled rather than broken. The same argument produced the
delegated-event vocabulary ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c); this is its
sibling.

**The declaration is `src/ui/contracts/state-attrs.ts`, and it is authoritative over any prose
naming forge's state attributes.** Nothing here enumerates it, for the reason §3d gives about
`class-groups.ts`.

**Adding a styling hook means adding it to that declaration first.** A component that emits a state
attribute outside the table fails a conformance test — smuggling a hook past it is the exact failure
the single declaration exists to prevent.

**And a name with no producer is removed, for the same reason.** `data-anchor-hidden` was declared
there and written by nothing — no component, no controller. A declared hook that is never emitted is
the *inverse* of the drift above and just as misleading: a consumer styles against it and gets a rule
that can never match. It was deleted when the table became public, because after publication a
deletion is a breaking change. Re-add it with its producer, not before.

`data-popup-open` was in the same position and took the **other** exit: it named something a trigger
genuinely knows — its own state while the popup it controls is open, distinct from the popup's
`data-open` — so it got a producer, `mountPopupTriggerState`
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §6d), rather than a deletion. Which exit a
producerless hook takes is the whole question — *is there an element whose state this describes?*
`data-anchor-hidden` had no such element.

**`data-selected` is not `data-checked`.** ARIA models tab selection as `aria-selected`, not
`aria-checked`, so reusing `data-checked` would announce a tab as a radio; and calling it structural
rather than a state would be false, because it is precisely a state a stylesheet reacts to.

### 4a. Presence, Not Value

**Boolean states are emitted by presence, with an empty value — `data-open=""`, never
`data-open="true"`.** `[data-open]` is a cheaper and a more honest selector than
`[data-open="true"]`, and a false state emits nothing at all, so an unstyled state costs no bytes.

The valued attributes — `data-orientation`, `data-side`, `data-align` — are the exception, because
they carry a choice rather than a flag.

### 4b. ARIA States Are Not Styling Hooks

**A component emits both** — `aria-pressed="true"` beside `data-pressed`, `aria-selected` beside
`data-selected` — and that duplication is deliberate rather than redundant.

`aria-*` keeps its `"true"` / `"false"` string form because WAI-ARIA requires it. The whole point of
the `data-` hook beside it is that **CSS should not have to read ARIA**: a stylesheet matching
`[aria-pressed="true"]` couples presentation to an accessibility contract, so the day the correct
ARIA for a widget changes, the styling breaks with it. The two are reconciled together by one
function, so a controller can never write one without the other.

### 4c. The Caller Is Authoritative

**A caller's explicit state attribute wins over the component's computed one**, which is the same
principle as class precedence (§3d) applied to a different mechanism: **the caller is authoritative
over both the class list and the state attributes.** Here the mechanism is spread order — a
component spreading `{...stateAttrs({…})}` onto the element that also takes forwarded caller props
spreads it **before** `{...props}` / `{...rest}`, so the duplicate key resolves to the caller's.
Where the two land on different elements nothing collides. The rule is asserted for every
participating component by the `ui/core` conformance sweep (`src/ui/core/conformance.test.tsx`),
with a `ui/chrome` case in `toolbar.test.tsx`.
