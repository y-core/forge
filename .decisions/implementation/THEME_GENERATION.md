---
title: Theme Generation Contracts
description: "The dial model a generated colour scheme is produced from, the emission contract, and the contrast-audit data the gate and the customiser both consume."
---

# Theme Generation Contracts

> Owns the shared data a colour scheme is *generated* and *audited* against: the dials a scheme
> is produced from, the pipeline that turns them into a scheme file, and the audited pair list
> the verification gate and the browser customiser read from one declaration.
>
> It does not own how a scheme file is *declared* — that is
> [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §5 — nor how the customiser page is reached,
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
- §2 Generation Pipeline: five numbers to a complete scheme
- §2a From Dials to Both Families in Both Modes: what `buildTheme` produces and why two representations are kept
- §2b Emission Contract: one declaration site per step, and standalone-completeness
- §2c No Generated Colour Reaches Markup: the CSP constraint that forces CSSOM painting
- §3 Contrast Audit Contract: the pair list forge measures itself against
- §3a Audited Pairs and Criteria: the declaration the gate consumes, and what a pair records
- §3b Accepted Exemptions: a mandatory reason, a pinned value, and no third state
- §3c The Live Readout Reuses the Audit: why the customiser measures the same pairs, and what it cannot measure

---

## 1. One Declaration, Three Consumers

The theme data has three readers that cannot see each other: the Worker-side customiser page, the
browser scope that repaints it, and the verification gate that runs in neither. A value duplicated
across those three drifts silently — the page keeps rendering, the browser keeps painting, and only
the number a reader is shown becomes wrong.

That is the argument [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §4 makes for state
attributes, applied to a third reader. The data therefore lives in `ui/contracts`, which is a leaf
namespace ([`NAMESPACES.md`](./NAMESPACES.md) §4a), and the gate reaches it
by importing it into `config/steps.ts` rather than by re-declaring it.

**Nothing in this document enumerates a dial, a pair, or a ramp.** The declaring modules named in
the blockquote above are authoritative over any prose here, and they are registered as such in
[`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8.

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

**The browser half never navigates.** It repaints in place and *publishes* the equivalent link
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

---

## 2. Generation Pipeline

### 2a. From Dials to Both Families in Both Modes

`buildTheme` produces both families, in both modes, from the dials alone. The fixed half of a scale
is a per-step lightness with a chroma shape over it (`src/ui/contracts/theme/color.ts`); the dials supply
the hue and the peak chroma the shape is scaled by, which is what makes a scheme five numbers
rather than twenty-four colours.

**Each step is kept in two representations, and the second is not redundant.** The OKLCh string is
what a scheme file declares ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §5a); the
byte-quantised sRGB value beside it is what the contrast ratios and the preview swatches are
computed in, because that is the colour a reader is actually shown. Deriving one from the other at
measurement time would measure a colour no display paints.

**Every emitted coordinate is gamut-mapped**, for the reason
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §5a gives: an audited ratio must describe the
colour that renders.

### 2b. Emission Contract

**The generator is held to the declaration contract rather than exempted from it.**
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §5 owns both halves — one declaration site per
step, and standalone-completeness — and what is local here is how the emitter satisfies them: a
step whose two modes agree collapses to a bare value and every other step is wrapped, and
`--accent-contrast` is **derived from the audit's own `ACCENT_CONTRAST` side** rather than written
out, so the two steps the file declares are provably the two the live measurement reads.

**The corner radius is driven directly rather than through a scale**, because it is not a colour
and has no twelve steps; it is a dial whose whole output is one custom property.

### 2c. No Generated Colour Reaches Markup

**The customiser paints through CSSOM, never through a rendered `style` attribute** — the same
pair `openPopoverAt` runs into ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2i), owned by
[`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1a.

**The consequence is a real constraint on the page, not an implementation detail.** Server-rendered
markup carries the *structure* of the preview and the *keys* the painter writes into; the colour
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
check's own — [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8 names the files, and this section names no
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
list that happens to agree today.

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
