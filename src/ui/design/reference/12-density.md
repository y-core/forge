# Density, Variance, and Motion

Three dials describe how a forge surface is tuned, each on a 1–10 scale. They are not style
presets — each one cashes out in specific class choices and specific component choices, and the
whole point of naming them is that a brief can move one without moving the other two.

| Dial | What it sets | Forge's app-UI default |
|---|---|---|
| Density | How much information occupies a given area, and how tight the spacing runs | **5** |
| Variance | How far a surface departs from the plainest arrangement that works | **4** |
| Motion | How much movement the interface carries | **3** |

Those defaults are ratified in `.decisions/UI_DESIGN_GUIDANCE.md` §8, and they are deliberately
restrained because forge's primary target is product and app UI — surfaces a user sees many times a
day, having arrived to finish a task. Variance costs recognition there, and motion costs time.

Default: an app surface is built at density 5, variance 4, and motion 3 unless a written brief
sets a different value, and a dial moved by inference from the surrounding code is not a brief. <!-- rule:forge-ui-density-app-default -->

## Inferring the dials from the brief

Most briefs do not name a number. They name a surface, and the surface implies the dial. Read the
signal, take the setting, and say in one line which signal you read — a reviewer who disagrees with
the output usually disagrees with this inference rather than with the markup.

| Signal in the brief or surrounding code | Density | Variance | Motion | What follows |
|---|---|---|---|---|
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

Default: dial settings are inferred from the strongest signal in the brief using the table above,
and the inference is stated in one line alongside the Design Read, unless the brief names the
numbers itself, in which case the brief's numbers win. <!-- rule:forge-ui-density-infer-from-signal -->

Default: when two signals conflict — a data table inside an onboarding wizard — the inner surface
takes the denser setting and the surrounding page keeps the looser one, unless the brief describes
the two as one continuous surface. <!-- rule:forge-ui-density-conflicting-signals -->

## What raised density actually changes

Density is not a scale factor applied to everything. It moves five specific things, all of which
terminate in a forge primitive.

**Control size.** `buttonVariants` sizes run `sm` / `md` / `lg` / `icon` / `icon-sm` / `square`.
`md` is the default row. At density 7 and above, `sm` is the row and `icon-sm` is its icon
companion.

Default: at density 7 or above, `Button` takes `size='sm'` and icon-only controls take
`size='icon-sm'`, unless the control is the surface's single primary action, which stays at `md`
so the pyramid in `01-hierarchy.md` survives the compression. <!-- rule:forge-ui-density-button-size -->

**Gap steps.** Density moves you down the spacing scale, never off it — `forge-ui-spacing-scale-only`
is Floor and an arbitrary value is not a density decision.

| Density | Between rows | Between groups | Section padding |
|---|---|---|---|
| 3 | `gap-6` | `gap-10` | `p-8` |
| 5 | `gap-4` | `gap-6` | `p-6` |
| 8 | `gap-2` | `gap-4` | `p-3` |

Default: raised density selects a lower step on Tailwind's spacing scale — `gap-2` in place of
`gap-4` — and never an arbitrary value, unless a forge component's own class needs overriding, in
which case the override is still a scale value. <!-- rule:forge-ui-density-gap-scale -->

**One card, not one card per row.** A `Card` per list item is the most common way a dense surface
becomes a loose one, and it collides with `forge-ui-no-nested-card` the moment the list is inside a
card already.

Default: a dense list renders as rows separated by `Separator` inside a single `Card.Content`,
unless each item carries its own independent set of actions and its own heading. <!-- rule:forge-ui-density-separator-over-card -->

**A bounded scroll region.** `ScrollArea` (with `ScrollArea.Viewport`) constrains a dense region so
the page around it stays reachable — no scroll hijacking and no synthetic thumb, so the platform's
own scrolling and keyboard behaviour are intact.

Default: a dense region taller than its container scrolls inside a `ScrollArea` rather than
extending the page, unless the region is the page's only content. <!-- rule:forge-ui-density-scrollarea-region -->

**Numerals that line up.** A column of proportional digits cannot be compared down its length.

Default: any column of numbers — counts, durations, currency, byte sizes — carries `tabular-nums`,
unless the number appears once and is not part of a column. <!-- rule:forge-ui-density-tabular-numerals -->

### Before / after — a dense job list

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
        <Button variant='primary' size='lg'>Retry</Button>
      </Card.Footer>
    </Card>
  ))}
</Card.Content>;
```

Costs the surface its density and its hierarchy at once: a nested `Card` per row is two elevations
that encode nothing (`forge-ui-no-nested-card`), a `primary` button per row means the page has no
primary action (`forge-ui-hierarchy-one-primary`), and thirty rows at `gap-6` is one screen of six.

```tsx
import { Badge, Button, Card, ScrollArea, Separator } from "@y-core/forge/ui/core";

<Card>
  <Card.Content class='p-0'>
    <ScrollArea class='max-h-96'>
      <ScrollArea.Viewport class='flex flex-col'>
        {jobs.map((job, i) => (
          <>
            {i > 0 && <Separator />}
            <div class='flex items-center gap-3 px-3 py-2'>
              <span class='flex-1 truncate text-sm text-foreground'>{job.name}</span>
              <span class='tabular-nums text-sm text-muted-foreground'>{job.durationMs}</span>
              <Badge variant='outline'>{job.state}</Badge>
              <Button variant='ghost' size='sm'>Retry</Button>
            </div>
          </>
        ))}
      </ScrollArea.Viewport>
    </ScrollArea>
  </Card.Content>
</Card>;
```

## What density never changes

This is the paragraph that matters most, because density is the standing excuse for shrinking a
control past the point where it can be used. **The Floor does not have a density setting.** At
density 10, on the densest table forge can render, all of the following hold exactly as they hold
at density 3:

- **`forge-ui-hit-target`** — the `Button` `sm` box is the floor of the size scale, and there is
  nothing below it. A dense layout that does not fit gives way; the control does not shrink. Padding
  may tighten around a target, but the target's own box may not go under `sm`.
- **`forge-ui-contrast-floor`** — 4.5:1 for body text, 3:1 for large text and UI boundaries, in both
  `:root` and `.dark`. Small text needs *more* contrast, not less, so a dense surface is where
  `--muted-foreground` on `--card` most needs checking rather than assuming.
- **`forge-ui-focus-ring`** — `focus-visible:ring-2 focus-visible:ring-ring` on every interactive
  element. A ring that would overlap a neighbour at tight spacing is a spacing problem; the answer
  is a step up on the gap scale, never `outline-none`.

Default: a density increase is implemented by lowering spacing steps and control sizes down to the
`sm` floor and no further, unless the brief supplies a different mechanism for fitting the content —
pagination, a `ScrollArea`, or fewer columns — which it should, because the three rules a further
squeeze would break are Floor and no brief reaches them. <!-- rule:forge-ui-density-floor-holds -->

Two more that a dense surface reaches for and should not: `forge-ui-text-color-budget` still caps a
surface at two text colors, and `forge-ui-measure-cap` still holds on any body copy that survives
into the dense layout — a description does not become full-bleed because the rows around it are
tight.

## Variance and motion, briefly

Variance is how much two comparable surfaces are allowed to differ. At forge's default of 4, the
second surface of a kind copies the first: the same `Card` compound in the same order, the same
`Button` sizes, the same `Badge` variant vocabulary. Raising it is what a marketing brief buys.

Default: two surfaces of the same kind — two settings panels, two list views — use the same
component composition and the same size vocabulary, unless a brief raises variance above forge's
ratified default of 4. <!-- rule:forge-ui-density-variance-repetition -->

Motion at 3 means transitions exist to explain a change of state and nothing else: a popup opening,
a panel collapsing, a toast arriving. Those are already owned by `mountTransitionState` and
`mountPopupTriggerState` from `@y-core/forge/ui/client`, which publish the state attributes the
stylesheet animates against.

Default: authored motion is limited to state changes a user caused — open, close, dismiss — and
carries no entrance animation on page load, unless a brief raises motion above forge's ratified
default of 3. <!-- rule:forge-ui-density-motion-budget -->

Every motion decision remains subject to `forge-ui-reduced-motion`, at every setting of the dial.
