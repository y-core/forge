---
title: Theme Generation Contracts
description: "The dial model a generated colour scheme is produced from, the emission contract, and the contrast-audit data the gate and the customiser both consume."
audience: consumer
---

# Theme Generation Contracts

> Owns the shared data a colour scheme is _generated_ and _audited_ against: the dials a scheme
> is produced from, the pipeline that turns them into a scheme file, and the audited pair list
> the verification gate and the browser customiser read from one declaration.
>
> It does not own how a scheme file is _declared_ — that is
> [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §2 — nor how the customiser page is reached,
> which is [`UI_SHOWCASE.md`](./UI_SHOWCASE.md) §1b.
>
> Defers to: `src/ui/contracts/theme/theme-contract.ts`, `src/ui/contracts/theme/color.ts`,
> `src/ui/contracts/theme/contrast-pairs.ts` and `src/ui/contracts/theme/contrast-accepted.ts` for every
> value; `config/steps.ts` for the gate's configuration; `src/ui/README.md` for the customiser's
> routes, props and worked usage.

---

## 0. Quick Reference

- §1 One Declaration, Three Consumers: why this data sits in `ui/contracts` rather than beside any one reader
- §1a The Dial Declaration and Its Units: what `DIALS` owns, and the one unit convention a reader must know
- §1b The Query String Is the Whole State: no storage, and therefore no second pre-paint script
- §1c Presets Are Fitted Aliases, Not a Second Source: input-only parameter, explicit dial wins, and a command rather than a binding
- §1d Shape Tokens Are Not a Scheme: the eight non-colour tokens, where they are declared, and why a scheme file never carries one
- §2 Generation Pipeline: five numbers to a complete scheme
- §2a From Dials to Both Families in Both Modes: what `buildTheme` produces and why two representations are kept
- §2b The OKLab Conversion Has One Home, Two Gamut Policies: who owns the arithmetic, and why the gate clips where the generator reduces chroma
- §2c Emission Contract: one declaration site per step, and standalone-completeness
- §2d No Generated Colour Reaches Markup: the CSP constraint that forces CSSOM painting
- §3 Contrast Audit Contract: the pair list forge measures itself against
- §3a Audited Pairs and Criteria: the declaration the gate consumes, and what a pair records
- §3b Accepted Exemptions: a mandatory reason, a pinned value, and no third state
- §3c The Live Readout Reuses the Audit: why the customiser measures the same pairs, and what it cannot measure
- §3d A Focus Ring Is Read Against the Surface It Is Drawn On: the audited row, the fill the gray step fails, and why the choice is per-appearance
- §4 A Status Hue Holds Its Fill: the accent ramp's shape applied to the four intents
- §4a One Value Cannot Be Both a Fill and Text: the defect the hold fixes, and what flips instead
- §4b Three Tokens Per Intent: the naming that follows, and the rows the audit gains
- §4c Success Unifies on Emerald: one hue per intent, and the two steps that retire

---

## 1. One Declaration, Three Consumers

The theme data has three readers that cannot see each other: the Worker-side customiser page, the
browser scope that repaints it, and the verification gate that runs in neither. A value duplicated
across those three drifts silently — the page keeps rendering, the browser keeps painting, and only
the number a reader is shown becomes wrong.

That is the argument [`STATE_ATTRIBUTES.md`](./STATE_ATTRIBUTES.md) §1 makes for state
attributes, applied to a third reader. The data therefore lives in `ui/contracts`, which is a leaf
namespace ([`NAMESPACES.md`](./NAMESPACES.md) §4a), and the gate reaches it
by importing it into `config/steps.ts` rather than by re-declaring it.

**Nothing in this document enumerates a dial, a pair, or a ramp.** The declaring modules named in
the blockquote above are authoritative over any prose here, and they are registered as such in
[`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §8.

### 1a. The Dial Declaration and Its Units

**A dial is declared once and carries everything about itself** — the state field, the query
parameter, the accessible name, the range, the step, and the value an absent parameter means. The
loader, the sliders, the browser scope and the share link all read that one row, so adding a dial
is a data edit rather than a change in four places.

**One unit convention is not derivable and is therefore stated: a chroma dial carries
thousandths.** The control is an integer slider, and `buildTheme` divides on the way in. A reader
who assumes the dial value is the OKLCh chroma is out by three orders of magnitude, and the page
still renders.

### 1b. The Query String Is the Whole State

**The customiser's loader reads the dials from the query string and from nothing else.** There is
no storage, no cookie, and no server-side session, so a scheme is a link: sharing one is sharing
the URL, and reloading is reproducing it exactly.

**This is why the customiser mints no pre-paint script.** The precedent in
[`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2b is that an inline script is for state the
server cannot know; every dial arrives in the request, so the server can render the correct scheme
and there is no intermediate state to correct.

**The browser half never navigates.** It repaints in place and _publishes_ the equivalent link
rather than writing one into the address bar, so a drag costs no history entry and no request.

### 1c. Presets Are Fitted Aliases, Not a Second Source

A shipped scheme is reproducible from two gray dials, and a preset is that pair under a name.
Three properties keep the alias from becoming a second source of truth:

- **The preset parameter is input-only, and an explicit dial beside it wins.** It expands to dial
  values during the load and is never emitted, so no state can be expressed two ways at once.
- **Picking a preset is a command, not a binding.** The pick fires a scope action that writes the
  two dials; the painter then reacts exactly as it does to a drag. A binding would make the picker a
  second holder of the scheme's state.
- **Which preset the dials name is derived, never stored.** A lever dragged off a preset moves the
  picker to the custom option, because a control naming `slate` beside a scheme whose dials have
  drifted off `slate` is the disagreement the live readouts exist to prevent.

**The preset values are fitted to the shipped scheme files, not transcribed from them**, and the
fit is re-derived against those files by `src/ui/contracts/theme/color.test.ts` rather than asserted here.

### 1d. Shape Tokens Are Not a Scheme

**Shape lives in `theme-base.css`, and a scheme file never declares it.** The eight tokens —
`--radius`, `--radius-field`, `--radius-box`, `--radius-selector`, `--control-h-sm`,
`--control-h-md`, `--control-h-lg` and `--border-width` — are declared once beside the semantic
colour mapping, and every component reads them through the bridged utilities (`rounded-field`,
`rounded-box`, `rounded-selector`, `h-control-*`, `border-field`) rather than through a raw
Tailwind size.

**Why not a scheme file.** A scheme is the file a consumer replaces, and the contrast audit walks
every `theme-*.css` on the assumption that it holds colour steps and nothing else
(§3a). Putting a radius in one would either make each of the four schemes restate a value that has
nothing to do with its tint, or hand the audit a token it cannot measure. Keeping shape in the
mapping file means any scheme composes with any shape, and the audit's assumption stays true.

**The alternate ships as proof, not as a catalogue.** `shape-compact.css` re-declares exactly the
eight tokens and is imported after `forge.css`, the same cascade a scheme uses. Its name deliberately
does not start with `theme-`, which is the prefix the audit takes as "a scheme". An application's own
shape file follows the same shape: one `:root` block, those tokens, nothing else.

**`border-field` is an `@utility`, not a theme token.** A `--border-width-*` token would compile to a
`border-*` utility, the namespace [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §2f names as
overloaded between colour and width, so the width recipe is declared as a static utility in
`forge-ui.css` where `cn` reads its compiled signature unambiguously.

**The customiser's shape dials drive these tokens directly**, as `--radius` always was (§2b): a dial
whose whole output is one custom property, with no scale behind it. Four dials cover five of the
tokens — `radiusField` writes `--radius-field`, `radiusBox` writes `--radius-box`, and `controlH`
writes `--control-h-md` with `--control-h-sm` and `--control-h-lg` 8px either side of it, which is
the list `SHAPE_PROPERTIES` names and `shapeVars` values. `--radius-selector` and `--border-width`
are not dialled: a pill is a pill at every radius, and a hairline that moves with a slider is a
different decision from a corner that does.

---

## 2. Generation Pipeline

### 2a. From Dials to Both Families in Both Modes

`buildTheme` produces both families, in both modes, from the dials alone. The fixed half of a scale
is a per-step lightness with a chroma shape over it (`src/ui/contracts/theme/color.ts`); the dials supply
the hue and the peak chroma the shape is scaled by, which is what makes a scheme five numbers
rather than twenty-four colours.

**Each step is kept in two representations, and the second is not redundant.** The OKLCh string is
what a scheme file declares ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §2a); the
byte-quantised sRGB value beside it is what the contrast ratios and the preview swatches are
computed in, because that is the colour a reader is actually shown. Deriving one from the other at
measurement time would measure a colour no display paints.

**Every emitted coordinate is gamut-mapped**, for the reason
[`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §2a gives: an audited ratio must describe the
colour that renders.

### 2b. The OKLab Conversion Has One Home, Two Gamut Policies

**`src/ui/contracts/theme/color.ts` owns the arithmetic** — the twelve-coefficient
`oklabToLinearSrgb` and the `srgbGamma` transfer function, both `@public`. `src/ui/assets/build/color.ts`
and the gate's `cli/pkg/gate/checks/color.ts` import them; a third copy is where the three would
drift apart while every test kept passing.

**The direction is forced, not chosen.** `ui/contracts/theme` is a LEAF namespace, and LEAF
constrains _outgoing_ edges only — so it may be imported and may not import out, which leaves it as
the only one of the three that can hold the shared function.

**Two gamut policies exist, and only one of them is a policy of its own.** Reducing chroma at
constant lightness and hue, as CSS Color 4 specifies, is what any emitted coordinate needs, so it
lives once in `toSrgbGamut` beside the arithmetic; `ui/assets/build`'s `oklchToSrgb` composes over
it and converts the mapped coordinate rather than restating the bisection. The gate's
`oklchToPaintedHex` **clips per channel**, because a browser clips and a conformance measurement must
match what is painted — that is the one genuinely separate policy. `color.test.ts` pins both: the two
agree to twelve decimals on the conversion, and `oklchToPaintedHex(0.505, 0.213, 27.518)` is asserted
to be `#c10007` and explicitly _not_ the chroma-reduced `#bf000f`.

### 2c. Emission Contract

**The generator is held to the declaration contract rather than exempted from it.**
[`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §2 owns both halves — one declaration site per
step, and standalone-completeness — and what is local here is how the emitter satisfies them: a
step whose two modes agree collapses to a bare value and every other step is wrapped, and
`--accent-contrast` is **derived from the audit's own `ACCENT_CONTRAST` side** rather than written
out, so the two steps the file declares are provably the two the live measurement reads.

**The corner radius is driven directly rather than through a scale**, because it is not a colour
and has no twelve steps; it is a dial whose whole output is one custom property.

**Shape is emitted as a second block, under its own comment, rather than folded into the scheme.**
The scheme block stays exactly what §1d says a scheme is — colour steps and nothing else — so the
five shape declarations (`--radius-field`, `--radius-box`, `--control-h-sm`, `--control-h-md`,
`--control-h-lg`) follow it as a file a reader saves separately, the way `shape-compact.css` ships.
`--radius` is painted rather than emitted, and stays where it was.

### 2d. No Generated Colour Reaches Markup

**The customiser paints through CSSOM, never through a rendered `style` attribute** — the same
pair `openPopoverAt` runs into ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2i), owned by
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1a.

**The consequence is a real constraint on the page, not an implementation detail.** Server-rendered
markup carries the _structure_ of the preview and the _keys_ the painter writes into; the colour
arrives only once the scope resumes.

---

## 3. Contrast Audit Contract

### 3a. Audited Pairs and Criteria

**Every pair forge measures is declared in one list, and each row records what it is and what binds
it** — the token, the role it plays in the library, the step it resolves through, the two sides of
the measurement, and the WCAG criterion whose floor applies. The criteria and their floors are
declared beside it.

**The gate consumes that list rather than restating it.** `config/steps.ts` imports the pairs, the
criteria and the exemptions and hands them to the contrast step, which resolves each token through
the stylesheets and measures it. What the check asserts, in what order, with what message, is the
check's own — [`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §8 names the files, and this section names no
assertion.

**A gate that measured nothing is a failure rather than a pass**: an empty pair list is refused, so
deleting the audit cannot be mistaken for satisfying it.

### 3b. Accepted Exemptions

A pair the criteria do not bind is **recorded, not omitted**. An exemption row names the token, the
step, the value that step is pinned at in each mode, the worst-case measured ratio, and the reason
no criterion applies.

Three properties make the list a contract rather than a suppression list:

- **The reason is mandatory and non-empty.** An exemption with no stated reason does not hold, and
  the gate says so.
- **The pinned value is checked against the stylesheet.** The exemption states what its number
  measures, so a changed step value invalidates it and the gate fails rather than carrying a stale
  claim.
- **There is no third state.** A token pair is audited or accepted; a pair in neither list is one
  nobody decided about, which is the outcome both lists exist to prevent.

### 3c. The Live Readout Reuses the Audit

**The customiser measures the same pairs the gate does**, from the same declaration, so a scheme a
reader generates is judged by the criteria forge enforces on its own — not by a second, friendlier
list that happens to agree today. **Both compare the ratio unrounded**, and only the displayed
number is rounded: a pair that fails by less than the two decimals a reader is shown must fail on
both sides, or the agreement above holds everywhere except at the boundary that matters.

**A side names the family it is a step of, and may name a step per mode.** Both families are
generated, so a side resolves as `theme[family][mode].solid[sideStep(side, mode)]` and nothing else
reads `.step`. The per-mode form exists for exactly one side — `--accent-contrast`, which is
`--gray-1` in light and `--gray-12` in dark — and that asymmetry is why dark carries less headroom
than light at any given step 9. It once carried too little: a band of high-chroma greens put
`--primary-foreground` under its floor while `--accent-9` was lightness-pinned to one value for both
modes. `ACCENT_RAMP.dark.lightness[8]` is 0.5075 rather than the light ramp's 0.52 for that reason,
which is also why `--accent-9` is the one accent step the shipped scheme declares per mode.

**Only the pairs whose two sides are both steps of a generated scale can be measured live**, and
that boundary is in the data rather than in a comment: a pair resolving through a fixed token has no
generated value to measure, because the customiser generates scales and not the semantic layer above
them.

**The readout's key carries the background as well as the token**, because one token is audited
against two different backgrounds and a token-only key silently collapses those rows onto each
other. The Worker and the browser print the same text from the same computation, so the value on
first paint and the value after a drag can never disagree in format.

### 3d. A Focus Ring Is Read Against the Surface It Is Drawn On

**The audit measures `--ring` against `--muted`**, which is the surface an untoned control's focus
ring is read against. `focus-ring` draws the ring _inside_ the element
([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1e), so on a solid fill the ring is read against
that fill instead — and the gray step does not clear it: **`--ring` measures 1.03 against
`--primary` in light.**

**The remedy is per-appearance rather than a second audited row.** Every appearance recipe in
`src/ui/core/utils/tone.ts` names its own `--focus-ring` — `--tone-fg` on the solid fill, `--ring`
on the four that paint no fill — so none inherits a solid ancestor's choice. No row is added
because a ring-on-fill pair resolves through the semantic layer rather than a generated scale, which
is the boundary §3c draws, and the choice is a per-appearance token rather than a step the audit can
name.

---

## 4. A Status Hue Holds Its Fill

**A status hue's solid fill is held across modes; only its text step flips.** `--red-9`,
`--blue-9`, `--emerald-9` and `--yellow-9` resolve to one palette step in both modes, and the
near-white that clears them is written `light-dark(var(--gray-1), var(--gray-12))` — the same shape
`--accent-contrast` already has.

**The accent ramp is the precedent, not a new idea.** `--accent-9` is effectively held —
`ACCENT_RAMP.dark.lightness[8]` is 0.5075 against light's 0.52, a contrast nudge rather than an
inversion (§3c) — while `--accent-11` flips, and `--accent-contrast` is near-white in both modes
because the gray ramp's first step in light and last in dark are both near-white.

A per-mode nudge on a held fill is allowed; an inversion is not. A held value is chosen by running
the contrast step and taking the step that clears its floor in **both** modes, exactly as
`ACCENT_RAMP.dark.lightness[8]` was chosen — never by reading a number out of this document, which
enumerates none.

### 4a. One Value Cannot Be Both a Fill and Text

One token cannot answer for both roles across both modes: a step light enough to read as text on a
dark page is, as a fill, a pale slab that the near-white on it does not clear. So `--tone` and
`--tone-text` resolve to different tokens for every intent, `warning` included — its text role is
step 11, which is the shape the other three take too.

### 4b. Three Tokens Per Intent

Each intent owns three tokens, mirroring primary:

| token | role |
| --- | --- |
| `--X` | the solid fill |
| `--X-foreground` | text on that fill |
| `--X-text` | the tone as text on a page surface |

`UI_CLASS_COMPOSITION.md` §2c already rules that `--destructive` / `--success` / `--warning` **are**
fills, so the naming follows from a decision already taken. Every call site that painted error or
status text off the fill moves to the `-text` token.

The audit follows the tokens. The three "as text on a page surface" rows that measured a step 9
against `--gray-3` now measure `--destructive-text` / `--info-text` / `--success-text` on step 11,
and `--warning-text` gains the row it never had. No status pair is live-measured — `scalePairs()`
keeps only pairs with both sides on a generated scale, and every status side is fixed — so the
contrast step is the sole detector of a regression here.

### 4c. Success Unifies on Emerald

Success is one hue. The emerald ramp already carried the subtle, strong and border steps; the fill
and its contrast step join it, and `--green-9` and `--green-contrast` retire. The audit rows that
already named `--emerald-contrast` and `--emerald-9` become true rather than needing a rewrite.
