---
title: State and Presentational Attributes
description: "The data-* vocabulary a forge element emits: the state hooks both tiers share, the presentational enums, the island payload, and the closed-world sweep that holds them to one declaration."
---

# State and Presentational Attributes

> Owns every `data-*` attribute a forge element emits and the declarations they are drawn from:
> the state hooks in `src/ui/contracts/state-attrs.ts`, the presentational enums and the island
> payload in `src/ui/contracts/`, the `data-slot` token, and the conformance sweep that fails when
> an element emits a name no declaration carries.
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1m for the prop vocabulary the
> presentational attributes mirror, and
> [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1a and §1e for class precedence and the recipe
> layer; [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c for the delegated-event vocabulary this
> contract shares its argument with; `src/ui/README.md` for which component takes which prop.

---

## 0. Quick Reference

- §1 State Attribute Contract: one declaration two tiers must agree on
- §1a Presence, Not Value: why `data-selected` and never `data-selected="true"`
- §1b ARIA States Are Not Styling Hooks: why both are emitted
- §1c The Caller Is Authoritative: class precedence and state precedence as one rule
- §1d Busy Is Server-Stamped, and a Request Is Not: the two writers, and what stays htmx's
- §2 Presentational Attributes Are Declared Too: the enum half of the vocabulary, and the frozen-hook technique it keeps
- §3 The Island Payload Is Not a Presentational Enum: why the serialized state carries its own attribute name
- §4 The Sweep Is Closed-World: the inverted assertion, the stateful probe, and the independent override expectation
- §5 The `data-slot` Token: the addressable root, and the wrapper splits that are declared rather than silent

---

## 1. State Attribute Contract

**State attributes are the styling hooks CSS matches on to react to a component's state, and they
are declared once, in `src/ui/contracts/state-attrs.ts`, which both tiers import.** Neither the
server-rendered component nor the browser controller owns the contract: a state attribute is written
in **two places that cannot see each other**, and drift is _silent_ — the selector stops matching, so
the component looks unstyled rather than broken. The same argument produced the delegated-event
vocabulary ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c). The declaration is authoritative
over any prose naming forge's state attributes, and nothing here enumerates it, for the reason
[`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1a gives about `class-groups.ts`.

**Adding a styling hook means adding it to that declaration first.** A component that emits a state
attribute outside the table fails the conformance sweep (§4) — smuggling a hook past it is the exact
failure the single declaration exists to prevent.

**And a declared name with no producer is removed.** A hook that is never emitted is the _inverse_
of the drift above and just as misleading: a consumer styles against it and gets a rule that can
never match — so a hook is added with its producer, never ahead of it. The question such a hook has
to answer is whether it describes a state a selector cannot already reach. Where the answer is yes
it gets a controller rather than a deletion; where a selector already reaches the state — `:has()`
reading a popup's own `:popover-open` from the trigger's rule — it goes.

**`data-selected` is not `data-checked`.** ARIA models tab selection as `aria-selected`, not
`aria-checked`, so reusing `data-checked` would announce a tab as a radio; and calling it structural
rather than a state would be false, because it is precisely a state a stylesheet reacts to.

### 1a. Presence, Not Value

**Boolean states are emitted by presence, with an empty value — `data-selected=""`, never
`data-selected="true"`.** `[data-selected]` is a cheaper and a more honest selector, and a false state
emits nothing at all. The declaration marks the few valued attributes as such: they carry a choice
rather than a flag.

**A state the platform already exposes is not in the table**
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h); republishing it as a `data-` flag would be a
second copy of a fact forge does not own.

### 1b. ARIA States Are Not Styling Hooks

**A component emits both** — `aria-pressed="true"` beside `data-pressed` — and that duplication is
deliberate. `aria-*` keeps its `"true"` / `"false"` string form because WAI-ARIA requires it, and the
whole point of the `data-` hook beside it is that **CSS should not have to read ARIA**: a stylesheet
matching `[aria-pressed="true"]` couples presentation to an accessibility contract, so the day the
correct ARIA for a widget changes, the styling breaks with it. The two are reconciled together by one
function, so a controller can never write one without the other.

**The pairing is a licence to emit the hook, not a licence to emit it unreconciled.** A `data-`
attribute no controller ever updates and no stylesheet ever reads is not a hook at all — it is a
claim the markup makes once and cannot keep, so it is deleted rather than kept for symmetry. That is
why `Toggle` and `ToggleGroup.Item` emit no `data-pressed`: nothing reads it and nothing reconciles
it, so it could only ever go stale on the first press.

**`aria-orientation` is emitted on both axes, including the role's default**, where the design
reference omits the default value. An attribute present exactly when a caller passed a non-default
is one a test has to assert two ways and a reader has to know a role table to interpret.

### 1c. The Caller Is Authoritative

**The caller is authoritative over both the class list and the state attributes** — the same
principle as class precedence ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1a) on a different
mechanism. A component spreads its state attributes **before** the forwarded caller props, so a
duplicate key resolves to the caller's, and the `ui/core` conformance sweep asserts it for every
participating component.

### 1d. Busy Is Server-Stamped, and a Request Is Not

**A busy component emits `data-busy` beside `aria-busy="true"`**, for §1b's reason on a second
mechanism: `state-busy` ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1e) is what paints it, and
a rule reading `[aria-busy="true"]` would key the paint off an accessibility contract instead.

**There are two writers, and both describe the markup rather than a network.** `Button`'s `loading`
marks a press whose work has started, stamping both attributes whether or not a `loadingIcon` is
passed to render a `Spinner` before the children; the field controls take a `busy` prop for a
control that cannot yet accept a value.

**A request in flight stays htmx's.** `htmx-indicator` is the request-driven path, because the
request is a fact the client owns and a server may only stamp what it can keep true
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h); the rule is
`forge-ui-htmx-indicator-on-control` in `src/ui/design/reference/11-htmx.md`.

---

## 2. Presentational Attributes Are Declared Too

**The enum half of the vocabulary is declared beside the state half, and is emitted through
`presentationAttrs()` rather than hand-written at each call site.** `data-tone`, `data-appearance`,
`data-size` and `data-state` are the styling hooks that carry a _choice_ rather than a flag, and they
had been spelled as string literals in the components that emit them — the same two-places-that-
cannot-see-each-other problem §1 solves for the boolean states, with the same silent failure mode.
A stylesheet is written against a name; nothing held the name to a declaration.

**They are the attribute mirror of the prop vocabulary**
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1m), so the declaration is one list and not two:
a prop drawn from the ratified seven becomes an attribute drawn from the same names. `data-state` is
the one that carries no prop of its own — it is a component-local enum a stylesheet reads, and §3
is why it may be nothing else.

**The frozen-hook technique from `state-attrs.ts` carries over unchanged.** A runtime member access
on the declaration table retains the whole table in every consumer bundle, so the attribute names are
reached as frozen module-scope constants and never by dynamic key.

## 3. The Island Payload Is Not a Presentational Enum

**A serialized island payload is written to `data-island-state` and never to `data-state`.** One
attribute name carried two grammars — a presentational enum on `Steps`, `Timeline` and `Meter`, and a
JSON object on the resumable island wrapper and `Toast` — and the reader could not tell them apart:
`hydrateState` throws unless the value parses to a JSON object, so a component spreading `...rest`
onto an element that also carries an enum made `resume()` throw from markup that type-checked.

**The split is by name, not by a parse-and-guess.** A tolerant reader that treated an unparseable
value as "no state" would swallow a genuinely corrupt payload, which is the failure `resume()` exists
to report. Giving the payload its own name makes the throw unreachable from a presentational enum by
construction, and leaves `data-state` a declared member of §2's table.

## 4. The Sweep Is Closed-World

**Two sweeps assert that every `data-*` a forge element emits is declared** — in the state table, in
§2's presentational set, or in the wiring vocabulary, which carries its reason beside each name. The
assertion runs in that direction and not the other: filtering the rendered attributes down to the
declared set before comparing them makes the comparison unfalsifiable, which is how undeclared names
came to ship past a test whose stated purpose was to stop them.

**The two see different things, which is why there are two.** One **renders** probes and reads the
attributes off the markup, so it sees what ships and nothing a component merely mentions; the other
**scans source text**, so it reaches the namespaces no probe mounts — at the cost of matching
Tailwind arbitrary-variant spellings and selector strings as well as emitted attributes.

**The vocabulary is declared once and derived from the constants that already name it**, so a rename
carries the allowlist with it. The table is read by tests only, for §1's frozen-hook reason. Each
sweep declares its own extras rather than widening the shared set.

**A name nothing emits fails, so the list can only shrink.** That assertion belongs to the scanning
sweep alone: only it can tell "unused" from "not rendered here".

**Wiring versus enum decides where a name goes.** A name driving a `cva` variant is presentational
and belongs in §2's declared table; a few sit in wiring today, each recorded where it is declared.

**The probe renders each component twice — once bare, once with every boolean state prop set.** A
component only emits `data-pressed`, `data-checked`, `data-selected`, `data-disabled`, `data-invalid`
or `data-busy` when the corresponding prop is true, so a sweep over a default render reaches none of
them and the six hooks the contract exists for are exactly the ones it never sees.

**The precedence expectation is derived independently of the table it checks.** Building both sides
of an assertion from the same input proves the input equals itself; the override case states the
caller's value literally, so a change to the declaration cannot silently rewrite what the test
demands.

## 5. The `data-slot` Token

**Every forge element a caller may need to reach carries a `data-slot`, and a root composes its own
token with an inherited one rather than hardcoding it** — `slotToken(own, inherited)`, so a
component nested inside another stays addressable as both.

**Six components render their `data-slot` on an inner element rather than the root, and that is
declared rather than silent.** A `Switch`, `Toggle`, `Select`, `OTPInput`, `Slider` or `Table` root
is a wrapper whose interesting element is the control inside it, so the token names the control; the
conformance sweep carries one entry per split with the reason it is a split, in place of the
unexplained per-component overrides that made the exceptions invisible.

**`forge/data-slot-before-spread` does not catch this and is not extended to.** It enforces the
_ordering_ of a slot attribute against the forwarded props, never its _placement_ on the element
tree, so an inner-element token is outside what it can see. Naming the splits in the sweep's table is
the record; teaching a class-order check about element identity would be a second, weaker copy of the
sweep.
