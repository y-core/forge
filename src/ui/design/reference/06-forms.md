---
title: Forms
description: "Labels, help text, validation timing and error placement — what a form owes the person filling it in."
---

# Forms

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules cited below are not.

A form is where craft is easily skipped, because every part of it already works: an unlabelled input still submits. The rules below are about the
parts that do not announce their absence.

---

## 0. Quick Reference

- §1 Which field primitive: `FormField`, `Field`, the group primitives and `OtpInput`, and what separates them
- §2 `Toggle`, `Switch` and `ToggleGroup`: the two-state controls, picked by what the value means
- §3 Never hand-write the wiring: the id helpers, the `field` descriptor, and when a `scope` is owed
- §3a Before / after: a dangling IDREF from hand-written ids, against one derived `name`
- §4 `ui/core` bases versus `ui/controls` bound variants: which barrel a control comes from, and why never both
- §5 Error UX: where the message renders, when validation runs, and the invalid triple
- §6 Form-level composition: challenge placement, one primary, and which set to mark

---

## 1. Which field primitive

These primitives look interchangeable and are not.

| Given | Choose | Why |
| --- | --- | --- |
| A control that is validated, can be wrong, and has a server-side `name` | `FormField` | A `<fieldset>` whose members and the control's `field` descriptor derive `id` / `for` / `aria-describedby` / `aria-invalid` from one shared `name` |
| A settings row — a labelled control with no validation and no error | `Field` | A layout row whose caption names the one control it wraps through `aria-labelledby`; no fieldset and no error slot |
| Several checkboxes or radios answering one question | `CheckboxGroup` / `RadioGroup` | Real `<input type="checkbox">` / `<input type="radio">`; radio grouping and roving focus are the platform's |
| A one-time code the reader types or pastes | `OtpInput` inside `FormField` | One `<input autocomplete="one-time-code">` painted as cells; the value is the platform's, not assembled |
| A `<label>` you place yourself, beside a control you have already wired | `Label` | A real `<label for>` with a `required` marker and nothing else — no row, no fieldset, no id derivation |

<!-- rule:forge-ui-form-formfield-default --> `Field` is not a lighter `FormField`; it has no error slot, so choosing it for a validated control
means the error has nowhere to render.

<!-- rule:forge-ui-form-bare-label --> `Label` is the one primitive that wires nothing — its `for` is yours to get right — and `Field` and
`FormField` each replace it, so reaching for `Label` inside either is two labels for one control.

<!-- rule:forge-ui-form-group-primitive --> Both accept `name`, `scope`, `description`, `error`, `disabled` and `orientation`, and expose `.Label`,
`.Item`, `.Description` and `.Error`.

<!-- rule:forge-ui-form-legend-variant --> `legend` renders at `text-base`, `label` at `text-sm` — a section heading versus a field label. Choosing
by size instead of by role is what produces a legend that outranks the form's own heading.

A one-time code is one field: `forge-ui-form-otp-one-field`, in `floor.md`.

## 2. `Toggle`, `Switch` and `ToggleGroup`

Two-state controls, and all of them submit — what separates them is what the value means.

| Given | Choose | What it renders |
| --- | --- | --- |
| An on/off setting | `Switch` | `<input type="checkbox" role="switch">` — it has a `name` and a value |
| A mode the reader presses on and off | `Toggle` | A `<label>` around a native checkbox, styled through `:has(:checked)` |
| One choice out of a small visible set | `ToggleGroup` | A `<fieldset>` of pressed buttons; `type` picks single or multiple |

Which of them a value takes is Floor: `forge-ui-form-toggle-by-submission`, in `floor.md`.

<!-- rule:forge-ui-form-filter-when --> `Filter` is a different shape: a row of chips where choosing one hides the others and shows a reset, so the
narrowed facet stays visible and clearable.

---

## 3. Never hand-write the wiring

<!-- rule:forge-ui-form-id-helpers --> Forge exports the id derivation as functions precisely so two places cannot disagree about an id. A
hand-written `for="email"` beside an `id="field-email"` is silent: nothing errors, nothing warns, and clicking the label stops focusing the control.
Each helper — `fieldId`, `fieldDescriptionId`, `fieldErrorId`, `fieldControlProps`, `fieldDescribedBy` — states what it derives on its export.

<!-- rule:forge-ui-form-control-props --> `Input`, `Select` and `Textarea` call `fieldControlProps` internally when given `field`.

<!-- rule:forge-ui-form-label-classes --> A second label class string is how "field label" comes to mean two sizes.

<!-- rule:forge-ui-form-scope-collision --> A sign-in and a sign-up form both holding `email` otherwise emit one id twice, and the second label
points at the first control. Pass the same `scope` to the control and to every compound member.

### 3a. Before / after

```tsx
// Wrong — ids written by hand in three places.
import { Input } from "@y-core/forge/ui/core";

<div>
  <label for='email'>Email</label>
  <Input id='email' name='email' type='email' aria-describedby='email-err' />
  <p id='email-error'>Enter a valid address.</p>
</div>;
```

Costs: `aria-describedby` names `email-err` while the paragraph is `email-error`, so assistive technology reports a dangling IDREF and never
announces the message.

```tsx
// Right — one `name`, every id derived.
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField invalid={Boolean(error)}>
  <FormField.Label name='email'>Email</FormField.Label>
  <Input name='email' type='email' field={{ name: "email", error }} />
  <FormField.Error name='email'>{error}</FormField.Error>
</FormField>;
```

`FormField.Error` renders nothing for a blank message, so it needs no `{error && …}` guard. The control's `field` takes the same `error`; the root's
`invalid` reaches no control (§5).

---

## 4. `ui/core` bases versus `ui/controls` bound variants

`@y-core/forge/ui/controls` exports `Input`, `Select`, `Slider`, `Switch`, `Textarea` and `ToggleGroup` under the _same names_ as
`@y-core/forge/ui/core`, adding a required `bind` prop that stamps `data-field` for the client signal runtime.

| Given | Import from |
| --- | --- |
| The value is read by the server on submit | `@y-core/forge/ui/core` |
| A browser signal must see the value as it changes | `@y-core/forge/ui/controls` |
| Both — a bound control inside a submitted form | `@y-core/forge/ui/controls`, plus a `field` descriptor |

<!-- rule:forge-ui-form-bind-when-client --> `bind` without a registered scope is an inert `data-field` attribute.

<!-- rule:forge-ui-form-one-barrel --> Two `Input`s in one file resolve by whichever import came last, and the loser is invisible. Aliasing
explicitly at the import makes the pair readable:

```tsx
import { Switch } from "@y-core/forge/ui/controls";
import { Switch as SwitchPrimitive } from "@y-core/forge/ui/core";
```

<!-- rule:forge-ui-form-bind-and-field --> `field` wires accessibility; `bind` wires the signal. Dropping `field` because a control is bound is how
a bound control loses its label.

---

## 5. Error UX

Where a field's error renders is Floor: `forge-ui-form-error-inline`, in `floor.md`.

<!-- rule:forge-ui-form-error-summary --> An `Alert` `destructive` above the `Form`, naming the count and linking to the first failure.

<!-- rule:forge-ui-form-validate-timing --> Never on first blur of a field the user has not filled: tabbing through a form should not paint it red.

How an invalid field is marked is Floor: `forge-ui-form-invalid-triple`, in `floor.md`.

```tsx
import { FormField, Input } from "@y-core/forge/ui/core";

// Wrong — invalid signalled by a class alone.
<FormField class='border-destructive'>
  <FormField.Label name='card'>Card number</FormField.Label>
  <Input name='card' />
</FormField>
```

Costs: nothing reaches the accessibility tree, and a user who cannot distinguish the border colour sees an ordinary field.

```tsx
// Right — state, semantics and a glyph, from one prop plus one icon.
import { createIcon, FormField, Input } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");
const error = "That card number is not valid.";

<FormField invalid>
  <FormField.Label name='card'>Card number</FormField.Label>
  <Input name='card' field={{ name: "card", error }} />
  <FormField.Error name='card'>
    <AppIcon name='close' aria-hidden='true' />
    {error}
  </FormField.Error>
</FormField>;
```

---

## 6. Form-level composition

`Form` renders a `<form>`, wires CSRF from a `csrfToken` prop, and passes htmx attributes through.

<!-- rule:forge-ui-form-turnstile-placement --> Inside, so the token input Cloudflare injects is submitted with the form; above submit, so a
challenge appearing does not push the button the user is reaching for.

The widget loads eagerly, which is right for a form the page exists for. Give `load='focus'` to a form that is incidental to its page — a footer
contact form, a demo — where loading eagerly issues a challenge to every reader who scrolls past rather than to the ones who submit.

<!-- rule:forge-ui-form-one-primary --> Cancel and secondary paths take `secondary` or `ghost`.

```tsx
import { Button, Form, Turnstile } from "@y-core/forge/ui/core";

<Form method='post' csrfToken={csrfToken} hx-post='/contact' hx-target='#contact-result'>
  {/* fields */}
  <Turnstile siteKey={turnstileSiteKey} />
  <Button type='submit'>Send message</Button>
</Form>;
```

<!-- rule:forge-ui-form-mark-smaller-set --> When most fields are required, mark the optional ones in a `FormField.Description`; when most are
optional, mark the required ones.
