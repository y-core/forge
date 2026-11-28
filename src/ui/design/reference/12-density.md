---
title: Density, Variance, and Motion
description: "The dials that tune a forge surface, each on a scale, and the specific class and component choices each one cashes out in."
---

# Density, Variance, and Motion

Density, variance and motion describe how a forge surface is tuned, each on a 1–10 scale. They are not style presets — each cashes out in specific
class and component choices, and naming them is what lets a brief move one without moving the others.

| Dial | What it sets | Forge's app-UI default |
| --- | --- | --- |
| Density | How much information occupies a given area, and how tight the spacing runs | **5** |
| Variance | How far a surface departs from the plainest arrangement that works | **4** |
| Motion | How much movement the interface carries | **3** |

Those defaults are ratified in `docs/UI_DESIGN_GUIDANCE.md` §8: restrained, because forge's primary target is product and app UI, where variance
costs recognition and motion costs time.

## 0. Quick Reference

- §1 Inferring the dials from the brief: the signal each surface gives, and stating which one you read
- §2 What raised density actually changes: control size, gap step, one card, a bounded scroll, tabular numerals
- §2a Before / after — a dense job list: a card per row, a primary per row, and one screen of six
- §3 What density never changes: the Floor has no density setting, at 10 as at 3
- §4 Variance and motion, briefly: repeating the composition, and motion only on a state the user caused

---

## 1. Inferring the dials from the brief

<!-- rule:forge-ui-density-app-default -->

<!-- rule:forge-ui-density-infer-from-signal --> Most briefs do not name a number. They name a surface, and the surface implies the dial. Read the
signal, take the setting, and say in one line which signal you read — a reviewer who disagrees with the output usually disagrees with this inference
rather than with the markup.

| Signal in the brief or surrounding code | Density | Variance | Motion | What follows |
| --- | --- | --- | --- | --- |
| A data table, or a log viewer | 8 | 2 | 1 | Rows are scanned, not read. `sm` controls, `Separator` between rows, `tabular-nums` on every numeric column |
| An admin console | 7 | 3 | 2 | Dense but navigable — `Tabs` over stacked sections, one `Card` per region rather than per item |
| A dashboard someone watches all day | 7 | 3 | 2 | Values dominate; chrome recedes to `--muted-foreground`. No decorative `Badge` |
| A settings page | 5 | 4 | 3 | Forge's default. `Field` rows inside `Card.Content`, grouped by `Separator` |
| A form of more than four fields | 4 | 3 | 2 | Looser than default — vertical rhythm is what makes a long form finishable |
| A first-run or onboarding wizard | 3 | 6 | 5 | Seen once, so variance earns its cost. One idea per step, generous `gap-*` |
| An empty or first-load state | 3 | 5 | 3 | Space is the message. See `forge-ui-empty-state` |
| A public landing page | 3 | 7 | 5 | See `13-marketing.md`; still requires a brief |
| A mobile-first surface | 4 | 3 | 2 | Density drops because targets cannot — see the Floor paragraph below |
| A surface with no stated audience | 5 | 4 | 3 | Take the default and ask, rather than guessing high |

<!-- rule:forge-ui-density-conflicting-signals -->

## 2. What raised density actually changes

Density is not a scale factor applied to everything. What it moves is specific, and each of those things terminates in a forge primitive.

<!-- rule:forge-ui-density-button-size --> **Control size.** Sizes run `sm` / `md` / `lg`, and `shape` decides the footprint at each — `md` is the
default row. At density 7 and above, `sm` is the row, and an icon-only control is `shape='icon'` at that same `sm`.

<!-- rule:forge-ui-density-gap-scale --> **Gap steps.** Density moves you down the spacing scale, never off it — `forge-ui-spacing-scale-only` is
Floor and an arbitrary value is not a density decision.

| Density | Between rows | Between groups | Section padding |
| --- | --- | --- | --- |
| 3 | `gap-6` | `gap-10` | `p-8` |
| 5 | `gap-4` | `gap-6` | `p-6` |
| 8 | `gap-2` | `gap-4` | `p-3` |

<!-- rule:forge-ui-density-separator-over-card --> **One card, not one card per row.** A `Card` per list item is how a dense surface becomes a loose
one, and it collides with `forge-ui-no-nested-card` the moment the list is inside a card already.

<!-- rule:forge-ui-density-scrollarea-region --> **A bounded scroll region.** `ScrollArea` (with `ScrollArea.Viewport`) constrains a dense region so
the page around it stays reachable — no scroll hijacking and no synthetic thumb, so the platform's own scrolling and keyboard behaviour are intact.

<!-- rule:forge-ui-density-tabular-numerals --> **Numerals that line up.** A column of proportional digits cannot be compared down its length.

### 2a. Before / after — a dense job list

```tsx
import { Badge, Button, Card } from "@y-core/forge/ui/core";

<Card.Content class='flex flex-col gap-6'>
  {jobs.map((job) => (
    <Card class='p-6'>
      <Card.Header>
        <Card.Title>{job.name}</Card.Title>
        <Card.Description>{job.finishedAt}</Card.Description>
      </Card.Header>
      <Card.Footer>
        <Button size='lg'>Retry</Button>
      </Card.Footer>
    </Card>
  ))}
</Card.Content>;
```

Costs the surface its density and its hierarchy at once: a nested `Card` per row is two elevations that encode nothing (`forge-ui-no-nested-card`),
a primary button per row means the page has no primary action (`forge-ui-hierarchy-one-primary`), and thirty rows at `gap-6` is one screen of six.

```tsx
import { Badge, Button, Card, ScrollArea, Separator } from "@y-core/forge/ui/core";

<Card>
  <Card.Content class='p-0'>
    <ScrollArea class='max-h-96'>
      <ScrollArea.Viewport label='Jobs' class='flex flex-col'>
        {jobs.map((job, i) => (
          <>
            {i > 0 && <Separator />}
            <div class='flex items-center gap-3 px-3 py-2'>
              <span class='flex-1 truncate text-sm text-foreground'>{job.name}</span>
              <span class='tabular-nums text-sm text-muted-foreground'>{job.durationMs}</span>
              <Badge appearance='outline'>{job.state}</Badge>
              <Button tone='neutral' appearance='ghost' size='sm'>
                Retry
              </Button>
            </div>
          </>
        ))}
      </ScrollArea.Viewport>
    </ScrollArea>
  </Card.Content>
</Card>;
```

## 3. What density never changes

<!-- rule:forge-ui-density-floor-holds --> Density is the standing excuse for shrinking a control past the point where it can be used. **The Floor
does not have a density setting.** At density 10, on the densest table forge can render, all of the following hold exactly as they hold at density
3:

- **`forge-ui-hit-target`** — a dense layout that does not fit gives way; the control does not shrink.
- **`forge-ui-contrast-floor`** — 4.5:1 for body text, 3:1 for large text and UI boundaries, in both `:root` and `.dark`. Small text needs _more_
  contrast, not less, so a dense surface is where `--muted-foreground` on `--card` most needs checking rather than assuming.
- **`forge-ui-focus-ring`** — a ring that would overlap a neighbour is a spacing problem: step up the gap scale.

A dense surface reaches past these too and should not: `forge-ui-text-color-budget` still caps a surface at two text colors, and
`forge-ui-measure-cap` still holds on any body copy that survives into the dense layout — a description does not become full-bleed because the rows
around it are tight.

## 4. Variance and motion, briefly

<!-- rule:forge-ui-density-variance-repetition --> Variance is how much two comparable surfaces are allowed to differ. At forge's default of 4, the
second surface of a kind copies the first: the same `Card` compound in the same order, the same `Button` sizes, the same `Badge` tone and
appearance. Raising it is what a marketing brief buys.

<!-- rule:forge-ui-density-motion-budget --> Motion at 3 means transitions exist to explain a change of state and nothing else: a popup opening, a
panel collapsing, a toast arriving. Every one of those is a state the platform already exposes to a selector — `:popover-open`, `[open]`,
`@starting-style` — so the stylesheet animates against the element's own state with no controller in between.

Every motion decision remains subject to `forge-ui-reduced-motion`, at every setting of the dial.
