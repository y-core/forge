---
title: AI Tells
description: "Output patterns that mark a surface as machine-composed rather than designed — each one type-checks, renders, and is recognisable at a glance."
---

# AI Tells

Output patterns that mark a surface as machine-composed rather than designed. None is a bug: each type-checks, renders, passes a test — and each is
recognisable at a glance to a reader who has seen generated interfaces before.

Everything here is Tier 2, rebuttable only by an explicit written brief. Where a tell is already a Floor violation the Floor id is cited rather than
restated, and the entry carries only what the Floor does not: why the pattern gets generated, and what to reach for instead.

---

## 0. Quick Reference

- §1 Colour and Surface: the tells you can see before you read a word of the markup
- §1a Gradient Text: the cheapest decoration, encoding nothing the token layer does not already hold
- §1b The Violet-and-Cyan Accent, and the Glow Under It: a hue that arrived with the output rather than the product
- §1c A Pure Black Page: forge's dark ground is `--gray-1`, so true black can only have been typed
- §1d Decorative Glass: a blur applied where nothing sits behind it to blur
- §1e A Hard Offset Shadow with No Blur: a second outline wearing a shadow's name
- §1f `text-white/70` on a Coloured Surface: why the opacity reflex keeps beating the paired token
- §2 Structure: the tells in how the surface is assembled
- §2a Nested Cards: every level of nesting in the data becoming a level of elevation in the markup
- §2b A Row of Exactly Three Equal Cards: a count chosen by the grid rather than by the data
- §2c An Eyebrow Above Every Heading: a label applied uniformly, so no heading needed one
- §2d Numbered Sections: numbers asserting a sequence the content does not have
- §2e `h-screen`: correct on the desktop viewport it was written against, broken under phone chrome
- §2f Monotonous Spacing: every distance chosen independently, so the same default wins each time
- §2g Custom Scrollbars: re-implementing a platform control, losing keyboard scroll and the OS setting
- §2h A Skipped Heading Level: the tag changed when the class was what needed changing
- §3 Type: the tells in the text itself
- §3a A Flat Type Hierarchy: four adjacent steps, so four sizes and one hierarchy
- §3b Justified Body Copy: a print convention without the hyphenation engine that makes it work
- §3c Undersized UI Text: content fitted to a box that was decided first
- §3d Letterspaced Body Copy: a display treatment applied to reading text
- §4 Content: the tells in what the slots were filled with
- §4a Fabricated Metrics: a slot the size of a number, filled because inventing one was easier
- §4b Placeholder Identities: the row needed a name, so a name was produced
- §4c Invented Testimonials: a factual claim about strangers, and the most damaging form of invented data
- §4d Lorem Ipsum Shipped as Copy: unreviewable filler that survives because it looks like content
- §5 Icons and Motion: the tells in the glyphs and the movement
- §5a Emoji Used as Icons: a different drawing on every OS, and a name nobody chose
- §5b Hand-Rolled Inline SVG: path data recalled rather than drawn, disagreeing with every other glyph
- §5c A `Spinner` Where a `Skeleton` Belongs: shape-agnostic, therefore always available, and a reflow
- §5d The Modal Reflex: the most recognisable container becoming the answer to "put this somewhere"
- §5e Motion on Everything: motion added per element rather than authored as a moment
- §5f Geometry Keyed on the Open State: the panel is described where it is first seen, so it collapses while its exit is still fading

---

## 1. Colour and Surface

### 1a. Gradient Text

<!-- rule:forge-ui-tell-gradient-text --> A headline set with `bg-gradient-to-r` plus `bg-clip-text` and a transparent fill. It reads as generated
because it is the cheapest available decoration and it encodes nothing: the gradient carries no state, no hierarchy, and no brand that the token
layer does not already hold — so it is applied to whichever line happened to be the biggest.

### 1b. The Violet-and-Cyan Accent, and the Glow Under It

<!-- rule:forge-ui-tell-neon-accent --> A saturated purple `--primary` nobody chose, with a coloured `shadow` behind the hero control. It reads as
generated because it is a default that was never a decision — the hue arrives with the output rather than with the product, and the glow is a light
source the rest of the page does not have. Until a brief names the brand, `--primary` is `--accent-9`, the muted hue-267 blue `theme-neutral.css`
ships.

### 1c. A Pure Black Page

<!-- rule:forge-ui-tell-pure-black --> `bg-black`, or a hex literal for the same, as the dark-mode ground. It reads as generated because forge's
dark mode never produces it: `--background` maps to `--gray-1`, which is a near-black rather than black, so a true black surface can only have been
typed in — and it puts maximum contrast against every border on the page while making `--card` at `--gray-2` look like a mistake. A hex literal
remains refused by `forge-ui-color-token-only` either way.

### 1d. Decorative Glass

<!-- rule:forge-ui-tell-glass-surface --> `backdrop-blur` with a translucent white or black fill on a card, a header, or a panel. It reads as
generated because the blur is applied where nothing is behind it to blur — translucency is a claim that the surface is floating over content, and a
card in the page flow is not.

### 1e. A Hard Offset Shadow with No Blur

<!-- rule:forge-ui-tell-hard-shadow --> `shadow-[4px_4px_0_...]`, or the same shape hand-built from a border. It reads as generated because it is a
second outline wearing a shadow's name: forge's shadows stand in for a light above the interface, and an unblurred offset is a graphic device from a
different visual language dropped onto one element.

### 1f. `text-white/70` on a Coloured Surface

<!-- rule:forge-ui-tell-opacity-foreground --> This is a Floor violation — `forge-ui-foreground-pairing`. What the Floor does not say is why it
keeps appearing: it is the shortest way to make a foreground look "secondary" without looking up which token the background pairs with, and it
happens to look fine on the one surface it was written against.

---

## 2. Structure

### 2a. Nested Cards

<!-- rule:forge-ui-tell-nested-card --> A Floor violation — `forge-ui-no-nested-card`. It appears because "group these things" and "this is a group"
are the same instruction to a generator, so every level of nesting in the data becomes a level of elevation in the markup.

### 2b. A Row of Exactly Three Equal Cards

<!-- rule:forge-ui-tell-three-card-row --> A row of three features, three tiers, three benefits — always three, always the same width, always the
same internal composition. It reads as generated because three is what a grid defaults to when nothing in the content asked for a count. A reader
can verify the count against the source of the data.

### 2c. An Eyebrow Above Every Heading

<!-- rule:forge-ui-tell-eyebrow-kicker --> A small uppercase tracked line — "FEATURES", "HOW IT WORKS" — sitting over each `Card.Title` or section
heading. It reads as generated because it is applied uniformly: an eyebrow names the section a heading belongs to, and a surface where every heading
has one is a surface where no heading needed one. A `Badge` `outline` is usually the better form of that single eyebrow anyway.

### 2d. Numbered Sections

<!-- rule:forge-ui-tell-numbered-sections --> `01`, `02`, `03` set large and faint beside each heading. It reads as generated because the numbers
assert a sequence the content does not have: independent features are not steps, and numbering them tells the reader to read in an order that does
not matter. Where the order is real, the numbers are content rather than decoration.

### 2e. `h-screen`

<!-- rule:forge-ui-tell-h-screen --> A Floor violation, stated in [`floor.md`][floor]. It persists because it is the obvious way to say "fill the
window" and because it looks correct on the desktop viewport it was written against; the failure is only visible on a phone, under the browser
chrome.

### 2f. Monotonous Spacing

<!-- rule:forge-ui-tell-uniform-spacing --> Every gap on the surface the same value — `gap-4` between fields, between groups, between sections, and
inside the card. It reads as generated because uniform spacing is what you get when each distance is chosen independently and the same default wins
every time, and it leaves the reader to find the group boundaries by reading the content.

### 2g. Custom Scrollbars

<!-- rule:forge-ui-tell-custom-scrollbar --> `scrollbar-width`, a `::-webkit-scrollbar` rule, or a hand-built thumb over a region that is already
scrollable. It reads as generated because it re-implements a platform control that forge deliberately left alone, and the re-implementation loses
keyboard scrolling, the platform's overscroll behaviour, and the reader's own OS setting.

### 2h. A Skipped Heading Level

<!-- rule:forge-ui-tell-heading-skip --> A Floor violation — `forge-ui-heading-order`. It arrives one way almost every time: the heading needed to
be smaller, so the tag was changed instead of the class.

---

## 3. Type

### 3a. A Flat Type Hierarchy

<!-- rule:forge-ui-tell-adjacent-type-steps --> Every step one notch from the last — `text-sm`, `text-base`, `text-lg`, `text-xl` on one surface. It
reads as generated because adjacent steps differ by too little to read as different: a 12.5% jump from 16px to 18px looks like an inconsistency
rather than a level, so the surface has four sizes and one hierarchy.

### 3b. Justified Body Copy

<!-- rule:forge-ui-tell-justified-text --> `text-justify` on a paragraph column. It reads as generated because it is a print convention applied
without the hyphenation engine that makes it work: the browser opens rivers of white space between words instead, and the effect is worst at exactly
the measure `forge-ui-measure-cap` produces. Justification without hyphenation costs readability at every width.

### 3c. Undersized UI Text

<!-- rule:forge-ui-tell-undersized-text --> `text-xs` on paragraphs, on button labels, on anything a reader must actually read. It reads as
generated because it is the visual signature of fitting content into a box that was decided first — a screenshot shrunk to fit — and small text
needs more contrast than it was given, not less. A control that does not fit moves down the `buttonVariants` size scale to `sm` and no further, per
`forge-ui-density-floor-holds`.

### 3d. Letterspaced Body Copy

<!-- rule:forge-ui-tell-tracked-body --> `tracking-wide` or `tracking-wider` on a paragraph. It reads as generated because it is a display treatment
applied to reading text: tracking exists to compensate for large sizes and uniform all-caps letterforms, and adding it to a paragraph slows the
reader down in exchange for nothing.

---

## 4. Content

### 4a. Fabricated Metrics

<!-- rule:forge-ui-tell-invented-metric --> A Floor violation — `forge-ui-no-fabricated-data`. It happens because a layout has a slot the size of a
number and generating a plausible number is easier than reporting that there is none; "+312%" and "12,000 teams" are the shapes that fit.

### 4b. Placeholder Identities

<!-- rule:forge-ui-tell-placeholder-identity --> A Floor violation — `forge-ui-no-fabricated-data`. "John Doe", "Acme Inc", "jane@example.com"
beside a stock `Avatar`. The reflex is the same as the metric one: the row needs a name, so a name is produced.

### 4c. Invented Testimonials

<!-- rule:forge-ui-tell-invented-testimonial --> A Floor violation — `forge-ui-no-fabricated-data`, and the most damaging form of it, because a
quote attributed to a named person at a named company is a factual claim about strangers. It is generated for the same reason as the rest: the
section shape exists and the content does not.

### 4d. Lorem Ipsum Shipped as Copy

<!-- rule:forge-ui-tell-lorem-ipsum --> Latin filler left in a `Card.Description`, an `Alert.Description`, or a hero supporting line. It reads as
generated because it is unreviewable: nobody can tell whether the layout works for the real copy, and it survives into production precisely because
it looks like content at a glance.

---

## 5. Icons and Motion

### 5a. Emoji Used as Icons

<!-- rule:forge-ui-tell-emoji-icon --> A Floor violation — `forge-ui-real-icons`. It happens because an emoji is available without a sprite, a
fetch, or a name — but it renders in the reader's platform font, so the same glyph is a different drawing on every OS, and it carries a name in the
accessibility tree that nobody chose. The Floor rule carries the binding.

### 5b. Hand-Rolled Inline SVG

<!-- rule:forge-ui-tell-inline-svg --> Also `forge-ui-real-icons`. The path data is usually recalled rather than drawn, so the viewBox, the stroke
width and the optical size disagree with every other glyph on the page — and each copy is a separate thing to change when the icon set moves. The
binding is the one place size, stroke and `aria-hidden` come from.

### 5c. A `Spinner` Where a `Skeleton` Belongs

<!-- rule:forge-ui-tell-spinner-reflex --> A centred spinner in a region whose shape is already known. It reads as generated because the spinner is
shape-agnostic and therefore always available: it needs no thought about what is arriving, and it costs the reader a reflow when the content lands.

### 5d. The Modal Reflex

<!-- rule:forge-ui-tell-modal-reflex --> A `Dialog` for a two-field form, a detail view, an optional filter panel. It reads as generated because
`Dialog` is the most recognisable container in the library, so it becomes the answer to "put this somewhere" — and it spends the top layer and the
reader's whole attention on something that blocks nothing. The order is `forge-ui-catalog-overlay-weight`'s and `forge-ui-depth-dialog-last`'s.

### 5e. Motion on Everything

<!-- rule:forge-ui-tell-motion-everywhere --> A fade on the page, a stagger on the list, a scale on each card, a transition on every hover. It reads
as generated because motion is added per element rather than authored as a moment: nothing is being explained, so the interface reads as performing,
and a reader doing the task ten times a day pays for all of it. The moment is `forge-ui-interaction-one-moment`'s, the properties
`forge-ui-interaction-no-motion-on-layout`'s, and the budget `forge-ui-density-motion-budget`'s. A raised motion dial is still bounded by
`forge-ui-marketing-motion-ceiling`, and every moment stays subject to `forge-ui-reduced-motion`, which is Floor.

### 5f. Geometry Keyed on the Open State

<!-- rule:forge-ui-tell-open-state-geometry --> A popover or dialog whose `width`, `max-height`, `padding` or `inset` sits in its `:popover-open` or
`[open]` rule rather than its base rule. It reads as generated because the open state is where the panel is first seen, so every property describing
it is written there — but forge keeps an overlay painted through its exit fade after that state stops matching, so the panel collapses to its closed
geometry while it is still fading out. `Collapsible`'s `block-size` is a geometry change that is itself the motion.

[floor]: ./floor.md
