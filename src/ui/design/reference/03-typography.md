---
title: Typography
description: "The decisions that separate type that reads well from type that reads as machine-composed: sizes, weights, measure and rhythm."
---

# Typography

Type carries most of a product UI. Almost all of it is text, and the difference between a screen that reads well and one that reads as
machine-composed is usually four decisions: which sizes, which weights, how wide, and how tight.

---

## 0. Quick Reference

- §1 Pick sizes that are obviously different: three or four steps with distance between them, and the responsive headline
- §2 At most two weights: one normal, one heavier, and what forge's primitives already set
- §2a Before / after — a card heading: three weights and a 2px gap, against the untouched pair
- §3 Measure: the 45–75 character band `max-w-prose` lands inside
- §4 Leading runs inverse to size: which leading each size takes, and where forge already sets it
- §5 Tracking: `tracking-tight` above `text-2xl`, and none at all on body copy
- §6 Numerals that align: what `tabular-nums` costs a jittering value, and where it is owed
- §6a Before / after — a stat row: a count that shifts sideways on every update
- §7 Labels: `FIELD_LABEL_CLASSES` through `cn`, and the properties that drift when retyped

---

## 1. Pick sizes that are obviously different

<!-- rule:forge-ui-type-scale-jump --> Tailwind's adjacent steps at the small end are close together — `text-base` to `text-lg` is a 12.5% jump —
and two sizes that close on one surface read as an inconsistency rather than a hierarchy.

<!-- rule:forge-ui-type-min-body-size --> Undersized UI text is a tell of unconsidered work: `text-xs` used for a paragraph reads as a screenshot
shrunk to fit, and it fails the same reader that `forge-ui-contrast-floor` protects.

<!-- rule:forge-ui-type-scale-viewport-ratio --> Body copy is one size at every viewport width, while a headline chosen to outrank it on a wide
screen has to survive a 375px one, where a ratio that reads as hierarchy at 1280px wraps to four lines.

This is a size decision, not a hierarchy one: `forge-ui-type-scale-jump` still governs how many steps the surface uses, and the responsive pair
counts as the one step it resolves to at any given width.

## 2. At most two weights

<!-- rule:forge-ui-type-two-weights --> Forge's primitives already choose for you: `buttonVariants`, `Badge`, `FIELD_LABEL_CLASSES` and
`Alert.Title` set `font-medium` for the control layer, and `Card.Title` sets `font-semibold`, so adopting `font-semibold` as the surface's emphasis
weight keeps the count honest.

<!-- rule:forge-ui-type-weight-over-size -->

### 2a. Before / after — a card heading

```tsx
import { Card } from "@y-core/forge/ui/core";

<Card.Header>
  <Card.Title class='text-lg font-bold'>Billing history</Card.Title>
  <Card.Description class='text-base font-semibold'>Invoices from the past year</Card.Description>
</Card.Header>;
```

Costs the header its hierarchy: three weights (`bold`, `semibold`, and the `medium` the primitives set elsewhere) and a 2px size difference, so the
description competes with the title instead of supporting it.

```tsx
import { Card } from "@y-core/forge/ui/core";

<Card.Header>
  <Card.Title>Billing history</Card.Title>
  <Card.Description>Invoices from the past year</Card.Description>
</Card.Header>;
```

Untouched, `Card.Title` is `font-semibold` on `--card-foreground` and `Card.Description` is `text-sm` on `--muted-foreground`. The weights differ,
the colours differ, and the relationship is already correct.

## 3. Measure

<!-- rule:forge-ui-type-measure-target --> `forge-ui-measure-cap` is the Floor that requires _some_ ceiling. This rule is the aesthetic target
inside it: a column much narrower than 45 characters breaks the reading rhythm as badly as one much wider than 75 loses the eye's return to the next
line.

## 4. Leading runs inverse to size

<!-- rule:forge-ui-type-leading-inverse --> The larger the text, the less leading it needs, because the eye has less horizontal distance to travel
back across relative to the letterforms.

| Text | Leading | Where forge already does this |
| --- | --- | --- |
| A large heading | `leading-none` or `leading-tight` | `Card.Title` sets `leading-none` |
| A label or a compact line | `leading-snug` | `FIELD_LABEL_CLASSES` sets `leading-snug` |
| Body copy | `leading-normal` | `FormField.Description` sets `leading-normal` |
| A paragraph the user will actually read through | `leading-relaxed` | `Alert.Description` sets `leading-relaxed` |

## 5. Tracking

<!-- rule:forge-ui-type-tracking-large --> Type is spaced for body sizes by default, which means it is slightly too loose once it gets large and
correct everywhere else.

<!-- rule:forge-ui-type-tracking-body --> Letterspacing paragraph text reduces readability rather than raising it.

## 6. Numerals that align

<!-- rule:forge-ui-type-tabular-numerals --> Proportional digits have different widths, so a number that updates in place jitters, and a column of
numbers fails to line up under its own decimal point.

### 6a. Before / after — a stat row

```tsx
import { Field } from "@y-core/forge/ui/core";

<Field label='Requests' orientation='horizontal'>
  <span class='text-2xl font-semibold text-foreground'>{count}</span>
</Field>;
```

Costs the row its stability: as `count` ticks from 1,199 to 1,200 the digits change width, so the whole value shifts horizontally on every update
and the eye is pulled back to it.

```tsx
import { Field } from "@y-core/forge/ui/core";

<Field label='Requests' orientation='horizontal'>
  <span class='text-2xl font-semibold tabular-nums tracking-tight text-foreground'>{count}</span>
</Field>;
```

## 7. Labels

<!-- rule:forge-ui-type-label-class -->

```tsx
import { cn, FIELD_LABEL_CLASSES } from "@y-core/forge/ui/core";

<span class={cn(FIELD_LABEL_CLASSES, "text-muted-foreground")}>Delivery window</span>;
```

<!-- rule:forge-ui-label-classes-spelled-once --> Each of the size, the weight, the leading, the icon gap and the disabled-state opacity drifts
independently once it is retyped.

`Label` also takes `required`, which renders its own marker; a hand-written asterisk duplicates that decision, and colour alone would not carry it
(`forge-ui-not-color-alone`).
