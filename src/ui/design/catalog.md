# Catalog

Which component for which job. The Floor (`floor.md`) says what you may never do; this file says
what to reach for first.

Every rule here is Tier 2 — it opens with `Default:` and it is rebuttable by an explicit written
brief from the consumer, never by preference. Floor ids are cited, not restated.

---

## Job → component

Left column is the job as a builder would say it. Right column is the component and the subpath it
comes from. Every import names a subpath; the `ui` namespace publishes no bare barrel of its own.

| The job | Reach for | Subpath |
|---|---|---|
| Trigger the one action this surface exists for | `Button` `variant="primary"` | `@y-core/forge/ui/core` |
| Offer a supporting action beside it | `Button` `variant="secondary"` | `@y-core/forge/ui/core` |
| Offer a low-stakes or repeated action (row action, dismiss) | `Button` `variant="ghost"` | `@y-core/forge/ui/core` |
| Confirm a destructive action | `Dialog` + `Alert` `variant="destructive"` | `@y-core/forge/ui/core` |
| Label a record's status or category | `Badge` | `@y-core/forge/ui/core` |
| State a condition that persists on the page | `Alert` | `@y-core/forge/ui/core` |
| Surface a background result the user did not wait for | `Toast` inside `Toast.Container` | `@y-core/forge/ui/core` |
| Carry a result across a redirect | `Flash` / `FlashContainer` / `createFlash` | `@y-core/forge/ui/server` |
| Swap a notification into a live page out-of-band | `FlashOob` | `@y-core/forge/ui/server` |
| Interrupt for a decision that blocks the task | `Dialog` | `@y-core/forge/ui/core` |
| Show secondary controls anchored to a trigger | `Popover` | `@y-core/forge/ui/core` |
| Offer a list of commands from a trigger | `Menu` | `@y-core/forge/ui/core` |
| Name an icon-only control on hover | `Tooltip` | `@y-core/forge/ui/core` |
| Show one of several peer views in one region | `Tabs` | `@y-core/forge/ui/core` |
| Let several independent sections expand | `Accordion` | `@y-core/forge/ui/core` |
| Hide one optional block behind a disclosure | `Collapsible` | `@y-core/forge/ui/core` |
| Group content that has its own title and action | `Card` (`.Header` `.Title` `.Description` `.Action` `.Content` `.Footer`) | `@y-core/forge/ui/core` |
| Divide regions inside one container | `Separator` | `@y-core/forge/ui/core` |
| Bound a long list to a fixed height | `ScrollArea` | `@y-core/forge/ui/core` |
| Show a value that is loading | `Skeleton` | `@y-core/forge/ui/core` |
| Show an action in flight with no known shape | `Spinner` (needs an `icon`) | `@y-core/forge/ui/core` |
| Show how far a task has run | `Progress` | `@y-core/forge/ui/core` |
| Show a measurement within a known range | `Meter` | `@y-core/forge/ui/core` |
| Represent a person or account | `Avatar` (`.Fallback`) | `@y-core/forge/ui/core` |
| Submit data to a route | `Form` | `@y-core/forge/ui/core` |
| Wire a validated field's label, error, and `aria-*` | `FormField` (`.Label` `.Description` `.Error`) | `@y-core/forge/ui/core` |
| Lay out a settings row that is not validated | `Field` | `@y-core/forge/ui/core` |
| Name a standalone control | `Label` | `@y-core/forge/ui/core` |
| Take one line of text | `Input` | `@y-core/forge/ui/core` |
| Take several lines of text | `Textarea` | `@y-core/forge/ui/core` |
| Pick one of many options (more than five) | `Select` (needs an `icon`) | `@y-core/forge/ui/core` |
| Pick one of two to five, all worth showing | `RadioGroup` or `ToggleGroup` `type="single"` | `@y-core/forge/ui/core` |
| Pick any number from a visible set | `CheckboxGroup` or `ToggleGroup` `type="multiple"` | `@y-core/forge/ui/core` |
| Flip a single setting that applies immediately | `Switch` | `@y-core/forge/ui/core` |
| Toggle one mode in a toolbar | `Toggle` | `@y-core/forge/ui/core` |
| Pick an approximate value on a continuum | `Slider` | `@y-core/forge/ui/core` |
| Take an exact number with bounds and steps | `NumberField` | `@y-core/forge/ui/core` |
| Draw a sprite glyph | `Icon` / `createIcon` / `ForgeIcon<Name>` | `@y-core/forge/ui/core` |
| Catch a naive bot on a mutation form | `Honeypot` | `@y-core/forge/ui/core` |
| Challenge a submission that reaches a real cost | `Turnstile` | `@y-core/forge/ui/core` |
| Give the app its top-level navigation | `Navbar` | `@y-core/forge/ui/chrome` |
| Group actions that act on the current view | `Toolbar` | `@y-core/forge/ui/chrome` |
| Let the user choose light, dark, or system | `ThemeToggle` | `@y-core/forge/ui/chrome` |
| Bind a control to a client signal | `Input` `Select` `Slider` `Switch` `Textarea` `ToggleGroup` | `@y-core/forge/ui/controls` |

`Toolbar` also exists in `@y-core/forge/ui/core` as the generic roving-focus row. The chrome one is
the application shell's; reach for the core one when you are building a control strip inside a
surface rather than around it.

---

## Choosing between near neighbours

**Default:** one `primary` `Button` per surface, with every other action `secondary` or
`ghost`. <!-- rule:forge-ui-catalog-action-pyramid -->
The `buttonVariants` triple *is* the pyramid — a second `primary` on the same surface asserts two
first actions, and the user reads neither as first. Override when a surface genuinely presents two
equal terminal paths with no default, as an accept/decline pair does.

**Default:** a destructive confirmation is a `Dialog` carrying an `Alert` `variant="destructive"`
that names what is lost, with the confirm control labelled with the verb rather than
"OK". <!-- rule:forge-ui-catalog-destructive-confirm -->
Override when the action is reversible from the same surface within the session — then perform it
and report with a `Toast`, since a confirmation on an undoable action trains the user to dismiss
confirmations.

**Default:** when the awaited content has a known shape, use `Skeleton` in that
shape. <!-- rule:forge-ui-catalog-skeleton-over-spinner -->
A `Skeleton` holds the layout, so the load does not end in a reflow. Override when the wait has no
layout to preserve — a submit button in flight, a background job with no slot — where `Spinner` is
correct and `Skeleton` would invent a shape.

**Default:** a condition the user must still act on is an `Alert` in the flow; a result of something
already finished is a `Toast`. <!-- rule:forge-ui-catalog-alert-vs-toast -->
The test is dismissal: a `Toast` that leaves before it is read must have been safe to miss.
Override when a persistent condition is genuinely global to the app rather than to a surface, and
has nowhere in the flow to sit.

**Default:** pick the lightest overlay the job survives — `Collapsible` when the content belongs to
the page, `Popover` when it is anchored to a trigger, `Dialog` only when the task truly
blocks. <!-- rule:forge-ui-catalog-overlay-weight -->
`Dialog` takes the top layer and the user's whole attention; spending that on a two-field form is
what makes an app feel heavy. Override when the content must be read before anything else can
proceed, or when losing it to a light dismiss would lose work.

**Default:** the number of options picks the control — two, use `Switch` or `Toggle`; three to five,
use `RadioGroup` or `ToggleGroup`; more than five, use
`Select`. <!-- rule:forge-ui-catalog-choice-count -->
Override when the option set is long but the user knows the answer by name, where a `Select` beats
any expanded set regardless of count.

**Default:** wrap every validated input in `FormField` with `FormField.Label` and
`FormField.Error`. <!-- rule:forge-ui-catalog-field-wrapper -->
`FormField` derives the `id`, the `for`, the `aria-describedby`, and the `aria-invalid` from one
`name`, which is how `forge-ui-accessible-name` and `forge-ui-not-color-alone` are satisfied without
hand-wiring. Override with `Field` for a settings row that has no validation and no error slot.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField name="email" invalid={Boolean(error)}>
  <FormField.Label name="email">Email</FormField.Label>
  <Input name="email" type="email" field={{ name: "email", invalid: Boolean(error) }} />
  <FormField.Error name="email">{error}</FormField.Error>
</FormField>;
```

**Default:** import a control from `@y-core/forge/ui/core` unless it needs a client signal, and from
`@y-core/forge/ui/controls` when it does. <!-- rule:forge-ui-catalog-bound-controls -->
The two barrels publish the same names deliberately; the `ui/controls` variant adds `bind` and
pre-spreads the resumable-scope attributes. Import a given name from exactly one of the two in a
module — never both. Override never applies by preference: the presence of a `bind` target decides
it.

**Default:** use `Card` only when the group has its own title, description, or action; otherwise
group with spacing and a `Separator`. <!-- rule:forge-ui-catalog-container-card -->
A `Card` is an elevation, and an elevation with nothing to elevate is the shape that
`forge-ui-no-nested-card` refuses one level down. Override for a surface whose whole job is a grid
of peer objects, where the border is what makes the boundaries scannable.

**Default:** use `Tabs` for peer views of one subject and `Accordion` for independent sections the
user may want open at once. <!-- rule:forge-ui-catalog-tabs-vs-accordion -->
Override when the views are peers but their content is long enough that switching costs the reader
their place — an `Accordion` lets them keep both.

**Default:** bound a list to a height with `ScrollArea` when the surrounding layout must stay
fixed. <!-- rule:forge-ui-catalog-scroll-area -->
Override when the page itself is the scroll container, where a nested scroll region traps the wheel
and hides content below the fold.

---

## Wrong tool → right tool

These are the substitutions that actually happen.

| Reached for | When it belongs | Reach for instead |
|---|---|---|
| `Spinner` in a slot whose shape is known | the shape is known, so the layout is knowable | `Skeleton` matching that shape <!-- rule:forge-ui-catalog-wrong-spinner --> |
| `Dialog` for a small anchored form or an optional detail | nothing is blocked | `Popover`, or `Collapsible` when it belongs to the page <!-- rule:forge-ui-catalog-wrong-dialog --> |
| `Alert` for the outcome of an action just completed | the condition is over | `Toast` <!-- rule:forge-ui-catalog-wrong-alert --> |
| `Toast` for a condition that is still true | the user must act on it | `Alert` in the flow <!-- rule:forge-ui-catalog-wrong-toast --> |
| `Badge` wired to click | it is a label, with no hit target and no focus ring | `Button` `variant="ghost"` `size="sm"` <!-- rule:forge-ui-catalog-wrong-badge --> |
| `Tooltip` carrying text the user must read | a hint is not guaranteed reachable | `FormField.Description`, or visible copy <!-- rule:forge-ui-catalog-wrong-tooltip --> |
| `Progress` for a value in a fixed range | nothing is progressing | `Meter` <!-- rule:forge-ui-catalog-wrong-progress --> |
| a raw `<input>`, `<select>`, `<textarea>` or `<button>` where the `ui/core` control exists | the label, the id, the error and the focus ring are not free | `Input`, `Select`, `Textarea` or `Button` — inside `FormField` when the value is validated <!-- rule:forge-ui-catalog-wrong-raw-input --> |
| `ui/core` `Input` for a signal-bound control | it has no `bind` prop | `ui/controls` `Input` <!-- rule:forge-ui-catalog-wrong-unbound-input --> |

Each of these is a Tier 2 default with the same override condition as its `Default:` rule above,
where one exists. Where the wrong tool would also breach the Floor — an unfocusable clickable
`Badge` breaches `forge-ui-focus-ring` and `forge-ui-hit-target` — the Floor decides and there is no
override.
