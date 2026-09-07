---
title: Colour Scale Authoring
description: "What a scale step means, and how to author twelve of them for a brand hue so they survive the semantic mapping already written against them."
---

# Colour Scale Authoring

[`04-color.md`](./04-color.md) says how a surface picks a pair. This file says where the pairs come
from: what a numbered step of the scale means, and what it takes to author twelve of them for a
brand hue rather than inheriting a shipped scheme's.

Read it when a brief introduces a brand hue, or when a per-mode value has to change. Everything
else about colour is the other file's.

---

## 0. Quick Reference

- §1 The scale, and what a step means: a token names a step, and the step holds the value
- §1a A token names a step, and the step holds the value: one declaration, both modes, no `.dark` block
- §1b The twelve positions and their published roles: Radix's vocabulary, and where forge's mapping differs
- §1c The namespaces the scale runs in: the greys, the absolute alphas, `--accent-12`, the fixed status hues
- §1d Overriding a per-mode value on the step: why overriding the semantic token fails silently
- §2 Authoring a scale for a brand hue: the steps are operands of a mapping already written
- §2a Author in a space that carries lightness: why every repair is a lightness move
- §2b Keeping the tint at the ends and through the middle: a scale that bleaches its ends publishes a grey page
- §2c How far a scheme leans: the measured ladder the four shipped schemes sit on, and the free dial
- §2d Measuring the authored scale: the pairs `theme-base.css` consumes, and the repair that is not chroma
- §3 Sources: the texts these two files' values and reasoning rest on
- §3a Radix for lightness, Tailwind for chroma and hue: numbers taken, not packages, in both directions
- §3b The reasoning re-derived, and what carries no id: three claims read and deliberately not given one

---

## 1. The scale, and what a step means

### 1a. A token names a step, and the step holds the value

A semantic token does not name a colour. It names a **step**, and the step holds the value:

```css
--muted-foreground: var(--gray-11); /* declared once, for both modes */
--gray-11: light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0)); /* also declared once — the branch is */
/* picked by `color-scheme` */
```

A step is a single declaration whichever mode is showing. There is no second block: a `.dark` rule
weighs the same 0-1-0 as `:root` and matches the same element, so a scheme imported after forge's
would beat one half and silently keep the other. The gate fails any `.dark` rule declaring a custom
property.

### 1b. The twelve positions and their published roles

The numbering is Radix's twelve-step scale, and so is the **lightness** of every step in every
scheme. `theme-neutral.css` is achromatic, so its steps are Radix's `gray` unchanged;
`theme-stone.css`, `theme-gray.css` and `theme-slate.css` keep those same lightnesses and take their
chroma and hue from Tailwind's `stone`, `gray` and `slate`, resampled at each one — see §3. Each position carries a stated meaning rather than a habit:

| Step | Role | Step | Role |
| --- | --- | --- | --- |
| 1 | App background | 7 | UI element border and focus rings |
| 2 | Subtle background | 8 | Hovered UI element border |
| 3 | UI element background | 9 | Solid backgrounds |
| 4 | Hovered UI element background | 10 | Hovered solid backgrounds |
| 5 | Active / selected UI element background | 11 | Low-contrast text |
| 6 | Subtle borders and separators | 12 | High-contrast text |

That table is **Radix's published vocabulary, not forge's mapping**. The two agree everywhere except
the borders, for the measured reason the section above gives: reach for `--border`, `--input`,
`--track` and `--ring` by name, and read the step they resolve through in `theme-base.css` rather
than inferring it from this table.

**Steps 1 and 2 are swapped in the light branch, and only there.** Radix reads step 2 as one shade
_toward_ the foreground, so a light-mode panel recedes; forge's cards are raised, and `--card` has
always been lighter than `--background`. The swap lives in the scale rather than in the semantic
layer because the scale is where a mode-specific value belongs, and it is what lets
`--background: var(--gray-1)` stay a single declaration for both modes. In dark, "toward the
foreground" already means lighter, so no swap is needed and none is applied.

### 1c. The namespaces the scale runs in

The scale runs in namespaces, and each is declared in full:

- `--gray-1` … `--gray-12` — every neutral surface, border and text colour. All twelve are declared
  even where forge consumes only some, because a scale is a complete artifact: a consuming theme has
  to know what the contract is, and a gap in the middle of one is an anomaly rather than a saving.
- `--black-a1` … `--black-a12` and `--white-a1` … `--white-a12` — absolute alphas, declared once
  because a scrim has to darken whatever is behind it in both modes and so cannot be a gray step.
- `--accent-12` — an alias of `--gray-12`. Forge ships no brand hue, so the accent is the gray, and
  an application supplies a real one by re-declaring this. That extension point is why the alias
  exists rather than `--primary` naming a gray step directly.
- the fixed status hues — `--red-*`, `--blue-*`, `--emerald-*`, `--yellow-*` — plus the functional
  `--red-contrast`, `--blue-contrast`, `--emerald-contrast` and `--yellow-contrast`, Radix's name for
  the foreground that sits on step 9. Only the greys moved: these are still Tailwind stops, because a
  status colour is not a thing an application re-themes.

Step 9 is the fill and is **held** across modes — one palette stop, no `light-dark()` — so the
foreground on it has to be near-white in both, which is what `light-dark(var(--gray-1),
var(--gray-12))` spells: step 1 in light and step 12 in dark are the same near-white seen from either
mode. That is `--accent-contrast`'s shape, and the reason step 11 exists to carry the hue as text
where the fill cannot ([`THEME_GENERATION.md`](../../../../docs/THEME_GENERATION.md)
§4). `--yellow-contrast` inverts instead — near-white on `--yellow-9` measures 1.83, so its foreground
stays near-black in _both_ modes: `--gray-12` in light, `--gray-1` in dark.

The three text weights forge's light mode distinguishes now sit on steps that carry a Radix role:
`--primary-foreground` is `--gray-1`, and `--secondary-foreground` and `--accent-foreground` are
`--gray-12`. No step is parked.

### 1d. Overriding a per-mode value on the step

Default: a per-mode value is overridden on the **step**, never on the semantic token — an app that
wants a different muted foreground in dark mode re-declares `--gray-11` with a `light-dark()` rather
than `--muted-foreground` — unless the value is meant to be the same in both modes, which is the
semantic token's own job. <!-- rule:forge-ui-color-scale-override-step -->

Overriding the token instead sets it in _both_ modes, because the token is declared once and the
mode difference is entirely below it. That failure is silent: the light mode keeps working, and only
the dark half is wrong.

## 2. Authoring a scale for a brand hue

Everything above this point assumes the twelve steps already exist. A consumer whose product has a
brand hue has to author them, and forge gives that job a shape that most colour advice does not: the
steps are not decoration, they are the operands of a mapping `theme-base.css` has already written.
Read the mapping first, then pick values that survive it.

The four shipped schemes are worked examples of the _shape_ — twelve solid steps, once each, and
nothing else — but not of the authoring, because each of them sidesteps
the hard half the same way: every step's lightness is Radix's, so no lightness in them was chosen
against forge's mapping. Only the hue was chosen. The example of a scale with _authored_ values in it
is in `src/ui/README.md`, and it is written in `oklch()`.

### 2a. Author in a space that carries lightness

Default: a scale is authored in a colour space that carries lightness as its own coordinate —
`oklch()`, the form `src/ui/README.md` writes it in — so that a step can be moved lighter or darker
without dragging its hue and its chroma along, unless the scale inherits its lightness from an
existing ramp that already holds balanced steps, which is what all four shipped schemes
do. <!-- rule:forge-ui-color-ramp-author-lightness -->

The reason to reach for that space is not fashion. Every repair in this section is "move one step's
lightness and leave everything else alone", and in a notation where lightness is entangled with the
other two coordinates that edit cannot be expressed — so it is made by eye, and the scale drifts in
hue as it descends.

### 2b. Keeping the tint at the ends and through the middle

Default: steps 1, 2, 11 and 12 keep a visible amount of the brand hue rather than resolving to white
and black, because those four are exactly where `theme-base.css` puts the page ground, the raised
surface and the default text in the two modes, unless a brief pins a neutral page and confines the
brand hue to `--primary` — the per-token override `src/ui/README.md`
documents. <!-- rule:forge-ui-color-ramp-author-endpoint-tint -->

A scale that bleaches its ends spends its brand on the steps nobody looks at and publishes a grey
page, which is the opposite of the intent that motivated authoring one at all.

Default: the tint runs through the whole scale, not only its ends — the middle steps carry the same
hue at a chroma low enough to read as neutral — which is the _only_ thing separating the four
shipped schemes from one another: `theme-stone.css` is warm, `theme-gray.css` cool and
`theme-slate.css` strongly cool, `theme-neutral.css` sits at no tint at all, and the twelve
lightnesses are otherwise the same decision. Unless a brief fixes untinted greys, usually because a
second brand colour has to sit beside them without either one
bending. <!-- rule:forge-ui-color-ramp-author-tinted-neutrals -->

### 2c. How far a scheme leans

**How much tint is a question of what else carries the identity.** A neutral calibrated to sit under
a saturated accent only has to lean toward it, because the accent is doing the work; a scheme that is
_all_ there is has to carry the identity itself, and a lean that reads as deliberate under an accent
reads as a rendering artifact without one. Forge is the second case — `--accent-12` aliases
`--gray-12`, near-black — and the headers of the tinted scheme files carry the measurement that
settled how far their steps had to move. Measured as max−min across R/G/B at step 11, the muted-text
step, the four form a ladder: `theme-neutral.css` 0, `theme-stone.css` 12, `theme-gray.css` 20,
`theme-slate.css` 42. `theme-gray.css` exists because the first three clustered at the bottom of
that ladder — neutral and stone sit twelve units apart and read as almost the same scheme — so a
rung at every strength is what the fourth buys, not a closing of that gap.

**How far a scheme leans is a dial, and turning it is free.** `theme-gray.css` is the first scheme to
scale its chroma rather than take the Tailwind ramp at full strength — Tailwind's `gray` lands at 26
here, which read as more blue than a scheme called grey should be, so its chroma is scaled to 0.8 and
it lands at 20. Across the whole dial from full chroma down to 0.5, no audited ratio moves by more
than 0.05: hue and chroma are free parameters in this construction, because every contrast
measurement depends on lightness alone and the lightness ramp is shared. Re-tuning a scheme's
character therefore costs no re-measurement, and adding a scheme costs no new contract row. The
scheme file owns the factor and the values it produced.

### 2d. Measuring the authored scale

Default: a newly authored scale is measured on the pairs `theme-base.css` actually consumes —
`--foreground` on `--background`, `--muted-foreground` on `--muted`, `--card` against the page,
`--input` and `--ring` against the surface behind them — in both `:root` and `.dark`, unless the
new scale only rotates the tint of an already-audited one at identical lightness, which is the
carve-out `forge-ui-color-theme-per-theme-audit` already
states. <!-- rule:forge-ui-color-ramp-author-audit-pairs -->

Where a pair misses, the repair is to move that one _step's_ lightness. It is **not** to lower the
chroma of the scale until the numbers pass: draining chroma raises contrast for the pair you were
looking at and turns the brand scale back into grey everywhere else, which converts a local failure
into a global one. `--muted-foreground` on `--muted` is where this bites first, for the reason
`forge-ui-color-theme-muted-pair` gives.

## 3. Sources

### 3a. Radix for lightness, Tailwind for chroma and hue

**Radix Colors** supplies the **lightness** of every step in every scheme, and every value in
`theme-neutral.css`. It is `@radix-ui/colors` 3.0.0, MIT-licensed. The default scheme is achromatic,
so its twelve solid steps are Radix's `gray` verbatim except for the light-mode 1↔2 swap §1b describes; `theme-stone.css`, `theme-gray.css` and `theme-slate.css` keep those lightnesses and replace
the chroma and hue.

**Tailwind CSS** supplies the **chroma and hue** of the three tinted schemes: `theme-stone.css` takes
Tailwind's `stone`, `theme-gray.css` its `gray` and `theme-slate.css` its `slate`, each resampled at
the Radix lightness of the
step it lands on, because Tailwind's eleven stops are not spaced for twelve roles. The fixed status
hues are Tailwind's too, but by reference rather than by value: `--red-9` and its siblings resolve
through the Tailwind colour variables the consuming app's own build declares, so no number for them
is copied here at all.

Forge takes numbers and not packages in both directions: neither library is a dependency, the values
never change without a release, and a dependency would have to resolve through `node_modules`, which
is the fragility `forge.css`'s `@source` comment already documents. The step _values_ come from those
two sources; **which role reaches for which step is forge's own decision**, and the border tokens are
where forge and Radix deliberately disagree.

### 3b. The reasoning re-derived, and what carries no id

The colour reasoning re-derived here — a finite scale of neutrals rather than shades invented per
component, roles named before values, and colour as reinforcement of a signal that is already
carried in text — draws on _Refactoring UI_ by Adam Wathan and Steve Schoger. Every rule was
rewritten against forge's own system: the twelve-step scale in the scheme files and the semantic
layer in `theme-base.css`,
the `color-scheme` that picks each step's mode, and the `--status-*` family the `Badge`, `Alert` and `Toast`
tones render. The scale-authoring section draws on the same book's account of building a palette
before building screens, re-derived here against the steps `theme-base.css` consumes.

Three of that account's claims were read and deliberately **not** given rule ids:

- **"Prefer HSL to hex."** Forge's own worked scale in `src/ui/README.md` is `oklch()`. Publishing
  the preference would have the corpus contradict the example it points readers at, so the rule
  above states what the notation has to _do_ — carry lightness as its own coordinate — and lets the
  example name the form.
- **A count of shades per hue.** Already stated in [`04-color.md`](./04-color.md) §1a, where the twelve
  steps are argued for. A second id would be a second citation anchor for one sentence.
- **Rotating hue to keep perceived brightness even as lightness changes.** True, and general colour
  theory: it terminates in no forge token, primitive or utility, so it fails the admission test
  this corpus applies to every rule. It is worth knowing while authoring a scale; it is not a rule a
  finding could cite.
