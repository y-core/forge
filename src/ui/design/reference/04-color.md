# Color

Forge's colour system is two layers, and it used to be three.

Underneath is the **scale** in a scheme file — twelve numbered steps, `--gray-1` through `--gray-12`
— alongside the fixed status hues in `theme-colors.css`. Each step holds a **literal value** covering both modes, and names a
*position in the system*: the app background, a subtle border, a low-contrast text colour.

On top is the semantic layer in `theme-base.css`, which maps a step onto a name describing a
*use*: `--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--border`, and the rest.
That file declares the mapping, the `color-scheme` that picks each step's mode, and nothing else —
no scale, and no colour value at all.

There was a third layer beneath both — an eleven-stop neutral ramp each theme file supplied, which
the steps pointed at. It is gone rather than renamed. It existed only because the semantic layer of
the time needed something mode-agnostic to point at, and the step layer does that job, so keeping
both meant two indirections answering one question.

**A theme file re-declares the twelve steps, once each, and nothing else.** Four schemes ship and none is mandatory: `theme-neutral.css` is the default, which
`forge.css` imports, so forge renders correctly with no theme file of the application's own, and
`theme-stone.css` (warm), `theme-gray.css` (cool) and `theme-slate.css` (strongly cool) override the
steps to change the tint. Tailwind's ramp named `gray` is blue-tinted, so the achromatic scheme is
`theme-neutral.css` rather than `theme-gray.css` — the names invite the opposite reading.

Everything in this file follows from that split.

## The scale is finite on purpose

A neutral scale needs enough steps that every surface, border and text role has a defensible one, and
few enough that two designers reaching for "a light grey" land on the same value. The usual number
quoted is 8–10 greys; forge ships twelve, which covers it with room to spare — and each carries a
published meaning, so a step is looked up rather than eyeballed.

Default: a shade comes from a declared step of the scale, or from a semantic token built on one, and
is never generated on the fly — no `color-mix` against an arbitrary percentage, no one-off opacity
used to fake an intermediate grey — unless a brief introduces a brand hue, which is then declared as
steps in a theme file like every other. <!-- rule:forge-ui-color-scale-ramp-only -->

Default: two adjacent steps are not used together as a foreground/background pair — `--gray-9` on
`--gray-10` is a contrast failure before it is an aesthetic one — unless the pair is a *decorative*
boundary against its own surface, where low contrast is the
point. <!-- rule:forge-ui-color-scale-adjacent-stops -->

The carve-out is **decoration, not borders as a category**, and the distinction is the one that
matters:

- A **decorative** line separates or encloses. A `Card` hairline, a `Separator`, a `Dialog` edge,
  the rule between two table rows. Nothing about it identifies a control or reports a state, so
  WCAG 1.4.11 does not bind and a whisper-quiet line is the correct design.
- An **affordance** tells the reader something is operable, or what state it is in. A text field's
  outline, a `Switch` track, a `Slider` track, a focus ring. These are non-text contrast under
  WCAG 1.4.11 and must clear **3:1** against the surface behind them — adjacent step or not.

An earlier revision of this rule exempted "a border against its own surface" without qualification,
which licensed a control outline at the same step as a hairline. That is how `--input` shipped at
roughly half the required ratio for 82 versions: the rule the corpus wrote to prevent the defect had
a clause wide enough to permit it.

**Forge's role mapping is deliberately not Radix's, and the border tokens are where the two part.**
Radix names step 6 "subtle borders and separators", step 7 "UI element border and focus rings" and
step 8 "hovered UI element border". Measured against the surfaces they sit on, those three are
**1.24, 1.38 and 1.68** to 1 in light — against the 3:1 that WCAG 1.4.11 asks of anything that
identifies a control, and `--input` is the sole boundary a text field has. Radix's own contrast
guarantee is explicit about its scope: steps **11 and 12**, to APCA Lc 60 and Lc 90 on a step 2
background. It says nothing about 7.

So the decorative token keeps Radix's step and the affordances move to steps that clear the floor.
`--border` is step 6, which is what a hairline should be and where Radix puts it; `--input` and
`--track` are step 10 (3.33 in light, 3.76 in dark) and `--ring` is step 11 (5.19 / 7.67), preserving
the one-step gap that keeps `focus:border-ring` from being a no-op. Adopting step 7 because it is
*called* the UI element border would have re-introduced the 82-version defect under a better name.

**Re-authoring steps 7 and 8 was left open as a second pass, and that pass has now been made: the
values stay Radix's.** The two systems are not in disagreement — they answer different questions with
different instruments. Radix's guarantee is about *text*, at steps 11 and 12, and is stated in APCA;
1.4.11 is measured with WCAG 2.x's relative-luminance ratio, and 7 was never a number Radix put under
that floor.

What settles it is that **Radix's own text-field pattern does not reach 3:1 either** — a step-4 fill
inside a step-7 border measures 1.16 (fill against the page), 1.49 (border against the page) and 1.28
(border against fill) in light. Adopting that shape would buy a tint, not an identifier, so forge's
mapping is the stricter line rather than a workaround for a defect. And the geometry closes the
alternative: on a near-white page a 3:1 identifier has to be step 10 or darker, so a compliant step 7
would land darker than Radix's step 10 and squeeze steps 7–10 into a span too narrow to stay
perceptually even. Read the measurements and the full argument beside `--input` in `theme-base.css`,
which is where the mapping and its reasoning live. The accepted cost is stated there too: forge's
input border is visibly heavier than a Radix-based UI's.

Where a control has a fill to be identified by, none of this binds — `Switch` and `Slider` are read
by their track, and `CheckboxGroup` and `RadioGroup` are painted so that a checked box is a filled
box. It is the text field, whose interior is the page colour, that leaves its border carrying the
whole identification.

Default: a surface that needs "slightly lighter" or "slightly darker" moves one step along the scale
rather than applying an opacity modifier to the current colour, unless the element is genuinely
translucent over content it must not hide — a scrim or an overlay, which is what `--overlay` and the
absolute `--black-a1` … `--black-a12` and `--white-a1` … `--white-a12` ramps are
for. <!-- rule:forge-ui-color-scale-no-adhoc-tint -->

Opacity tinting looks equivalent and is not: it composites against whatever is behind, so the same
class produces a different result on `--background` than on `--card`, and a different result again
under `.dark`.

**The absolute alpha ramps are the sanctioned form of translucency, and a per-scheme one cannot
be.** `--black-a1` through `--black-a12` and `--white-a1` through `--white-a12` are identical in both
modes, and that mode-stability is the whole point. A per-scheme alpha step composites over its own
scheme's step 1, which makes it page-relative and so mode-inverting — black over a light page, white
over a dark one. A scrim has to darken whatever is behind it in *both* modes, so a page-relative step
cannot express one, which is why forge ships no per-scheme alpha scale. `--overlay` is `--black-a6`,
the dialog backdrop, where a hardcoded literal used to sit inline in a component rule.

## The scale, and what a step means

A semantic token does not name a colour. It names a **step**, and the step holds the value:

```css
--muted-foreground: var(--gray-11);                           /* declared once, for both modes */
--gray-11: light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0));  /* also declared once — the branch is */
                                                              /* picked by `color-scheme` */
```

A step is a single declaration whichever mode is showing. There is no second block: a `.dark` rule
weighs the same 0-1-0 as `:root` and matches the same element, so a scheme imported after forge's
would beat one half and silently keep the other. The gate fails any `.dark` rule declaring a custom
property.

The numbering is Radix's twelve-step scale, and so is the **lightness** of every step in every
scheme. `theme-neutral.css` is achromatic, so its steps are Radix's `gray` unchanged;
`theme-stone.css`, `theme-gray.css` and `theme-slate.css` keep those same lightnesses and take their
chroma and hue from Tailwind's `stone`, `gray` and `slate`, resampled at each one — see
`## Sources`. Each position carries a stated meaning rather than a habit:

| Step | Role | Step | Role |
|---|---|---|---|
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
*toward* the foreground, so a light-mode panel recedes; forge's cards are raised, and `--card` has
always been lighter than `--background`. The swap lives in the scale rather than in the semantic
layer because the scale is where a mode-specific value belongs, and it is what lets
`--background: var(--gray-1)` stay a single declaration for both modes. In dark, "toward the
foreground" already means lighter, so no swap is needed and none is applied.

The scale runs in namespaces, and each is declared in full:

- `--gray-1` … `--gray-12` — every neutral surface, border and text colour. All twelve are declared
  even where forge consumes only some, because a scale is a complete artifact: a consuming theme has
  to know what the contract is, and a gap in the middle of one is an anomaly rather than a saving.
- `--black-a1` … `--black-a12` and `--white-a1` … `--white-a12` — absolute alphas, declared once
  because a scrim has to darken whatever is behind it in both modes and so cannot be a gray step.
- `--accent-12` — an alias of `--gray-12`. Forge ships no brand hue, so the accent is the gray, and
  an application supplies a real one by re-declaring this. That extension point is why the alias
  exists rather than `--primary` naming a gray step directly.
- the fixed status hues — `--red-*`, `--blue-*`, `--emerald-*`, `--green-9`, `--yellow-*` — plus the
  functional `--red-contrast`, `--green-contrast` and `--yellow-contrast`, Radix's name for the
  foreground that sits on step 9. Only the greys moved: these are unchanged, and still Tailwind
  stops, because a status colour is not a thing an application re-themes.

`--red-contrast` and `--green-contrast` are `var(--gray-1)` with no `light-dark()` around it, which is
worth stating rather than reading as an omission: step 1 is the page, near-white in light and near-black in
dark, and those are exactly the two answers that token needs. `--yellow-contrast` is the exception —
near-white on `--yellow-9` measures 1.83, so its foreground stays near-black in *both* modes, making
it the one place a `light-dark()` selects between two different **steps** rather than two values:
`--gray-12` in light, `--gray-1` in dark, which are the same colour seen from either mode.

The three text weights forge's light mode distinguishes now sit on steps that carry a Radix role:
`--primary-foreground` is `--gray-1`, and `--secondary-foreground` and `--accent-foreground` are
`--gray-12`. No step is parked.

Default: a per-mode value is overridden on the **step**, never on the semantic token — an app that
wants a different muted foreground in dark mode re-declares `--gray-11` with a `light-dark()` rather
than `--muted-foreground` — unless the value is meant to be the same in both modes, which is the
semantic token's own job. <!-- rule:forge-ui-color-scale-override-step -->

Overriding the token instead sets it in *both* modes, because the token is declared once and the
mode difference is entirely below it. That failure is silent: the light mode keeps working, and only
the dark half is wrong.

## The semantic layer, and what each token is for

| Token pair | Use for |
|---|---|
| `--background` / `--foreground` | The page itself, and its default text |
| `--card` / `--card-foreground` | A raised object — `Card` sets both |
| `--popover` / `--popover-foreground` | Layered surfaces: `Menu`, `Popover`, `Tooltip` |
| `--primary` / `--primary-foreground` | The one primary action; see `01-hierarchy.md` |
| `--secondary` / `--secondary-foreground` | A filled but subordinate surface |
| `--muted` / `--muted-foreground` | A recessed panel, and every line of supporting text |
| `--accent` / `--accent-foreground` | Interactive state — hover, open, selected |
| `--destructive` / `--destructive-foreground` | Error text and borders, and destructive fills — `Button variant='destructive'`. The app's colour to re-point |
| `--success` / `--success-foreground` | A confirmed outcome, as a fill. The app's colour to re-point |
| `--warning` / `--warning-foreground` | A caution, as a fill. The pair inverts — dark text on yellow. The app's colour to re-point |
| `--border` | Decorative separation only — hairlines, dividers, surface edges. No contrast floor |
| `--input` | A control's boundary — text fields, `Select`, `Textarea`, and every `border-input`. 3:1 |
| `--track` | The off-state fill of a `Switch` or `Slider` track. Its own token on the same step as `--input`, not an alias of it. 3:1 |
| `--ring` | The focus indicator. Sits one step beyond `--input`, so a focused control advances. 3:1 |
| `--overlay` | The modal scrim, on an absolute alpha step so it darkens whatever is behind it in either mode |

The twenty `--status-*` tokens are the other half of the semantic layer, and they answer a different
question — see *Status colour is forge's; the fills are the app's* below.

Default: interactive feedback — hover, open, selected — is expressed with `--accent` and its
paired foreground, as `buttonVariants` does for `secondary` and `ghost`, unless the element's
resting state is already `--accent`, in which case it moves to `--primary`. <!-- rule:forge-ui-color-semantic-accent-interactive -->

Default: a background token is set together with its `*-foreground` partner and never with a
foreground from a different pair, unless the element inherits a foreground from a parent that has
already set the matching one. <!-- rule:forge-ui-color-semantic-pairing -->

`forge-ui-foreground-pairing` is the Floor that makes this non-negotiable; the rule above is the
positive form of it, and the table is where you look up which partner is correct.

## Colour supports meaning; it never carries it

A red badge means "failed" only to a reader who can see red, is not looking at the screen in
sunlight, and already knows the convention. Everyone else needs the word.

Default: every state distinguished by colour is also distinguished by a word, an icon, or a
position — a `Badge` says "Failed" as well as being red, an `Alert` carries an `Alert.Title` — as
required by the Floor rule `forge-ui-not-color-alone`, unless the colour is decorative and encodes
no state at all. <!-- rule:forge-ui-color-semantic-support-only -->

### Before / after — status in a table

```tsx
import { Badge } from "@y-core/forge/ui/core";

<Badge variant={job.failed ? "destructive" : "default"} aria-hidden='true'>
  ●
</Badge>;
```

Costs the column its meaning for anyone who cannot resolve the two reds, and `aria-hidden` removes
the state from the accessibility tree entirely, so a screen reader announces an empty cell.

```tsx
import { Badge } from "@y-core/forge/ui/core";

<Badge variant={job.failed ? "destructive" : "outline"}>{job.failed ? "Failed" : "Complete"}</Badge>;
```

## Dark mode is the argument for tokens

`.dark` does not add a second stylesheet, and it does not re-declare a single semantic token. It sets
`color-scheme: dark`, which picks the dark branch of every **step** those tokens resolve through. The
values below are `theme-neutral.css`'s scale, which is what an app gets with no theme file of its own:

| Token | Step | Light branch | Dark branch |
|---|---|---|---|
| `--background` | `--gray-1` | `#f9f9f9` | `#111111` |
| `--foreground` | `--gray-12` | `#202020` | `#eeeeee` |
| `--card` | `--gray-2` | `#fcfcfc` | `#191919` |
| `--muted` | `--gray-3` | `#f0f0f0` | `#222222` |
| `--muted-foreground` | `--gray-11` | `#646464` | `#b4b4b4` |
| `--primary` | `--accent-12` | `#202020` | `#eeeeee` |
| `--border` | `--gray-6` | `#d9d9d9` | `#3a3a3a` |
| `--input` | `--gray-10` | `#838383` | `#7b7b7b` |
| `--ring` | `--gray-11` | `#646464` | `#b4b4b4` |

Read the last two columns as the two branches of the *step's* one declaration, not as the token's
value. Each token in the first column is declared exactly once and means the same thing in both modes — `--background` is the app
background whichever mode is on. That is what makes the number of mode-varying decisions at the
semantic layer zero, and it is why the override point for a per-mode value is the step.
`--accent-12` is an alias of `--gray-12`, which is why `--primary` and `--foreground` read the same
value here.

Because `@theme inline` resolves each Tailwind colour utility through `var()`, `bg-card` means
whatever `--card` currently means. Toggling `.dark` on the document element moves every one of them at
once, with no recompile — the class changes `color-scheme`, and the browser re-picks each branch.

This is the whole case for `forge-ui-color-token-only`, and it is worth stating plainly: a raw
utility **survives** the theme switch, and that is the failure. `bg-gray-100` stays light grey
when the page goes dark, so the element it was applied to becomes a bright rectangle in the middle
of a dark surface. `bg-card` moves with the theme. The rule is not stylistic tidiness — an
untokenised colour is a visible defect the moment a user flips the theme.

Default: a colour reaches the page through a semantic token — including the `--status-*` family for
the four status intents — and a scale step is named directly only inside `theme-base.css` or a theme
file, unless the colour is a fixed hue no forge token covers, in which case the utility carries its
own `dark:` counterpart. <!-- rule:forge-ui-color-theme-no-raw-utility -->

The exemption is the `dark:` counterpart, not the fixed hue. A raw utility with no dark half
survives the theme switch, and surviving the switch is the defect — which is what the paragraph
above this rule says at length.

The exemption has also stopped being the ordinary case. Until the `--status-*` family existed,
`Alert`, `Badge` and `Toast` were the worked example of it, and every status surface in an
application copied that shape. They are tokens now, forge's own source contains no `dark:` utility
at all, and the paired form is what is left for a hue outside the token set — a brand's own
signal colour, not "failed" or "succeeded".

### Before / after — a status panel

```tsx
<div class='rounded-lg border border-gray-200 bg-gray-50 p-4'>
  <p class='text-sm text-gray-500'>No deployments in the last 24 hours.</p>
</div>
```

Costs the panel its theme: the three greys are fixed values, so under `.dark` this renders as a
near-white block with grey text on a `--gray-1` page — high contrast in the wrong direction, and
unreadable at a glance.

```tsx
<div class='rounded-lg bg-muted p-4'>
  <p class='text-sm text-muted-foreground'>No deployments in the last 24 hours.</p>
</div>
```

Note the border went away as well — see `forge-ui-layout-muted-panel` in `02-layout.md`.

## Contrast is per scheme, per mode

`forge-ui-contrast-floor` fixes the ratios. What that Floor does not say, and what the layering makes
easy to forget, is that a passing ratio is a property of *one scale in one mode*.

There is no longer a worst case to take across five ramps, and the reason is stronger than the count
changing. **All four shipped schemes are built on one lightness ramp and differ only in hue**, so
every audited ratio is the same across them to within **0.05** — the widest gap at any audited step
is `--muted-foreground` in light, 5.17 through 5.22 — by construction rather than by coincidence,
which is why the contract in `src/pkg/gate/checks/contrast-parse.ts` can pin one set of numbers and have them
describe every scheme alike. A scheme swap cannot move a pair across its floor.

That the property is construction rather than measurement is what adding a scheme demonstrated:
`theme-gray.css` shipped without a single contract row being re-pinned. One measurement describes
any scheme built this way, not merely the ones that have been measured. The ratios themselves are
`src/pkg/gate/checks/contrast-parse.ts`'s to own.

That guarantee is a property of the construction, not of theming in general. A scheme an application
authors itself is on its own ramp and is bound by no such distance, which is what the rules below are
for.

The `--status-*` pairs are the exception, and only because no neutral step participates in them: both
halves of a status pair come from the fixed hue itself, so those ratios are the same under every
scheme. Everything a gray step touches is per scheme.

Default: a foreground/background pair is verified in both `:root` and `.dark`, for every scheme the
application ships, unless the application loads exactly one theme file and locks the
mode. <!-- rule:forge-ui-color-theme-both-modes -->

Default: `--muted-foreground` on `--muted` is audited explicitly for every scheme, because it is
the pair with the least headroom in the system — light mode puts `#646464` on `#f0f0f0` and dark mode
`#b4b4b4` on `#222222`, through `--gray-11` on `--gray-3` — and a failure is repaired in the theme
file rather than worked around at the call site, unless a brief pins the scheme's steps as fixed
brand values, in which case the repair moves to what `--gray-11` is worth in the failing
mode. <!-- rule:forge-ui-color-theme-muted-pair -->

That pair matters disproportionately because it is where most of the text on any forge surface
lands: `Card.Description`, `FormField.Description`, `Field`'s label span, and
`FormField.Separator`'s content all sit on it.

Default: adding a theme file includes an audit of its steps against the semantic mapping in
`theme-base.css` rather than an assumption that the mapping transfers, unless the new file changes
only the tint of an already-audited scale at identical
lightness. <!-- rule:forge-ui-color-theme-per-theme-audit -->

`theme-stone.css`, `theme-gray.css` and `theme-slate.css` are the worked example of that carve-out
rather than exceptions to the rule: they rotate the hue of `theme-neutral.css`'s ramp and change no
step's lightness, which is exactly the case the exemption names — and `theme-gray.css` is the case
that exercised it, having been added after the audit was pinned without moving a row of it.

## Authoring a scale for a brand hue

Everything above this point assumes the twelve steps already exist. A consumer whose product has a
brand hue has to author them, and forge gives that job a shape that most colour advice does not: the
steps are not decoration, they are the operands of a mapping `theme-base.css` has already written.
Read the mapping first, then pick values that survive it.

The four shipped schemes are worked examples of the *shape* — twelve solid steps, once each, and
nothing else — but not of the authoring, because each of them sidesteps
the hard half the same way: every step's lightness is Radix's, so no lightness in them was chosen
against forge's mapping. Only the hue was chosen. The example of a scale with *authored* values in it
is in `src/ui/README.md`, and it is written in `oklch()`.

Default: a scale is authored in a colour space that carries lightness as its own coordinate —
`oklch()`, the form `src/ui/README.md` writes it in — so that a step can be moved lighter or darker
without dragging its hue and its chroma along, unless the scale inherits its lightness from an
existing ramp that already holds balanced steps, which is what all four shipped schemes
do. <!-- rule:forge-ui-color-ramp-author-lightness -->

The reason to reach for that space is not fashion. Every repair in this section is "move one step's
lightness and leave everything else alone", and in a notation where lightness is entangled with the
other two coordinates that edit cannot be expressed — so it is made by eye, and the scale drifts in
hue as it descends.

Default: steps 1, 2, 11 and 12 keep a visible amount of the brand hue rather than resolving to white
and black, because those four are exactly where `theme-base.css` puts the page ground, the raised
surface and the default text in the two modes, unless a brief pins a neutral page and confines the
brand hue to `--primary` — the per-token override `src/ui/README.md`
documents. <!-- rule:forge-ui-color-ramp-author-endpoint-tint -->

A scale that bleaches its ends spends its brand on the steps nobody looks at and publishes a grey
page, which is the opposite of the intent that motivated authoring one at all.

Default: the tint runs through the whole scale, not only its ends — the middle steps carry the same
hue at a chroma low enough to read as neutral — which is the *only* thing separating the four
shipped schemes from one another: `theme-stone.css` is warm, `theme-gray.css` cool and
`theme-slate.css` strongly cool, `theme-neutral.css` sits at no tint at all, and the twelve
lightnesses are otherwise the same decision. Unless a brief fixes untinted greys, usually because a
second brand colour has to sit beside them without either one
bending. <!-- rule:forge-ui-color-ramp-author-tinted-neutrals -->

**How much tint is a question of what else carries the identity.** A neutral calibrated to sit under
a saturated accent only has to lean toward it, because the accent is doing the work; a scheme that is
*all* there is has to carry the identity itself, and a lean that reads as deliberate under an accent
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

Default: a newly authored scale is measured on the pairs `theme-base.css` actually consumes —
`--foreground` on `--background`, `--muted-foreground` on `--muted`, `--card` against the page,
`--input` and `--ring` against the surface behind them — in both `:root` and `.dark`, unless the
new scale only rotates the tint of an already-audited one at identical lightness, which is the
carve-out `forge-ui-color-theme-per-theme-audit` already
states. <!-- rule:forge-ui-color-ramp-author-audit-pairs -->

Where a pair misses, the repair is to move that one *step's* lightness. It is **not** to lower the
chroma of the scale until the numbers pass: draining chroma raises contrast for the pair you were
looking at and turns the brand scale back into grey everywhere else, which converts a local failure
into a global one. `--muted-foreground` on `--muted` is where this bites first, for the reason
`forge-ui-color-theme-muted-pair` gives.

## `--destructive` pairs like every other surface token

`--destructive` pairs with `--destructive-foreground`, in both modes, exactly as `--success` and
`--warning` do. It reads three ways and all three are supported: as text (`text-destructive`), as a
border (`border-destructive`), and as a fill — where the pair supplies the foreground so no call
site has to choose one.

| You want | Do |
|---|---|
| Destructive text on a normal surface | `text-destructive` on `--background`, `--card` or `--muted` |
| A filled destructive button | `Button variant='destructive'` |
| A destructive badge or alert | `Badge variant='destructive'` or `Alert variant='destructive'`, and set no colours yourself |

Default: `bg-destructive` is set together with `text-destructive-foreground` and never with a
foreground picked by hand, unless the destructive colour is being used as text or as a border
rather than as a fill. <!-- rule:forge-ui-color-semantic-destructive-pair -->

The rule id is older than the pair and is kept deliberately — it used to say the opposite, that
`bg-destructive` required a hand-verified foreground because no token existed. Renaming it would
strand every citation of it; the id names the *question*, and the answer is what changed.

## Status colour is forge's; the fills are the app's

Four intents — `danger`, `warning`, `success`, `info` — each with five roles, make up the
`--status-*` family:

| Role | Use for |
|---|---|
| `--status-danger-subtle` / `--status-danger-subtle-foreground` | The panel tier: `Alert`, `Toast`, and the banners `src/http/fragment.ts` renders |
| `--status-danger-strong` / `--status-danger-strong-foreground` | The chip tier: `Badge`, which starts one stop in because a filled chip sits on a tinted surface rather than a panel's |
| `--status-danger-border` | The edge of either tier |

The other three intents take the same five roles, spelled `--status-warning-*`,
`--status-success-*` and `--status-info-*`. The info intent has no *solid* pair — a saturated fill
with a foreground sitting on it, the way `--destructive` and `--success` do — because no component
renders one, and a token with no consumer is a token nobody checks.

**The ownership split is the point.** `--destructive`, `--success` and `--warning` are **fills the
application owns**: an app may re-point them to its brand. `--status-*` are **fixed status hues forge
owns**, which no scheme swap and no brand re-point moves — and no shipped scheme moves anything else
either, since a theme file re-declares the gray steps and nothing more. So
`bg-destructive text-destructive-foreground` on a failure panel is still the wrong reach, for the
reason it always was: a panel that follows the brand stops meaning "failed". What changed is that the
right reach is now a token rather than a hand-written palette pair.

Default: a status surface is expressed with the `--status-*` token for its intent and tier — or by
consuming the `Alert`, `Toast` or `Badge` variant that already does — and never with a fixed palette
utility, unless a brief calls for a signal hue outside forge's four intents, in which case it is
declared as a token pair in a theme file, or written as a light utility with its own `dark:`
counterpart. <!-- rule:forge-ui-color-semantic-variant-fixed -->

**That rule used to say the opposite.** It required a fixed palette utility with a `dark:` twin,
because before the family existed there was no blue, emerald or yellow token to reach for, and
`Alert`, `Badge` and `Toast` were its worked example. The id is kept and the sentence inverted, on
the precedent `forge-ui-color-semantic-destructive-pair` set one section up: the id names the
*question* — how does a status surface get its colour — and only the answer changed. Renaming it
would strand every citation.

The `dark:` half is gone with it. A fixed light surface never became theme-independent under `.dark`
— it became a near-white rectangle on a near-black page — and each variant answered that with a
hand-written twin. A step answers it structurally instead: `--status-danger-subtle` resolves through
`--red-2`, which is `light-dark(red-50, red-950)`, so the panel is a tinted region in
either mode and nothing at the call site says so. Forge's source now contains no `dark:` utility at
all.

The measured ratios are not written here, and are not written in the components either. They are
contract rows in `src/pkg/gate/checks/contrast-parse.ts`, beside the values they describe and re-checked on
every gate run. `alert.tsx` carried them in a comment until the family landed, and carrying them
there is what let four of them be wrong for as long as they were.

`forge.css` now declares `@custom-variant dark (&:where(.dark, .dark *));` itself, so a consuming app
no longer adds it — and, since that reconfigures the *app's* own `dark:` utilities too, the escape
hatch is re-declaring the variant after the import. `src/ui/README.md` owns that setup.

## Radius is one decision, not four

There is one `--radius`. `--radius-sm`, `--radius-md`, `--radius-lg` and `--radius-xl` are all
computed from it, so changing the one value moves the whole system together.
`forge-ui-one-radius` is the Floor; the practical consequence is that a hand-typed corner radius
anywhere in application markup is a value that will not move when the theme does.

## Sources

**Radix Colors** supplies the **lightness** of every step in every scheme, and every value in
`theme-neutral.css`. It is `@radix-ui/colors` 3.0.0, MIT-licensed. The default scheme is achromatic,
so its twelve solid steps are Radix's `gray` verbatim except for the light-mode 1↔2 swap described
above; `theme-stone.css`, `theme-gray.css` and `theme-slate.css` keep those lightnesses and replace
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
is the fragility `forge.css`'s `@source` comment already documents. The step *values* come from those
two sources; **which role reaches for which step is forge's own decision**, and the border tokens are
where forge and Radix deliberately disagree.

The colour reasoning re-derived here — a finite scale of neutrals rather than shades invented per
component, roles named before values, and colour as reinforcement of a signal that is already
carried in text — draws on *Refactoring UI* by Adam Wathan and Steve Schoger. Every rule was
rewritten against forge's own system: the twelve-step scale in the scheme files and the semantic
layer in `theme-base.css`,
the `color-scheme` that picks each step's mode, and the `--status-*` family the `Badge`, `Alert` and `Toast`
variants render. The scale-authoring section draws on the same book's account of building a palette
before building screens, re-derived here against the steps `theme-base.css` consumes.

Three of that account's claims were read and deliberately **not** given rule ids:

- **"Prefer HSL to hex."** Forge's own worked scale in `src/ui/README.md` is `oklch()`. Publishing
  the preference would have the corpus contradict the example it points readers at, so the rule
  above states what the notation has to *do* — carry lightness as its own coordinate — and lets the
  example name the form.
- **A count of shades per hue.** Already stated at the top of this file, where the twelve steps are
  argued for. A second id would be a second citation anchor for one sentence.
- **Rotating hue to keep perceived brightness even as lightness changes.** True, and general colour
  theory: it terminates in no forge token, primitive or utility, so it fails the admission test
  this corpus applies to every rule. It is worth knowing while authoring a scale; it is not a rule a
  finding could cite.
