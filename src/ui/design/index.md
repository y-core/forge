# Forge UI Design Corpus

This corpus is design judgement for composing forge's UI namespace — `@y-core/forge/ui/core`,
`@y-core/forge/ui/controls`, `@y-core/forge/ui/chrome`, `@y-core/forge/ui/server`,
`@y-core/forge/ui/client`, and the tokens in `@y-core/forge/ui/assets`. It answers *which* primitive
to reach for, what a good surface looks like when it is built out of them, and which recurring
output patterns mark work as machine-composed. It is **not** an API reference: props, signatures,
variant lists, and worked call examples are owned by [`../README.md`](../README.md), and nothing
here restates them.

## Read in this order

1. **[`floor.md`](./floor.md) — first, and always.** The invariants. Nothing in it is overridable.
2. **[`catalog.md`](./catalog.md)** — when you are choosing components. Job on the left, primitive
   and subpath on the right.
3. **The one or two [`reference/`](./reference/) files the task actually touches.** A settings form
   pulls `reference/06-forms.md`; it does not pull `reference/13-marketing.md`.
4. **[`preflight.md`](./preflight.md) — before you declare the work done.** Run it and report the
   counts it asks for.

Reading all 20 rule files for one surface is the wrong move. The corpus is routed, not sequential:
`floor.md` plus `preflight.md` plus the two files your task names is the intended read, and it is
what the routing table below exists to make possible.

## Where to go

One row per file, keyed by the question that sends you there.

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

## Two tiers, one citation scheme

**Tier 1, the Floor, is invariant** — it is verified before the work is done and refused during
generation, and no brief, preference, or surrounding convention overrides it. **Tier 2, the
Defaults, are rebuttable** — each one opens with the literal token `Default:` and ends with the
circumstance under which departing is correct, and it is rebuttable only by an explicit written
brief from the consumer, never by the agent's own taste. Every normative sentence in the corpus
carries a stable id in a trailing `rule:forge-ui-…` HTML comment, invisible when rendered, so a
finding can cite the exact sentence it rests on rather than the paragraph around it.

## Before you build

Emit the Design Read — one line naming who the surface is for, the one primary action, and what
failure looks like. It is defined as `forge-ui-design-read` in [`floor.md`](./floor.md), with the
shape it takes; do not reconstruct it from here.

## Sources

The design principles these rules rest on are argued in *Refactoring UI* by Adam Wathan and Steve
Schoger. Every rule in this corpus was re-derived against forge's own components, tokens, and
utilities, and is stated in forge's terms rather than reproduced.

Where a single file rests on a source of its own, it credits it in its own `## Sources` footer —
[`reference/04-color.md`](./reference/04-color.md) is the one that does, for the palettes forge's
scheme files resample.
