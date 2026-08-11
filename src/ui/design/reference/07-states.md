# States

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules
cited below are not.

Every surface that displays data owes four states, not one. The success path is the one that gets
designed; the other three are the ones a user actually meets on a slow network, a cold cache, or a
first login.

| State | Owed on | Forge primitives |
|---|---|---|
| Empty | any collection | `Alert`, `Button`, `Card` |
| Loading | anything fetched | `Skeleton`, `Spinner`, `Progress` |
| Error | anything that can fail | `Alert` `destructive`, `Toast` `destructive` |
| Success | any mutation | `Toast` `success`, `Flash` |

**Default: design all four before shipping the surface.** <!-- rule:forge-ui-state-four -->
`forge-ui-empty-state` makes the empty one a Floor obligation; the other three are Defaults because a
surface that cannot fail — a static footer — genuinely owes only the first. Override for a surface
with no data and no mutation.

---

## Loading: `Skeleton` or `Spinner`

The choice is not about duration. It is about whether you already know the shape of what is arriving.

| Given | Choose |
|---|---|
| The result has a known shape and will occupy this exact box | `Skeleton` |
| The shape is unknown, or the count is unknown | `Spinner` |
| The wait lives inside a control rather than a region | `Spinner` |
| The work is measurable and the total is known | `Progress` |

**Default: a region whose result shape is known renders `Skeleton` blocks in that shape.**
<!-- rule:forge-ui-state-skeleton-shape -->
`Skeleton` is `animate-pulse rounded-md bg-muted` and is `aria-hidden`, so it is a visual placeholder
only. Override when the region may resolve to an empty state, and a skeleton would promise rows that
never arrive.

**Default: a `Spinner` marks a wait inside a control or a wait of unknown shape, never a region whose
layout you can already draw.** <!-- rule:forge-ui-state-spinner-scope -->
`Spinner` requires an `icon` (`ForgeIcon<"spinner">`) and renders `role="status"` with an `sr-only`
label — the label is the announcement, so give it a real one. Override for a very short wait in a
known-shape region, where a skeleton flash is more disruptive than a small spinner.

**Default: the placeholder occupies the same box the result will.**
<!-- rule:forge-ui-state-preserve-layout -->
A skeleton shorter than its content makes the page jump when the content lands, which costs a click
more often than the wait did. Override when the result's height is genuinely unbounded.

**Default: one loading indicator per loading region.** <!-- rule:forge-ui-state-one-indicator -->
A `Spinner` in the submit button *and* a skeleton over the table means two claims about one wait.
Override when two genuinely independent requests are in flight in two regions.

### Before / after

```tsx
// Wrong — a centred spinner where the shape is fully known.
import { Card, createIcon, Spinner } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<Card.Content class="flex items-center justify-center py-12">
  <Spinner icon={AppIcon} size="lg" />
</Card.Content>;
```

Costs: the card collapses to spinner height, then snaps to full height when the rows land. The user
learns nothing about what is coming.

```tsx
// Right — the shape of the answer, drawn before the answer.
import { Card, Skeleton } from "@y-core/forge/ui/core";

<Card.Content class="flex flex-col gap-3">
  <Skeleton class="h-5 w-1/3" />
  <Skeleton class="h-4 w-full" />
  <Skeleton class="h-4 w-full" />
  <Skeleton class="h-4 w-2/3" />
</Card.Content>;
```

**Default: a submitting control keeps its label and gains a `Spinner`, rather than swapping the label
out.** <!-- rule:forge-ui-state-submit-spinner -->
A button whose text changes to "Loading…" loses its width and its meaning at once. Override when the
control is icon-only, where the spinner replaces the glyph in the same box.

---

## Empty

An empty collection is a state to compose, not markup to omit. The pattern is a sentence saying what
would be here, and the one control that puts something here.

**Default: an empty state is an `Alert` (or a `Card.Content` paragraph) plus one `Button` performing
the action the user came for.** <!-- rule:forge-ui-state-empty-composed -->
It satisfies `forge-ui-empty-state`; this rule fixes the *composition*. Override when the surface has
no user-initiated way to fill it — a log stream — where the sentence stands alone and says why.

**Default: hide the controls that operate on nothing.**
<!-- rule:forge-ui-state-hide-empty-controls -->
`Tabs`, filter `Select`s, sort `ToggleGroup`s and bulk-action `Toolbar`s all render happily over zero
rows and all mislead. Override when the filter is what *caused* the emptiness, in which case keep it
and add a control that clears it.

```tsx
// Wrong — the absence of rows rendered as the absence of markup.
{projects.length > 0 ? <ProjectTable projects={projects} /> : null}
```

Costs: a user who has just signed up sees a heading, a filter bar, and nothing — indistinguishable
from a failed load.

```tsx
// Right — a state, with the one action that resolves it.
import { Alert, Button, Card } from "@y-core/forge/ui/core";

{projects.length > 0 ? (
  <ProjectTable projects={projects} />
) : (
  <Card.Content class="flex flex-col items-start gap-3">
    <Alert>
      <Alert.Title>No projects yet</Alert.Title>
      <Alert.Description class="max-w-prose">
        A project holds your deployments and their settings.
      </Alert.Description>
    </Alert>
    <Button variant="primary">Create a project</Button>
  </Card.Content>
)}
```

---

## Error

**Default: a failure that belongs to a visible surface renders an `Alert` `destructive` in place, and
the surface keeps its content.** <!-- rule:forge-ui-state-error-inline -->
Replacing a table with an error message destroys the data the user was reading. Override when the
content is known stale and showing it would mislead.

**Default: a failure of work the user is no longer watching renders a `Toast` `destructive`.**
<!-- rule:forge-ui-state-error-toast -->
Background saves, long uploads, anything the user navigated away from. Override when the failure
blocks the next step, which is a `Dialog` or an in-place `Alert`.

**Default: every error state carries the retry, next to the message.**
<!-- rule:forge-ui-state-error-retry -->
A `secondary` `Button` in the same `Alert`. Override when retrying cannot help — a validation
failure, a permission denial — where the correct control is the one that fixes the cause.

Note on tokens: `Alert` and `Toast` deliberately style their non-`default` variants with Tailwind
palette utilities (`border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950
dark:text-red-200` for `destructive`, and the blue, emerald and yellow equivalents for `info`,
`success` and `warning`) rather than with semantic tokens. That is the shipped behaviour, and it is
why `forge-ui-foreground-pairing` has nothing to pair here: both pairs are checked inside the
variant. The hue is fixed; the lightness is not — each variant carries an explicit `dark:` half, so
a status panel is a tinted region on a dark page rather than a near-white island. Do not "fix" it by passing `class="bg-destructive"`:
`--destructive` does pair with `--destructive-foreground`, so the pairing is not the objection. The
objection is that `--destructive` is the *application's* destructive colour and an app may
legitimately re-point it, whereas a status panel has to stay red to mean "failed".

---

## Success

**Default: a completed mutation is confirmed by a `Toast` `success`, not by an `Alert`.**
<!-- rule:forge-ui-state-success-toast -->
An `Alert` is a persistent property of a surface; a success is an event about an action. Override
when the result changes what the surface *is* — a subscription that just ended — where a persistent
`Alert` is the honest rendering.

**Default: a confirmation that must survive a redirect goes through the flash primitives.**
<!-- rule:forge-ui-state-flash-redirect -->
`createFlash` sets the signed cookie server-side; `FlashContainer` renders the queue into a
positioned `Toast.Container`; `Flash` renders the toasts alone inside a container you already have;
`FlashOob` renders them as htmx out-of-band swaps into `#flash-container`. Override when the mutation
returns a fragment to the same page, where a `Toast` rendered directly is simpler.

```tsx
import { FlashContainer } from "@y-core/forge/ui/server";

<FlashContainer messages={messages} position="bottom-right" />;
```

**Default: a success message names what happened, not that something happened.**
<!-- rule:forge-ui-state-success-specific -->
`Toast.Title` carries the object, `Toast.Description` the consequence. Override for a bulk operation,
where the count is the message.

---

## Progress and measurement

`Progress` and `Meter` render different elements for different claims, and they are not
interchangeable.

| Given | Choose |
|---|---|
| A task advancing toward completion, with a known total | `Progress` |
| A quantity within a known range — disk used, quota, score | `Meter` |
| A task with no known total | `Spinner` |

**Default: `Progress` renders only when the total is known.**
<!-- rule:forge-ui-state-progress-determinate -->
Give it a `label`, which becomes its `aria-label`. Override never — an indeterminate progress bar is
a spinner drawn as a lie about measurability.

**Default: a measured value uses the `Meter` compound in full — `Meter.Label`, `Meter.Value`,
`Meter.Track`.** <!-- rule:forge-ui-state-meter-composed -->
`Meter.Label` requires `for`, because an unassociated label is decoration; `<meter>` draws its own
bar from `low` / `high` / `optimum` and needs no indicator element. Override when the value has no
range to sit in, which makes it a number, not a meter.

```tsx
import { Meter } from "@y-core/forge/ui/core";

<Meter>
  <Meter.Label for="storage">Storage</Meter.Label>
  <Meter.Track id="storage" value={used} min={0} max={total} high={total * 0.9} />
  <Meter.Value>{label}</Meter.Value>
</Meter>;
```
