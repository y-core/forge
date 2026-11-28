---
title: States
description: "Empty, loading, error and success: the states a surface must design for, not the one happy path it usually gets."
---

# States

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules cited below are not.

---

## 0. Quick Reference

- §1 Loading: `Skeleton` or `Spinner`: the choice is the known shape, not the duration
- §1a Before / after: a centred spinner collapsing a card, against skeletons in the answer's shape
- §2 Empty: a sentence saying what would be here, one control that puts it here, and hiding the rest
- §3 Error: in place or as a toast, always with the retry, and why status colour is not `--destructive`
- §4 Success: the toast that confirms a mutation, the flash that survives a redirect, and naming what happened
- §5 Progress and measurement: `Progress` for a known total, `Meter` for a value in a range
- §6 The states a surface owes: empty, loading, error and success, each designed before the surface ships

---

## 1. Loading: `Skeleton` or `Spinner`

<!-- rule:forge-ui-state-skeleton-shape --> The choice is not about duration. It is about whether you already know the shape of what is arriving.

| Given | Choose |
| --- | --- |
| The result has a known shape and will occupy this exact box | `Skeleton` |
| The shape is unknown, or the count is unknown | `Spinner` |
| The wait lives inside a control rather than a region | `Spinner` |
| The work is measurable and the total is known | `Progress` |

`Skeleton` is `animate-pulse rounded-md bg-muted` and is `aria-hidden`, so it is a visual placeholder only.

<!-- rule:forge-ui-state-spinner-scope --> `Spinner` requires an `icon` (`ForgeIcon<"spinner">`) and renders an `sr-only` label with no role — the
label is what the busy channel announces, so give it a real one.

<!-- rule:forge-ui-state-preserve-layout --> A skeleton shorter than its content makes the page jump when the content lands, which costs a click
more often than the wait did.

<!-- rule:forge-ui-state-one-indicator --> A `Spinner` in the submit button _and_ a skeleton over the table means two claims about one wait.

### 1a. Before / after

```tsx
// Wrong — a centred spinner where the shape is fully known.
import { Card, createIcon, Spinner } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<Card.Content class='flex items-center justify-center py-12'>
  <Spinner icon={AppIcon} size='lg' />
</Card.Content>;
```

Costs: the card collapses to spinner height, then snaps to full height when the rows land. The user learns nothing about what is coming.

```tsx
// Right — the shape of the answer, drawn before the answer.
import { Card, Skeleton } from "@y-core/forge/ui/core";

<Card.Content class='flex flex-col gap-3'>
  <Skeleton class='h-5 w-1/3' />
  <Skeleton class='h-4 w-full' />
  <Skeleton class='h-4 w-full' />
  <Skeleton class='h-4 w-2/3' />
</Card.Content>;
```

<!-- rule:forge-ui-state-submit-spinner --> A button whose text changes to "Loading…" loses its width and its meaning at once.

<!-- rule:forge-ui-busy-vs-indicator --> `busy` renders `aria-busy` and `data-busy`, so it is true for exactly as long as the markup carrying it.
`htmx-indicator` is revealed and hidden by htmx around the request. A control wearing both announces one wait twice and stops announcing it at two
different moments.

---

## 2. Empty

An empty collection is a state to compose, not markup to omit. The pattern is a sentence saying what would be here, and the one control that puts
something here.

<!-- rule:forge-ui-state-empty-composed --> It satisfies `forge-ui-empty-state`; this rule fixes the _composition_.

<!-- rule:forge-ui-state-hide-empty-controls --> `Tabs`, filter `Select`s, sort `ToggleGroup`s and bulk-action `Toolbar`s all render happily over
zero rows and all mislead.

```tsx
// Wrong — the absence of rows rendered as the absence of markup.
{
  projects.length > 0 ? <ProjectTable projects={projects} /> : null;
}
```

Costs: a user who has just signed up sees a heading, a filter bar, and nothing — indistinguishable from a failed load.

```tsx
// Right — a state, with the one action that resolves it.
import { Alert, Button, Card } from "@y-core/forge/ui/core";

{
  projects.length > 0 ? (
    <ProjectTable projects={projects} />
  ) : (
    <Card.Content class='flex flex-col items-start gap-3'>
      <Alert>
        <Alert.Title>No projects yet</Alert.Title>
        <Alert.Description class='max-w-prose'>A project holds your deployments and their settings.</Alert.Description>
      </Alert>
      <Button>Create a project</Button>
    </Card.Content>
  );
}
```

---

## 3. Error

<!-- rule:forge-ui-state-error-inline --> Replacing a table with an error message destroys the data the user was reading.

<!-- rule:forge-ui-state-error-toast --> Background saves, long uploads, anything the user navigated away from.

<!-- rule:forge-ui-state-error-retry --> A `tone='neutral' appearance='outline'` `Button` in the same `Alert`.

Note on tokens: `Alert` and `Toast` take their non-`neutral` colours from the `--status-*` family rather than from `--destructive` / `--success` /
`--warning`, through the soft appearance each tone resolves to. That is the shipped behaviour, and it is why `forge-ui-foreground-pairing` has
nothing to pair here: the surface, its foreground and its border are one audited triple, chosen inside the tone. Do not "fix" it by passing
`class="bg-destructive"` — the ownership split in [`04-color.md`][color-7a] is the objection, not the pairing. `--destructive` is also a _fill_,
held across modes so a near-white foreground clears it; error **text** is `text-destructive-text`, which is the step that flips
([`THEME_GENERATION.md`][tg-4] §4).

---

## 4. Success

<!-- rule:forge-ui-state-success-toast --> An `Alert` is a persistent property of a surface; a success is an event about an action.

<!-- rule:forge-ui-state-flash-redirect --> `createFlash` sets the signed cookie server-side; `FlashContainer` renders the queue into a positioned
`Toast.Container`; `Flash` renders the toasts alone inside a container you already have; `FlashOob` renders them as htmx out-of-band swaps into
`#flash-container`.

```tsx
import { FlashContainer } from "@y-core/forge/ui/server";

<FlashContainer messages={messages} position='bottom-right' />;
```

<!-- rule:forge-ui-state-success-specific --> `Toast.Title` carries the object, `Toast.Description` the consequence.

---

## 5. Progress and measurement

`Progress` and `Meter` render different elements for different claims, and they are not interchangeable.

| Given | Choose |
| --- | --- |
| A task advancing toward completion, with a known total | `Progress` |
| A quantity within a known range — disk used, quota, score | `Meter` |
| A task with no known total | `Spinner` |

When `Progress` may render at all is Floor: `forge-ui-state-progress-determinate`, in `floor.md`.

<!-- rule:forge-ui-state-meter-composed --> `Meter.Label` requires `for`, because an unassociated label is decoration; the bar is drawn from `low` /
`high` / `optimum` and needs no indicator element — forge paints it in the theme's own `--success` / `--warning` / `--destructive`, on the quiet
track `Progress` uses.

```tsx
import { Meter } from "@y-core/forge/ui/core";

<Meter>
  <Meter.Label for='storage'>Storage</Meter.Label>
  <Meter.Track id='storage' value={used} min={0} max={total} high={total * 0.9} />
  <Meter.Value>{label}</Meter.Value>
</Meter>;
```

---

## 6. The states a surface owes

Every surface that displays data owes four states, not one. The success path is the one that gets designed; the other three are the ones a user
actually meets on a slow network, a cold cache, or a first login.

| State | Owed on | Forge primitives |
| --- | --- | --- |
| Empty | any collection | `Alert`, `Button`, `Card` |
| Loading | anything fetched | `Skeleton`, `Spinner`, `Progress` |
| Error | anything that can fail | `Alert` `destructive`, `Toast` `destructive` |
| Success | any mutation | `Toast` `success`, `Flash` |

<!-- rule:forge-ui-state-four --> `forge-ui-empty-state` makes the empty one a Floor obligation; the other three are Defaults because a surface that
cannot fail — a static footer — genuinely owes only the first.

[color-7a]: ./04-color.md#7a-the-ownership-split
[tg-4]: ../../../../docs/THEME_GENERATION.md#4-a-status-hue-holds-its-fill
