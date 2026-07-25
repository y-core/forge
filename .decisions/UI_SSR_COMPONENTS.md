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
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a fieldAttr, bindField, and bindGroup: what forge owns and what the app supplies
- §2b bind versus field — Orthogonal Props: two contracts that may coexist
- §2c ui/controls — Bound Variants: the factory, the table, and the bespoke case
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3a cn — Conditional Class Names: the variadic filter-and-join
- §3b asClass — Narrow a JSX class Prop: safe caller overrides
- §3c cva — Class Variance Authority: variant resolution

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
`<input type="checkbox" role="switch">` holding state and focus, with sibling `peer-checked:` /
`peer-focus-visible:` utilities painting the decorative track and thumb. `Slider` is a native
`<input type="range">` styled cross-browser.

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
