---
title: UI Showcase Surface
description: "What the ui/show showcase is for, how an app registers it, and the coverage contract that keeps it demonstrating every published component."
---

# UI Showcase Surface

> Owns the decisions behind `ui/show`: that forge ships a runnable demonstration of its own UI
> surface, what an app must supply to mount it, and the coverage contract that fails the build
> when a published component has no demo.
>
> It governs the showcase's *contract*, not its content. No component behaviour is decided here.
>
> Defers to: `src/ui/README.md` for the routes, options, loaders and worked usage;
> [`THEME_GENERATION.md`](./THEME_GENERATION.md) for the theme page's dial model and audit
> readouts; [`UI_DESIGN_GUIDANCE.md`](./UI_DESIGN_GUIDANCE.md) for the design corpus and the gate
> that holds forge's own markup to it; `src/ui/show/coverage.ts` and
> `src/ui/show/coverage-missing.ts` for the manifest and the gap list themselves.

---

## 0. Quick Reference

- §1 What the Showcase Is: a published surface rather than an example app, why the consumer app is its only host, and what follows from that
- §1a Registration Supplies the App's Shell: forge renders the body, the app renders everything around it
- §1b Routes Are Derived From One Base Path: the path table, the six pages cut by consumer prerequisite, and the theme page's separate owner
- §1c The Catalog Declaration: what the section list owns, the page it names, and why it is not barrelled
- §2 Coverage Contract: the anti-drift rule that keeps the catalog honest
- §2a The Demo Manifest: one entry per published component, and the axes a demo owes
- §2b Coverage Is Read From Rendered Markup: why the check renders the catalog rather than reading source
- §2c The Three Assertions: what fails, in what direction
- §2d The Gap List Only Shrinks: a mandatory owner, and a stale excuse is a failure
- §3 The Showcase Is Held to Its Own Rules: no exemption for demo code

---

## 1. What the Showcase Is

**The showcase is published, not an example directory.** It is a subpath of the package, so a
consumer mounts forge's own demonstration of every component into their app and gets it back with
their layout, their icons and their theme around it.

Two consequences are real costs, and both are accepted deliberately:

- **Its markup is demo markup that ships to every consumer.** The utility classes it uses are
  therefore opt-in: an app that mounts the showcase adds one line to its stylesheet so those classes
  compile, exactly as it does for the log viewer. `config/steps.ts` owns that line, and the CSS
  source-coverage step is what keeps it stated rather than remembered.
- **It is forge's most-read worked example**, which is why §3 refuses it any exemption from the
  rules it demonstrates.

**Forge publishes the showcase and does not host it.** The canonical host is the consumer app —
`/src/starter` mounts it — and in-repo verification is `render()` over the component plus Playwright
over the rendered string. An in-repo dev worker was rejected: it adds a machine prerequisite to the
gate for a surface no forge code imports. A Playwright `webServer` harness was rejected too: it
makes the demos viewable in CI without any consumer ever having mounted them, which is the one
thing dogfooding is for.

### 1a. Registration Supplies the App's Shell

**Forge renders the showcase body and never the page around it.** Registration takes the app's
layout component, the app's icon component, and an async per-request context factory whose value is
handed to that layout.

The reason is the boundary forge holds everywhere else: a library that rendered `<html>`, a nav, or
a stylesheet link would be deciding an app's chrome from inside a component. The showcase is the
case where that would be most tempting and most wrong — its own screenshots would then be of
forge's app rather than the consumer's.

**The icon component is a constraint, not a slot.** The type names the exact glyphs every section
draws, so an app whose sprite lacks one fails to type-check rather than rendering a blank square.

### 1b. Routes Are Derived From One Base Path

**Every showcase URL derives from a single base path, and one path table is the only place a path
is written.** The page, the fragment endpoints and the markup that targets them all read that
table, so a relocated showcase moves as a unit and no HTMX target can point at a path that moved.

There are six pages — five catalog pages and the theme customiser — and the rest are HTMX fragment
endpoints demonstrating the patterns in [`HTMX.md`](./HTMX.md). **The catalog is cut by consumer
prerequisite, not by taxonomy**: the page a section lands on is what a reader must install for it to
work, from a page that needs nothing through to one that needs a client import, an endpoint set or a
configuration object. Sorting by component family would have grouped things a reader already knows
how to group; what they cannot see from the markup is the wiring. The theme page is the customiser,
whose state model and audit readouts belong to
[`THEME_GENERATION.md`](./THEME_GENERATION.md) §1b and §3c.

### 1c. The Catalog Declaration

**The catalog's sections are declared as data — an id, a label, the band it reads under, and the
page it is served on — and that declaration is authoritative.** The table of contents, the rendered
page and the coverage report all derive from it, so a section that is listed but not rendered,
rendered but not listed, or pointing at a page that does not exist, is a test failure rather than a
reader's problem.

**It is deliberately not in the barrel.** It is internal structure a consumer never composes
against: the published surface is the page component and the registration helpers
([`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1c permits an unbarrelled non-`@public` symbol).

---

## 2. Coverage Contract

The showcase's value is entirely in being complete. A component added to a barrel with no demo
leaves the catalog quietly wrong — nothing fails, nothing warns, and the gap is discovered by a
reader looking for the one component that is missing.

The contract is one sentence: **every component forge publishes is demonstrated, and every
exception is written down with an owner.**

### 2a. The Demo Manifest

**The manifest declares one entry per published component, and per entry the axes that component
owes a demo of** — a variant, a size, an orientation, a sub-component, a bound-control shape. Each
axis carries the marker that proves it was rendered.

An entry also names *where* the demo belongs, so a failure can say what to add rather than only
that something is absent. Nothing here enumerates the manifest; it is data, and the module is
authoritative over any prose describing forge's demonstrated surface.

### 2b. Coverage Is Read From Rendered Markup

**The check renders every catalog page and merges them**, so a section moving between pages costs
the report nothing and a section that renders on none is still a gap. Merging rather than
concatenating is deliberate: joined markup would let one page's last section absorb the next page's
opening, and the check would then pass on markup outside the section it names.

**The check renders the catalog and reads the HTML.** A source-level check would prove that a
component was imported, which is the claim that is never in doubt; what drifts is whether the demo
still *renders* the axis — a variant dropped from a demo compiles, passes every type check, and
disappears from the page silently.

Reading markup is also what makes the marker vocabulary honest: an axis is proven by the attribute,
the slot token, or the class the component genuinely emits, so the coverage claim and the component
contract cannot disagree.

**A failure names its own remedy** — what the catalog must render for that key, and what to delete
from the gap list once it does — because a coverage failure is otherwise a key with no obvious
next step.

### 2c. The Three Assertions

The contract is enforced by three assertions, and the directions matter more than the count:

- **Every component export in every published UI barrel is declared in the manifest.** This is the
  direction that catches a *new* component: adding one to a barrel fails the build until it is
  either demonstrated or written down as owed.
- **No uncovered key is left unexcused.** A declared demo or axis the rendered catalog does not
  show must appear in the gap list.
- **No excuse is stale or unknown.** An excused key the catalog now covers, and a key the manifest
  could never produce, both fail.

### 2d. The Gap List Only Shrinks

**Every gap names the ledger task that owes it, and the owner is mandatory.** A gap with no owner
is a permanent exemption wearing a temporary label.

**The list only shrinks, and that is enforced rather than encouraged**: covering a key without
deleting its entry fails the third assertion, so the excuse cannot outlive the gap. Growth is
possible only by adding a component with no demo, which is a deliberate act that leaves a named
owner behind it.

---

## 3. The Showcase Is Held to Its Own Rules

**Demo code gets no exemption.** The showcase's markup is inside the design gate's second
direction ([`UI_DESIGN_GUIDANCE.md`](./UI_DESIGN_GUIDANCE.md) §4a), so a section that contradicts a
rule forge publishes fails forge's own build — which is the point, since a worked example teaching
the contradiction is worse than no example.

Its client tier is held to the same runtime rules as any consumer's: every scope it registers obeys
the eager-versus-lazy rule in [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c, and every
controller it mounts returns a disposer as [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2d
requires. The showcase is where those rules are most visible, so it is the worst possible place to
bend them.
