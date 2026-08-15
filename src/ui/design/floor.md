# Floor

The invariants. Nothing here is overridable — not by a brief, not by a preference, not by the
surrounding code. Read **Verify** as a pass before you call the work done; hold **Refuse** the whole
time you are generating.

---

## Verify

Obligations. Walk this list before you report a UI surface as finished.

**Emit the Design Read before you build.** <!-- rule:forge-ui-design-read -->
One line, no template, no ceremony: **who** the surface is for, **the one** primary action, and
**what failure looks like**. It is what decides which `buttonVariants` variant the primary control
takes and which `Alert` or `Toast` variant the failure path renders.

> Design Read: returning admin scanning failed jobs; primary action is retry; failure is a job that
> retries and fails again — `destructive` `Alert` in place, row stays.

**Cap body copy at a comfortable measure — 45–75 characters.** <!-- rule:forge-ui-measure-cap -->
`max-w-prose`, or an explicit `max-w-*` when the container is not prose. Never full-bleed text — a
paragraph in an unbounded `Card.Content` is the common breach.

**Meet 4.5:1 for body text and 3:1 for large text and UI boundaries, in both `:root` and
`.dark`.** <!-- rule:forge-ui-contrast-floor -->
Both themes, every time — a pairing that clears the floor on `--background` can fail on the dark
value of the same token. Verify the pair you actually shipped, not the token's light value.

**Never carry status by color alone.** <!-- rule:forge-ui-not-color-alone -->
Pair the token with an `Icon` and with text. On a field, carry it with both `data-invalid` and
`aria-invalid`, and note that **two mechanisms emit them**: `FormField`'s `invalid` prop puts
`data-invalid` on the `<fieldset>` (through `stateAttrs`), while `aria-invalid` reaches the control
only through `fieldControlProps`. Setting `invalid` alone styles the field and announces nothing. A
red `Alert` with no icon and no `Alert.Title` naming the failure is a color-only status.

**Keep focus visible on every interactive element.** <!-- rule:forge-ui-focus-ring -->
`focus-visible:ring-2 focus-visible:ring-ring` against the `--ring` token. `outline-none` without a
replacement ring is a removed affordance, not a style choice.

**Replace every affordance you suppress.** <!-- rule:forge-ui-affordance-replacement -->
Each suppression utility deletes something the browser drew, and forge names what goes back in its
place. `appearance-none` on a `type='range'` leaves no track and no thumb — `Slider` redraws both as
authored `::-webkit-slider-runnable-track` / `::-moz-range-track` and thumb rules in
`forge-ui.css`, because no utility class reaches a UA pseudo-element. On a `<select>` it leaves no
arrow — `Select` reserves `pe-10` and positions its own `aria-hidden` `chevron-down` `Icon`. On a
checkbox or radio it leaves nothing to mark checked — and it also gives up the exemption 1.4.11
grants a control the author has not modified, so `CheckboxGroup` and `RadioGroup` replace *two*
things: the box, with an explicit `border-input` boundary and a `checked:bg-primary` fill, and the
user's own palette, with the `@media (forced-colors: active)` block in `forge-ui.css` §9 — without
which a High Contrast reader gets two identically empty squares. `list-none` removes
the markers that separated the items — a `Separator` or a deliberate `gap-*` takes over. `p-0`
removes the box that made the target hittable — restore a size that clears `forge-ui-hit-target`.
`border-0` removes the boundary — restore it with `border-input`, `border-border`, or a
`Separator`. A hidden `::marker`
is the `<summary>` case: `Collapsible.Trigger` and `Accordion.Trigger` both set `list-none` to drop
the UA disclosure triangle, and both draw their own `chevron-down` `Icon` back in its place,
rotating on `group-open/accordion-item` and `group-open/collapsible-item` respectively. Neither can
forget it: the `icon` prop is required on both, so the replacement is supplied at every call site or
the build fails.

`forge-ui-focus-ring` is this rule applied to `outline-none`. It keeps its own id, and is cited by
that id.

**Keep every interactive target at or above the `Button` `sm` box.** <!-- rule:forge-ui-hit-target -->
`sm` is the floor of the `buttonVariants` size scale (`sm` / `md` / `lg` / `icon` / `icon-sm` /
`square`). A control does not shrink below it to make a layout fit; the layout gives way.

**Honour `prefers-reduced-motion` on every authored motion.** <!-- rule:forge-ui-reduced-motion -->
Applies to `motion-safe:` / `motion-reduce:` classes and to every declarative state transition —
`starting:`, `open:`, `not-open:`, `transition-discrete` — alike.

**Ship a designed empty state on every collection surface.** <!-- rule:forge-ui-empty-state -->
An empty list is a state, not an absence: a line of text saying what would be here, and the action
that fills it. `Card.Content` holding a `<p class="text-muted-foreground">` plus a `secondary`
`Button` is the whole pattern.

**Give every control an accessible name.** <!-- rule:forge-ui-accessible-name -->
Via `Label`, via `FormField.Label`, or via visually-hidden text. An icon-only control
(`size="icon"`) has no name until you give it one — `Icon` is `aria-hidden` by default.

- Wrong: `<Button size="icon"><AppIcon name="close" /></Button>`
- Right: `<Button size="icon" aria-label="Dismiss"><AppIcon name="close" /></Button>`

**Never skip a heading level.** <!-- rule:forge-ui-heading-order -->
`Card.Title` renders inside the level its section sits at; choosing a level for its type size is
what produces the skip. Size with a class, not with the tag.

---

## Refuse

Prohibitions. These never appear in output, whatever was asked for.

**Never write a raw color literal in a `class`.** <!-- rule:forge-ui-color-token-only -->
No `#hex`, no `rgb()`, no `hsl()`, no `oklch()`. Use the semantic tokens — `--background`
`--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--primary`
`--primary-foreground` `--secondary` `--secondary-foreground` `--muted` `--muted-foreground`
`--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--success`
`--success-foreground` `--warning` `--warning-foreground` `--border` `--input` `--track` `--ring` —
plus the twenty `--status-*` roles, four intents (`danger`, `warning`, `success`, `info`) by five
roles (`-subtle`, `-subtle-foreground`, `-strong`, `-strong-foreground`, `-border`), which is how a
status surface gets a fixed hue without a fixed value.

Each of them resolves through a numbered step of the scale — `--gray-1` … `--gray-12`, their alpha
siblings, and the fixed status hues — and each step holds one literal value covering both modes,
declared by `theme-neutral.css` (or whichever scheme file is imported after it) and, for the hues,
`theme-colors.css`. `theme-base.css` holds the mapping, the `color-scheme` that picks each step's
mode, and no colour values at all. That is what makes a theme swap a one-file change, and what makes
a *per-mode* change an edit to the step rather than to the token.

A Tailwind palette utility is permitted **only paired with its own `dark:` counterpart**, and only
for a hue no forge token covers. A bare `bg-red-50` is not a literal, but it fails for the same
reason one is banned: it survives the theme switch, and becomes a near-white rectangle on a dark
page. For the four status intents there is nothing left to reach for it with — that case is
`--status-*`, per `forge-ui-color-semantic-variant-fixed` in `reference/04-color.md`.

- Wrong: `class="bg-[#0f172a] text-[#e2e8f0]"`
- Wrong: `class="bg-red-50 text-red-900"` — no dark half, so it inverts under `.dark`
- Wrong: `class="bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"` — a hand-assembled
  status panel; the tokens exist
- Right: `class="bg-card text-card-foreground"`
- Right: `class="bg-status-danger-subtle text-status-danger-subtle-foreground"` — a fixed status
  hue, themed in both modes

**Never write a `style=` attribute.** <!-- rule:forge-ui-no-inline-style -->
Forge's SSR renderer drops it. Nothing errors, nothing warns, and the styling is simply gone from
the emitted HTML — the most expensive failure mode there is.

**Use Tailwind's default spacing scale.** <!-- rule:forge-ui-spacing-scale-only -->
Never an arbitrary value where a scale value exists. The scale's steps differ by at least 25%, which
is what makes two different gaps read as deliberate rather than as a mistake.

- Wrong: `class="p-[7px] gap-[13px] text-[13px]"`
- Right: `class="p-2 gap-3 text-sm"`

**Never use `h-screen` or `w-screen`.** <!-- rule:forge-ui-viewport-units -->
Mobile browser chrome makes `100vh` taller than the visible viewport, so the bottom of the layout
sits under the URL bar. Use `min-h-dvh`.

**Never nest a `Card` inside `Card.Content`.** <!-- rule:forge-ui-no-nested-card -->
Two borders and two elevations that encode nothing. Separate the inner regions with `Separator`, or
promote them to siblings of the outer `Card`.

**Use every background token with its paired `*-foreground`.** <!-- rule:forge-ui-foreground-pairing -->
`bg-card`/`text-card-foreground`, `bg-primary`/`text-primary-foreground`,
`bg-muted`/`text-muted-foreground`, `bg-popover`/`text-popover-foreground`,
`bg-accent`/`text-accent-foreground`, `bg-secondary`/`text-secondary-foreground`,
`bg-success`/`text-success-foreground`, `bg-warning`/`text-warning-foreground`,
`bg-destructive`/`text-destructive-foreground`,
`bg-status-danger-subtle`/`text-status-danger-subtle-foreground`,
`bg-status-danger-strong`/`text-status-danger-strong-foreground` and the same two pairs for the
`warning`, `success` and `info` intents. Never
`text-white/70` on a colored surface — an opacity guess is how a pairing quietly drops under
`forge-ui-contrast-floor`. `--destructive` reads three ways — as text, as a border, and as a fill —
and only the fill needs the partner; `text-destructive` and `border-destructive` stand alone.

Pair within a tier, never across one: a `-strong` surface takes the `-strong-foreground`, and each
of those pairs is measured on its own surface. `Alert`, `Toast` and `Badge` already hold the right
pair inside their variants, so consuming the variant is the shorter route to the same thing.

**Hold a surface to two text colors.** <!-- rule:forge-ui-text-color-budget -->
`text-foreground` for the primary line, `text-muted-foreground` for everything supporting. A third
is a hierarchy you are asserting with color that weight, size, or spacing should carry instead.

**Keep one radius.** <!-- rule:forge-ui-one-radius -->
`--radius`, with `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` computed from it. No
per-component radius override, and never square corners next to round ones on one surface.

**Take icons from the sprite.** <!-- rule:forge-ui-real-icons -->
`Icon` or a `createIcon` binding from `@y-core/forge/ui/core`, typed `ForgeIcon<Name>`. Never an emoji,
never a hand-rolled inline `<svg>`. Forge's own seven glyphs are enumerated by
`FORGE_UI_ICON_NAMES` in `@y-core/forge/ui/assets`; an app sprite extends that set through the same
factory.

```tsx
import { createIcon } from "@y-core/forge/ui/core";
const AppIcon = createIcon("/assets/icons.svg");
```

**Never invent data.** <!-- rule:forge-ui-no-fabricated-data -->
No metrics, no testimonials, no placeholder identities — not "John Doe", not "Acme Inc", not
"+312%". Render the real value, or render the empty state that `forge-ui-empty-state` requires.

---

Defaults and the catalogue of AI tells live in `tells.md` and `reference/`; the countable
self-audit lives in `preflight.md`.
