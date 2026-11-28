---
title: The Floor
description: "The design invariants. Nothing here is overridable by a brief, a preference, or the surrounding code."
---

# Floor

The invariants. Nothing here is overridable — not by a brief, not by a preference, not by the surrounding code. Read **Verify** (§1) as a pass
before you call the work done; hold **Refuse** (§2) the whole time you are generating.

---

## 0. Quick Reference

- §1 Verify — the Obligations: walk this list before reporting a UI surface finished
- §1a The Design Read: one line naming the audience, the primary action, and what failure looks like
- §1b Measure and Contrast: cap body copy at 45–75 characters, and clear the ratio in both modes
- §1c Status Is Never Colour Alone: the token plus an icon plus text, and the two attributes a field needs
- §1d Focus Stays Visible: the ring against `--ring`, and why `outline-none` alone is a deleted affordance
- §1e Every Suppressed Affordance Is Replaced: what each suppression utility deletes, and what forge puts back
- §1f Hit Target and Reduced Motion: an absolute 28px floor on both axes, and motion that honours the preference
- §1g The Designed Empty State: an empty collection is a state, not an absence
- §1h Accessible Names and Label Association: a control with no name, a label wired to nothing, and an image with no `alt`
- §1i Heading Order: never skip a level, and the `level` prop that keeps a compound honest
- §1j A Field's Error, at the Field: the message beside its control, and an invalid field marked three ways
- §1k The Current Location, and the Way Out of a Drawer: `aria-current` by request, and every way to dismiss
- §2 Refuse — the Prohibitions: these never appear in output, whatever was asked for
- §2a Colour Tokens, Never Literals: no hex, no `rgb()`, and the one case a palette utility survives
- §2b No Inline Style, and No Restated Base Classes: the silently dropped attribute, and the copied class list
- §2c The Spacing Scale, and Viewport Units: no arbitrary value where a step exists, and never `h-screen`
- §2d No Nested Card: two borders and two elevations that encode nothing
- §2e Foreground Pairing: every background token with its partner, never an opacity guess, and the destructive fill's two partners
- §2f A Text-Colour Budget and One Radius: the colour budget, and the single radius everything derives from
- §2g Icons from the Sprite: `Icon` and `createIcon`, never an emoji and never an inline `<svg>`
- §2h Never Invent Data: no fabricated metrics, testimonials, or placeholder identities
- §2i Forge's Control, Never the Raw Element: the `ui/core` control, its bound variant, and one field for a code
- §2j A Control Chosen for What It Claims: a two-state control by its meaning, and `Progress` only with a total
- §2k Filter Chips Stay in Their Group: clipped rather than hidden, and never loose in the root
- §2l Theme Values Are Read, Never Restated: the published constants, not their string values
- §2m Boxes, Centring and Clipping, in the Platform's Spelling: `aspect-ratio`, `place-items`, `scrollbar-color`, `line-clamp`
- §2n Colour, Density and Stacking, in the Platform's Spelling: `light-dark()`, `image-set()`, `isolation: isolate`
- §2o Logical Spacing: the inline-axis spellings, and the two positions that stay physical
- §2p Marketing Dials Only by a Written Brief: a route name or a hero-shaped draft is not a brief

---

## 1. Verify — the Obligations

### 1a. The Design Read

<!-- rule:forge-ui-design-read --> One line, no template, no ceremony: **who** the surface is for, **the one** primary action, and **what failure
looks like**. It is what decides which `tone` and `appearance` the primary control takes and which `tone` the failure path's `Alert` or `Toast`
renders.

> Design Read: returning admin scanning failed jobs; primary action is retry; failure is a job that retries and fails again — `tone='destructive'`
> `Alert` in place, row stays.

### 1b. Measure and Contrast

<!-- rule:forge-ui-measure-cap --> `max-w-prose`, or an explicit `max-w-*` when the container is not prose. Never full-bleed text — a paragraph in
an unbounded `Card.Content` is the common breach.

<!-- rule:forge-ui-contrast-floor --> Both themes, every time — a pairing that clears the floor on `--background` can fail on the dark value of the
same token. Verify the pair you actually shipped, not the token's light value.

### 1c. Status Is Never Colour Alone

<!-- rule:forge-ui-not-color-alone --> Pair the token with an `Icon` and with text. On a field, carry it with both `data-invalid` and
`aria-invalid`, and note that **two mechanisms emit them**: `FormField`'s `invalid` prop puts `data-invalid` on the `<fieldset>` (through
`stateAttrs`), while `aria-invalid` reaches the control only through its own `field` descriptor (`field={{ name, error }}`), which
`fieldControlProps` merges when the message is not blank. Setting the root's `invalid` alone styles the field and announces nothing. A red `Alert`
with no icon and no `Alert.Title` naming the failure is a color-only status.

### 1d. Focus Stays Visible

<!-- rule:forge-ui-focus-ring --> `focus-visible:ring-2 focus-visible:ring-ring` against the `--ring` token. `outline-none` without a replacement
ring is a removed affordance, not a style choice.

This is §1e applied to `outline-none`, and it keeps its own id.

### 1e. Every Suppressed Affordance Is Replaced

<!-- rule:forge-ui-affordance-replacement --> Each suppression utility deletes something the browser drew, and forge names what goes back in its
place.

- `appearance-none` on a `type='range'` leaves no track and no thumb — `Slider` redraws both as authored `::-webkit-slider-runnable-track` /
  `::-moz-range-track` and thumb rules in `forge-ui.css`, because no utility class reaches a UA pseudo-element.
- On a `<select>` it leaves no arrow — `Select` reserves `pe-10` and positions its own `aria-hidden` `chevron-down` `Icon`.
- On a checkbox or radio it leaves nothing to mark checked — and it also gives up the exemption 1.4.11 grants a control the author has not modified,
  so `CheckboxGroup` and `RadioGroup` replace _two_ things: the box, with an explicit `border-input` boundary and a `checked:bg-primary` fill, and
  the user's own palette, with the `@media (forced-colors: active)` block in `forge-ui.css` — without which a High Contrast reader gets two
  identically empty squares.
- `list-none` removes the markers that separated the items — a `Separator` or a deliberate `gap-*` takes over.
- `p-0` removes the box that made the target hittable — restore a size that clears `forge-ui-hit-target`.
- `border-0` removes the boundary — restore it with `border-input`, `border-border`, or a `Separator`.

A hidden `::marker` is the `<summary>` case: `Collapsible.Trigger` and `Accordion.Trigger` both set `list-none` to drop the UA disclosure triangle,
and both draw their own `chevron-down` `Icon` back in its place, rotating on its own `<details>`'s `[open]` through a direct-child selector, so a
nested disclosure reflects only its own state. Neither can forget it: the `icon` prop is required on both, so the replacement is supplied at every
call site or the build fails.

### 1f. Hit Target and Reduced Motion

<!-- rule:forge-ui-hit-target --> The floor is a number and not a token, so no shape file can lower it; every shipped shape's `sm` box clears it. A
control does not shrink below it to make a layout fit; the layout gives way. The target is the box a pointer activates — the element, or the
`<label>` that activates it, whichever is larger. A link inside a sentence is the one exception, as WCAG 2.5.8 grants it: its box is the line of
text it sits in.

<!-- rule:forge-ui-reduced-motion --> Applies to `motion-safe:` / `motion-reduce:` classes and to every declarative state transition — `starting:`,
`open:`, `not-open:`, `transition-discrete` — alike.

### 1g. The Designed Empty State

<!-- rule:forge-ui-empty-state --> An empty list is a state, not an absence: a line of text saying what would be here, and the action that fills it.
`Card.Content` holding a `<p class="text-muted-foreground">` plus a `tone='neutral' appearance='outline'` `Button` is the whole pattern.

### 1h. Accessible Names and Label Association

<!-- rule:forge-ui-accessible-name --> Via `Label`, via `FormField.Label`, via `Field`'s caption, or via visually-hidden text. An icon-only control
(`shape="icon"`) has no name until you give it one — `Icon` is `aria-hidden` by default.

- Wrong: `<Button shape="icon"><AppIcon name="close" /></Button>`
- Right: `<Button shape="icon" aria-label="Dismiss"><AppIcon name="close" /></Button>`

<!-- rule:forge-ui-a11y-label-association --> Either carry a `for` pointing at the control's id, or wrap the control in the label. A label that does
neither is styled text: clicking it moves no focus, and a screen reader reaching the control announces nothing.

- Wrong: `<label>Email</label><input name="email" />`
- Right: `<label for="email">Email</label><input id="email" name="email" />`

<!-- rule:forge-ui-media-alt-required --> With no `alt` a screen reader reads the file name out instead; an empty one tells it to skip the image,
which is right only when the image says nothing the text has not.

### 1i. Heading Order

<!-- rule:forge-ui-heading-order --> A title renders inside the level its section sits at; choosing a level for its type size is what produces the
skip. Size with a class, not with the tag. Where a compound owns the heading tag, `EmptyState.Title`, `Dialog.Title` and `Drawer.Title` take a
`level` prop that moves the tag and leaves the class alone — that is the prop to reach for when the section sits at a level other than the
compound's default.

### 1j. A Field's Error, at the Field

<!-- rule:forge-ui-form-error-inline --> `FormField.Error` renders a paragraph with the derived error id and no role; the first error of a failed
submission is announced for you.

<!-- rule:forge-ui-form-invalid-triple --> The first two come from **two different places**, and conflating them is the common bug: `FormField`'s
`invalid` prop puts `data-invalid` on the `<fieldset>` via `stateAttrs`, while `aria-invalid` reaches the control only via `fieldControlProps`. A
field marked `invalid` with a control that never went through `fieldControlProps` styles as invalid and announces nothing. The icon is yours to
place, and it is what satisfies `forge-ui-not-color-alone`.

### 1k. The Current Location, and the Way Out of a Drawer

<!-- rule:forge-ui-nav-current-in-page --> `Carousel.Dots` is the case that looks like the exception and is not: the dots are `Pagination` by
markup, but each is an anchor to a slide in the document already on screen, so they mark `location` as scroll-spy does while `Pagination` proper
keeps `page`. **A dots row is also not a landmark by default** — a landmark promises the reader that jumping there reaches the site's navigation,
and a picker belonging to one widget does not; it renders `role="group"` with its label, so two carousels on a page add two groups and no navigation
regions. `Carousel.Dots` takes `landmark` for a consumer whose row genuinely is the page's navigation.

<!-- rule:forge-ui-nav-drawer-dismiss --> The backdrop serves a pointer, Escape a keyboard, the toggle a page with JavaScript off, and a link the
reader leaving for a destination, so a drawer missing one traps whoever reached for it.

<!-- rule:forge-ui-nav-drawer-glyphs --> The props select the glyph, so a rail drawer's `icon` must supply `panel-open` and `panel-close`.

---

## 2. Refuse — the Prohibitions

### 2a. Colour Tokens, Never Literals

<!-- rule:forge-ui-color-token-only --> No `#hex`, no `rgb()`, no `hsl()`, no `oklch()`. Use the semantic tokens `theme-base.css` declares —
`--background`, `--card`, `--primary`, `--muted`, `--border`, `--ring` and the rest, each surface with its `*-foreground` partner — plus the
`--status-*` roles, each intent crossed with a `-subtle`, `-strong` or `-border` role, which is how a status surface gets a fixed hue without a
fixed value.

Each of them resolves through a numbered step of the scale — `--gray-1` … `--gray-12`, their alpha siblings, and the fixed status hues — and each
step holds one literal value covering both modes, declared by `theme-neutral.css` (or whichever scheme file is imported after it) and, for the hues,
`theme-colors.css`. `theme-base.css` holds the mapping, the `color-scheme` that picks each step's mode, and no colour values at all. That is what
makes a theme swap a one-file change, and what makes a _per-mode_ change an edit to the step rather than to the token.

A Tailwind palette utility is permitted **only paired with its own `dark:` counterpart**, and only for a hue no forge token covers. A bare
`bg-red-50` is not a literal, but it fails for the same reason one is banned: it survives the theme switch, and becomes a near-white rectangle on a
dark page. For the status intents there is nothing left to reach for it with — that case is `--status-*`, per
`forge-ui-color-semantic-variant-fixed` in `reference/04-color.md`.

- Wrong: `class="bg-[#0f172a] text-[#e2e8f0]"`
- Wrong: `class="bg-red-50 text-red-900"` — no dark half, so it inverts under `.dark`
- Wrong: `class="bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"` — a hand-assembled status panel; the tokens exist
- Right: `class="bg-card text-card-foreground"`
- Right: `class="bg-status-danger-subtle text-status-danger-subtle-foreground"` — a fixed status hue, themed in both modes

### 2b. No Inline Style, and No Restated Base Classes

<!-- rule:forge-ui-no-inline-style --> Forge's SSR renderer drops it. Nothing errors, nothing warns, and the styling is simply gone from the emitted
HTML — the most expensive failure mode there is.

<!-- rule:forge-ui-class-no-restate --> Pass only the difference through `class`. A forge component composes its classes through `cn`, which keeps
the last utility to claim a concern, and the caller's `class` is always the last argument — so one utility is enough to win, and the copied ones are
dead the moment the component's own defaults move. Restating them also hides which utility you meant to change.

- Wrong: `<Button class="inline-flex h-control-md items-center rounded-field px-8 text-sm">` — the whole base, copied, to widen the padding
- Right: `<Button class="px-8">` — the one utility that differs; the rest still comes from `Button`

### 2c. The Spacing Scale, and Viewport Units

<!-- rule:forge-ui-spacing-scale-only --> Never an arbitrary value where a scale value exists. The scale's steps differ by at least 25%, which is
what makes two different gaps read as deliberate rather than as a mistake.

- Wrong: `class="p-[8px] gap-[12px]"` — both are steps the scale already states
- Right: `class="p-2 gap-3"`

<!-- rule:forge-ui-no-h-screen --> Mobile browser chrome makes `100vh` taller than the visible viewport, so the bottom of the layout sits under the
URL bar. Use `min-h-dvh`.

### 2d. No Nested Card

<!-- rule:forge-ui-no-nested-card --> Two borders and two elevations that encode nothing. Separate the inner regions with `Separator`, or promote
them to siblings of the outer `Card`.

### 2e. Foreground Pairing

<!-- rule:forge-ui-foreground-pairing --> `bg-card` with `text-card-foreground`, `bg-status-danger-subtle` with
`text-status-danger-subtle-foreground`, and so on for every surface and status tier. Never `text-white/70` on a colored surface — an
opacity guess is how a pairing quietly drops under `forge-ui-contrast-floor`. `--destructive` reads three ways — as a fill, as a border and as text
— and each takes its own token: the fill its foreground partner, a border `border-destructive`, and text `text-destructive-text`.

Pair within a tier, never across one: a `-strong` surface takes the `-strong-foreground`. `Alert`, `Toast` and `Badge` hold the right pair inside
each tone, so passing a `tone` is the shorter route.

<!-- rule:forge-ui-color-semantic-destructive-pair --> `--destructive` is held across modes so that its own foreground clears it in both, which no
hand-picked one was measured to do; and a held dark red set as text is unreadable on a dark page, so text has a token of its own.

### 2f. A Text-Colour Budget and One Radius

<!-- rule:forge-ui-text-color-budget --> `text-foreground` for the primary line, `text-muted-foreground` for everything supporting. A third is a
hierarchy you are asserting with color that weight, size, or spacing should carry instead.

<!-- rule:forge-ui-one-radius --> `--radius`, with `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` computed from it. No per-component
radius override, and never square corners next to round ones on one surface.

### 2g. Icons from the Sprite

<!-- rule:forge-ui-real-icons --> `Icon` or a `createIcon` binding from `@y-core/forge/ui/core`, typed `ForgeIcon<Name>`. Never an emoji, never a
hand-rolled inline `<svg>`. Forge's own glyphs are enumerated by `FORGE_UI_ICON_NAMES` in `@y-core/forge/ui/assets/glyphs`; an app sprite extends
that set through the same factory.

```tsx
import { createIcon } from "@y-core/forge/ui/core";
const AppIcon = createIcon("/assets/icons.svg");
```

### 2h. Never Invent Data

<!-- rule:forge-ui-no-fabricated-data --> No metrics, no testimonials, no placeholder identities — not "John Doe", not "Acme Inc", not "+312%".
Render the real value, or render the empty state that `forge-ui-empty-state` requires.

### 2i. Forge's Control, Never the Raw Element

<!-- rule:forge-ui-catalog-wrong-raw-input --> The label, the id, the error and the focus ring are not free.

<!-- rule:forge-ui-catalog-wrong-unbound-input --> The `ui/core` base has no `bind` prop, so the signal has nothing to attach to.

<!-- rule:forge-ui-form-otp-one-field --> `OtpInput` paints the cells; paste, autofill and the mobile keyboard work because there is one field, and
the server validates it with `v.pipe(formDigits(), v.length(6))`. A per-cell array assembles its value client-side, which is exactly the value a
no-script render loses.

### 2j. A Control Chosen for What It Claims

<!-- rule:forge-ui-form-toggle-by-submission --> A `Switch` is a setting that is on or off, and it is announced as a switch. A `Toggle` is a mode
the reader presses, and it is announced as a checkbox. Reaching for the wrong one does not lose the value — both carry a `name` and both submit — it
tells the reader the wrong thing about what they are changing. The distinction is what the elements announce.

<!-- rule:forge-ui-state-progress-determinate --> Give it a `label`, which becomes its `aria-label`. An indeterminate progress bar is a spinner
drawn as a lie about measurability.

### 2k. Filter Chips Stay in Their Group

<!-- rule:forge-ui-interaction-filter-collapses --> The unchosen chips stay in the radio group, so arrow keys move and check as APG describes, and
the checked chip is always the one left standing beside the clear. A reader on it is told it is one of N, not that it is the only choice there is,
and a focused chip is never clipped. A pointer user reaches a second facet through `×`, which empties the group and puts focus on its first chip.
**The role is on `Filter.Group` and never on the `Filter` root**, which stays the `<form>` or `<fieldset>` that owns the reset: a `radiogroup` may
own no child but a `radio`, so a reset inside it is an `aria-required-children` violation in a consumer's axe run. Give both components a name — the
type requires `label` or `labelledby` on a `Filter.Group` — and keep the clear reachable, never hidden from the keyboard while a facet is chosen.

<!-- rule:forge-ui-interaction-filter-group-required --> The root carries no role, so chips it holds itself are loose radios named by nothing —
strictly worse for a reader than a named group, and silent: the type cannot require a child, and deleting the `label` the root does not take is the
shortest edit past the compile error a consumer upgrading meets. A lint rule is what makes the omission loud, because nothing in the rendered markup
is missing so much as wrong.

### 2l. Theme Values Are Read, Never Restated

<!-- rule:forge-ui-nav-theme-constants --> A hand-written `"dark"` in an app's own `@custom-variant` is a second writer of `DARK_CLASS` in a
repository forge's gate cannot see.

### 2m. Boxes, Centring and Clipping, in the Platform's Spelling

<!-- rule:forge-ui-platform-aspect-ratio --> The percentage-padding idiom exists because `aspect-ratio` did not. `Avatar.Image` is the shipped form
of the same intent — `aspect-square size-full object-cover` inside a clipping root — and `forge-ui-media-fixed-crop` in [`15-media.md`][media] is
where an uncontrolled image is sent for the same reason. Confirm one thing before rewriting: a percentage padding resolves against the element's
**inline** size in every case, so a ratio you derived from a block-axis measurement is not the box you are about to declare.

<!-- rule:forge-ui-platform-centering --> The rule moves from the child to the container, and that is the part to check rather than the syntax: a
child positioned against a containing block other than that container — a popup in the top layer, an element inside a transformed ancestor — was
being centred against something else, and changes box when the declaration moves. Forge's own centred slots are containers already, as the
`flex items-center justify-center` enclosure in `forge-ui-media-icon-enclosure` is.

<!-- rule:forge-ui-platform-scrollbar --> `ScrollArea.Viewport` is the reference: it carries `[scrollbar-width:thin]` and a `scrollbar-color`
resolved from `--color-border`, which is a token, so the scrollbar moves with the theme. The two standard properties colour and thin the bar; they
cannot resize or reshape its parts the way the pseudo-elements could, so a design that redrew the thumb is a design to drop rather than to port.

<!-- rule:forge-ui-platform-line-clamp --> The prefixed pair only works under `display: -webkit-box`, which is a different box type from the one the
surrounding layout assumed — that is what changes when the standard property replaces it, and it is usually a `flex` or `block` box coming back. A
clamped `Card.Description` is the common site.

### 2n. Colour, Density and Stacking, in the Platform's Spelling

<!-- rule:forge-ui-platform-light-dark --> A second declaration of one selector is two places to edit, and the second one is the one that gets
missed. Forge's own scheme files already hold both modes in one place: each `--gray-*` step carries one value covering both, and `theme-base.css`
holds the `color-scheme` that picks between them. That is the constraint to verify — `light-dark()` reads `color-scheme` rather than the media
query, so the element must sit under a declared scheme for the function to resolve at all.

<!-- rule:forge-ui-platform-image-set --> Read the query before rewriting it: a density query is sometimes carrying **art direction** — a different
crop, not a denser one — and `image-set()` has no way to say that. If the two sources differ in what they show rather than in how many pixels they
show it with, the query was doing a second job and the rewrite loses it.

<!-- rule:forge-ui-platform-isolation --> A negative `z-index` does not put an element behind its sibling; it puts it behind its parent's
background, and it escapes the parent's paint order entirely to do it. Forge's overlay layers all sit at `z-50` — `Popover.Content`, `Menu`,
`Tooltip`, `Toast` — precisely so that the ordering is positive and local. The one case to look at before rewriting is a decorative layer that was
_deliberately_ painting behind an ancestor's background; isolating it brings it forward.

### 2o. Logical Spacing

<!-- rule:forge-ui-platform-logical-spacing --> `ms-` and `me-` for `ml-` and `mr-`, `ps-` and `pe-` for `pl-` and `pr-`, `border-s` and `border-e`,
`rounded-s` and `rounded-e`, `text-start` and `text-end`; in a stylesheet, `margin-inline-start`, `padding-inline-end` and the `inset-inline-*` pair
for a bare `left` or `right`. The block axis is not the subject — `margin-top` and `margin-block-start` name the same edge in the writing modes
forge ships, so rewriting one changes nothing. Mirroring is the whole point, and forge already mirrors: `mountRovingFocus` reads direction from the
element, so an RTL island navigates as RTL, and a physical margin beside it is the one thing that does not turn around.

Some positions are physical on purpose and stay physical: an inset resolved with `anchor()` has no inline-axis spelling at all — `anchor()` takes a
physical side — and a rule already mirrored by a `:dir()` selector would mirror twice if its margin mirrored too. Both are stated at the line rather
than left to be inferred.

### 2p. Marketing Dials Only by a Written Brief

<!-- rule:forge-ui-marketing-brief-required --> `reference/13-marketing.md` is a standing case for a written brief, and inference is how a surface
gets that case without one: a route named `/launch` or a draft with a hero in it moves every dial of `reference/12-density.md` on a page whose
reader came to finish a task.

[media]: ./reference/15-media.md
