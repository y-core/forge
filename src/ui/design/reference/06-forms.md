# Forms

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules
cited below are not.

A form is where craft is most often skipped, because every part of it already works: an unlabelled
input still submits. The rules below are about the parts that do not announce their absence.

## Which field primitive

Three primitives look interchangeable and are not.

| Given | Choose | Why |
|---|---|---|
| A control that is validated, can be wrong, and has a server-side `name` | `FormField` | A `<fieldset>` that wires `id` / `for` / `aria-describedby` / `aria-invalid` from one `name` |
| A settings row — a labelled control with no validation and no error | `Field` | A layout row with a decorative `<span>` label; no form semantics at all |
| Several checkboxes or radios answering one question | `CheckboxGroup` / `RadioGroup` | Real `<input type="checkbox">` / `<input type="radio">`; radio grouping and roving focus are the platform's |

**Default: reach for `FormField` whenever the value is submitted and can be rejected.**
<!-- rule:forge-ui-form-formfield-default -->
`Field` is not a lighter `FormField`; it has no error slot, so choosing it for a validated control
means the error has nowhere to render. Override for a control whose value is applied immediately and
cannot fail — a theme preference, a viewport slider.

**Default: use `CheckboxGroup` / `RadioGroup` rather than a `FormField` wrapping loose inputs.**
<!-- rule:forge-ui-form-group-primitive -->
Both accept `name`, `scope`, `description`, `invalid`, `disabled` and `orientation`, and expose
`.Label`, `.Item`, `.Description` and `.Error`. Override only for a group whose items are not a
single question — a matrix of independent toggles, which is a stack of `Field` rows.

**Default: `FormField.Legend` takes `variant="legend"` when it heads a section of fields, and
`variant="label"` when it names one cluster.** <!-- rule:forge-ui-form-legend-variant -->
`legend` renders at `text-base`, `label` at `text-sm` — a section heading versus a field label.
Choosing by size instead of by role is what produces a legend that outranks the form's own heading.
Override only under a brief that restates the form's type scale.

## Never hand-write the wiring

Forge exports the id derivation as functions precisely so two places cannot disagree about an id. A
hand-written `for="email"` beside an `id="field-email"` is silent: nothing errors, nothing warns, and
clicking the label stops focusing the control.

| Helper | Gives you |
|---|---|
| `fieldId(name, scope?)` | the control's id |
| `fieldDescriptionId(name, scope?)` | the description element's id |
| `fieldErrorId(name, scope?)` | the error element's id |
| `fieldControlProps(props, field)` | id, name, disabled, `aria-describedby`, `aria-invalid` merged onto a control |
| `fieldDescribedBy(name, options)` | just the `aria-describedby`, for a `<fieldset>`-shaped group |
| `FIELD_LABEL_CLASSES` | the shared label class string |

**Default: derive every field id through the helpers, never as a string literal.**
<!-- rule:forge-ui-form-id-helpers -->
Override only for an id that forge does not own — a `Dialog`'s `id`, a `Tabs.Panel`'s `id` — where
there is no helper to disagree with.

**Default: wire a control by passing it a `field` descriptor rather than by spreading attributes.**
<!-- rule:forge-ui-form-control-props -->
`Input`, `Select` and `Textarea` call `fieldControlProps` internally when given `field`. Override
when composing a control forge does not ship, in which case call `fieldControlProps` yourself.

**Default: when building a label-alike that is not a `<label>`, style it with
`FIELD_LABEL_CLASSES`.** <!-- rule:forge-ui-form-label-classes -->
Override never — a second label class string is how "field label" comes to mean two sizes.

**Default: pass a `scope` whenever two fields on one page share a `name`.**
<!-- rule:forge-ui-form-scope-collision -->
A sign-in and a sign-up form both holding `email` otherwise emit one id twice, and the second label
points at the first control. Pass the same `scope` to the control and to every compound member.
Override when the page provably renders one such field, which is the common case and why `scope` is
opt-in.

### Before / after

```tsx
// Wrong — ids written by hand in three places.
import { Input } from "@y-core/forge/ui/core";

<div>
  <label for="email">Email</label>
  <Input id="email" name="email" type="email" aria-describedby="email-err" />
  <p id="email-error">Enter a valid address.</p>
</div>;
```

Costs: `aria-describedby` names `email-err`, the paragraph is `email-error`. A dangling IDREF is
reported as an error by assistive technology rather than ignored, and the message is never announced.

```tsx
// Right — one `name`, every id derived.
import { FormField, Input } from "@y-core/forge/ui/core";

<FormField name="email" invalid={Boolean(error)}>
  <FormField.Label name="email">Email</FormField.Label>
  <Input name="email" type="email" field={{ name: "email", invalid: Boolean(error) }} />
  <FormField.Error name="email">{error}</FormField.Error>
</FormField>;
```

`FormField.Error` renders nothing when its child is `null`, `false` or empty, so it is safe
unconditionally — no `{error && …}` guard, and therefore no branch that can be forgotten.

---

## `ui/core` bases versus `ui/controls` bound variants

`@y-core/forge/ui/controls` exports `Input`, `Select`, `Slider`, `Switch`, `Textarea` and
`ToggleGroup` under the *same names* as `@y-core/forge/ui/core`, adding a required `bind` prop that
stamps `data-field` for the client signal runtime.

| Given | Import from |
|---|---|
| The value is read by the server on submit | `@y-core/forge/ui/core` |
| A browser signal must see the value as it changes | `@y-core/forge/ui/controls` |
| Both — a bound control inside a submitted form | `@y-core/forge/ui/controls`, plus a `field` descriptor |

**Default: reach for the `ui/core` base until a client signal actually reads the value.**
<!-- rule:forge-ui-form-bind-when-client -->
`bind` without a registered scope is an inert `data-field` attribute. Override when the surface is a
`Resumable` island whose state drives other rendering.

**Default: one module imports a given control name from exactly one of the two barrels.**
<!-- rule:forge-ui-form-one-barrel -->
Two `Input`s in one file resolve by whichever import came last, and the loser is invisible. Override
only by aliasing explicitly at the import, which makes the pair readable:

```tsx
import { Switch } from "@y-core/forge/ui/controls";
import { Switch as SwitchPrimitive } from "@y-core/forge/ui/core";
```

**Default: `bind` and `field` coexist rather than compete.** <!-- rule:forge-ui-form-bind-and-field -->
`field` wires accessibility; `bind` wires the signal. Override never — dropping `field` because a
control is bound is how a bound control loses its label.

---

## Error UX

**Default: the message renders inside the field's own `FormField`, adjacent to the control.**
<!-- rule:forge-ui-form-error-inline -->
`FormField.Error` renders a `role="alert"` paragraph with the derived error id. Override never for
placement; a summary may be added, not substituted.

**Default: a top-of-form summary appears only in addition to the inline messages, and only when more
than one field failed.** <!-- rule:forge-ui-form-error-summary -->
An `Alert` `destructive` above the `Form`, naming the count and linking to the first failure.
Override when the failure is not attributable to a field at all — a declined payment, a rate limit —
where the `Alert` is the only correct home.

**Default: validate on submit first, then on change for the fields that failed.**
<!-- rule:forge-ui-form-validate-timing -->
Never on first blur of a field the user has not filled: tabbing through a form should not paint it
red. Override for a field whose validity is expensive to discover late — a username uniqueness check
— which may validate on blur *after* a value exists.

**Default: an invalid field carries `data-invalid`, `aria-invalid` and an `Icon` together.**
<!-- rule:forge-ui-form-invalid-triple -->
The first two come from **two different places**, and conflating them is the common bug: `FormField`'s
`invalid` prop puts `data-invalid` on the `<fieldset>` via `stateAttrs`, while `aria-invalid` reaches
the control only via `fieldControlProps`. A field marked `invalid` with a control that never went
through `fieldControlProps` styles as invalid and announces nothing. The icon is yours to place, and
it is what satisfies `forge-ui-not-color-alone`. Override never.

```tsx
// Wrong — invalid signalled by a class alone.
<FormField name="card" class="border-destructive">
  <FormField.Label name="card">Card number</FormField.Label>
  <Input name="card" />
</FormField>
```

Costs: nothing reaches the accessibility tree, and a user who cannot distinguish the border colour
sees an ordinary field.

```tsx
// Right — state, semantics and a glyph, from one prop plus one icon.
import { createIcon, FormField, Input } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<FormField name="card" invalid>
  <FormField.Label name="card">Card number</FormField.Label>
  <Input name="card" field={{ name: "card", invalid: true }} />
  <FormField.Error name="card">
    <AppIcon name="close" aria-hidden="true" />
    That card number is not valid.
  </FormField.Error>
</FormField>;
```

---

## Form-level composition

`Form` renders a `<form>`, wires CSRF from a `csrfToken` prop, and passes htmx attributes through. It
renders **no** honeypot — that is composed.

**Default: `Honeypot` is the first child of a mutation `Form`, and appears on no `method="get"`
form.** <!-- rule:forge-ui-form-honeypot-placement -->
On a GET form the browser serialises the decoy into the query string — into the address bar, history
and the outbound referrer — and only mutation handlers consult it. Override never.

**Default: `Turnstile` sits inside the `<form>`, immediately above the submit control.**
<!-- rule:forge-ui-form-turnstile-placement -->
Inside, so the token input Cloudflare injects is submitted with the form; above submit, so a
challenge appearing does not push the button the user is reaching for. Override when the form is long
enough that the widget would be off-screen at submit time, in which case place it in view of the
button.

**Default: one `primary` `Button` per form, and it is the submit.**
<!-- rule:forge-ui-form-one-primary -->
Cancel and secondary paths take `secondary` or `ghost`. Override under a brief for a split primary
action, where the two are visually one control.

```tsx
import { Button, Form, Honeypot, Turnstile } from "@y-core/forge/ui/core";

<Form method="post" csrfToken={csrfToken} hx-post="/contact" hx-target="#contact-result">
  <Honeypot />
  {/* fields */}
  <Turnstile siteKey={turnstileSiteKey} />
  <Button type="submit" variant="primary">Send message</Button>
</Form>;
```

**Default: mark the smaller set.** <!-- rule:forge-ui-form-mark-smaller-set -->
When most fields are required, mark the optional ones in a `FormField.Description`; when most are
optional, mark the required ones. Override under a brief with a compliance requirement to mark every
required field.
