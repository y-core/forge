# Interaction

Focus, keyboard, control state, and motion. Everything here is Tier 2 — a written brief may rebut
any of it. The Floor rules it leans on (`forge-ui-focus-ring`, `forge-ui-hit-target`,
`forge-ui-reduced-motion`) may not be rebutted at all; see [`../floor.md`](../floor.md).

The through-line: **forge already implements the interaction models.** Almost every rule below is
"call the controller forge ships" rather than "write this behaviour". A hand-written key handler is
not merely more code, it is a *second* model of what an arrow key means, on a page that already has
one.

---

## Focus

Default: draw focus with `focus-visible:ring-2 focus-visible:ring-ring`, and reach for no other
treatment — one ring, one token, app-wide — unless a brief specifies a distinct focus style for a
named surface. <!-- rule:forge-ui-interaction-ring-token -->
The ring colour is `--ring`, declared once in `src/ui/assets/css/theme-base.css` and resolving
through `--gray-11` — the scheme file supplies that step's value per mode, so the same class is
legible on both without the token itself knowing which mode it is in. It is a **solid step in both
modes**, one step beyond `--input`: an earlier revision made the light value a 50%-alpha `color-mix`, which
composites against whatever is behind it and measured below the very border it was meant to replace.
A focus indicator is non-text contrast under WCAG 1.4.11 and has a 3:1 floor of its own, so it
cannot be expressed as a tint. Visibility itself is the Floor (`forge-ui-focus-ring`); this rule is
about not inventing a second treatment beside it.

Default: use the `focus-visible` variant, never bare `focus` — unless the control is reachable
*only* by pointer, which in practice never happens. <!-- rule:forge-ui-interaction-focus-visible -->
`focus` fires on a mouse click too, so a ring flashes on every button press and trains the reader to
ignore it. `focus-visible` is the browser's own judgement about whether the user is navigating by
keyboard, and it is a better judgement than any heuristic written at the call site.

Default: fix an undersized target by moving up the `buttonVariants` size scale, never by adding
padding to a smaller one — unless the control is not a button at all and the brief names its
box. <!-- rule:forge-ui-interaction-size-from-button -->
`sm` (`h-8`) is the Floor (`forge-ui-hit-target`). Which size an icon-only control takes is
[`01-hierarchy.md`](./01-hierarchy.md)'s (`forge-ui-hierarchy-icon-button-size`), and how the scale
shifts under density is [`12-density.md`](./12-density.md)'s (`forge-ui-density-button-size`); this
rule is only about the remedy. Ad-hoc padding produces a row of controls whose boxes disagree by two
or three pixels each — visible as a ragged edge, and untraceable to any one line.

```tsx
// Wrong — a hand-built box that is neither on the scale nor the same height as its neighbours.
<button class="rounded-md px-2.5 py-1.5 text-sm focus:outline-none">Retry</button>

// Costs: a ragged control row, a focus ring that flashes on mouse clicks, and a target under the floor.

// Right.
<Button variant="secondary" size="sm">Retry</Button>
```

---

## Keyboard

Forge ships the composite keyboard models. The rule is to adopt them, and the reason is not effort —
it is that two models on one page make arrow keys mean two different things depending on where the
reader happens to be.

Default: give a composite widget its keyboard with `mountRovingFocus`, not a `keydown` handler —
unless the widget is a single control with one key binding that no composite pattern
describes. <!-- rule:forge-ui-interaction-adopt-composite -->
It takes `{ items, orientation?, loop?, typeahead?, typeaheadTimeout? }`, resolves items live from
the DOM on every interaction, skips disabled items, reads direction from the element so an RTL
island navigates as RTL, and returns a disposer.

Default: mark the item that should hold the tab stop at mount with `ACTIVE_COMPOSITE_ITEM` from
`@y-core/forge/ui/contracts` — unless nothing in the composite is selected on first render, in which
case the first item takes it. <!-- rule:forge-ui-interaction-active-item -->
The pressed tool, the selected tab, the checked radio. Without it a composite that shows a selection
puts the tab stop somewhere else, and the first Tab press moves focus to a row that is not the one
highlighted.

Default: use `mountActiveDescendant` for a listbox-shaped control — a combobox, an autocomplete, a
filter field over a result list — rather than `mountRovingFocus` — unless real focus genuinely
belongs on the option. <!-- rule:forge-ui-interaction-activedescendant -->
The discriminator is where focus lives during the interaction. In a listbox-shaped control the user
is typing, so focus stays in the field and `aria-activedescendant` names the current option;
`mountRovingFocus` would call `item.focus()` and take focus out of the field the pattern is defined
by keeping it in. `resetActiveDescendant` clears the pointer when the list is rebuilt.

Default: mount the shipped controller for a shipped component — `mountTabs`, `mountMenu`,
`mountTooltip` — rather than re-deriving its key handling — unless the markup sits somewhere
`resume()` cannot reach, such as inside a shadow root, where you call the controller
directly. <!-- rule:forge-ui-interaction-named-controllers -->
Under `@y-core/forge/ui/core/client` these are already registered as scopes, so the usual correct
amount of code is the side-effect import and nothing else.

```tsx
// Wrong — a bare row of buttons, with arrow keys wired up by a hand-written listener elsewhere.
<div class="flex gap-1" data-ref="tool-row">
  {tools.map((t) => <button type="button" class="…">{t.label}</button>)}
</div>

// Costs: two arrow-key models in one document; no typeahead, no Home/End, no disabled-skip, no RTL.

// Right — the shipped composite, with the initial tab stop declared.
import { Toolbar } from "@y-core/forge/ui/core";
import { ACTIVE_COMPOSITE_ITEM } from "@y-core/forge/ui/contracts";

<Toolbar aria-label="Tools">
  {tools.map((t) => (
    <Toolbar.Button {...(t.id === activeTool ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {})}>
      {t.label}
    </Toolbar.Button>
  ))}
</Toolbar>
```

---

## Disabled, read-only, hidden

Three ways to withhold a control, and they communicate three different things. Choosing by
convenience is how a reader ends up staring at a greyed button with no way to learn why.

| The situation | Use | What the reader learns |
|---|---|---|
| The action is unavailable *right now*, and something the reader can do would change that | enabled control + inline explanation, or `Alert` on attempt | what to do next |
| The action is unavailable and nothing the reader does changes it in this view | `disabled` + adjacent text | that it exists, and that it is not for them here |
| The value is real and worth reading, but not editable | `readonly` on the control | the value, and that it is settled |
| The reader has no permission for this capability at all | omit it | nothing — correctly |
| The control is mid-flight on a request | `hx-disabled-elt` (see [`11-htmx.md`](./11-htmx.md)) | that the request is running |

Default: prefer an enabled control that explains its refusal over a disabled one that does not —
unless the reason is visible within one glance of the control. <!-- rule:forge-ui-interaction-disabled-last -->
A disabled `Button` has no hover, no focus, and no accessible way to ask why; it is the one control
state that cannot answer a question about itself.

Default: express "displayed but not editable" as `readonly`, never as `disabled` — unless the value
should also be excluded from form submission, which is what `disabled` additionally
does. <!-- rule:forge-ui-interaction-readonly-not-disabled -->
A `readonly` input stays focusable, stays selectable and stays copyable, and it still submits.

Default: hide a control only when the reader could never use it — never to express a transient
state — unless the brief calls for progressive disclosure of an advanced
group. <!-- rule:forge-ui-interaction-hide-vs-disable -->
A control that disappears and reappears as state changes makes the layout jump and gives the reader
nothing to reason about.

Default: never make hover the only route to an action — unless the action is a genuine duplicate of
one that is permanently visible. <!-- rule:forge-ui-interaction-hover-not-required -->
Touch has no hover, and a keyboard user reaches a hover-revealed row action only if it is also
revealed by `focus-within`.

---

## Motion

Forge's ratified motion dial is 3 of 10 ([`UI_DESIGN_GUIDANCE.md`](../../../../.decisions/UI_DESIGN_GUIDANCE.md) §8).
That setting is what the rules below encode: movement that reads as the interface *responding*, and
never as the interface performing.

Default: author one motion moment per interaction — unless a brief raises the motion dial for a
named marketing surface. <!-- rule:forge-ui-interaction-one-moment -->
A dialog that fades its backdrop, scales its panel, and slides its title is three moments where one
was asked for, and the reader waits for all three. *Which* changes may carry motion at all is
[`12-density.md`](./12-density.md)'s (`forge-ui-density-motion-budget`); this rule bounds how much
motion any one of them gets.

Default: express entry and exit through `mountTransitionState` and style them off
`data-starting-style` / `data-ending-style` — unless the element is not a native popover or
`<dialog>`, in which case a plain `transition-*` class on the element is correct. <!-- rule:forge-ui-interaction-transition-controller -->
The controller observes the platform's own state events and publishes the four attributes; it never
calls `showPopover` or `close()`, so dismissal stays the platform's. `Popover` and `Dialog` emit
their initial state attribute in SSR markup and contain no animation branch at all.

Default: give a trigger its open-state feedback with `mountPopupTriggerState` and a
`data-popup-open` selector, rather than a second listener on the trigger — unless the trigger is not
an invoker of the popup. <!-- rule:forge-ui-interaction-trigger-state -->
`STATE_ATTRS` is the register of every state attribute forge emits, and every one of them is a
presence flag with an empty value — select `[data-popup-open]`, never `[data-popup-open="true"]`.

Default: keep an enter under 200ms and an exit shorter than its enter — roughly 120–200ms in,
80–150ms out — unless a brief specifies a slower deliberate reveal. <!-- rule:forge-ui-interaction-duration -->
Exit is shorter because the reader has already decided; the only thing a slow exit adds is time
between the decision and the next action.

Default: animate `transform` and `opacity` only — unless the moment is a disclosure whose whole
point is the height change, as in `Collapsible` and `Accordion`. <!-- rule:forge-ui-interaction-no-motion-on-layout -->
Animating `height`, `width` or `top` reflows every frame, and on a fragment-swapped page it reflows
content the reader may be mid-click on.

Every authored moment is subject to `forge-ui-reduced-motion`, which is Floor: gate it behind
`motion-safe:` and give `motion-reduce:` the instant state. That includes anything driven by
`mountTransitionState` or `mountPopupTriggerState`.

```tsx
// Wrong — three simultaneous moments, an unbounded duration, and no reduced-motion path.
<Dialog class="transition-all duration-700 data-[starting-style]:scale-50 data-[starting-style]:opacity-0 data-[starting-style]:translate-y-8">
  <p class="text-sm">Delete this workspace?</p>
</Dialog>

// Costs: a modal that takes most of a second to become usable, and one that never stops moving for
// a reader who asked the OS for less motion.

// Right — one moment, response-length, opt-in.
<Dialog class="motion-safe:transition-opacity motion-safe:duration-150 motion-safe:data-[starting-style]:opacity-0">
  <p class="text-sm">Delete this workspace?</p>
</Dialog>
```
