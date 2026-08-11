# Depth and Elevation

Everything here is a **Default** — rebuttable only by an explicit written brief, never by preference.
The Floor rules cited below are not.

Depth in forge is not decoration. It is a claim about distance: a raised surface is asserting that it
sits *closer to the user* than what it covers. Five levels express every distance a product UI has,
and forge's primitives already occupy them, so the design work is choosing a level rather than
inventing one.

---

## The ladder

| Level | Surface | Primitive | What it means |
|---|---|---|---|
| 0 | Flat on `--background` | any `<div>` | Part of the page. Nothing sits above it. |
| 1 | A hairline | `Separator`, `border-border` | Two regions of one surface, told apart. |
| 2 | `shadow-sm` on `--card` | `Card` | A grouped object you can point at. |
| 3 | `shadow-md` on `--popover` | `Popover.Content`, `Menu.Popup` | Transient, tied to a trigger, dismissible. |
| 4 | `shadow-lg` on `--popover` | `Dialog`, `Toast` | Above everything; blocks or interrupts. |

Every one of those shadow classes is what the primitive already renders — `Card` is
`shadow-sm border border-border bg-card text-card-foreground`, `Dialog` is `shadow-lg`, `Menu.Popup`
is `shadow-md`. Reaching for the right level therefore means reaching for the right component.

**Default: express elevation by picking the primitive that already sits at that level, not by adding
a shadow utility to a lower one.** <!-- rule:forge-ui-depth-primitive-first -->
Override only when a surface genuinely has no matching primitive — a drag preview, a sticky column
header — in which case take the shadow class from the level it is claiming, unchanged.

**Default: a surface is raised only when it is genuinely closer to the user.**
<!-- rule:forge-ui-depth-earn-raise -->
Closer means: it covers content, it can be dismissed, or it is a discrete object among peers. A
region that is merely *important* is not closer, and takes weight or spacing instead. Override when
a brief asks for a marketing surface, where a raised card is doing attention work rather than
distance work.

**Default: keep page body content at level 0.** <!-- rule:forge-ui-depth-flat-body -->
`bg-background text-foreground`, no border, no shadow. Override when the body is a canvas of peer
objects — a board of records — where each object is a `Card` and the page behind them stays flat.

**Default: reserve `Dialog` for work that must not proceed in the background.**
<!-- rule:forge-ui-depth-dialog-last -->
Destructive confirmation, a required decision. Anything a user can reasonably ignore is a `Popover`
at level 3 or a `Toast` they can dismiss. Override when the platform's focus trap is the point — a
flow that is genuinely modal, such as re-authentication.

---

## Choosing a separator

Given two regions that must read as distinct, three things separate them and they are not
interchangeable.

| Given | Choose | Because |
|---|---|---|
| Two parts of one object (header ↔ body) | `Separator`, or `Card.Header`'s own `border-b border-border` | One object, one elevation |
| Two peer objects in a list | spacing — a `gap-*` step | Whitespace separates without adding a level |
| A region on a differently-shaded ground | `bg-muted` with `text-muted-foreground` | A background change reads as a different *kind* of region |
| A surface that covers something | `Card`, `Popover.Content`, `Dialog` | Only a covering surface earns a shadow |

**Default: try spacing, then a background token, then a hairline, before a shadow.**
<!-- rule:forge-ui-depth-separator-order -->
The order runs cheapest-first: each step adds one more visual claim. Override when the two regions
scroll independently, where a shadow is the only cue that survives the scroll.

**Default: a raised panel takes `bg-popover` with `text-popover-foreground`.**
<!-- rule:forge-ui-depth-popover-token -->
`Popover.Content`, `Menu.Popup` and `Dialog` already do; a hand-built panel at level 3 or 4 pairs the
same two tokens (`forge-ui-foreground-pairing`). Override never for the pairing — only for which
token, and only under a brief that themes overlays separately.

---

## Shadows describe a light source

A shadow in forge is soft and offset downward, because it is standing in for a light above the
interface. A hard shadow with no blur is not a smaller version of that — it is a second shape, and it
reads as a graphic border, not as height.

**Default: every shadow is blurred and offset on the block axis only.**
<!-- rule:forge-ui-depth-soft-shadow -->
`shadow-sm` / `shadow-md` / `shadow-lg` are the three forge uses. Override under a brief calling for
a deliberately flat, illustrative style — where the offset shadow is the aesthetic, applied
consistently rather than to one element.

**Default: never add a shadow class to a component that already renders one.**
<!-- rule:forge-ui-depth-no-shadow-stack -->
`<Card class="shadow-lg">` is a `Card` claiming a `Dialog`'s distance while sitting in the page flow.
Override when the card genuinely is lifted — a drag-in-progress state — and then only for the
duration of the lift.

### Before / after

```tsx
// Wrong — a Card raised to Dialog height to signal "this one matters".
import { Card } from "@y-core/forge/ui/core";

<Card class="shadow-lg">
  <Card.Header>
    <Card.Title>Billing</Card.Title>
  </Card.Header>
  <Card.Content>…</Card.Content>
</Card>;
```

Costs: the card now sits at the same distance as a modal, so when a real `Dialog` opens over it the
two read as coplanar and the modal stops feeling modal.

```tsx
// Right — importance carried by weight and order, elevation left where it belongs.
import { Card } from "@y-core/forge/ui/core";

<Card>
  <Card.Header>
    <Card.Title class="text-base">Billing</Card.Title>
    <Card.Description>Card on file and next invoice.</Card.Description>
  </Card.Header>
  <Card.Content>…</Card.Content>
</Card>;
```

---

## Nesting

`forge-ui-no-nested-card` forbids a `Card` inside `Card.Content` outright: two borders and two
shadows that encode one object. The design question it leaves open is what to do instead, and there
are exactly two answers.

```tsx
// Wrong — inner regions promoted to their own elevation.
import { Card } from "@y-core/forge/ui/core";

<Card>
  <Card.Content>
    <Card><Card.Content>Shipping</Card.Content></Card>
    <Card><Card.Content>Billing</Card.Content></Card>
  </Card.Content>
</Card>;
```

Costs: three surfaces, one object, and the inner shadows sit under the outer one — depth reading
backwards.

```tsx
// Right — one elevation, regions separated at level 1.
import { Card, Separator } from "@y-core/forge/ui/core";

<Card>
  <Card.Content class="flex flex-col gap-4">
    <section>Shipping</section>
    <Separator />
    <section>Billing</section>
  </Card.Content>
</Card>;
```

The other answer is promotion: if the inner regions are genuinely peer objects, make them siblings of
the outer `Card` rather than children of it.

**Default: at most one elevation change per containment step.**
<!-- rule:forge-ui-depth-one-step -->
A `Dialog` may hold a `Card`-free body with a `Menu` opening above it; it may not hold a `Card`
holding a `Popover` holding a bordered panel. Override when a genuinely layered tool UI — a canvas
with a floating rail and a flyout off it — requires the third step, which `Toolbar`'s flyout already
models.

---

## Radius

Forge has one radius. `--radius` is declared in `src/ui/assets/css/theme-base.css`, and
`--radius-sm`, `--radius-md`, `--radius-lg` and `--radius-xl` are computed from it — so a theme that
moves `--radius` moves the whole family together, and `forge-ui-one-radius` holds automatically as
long as you take a step from the family rather than an arbitrary value.

**Default: let the radius step follow the elevation step rather than the element's size.**
<!-- rule:forge-ui-depth-radius-tracks-level -->
Level 2 and above are the larger steps (`Card` is `rounded-2xl`, `Dialog` `rounded-xl`,
`Menu.Popup` `rounded-xl`); controls inside them take a smaller step (`Button` is `rounded-lg`,
`Input` `rounded-lg`). Override under a brief that sets a flat or fully-pill radius, which moves
`--radius` once rather than per component.
