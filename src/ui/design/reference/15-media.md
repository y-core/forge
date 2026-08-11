# Media

Two things arrive on a surface that no token controls: a photograph, and a glyph. Both defeat the
rules the rest of this corpus relies on, and in the same way — a photograph is a colour the theme
did not choose, and a glyph is a shape whose size is not the box it was dropped into.

Forge ships no image component and no aspect-ratio primitive. The one image element it owns is
`Avatar.Image`, and it is worth reading as the reference implementation for everything below: it is
`aspect-square size-full object-cover` inside a root that is `overflow-hidden rounded-full
bg-muted`, and its prop type makes `alt` required rather than optional. Every rule in the first
section is that composition, generalised.

## Images on a surface

A photograph carries its own light and dark regions, so a foreground colour that is measured
against a token is not measured against anything the reader actually sees. `forge-ui-contrast-floor`
is a Floor rule, and this is the one composition where it cannot be checked: the gate resolves
token against token, and no ratio exists between `--foreground` and a photograph. The fix is not to
find a colour that works over the picture — it is to put a surface back underneath the text, so the
pair being measured is a pair the gate can see again.

Default: text laid over a photograph sits above an `absolute inset-0` scrim carrying a background
token at reduced opacity — `bg-background/70` under dark text, `bg-foreground/60` under light — so
the ratio is once again token against token, unless the text sits beside the image rather than on
it, which is the composition that needs no scrim at
all. <!-- rule:forge-ui-media-text-scrim -->

The opacity here is the carve-out `forge-ui-color-scale-no-adhoc-tint` already names: a scrim is
genuinely translucent over content it must not hide, which is the one case where an opacity
modifier is the right instrument rather than a faked intermediate shade.

Default: where a scrim would flatten detail the image is there to show, the *image* is treated
instead — `grayscale`, or a `mix-blend-multiply` against a token surface behind it — and never the
text, which keeps its token colour, unless the image is decorative enough to crop the text off it
entirely. <!-- rule:forge-ui-media-no-text-shadow -->

The move this rule exists to refuse is a wide, offsetless shadow behind the text, which is the
usual answer elsewhere. It is unavailable twice over here: it can only be written as an arbitrary
`shadow-[…]` value, which `forge-ui-spacing-scale-only` refuses, and a large soft halo is the
opposite of the tight, low shadow `forge-ui-depth-soft-shadow` describes. Treating the image keeps
the decision in the layer that caused the problem.

Default: an image whose proportions the surface does not control — an upload, an avatar, a
third-party thumbnail — renders into a fixed box, `aspect-square` or `aspect-video` with
`object-cover` and `overflow-hidden` on the container, rather than at whatever ratio the file
happens to carry, unless the image *is* the content and its proportion is information, as a chart
or a screenshot under review is. <!-- rule:forge-ui-media-fixed-crop -->

A row of cards fed by uploads is the case that makes this concrete: without a fixed box, every card
in the row is a different height, and the grid reads as broken rather than as varied.

Default: an image's corners come from `overflow-hidden` on its container, never from a radius
utility on the image itself, so `forge-ui-one-radius` still decides the shape — as it does for
`Avatar`, whose root carries `rounded-full` and `overflow-hidden` while `Avatar.Image` carries
neither — unless the image is a standalone element with no container, in which case it takes the
same `--radius` step it would have inherited. <!-- rule:forge-ui-media-container-clip -->

Default: every hand-written `<img>` carries an `alt`, empty only when the image is decorative and
the surrounding text already says everything it says, matching the contract `Avatar.Image` enforces
by typing `alt` as required rather than
optional. <!-- rule:forge-ui-media-alt-required -->

### Before / after — a caption over a hero image

```tsx
<div class='relative'>
  <img src={hero.url} alt='' class='w-full' />
  <p class='absolute bottom-6 left-6 text-lg text-foreground'>Deployed in 40 seconds</p>
</div>
```

Costs the caption its contrast, and costs the gate its ability to say so: the text is measured
against `--background`, which is not what is behind it. On a light photograph it disappears
entirely, and on a mixed one it disappears across half its own length. The image also renders at
the file's own ratio, so the block's height changes with whatever was uploaded.

```tsx
<div class='relative aspect-video overflow-hidden rounded-lg'>
  <img src={hero.url} alt='' class='size-full object-cover' />
  <div class='absolute inset-0 bg-background/70'></div>
  <p class='absolute bottom-6 left-6 text-lg text-foreground'>Deployed in 40 seconds</p>
</div>
```

The pair is `--foreground` on `--background` again — a ratio the gate computes and the theme moves
in dark mode — the box is one height whatever the upload was, and the corner comes from the
container.

## Glyphs at the size they were drawn

An icon in the sprite was drawn at a small size, with a stroke weight chosen for it. Scaled to four
times that, the stroke thins visibly against every other line on the surface and the shape reads as
an illustration that lost its detail.

This is orthogonal to `forge-ui-real-icons`, which is a Floor rule about *provenance* — that a glyph
comes from `Icon` or a `createIcon` binding rather than from an inline `<svg>` or an emoji. That
rule is satisfied by a sprite icon at any size at all. Size is the separate question, and it is a
Default because a brief can rebut it.

Default: a sprite glyph renders at `size-4`, the 16px that `Accordion.Trigger` and
`Collapsible.Trigger` set and that `Select` gives its chevron, or one step up to `size-5` where it
carries more weight, unless the icon set is drawn for display sizes and states the size it was
drawn at. <!-- rule:forge-ui-media-icon-intended-size -->

Default: where a glyph has to anchor a large slot, the *enclosure* grows and the glyph does not — a
`size-10` or `size-12` `rounded-full bg-muted` shape with a `size-4` or `size-5` `Icon` centred in
it — which is the composition `Avatar` already ships and the trade `Button size='icon'` makes at 36
pixels around a 16-pixel glyph, unless the slot is a decorative illustration carrying no control and
no state. <!-- rule:forge-ui-media-icon-enclosure -->

Sizing an icon *button* is a different rule and it is `forge-ui-hierarchy-icon-button-size`: that
one fixes which `size` prop an icon-only `Button` takes. This one is about the glyph inside
whatever box was chosen.

### Before / after — an empty-state mark

```tsx
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<AppIcon name='inbox' class='size-16 text-muted-foreground' aria-hidden='true' />;
```

Costs the mark its weight: at four times its drawn size the stroke is the thinnest line on the
surface, and the glyph reads as a low-resolution image beside type that is crisp.

```tsx
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<div class='flex size-12 items-center justify-center rounded-full bg-muted'>
  <AppIcon name='inbox' class='size-5 text-muted-foreground' aria-hidden='true' />
</div>;
```

The slot is as large as it was going to be either way. The enclosure carries the size, the glyph
keeps its stroke, and the shape is a `--radius` decision rather than a scaling one.
