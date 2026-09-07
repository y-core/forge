---
title: Shared Library Consumption
description: "Leverage the shared library before writing app code, never bypass its facade, and the test for working around a gap locally versus upstreaming a change."
---

# Shared Library Consumption

> Owns the relationship between an application and the shared library it is built on: what to
> take from the library before writing anything, the facade rule, and how a gap in the library
> is resolved.
>
> Defers to: [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2 for which layer app-owned code
> belongs in; [`BOUNDARIES.md`](./BOUNDARIES.md) for the boundaries the library's own
> namespaces are built to respect.

---

## 0. Quick Reference

- §1 Leverage the Library First: check before implementing any cross-cutting concern
- §1a The Check, Before Writing Code: what to search and in what order
- §1b Capability Classes the Library Owns: where the answer is almost always yes
- §1c What Application Code Is For: the four legitimate categories
- §2 Never Bypass the Facade: one import path per dependency
- §2a Import Through the Library Subpath, Always: the rule
- §2b Never Reach Into node_modules: the transitive-dependency trap
- §2c Why the Facade Holds: version bumps, and who absorbs them
- §3 Resolving a Gap: local workaround or upstream change
- §3a The Decision Test: three questions, in order
- §3b Writing a Local Workaround: where it lives and how it is marked
- §3c Upstreaming a Change: what the library needs from the request
- §3d What Is Never Worked Around Locally: security and boundary surfaces
- §4 Consuming a Cross-Repo Change: keeping the two repositories honest
- §4a Verify Against the Library's Published Surface: never against memory
- §4b Never Depend on an Internal: what is off-limits even when it resolves
- §4c Upgrading the Library: what an upgrade is allowed to be bundled with
- §5 Consuming the Design Tokens: the two tiers, and which is for which
- §5a Components Take Roles, Markup May Take Steps: where the boundary falls
- §5b Register a Step, Never Inline One: how a step becomes available
- §5c What Stays Forbidden: the literal, and the step chosen by eye

---

## 1. Leverage the Library First

### 1a. The Check, Before Writing Code

**Before implementing any cross-cutting concern, establish that the library does not already
provide it.** The check is three steps and takes a minute:

1. **Search the export map.** `package.json` `exports` in the library is the authoritative list
   of subpaths — reading it is faster than guessing at namespace names.
2. **Read the candidate namespace's barrel.** A barrel is the published surface, so a symbol
   absent from it does not exist for an application however visible it is in the source.
3. **Read the namespace's `README.md`** for usage, and its governing document for the
   constraints the capability is built under.

**A capability re-implemented in application code is a permanent divergence.** It does not
receive the library's fixes, it is not covered by the library's tests, and the next application
will re-implement it differently.

### 1b. Capability Classes the Library Owns

Where a need falls in one of these classes, the answer is almost always that the library already
has it — check before writing:

CSRF minting and verification · security headers and CSP nonces · HTML escaping and response
builders · structured logging · input validation · rate limiting · origin verification · session
and cookie handling · the app factory and asset serving · declarative routing · config
validation and typed access · storage binding clients · SSR components and the client runtime ·
test fixtures.

**This list names classes, not symbols.** Naming symbols here would make this document a second
copy of an export map that changes faster than prose does
(`AGENT_GUIDE.md` §8).

### 1c. What Application Code Is For

Write app-layer code when the concern is one of exactly four things:

- **Domain-specific** — business logic unique to this product.
- **Configuration** — binding library utilities to this application's schema and environment.
- **View rendering** — components producing this application's markup.
- **Integration wiring** — connecting library primitives to this application's external
  services.

Anything outside those four is a signal to look harder at §1a.

---

## 2. Never Bypass the Facade

### 2a. Import Through the Library Subpath, Always

**Every library capability is imported from its published subpath, never from the package the
library wraps.** Where the library exposes a validation facade, an application imports the
facade — not the underlying schema library. Where it exposes an HTTP namespace, an application
imports that — not the header or template package underneath.

**The ban reaches test files.** A test that imports the wrapped package directly bypasses the
facade exactly as production code would, and will not follow the next version bump. There is no
"it is only a test" carve-out, because the failure mode is identical.

### 2b. Never Reach Into node_modules

**Never import from a library-internal path, and never import a transitive dependency of the
library as though it were your own.** A transitive dependency is not a dependency an application
declared: it can vanish in a patch release, and nothing will warn.

Where an application genuinely needs a package the library also uses, **declare it as a direct
dependency** — then it is a shared dependency by intent rather than by accident.

### 2c. Why the Facade Holds

The facade exists so that **one repository absorbs a dependency's breaking change instead of
every application doing so independently**. Each bypass moves one coupling out of the place that
is maintained and into a place that is not.

The cost is asymmetric in a way worth naming: a bypass is cheap to write and invisible in review
until the upgrade that breaks it, at which point it is the only call site in the fleet that
nobody knew about.

---

## 3. Resolving a Gap

### 3a. The Decision Test

When the library does not do what is needed, answer three questions **in order**:

1. **Is it genuinely absent, or merely not exposed?** A capability implemented internally but
   missing from the barrel is not a gap in the library's design — it is a one-line export, and
   it is upstream work (§3c).
2. **Would a second application need it?** If yes, it belongs upstream. Reusability is the
   library's whole purpose, and the second application will otherwise re-derive it.
3. **Is it domain-specific to this product?** If yes, it belongs here, in the layer
   [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) §2 names — and it is not a workaround at all,
   just application code.

**Only a "no" to all three leaves a genuine local workaround**, and those are rare enough to be
worth writing down when they happen.

### 3b. Writing a Local Workaround

A local workaround is **one named module in the application's own layer**, not an inline patch
at a call site. Three requirements:

- **It has a name that says what it works around**, so a future reader can find it when the
  library gains the capability.
- **It is recorded in the application's `docs/` docs**, with the gap it covers — this
  is the record that lets it be deleted rather than becoming permanent.
- **It wraps the library rather than replacing it.** A workaround that reimplements a whole
  capability to fix one property of it has forked the capability.

**A workaround is deleted the release after the library ships the real thing.** A workaround
nobody removes is indistinguishable from a design.

### 3c. Upstreaming a Change

An upstream request is easiest to accept when it arrives with three things: the **concrete call
site** that needs it, the **signature** the application would use, and the **namespace** the
capability belongs in by the library's own placement rules.

**Do not upstream a change shaped by one application's convenience.** A parameter added to make
this application's call shorter is a parameter every other consumer now has to understand. If
the general form is not obvious, say so and let the library decide the shape.

### 3d. What Is Never Worked Around Locally

**A security or boundary surface is never patched locally.** CSRF verification, origin checking,
header policy, session handling, input validation, and the fail-closed posture
([`BOUNDARIES.md`](./BOUNDARIES.md) §5) are the library's to own, and a local variant of one is
a security control that no shared review, test suite, or upgrade path covers.

Where such a surface genuinely does not fit, that is an upstream conversation, and until it is
resolved the correct application behaviour is to **refuse the request**, not to route around the
control.

---

## 4. Consuming a Cross-Repo Change

### 4a. Verify Against the Library's Published Surface

**Verify every symbol name, signature, and subpath against the library's actual source before
writing against it** — never against memory of a previous version, and never against a
documentation snippet in this repository.

Where the two repositories are developed together, the application's type-check is the check
that proves the pair agrees. **A green type-check on the application is the evidence a library
change is consumable**, and it is worth running before the library change is released rather
than after.

### 4b. Never Depend on an Internal

**A symbol marked internal, a sealed namespace, or a module reachable only by a deep path is off
limits even when the import resolves.** These carry no compatibility promise, and the library is
explicitly free to move them without a version signal.

The same applies to _behaviour_ an internal happens to produce: depending on the exact text of
an internal error message, or the ordering of an unspecified iteration, is a dependency on an
internal by another route.

### 4c. Upgrading the Library

**A library upgrade is its own change, with nothing else in it.** Bundling an upgrade with a
feature makes a bisect useless: when something breaks, there is no commit that isolates the
cause, and the reviewer is asked to judge two unrelated risks at once.

The sequence is fixed:

1. **Bump the dependency alone**, and run the full gate ([`TESTING.md`](./TESTING.md) §6).
2. **Fix only what the upgrade broke** — a renamed symbol, a changed signature, a moved subpath.
   Resist the adjacent cleanup the diff makes tempting.
3. **Delete any workaround the upgrade obsoletes** (§3b), naming it in the same commit message
   so the record of the gap closes with it.

**A type error surfaced by an upgrade is information, not an obstacle.** Silencing one with a
cast converts a compile-time signal that the contract changed into a runtime failure later, and
it is the single most common way an upgrade ships broken.

Where an upgrade cannot be taken because it breaks something the application depends on, **say
which symbol and why** — that is the input §3c needs, and it is far more useful than a pinned
version nobody can explain.

---

## 5. Consuming the Design Tokens

### 5a. Components Take Roles, Markup May Take Steps

The library publishes its colour in two tiers, and they are for different callers:

| Tier | Shape | Who resolves it |
| --- | --- | --- |
| Semantic tokens | A role — the surface, the text on it, the border | Library components, and app markup that must match them |
| The numbered scale | The steps a scheme declares, one per family | App markup only |

**A library component resolves only a semantic token; the library's own governance binds it,
and an application never widens that.** The consequence for an application is the useful half:
because every component asked for a role, app markup that reaches for the _same role_ is
guaranteed to match a component beside it under any scheme, in either mode.

**Where the roles run out, the scale is the sanctioned answer** — not a literal, and not a
component override that fights the role it just asked for. A semantic layer is deliberately
narrow: it names the surfaces a component set needs, which is fewer than the surfaces a page
wants. Reaching a step for a band, a wash, or a section a component will never render is
consuming the library as intended, not bypassing it.

### 5b. Register a Step, Never Inline One

**A step is made available as a first-class utility once, in the application's stylesheet, and
used by that name everywhere after.** Reaching a step through an inline escape hatch in markup
is the same defect at every call site instead of one decision in one file.

Registration is what buys the properties the tier is worth having:

- The utility composes with the class-merge the components use, so a step passed to a component
  override replaces the role's value instead of racing it in the cascade.
- Opacity modifiers work, because the utility is a real colour rather than a raw substitution.
- The step stays mode-correct without a dark-mode variant, since the scheme declares both
  branches of every step.

**An opacity modifier over a role is not a substitute for a step.** It composites one colour in
both modes; a step is two authored values. A tint that reads correctly in one mode and washes
out in the other is that substitution, and the fix is the step rather than a second modifier.

### 5c. What Stays Forbidden

**A raw colour literal in markup or a component remains forbidden**, and widening the palette
narrows the excuse for one: a literal is now a value that exists outside both tiers.

**Choose a step by the role it carries in the scale, never by how it looks.** The steps are
ordered and audited — a scheme documents which are surfaces, which are borders, which are
solid fills, and which carry text. Picking the one that happens to look right rediscovers the
palette-by-eye problem the semantic tier was built to end, one section at a time.

**Which steps a scheme declares, which are already spoken for by a semantic name, and how a
step is registered in the local build are implementation** — they are named in the application's
own design documentation, never here.
