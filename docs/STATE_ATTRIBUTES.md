---
title: State and Presentational Attributes
description: "The data-* vocabulary a forge element emits: the state hooks both tiers share, the presentational enums, the island payload, and a closed-world conformance sweep that holds them to one declaration."
audience: consumer
---

# State and Presentational Attributes

> Owns every `data-*` attribute a forge element emits and the declarations they are drawn from: the state hooks in
> `src/ui/contracts/state-attrs.ts`, the presentational enums and the island payload in `src/ui/contracts/`, the `data-slot` token, and the
> conformance sweep that fails when an element emits a name no declaration carries.
>
> Defers to: [`UI_SSR_COMPONENTS.md`][usc-1m] §1m for the prop vocabulary the presentational attributes mirror, and
> [`UI_CLASS_COMPOSITION.md`][ucc-1a] §1a and §1e for class precedence and the recipe layer; [`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c for the
> delegated-event vocabulary this contract shares its argument with; `src/ui/README.md` for which component takes which prop.

---

## 0. Quick Reference

- §1 State Attribute Contract: one declaration two tiers must agree on
- §1a Presence, Not Value: why `data-selected` and never `data-selected="true"`
- §1b ARIA States Are Not Styling Hooks: why both are emitted
- §1c The Caller Is Authoritative: class precedence and state precedence as one rule
- §1d Busy Is Server-Stamped, and a Request Is Not: the writers, and what stays htmx's
- §2 Presentational Attributes Are Declared Too: the enum half of the vocabulary, and the frozen-hook technique it keeps
- §3 The Island Payload Is Not a State Enum: why the serialized state carries its own attribute name
- §4 The Sweep Is Closed-World: the inverted assertion, the stateful probe, and the independent override expectation
- §5 The `data-slot` Token: the addressable root, and the wrapper splits that are declared rather than silent

---

## 1. State Attribute Contract

**State attributes are the styling hooks CSS matches on, declared once in `src/ui/contracts/state-attrs.ts`, which both tiers import**, because the
server component and the browser controller write them in two places that cannot see each other, and drift is silent: the selector stops matching
and the component looks unstyled rather than broken. The declaration is authoritative over any prose naming forge's state attributes; nothing here
enumerates it.

**Adding a styling hook means adding it to that declaration first.** A component that emits a state attribute outside the table fails the
conformance sweep (§4) — smuggling a hook past it is the exact failure the single declaration exists to prevent.

<!-- rule:forge-state-attr-has-producer --> A hook that is never emitted is the _inverse_ of the drift above and just as misleading: a consumer
styles against a rule that can never match. A hook describing a state no selector can reach gets a controller; one a selector already reaches —
`:has()` on a popup's own `:popover-open` — is deleted.

**`data-selected` is not `data-checked`.** ARIA models tab selection as `aria-selected`, not `aria-checked`, so reusing `data-checked` would
announce a tab as a radio; and calling it structural rather than a state would be false, because it is precisely a state a stylesheet reacts to.

### 1a. Presence, Not Value

<!-- rule:forge-state-presence-empty --> `[data-selected]` is a cheaper and a more honest selector, and a false state emits nothing at all. The
declaration marks the few valued attributes as such: they carry a choice rather than a flag. `data-state` is the valued state a component computes
from its own enum, and it is never a serialized payload (§3).

**A state the platform already exposes is not in the table** ([`UI_SSR_COMPONENTS.md`][usc-3e] §3e); republishing it as a `data-` flag would be a
second copy of a fact forge does not own.

### 1b. ARIA States Are Not Styling Hooks

**A component emits both** — `aria-pressed="true"` beside `data-pressed` — and that duplication is deliberate. `aria-*` keeps its `"true"` /
`"false"` string form because WAI-ARIA requires it, and the whole point of the `data-` hook beside it is that **CSS should not have to read ARIA**:
a stylesheet matching `[aria-pressed="true"]` couples presentation to an accessibility contract, so the day the correct ARIA for a widget changes,
the styling breaks with it.

**Writing the pair is the controller's own step, and deliberately not one function's**: `applyStateAttrs` reconciles the `data-` half and the
controller writes the ARIA half beside it, because which ARIA attribute a state maps to is the widget's question — `selected` is `aria-selected` on
a tab and `aria-current` on a carousel dot. **Every client repaint is pinned by its controller's co-located test reading both halves.**

**The pairing is a licence to emit the hook, not to emit it unreconciled**: a `data-` attribute no controller updates and no stylesheet reads is
deleted rather than kept for symmetry, which is why `Toggle` and `ToggleGroup.Item` emit no `data-pressed`.

**`aria-orientation` is emitted on both axes, including the role's default**, where the design reference omits the default value. An attribute
present exactly when a caller passed a non-default is one a test has to assert two ways and a reader has to know a role table to interpret.

### 1c. The Caller Is Authoritative

**The caller is authoritative over both the class list and the state attributes** — the same principle as class precedence
([`UI_CLASS_COMPOSITION.md`][ucc-1a] §1a) on a different mechanism. A component spreads its state attributes **before** the forwarded caller props,
so a duplicate key resolves to the caller's, and the `ui/core` conformance sweep asserts it for every participating component.

### 1d. Busy Is Server-Stamped, and a Request Is Not

**A busy component emits `data-busy` beside `aria-busy="true"`**, for §1b's reason on a second mechanism: `state-busy`
([`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e) is what paints it, and a rule reading `[aria-busy="true"]` would key the paint off an accessibility
contract instead.

**The writers describe the markup rather than a network.** `Button`'s `loading` marks a press whose work has started, stamping
both attributes whether or not a `loadingIcon` is passed to render a `Spinner` before the children; the field controls take a `busy` prop for a
control that cannot yet accept a value.

**A request in flight stays htmx's.** `htmx-indicator` is the request-driven path, because the request is a fact the client owns and a server may
only stamp what it can keep true ([`UI_SSR_COMPONENTS.md`][usc-3e] §3e); the rule is `forge-ui-htmx-indicator-on-control` in
`src/ui/design/reference/11-htmx.md`.

---

## 2. Presentational Attributes Are Declared Too

<!-- rule:forge-attr-vocabulary-via-helper --> The enum half of the vocabulary — the styling hooks that carry a _choice_ rather than a flag,
`data-tone` and `data-size` among them — is declared beside the state half, and spelling one as a string literal in the component that emits it is
the same two-places-that-cannot-see-each-other problem §1 solves for the boolean states, with the same silent failure mode: a stylesheet is written
against a name, and nothing holds a literal to a declaration.

**They are the attribute mirror of the prop vocabulary** ([`UI_SSR_COMPONENTS.md`][usc-1m] §1m), so the declaration is one list and not two: a prop
drawn from the ratified vocabulary becomes an attribute drawn from the same names.

<!-- rule:forge-attr-table-no-dynamic-key --> **The frozen-hook technique from `state-attrs.ts` carries over unchanged**: a runtime member access on
the declaration table retains the whole table in every consumer bundle, so the attribute names are reached as frozen module-scope constants.

## 3. The Island Payload Is Not a State Enum

<!-- rule:forge-island-state-attr --> One shared name would carry two grammars — a component's enum and a JSON object — that the reader cannot tell
apart: `hydrateState` throws unless the value parses to a JSON object, so a component spreading `...rest` onto an element that also carries an enum
would make `resume()` throw from markup that type-checks.

**The split is by name, not by a parse-and-guess**, because a tolerant reader would swallow a genuinely corrupt payload, the failure `resume()`
exists to report.

## 4. The Sweep Is Closed-World

**The sweeps assert that every `data-*` a forge element emits is declared** — in the state table, in §2's presentational set, or in the wiring
vocabulary, which carries its reason beside each name — and never filter the rendered attributes to the declared set first, which would make the
comparison unfalsifiable.

**Each sweep sees different things, which is why they are separate.** One **renders** probes and reads the attributes off the markup, so it sees
what ships and nothing a component merely mentions; the other **scans source text**, so it reaches the namespaces no probe mounts — at the cost of
matching Tailwind arbitrary-variant spellings and selector strings as well as emitted attributes.

**The vocabulary is declared once and derived from the constants that already name it**, so a rename carries the allowlist with it. The table is
read by tests only, for §1's frozen-hook reason. Each sweep declares its own extras rather than widening the shared set.

**A name nothing emits fails, so the list can only shrink.** That assertion belongs to the source scan alone: only it can tell "unused" from "not
rendered here".

**Wiring versus enum decides where a name goes.** A name driving a `cva` variant is presentational and belongs in §2's declared table; a name
kept in wiring records its reason where it is declared.

**The probe renders each component twice — once bare, once with every boolean state prop set.** A component emits a boolean state hook only when
the corresponding prop is true, so a sweep over a default render reaches none of them and the hooks the contract exists for are exactly the ones it
never sees.

**The precedence expectation is derived independently of the table it checks.** Building both sides of an assertion from the same input proves the
input equals itself; the override case states the caller's value literally, so a change to the declaration cannot silently rewrite what the test
demands.

## 5. The `data-slot` Token

**Every forge element a caller may need to reach carries a `data-slot`, and a root composes its own token with an inherited one rather than
hardcoding it** — `slotToken(own, inherited)`, so a component nested inside another stays addressable as both.

**Some components render their `data-slot` on an inner element rather than the root, and that is declared rather than silent.** A root such as
`Switch`'s is a wrapper whose interesting element is the control inside it, so the token names the control; §4's conformance sweep carries one entry
per split with the reason it is a split. It holds the pair both ways: a `classSlot` with no reason beside it fails, and a reason with no split to
explain fails too.

**`forge/data-slot-before-spread` does not catch this and is not extended to**: it checks a slot attribute's ordering against forwarded props, never
its placement in the tree, and the sweep's table is already the record.

[ucc-1a]: ./UI_CLASS_COMPOSITION.md#1a-conflict-resolution-the-fail-open-boundary-and-the-memo
[ucc-1e]: ./UI_CLASS_COMPOSITION.md#1e-the-utility-recipe-layer
[ucr-3c]: ./UI_CLIENT_RUNTIME.md#3c-resumable-scopes
[usc-1m]: ./UI_SSR_COMPONENTS.md#1m-the-prop-vocabulary
[usc-3e]: ./UI_SSR_COMPONENTS.md#3e-stamp-only-what-the-server-can-keep-true
