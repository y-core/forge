---
title: Hierarchy
description: "What a screen tells a user to do first: how emphasis, size and placement rank the actions on a surface."
---

# Hierarchy

Hierarchy is the answer to one question a user asks of every screen: _what am I supposed to do
here?_ Forge's primitives already encode an answer. `Button` ships three resting looks for an
action, and that is not a shortage — it is the action pyramid, spelled as an API.

---

## 0. Quick Reference

- §1 The action pyramid is `Button`'s three looks: primary, outline and ghost as three levels of ink
- §1a Before / after — the three-primary dialog: three filled buttons, and the surface with no opinion
- §2 De-emphasise before you emphasise: lower the neighbours rather than raise the element
- §3 Icon-only actions: `shape='icon'` against `shape='square'`, and which size matches which row
- §4 Severity is a ladder, and `neutral` is the bottom rung: what each `tone` claims about a message
- §5 Labels are a last resort: when a value needs no label, and what to spend when it does
- §5a Before / after — a labelled detail block: `Label` competing with its value, and the `Field` that does not
- §6 Where the primary action lives: `Card.Footer` for the action, `Card.Action` for the card-level control

---

## 1. The action pyramid is `Button`'s three looks

| Tier | Button | What it is for | How many per surface |
| --- | --- | --- | --- |
| Primary | the default — `tone='primary'` | The one thing the surface exists for | Exactly one |
| Secondary | `tone='neutral' appearance='outline'` | The real alternative a user might take instead | Zero or one, usually |
| Tertiary | `tone='neutral' appearance='ghost'` | Everything else — cancel, dismiss, back, row-level affordances | As many as the surface honestly has |

Default: exactly one primary button renders per surface — a page, a `Dialog`, or a `Card` each
count as one surface — unless a written brief describes a surface with two genuinely co-equal
outcomes, such as an accept/decline decision with no default. <!-- rule:forge-ui-hierarchy-one-primary -->

Default: the outline button is reserved for the action a user would plausibly take _instead_ of the
primary one, not for the second-most-visible thing on the surface, unless a brief calls for a
paired control set where both members carry equal commitment. <!-- rule:forge-ui-hierarchy-secondary-alternative -->

Default: every remaining action uses `appearance='ghost'`, including cancel and dismiss, unless the action is
the sole control on an otherwise empty surface and would read as decoration without a border. <!-- rule:forge-ui-hierarchy-ghost-remainder -->

The paints themselves make the case: the primary button fills with `--primary`, the outline one
draws a border from `--input` and no fill, and the ghost one is text with a hover wash of
`--accent`. Three levels of ink, in descending order. Reaching outside them means fighting the
system.

### 1a. Before / after — the three-primary dialog

```tsx
import { Button, Card } from "@y-core/forge/ui/core";

<Card.Footer>
  <Button>Delete project</Button>
  <Button>Archive instead</Button>
  <Button>Cancel</Button>
</Card.Footer>;
```

Costs the user the decision: three filled buttons of identical weight mean the surface has no
opinion, so the eye has to read all three labels before it can act.

```tsx
import { Button, Card } from "@y-core/forge/ui/core";

<Card.Footer class='justify-end'>
  <Button tone='neutral' appearance='ghost'>
    Cancel
  </Button>
  <Button tone='neutral' appearance='outline'>
    Archive instead
  </Button>
  <Button>Delete project</Button>
</Card.Footer>;
```

## 2. De-emphasise before you emphasise

The instinct when something does not stand out is to make it louder. The cheaper move, almost
always, is to make its neighbours quieter — a surface has a fixed budget of attention, and
lowering three things raises the fourth for free.

Default: when an element does not read as prominent enough, lower the weight of its neighbours
before raising its own — reach for `appearance='ghost'` over `appearance='outline'`, and a
`Badge` with `appearance='outline'` over a filled one — unless a brief sets Variance above forge's
ratified default. <!-- rule:forge-ui-hierarchy-deemphasize-first -->

Default: a `Badge` used as a neutral label rather than a status signal uses `appearance='outline'`, unless the
badge is the only element distinguishing two otherwise identical rows. <!-- rule:forge-ui-hierarchy-badge-outline-first -->

Two text colors and stop. `--foreground` (or `--card-foreground` inside a `Card`) carries the
line that matters; `--muted-foreground` carries everything supporting. A third competing color is
what `forge-ui-text-color-budget` forbids, and `Card.Title` / `Card.Description` are already
built as that exact pair — copy the relationship rather than inventing a new one.

## 3. Icon-only actions

`Button` `shape` offers `icon` as a square box the size scale drives, and `square` as a
_relationship_ — full width, aspect-ratio 1.

| You have | Use | Why |
| --- | --- | --- |
| A standalone icon action beside `md` controls | `shape='icon'` | A 40px square — `--control-h-md`, so it matches the `md` row exactly |
| An icon action inside a dense toolbar or beside `sm` controls | `shape='icon' size='sm'` | A 32px square — `--control-h-sm`, so the two line up |
| An icon action beside `lg` controls | `shape='icon' size='lg'` | A 48px square — `--control-h-lg` |
| An icon action in a rail whose width the app owns | `shape='square'` | Takes the parent's width and stays square, so the rail's token stays the single source |

Default: an icon-only `Button` uses `shape='icon'` and never a text size with a hand-tuned
padding override, unless the button sits in a container whose width is set by the app, in which
case `shape='square'` is the correct choice. <!-- rule:forge-ui-hierarchy-icon-button-size -->

Default: `shape='square'` is used only where the parent supplies a definite width, unless a brief
specifies a fluid grid of equal cells. <!-- rule:forge-ui-hierarchy-square-needs-width -->

Every icon-only button still needs an accessible name — `forge-ui-accessible-name` is a Floor
rule, and a `Tooltip` is not a substitute for one.

## 4. Severity is a ladder, and `neutral` is the bottom rung

`Alert` and `Toast` take the same `tone` scale — `neutral` / `destructive` / `info` / `success` /
`warning`, `neutral` being the default. Each non-`neutral` tone is a claim about how much the
message matters. Making that claim when the message does not carry it is the fastest way to teach
a user to ignore the component.

| The message says | Tone | Note |
| --- | --- | --- |
| Here is context you may want | `neutral` | The correct choice far more often than it gets used |
| This succeeded and the outcome is not visible elsewhere | `success` | If the outcome _is_ visible, say nothing |
| Something needs attention but nothing is broken | `warning` | Not for "are you sure" |
| An operation failed, or data will be lost | `destructive` | Reserve it; spending it on validation noise devalues it |
| A neutral fact worth a colour of its own | `info` | Rarely earns its place over `neutral` |

Default: an `Alert` or `Toast` uses `tone='neutral'` unless the message names a specific failure, a
specific risk, or a completed action whose result the user cannot otherwise see. <!-- rule:forge-ui-hierarchy-severity-default-first -->

Default: `tone='destructive'` is reserved for loss and failure, never for a confirmation prompt or a
field-level validation message, unless a brief defines a domain where the two are the same event. <!-- rule:forge-ui-hierarchy-destructive-reserve -->

The same ladder governs `Badge`, whose own default is `tone='neutral' appearance='soft'`:
`tone='primary' appearance='solid'` fills with `--primary` and is the loudest thing a badge can be.
A list where every row carries a filled primary badge has a list with no signal in it.

Colour alone never carries the severity — `forge-ui-not-color-alone` is a Floor rule, and an
`Alert.Title` is the usual way to satisfy it.

## 5. Labels are a last resort

A label exists because a value would otherwise be ambiguous. When the value is self-evident — an
email address, a timestamp, a currency amount in a column headed with its currency — the label is
noise that competes with the thing it introduces.

Default: a value that is unambiguous in context renders without a label, unless the value appears
in a form the user will submit, where a `Label` is required by
`forge-ui-accessible-name`. <!-- rule:forge-ui-hierarchy-label-last-resort -->

When a label is genuinely needed, spend as little as possible on it:

| Situation | Reach for |
| --- | --- |
| A read-only detail row | `Field` with `orientation='horizontal'` — label and value on one line, label already at `text-xs` on `--muted-foreground` |
| A stacked read-only detail | `Field` with the default `orientation='vertical'` |
| A real form control | `FormField.Label`, or a `Label` carrying `FIELD_LABEL_CLASSES` |
| A group heading a sighted user reads from layout | a visually hidden heading, so `forge-ui-heading-order` still holds |

Default: a section whose purpose is obvious from its layout carries a visually hidden heading
rather than a visible one, unless the section is one of several that a user must choose between
by name. <!-- rule:forge-ui-hierarchy-hidden-section-title -->

### 5a. Before / after — a labelled detail block

```tsx
import { Card, Label } from "@y-core/forge/ui/core";

<Card.Content>
  <Label>Email address</Label>
  <p class='text-base font-semibold text-foreground'>ada@example.com</p>
  <Label>Created</Label>
  <p class='text-base font-semibold text-foreground'>12 March</p>
</Card.Content>;
```

Costs the block its hierarchy: `Label` carries `FIELD_LABEL_CLASSES`, which is `font-medium` on
`--foreground`, so the captions compete with the values instead of introducing them — and a
`<label>` with no control is the wrong element besides.

```tsx
import { Card, Field } from "@y-core/forge/ui/core";

<Card.Content class='flex flex-col gap-3'>
  <Field label='Email' orientation='horizontal'>
    <span class='text-sm text-foreground'>ada@example.com</span>
  </Field>
  <Field label='Created' orientation='horizontal'>
    <span class='text-sm text-foreground'>12 March</span>
  </Field>
</Card.Content>;
```

`Field` renders its label as a `<span>` at `text-xs font-medium text-muted-foreground` — quieter
than the value by construction, and two text colors total.

## 6. Where the primary action lives

Default: a `Card`'s single most important action renders in `Card.Footer`, and a
surface-level control that acts on the card as a whole renders in `Card.Action`, unless the card
is itself a link target, in which case it carries no button at all. <!-- rule:forge-ui-hierarchy-card-action-placement -->

`Card.Action` is grid-positioned into the header's second column and spans both header rows, so a
`ghost` icon button placed there aligns against the title and description without any manual
positioning. That is the slot's whole reason for existing.
