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
- §1a Universal DOM Attribute Pass-Through: no class-only components; why `style` is dropped
- §1b FormField versus Field: the two field primitives and when each applies
- §1c Button and the asChild Invariant: the ratified throw
- §1d Icon Accessibility and createIcon Typing: decorative by default; name narrowing
- §1e Switch and Slider — CSS-Only Controls: no client JS, and what stays consumer-side
- §1f Turnstile — Server-Rendered Mount Point: deliberate omission of auto-render
- §1g Composite Widgets: one tab stop, and the markers that make it one
- §1h Overlays and Disclosures: native popover and native `<details>`; how a popup's side resolves
  against the reader's direction
- §1i Native-Input Primitives: groups, meter, number field, scroll area
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a fieldAttr, bindField, and bindGroup: what forge owns and what the app supplies
- §2b bind versus field — Orthogonal Props: two contracts that may coexist
- §2c ui/controls — Bound Variants: the factory, the table, and the bespoke case
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3a cn — Conditional Class Names: the variadic filter-and-join
- §3b asClass — Narrow a JSX class Prop: safe caller overrides
- §3c cva — Class Variance Authority: variant resolution
- §4 State Attribute Contract: the styling hooks, declared once for both tiers
- §4a Presence, Not Value: why `data-open` and never `data-open="true"`
- §4b ARIA States Are Not Styling Hooks: why both are emitted

---

## 1. ui/core Component Contract

### 1a. Universal DOM Attribute Pass-Through

**Every `ui/core` component extends the intrinsic props for its root tag
(`JSX.IntrinsicElements[tag]`) and spreads unrecognized props onto that element.**

**There are no class-only components.** Any standard HTML attribute, `data-*`, `aria-*`, or
`hx-*` attribute passes straight through.

**`style` is dropped deliberately** — forge's CSP carries no `style-src 'unsafe-inline'`, so an
inline style attribute could never take effect. Use `class` and the theme tokens.

The renderer HTML-escapes forwarded values, and routes URL-bearing attributes (`href`, `src`,
`action`, `formaction`, `poster`, `cite`, `background`) through `safeUrl` — a `javascript:`-style
value collapses to `"#"`. **This is automatic; components never call it.** See
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d.

htmx selector and JSON attributes are **not** sanitized — [`HTMX.md`](./HTMX.md) §7 owns that
trust obligation.

### 1b. FormField versus Field

Two field primitives exist, and choosing the wrong one produces markup that is either
over- or under-structured:

- **`FormField`** is the `<fieldset>`-based **accessible form field**. Use it when you need
  `name` / `invalid` / error / description wiring. Its compound members auto-wire `for`, `id`,
  and `aria-describedby` from the field name.
- **`Field`** is a lightweight **layout** primitive — a caption bound to its control children,
  with no form semantics. Use it for settings rows and labelled controls that are not validated
  form fields.

### 1c. Button and the `asChild` Invariant

`asChild` merges the button's classes and forwarded props onto a single JSX element child via
`cloneElement`, instead of emitting a `<button>`.

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

### 1d. Icon Accessibility and `createIcon` Typing

**`Icon` is decorative by default** — `aria-hidden="true"`, no accessible name.

**Passing `aria-label` flips it to a labelled graphic**: the icon emits `role="img"` with that
label and drops `aria-hidden`, so assistive technology announces it.

`createIcon(sprite, meta)` binds a sprite URL to a typed `ForgeIcon` whose `name` is narrowed to
the sprite's keys, with the viewBox resolved from `meta`. **`createIcon(sprite)` — no `meta` —
yields a permissive `ForgeIcon<string>`** for apps whose icon set is not known at compile time;
the viewBox then comes from the prop.

**A `ForgeIcon<string>` is assignable to any narrower `ForgeIcon<Name>`** (contravariance), so a
dynamic icon set still satisfies a component that demands a specific icon.

### 1e. Switch and Slider — CSS-Only Controls

**Both render without any client JavaScript.** `Switch` is an `sr-only`
`<input type="checkbox" role="switch">` holding state and focus, with utilities painting the
decorative track and thumb off the native `:checked`. `Slider` is a native `<input type="range">`
styled cross-browser.

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

**`Slider`'s `output` prop wraps it in an `<output>` readout seeded to `value`. Mirroring that
readout on input is a consumer concern** — forge stays markup-only (§1a).

Both take an optional `field` descriptor that wires `id` / `name` / `aria-*`.

### 1f. Turnstile — Server-Rendered Mount Point

`Turnstile` renders a `[data-ref='turnstile']` container carrying `data-sitekey` and
`data-size`, holding a hidden `[data-ref='turnstile-fallback']` message.

**It deliberately omits Cloudflare's `cf-turnstile` auto-render class** — the client controller
owns rendering, so the widget lifecycle is deterministic rather than implicit.

**Place the component inside the `<form>`** so the hidden token input Cloudflare injects is
submitted with the form.

**`siteKey` is injected server-side from the Worker env — never hardcoded.** The markup is inert
on its own; pair it with the client controller
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2c).

### 1g. Composite Widgets

A **composite** is a widget made of many focusable items that behaves as **one tab stop**: exactly
one item is reachable with Tab, and the arrow keys move among the rest. `Toolbar`, `Menu`, `Tabs`
and `ToggleGroup` are the four, and they share one controller
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §6b).

**The markup declares which elements are items; the controller never guesses.** How it declares
them differs by widget, and each choice is deliberate:

| Widget | Root | How items are identified |
|---|---|---|
| `Toolbar` | `role="toolbar"`, `data-scope="toolbar"` | an explicit `data-toolbar-item` marker |
| `Menu` | `role="menu"` on the popup, `data-scope="menu"` | the ARIA roles `menuitem` / `menuitemcheckbox` / `menuitemradio` |
| `Tabs` | `data-scope="tabs"`, `role="tablist"` on the list | `role="tab"` |

**`Toolbar` uses a marker rather than a `data-slot` prefix** because `Toolbar.Group` and
`Toolbar.Separator` are toolbar slots that must *not* be focus stops, and a prefix selector cannot
express the exception. The marker is public: any foreign element inside a toolbar opts in by
carrying it, which is how an icon rail keeps its own buttons and still becomes one tab stop.

**`Menu` identifies items by ARIA role rather than by a forge-specific attribute**, and that is
load-bearing for a menu whose rows are built in the browser: a runtime-constructed row is navigable
the moment it is a correctly-roled menu item, with nothing forge-specific to remember to stamp.
`Menu.LinkItem` is an `<a role="menuitem">` for rows that navigate — it keeps middle-click,
open-in-new-tab and no-JavaScript navigation, all of which a `<button>` drops — and
`Menu.SubmenuTrigger` is the roled trigger a nested popup needs, since a bare `Menu.Trigger` carries
no role and would be skipped by the parent's arrow navigation.

**`ToggleGroup` announces what it actually is.** It emits no `role` at all — `<fieldset>` already
has an implicit `group` — where it previously hardcoded `role="toolbar"` for every group, which
announced a segmented control as a toolbar and offered the wrong interaction model. Its `type` prop
(`"single" | "multiple"`) is published as `data-multiple`, present exactly when several items may be
pressed at once, and that is what the client reads to decide whether a click replaces the pressed
item or adds to it (§2a).

**`Tabs` carries `data-activation`** — `automatic` selects a tab as focus reaches it, `manual`
waits for a click or Enter. An unselected `Tabs.Panel` is `hidden`, which is the platform's own
mechanism: the initial render is correct with no JavaScript, and the controller flips the same
attribute.

### 1h. Overlays and Disclosures

**Nothing here re-creates a platform overlay in JavaScript.** `Menu` and `Tooltip` are built on the
native Popover API, `Dialog` on native `<dialog>`, and `Collapsible` on native `<details>`, so the
top layer, light-dismiss, Escape, exclusive-open and the disclosure toggle are all the platform's
and cost nothing.

- **`Menu`** — trigger is `<button command="toggle-popover" commandfor={id}>`, popup is
  `<div popover="auto" role="menu">`, and an item closes the menu with `command="hide-popover"`.
  Opening, closing and dismissing therefore involve **no JavaScript at all**; the client adds only
  what ARIA's menu pattern asks for and the platform does not supply (§1g).
- **`Collapsible`** — a `<details>`/`<summary>` pair. **`<details>` owns open and closed**; the
  controller only *publishes* them as state attributes for CSS to react to (§4).
- **`Tooltip`** — a `popover="hint"` surface, so it does not close the menu or dialog beneath it.
- **`Accordion`** — several `Collapsible`s in a stack. Not a composite: each item is its own
  disclosure and its own tab stop, because that is what a native `<details>` list is.

**An item that must leave its menu open passes `for={false}`**, which omits the
`command="hide-popover"` pair — the shape a checkbox row in a menu needs.

**Every overlay stamps a scope, and every one of those scopes is eager.** `Dialog` stamps
`DIALOG_SCOPE`, `Popover.Content` stamps `POPOVER_SCOPE` (both in
`contracts/overlay-contract.ts`), and each `Accordion.Item` stamps `ACCORDION_SCOPE` beside
`Collapsible`'s in `contracts/toggle-contract.ts`. Eager out of *necessity*, not taste: an overlay's
markup carries no `data-on-*` action at all — opening, closing, Escape and light-dismiss are the
platform's — so a lazy scope would have nothing to resume it, and every state attribute would stay
frozen at its server-rendered value (§2d).

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

### 1i. Native-Input Primitives

Five primitives that are a native control plus SSR field wiring, and nothing more:

- **`CheckboxGroup` / `RadioGroup`** — a `<fieldset>` of real `<input type="checkbox">` /
  `<input type="radio">`. **Radio grouping and roving focus inside a radio group are the platform's**;
  forge adds the field wiring and the state attributes, not a keyboard controller.
- **`Meter`** — a native `<meter>`. Distinct from `Progress`: a meter is a *measurement within a
  known range*, a progress bar is *task completion*, and conflating them announces the wrong thing.
- **`NumberField`** — a native numeric `<input>` with stepper buttons. The steppers carry no
  `data-on-*` action, so its scope is eager (§2d): a lazy scope would have nothing to resume it and
  the buttons would sit inert.
- **`ScrollArea`** — almost entirely CSS. A viewport with styled scrollbars; no scroll hijacking, no
  synthetic thumb, no wheel listener.

**`Switch` publishes `data-label-position`** (`before` / `after`) for the label's placement relative
to the track. It is not `data-orientation`: orientation is the widget's own axis, and a switch is
always horizontal — the two would fight the moment a stylesheet matched on either.

---

## 2. The Signal-Binding Seam

### 2a. `fieldAttr`, `bindField`, and `bindGroup`

**Forge owns the generic glue between a control and a reactive signal; the app supplies the
signal record and any domain effects layered on it.**

`fieldAttr(name)` (from `ui/server`) stamps `data-field` on the SSR side. `bindField(signals)`
(from `ui/client`) returns a resumable-scope action that reads `data-field`, parses the
control's value by the target signal's current type, and writes `signals[field]`.
`applyControlValue` is the inverse, seeding an uncontrolled input from a typed value.

**`bindGroup` exists because button groups cannot express boolean or number values.** It
resolves `el.closest("[data-field][data-value]")` — handling inner `<svg>` / `<span>` click
targets — and writes the raw `data-value` string, bypassing value parsing.

**Domain effects — persist, render, readouts, pressed-state reconciliation — stay app-side** as
additional effects on the same signals.

### 2b. `bind` versus `field` — Orthogonal Props

Two similarly-named props drive different contracts, and they may coexist on one control:

- **`bind`** (on the `ui/controls` wrappers, §2c) drives the `data-field` / `data-on-*`
  signal-binding contract.
- **`field?: FieldDescriptor`** (on `Input` / `Select` / `Switch`) drives `id` / `name` /
  `aria-*` form-accessibility wiring.

### 2c. `ui/controls` — Bound Variants

`@y-core/forge/ui/controls` re-exports `Input`, `Textarea`, `Select`, `Slider`, `Switch`, and
`ToggleGroup` under the **same names** as `ui/core`, as bound variants. Each wraps its `ui/core`
base and adds a required `bind` prop plus an optional `action` override, pre-spreading
`scopeAttrs` + `fieldAttr` so the control joins the signal contract without a manual spread.

**The static `ui/controls` barrel is the only bound-control API — there is no runtime factory to
call.**

The five single-element wrappers are built from an **internal** `createBoundControl` factory
(`@internal`, not exported), so their shape is uniform:

| Bound control | Delegated event → `data-on-*` | Default action |
|---|---|---|
| `Input`, `Textarea`, `Slider` | `onInput` | `bindField` |
| `Switch`, `Select` | `onChange` | `bindField` |
| `ToggleGroup.Item` | `onClick` | `bindGroup` |

**`ToggleGroup` is bespoke, not factory-built** — its binding lives on the `.Item`
sub-component rather than the root, it stamps an extra `data-value`, and it delegates on
`onClick`; the single-element factory cannot express that shape.

**The name collision with `ui/core` is intentional and must not be renamed.**
[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5b owns the resulting rule: a module imports a
given control name from exactly one of the two barrels, never both.

### 2d. Scoped Components Require the Client Scope Import

Some `ui/core` components render a **resumable scope** — a region stamped with `data-scope` and
a serialized `data-state` whose behaviour wakes only once the matching scope is registered.
`Toast` is such a component, and therefore so are the `ui/server` `Flash` wrappers built on it.

**The scope registrations live in `@y-core/forge/ui/core/client`, a side-effect module. An app
rendering any scoped component must import it once in the client entry, before calling
`resume()`.**

```typescript
import "@y-core/forge/ui/core/client"   // registers the toast + alert scopes
import { resume } from "@y-core/forge/ui/client"

resume()
```

Without it the markup still renders but no handler is registered, so **`resume()` warns on every
`data-scope` it finds unregistered. Treat that warning as a missing client-entry import or a
scope-name typo — never as an expected runtime condition.**

---

## 3. Class Utilities

`cn`, `asClass`, and `cva` are exported from `@y-core/forge/ui/core` and are **ratified
`@public` utilities** — apps compose classes with them exactly as forge's own components do.

### 3a. `cn` — Conditional Class Names

`cn(...classes)` is variadic over `string | false | null | undefined`: it filters falsy entries
and joins the rest with a single space. **It is the canonical way to merge a component's base
classes with a caller-supplied `class`.**

**Use short-circuit expressions for conditionals** — `cn("base", isActive && "active", cls)`.
`cn` does not interpret arrays or objects.

### 3b. `asClass` — Narrow a JSX `class` Prop

`asClass(cls)` narrows an untyped JSX `class` prop — which the runtime may hand you as a
non-string — to `string | undefined`, returning `undefined` for any non-string.

**Pair it with `cn`** — `cn(BASE, asClass(cls))` — so a caller override merges safely.

### 3c. `cva` — Class Variance Authority

`cva({ base?, variants?, defaultVariants? })` returns a resolver. Call it with the selected
variant values to produce the composed class string; pass a `class` field to append a call-site
override.

```typescript
const buttonVariants = cva({
  base: "inline-flex items-center rounded-md font-medium",
  variants: {
    variant: { primary: "bg-primary text-white", outline: "border border-input" },
    size:    { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-base" },
  },
  defaultVariants: { variant: "primary", size: "md" },
})
```

**Combine with `cn` when additional conditional classes are needed** —
`cn(buttonVariants({ variant }), isLoading && "opacity-50")`.

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

The declared hooks:

| Attribute | Meaning |
|---|---|
| `data-open` / `data-closed` | a popup, disclosure or overlay is open / closed — the pair is exhaustive, exactly one is always present |
| `data-pressed` | a pressable trigger or toggle item is pressed |
| `data-checked` | a checkable control is checked |
| `data-selected` | a tab is the selected one |
| `data-disabled` | the component is disabled |
| `data-invalid` | the component holds a validation error |
| `data-orientation` | layout axis — `horizontal` or `vertical`. Valued |
| `data-side` / `data-align` | which side a popup sits on relative to its anchor, and how it aligns along it. Valued; `data-side` admits physical and logical spellings in one value space (§1h) |
| `data-starting-style` / `data-ending-style` | present while animating in / out |
| `data-popup-open` | on a **trigger**, while the popup it controls is open — the trigger's own state, distinct from `data-open`, which belongs to the popup. Produced by `mountPopupTriggerState` ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §6d) |

**Adding a styling hook means adding it to that declaration first.** A component that emits a state
attribute outside the table fails a conformance test — smuggling a hook past it is the exact failure
the single declaration exists to prevent.

**And a name with no producer is removed, for the same reason.** `data-anchor-hidden` was declared
here and in `STATE_ATTRS` and written by nothing — no component, no controller. A declared hook that
is never emitted is the *inverse* of the drift above and just as misleading: a consumer styles against
it and gets a rule that can never match. It was deleted when the table became public, because after
publication a deletion is a breaking change. Re-add it with its producer, not before.

`data-popup-open` was in the same position and took the **other** exit: it named something a trigger
genuinely knows, so it got a producer rather than a deletion. Which exit a producerless hook takes is
the whole question — *is there an element whose state this describes?* `data-anchor-hidden` had no
such element.

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
