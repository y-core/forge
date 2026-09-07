---
title: Color
description: "The two layers of forge's colour system, and how a surface picks a pair rather than a shade."
---

# Color

Forge's colour system is two layers.

Underneath is the **scale** in a scheme file — twelve numbered steps, `--gray-1` through `--gray-12`
— alongside the fixed status hues in `theme-colors.css`. Each step holds a **literal value** covering both modes, and names a
_position in the system_: the app background, a subtle border, a low-contrast text colour.

On top is the semantic layer in `theme-base.css`, which maps a step onto a name describing a
_use_: `--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--border`, and the rest.
That file declares the mapping, the `color-scheme` that picks each step's mode, and nothing else —
no scale, and no colour value at all.

**A theme file re-declares the twelve steps, once each, and nothing else.** Four schemes ship and none is mandatory: `theme-neutral.css` is the default, which
`forge.css` imports, so forge renders correctly with no theme file of the application's own, and
`theme-stone.css` (warm), `theme-gray.css` (cool) and `theme-slate.css` (strongly cool) override the
steps to change the tint. Tailwind's ramp named `gray` is blue-tinted, so the achromatic scheme is
`theme-neutral.css` rather than `theme-gray.css` — the names invite the opposite reading.

Everything in this file follows from that split. Authoring a scale of your own — what a step
means, and how to pick twelve values that survive the mapping — is
[`04-color-authoring.md`](./04-color-authoring.md)'s, which also carries the palette attribution
for both files.

## 0. Quick Reference

- §1 The scale is finite on purpose: twelve steps with published meanings, looked up rather than eyeballed
- §1a Why twelve steps, and never a generated shade: enough for every role, few enough to agree on
- §1b Decorative lines against affordances: which borders have a contrast floor and which do not
- §1c Where forge's role mapping departs from Radix's: the measured reason the border tokens moved
- §1d One step along the scale, never an opacity tint: what compositing costs, and the absolute alpha ramps
- §2 The semantic layer, and what each token is for: the pair table, and interactive state on `--accent`
- §3 Colour supports meaning; it never carries it: every state distinguished by a word, an icon or a position
- §3a Before / after — status in a table: two reds and an `aria-hidden` dot, against a labelled badge
- §4 Dark mode is the argument for tokens: `.dark` sets `color-scheme` and re-declares nothing
- §4a Why a raw utility is a defect: it survives the theme switch, and surviving is the failure
- §4b Before / after — a status panel: three fixed greys inverting under `.dark`
- §5 Contrast is per scheme, per mode: one lightness ramp, so one set of measurements describes all four
- §5a Auditing a pair, a scheme and a theme file: both modes, every scheme, and the pair with least headroom
- §6 `--destructive` pairs like every other surface token: the fill, the border, and the separate text token
- §7 Status colour is forge's; the fills are the app's: four intents by five roles, and who may re-point what
- §7a The ownership split: why a failure panel that follows the brand stops meaning "failed"
- §7b Why no `dark:` twin is written: a step that resolves in both modes, so no twin is written
- §8 Tone by intent, appearance by emphasis: what the message is, and how loudly this surface says it
- §9 Radius is one decision, not four: one `--radius`, and the whole family computed from it

---

## 1. The scale is finite on purpose

### 1a. Why twelve steps, and never a generated shade

A neutral scale needs enough steps that every surface, border and text role has a defensible one, and
few enough that two designers reaching for "a light grey" land on the same value. The usual number
quoted is 8–10 greys; forge ships twelve, which covers it with room to spare — and each carries a
published meaning, so a step is looked up rather than eyeballed.

Default: a shade comes from a declared step of the scale, or from a semantic token built on one, and
is never generated on the fly — no `color-mix` against an arbitrary percentage, no one-off opacity
faking an intermediate grey — unless a brief introduces a brand hue, which is then declared as
steps in a theme file like every other. <!-- rule:forge-ui-color-scale-ramp-only -->

Default: two adjacent steps are not used together as a foreground/background pair — `--gray-9` on
`--gray-10` is a contrast failure before it is an aesthetic one — unless the pair is a _decorative_
boundary against its own surface, where low contrast is the
point. <!-- rule:forge-ui-color-scale-adjacent-stops -->

### 1b. Decorative lines against affordances

The carve-out is **decoration, not borders as a category**, and the distinction is the one that
matters:

- A **decorative** line separates or encloses. A `Card` hairline, a `Separator`, a `Dialog` edge,
  the rule between two table rows. Nothing about it identifies a control or reports a state, so
  WCAG 1.4.11 does not bind and a whisper-quiet line is the correct design.
- An **affordance** tells the reader something is operable, or what state it is in. A text field's
  outline, a `Switch` track, a `Slider` track, a focus ring. These are non-text contrast under
  WCAG 1.4.11 and must clear **3:1** against the surface behind them — adjacent step or not.

### 1c. Where forge's role mapping departs from Radix's

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
_called_ the UI element border puts a text field's sole boundary back under the floor.

**Steps 7 and 8 keep Radix's values.** The two systems are not in disagreement — they answer
different questions with different instruments. Radix's guarantee is about _text_, at steps 11 and 12, and is stated in APCA;
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

### 1d. One step along the scale, never an opacity tint

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
over a dark one. A scrim has to darken whatever is behind it in _both_ modes, so a page-relative step
cannot express one, which is why forge ships no per-scheme alpha scale. `--overlay` is `--black-a6`,
the dialog backdrop.

The `--cast-*` and `--rim-*` families in `theme-colors.css` are the sanctioned mode-swapping
composition of those two ramps: each is a `light-dark()` that selects one absolute step against
`transparent`, so a single shadow value can carry ink in light and a rim in dark. See `05-depth.md`
for what they express; anything else built this way belongs beside them, as a step, rather than in a
component rule.

## 2. The semantic layer, and what each token is for

| Token pair | Use for |
| --- | --- |
| `--background` / `--foreground` | The page itself, and its default text |
| `--card` / `--card-foreground` | A raised object — `Card` sets both |
| `--popover` / `--popover-foreground` | Layered surfaces: `Menu`, `Popover`, `Tooltip` |
| `--primary` / `--primary-foreground` | The one primary action; see `01-hierarchy.md` |
| `--secondary` / `--secondary-foreground` | A filled but subordinate surface |
| `--muted` / `--muted-foreground` | A recessed panel, and every line of supporting text |
| `--accent` / `--accent-foreground` | Interactive state — hover, open, selected |
| `--destructive` / `--destructive-foreground` / `--destructive-text` | A destructive fill and the text on it; `-text` is the tone read as text on a page. The app's colour to re-point |
| `--success` / `--success-foreground` / `--success-text` | A confirmed outcome, as a fill and as text. The app's colour to re-point |
| `--warning` / `--warning-foreground` / `--warning-text` | A caution. The fill pair inverts — dark text on yellow. The app's colour to re-point |
| `--border` | Decorative separation only — hairlines, dividers, surface edges. No contrast floor |
| `--input` | A control's boundary — text fields, `Select`, `Textarea`, and every `border-input`. 3:1 |
| `--track` | The off-state fill of a `Switch` or `Slider` track. Its own token on the same step as `--input`, not an alias of it. 3:1 |
| `--ring` | The focus indicator, drawn inside the control. One step beyond `--input`, so a focused control advances. 3:1 |
| `--overlay` | The modal scrim, on an absolute alpha step so it darkens whatever is behind it in either mode |

The twenty `--status-*` tokens are the other half of the semantic layer, and they answer a different
question — see §7.

Default: interactive feedback — hover, open, selected — is expressed with `--accent` and its
paired foreground, as `buttonVariants` does for `secondary` and `ghost`, unless the element's
resting state is already `--accent`, in which case it moves to `--primary`. <!-- rule:forge-ui-color-semantic-accent-interactive -->

Default: a background token is set together with its `*-foreground` partner and never with a
foreground from a different pair, unless the element inherits a foreground from a parent that has
already set the matching one. <!-- rule:forge-ui-color-semantic-pairing -->

`forge-ui-foreground-pairing` is the Floor that makes this non-negotiable; the rule above is the
positive form of it, and the table is where you look up which partner is correct.

## 3. Colour supports meaning; it never carries it

A red badge means "failed" only to a reader who can see red, is not looking at the screen in
sunlight, and already knows the convention. Everyone else needs the word.

Default: every state distinguished by colour is also distinguished by a word, an icon, or a
position — a `Badge` says "Failed" as well as being red, an `Alert` carries an `Alert.Title` — as
required by the Floor rule `forge-ui-not-color-alone`, unless the colour is decorative and encodes
no state at all. <!-- rule:forge-ui-color-semantic-support-only -->

### 3a. Before / after — status in a table

```tsx
import { Badge } from "@y-core/forge/ui/core";

<Badge tone={job.failed ? "destructive" : "primary"} appearance='solid' aria-hidden='true'>
  ●
</Badge>;
```

Costs the column its meaning for anyone who cannot resolve the two reds, and `aria-hidden` removes
the state from the accessibility tree entirely, so a screen reader announces an empty cell.

```tsx
import { Badge } from "@y-core/forge/ui/core";

<Badge tone={job.failed ? "destructive" : "neutral"} appearance='outline'>
  {job.failed ? "Failed" : "Complete"}
</Badge>;
```

## 4. Dark mode is the argument for tokens

`.dark` does not add a second stylesheet, and it does not re-declare a single semantic token. It sets
`color-scheme: dark`, which picks the dark branch of every **step** those tokens resolve through. The
values below are `theme-neutral.css`'s scale, which is what an app gets with no theme file of its own:

| Token | Step | Light branch | Dark branch |
| --- | --- | --- | --- |
| `--background` | `--gray-1` | `#f9f9f9` | `#111111` |
| `--foreground` | `--gray-12` | `#202020` | `#eeeeee` |
| `--card` | `--gray-2` | `#fcfcfc` | `#191919` |
| `--muted` | `--gray-3` | `#f0f0f0` | `#222222` |
| `--muted-foreground` | `--gray-11` | `#646464` | `#b4b4b4` |
| `--primary` | `--accent-12` | `#202020` | `#eeeeee` |
| `--border` | `--gray-6` | `#d9d9d9` | `#3a3a3a` |
| `--input` | `--gray-10` | `#838383` | `#7b7b7b` |
| `--ring` | `--gray-11` | `#646464` | `#b4b4b4` |

Read the last two columns as the two branches of the _step's_ one declaration, not as the token's
value. Each token in the first column is declared exactly once and means the same thing in both modes — `--background` is the app
background whichever mode is on. That is what makes the number of mode-varying decisions at the
semantic layer zero, and it is why the override point for a per-mode value is the step.
`--accent-12` is an alias of `--gray-12`, which is why `--primary` and `--foreground` read the same
value here.

### 4a. Why a raw utility is a defect

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

The exemption is not the ordinary case. The `--status-*` family covers every status surface, so the
paired form is what is left for a hue outside the token set — a brand's own signal colour, not
"failed" or "succeeded".

### 4b. Before / after — a status panel

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

## 5. Contrast is per scheme, per mode

`forge-ui-contrast-floor` fixes the ratios. What that Floor does not say, and what the layering makes
easy to forget, is that a passing ratio is a property of _one scale in one mode_.

**All four shipped schemes are built on one lightness ramp and differ only in hue**, so every
audited ratio is the same across them to within **0.05** — the widest gap at any audited step
is `--muted-foreground` in light, 5.17 through 5.22 — by construction rather than by coincidence,
which is why the contract in `src/tooling/gate/checks/contrast-parse.ts` can pin one set of numbers and have them
describe every scheme alike. A scheme swap cannot move a pair across its floor.

One measurement describes any scheme built this way, not merely the ones that have been measured.
The ratios themselves are `src/tooling/gate/checks/contrast-parse.ts`'s to own.

That guarantee is a property of the construction, not of theming in general. A scheme an application
authors itself is on its own ramp and is bound by no such distance, which is what the rules below are
for.

The `--status-*` pairs are the exception, and only because no neutral step participates in them: both
halves of a status pair come from the fixed hue itself, so those ratios are the same under every
scheme. Everything a gray step touches is per scheme.

### 5a. Auditing a pair, a scheme and a theme file

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
step's lightness, which is exactly the case the exemption names.

## 6. `--destructive` pairs like every other surface token

`--destructive` pairs with `--destructive-foreground`, in both modes, exactly as `--success` and
`--warning` do. It reads three ways and all three are supported: as a fill — where the pair supplies
the foreground so no call site has to choose one — as a border, and as text, which is a **different
token**: `--destructive-text`.

The split is not a nicety. `--destructive` is held across modes so a near-white foreground clears it
in both; a held dark red is unreadable as text on a dark page, which is what `--destructive-text`
exists for. The same holds for `--info`, `--success` and `--warning`
([`THEME_GENERATION.md`](../../../../docs/THEME_GENERATION.md) §4).

| You want | Do |
| --- | --- |
| Destructive text on a normal surface | `text-destructive-text` on `--background`, `--card` or `--muted` |
| A filled destructive button | `Button tone='destructive'` |
| A destructive badge or alert | `Badge tone='destructive'` or `Alert tone='destructive'`, and set no colours yourself |

Default: `bg-destructive` is set together with `text-destructive-foreground` and never with a
foreground picked by hand; the destructive colour used as text is `text-destructive-text` rather
than the fill. <!-- rule:forge-ui-color-semantic-destructive-pair -->

## 7. Status colour is forge's; the fills are the app's

Four intents — `danger`, `warning`, `success`, `info` — each with five roles, make up the
`--status-*` family:

| Role | Use for |
| --- | --- |
| `--status-danger-subtle` / `--status-danger-subtle-foreground` | The panel tier: `Alert`, `Toast`, and the banners `src/http/fragment.ts` renders |
| `--status-danger-strong` / `--status-danger-strong-foreground` | The chip tier: `Badge`, which starts one stop in because a filled chip sits on a tinted surface rather than a panel's |
| `--status-danger-border` | The edge of either tier |

The other three intents take the same five roles, spelled `--status-warning-*`,
`--status-success-*` and `--status-info-*`. The info intent has no _solid_ pair — a saturated fill
with a foreground sitting on it, the way `--destructive` and `--success` do — because no component
renders one, and a token with no consumer is a token nobody checks.

### 7a. The ownership split

**The ownership split is the point.** `--destructive`, `--success` and `--warning` are **fills the
application owns**: an app may re-point them to its brand. `--status-*` are **fixed status hues forge
owns**, which no scheme swap and no brand re-point moves — and no shipped scheme moves anything else
either, since a theme file re-declares the gray steps and nothing more. So
`bg-destructive text-destructive-foreground` on a failure panel is still the wrong reach, for the
reason it always was: a panel that follows the brand stops meaning "failed". The right reach is a
`--status-*` token.

Default: a status surface is expressed with the `--status-*` token for its intent and tier — or by
consuming the `Alert`, `Toast` or `Badge` tone that already does — and never with a fixed palette
utility, unless a brief calls for a signal hue outside forge's four intents, in which case it is
declared as a token pair in a theme file, or written as a light utility with its own `dark:`
counterpart. <!-- rule:forge-ui-color-semantic-variant-fixed -->

### 7b. Why no `dark:` twin is written

A fixed light surface is not theme-independent under `.dark` — it is a near-white rectangle on a
near-black page — so expressing one takes a hand-written twin. A step answers it structurally
instead: `--status-danger-subtle` resolves through `--red-2`, which is
`light-dark(red-50, red-950)`, so the panel is a tinted region in either mode and nothing at the
call site says so. Forge's source contains no `dark:` utility at all.

The measured ratios are not written here, and are not written in the components either. They are
contract rows in `src/tooling/gate/checks/contrast-parse.ts`, beside the values they describe and re-checked on
every gate run.

`forge.css` declares `@custom-variant dark (&:where(.dark, .dark *));` itself, so a consuming app
does not add it — and, since that reconfigures the _app's_ own `dark:` utilities too, the escape
hatch is re-declaring the variant after the import. `src/ui/README.md` owns that setup.

## 8. Tone by intent, appearance by emphasis

`tone` and `appearance` are two questions, not one: what the message _is_, and how loudly this
surface has to say it. `Button`, `Badge`, `Alert` and `Toast` all read the same tones through
`toneVariants`, so the same word means the same thing wherever it is passed.

Default: pick `tone` from what the message is — `destructive` for loss or an irreversible act,
`warning` for a risk the reader can still avoid, `success` for a claim that something completed,
`info` for neutral information, `primary` for the one primary action a surface has, and `neutral`
for everything else — unless a brief gives a tone its own meaning, which is then applied everywhere
that meaning appears. <!-- rule:forge-ui-tone-by-intent -->

A tone chosen for how it looks rather than for what it means is how a page ends up with three
primary buttons and a green chip reporting a failure.

Default: `soft` is the resting emphasis for `Alert`, `Badge` and `Toast`, and `solid` is reserved
for the one surface that must lead the page, never two solid panels in view at once — unless the
component is `Button`, whose resting appearance is its own fill. <!-- rule:forge-ui-soft-vs-solid -->

Emphasis is relative: a second filled panel does not double the urgency, it halves the first one's.
All three components already default to `soft`, so the shipped default is the rule and passing
`appearance='solid'` is the decision that has to be worth making.

## 9. Radius is one decision, not four

There is one `--radius`. `--radius-sm`, `--radius-md`, `--radius-lg` and `--radius-xl` are all
computed from it, so changing the one value moves the whole system together.
`forge-ui-one-radius` is the Floor; the practical consequence is that a hand-typed corner radius
anywhere in application markup is a value that will not move when the theme does.
