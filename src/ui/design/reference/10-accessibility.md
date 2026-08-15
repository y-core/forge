# Accessibility

Accessibility is a design input, not a retrofit. Almost nothing on this page can be added at the
end: contrast is decided when the token pair is chosen, an accessible name is decided when the
control's label is or is not drawn, and heading order is decided when the page is laid out. Work
that reaches review without these has to be re-designed, not annotated.

Everything here is Tier 2. The Floor it rests on — `forge-ui-contrast-floor`,
`forge-ui-not-color-alone`, `forge-ui-accessible-name`, `forge-ui-heading-order`,
`forge-ui-focus-ring`, `forge-ui-hit-target`, `forge-ui-reduced-motion` — is in
[`../floor.md`](../floor.md) and is not rebuttable.

---

## Contrast, per theme

`forge-ui-contrast-floor` is the Floor: 4.5:1 for body text, 3:1 for large text and UI boundaries,
in **both** `:root` and `.dark`.

**The token-level rules that follow from it are owned by [`04-color.md`](./04-color.md) and are not
restated here** — that a pair is verified in both modes for every theme the app ships
(`forge-ui-color-theme-both-modes`), that `--muted-foreground` on `--muted` is the pair with the
least headroom and is audited explicitly (`forge-ui-color-theme-muted-pair`), and that a new theme
file is audited rather than assumed (`forge-ui-color-theme-per-theme-audit`).

What belongs here is the sequencing: those are decisions taken *while choosing the pair*, and a
surface composed without them is re-designed rather than repaired. The example below is what the
failure looks like when contrast and `forge-ui-not-color-alone` are both deferred.

```tsx
// Wrong — two damped values against each other, and status carried by colour alone.
<div class="rounded-md bg-muted p-4">
  <p class="text-muted-foreground">Sync failed</p>
</div>

// Costs: a line that is hard to read in one theme and unreadable in the other, and a failure a
// colour-blind reader never sees as a failure.

// Right — a pairing designed to be read, with the state carried by shape and words too.
<Alert variant="destructive">
  <AppIcon name="close" aria-hidden="true" />
  <Alert.Title>Sync failed</Alert.Title>
  <Alert.Description class="max-w-prose">Last attempt was rejected by the upstream API.</Alert.Description>
</Alert>
```

---

## ARIA alongside data attributes, never instead of

This is the section most specific to forge, and the mistake it names is invisible in a screenshot.

Forge publishes state twice, on purpose. `stateAttrs` (SSR) and `applyStateAttrs` (browser) write
the `data-*` attributes registered in `STATE_ATTRS` — `data-pressed`, `data-selected`, `data-checked`,
`data-invalid` and the rest — and those drive **styling and the client runtime**. The ARIA attribute
beside them drives **assistive technology**. They are not alternatives, and neither substitutes.

**A `data-state` with no ARIA counterpart styles perfectly and announces nothing.** The component
looks right in every review that is conducted by looking.

| What you are expressing | The styling hook | The ARIA counterpart |
|---|---|---|
| A disclosure or popup is open | the native state — `[open]` on `<details>` / `<dialog>`, `:popover-open` on a popover | the platform's own, since `<summary>` and an invoker button both carry it |
| A toggle is pressed | `data-pressed` | `aria-pressed` |
| A tab is the current one | `data-selected` | `aria-selected` |
| A checkable control is checked | `data-checked` | `aria-checked`, or the native `checked` |
| A field holds an error | `data-invalid` | `aria-invalid` plus `aria-describedby` |
| A control is inert but discoverable | `data-disabled` | `aria-disabled` |

Default: emit both halves for every state you express, and emit the `data-*` half through
`stateAttrs` or `applyStateAttrs` rather than by writing the attribute name — unless the element is
purely decorative and carries no state a reader can act on. <!-- rule:forge-ui-a11y-aria-beside-data -->

Default: read state in CSS from the `data-*` attribute, not from the `aria-*` one — unless no
`data-*` exists for that state, in which case add it to `STATE_ATTRS` first. <!-- rule:forge-ui-a11y-state-attrs-source -->
Boolean `data-*` states are presence flags with an empty value, so the selector is `[data-pressed]`;
`aria-*` keeps its `"true"` / `"false"` string form because WAI-ARIA requires it. Selecting on ARIA
is what eventually produces an element whose styling and whose announcement disagree.

---

## Names

Default: name a control with a visible `Label` or `FormField.Label` — unless the design genuinely
has no room for a visible label, in which case see the screen-reader-only rule
below. <!-- rule:forge-ui-a11y-label-element -->
A visible label is reviewable by anyone who can see the page. An `aria-label` is reviewable only by
someone who reads the source or runs a screen reader, which is why it drifts.

Field id and `aria-describedby` wiring is owned by [`06-forms.md`](./06-forms.md) —
`forge-ui-form-id-helpers` for deriving ids through `fieldId` / `fieldDescriptionId` /
`fieldErrorId` / `fieldDescribedBy` rather than as literals, and `forge-ui-form-control-props` for
passing a `field` descriptor. The accessibility reason those rules exist is worth carrying in mind
while composing: the helpers return `undefined` when nothing that could be described actually
renders, so the markup never carries a dangling IDREF — which assistive technology treats as an
error rather than ignoring.

```tsx
// Wrong — a placeholder standing in for a label, and an error reference invented by hand.
<Input name="email" placeholder="Email address" aria-describedby="email-error" />

// Costs: the name disappears the moment the reader types, and the reference points at whatever
// happens to own that id today.

// Right.
<FormField name="email" invalid={Boolean(errors.email)}>
  <FormField.Label name="email">Email address</FormField.Label>
  <Input name="email" type="email" field={{ name: "email", invalid: Boolean(errors.email) }} />
  <FormField.Error name="email">{errors.email}</FormField.Error>
</FormField>
```

Default: when a control genuinely has no visible text — an icon-only `Button size="icon"` — pair a
decorative `Icon` with visually-hidden text rather than an `aria-label`, wherever the layout allows
it — unless the sr-only span would be read twice because the control already has a
name. <!-- rule:forge-ui-a11y-icon-plus-text -->
`Icon` is `aria-hidden` by default, so it contributes nothing to the name; the `sr-only` span is
real text that a reviewer can see in the source next to what it names, and that survives
translation the way an attribute value tends not to. `Spinner` is the shipped example of the
pattern: `role="status"` on the wrapper, `aria-hidden` on the glyph, and an `sr-only` label.
`forge-ui-accessible-name` is the Floor here; this is only the preferred way of meeting it.

Default: keep the required marker decorative and carry requiredness on the control — unless the form
has no visual required convention at all. <!-- rule:forge-ui-a11y-required-marker -->
`Label`'s `required` prop renders an `aria-hidden` asterisk; the `required` attribute on the input
is what is actually announced.

Default: never put `aria-readonly` on a `<button>` or a `role="button"` element — carry the state on
the control the button acts on, or use `disabled` — unless the element's role genuinely supports it.
<!-- rule:forge-ui-a11y-no-aria-readonly-on-button -->
`aria-readonly` is not a supported attribute of `role="button"`, so a validator flags it and no
assistive technology acts on it. `NumberField`'s steppers are where the mistake looks most
plausible — a `readonly` input beside two buttons — and forge deliberately leaves them bare, letting
the input's own `readonly` carry the state.

---

## Heading order

`forge-ui-heading-order` is the Floor: never skip a level.

Default: choose the heading level from the section's position in the document and set its size with
a class — unless the component's own compound already fixes the tag, as `Card.Title`
does. <!-- rule:forge-ui-a11y-heading-size-by-class -->
The skip almost always arrives the same way: a designer wants smaller text, so the `<h2>` becomes an
`<h4>`. Size and level are independent, and `text-sm font-medium` on an `<h3>` gets both right.

---

## Motion and live regions

Default: author motion inside `motion-safe:` and give `motion-reduce:` the settled state, rather
than treating reduced motion as a later pass — unless the movement conveys information that has no
static equivalent. <!-- rule:forge-ui-a11y-reduced-motion-pair -->
`forge-ui-reduced-motion` is the Floor; this is where in the process it gets satisfied. Durations and
the one-moment budget are [`09-interaction.md`](./09-interaction.md)'s.

Default: route transient announcements into the existing flash region and add no live region of your
own — unless the surface has a genuinely separate stream of updates that must not interleave with
notifications. <!-- rule:forge-ui-a11y-one-live-region -->
`Toast.Container` already renders `aria-live="polite"` with `aria-label="Notifications"`, and
`FlashContainer` is that container at the well-known id `#flash-container`. Each `Toast` inside it is
`role="status"` with `aria-atomic="true"`, so the message is announced whole. A second live region on
the page means two announcers competing over one utterance queue, and the reader hears fragments of
both.

Default: leave a live region polite — unless the message is a failure that stops the reader's current
task, which is the only case that earns an interruption. <!-- rule:forge-ui-a11y-live-politeness -->

Default: pair a `Skeleton` region with one announcement, because `Skeleton` renders
`aria-hidden="true"` and is silent by design — unless the wait is short enough that nothing needs to
be announced. <!-- rule:forge-ui-a11y-spinner-announces -->
Which placeholder a wait takes is [`07-states.md`](./07-states.md)'s
(`forge-ui-state-skeleton-shape`, `forge-ui-state-spinner-scope`, `forge-ui-state-one-indicator`);
what this rule adds is that a skeleton-only region announces nothing at all. A region that swaps
under the reader carries `aria-busy` while it is in flight, and a `Spinner`'s `sr-only` `label` is
the utterance — so give it a real one rather than the `Loading…` default.

```tsx
// Wrong — a shimmering block and nothing at all for a reader who cannot see it shimmer.
<div class="space-y-2"><Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-2/3" /></div>

// Costs: sighted readers know the content is coming; everyone else hears silence and then, later,
// content that appeared from nowhere.

// Right — the visual placeholder keeps its shape, and one announcement carries the wait.
<div aria-busy="true">
  <Spinner icon={AppIcon} size="sm" label="Loading activity" />
  <div class="mt-2 space-y-2" aria-hidden="true">
    <Skeleton class="h-4 w-full" />
    <Skeleton class="h-4 w-2/3" />
  </div>
</div>
```
