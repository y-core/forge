# AI Tells

Output patterns that mark a surface as machine-composed rather than designed. None is a bug: each
type-checks, renders, passes a test — and each is recognisable at a glance to anyone who has seen a
hundred generated interfaces, which is now everyone.

Everything here is Tier 2, rebuttable only by an explicit written brief. Where a tell is already a
Floor violation the Floor id is cited rather than restated, and the entry carries only what the
Floor does not: why the pattern gets generated, and what to reach for instead.

---

## Colour and surface

**Gradient text.** A headline set with `bg-gradient-to-r` plus `bg-clip-text` and a transparent
fill. It reads as generated because it is the cheapest available decoration and it encodes nothing:
the gradient carries no state, no hierarchy, and no brand that the token layer does not already
hold — so it is applied to whichever line happened to be the biggest.
Default: a headline takes one semantic token — `text-foreground`, or `text-primary` when it is the
page's single accent moment under `forge-ui-marketing-one-accent` — and no gradient
fill. <!-- rule:forge-ui-tell-gradient-text -->
Override when a brief supplies a brand gradient, which is then declared in a theme file and consumed
as a token like every other colour.

**The violet-and-cyan accent, and the glow under it.** A saturated purple `--primary` nobody chose,
with a coloured `shadow` behind the hero control. It reads as generated because it is a default that
was never a decision — the hue arrives with the output rather than with the product, and the glow is
a light source the rest of the page does not have.
Default: `--primary` is `--accent-12`, which forge aliases to `--gray-12` — the loaded scheme's
near-black, not a hue anyone typed — and an accent surface is
`bg-primary text-primary-foreground` with no coloured shadow behind
it. <!-- rule:forge-ui-tell-neon-accent -->
Override when a brief names the brand hue, which is set once by re-mapping `--primary` in the app's
stylesheet rather than per element.

**A pure black page.** `bg-black`, or a hex literal for the same, as the dark-mode ground.
It reads as generated because forge's dark mode never produces it: `--background` maps to `--gray-1`,
which is a near-black rather than black, so a true black surface can only have been typed in — and it
puts maximum contrast against every border on the page while making `--card` at `--gray-2` look like
a mistake.
Default: the page ground is `bg-background`, and every darker or lighter surface moves along the
scale rather than to an endpoint. <!-- rule:forge-ui-tell-pure-black -->
Override when a brief specifies an OLED theme, which is a theme file redefining the scale's steps,
not a class on a page. A hex literal remains refused by `forge-ui-color-token-only` either way.

**Decorative glass.** `backdrop-blur` with a translucent white or black fill on a card, a header, or
a panel. It reads as generated because the blur is applied where nothing is behind it to blur —
translucency is a claim that the surface is floating over content, and a card in the page flow is
not.
Default: a raised surface is opaque — `bg-card` at level 2, `bg-popover` at levels 3 and 4, per
`forge-ui-depth-popover-token` — and carries no backdrop filter. <!-- rule:forge-ui-tell-glass-surface -->
Override for a surface that genuinely overlays scrolling content and must keep it partly legible,
such as a sticky page header.

**A hard offset shadow with no blur.** `shadow-[4px_4px_0_...]`, or the same shape hand-built from a
border. It reads as generated because it is a second outline wearing a shadow's name: forge's
shadows stand in for a light above the interface, and an unblurred offset is a graphic device from a
different visual language dropped onto one element.
Default: elevation is `shadow-sm` / `shadow-md` / `shadow-lg` taken from the level the surface
claims, per `forge-ui-depth-soft-shadow`. <!-- rule:forge-ui-tell-hard-shadow -->
Override under a brief for a deliberately flat illustrative style, applied to every raised surface
on the page rather than to the one being emphasised.

**`text-white/70` on a coloured surface.** This is a Floor violation —
`forge-ui-foreground-pairing`. What the Floor does not say is why it keeps appearing: it is the
shortest way to make a foreground look "secondary" without looking up which token the background
pairs with, and it happens to look fine on the one surface it was written against.
Default: supporting text on any surface is that surface's paired foreground at full opacity —
`text-muted-foreground` on `--background` and `--card`, `text-primary-foreground` on `--primary` —
and hierarchy below that is carried by weight or size rather than by
alpha. <!-- rule:forge-ui-tell-opacity-foreground -->
Override never; the Floor rule admits none, and this entry only explains the reflex.

---

## Structure

**Nested cards.** A Floor violation — `forge-ui-no-nested-card`. It appears because "group these
things" and "this is a group" are the same instruction to a generator, so every level of nesting in
the data becomes a level of elevation in the markup.
Default: an inner region of a `Card` is separated with `Separator` or set on a `bg-muted` panel with
no border, and peer objects are promoted to siblings of the outer `Card`
instead. <!-- rule:forge-ui-tell-nested-card -->
Override never; see the Floor rule.

**A row of exactly three equal cards.** Three features, three tiers, three benefits — always three,
always the same width, always the same internal composition. It reads as generated because three is
what a grid defaults to when nothing in the content asked for a count.
Default: the number of cards in a row comes from the data, and a row whose count was chosen rather
than counted is rebuilt as a list — `Separator`-divided rows in one `Card.Content`, per
`forge-ui-density-separator-over-card`. <!-- rule:forge-ui-tell-three-card-row -->
Override when the surface genuinely has three peer objects, which a reader can verify against the
source of the data.

**An eyebrow above every heading.** A small uppercase tracked line — "FEATURES", "HOW IT WORKS" —
sitting over each `Card.Title` or section heading. It reads as generated because it is applied
uniformly: an eyebrow names the section a heading belongs to, and a surface where every heading has
one is a surface where no heading needed one.
Default: a section carries a heading and nothing above it; where the section genuinely needs naming,
the name is the heading, sized with a class per
`forge-ui-a11y-heading-size-by-class`. <!-- rule:forge-ui-tell-eyebrow-kicker -->
Override for a single eyebrow that names a category the heading cannot carry — a `Badge` `outline`
is usually the better form of that anyway.

**Numbered sections.** `01`, `02`, `03` set large and faint beside each heading. It reads as
generated because the numbers assert a sequence the content does not have: three independent
features are not steps, and numbering them tells the reader to read in an order that does not
matter.
Default: sections are unnumbered unless the reader must follow them in order, in which case the
order is real and the numbers are content rather than
decoration. <!-- rule:forge-ui-tell-numbered-sections -->
Override for a genuine procedure — an onboarding sequence, a setup guide — where a step number is
what the reader refers to.

**`h-screen`.** A Floor violation — `forge-ui-viewport-units`. It persists because it is the obvious
way to say "fill the window" and because it looks correct on the desktop viewport it was written
against; the failure is only visible on a phone, under the browser chrome.
Default: a full-height shell is `min-h-dvh`, and a bounded inner region takes a height from the
spacing scale inside a `ScrollArea` per
`forge-ui-layout-scroll-area-bound`. <!-- rule:forge-ui-tell-h-screen -->
Override never; see the Floor rule.

**Monotonous spacing.** Every gap on the surface the same value — `gap-4` between fields, between
groups, between sections, and inside the card. It reads as generated because uniform spacing is what
you get when each distance is chosen independently and the same default wins every time, and it
leaves the reader to find the group boundaries by reading the content.
Default: a surface uses a small set of steps with a real ratio between them, the outer gap at least
twice the inner one per `forge-ui-layout-group-gap-ratio`, and no two steps within 25% per
`forge-ui-layout-step-distance`. <!-- rule:forge-ui-tell-uniform-spacing -->
Override for a single uniform run — a list of peer rows — where every gap genuinely separates the
same kind of thing.

**Custom scrollbars.** `scrollbar-width`, a `::-webkit-scrollbar` rule, or a hand-built thumb over a
region that is already scrollable. It reads as generated because it re-implements a platform control
that forge deliberately left alone, and the re-implementation loses keyboard scrolling, the
platform's overscroll behaviour, and the reader's own OS setting.
Default: a bounded region is a `ScrollArea` with a `ScrollArea.Viewport`, whose scrolling and
scrollbar are the platform's. <!-- rule:forge-ui-tell-custom-scrollbar -->
Override never for the primitive; a brief may restyle the viewport's padding, not its scrolling.

**A skipped heading level.** A Floor violation — `forge-ui-heading-order`. It arrives one way almost
every time: the heading needed to be smaller, so the tag was changed instead of the class.
Default: the level comes from the section's position in the document and the size comes from a
class — `text-sm font-medium` on an `<h3>` satisfies both — and a compound that fixes its own tag,
as `Card.Title` does, is left alone. <!-- rule:forge-ui-tell-heading-skip -->
Override never; see the Floor rule.

---

## Type

**A flat type hierarchy.** Every step one notch from the last — `text-sm`, `text-base`, `text-lg`,
`text-xl` on one surface. It reads as generated because adjacent steps differ by too little to read
as different: a 12.5% jump from 16px to 18px looks like an inconsistency rather than a level, so the
surface has four sizes and one hierarchy.
Default: three or four sizes with real distance between them, per `forge-ui-type-scale-jump`, and
emphasis carried by weight rather than by another size per
`forge-ui-type-weight-over-size`. <!-- rule:forge-ui-tell-adjacent-type-steps -->
Override for a dense data view where two adjacent small steps carry row text and column headers.

**Justified body copy.** `text-justify` on a paragraph column. It reads as generated because it is a
print convention applied without the hyphenation engine that makes it work: the browser opens rivers
of white space between words instead, and the effect is worst at exactly the measure
`forge-ui-measure-cap` produces.
Default: body copy is left-aligned and capped at the comfortable measure with
`max-w-prose`. <!-- rule:forge-ui-tell-justified-text -->
Override never in a browser context; justification without hyphenation costs readability at every
width.

**Undersized UI text.** `text-xs` on paragraphs, on button labels, on anything a reader must
actually read. It reads as generated because it is the visual signature of fitting content into a
box that was decided first — a screenshot shrunk to fit — and small text needs more contrast than it
was given, not less.
Default: body copy is never below `text-sm` and `text-xs` is reserved for labels, badges and
metadata, per `forge-ui-type-min-body-size`; a control that does not fit moves down the
`buttonVariants` size scale to `sm` and no further, per
`forge-ui-density-floor-holds`. <!-- rule:forge-ui-tell-undersized-text -->
Override under a brief for a dense view, where the small text is not the primary content.

**Letterspaced body copy.** `tracking-wide` or `tracking-wider` on a paragraph. It reads as
generated because it is a display treatment applied to reading text: tracking exists to compensate
for large sizes and uniform all-caps letterforms, and adding it to a paragraph slows the reader down
in exchange for nothing.
Default: body copy carries no tracking utility at all and large text carries `tracking-tight`, per
`forge-ui-type-tracking-body` and `forge-ui-type-tracking-large`; a short all-caps label is the one
exception. <!-- rule:forge-ui-tell-tracked-body -->
Override for that all-caps label, where `tracking-wide` is the compensation the letterforms need.

---

## Content

**Fabricated metrics.** A Floor violation — `forge-ui-no-fabricated-data`. It happens because a
layout has a slot the size of a number and generating a plausible number is easier than reporting
that there is none; "+312%" and "12,000 teams" are the shapes that fit.
Default: a metric renders only when the real value is supplied, and the element is omitted entirely
otherwise, per `forge-ui-marketing-omit-unfilled-section` — not filled with a
placeholder. <!-- rule:forge-ui-tell-invented-metric -->
Override never; see the Floor rule.

**Placeholder identities.** A Floor violation — `forge-ui-no-fabricated-data`. "John Doe",
"Acme Inc", "jane@example.com" beside a stock `Avatar`. The reflex is the same as the metric one:
the row needs a name, so a name is produced.
Default: render the real record, or render the empty state that `forge-ui-empty-state` requires; an
`Avatar` carries a real image or real initials through `Avatar.Fallback`, per
`forge-ui-marketing-avatar-real-person`. <!-- rule:forge-ui-tell-placeholder-identity -->
Override never; see the Floor rule.

**Invented testimonials.** A Floor violation — `forge-ui-no-fabricated-data`, and the most damaging
form of it, because a quote attributed to a named person at a named company is a factual claim about
strangers. It is generated for the same reason as the rest: the section shape exists and the content
does not.
Default: a proof element renders only against a real quote from a real, named source, per
`forge-ui-marketing-no-invented-proof`, and the whole section is omitted when there is
none. <!-- rule:forge-ui-tell-invented-testimonial -->
Override never; see the Floor rule.

**Lorem ipsum shipped as copy.** Latin filler left in a `Card.Description`, an `Alert.Description`,
or a hero supporting line. It reads as generated because it is unreviewable: nobody can tell whether
the layout works for the real copy, and it survives into production precisely because it looks like
content at a glance.
Default: every text slot holds either real copy or nothing, and a slot with no copy is a slot to
remove rather than fill. <!-- rule:forge-ui-tell-lorem-ipsum -->
Override when the brief asks for a wireframe, in which case the placeholder is labelled as one in
the surrounding copy.

---

## Icons and motion

**Emoji used as icons.** A Floor violation — `forge-ui-real-icons`. It happens because an emoji is
available without a sprite, a fetch, or a name — but it renders in the reader's platform font, so
the same glyph is a different drawing on every OS, and it carries a name in the accessibility tree
that nobody chose.
Default: a glyph comes from the sprite through `Icon`, or through a `createIcon` binding typed
`ForgeIcon`, both from `@y-core/forge/ui/core`; forge's own glyph set is enumerated by
`FORGE_UI_ICON_NAMES` in `@y-core/forge/ui/assets`, and an app sprite extends it through the same
factory. <!-- rule:forge-ui-tell-emoji-icon -->
Override never; see the Floor rule.

```tsx
import { createIcon } from "@y-core/forge/ui/core";
const AppIcon = createIcon("/assets/icons.svg");
```

**Hand-rolled inline SVG.** Also `forge-ui-real-icons`. The path data is usually recalled rather
than drawn, so the viewBox, the stroke width and the optical size disagree with every other glyph on
the page — and each copy is a separate thing to change when the icon set moves.
Default: add the glyph to the app's sprite and reach for it by name through the `createIcon`
binding, so size, stroke and `aria-hidden` come from one
place. <!-- rule:forge-ui-tell-inline-svg -->
Override never; see the Floor rule.

**A `Spinner` where a `Skeleton` belongs.** A centred spinner in a region whose shape is already
known. It reads as generated because the spinner is shape-agnostic and therefore always available:
it needs no thought about what is arriving, and it costs the reader a reflow when the content lands.
Default: a region of known shape renders `Skeleton` blocks in that shape, per
`forge-ui-state-skeleton-shape`, and `Spinner` marks a wait inside a control or a wait of unknown
shape, per `forge-ui-state-spinner-scope`. <!-- rule:forge-ui-tell-spinner-reflex -->
Override for a very short wait in a known-shape region, where a skeleton flash is the more
disruptive of the two.

**The modal reflex.** A `Dialog` for a two-field form, a detail view, an optional filter panel. It
reads as generated because `Dialog` is the most recognisable container in any component library, so
it becomes the answer to "put this somewhere" — and it spends the top layer and the reader's whole
attention on something that blocks nothing.
Default: take the lightest overlay the job survives — `Collapsible` when the content belongs to the
page, `Popover` when it is anchored to a trigger, `Dialog` only when the task truly blocks — per
`forge-ui-catalog-overlay-weight` and `forge-ui-depth-dialog-last`. <!-- rule:forge-ui-tell-modal-reflex -->
Override when the content must be read before anything else proceeds, or when a light dismiss would
lose the reader's work.

**Motion on everything.** A fade on the page, a stagger on the list, a scale on each card, a
transition on every hover. It reads as generated because motion is added per element rather than
authored as a moment: nothing is being explained, so the interface reads as performing, and a reader
doing the task ten times a day pays for all of it.
Default: one authored motion moment per interaction, on `transform` and `opacity` only, per
`forge-ui-interaction-one-moment` and `forge-ui-interaction-no-motion-on-layout`; state changes the
reader caused are the only ones that carry motion at all, per
`forge-ui-density-motion-budget`. <!-- rule:forge-ui-tell-motion-everywhere -->
Override under a brief raising the motion dial for a named marketing surface, where
`forge-ui-marketing-motion-ceiling` still bounds it. Every moment stays subject to
`forge-ui-reduced-motion`, which is Floor.

---

The countable pass that catches most of the above before anyone reads the output is
`preflight.md`.
