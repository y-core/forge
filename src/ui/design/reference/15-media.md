---
title: Media
description: "Photographs and glyphs — the two things that arrive on a surface no token controls, and how to keep them from defeating the theme."
---

# Media

A photograph and a glyph arrive on a surface that no token controls. Both defeat the rules the rest of this corpus relies on, and in
the same way — a photograph is a colour the theme did not choose, and a glyph is a shape whose size is not the box it was dropped into.

Forge ships no image component and no aspect-ratio primitive. The one image element it owns is `Avatar.Image`:
`aspect-square size-full object-cover` inside a root that is `overflow-hidden rounded-full bg-muted`, with a prop type that makes `alt` required
rather than optional. Every rule in the first section is that composition, generalised.

## 0. Quick Reference

- §1 Images on a surface: putting a token surface back under text, and boxing an image you do not control
- §1a Scrims and treated images: why the pair has to be token against token again
- §1b Fixed boxes, clipped corners and `alt`: what `Avatar.Image` already composes, generalised
- §1c Before / after — a caption over a hero image: contrast the gate cannot compute, and the fix
- §2 A carousel is the last resort: same-kind media the reader chooses between, never content to read
- §3 Glyphs at the size they were drawn: `size-4` or `size-5`, and growing the enclosure instead
- §3a Before / after — an empty-state mark: a glyph at four times its stroke, against an enclosure

---

## 1. Images on a surface

A photograph carries its own light and dark regions, so a foreground colour that is measured against a token is not measured against anything the
reader actually sees. `forge-ui-contrast-floor` is a Floor rule, and this is the one composition where it cannot be checked: the gate resolves token
against token, and no ratio exists between `--foreground` and a photograph. The fix is not to find a colour that works over the picture — it is to
put a surface back underneath the text, so the pair being measured is a pair the gate can see again.

### 1a. Scrims and treated images

<!-- rule:forge-ui-media-text-scrim --> The opacity here is the carve-out `forge-ui-color-scale-no-adhoc-tint` already names: a scrim is genuinely
translucent over content it must not hide, which is the one case where an opacity modifier is the right instrument rather than a faked intermediate
shade.

<!-- rule:forge-ui-media-no-text-shadow --> The move this rule exists to refuse is a wide, offsetless shadow behind the text, which is the usual
answer elsewhere. It is unavailable twice over here: it can only be written as an arbitrary `shadow-[…]` value, which `forge-ui-spacing-scale-only`
refuses, and a large soft halo is the opposite of the tight, low shadow `forge-ui-depth-soft-shadow` describes. Treating the image keeps the
decision in the layer that caused the problem.

### 1b. Fixed boxes, clipped corners and `alt`

<!-- rule:forge-ui-media-fixed-crop --> A row of cards fed by uploads is the case that makes this concrete: without a fixed box, every card in the
row is a different height, and the grid reads as broken rather than as varied.

<!-- rule:forge-ui-media-container-clip -->

Whether an image carries an `alt` is Floor: `forge-ui-media-alt-required`, in `floor.md`.

### 1c. Before / after — a caption over a hero image

```tsx
<div class='relative'>
  <img src={hero.url} alt='' class='w-full' />
  <p class='absolute bottom-6 left-6 text-lg text-foreground'>Deployed in 40 seconds</p>
</div>
```

Costs the caption its contrast, and costs the gate its ability to say so: the text is measured against `--background`, which is not what is behind
it. On a light photograph it disappears entirely, and on a mixed one it disappears across half its own length. The image also renders at the file's
own ratio, so the block's height changes with whatever was uploaded.

```tsx
<div class='relative aspect-video overflow-hidden rounded-lg'>
  <img src={hero.url} alt='' class='size-full object-cover' />
  <div class='absolute inset-0 bg-background/70'></div>
  <p class='absolute bottom-6 left-6 text-lg text-foreground'>Deployed in 40 seconds</p>
</div>
```

The pair is `--foreground` on `--background` again — a ratio the gate computes and the theme moves in dark mode — the box is one height whatever the
upload was, and the corner comes from the container.

## 2. A carousel is the last resort

<!-- rule:forge-ui-media-carousel-last-resort --> `Carousel` shows one slide and hides the rest, and asks the reader to operate it to see any other.
Everything it hides is content the reader has not read. That is a fair trade for a set of same-kind media — product photographs, screenshots of one
screen — where the reader is choosing between slides rather than reading through them, and no trade at all for content that must be read.

The dots are what keep the platform honest: each is an anchor to a slide's `id`, so a slide is addressable, bookmarkable, and reachable by keyboard
with no script — the same argument `forge-ui-pagination-vs-scroll` makes for a paged list.

## 3. Glyphs at the size they were drawn

<!-- rule:forge-ui-media-icon-intended-size --> An icon in the sprite was drawn at a small size, with a stroke weight chosen for it. Scaled to four
times that, the stroke thins visibly against every other line on the surface and the shape reads as an illustration that lost its detail.

This is orthogonal to `forge-ui-real-icons`, which is a Floor rule about _provenance_ — that a glyph comes from `Icon` or a `createIcon` binding
rather than from an inline `<svg>` or an emoji. That rule is satisfied by a sprite icon at any size at all. Size is the separate question, and it is
a Default because a brief can rebut it.

<!-- rule:forge-ui-media-icon-enclosure --> Sizing an icon _button_ is a different rule and it is `forge-ui-hierarchy-icon-button-size`: that one
fixes which `shape` and `size` an icon-only `Button` takes. This one is about the glyph inside whatever box was chosen.

### 3a. Before / after — an empty-state mark

```tsx
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<AppIcon name='inbox' class='size-16 text-muted-foreground' aria-hidden='true' />;
```

Costs the mark its weight: the stroke is the thinnest line on the surface, and the glyph reads as a low-resolution image beside type that is crisp.

```tsx
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<div class='flex size-12 items-center justify-center rounded-full bg-muted'>
  <AppIcon name='inbox' class='size-5 text-muted-foreground' aria-hidden='true' />
</div>;
```

The slot is as large as it was going to be either way. The enclosure carries the size, the glyph keeps its stroke, and the shape is a `--radius`
decision rather than a scaling one.
