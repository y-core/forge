---
title: Forge UI Design Corpus
description: "The map of the design corpus: which file answers which question, how its tiers bind, the contract you work under, and where the API reference lives instead."
---

# Forge UI Design Corpus

This corpus is design judgement for composing forge's UI namespace — `@y-core/forge/ui/core`,
`@y-core/forge/ui/controls`, `@y-core/forge/ui/chrome`, `@y-core/forge/ui/server`,
`@y-core/forge/ui/client`, and the tokens in `@y-core/forge/ui/assets`. It answers _which_ primitive
to reach for, what a good surface looks like when it is built out of them, and which recurring
output patterns mark work as machine-composed. It is **not** an API reference: props, signatures,
variant lists, and worked call examples are owned by [`../README.md`](../README.md), and nothing
here restates them.

This file is the corpus's entry point, in any harness.

---

## 0. Quick Reference

- §1 How to Read This Corpus: the four-file read, and why reading all 21 is the wrong move
- §2 Where to Go: one row per file, keyed by the question that sends you there
- §3 The Two Tiers and the Citation Scheme: what binds absolutely, what a brief may rebut, and how a finding cites a sentence
- §4 The Working Contract: load the floor before acting, run preflight before reporting done
- §5 Worked Flow: the six steps a build takes, and the one substitution a review makes
- §6 Sources: the texts the corpus's reasoning rests on, and what was re-derived rather than reproduced

---

## 1. How to Read This Corpus

1. **[`floor.md`](./floor.md) — first, and always.** The invariants. Nothing in it is overridable.
2. **[`catalog.md`](./catalog.md)** — when you are choosing components. Job on the left, primitive
   and subpath on the right.
3. **The one or two [`reference/`](./reference/) files the task actually touches.** A settings form
   pulls `reference/06-forms.md`; it does not pull `reference/13-marketing.md`.
4. **[`preflight.md`](./preflight.md) — before you declare the work done.** Run it and report the
   counts it asks for.

Reading all 21 rule files for one surface is the wrong move. The corpus is routed, not sequential:
`floor.md` plus `preflight.md` plus the two files your task names is the intended read, and it is
what the routing table in §2 exists to make possible.

---

## 2. Where to Go

One row per file, keyed by the question that sends you there. This is the corpus's only routing
table; nothing else carries a copy.

| The question in front of you | Read |
| --- | --- |
| What may I never do, whatever I was asked for? | [`floor.md`](./floor.md) |
| Which component do I reach for? | [`catalog.md`](./catalog.md) |
| Does this look like it was generated rather than designed? | [`tells.md`](./tells.md) |
| Am I done? | [`preflight.md`](./preflight.md) |
| Two things look equally important. | [`reference/01-hierarchy.md`](./reference/01-hierarchy.md) |
| How much space goes between these, and why that much? | [`reference/02-layout.md`](./reference/02-layout.md) |
| How many text sizes and weights, and how wide does the copy run? | [`reference/03-typography.md`](./reference/03-typography.md) |
| Which token is this shade, and does it hold in dark mode? | [`reference/04-color.md`](./reference/04-color.md) |
| How do I build a scale for a brand hue? | [`reference/04-color-authoring.md`](./reference/04-color-authoring.md) |
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

---

## 3. The Two Tiers and the Citation Scheme

**Tier 1, the Floor, is invariant** — nothing overrides it. **Tier 2, the Defaults, are
rebuttable**, and only by an explicit written brief from the consumer: each opens with the literal
token `Default:` and ends with the circumstance under which departing is correct. Never by your own
aesthetic read of the surrounding code.

Every normative sentence carries a stable id in a trailing `rule:forge-ui-…` HTML comment,
invisible when rendered, so a finding cites the sentence rather than the paragraph. A section
number cites the chunk that sentence sits in.

That is the whole of what you need to read the corpus. The tiers' full definitions — the Floor's
Verify/Refuse split, what makes a Default well-formed, and the identifier scheme's rules — are
`UI_DESIGN_GUIDANCE.md` §2 and §3's, in forge's own `docs/`.

---

## 4. The Working Contract

**Before acting, you must have loaded [`floor.md`](./floor.md).** It is the invariant tier — the
obligations you verify before reporting done, and the prohibitions you hold the whole time you are
generating. There is no surface small enough to skip it, and no brief that overrides it.

**Before finishing, you must have run [`preflight.md`](./preflight.md) and reported its countable
evidence.** Counts, not adjectives: how many `primary` buttons on the surface, how many text colors,
how many spacing steps, which states are designed. "Looks right" is not a preflight result.

Between those two, read only what the task names (§1).

Part of acting is the **Design Read** — one line naming who the surface is for, the one primary
action, and what failure looks like. It is defined as `forge-ui-design-read` in
[`floor.md`](./floor.md), with the shape it takes; do not reconstruct it from here.

---

## 5. Worked Flow

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

---

## 6. Sources

The design principles these rules rest on are argued in _Refactoring UI_ by Adam Wathan and Steve
Schoger. Every rule in this corpus was re-derived against forge's own components, tokens, and
utilities, and is stated in forge's terms rather than reproduced.

Where a single file rests on a source of its own, it credits it in its own `## Sources` footer —
[`reference/04-color.md`](./reference/04-color.md) is the one that does, for the palettes forge's
scheme files resample.
