# Typography

Type carries most of a product UI. Almost all of it is text, and the difference between a screen
that reads well and one that reads as machine-composed is usually four decisions: which sizes,
which weights, how wide, and how tight.

## Pick sizes that are obviously different

Tailwind's default scale runs `text-xs` 12px, `text-sm` 14px, `text-base` 16px, `text-lg` 18px,
`text-xl` 20px, `text-2xl` 24px, `text-3xl` 30px, `text-4xl` 36px. Adjacent steps at the small end
are close together — 16px to 18px is a 12.5% jump — and two sizes that close on one surface read
as an inconsistency rather than a hierarchy.

Default: a surface uses three or four sizes with real distance between them — `text-sm`,
`text-base`, `text-2xl` is a workable set — rather than walking consecutive steps of the scale,
unless a brief calls for a dense data view where `text-xs` and `text-sm` must coexist as row text
and column headers. <!-- rule:forge-ui-type-scale-jump -->

Default: body copy is never smaller than `text-sm`, and `text-xs` is reserved for labels, badges,
and metadata — where forge already puts it, in `Field`'s label span and in `Badge` — unless a
brief specifies a dense view and the text is not the primary content. <!-- rule:forge-ui-type-min-body-size -->

Undersized UI text is one of the clearest tells of unconsidered work: `text-xs` used for a
paragraph reads as a screenshot shrunk to fit, and it fails the same reader that
`forge-ui-contrast-floor` protects.

The scale runs in the other direction too, and the top of it behaves differently: body copy is one
size at every viewport width, while a headline chosen to outrank it on a wide screen has to survive
a 375px one. The ratio that reads as hierarchy at 1280px reads as four wrapped lines at 375px, and
four wrapped lines are not a headline — they are a paragraph set in the wrong size.

Default: a step above `text-3xl` is written as the smaller step with the large one raised at a
breakpoint — `text-3xl md:text-5xl` — so the headline is sized for the narrow viewport and grows,
unless the surface states a minimum width it will never render below, such as an embedded view
whose host fixes its
frame. <!-- rule:forge-ui-type-scale-viewport-ratio -->

This is a size decision, not a hierarchy one: `forge-ui-type-scale-jump` still governs how many
steps the surface uses, and the responsive pair counts as the one step it resolves to at any given
width.

## Two weights

Default: a surface uses at most two font weights — a normal weight for body copy and one heavier
weight for emphasis — unless a brief specifies a display face with its own weight range. <!-- rule:forge-ui-type-two-weights -->

Forge's primitives already choose for you. `buttonVariants`, `Badge`, `FIELD_LABEL_CLASSES` and
`Alert.Title` all set `font-medium`; `Card.Title` sets `font-semibold`. Adopting `font-semibold`
as the surface's emphasis weight and leaving everything else at the browser default keeps the
count honest, because the `font-medium` in those primitives belongs to the control layer rather
than to the prose.

Default: emphasis within body copy is achieved by raising weight or changing to
`--muted-foreground`, never by increasing size, unless the emphasised text is a heading that
outranks the surrounding copy. <!-- rule:forge-ui-type-weight-over-size -->

### Before / after — a card heading

```tsx
import { Card } from "@y-core/forge/ui/core";

<Card.Header>
  <Card.Title class='text-lg font-bold'>Billing history</Card.Title>
  <Card.Description class='text-base font-semibold'>Invoices from the past year</Card.Description>
</Card.Header>;
```

Costs the header its hierarchy: three weights (`bold`, `semibold`, and the `medium` the primitives
set elsewhere) and a 2px size difference, so the description competes with the title instead of
supporting it.

```tsx
import { Card } from "@y-core/forge/ui/core";

<Card.Header>
  <Card.Title>Billing history</Card.Title>
  <Card.Description>Invoices from the past year</Card.Description>
</Card.Header>;
```

Untouched, `Card.Title` is `font-semibold` on `--card-foreground` and `Card.Description` is
`text-sm` on `--muted-foreground`. Two weights, two colours, and the relationship is already
correct.

## Measure

Default: a body-copy column targets a line length of 45–75 characters — `max-w-prose` lands inside
that band at the default font size — unless the region is a table or a code block, where wrapping
costs more than the long line does. <!-- rule:forge-ui-type-measure-target -->

`forge-ui-measure-cap` is the Floor that requires *some* ceiling. This rule is the aesthetic
target inside it: a column much narrower than 45 characters breaks the reading rhythm as badly as
one much wider than 75 loses the return sweep.

## Leading runs inverse to size

The larger the text, the less leading it needs, because the eye has less horizontal distance to
travel back across relative to the letterforms.

| Text | Leading | Where forge already does this |
|---|---|---|
| A large heading | `leading-none` or `leading-tight` | `Card.Title` sets `leading-none` |
| A label or a compact line | `leading-snug` | `FIELD_LABEL_CLASSES` sets `leading-snug` |
| Body copy | `leading-normal` | `FormField.Description` sets `leading-normal` |
| A paragraph the user will actually read through | `leading-relaxed` | `Alert.Description` sets `leading-relaxed` |

Default: leading tightens as size increases and loosens as size decreases, following the table
above, unless the text sits in a fixed-height row where the line box must match a control's
height. <!-- rule:forge-ui-type-leading-inverse -->

## Tracking

Type is spaced for body sizes by default, which means it is slightly too loose once it gets large
and correct everywhere else.

Default: text at `text-2xl` and above carries `tracking-tight`, as `Alert.Title` does, unless the
text is set in a face whose large sizes are already tightly spaced. <!-- rule:forge-ui-type-tracking-large -->

Default: body copy carries no tracking utility at all — letterspacing paragraph text reduces
readability rather than raising it — with the single exception of a short all-caps label, where
`tracking-wide` compensates for uniform letterform width. <!-- rule:forge-ui-type-tracking-body -->

## Numerals that align

Proportional digits have different widths, so a number that updates in place jitters, and a column
of numbers fails to line up under its own decimal point.

Default: any number that changes in place — a live count, a timer, a `Progress` or `Meter` readout
— or that appears in a column beside other numbers is set with `tabular-nums`, unless the number
appears exactly once as inline prose. <!-- rule:forge-ui-type-tabular-numerals -->

### Before / after — a stat row

```tsx
import { Field } from "@y-core/forge/ui/core";

<Field label='Requests' orientation='horizontal'>
  <span class='text-2xl font-semibold text-foreground'>{count}</span>
</Field>;
```

Costs the row its stability: as `count` ticks from 1,199 to 1,200 the digits change width, so the
whole value shifts horizontally on every update and the eye is pulled back to it.

```tsx
import { Field } from "@y-core/forge/ui/core";

<Field label='Requests' orientation='horizontal'>
  <span class='text-2xl font-semibold tabular-nums tracking-tight text-foreground'>{count}</span>
</Field>;
```

## Labels

Default: a form label renders through `Label` or `FormField.Label`, and any bespoke label-shaped
element applies `FIELD_LABEL_CLASSES` through `cn` rather than restating its classes, unless the
element is a decorative caption with no control to name — the case `Field`'s own label span already
covers. <!-- rule:forge-ui-type-label-class -->

```tsx
import { cn, FIELD_LABEL_CLASSES } from "@y-core/forge/ui/core";

<span class={cn(FIELD_LABEL_CLASSES, "text-muted-foreground")}>Delivery window</span>;
```

`FIELD_LABEL_CLASSES` is exported precisely so a second definition of "what a label looks like"
never appears. It carries the size, the weight, the leading, the gap for an adjacent icon, and the
disabled-state opacity — all four drift independently once they are retyped.

`Label` also takes `required`, which renders its own marker. Reaching for a hand-written asterisk
beside a label duplicates a decision the primitive already made, and colour alone would not carry
it anyway — see `forge-ui-not-color-alone`.
