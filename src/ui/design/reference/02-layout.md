---
title: Layout and Spacing
description: "Why most wrong-looking layouts are wrong in their distances rather than their structure, and the spacing scale that relates them."
---

# Layout and Spacing

Most layouts that look wrong are not wrong in structure. They are wrong in the distances between things — gaps picked one at a time, each defensible
alone, none of them related to any other.

---

## 0. Quick Reference

- §1 The scale is the vocabulary: a small chosen step set, and the 25% test that keeps two steps distinct
- §2 Ambiguous spacing: more space around a group than within it, at a ratio of at least two
- §2a Worked example — a form: the gaps `FormField.Group` and `FormField.Content` already encode
- §2b Worked example — a card: `Card`'s section padding, and why content goes in the sections
- §3 Stacking: at most three layers, and what a deeper pile should be instead
- §4 Width and the measure: which ceiling each kind of region takes, and when none applies
- §5 Tables and lists: two comparable columns make a table; one value per record makes a list
- §6 Grouping without borders: proximity, then a muted panel or `Separator`, then a `Card` last
- §6a Before / after — the bordered list: nested cards dissolving the boundary they sit inside
- §7 Bounding a region that grows: which regions take a `ScrollArea` and which take the document scroll

---

## 1. The scale is the vocabulary

<!-- rule:forge-ui-layout-scale-step --> Tailwind v4 builds every spacing utility from one base unit of `0.25rem` (4px), so `p-4` is 16px and
`gap-6` is 24px. Anything expressible as a multiple of that unit is a legal utility, which is why a rule is needed: the constraint is restraint, not
legality. `forge-ui-spacing-scale-only` is the Floor — no arbitrary values, no hand-typed pixel offsets.

<!-- rule:forge-ui-layout-step-distance -->

## 2. Ambiguous spacing

<!-- rule:forge-ui-layout-group-gap-ratio --> A group of elements reads as a group when there is more space _around_ it than _within_ it. When the
two are equal — or worse, inverted — the reader has to parse the content to find the boundaries, which is work the layout was supposed to do.

### 2a. Worked example — a form

Forge's field primitives already encode the ratio, so the rule mostly reduces to _use them and do not override the gaps_:

| Level | Primitive | Gap it sets |
| --- | --- | --- |
| Between fields | `FormField.Group`, `FormField.Set` | `gap-6` — 24px |
| Between the label, control, and description of one field | `FormField.Content` | `gap-1.5` — 6px |

24px around, 6px within: a 4× ratio, and the fields separate at a glance.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField.Group class='gap-2'>
  <FormField>
    <FormField.Content class='gap-2'>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input field={{ name: "email", description: true }} />
      <FormField.Description name='email'>We only use this for receipts.</FormField.Description>
    </FormField.Content>
  </FormField>
  <FormField>
    <FormField.Content class='gap-2'>
      <FormField.Label name='company'>Company</FormField.Label>
      <Input field={{ name: "company" }} />
    </FormField.Content>
  </FormField>
</FormField.Group>;
```

Costs the form its structure: with both gaps at `gap-2`, the description under "Email" sits as close to the "Company" label as it does to its own
input, so the two fields read as one run of five unrelated lines.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField.Group>
  <FormField>
    <FormField.Content>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input field={{ name: "email", description: true }} />
      <FormField.Description name='email'>We only use this for receipts.</FormField.Description>
    </FormField.Content>
  </FormField>
  <FormField>
    <FormField.Content>
      <FormField.Label name='company'>Company</FormField.Label>
      <Input field={{ name: "company" }} />
    </FormField.Content>
  </FormField>
</FormField.Group>;
```

<!-- rule:forge-ui-layout-field-gap-ladder -->

### 2b. Worked example — a card

`Card`'s own sections encode the same relationship at a larger scale:

| Region | Padding | Internal gap |
| --- | --- | --- |
| `Card.Header` | `px-6 py-5` | `gap-1.5` between title and description |
| `Card.Content` | `px-6 py-5` | whatever the content sets |
| `Card.Footer` | `px-6 py-4` | `gap-2` between actions |

<!-- rule:forge-ui-layout-card-section-rhythm --> The title and its description sit 6px apart; the header and the content sit 40px apart, because
each contributes its own 20px of vertical padding. The header's bottom border makes the boundary explicit besides.

<!-- rule:forge-ui-layout-gap-over-margin -->

## 3. Stacking

<!-- rule:forge-ui-layout-stack-depth --> A `Stack` layers its children in one cell: the first child is the readable one and the next two peek out
behind it, fanned towards `placement`. It is for a pile the reader will open — a deck of cards, a bundle of thumbnails — where the offset says
"there is more" and the top item says what.

## 4. Width and the measure

<!-- rule:forge-ui-layout-measure-container --> A container that spans the viewport is not a layout decision; it is the absence of one. Every text
region needs a ceiling, and `forge-ui-measure-cap` is the Floor that sets it.

| Region | Reach for |
| --- | --- |
| A body-copy column | `max-w-prose` |
| A centred form or settings panel | `max-w-md` to `max-w-xl` |
| A page's main content column | `max-w-5xl` to `max-w-7xl`, with `mx-auto` |
| A data table | no ceiling; bound the scroll instead |

## 5. Tables and lists

<!-- rule:forge-ui-table-not-list --> A table earns its markup when a reader compares rows on the same attributes — three columns of like values,
scanned down rather than across. One value per record is a list, and a `<table>` around it hands assistive technology a grid to navigate for no
gain, while costing the responsive collapse a list gets free.

## 6. Grouping without borders

<!-- rule:forge-ui-layout-border-budget --> The most common way a machine-composed layout announces itself is a border around everything. A border
is the loudest available way to say "these things belong together", and it is almost never the one the content needs.

Ways to group, in ascending order of force:

| Force | Device | When |
| --- | --- | --- |
| Lightest | Proximity alone — a `gap-*` ratio | Default; works for most groupings |
| Middle | A `--muted` background panel, or a `Separator` between runs | The boundary matters but the group is not a distinct object |
| Heaviest | A `Card`, which draws `--border` and `shadow-sm` | The group is a distinct object the user could act on as a unit |

<!-- rule:forge-ui-layout-separator-over-border -->

<!-- rule:forge-ui-layout-muted-panel --> `forge-ui-no-nested-card` is the Floor here. When a card's content needs internal grouping, that is
exactly the case the `--muted` panel above exists for.

### 6a. Before / after — the bordered list

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

Costs the surface its outer boundary: the nested cards draw a second border inside the first, so the card the user is meant to see as one object
dissolves into a stack of small ones — and it violates `forge-ui-no-nested-card`.

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

## 7. Bounding a region that grows

<!-- rule:forge-ui-layout-scroll-area-bound --> A list whose length comes from data will eventually be longer than its slot. Letting the page grow
is right for a primary content column and wrong for a sidebar, a panel, or anything beside it.

```tsx
import { ScrollArea } from "@y-core/forge/ui/core";

<ScrollArea class='h-72'>
  <ScrollArea.Viewport label='Rows' class='pr-3'>{rows}</ScrollArea.Viewport>
</ScrollArea>;
```

`ScrollArea.Viewport` keeps the platform's own scrolling and its own scrollbar, so the bound costs nothing in behaviour. Height comes from the scale
like every other distance — `forge-ui-spacing-scale-only` applies to `h-*` as much as to `gap-*`, and [`../floor.md`][floor] states when a
viewport-relative height is legitimate instead.

[floor]: ../floor.md
