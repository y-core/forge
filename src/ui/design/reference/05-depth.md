---
title: Depth and Elevation
description: "When a surface may lift off the page, and what shadow, border and background each mean when it does."
---

# Depth and Elevation

Everything here is a **Default** — rebuttable only by an explicit written brief, never by preference. The Floor rules cited below are not.

Depth in forge is not decoration. It is a claim about distance: a raised surface is asserting that it sits _closer to the user_ than what it covers.
Forge's primitives already occupy each level of the ladder below, so the design work is choosing a level rather than inventing one.

---

## 0. Quick Reference

- §1 The ladder: the distances a product UI has, and the primitive that already occupies each
- §1a The two modes spell a level differently: a cast shadow in light, a rim and a falloff in dark
- §1b Claiming a level: reach for the primitive, raise only what is closer, and keep the body flat
- §2 Choosing a separator: spacing, a background token, a hairline, a shadow — cheapest first
- §3 Shadows describe a light source: blurred and offset on the block axis, and never stacked
- §3a Before / after: a `Card` at a `Dialog`'s distance, and the modal that stops feeling modal
- §4 Nesting: the two answers `forge-ui-no-nested-card` leaves open, and one elevation change per step
- §5 Radius: one `--radius` family, and the step following the elevation rather than the size

---

## 1. The ladder

| Level | Surface | Primitive | What it means |
| --- | --- | --- | --- |
| 0 | Flat on `--background` | any `<div>` | Part of the page. Nothing sits above it. |
| 1 | A hairline | `Separator`, `border-border` | Regions of one surface, told apart. A hairline, including a one-sided `border-b` / `border-t` / `border-s` divider, stays independent of `--border-width`; `border-field` is for the edge of a bordered surface. |
| 2 | `shadow-sm` on `--card` | `Card` | A grouped object you can point at. |
| 3 | `shadow-md` on `--popover` | `Popover.Content`, `Menu.Popup` | Transient, tied to a trigger, dismissible. |
| 4 | `shadow-lg` on `--popover` | `Dialog`, `Toast` | Above everything; blocks or interrupts. |

Every one of those shadow classes is what the primitive already renders, so reaching for the right level means reaching for the right component.

### 1a. The two modes spell a level differently

The shadow token does the switching, so a component does not. In light a level is a cast shadow. In dark black ink over a near-black surface would
render nothing, so the same value drops the cast layers and carries the level with a 1px inset rim plus a soft outer falloff whose radius is the
level — a clean edge transition, not a glow, and the falloff is the fainter of the two for exactly that reason. Both spellings come out of the
`--cast-*` and `--rim-*` families in `src/ui/assets/css/theme-colors.css`; the geometry is Tailwind's, unchanged, in `theme-base.css`. Choosing a
level does not change.

### 1b. Claiming a level

<!-- rule:forge-ui-depth-primitive-first -->

<!-- rule:forge-ui-depth-earn-raise --> Closer means: it covers content, it can be dismissed, or it is a discrete object among peers. A region that
is merely _important_ is not closer, and takes weight or spacing instead.

<!-- rule:forge-ui-depth-flat-body --> `bg-background text-foreground`, no border, no shadow.

<!-- rule:forge-ui-depth-dialog-last --> Destructive confirmation, a required decision. Anything a user can reasonably ignore is a `Popover` at
level 3 or a `Toast` they can dismiss.

---

## 2. Choosing a separator

The devices that separate two regions are not interchangeable.

| Given | Choose | Because |
| --- | --- | --- |
| Parts of one object (header ↔ body) | `Separator`, or `Card.Header`'s own `border-b border-border` | One object, one elevation |
| Peer objects in a list | spacing — a `gap-*` step | Whitespace separates without adding a level |
| A region on a differently-shaded ground | `bg-muted` with `text-muted-foreground` | A background change reads as a different _kind_ of region |
| A surface that covers something | `Card`, `Popover.Content`, `Dialog` | Only a covering surface earns a shadow |

<!-- rule:forge-ui-depth-separator-order --> The order runs cheapest-first: each step adds one more visual claim.

<!-- rule:forge-ui-depth-popover-token --> `Popover.Content`, `Menu.Popup` and `Dialog` already do; a hand-built panel at level 3 or 4 pairs the
same two tokens (`forge-ui-foreground-pairing`).

---

## 3. Shadows describe a light source

<!-- rule:forge-ui-depth-soft-shadow --> A shadow in forge is soft and offset downward, because it is standing in for a light above the interface. A
hard shadow with no blur is not a smaller version of that — it is a second shape, and it reads as a graphic border, not as height.

`shadow-sm` / `shadow-md` / `shadow-lg` are the ones forge uses. Under a flat, illustrative brief the offset shadow is the aesthetic.

<!-- rule:forge-ui-depth-no-shadow-stack --> `<Card class="shadow-lg">` is a `Card` claiming a `Dialog`'s distance while sitting in the page flow.

### 3a. Before / after

```tsx
// Wrong — a Card raised to Dialog height to signal "this one matters".
import { Card } from "@y-core/forge/ui/core";

<Card class='shadow-lg'>
  <Card.Header>
    <Card.Title>Billing</Card.Title>
  </Card.Header>
  <Card.Content>…</Card.Content>
</Card>;
```

Costs: the card now sits at the same distance as a modal, so when a real `Dialog` opens over it the two read as coplanar and the modal stops feeling
modal.

```tsx
// Right — importance carried by weight and order, elevation left where it belongs.
import { Card } from "@y-core/forge/ui/core";

<Card>
  <Card.Header>
    <Card.Title class='text-base'>Billing</Card.Title>
    <Card.Description>Card on file and next invoice.</Card.Description>
  </Card.Header>
  <Card.Content>…</Card.Content>
</Card>;
```

---

## 4. Nesting

`forge-ui-no-nested-card` forbids a `Card` inside `Card.Content` outright: two borders and two shadows that encode one object. The design question
it leaves open is what to do instead, and there are exactly two answers.

```tsx
// Wrong — inner regions promoted to their own elevation.
import { Card } from "@y-core/forge/ui/core";

<Card>
  <Card.Content>
    <Card>
      <Card.Content>Shipping</Card.Content>
    </Card>
    <Card>
      <Card.Content>Billing</Card.Content>
    </Card>
  </Card.Content>
</Card>;
```

Costs: three surfaces, one object, and the inner shadows sit under the outer one — depth reading backwards.

```tsx
// Right — one elevation, regions separated at level 1.
import { Card, Separator } from "@y-core/forge/ui/core";

<Card>
  <Card.Content class='flex flex-col gap-4'>
    <div>Shipping</div>
    <Separator />
    <div>Billing</div>
  </Card.Content>
</Card>;
```

The other answer is promotion: if the inner regions are genuinely peer objects, make them siblings of the outer `Card` rather than children of it.

<!-- rule:forge-ui-depth-one-step --> A `Dialog` may hold a `Card`-free body with a `Menu` opening above it; it may not hold a `Card` holding a
`Popover` holding a bordered panel.

---

## 5. Radius

Forge has one radius: `--radius`, declared in `src/ui/assets/css/theme-base.css`. A control takes `--radius-field` and a surface `--radius-box`,
both computed from it, and a selector takes the pill `--radius-selector`; the `--radius-sm` to `--radius-xl` steps are computed from it too.
`forge-ui-one-radius` holds as long as you take a step from the family rather than an arbitrary value.

<!-- rule:forge-ui-depth-radius-tracks-level --> Level 2 and above take the box step (`Card`, `Dialog` and `Menu.Popup` are `rounded-box`); controls
inside them take the field step (`Button` and `Input` are `rounded-field`).
