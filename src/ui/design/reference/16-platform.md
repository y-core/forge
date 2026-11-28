---
title: Platform
description: "What the browser now does in one declaration that the surrounding ecosystem still writes by hand, paired form by form."
---

# Platform

The browser now does, in one declaration, a long list of things the surrounding ecosystem still writes by hand. Every rule here names one of those
pairs: the hand-written form, and the platform feature that replaced it.

This file is organised by how strongly forge holds each pair, because the strength is what decides the shape of the sentence.

- **Tier A** is Floor, and lives in [`../floor.md`][floor]: the pattern is simply the older spelling, and it is refused.
- **Tier B** is behaviour the platform now implements: a dialog, a disclosure, a reveal. Each is a `Default:`.
- **Tier C** is the authoring form — how a stylesheet is ordered, scoped and wrapped. Each is a `Default:` too.

Patterns already named elsewhere keep their ids — `forge-ui-reduced-motion` in [`../floor.md`][floor] and `forge-ui-interaction-focus-visible` in
[`09-interaction.md`][interaction] — and are cited, never restated, because a second id for one sentence splits every finding that rests on it.

Where a rule is genuinely wrong for one line — a physical inset that must not mirror, a panel that must not light-dismiss — state the departure at
that line with a written reason, because a silent exception reads as a missed rule.

---

## 0. Quick Reference

- §1 Tier A — the older spelling: Floor rules, cited here and argued in `floor.md`, and one card that breaks four of them
- §2 Tier B — behaviour the platform implements: adopting an implementation also adopts its semantics
- §2a Modals and popovers: the native `<dialog>`, the Popover API, and light dismissal as the discriminator
- §2b Disclosure and inertness: `<details>` reaching find-in-page, and `inert` over a `tabindex` sweep
- §2c Entry, exit and repeating motion: `@starting-style` over `requestAnimationFrame`, geometry on the base selector, keyframes over `setInterval`
- §2d Paths, gradients and reveals: `offset-path`, a registered angle, a CSS mask, `animation-timeline`
- §2e Layout the platform can drive: scrolling, snapping, `anchor()` and `field-sizing`
- §2f Ancestors, counters and numbers: `:has()`, CSS counters, and an interpolated `@property`
- §2g Theme detection: why forge's own theme is script's job and the OS's is not
- §3 Tier C — the authoring form: how a stylesheet is ordered, scoped and wrapped
- §3a Cascade and scope: `@layer`, native nesting, `@scope`, and `:is()` against a comma list
- §3b Container queries and subgrid: sizing against a container, and inheriting a parent's tracks
- §3c Height interpolation and `display: contents`: `interpolate-size`, and the box a wrapper takes with it
- §3d Controls: `accent-color`, and the view transition a full navigation earns
- §3e Type: `text-balance` above `text-2xl`, `text-pretty` on body copy, and a self-sizing `Textarea`
- §3f The one place the modern answer is refused: ring, border and outline tokens are excluded outright
- §4 Sources: the curation this file's catalogue rests on, and what was re-derived

---

## 1. Tier A — the older spelling

Flat, and not rebuttable. Each of these is a pattern whose replacement renders the same box, so each is Floor: `forge-ui-platform-aspect-ratio`,
`forge-ui-platform-centering`, `forge-ui-platform-scrollbar`, `forge-ui-platform-line-clamp`, `forge-ui-platform-light-dark`,
`forge-ui-platform-image-set`, `forge-ui-platform-isolation` and `forge-ui-platform-logical-spacing`, in [`../floor.md`][floor].

```tsx
// Wrong — the older spelling of four separate things, in one card.
<div class="relative ml-4 pb-[56.25%]">
  <img src={shot.url} alt="" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
  <p class="pl-2 text-left -webkit-line-clamp-2">{shot.caption}</p>
</div>;

// Costs: a ratio box that resolves against the wrong axis, a centring that breaks the moment the
// card is transformed, a caption clamped only under a box type the layout did not ask for, and
// three spacings that do not turn around in an RTL locale.

// Right.
<div class="relative ms-4 aspect-video">
  <img src={shot.url} alt="" class="size-full object-cover" />
  <p class="ps-2 text-start line-clamp-2">{shot.caption}</p>
</div>;
```

---

## 2. Tier B — behaviour the platform implements

Each of these replaces script with a browser behaviour, and each replacement brings semantics the script did not have. That is why they are
`Default:` rather than flat: the semantics are usually what you wanted, and occasionally they are exactly what you cannot have.

### 2a. Modals and popovers

<!-- rule:forge-ui-platform-native-dialog --> `showModal()` is three behaviours at once — the top layer, page-wide inertness, and the Escape key —
and re-declaring the role on a positioned `div` claims all three in the accessibility tree while implementing none of them. That gap is the failure:
a screen-reader user is told the page behind is unavailable, and can still tab into it. A `popover` element is the case where the gap does not open,
so `role="dialog"` on one is not this defect and is not flagged: the platform is already giving it the top layer, Escape and light dismiss, and
`aria-modal` — the one claim a popover still cannot make good on — stays flagged wherever it appears.

<!-- rule:forge-ui-platform-native-popover --> Light dismissal is the discriminator, and it is not configurable: an `auto` popover closes on both,
and a panel whose whole purpose is to stay open is not a popover however it is positioned. Note that this rule looks at the file as a whole — a
module that declares a popover anywhere is taken to be using the API.

### 2b. Disclosure and inertness

<!-- rule:forge-ui-platform-native-details --> `<details>` gives you the toggle, the keyboard, the accessible state and — as the browser expands it
— find-in-page reaching the closed content. That last one is the behaviour to check against your requirement rather than assume: a scripted panel
kept its content out of find-in-page for certain, and `<details>` does not.

<!-- rule:forge-ui-platform-inert --> A `Dialog` opened as a modal gets this for free and needs none of it. The sweep is what a hand-built panel
does instead, and it is worse than it looks: it restores whatever it saved, so any element whose `tabindex` changed while the panel was open comes
back wrong.

### 2c. Entry, exit and repeating motion

<!-- rule:forge-ui-platform-entry-motion --> The `requestAnimationFrame` idiom exists to force a style recalculation between the insertion and the
class, which is exactly the problem `@starting-style` was specified to remove.

<!-- rule:forge-ui-platform-exit-geometry --> `transition-behavior: allow-discrete` keeps the element painted for the whole exit after the open
state stops matching, so a declaration keyed on that state is gone on the exit's first frame and the panel collapses while it is still fading.
`display` is the one property that belongs on the open state: on the base selector it outranks the rule hiding a closed popover, as
`forge-ui-interaction-no-display-on-popup` states, and with `allow-discrete` and a `none` endpoint the open value holds until the exit ends.

<!-- rule:forge-ui-platform-ticker --> Keyframes run off the main thread, so the motion survives a busy tab where the interval stutters. The gate is
not optional here: `forge-ui-reduced-motion` is Floor, and a declared animation is gated with `motion-safe:` exactly as an authored transition is,
and `motion-reduce:` gets the settled state or an opacity fade.

### 2d. Paths, gradients and reveals

<!-- rule:forge-ui-platform-motion-path --> `offset-path` also **rotates** the element along the path unless `offset-rotate` says otherwise, which
the scripted version was not doing. Forge's one shipped looping motion is `Spinner`'s `animate-spin`, and the motion budget in
`forge-ui-density-motion-budget` is what decides whether a second one belongs on the surface at all.

<!-- rule:forge-ui-platform-animated-border --> Registering the angle is what makes it interpolable; once it is, the gradient repaints with no frame
callback at all. An animated border is a high-variance decision before it is a technique — forge's boundary is `border-border`, and raising the
variance dial is a brief's business.

<!-- rule:forge-ui-platform-reveal-mask --> `Skeleton` is the shipped stand-in for content that has not arrived — `animate-pulse` over `bg-muted` —
and it is worth reaching for before a bespoke reveal, because the shape it holds is the shape that is coming.

<!-- rule:forge-ui-platform-scroll-reveal --> Forge ships two observers and neither is this pattern: `lazy` loads a module and `mountScrollSpy`
marks the active navigation link. What separates them is the callback body — neither touches a class on the observed element.

### 2e. Layout the platform can drive

<!-- rule:forge-ui-platform-smooth-scroll --> `mountScrollSpy` from `@y-core/forge/ui/client` marks which section the reader is in; the scrolling
itself is the browser's, and the header offset is `scroll-margin` rather than a number subtracted from a measured `offsetTop`, and `mountScrollSpy`
reads that same declaration, so the offset is stated once.

<!-- rule:forge-ui-platform-carousel --> The scrolled region is still bounded by `forge-ui-layout-scroll-area-bound`: a track fed by unbounded data
belongs inside `ScrollArea` rather than growing the page.

<!-- rule:forge-ui-platform-anchor-positioning --> That exception is a shipped path, not a hypothetical: `openPopoverAt` from
`@y-core/forge/ui/client` places a popup at coordinates, and `POPOVER_COORDS_ATTR` from `@y-core/forge/ui/contracts` is the attribute that marks it
so the anchored rules stand down. `anchor()` needs both elements in one anchor scope, which a measured rectangle never required.

<!-- rule:forge-ui-platform-field-sizing --> The scripted version capped the height implicitly, by only ever measuring content that fitted. The
declarative one does not, so pair it with a `max-h-*` step or the control grows without bound.

### 2f. Ancestors, counters and numbers

<!-- rule:forge-ui-platform-parent-state --> Going live is the upgrade in almost every case: a class the script set on one event stops agreeing with
the state the moment anything else changes it, and `:has()` cannot fall out of step because there is nothing to keep in step.

<!-- rule:forge-ui-platform-counters --> Rows arrive from the server and are swapped by htmx; the ordinal is a property of the position rather than
of the row, and a counter is the spelling that says so.

<!-- rule:forge-ui-platform-count-up --> That exception covers most product UI. `Meter` and `Progress` carry their value in the DOM because it has
to be there for the control's accessible value to exist at all; a count-up is a marketing moment, and it is subject to `forge-ui-reduced-motion`
like every other one.

### 2g. Theme detection

<!-- rule:forge-ui-platform-theme-detection --> `ThemeToggle` from `@y-core/forge/ui/chrome` writes an explicit preference — `THEME_ATTR`,
`DARK_CLASS`, `THEME_STORAGE_KEY`, applied before first paint by `FOUC_SCRIPT` — and the media query does not report that preference, because it is
not the OS's. A class-driven or attribute-driven theme is script's job by construction; a value that only ever follows the OS is not.

```tsx
// Wrong — a hand-built modal: the role claimed, the behaviour written, the tab order swept.
<div role='dialog' aria-modal='true' class='fixed inset-0 z-50'>
  <div class='absolute top-1/2 left-1/2'>
    <button type='button' aria-expanded={isOpen} data-on-click='togglePanel'>
      Details
    </button>
  </div>
</div>;

// Costs: three behaviours announced and none implemented — no top layer, no Escape, and a page
// behind that is reachable by Tab while the reader is told it is not.

// Right.
import { Collapsible, createIcon, Dialog } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<Dialog id='details' openModal label='Details'>
  <Collapsible>
    <Collapsible.Trigger icon={AppIcon}>Details</Collapsible.Trigger>
    <Collapsible.Content>{detail}</Collapsible.Content>
  </Collapsible>
</Dialog>;
```

---

## 3. Tier C — the authoring form

These change how a stylesheet is written rather than what it renders. Their overrides are almost always about specificity or containment, so read
the consequence rather than the syntax.

### 3a. Cascade and scope

<!-- rule:forge-ui-platform-layer --> That consequence is also the trap in a partial migration: moving _some_ of a sheet into a layer inverts the
order it had, because everything left outside now wins.

<!-- rule:forge-ui-platform-nesting --> Nesting alone is not a reason to compile anything. One difference is worth knowing before it bites: native
nesting resolves a bare type selector differently from the preprocessor, which needs no `&` in front of an element name.

<!-- rule:forge-ui-platform-scope --> Forge's own stylesheet reaches components through `[data-slot~="…"]` attribute selectors rather than a class
prefix, so this is a rule about an app's own sheet rather than about forge's.

<!-- rule:forge-ui-platform-selector-list -->

### 3b. Container queries and subgrid

<!-- rule:forge-ui-platform-container-query --> `mountViewportCollapse` from `@y-core/forge/ui/client` is the shell-level case and is correctly
viewport-driven. Everything below it is not: a card that is narrow in a sidebar and wide in the main column has no relationship to the window at
all. Declaring `container-type` establishes containment on that ancestor, which can change the ancestor's own sizing — that is the thing to check
before adding it.

<!-- rule:forge-ui-platform-subgrid --> `Card.Header` is the shape this shows up around: it lays out on `grid-cols-[1fr_auto]`, and a child that
restates those tracks has quietly promised to be edited twice. Subgrid also makes the child stretch to the parent's tracks, where an independently
sized one did not.

### 3c. Height interpolation and `display: contents`

<!-- rule:forge-ui-platform-interpolate-size --> The keyword is allowed from the declaring element down, so a transition between two descendants
needs it declared above both. `Collapsible` and `Accordion` are the disclosures `forge-ui-interaction-no-motion-on-layout` carves out for exactly
this reason: their height change is the moment rather than an accident of it.

<!-- rule:forge-ui-platform-display-contents --> Name a heading and its intro with `<hgroup>`, which the check does not flag, and keep any other
group's `<div>` under a `modern-css-allow` reason. Neither `<header>` nor `<section>` is a neutral name for it: a `<header>` outside sectioning
content is a second `banner` landmark, and invalid inside a `<footer>`, and a `<section>` is sectioning content that wants a heading of its own.
`forge-ui.css` uses it for the theme-icon spans, which are wrappers around a glyph and nothing else. Check the accessibility role too: older engines
drop the box's role with it, so a wrapper that carries one is not a candidate.

### 3d. Controls

<!-- rule:forge-ui-platform-accent-color --> That override is forge's own position rather than a hypothetical, and `forge-ui-affordance-replacement`
is why: suppressing the appearance gives up the exemption WCAG 1.4.11 grants an unmodified control, so the replacement owes both an explicit
`border-input` boundary with a `checked:bg-primary` fill **and** the forced-colors block that gives a High Contrast reader two distinguishable
squares. `accent-color` tints the control and cannot change its shape, so it is the right answer only where the shape was never in question.

<!-- rule:forge-ui-platform-view-transition --> The opt-in animates only a same-origin navigation whose outgoing and incoming documents both carry
it. `startViewTransition()` is the same-document API: it animates a DOM change made in its callback, and wrapping a navigation in it animates
nothing, because the document unloads before the new state is captured. A fragment swap belongs to [`11-htmx.md`][htmx]; this is the document-level
case, and the whole moment is gated by `forge-ui-reduced-motion`.

### 3e. Type

<!-- rule:forge-ui-platform-text-balance --> That cap is why the rule states a condition rather than an always: past it the property silently does
nothing, and a heading you believed was balanced is not.

<!-- rule:forge-ui-platform-text-pretty -->

<!-- rule:forge-ui-platform-field-sizing-adopt --> This is the unadopted case of `forge-ui-platform-field-sizing`, which is the scripted one; the
override is the same, and so is the caution — once the control sizes to content, `rows` stops being the height and only a `max-h-*` step bounds it.

### 3f. The one place the modern answer is refused

<!-- rule:forge-ui-platform-color-mix --> **Ring, border and outline tokens are excluded outright**, and the exclusion is a finding rather than a
preference. A mix with `transparent` composites against the backdrop, so a ring expressed that way measures against whatever is behind it rather
than against the surface, and lands under the 3:1 non-text floor WCAG 1.4.11 sets for a focus indicator. [`09-interaction.md`][interaction]'s
`forge-ui-interaction-ring-token` states what those tokens are instead.

Stating the exclusion here, rather than narrowing the rule, is what keeps a reader from wondering why the derived token they wrote was never
suggested. `forge-ui-contrast-floor` is Floor and outranks this Default wherever the two meet; `forge-ui-color-scale-no-adhoc-tint` is the same
instinct stated in utility terms — move a stop along the ramp rather than faking the step in between.

```css
/* Wrong — a second literal, and a ring expressed as a tint. */
.panel-hover {
  background: #eceef0;
}

/* Costs: a shade that stops tracking the token it came from, and a focus indicator whose measured
   ratio depends on whatever happens to be painted behind it. */

/* Right — derive the shade, and take the ring from a solid step. */
.panel-hover {
  background: color-mix(in oklch, var(--card), var(--foreground) 6%);
}
```

---

## 4. Sources

The catalogue this file rests on — which hand-written patterns are worth naming at all, and which platform feature replaces each one — is curated by
**CSS Radar** (`cssradar.com`) and by **modern-css.com**, together with the two reference articles they publish on the subject. That curation is
what is credited here: the selection is theirs.

Every rule above is written fresh. Each was re-derived against forge's own components, tokens and utilities, its trigger stated to match what
forge's own check actually detects, and its override condition argued from the consequence of adopting the feature rather than carried over from any
source. See [`UI_DESIGN_GUIDANCE.md`][udg-7] §7 for the constraint this footer discharges.

[floor]: ../floor.md
[htmx]: ./11-htmx.md
[interaction]: ./09-interaction.md
[udg-7]: ../../../../docs/UI_DESIGN_GUIDANCE.md#7-sourcing-constraint-and-attribution
