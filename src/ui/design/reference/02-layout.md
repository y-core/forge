# Layout and Spacing

Most layouts that look wrong are not wrong in structure. They are wrong in the distances between
things — gaps picked one at a time, each defensible alone, none of them related to any other.

## The scale is the vocabulary

Tailwind v4 builds every spacing utility from one base unit of `0.25rem` (4px), so `p-4` is 16px
and `gap-6` is 24px. Anything expressible as a multiple of that unit is a legal utility, which is
exactly why a rule is needed: legality is not the constraint here, restraint is.
`forge-ui-spacing-scale-only` is the Floor — no arbitrary values, no hand-typed pixel offsets.

Default: a surface draws its spacing from a small set of steps chosen up front — `2`, `3`, `4`,
`6`, `8`, `12`, `16` is a workable default set — rather than picking a fresh value at each
decision, unless a brief specifies a density other than forge's ratified default. <!-- rule:forge-ui-layout-scale-step -->

Default: no two spacing values on one surface sit within 25% of each other — `gap-5` beside
`gap-6` reads as a mistake rather than a distinction, while `gap-4` beside `gap-6` reads as
deliberate — unless the two values are set by two different forge primitives whose internals the
surface does not control. <!-- rule:forge-ui-layout-step-distance -->

The 25% test is easy to apply in your head: 12px and 16px differ by a third and read as two
levels; 20px and 24px differ by a fifth and read as one level rendered inconsistently.

## Ambiguous spacing

A group of elements reads as a group when there is more space *around* it than *within* it. When
the two are equal — or worse, inverted — the reader has to parse the content to find the
boundaries, which is work the layout was supposed to do.

Default: the gap separating two groups is at least twice the gap separating members within a
group, unless a `Separator` or a background change is already carrying the boundary. <!-- rule:forge-ui-layout-group-gap-ratio -->

### Worked example — a form

Forge's field primitives already encode the ratio, so the rule mostly reduces to *use them and do
not override the gaps*:

| Level | Primitive | Gap it sets |
|---|---|---|
| Between fields | `FormField.Group`, `FormField.Set` | `gap-6` — 24px |
| Between the label, control, and description of one field | `FormField.Content` | `gap-1.5` — 6px |

24px around, 6px within: a 4× ratio, and the fields separate at a glance.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField.Group class='gap-2'>
  <FormField name='email'>
    <FormField.Content class='gap-2'>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input name='email' />
      <FormField.Description name='email'>We only use this for receipts.</FormField.Description>
    </FormField.Content>
  </FormField>
  <FormField name='company'>
    <FormField.Content class='gap-2'>
      <FormField.Label name='company'>Company</FormField.Label>
      <Input name='company' />
    </FormField.Content>
  </FormField>
</FormField.Group>;
```

Costs the form its structure: with both gaps at `gap-2`, the description under "Email" sits as
close to the "Company" label as it does to its own input, so the two fields read as one run of
five unrelated lines.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField.Group>
  <FormField name='email'>
    <FormField.Content>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input name='email' />
      <FormField.Description name='email'>We only use this for receipts.</FormField.Description>
    </FormField.Content>
  </FormField>
  <FormField name='company'>
    <FormField.Content>
      <FormField.Label name='company'>Company</FormField.Label>
      <Input name='company' />
    </FormField.Content>
  </FormField>
</FormField.Group>;
```

Default: `FormField.Group` and `FormField.Content` keep their built-in gaps, unless a brief sets a
density that requires the whole form to move together — in which case both move, and the ratio
between them is preserved. <!-- rule:forge-ui-layout-field-gap-ladder -->

### Worked example — a card

`Card`'s own sections encode the same relationship at a larger scale:

| Region | Padding | Internal gap |
|---|---|---|
| `Card.Header` | `px-6 py-5` | `gap-1.5` between title and description |
| `Card.Content` | `px-6 py-5` | whatever the content sets |
| `Card.Footer` | `px-6 py-4` | `gap-2` between actions |

The title and its description sit 6px apart; the header and the content sit 40px apart, because
each contributes its own 20px of vertical padding. Title-to-description is unmistakably tighter
than section-to-section, and the header's bottom border makes the boundary explicit besides.

Default: content inside a `Card` uses the section components rather than padding the root
directly, so the section rhythm survives, unless the card holds a single edge-to-edge element such
as an image or a table that should bleed to the border. <!-- rule:forge-ui-layout-card-section-rhythm -->

Default: spacing between siblings is expressed with `gap-*` on the flex or grid parent rather than
margins on the children, unless one child needs a distance the others do not. <!-- rule:forge-ui-layout-gap-over-margin -->

## Width and the measure

A container that spans the viewport is not a layout decision; it is the absence of one. Every text
region needs a ceiling, and `forge-ui-measure-cap` is the Floor that sets it.

| Region | Reach for |
|---|---|
| A body-copy column | `max-w-prose` |
| A centred form or settings panel | `max-w-md` to `max-w-xl` |
| A page's main content column | `max-w-5xl` to `max-w-7xl`, with `mx-auto` |
| A data table | no ceiling; bound the scroll instead |

Default: a content column carries a `max-w-*` ceiling and centres with `mx-auto`, unless the
region is a table, a canvas, or a media element whose value comes from filling the space. <!-- rule:forge-ui-layout-measure-container -->

## Grouping without borders

The most common way a machine-composed layout announces itself is a border around everything. A
border is the loudest available way to say "these things belong together", and it is almost never
the one the content needs.

Three ways to group, in ascending order of force:

| Force | Device | When |
|---|---|---|
| Lightest | Proximity alone — a `gap-*` ratio | Default; works for most groupings |
| Middle | A `--muted` background panel, or a `Separator` between runs | The boundary matters but the group is not a distinct object |
| Heaviest | A `Card`, which draws `--border` and `shadow-sm` | The group is a distinct object the user could act on as a unit |

Default: grouping is expressed by spacing first, by a `--muted` background or a `Separator`
second, and by a `Card`'s border last, unless a brief describes a surface of peer objects — a
dashboard of independent panels — where the card border is what makes them countable. <!-- rule:forge-ui-layout-border-budget -->

Default: a divider between rows of one list uses `Separator` rather than a `border-b` utility on
each row, unless the rows are already interactive and need a hover background that a `<hr>` would
interrupt. <!-- rule:forge-ui-layout-separator-over-border -->

Default: a panel that needs to read as recessed rather than raised uses a `--muted` background
with no border, unless it sits directly on a `--muted` surface already, where the two would
merge. <!-- rule:forge-ui-layout-muted-panel -->

`forge-ui-no-nested-card` is the Floor here: a `Card` inside a `Card` produces two borders and two
elevations that between them communicate nothing. When a card's content needs internal grouping,
that is exactly the case the `--muted` panel above exists for.

### Before / after — the bordered list

```tsx
import { Card } from "@y-core/forge/ui/core";

<Card.Content class='flex flex-col gap-2'>
  {items.map((item) => (
    <Card class='p-3'>
      <span class='text-sm text-card-foreground'>{item.name}</span>
    </Card>
  ))}
</Card.Content>;
```

Costs the surface its outer boundary: the nested cards draw a second border inside the first, so
the card the user is meant to see as one object dissolves into a stack of small ones — and it
violates `forge-ui-no-nested-card`.

```tsx
import { Card, Separator } from "@y-core/forge/ui/core";

<Card.Content class='flex flex-col'>
  {items.map((item, index) => (
    <>
      {index > 0 ? <Separator /> : null}
      <div class='py-3 text-sm text-card-foreground'>{item.name}</div>
    </>
  ))}
</Card.Content>;
```

## Bounding a region that grows

A list whose length comes from data will eventually be longer than its slot. Letting the page grow
is right for a primary content column and wrong for a sidebar, a panel, or anything beside it.

Default: a region whose height is driven by unbounded data and is not the page's main column is
wrapped in `ScrollArea` with an explicit height, unless the region is the page's primary content,
where the document scroll is the correct scroll. <!-- rule:forge-ui-layout-scroll-area-bound -->

```tsx
import { ScrollArea } from "@y-core/forge/ui/core";

<ScrollArea class='h-72'>
  <ScrollArea.Viewport class='pr-3'>{rows}</ScrollArea.Viewport>
</ScrollArea>;
```

`ScrollArea.Viewport` keeps the platform's own scrolling and its own scrollbar, so the bound costs
nothing in behaviour. Height comes from the scale like every other distance —
`forge-ui-spacing-scale-only` applies to `h-*` as much as to `gap-*`, and
`forge-ui-viewport-units` governs when a viewport-relative height is legitimate instead.
