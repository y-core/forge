---
name: forge-ui-design
description: "Design judgement for building and reviewing user interfaces composed from forge's UI primitives. Use when building a page, screen, form, dashboard, settings panel, table view, modal, empty state, or loading state with @y-core/forge/ui/core, @y-core/forge/ui/controls, or @y-core/forge/ui/chrome; when composing or restructuring an existing component tree; when choosing between two forge components that both nearly fit; when deciding spacing, colour tokens, typography, elevation, visual hierarchy, density, or motion; when a surface needs its empty, loading, error, and success states designed; and when reviewing, auditing, or critiquing an interface for craft rather than correctness. Not an API reference — props, signatures, and call examples live in the ui README — and it does not cover routing, storage, validation, authentication, or any non-forge UI library."
license: MIT
---

# Forge UI Design

The Claude Code wrapper around the design corpus in this directory. The corpus itself is
harness-neutral and entered through [`index.md`](./index.md); this file adds the contract, the
routing, and the worked flow for an agent that is about to build or review a surface.

## Setup contract

**Before acting, you must have loaded [`floor.md`](./floor.md).** It is the invariant tier — the
obligations you verify before reporting done, and the prohibitions you hold the whole time you are
generating. There is no surface small enough to skip it, and no brief that overrides it.

**Before finishing, you must have run [`preflight.md`](./preflight.md) and reported its countable
evidence.** Counts, not adjectives: how many `primary` buttons on the surface, how many text colors,
how many spacing steps, which states are designed. "Looks right" is not a preflight result.

Between those two, read only what the task names. The corpus has 20 rule files and a typical task
touches two of them.

## Where to go

Identical to the routing table in [`index.md`](./index.md), deliberately — this file is a thin
wrapper, and two routing tables that had drifted apart would be worse than one. **Change both or
neither.**

| The question in front of you | Read |
|---|---|
| What may I never do, whatever I was asked for? | [`floor.md`](./floor.md) |
| Which component do I reach for? | [`catalog.md`](./catalog.md) |
| Does this look like it was generated rather than designed? | [`tells.md`](./tells.md) |
| Am I done? | [`preflight.md`](./preflight.md) |
| Two things look equally important. | [`reference/01-hierarchy.md`](./reference/01-hierarchy.md) |
| How much space goes between these, and why that much? | [`reference/02-layout.md`](./reference/02-layout.md) |
| How many text sizes and weights, and how wide does the copy run? | [`reference/03-typography.md`](./reference/03-typography.md) |
| Which token is this shade, and does it hold in dark mode? | [`reference/04-color.md`](./reference/04-color.md) |
| Should this sit on a raised surface, or is a border enough? | [`reference/05-depth.md`](./reference/05-depth.md) |
| How do I lay out a field, and where does its error go? | [`reference/06-forms.md`](./reference/06-forms.md) |
| The list is empty, or loading, or it failed. | [`reference/07-states.md`](./reference/07-states.md) |
| Where does this control live — the shell, a rail, or the page? | [`reference/08-navigation.md`](./reference/08-navigation.md) |
| What happens on focus, on keyboard, while it is in flight? | [`reference/09-interaction.md`](./reference/09-interaction.md) |
| Can someone reach and read this without a mouse or full colour vision? | [`reference/10-accessibility.md`](./reference/10-accessibility.md) |
| This region gets swapped in over the wire. | [`reference/11-htmx.md`](./reference/11-htmx.md) |
| How tight, how plain, how much movement? | [`reference/12-density.md`](./reference/12-density.md) |
| It is a landing page, not an app screen. | [`reference/13-marketing.md`](./reference/13-marketing.md) |
| I am auditing someone else's surface. | [`reference/14-review.md`](./reference/14-review.md) |
| There is a photograph or a glyph on this surface. | [`reference/15-media.md`](./reference/15-media.md) |
| I am about to write this behaviour in script or in an older CSS idiom. | [`reference/16-platform.md`](./reference/16-platform.md) |

## Two tiers

**Floor** rules are invariant and cite no override. **Default** rules open with the literal token
`Default:`, end with the circumstance that rebuts them, and are rebuttable only by an explicit
written brief from the consumer — never by your own aesthetic read of the surrounding code. Every
normative sentence carries a stable id in a trailing `rule:forge-ui-…` HTML comment, so a finding
you report can name the sentence it rests on.

## Worked flow

A typical task — "add a settings screen with a notification preferences form":

1. **Design Read.** Emit the one line defined as `forge-ui-design-read` in
   [`floor.md`](./floor.md): who the surface is for, the one primary action, what failure looks
   like.
2. **Choose components.** [`catalog.md`](./catalog.md) routes "labelled control with no validation"
   to `Field` and "validated, can be rejected" to `FormField`, each with the subpath it comes from.
3. **Read the one or two reference files the task names.** Here,
   [`reference/06-forms.md`](./reference/06-forms.md) for field structure and
   [`reference/07-states.md`](./reference/07-states.md) for the save-failed and save-succeeded
   paths.
4. **Build**, holding the Refuse half of [`floor.md`](./floor.md) the whole time — tokens not
   literals, scale steps not arbitrary values, no `style=` attribute.
5. **Preflight.** Run [`preflight.md`](./preflight.md) against what you built.
6. **Report the counts.** State the preflight numbers and any Default you departed from, naming the
   brief that authorised it. A departure with no brief behind it is a defect, not a judgement call.

When the task is a review rather than a build, replace steps 2–4 with
[`reference/14-review.md`](./reference/14-review.md), which owns the audit pass and the shape of its
findings.

The corpus's attribution is in [`index.md`](./index.md)'s `## Sources` footer.
