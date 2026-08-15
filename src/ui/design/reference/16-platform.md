# Platform

The browser now does, in one declaration, a long list of things the surrounding ecosystem still
writes by hand. Every rule here names one of those pairs: the hand-written form, and the platform
feature that replaced it.

This file is organised by how strongly forge holds each pair, because the strength is what decides
the shape of the sentence.

- **Tier A** is stated flat, as the Floor is. The hand-written form and the platform form are the
  same rendering, so there is nothing to weigh — the pattern is simply the older spelling, and it is
  refused.
- **Tier B** is behaviour the platform now implements: a dialog, a disclosure, a reveal. Each is a
  `Default:`, because adopting the platform's implementation also adopts its semantics, and there
  are real interactions whose semantics differ.
- **Tier C** is the authoring form — how a stylesheet is ordered, scoped and wrapped. Each is a
  `Default:` too, and its override is usually a specificity or a containment consequence rather than
  a design one.

Three patterns in this territory are already named elsewhere and keep the ids they have:
`forge-ui-viewport-units` and `forge-ui-reduced-motion` in [`../floor.md`](../floor.md), and
`forge-ui-interaction-focus-visible` in [`09-interaction.md`](./09-interaction.md). They are cited
from here, never restated, because an id is a permanent citation anchor and a second one for the
same sentence splits every finding that rests on it.

Where a rule is genuinely wrong for one line — a physical inset that must not mirror, a panel that
must not light-dismiss — the departure is stated at the line it excuses, carrying a written reason.
A silent exception and a missed rule are the same thing in a review.

---

## Tier A — the older spelling

Flat, and not rebuttable. Each of these is a pattern whose replacement renders the same box.

**Reserve a ratio box with `aspect-ratio`, never with a percentage `padding-bottom` inside a
`position: relative` rule.** <!-- rule:forge-ui-platform-aspect-ratio -->
The percentage-padding idiom exists because `aspect-ratio` did not. `Avatar.Image` is the shipped
form of the same intent — `aspect-square size-full object-cover` inside a clipping root — and
`forge-ui-media-fixed-crop` in [`15-media.md`](./15-media.md) is where an uncontrolled image is sent
for the same reason. Confirm one thing before rewriting: a percentage padding resolves against the
element's **inline** size in every case, so a ratio you derived from a block-axis measurement is not
the box you are about to declare.

**Centre a child by declaring `place-items: center` on its container, never with `top: 50%` and
`left: 50%` pulled back by `translate(-50%, -50%)`.** <!-- rule:forge-ui-platform-centering -->
The rule moves from the child to the container, and that is the part to check rather than the
syntax: a child positioned against a containing block other than that container — a popup in the top
layer, an element inside a transformed ancestor — was being centred against something else, and
changes box when the declaration moves. Forge's own centred slots are containers already, as the
`flex items-center justify-center` enclosure in `forge-ui-media-icon-enclosure` is.

**Style a scrollbar with `scrollbar-color` and `scrollbar-width`, never with the
`::-webkit-scrollbar` pseudo-elements.** <!-- rule:forge-ui-platform-scrollbar -->
`ScrollArea.Viewport` is the reference: it carries `[scrollbar-width:thin]` and a `scrollbar-color`
resolved from `--color-border`, which is a token, so the scrollbar moves with the theme. The two
standard properties colour and thin the bar; they cannot resize or reshape its parts the way the
pseudo-elements could, so a design that redrew the thumb is a design to drop rather than to port.

**Clamp text with `line-clamp`, never with `-webkit-line-clamp` and
`-webkit-box-orient`.** <!-- rule:forge-ui-platform-line-clamp -->
The prefixed pair only works under `display: -webkit-box`, which is a different box type from the
one the surrounding layout assumed — that is what changes when the standard property replaces it,
and it is usually a `flex` or `block` box coming back. A clamped `Card.Description` is the common
site.

**Express a per-mode value with `light-dark()`, never by declaring the same selector a second time
under `prefers-color-scheme`.** <!-- rule:forge-ui-platform-light-dark -->
A second declaration of one selector is two places to edit, and the second one is the one that gets
missed. Forge's own scheme files already hold both modes in one place: each `--gray-*` step carries
one value covering both, and `theme-base.css` holds the `color-scheme` that picks between them. That
is the constraint to verify — `light-dark()` reads `color-scheme` rather than the media query, so the
element must sit under a declared scheme for the function to resolve at all.

**Select a raster by device density with `image-set()`, never with a `min-resolution` or
`-webkit-min-device-pixel-ratio` media query.** <!-- rule:forge-ui-platform-image-set -->
Read the query before rewriting it: a density query is sometimes carrying **art direction** — a
different crop, not a denser one — and `image-set()` has no way to say that. If the two sources
differ in what they show rather than in how many pixels they show it with, the query was doing a
second job and the rewrite loses it.

**Create a stacking context with `isolation: isolate`, never with a negative
`z-index`.** <!-- rule:forge-ui-platform-isolation -->
A negative `z-index` does not put an element behind its sibling; it puts it behind its parent's
background, and it escapes the parent's paint order entirely to do it. Forge's overlay layers all
sit at `z-50` — `Popover.Content`, `Menu`, `Tooltip`, `Toast` — precisely so that the ordering is
positive and local. The one case to look at before rewriting is a decorative layer that was
*deliberately* painting behind an ancestor's background; isolating it brings it forward.

**Write inline-axis spacing logically.** <!-- rule:forge-ui-platform-logical-spacing -->
`ms-` and `me-` for `ml-` and `mr-`, `ps-` and `pe-` for `pl-` and `pr-`, `border-s` and `border-e`,
`rounded-s` and `rounded-e`, `text-start` and `text-end`; in a stylesheet, `margin-inline-start`,
`padding-inline-end` and the `inset-inline-*` pair for a bare `left` or `right`. The block axis is
not the subject — `margin-top` and `margin-block-start` name the same edge in the writing modes forge
ships, so rewriting one changes nothing. Mirroring is the whole point, and forge already mirrors:
`mountRovingFocus` reads direction from the element, so an RTL island navigates as RTL, and a physical
margin beside it is the one thing that does not turn around.

Two positions are physical on purpose and stay physical. An inset resolved with `anchor()` has no
inline-axis spelling at all — `anchor()` takes a physical side — and a rule already mirrored by a
`:dir()` selector would mirror twice if its margin mirrored too. Both are stated at the line rather
than left to be inferred.

```tsx
// Wrong — the older spelling of four separate things, in one card.
<div class="relative ml-4" style="padding-bottom: 56.25%">
  <img src={shot.url} alt="" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
  <p class="pl-2 text-left -webkit-line-clamp-2">{shot.caption}</p>
</div>

// Costs: a ratio box that resolves against the wrong axis, a centring that breaks the moment the
// card is transformed, a caption clamped only under a box type the layout did not ask for, and
// three spacings that do not turn around in an RTL locale.

// Right.
<div class="relative ms-4 aspect-video">
  <img src={shot.url} alt="" class="size-full object-cover" />
  <p class="ps-2 text-start line-clamp-2">{shot.caption}</p>
</div>
```

---

## Tier B — behaviour the platform implements

Each of these replaces script with a browser behaviour, and each replacement brings semantics the
script did not have. That is why they are `Default:` rather than flat: the semantics are usually what
you wanted, and occasionally they are exactly what you cannot have.

### Overlays and disclosure

Default: open a modal with `Dialog`, which renders a native `<dialog>` and takes `showModal()`
through the client runtime, rather than declaring `role="dialog"`, `role="alertdialog"` or
`aria-modal` on a `<div>` — unless the panel must **not** make the rest of the page inert and must
not enter the top layer, as a non-modal inspector docked beside the content it describes must
not. <!-- rule:forge-ui-platform-native-dialog -->
`showModal()` is three behaviours at once — the top layer, page-wide inertness, and the Escape key —
and re-declaring the role on a positioned `div` claims all three in the accessibility tree while
implementing none of them. That gap is the failure: a screen-reader user is told the page behind is
unavailable, and can still tab into it.

Default: declare a floating panel through the Popover API, as `Popover.Content` does with
`popover='auto'` against a trigger carrying `command='toggle-popover'`, rather than absolutely
positioning a menu, tooltip or dropdown that declares no popover at all — unless the panel must
survive an outside click or an Escape press, as a filter rail that stays open while the reader works
in the table beside it must. <!-- rule:forge-ui-platform-native-popover -->
Light dismissal is the discriminator, and it is not configurable: an `auto` popover closes on both,
and a panel whose whole purpose is to stay open is not a popover however it is positioned. Note that
this rule looks at the file as a whole — a module that declares a popover anywhere is taken to be
using the API.

Default: build a disclosure from `Collapsible` or `Accordion`, both of which render native
`<details>` and `<summary>`, rather than toggling `aria-expanded` from a click handler — unless the
trigger and the panel cannot be one subtree, as a header control that expands a region elsewhere in
the document cannot. <!-- rule:forge-ui-platform-native-details -->
`<details>` gives you the toggle, the keyboard, the accessible state and — as the browser expands
it — find-in-page reaching the closed content. That last one is the behaviour to check against your
requirement rather than assume: a scripted panel kept its content out of find-in-page for certain,
and `<details>` does not.

Default: mark the rest of the page `inert` while focus must stay inside a subtree, rather than
sweeping `tabindex` to `-1` across it and restoring the saved values afterwards — unless the excluded
content must stay **readable** to a screen reader while unreachable by Tab, since `inert` removes the
subtree from the accessibility tree as well as from the tab order. <!-- rule:forge-ui-platform-inert -->
A `Dialog` opened as a modal gets this for free and needs none of it. The sweep is what a hand-built
panel does instead, and it is worse than it looks: it restores whatever it saved, so any element
whose `tabindex` changed while the panel was open comes back wrong.

### Motion the platform can declare

Default: express entry motion with `@starting-style` and `transition-behavior: allow-discrete` — the
`starting:` and `transition-discrete` utilities `forge-ui-interaction-transition-controller` already
fixes — rather than adding a class inside `requestAnimationFrame` to kick a transition off — unless
the element was already in the document and is merely being revealed, which has no first style change
after insertion for a starting style to apply to. <!-- rule:forge-ui-platform-entry-motion -->
The `requestAnimationFrame` idiom exists to force a style recalculation between the insertion and the
class, which is exactly the problem `@starting-style` was specified to remove.

Default: declare a repeating motion as keyframes gated on `prefers-reduced-motion` rather than
running a `setInterval` that mutates `style.transform`, `style.left`, `style.top` or
`style.translate` — unless each step's value is computed from data that changed since the last one,
which no keyframe can read. <!-- rule:forge-ui-platform-ticker -->
Keyframes run off the main thread, so the motion survives a busy tab where the interval stutters.
The gate is not optional here: `forge-ui-reduced-motion` is Floor, and a declared animation is gated
with `motion-safe:` and given a settled `motion-reduce:` state exactly as an authored transition is.

Default: declare a fixed path with `offset-path` rather than computing coordinates per frame with
`Math.sin` or `Math.cos` inside `requestAnimationFrame` — unless the path is derived from data at
runtime, as a plotted series is, rather than fixed when the component was
written. <!-- rule:forge-ui-platform-motion-path -->
`offset-path` also **rotates** the element along the path unless `offset-rotate` says otherwise,
which the scripted version was not doing. Forge's one shipped looping motion is `Spinner`'s
`animate-spin`, and the motion budget in `forge-ui-density-motion-budget` is what decides whether a
second one belongs on the surface at all.

Default: register a gradient's angle with `@property` and animate the `conic-gradient()` rather than
mutating the angle per frame in `requestAnimationFrame` — unless the angle tracks a pointer or a
scroll position rather than time, which a keyframe has no way to
read. <!-- rule:forge-ui-platform-animated-border -->
Registering the angle is what makes it interpolable; once it is, the gradient repaints with no frame
callback at all. An animated border is a high-variance decision before it is a technique — forge's
boundary is `border-border`, and raising the variance dial is a brief's business.

Default: declare a reveal's mask in CSS and drive it from one custom property rather than assigning
`style.clipPath` or `style.maskImage` per frame — unless a child of the masked element must stay
unmasked, since a mask composites the whole element and takes its descendants with
it. <!-- rule:forge-ui-platform-reveal-mask -->
`Skeleton` is the shipped stand-in for content that has not arrived — `animate-pulse` over
`bg-muted` — and it is worth reaching for before a bespoke reveal, because the shape it holds is the
shape that is coming.

Default: drive a scroll-triggered reveal with `animation-timeline: view()` rather than adding a class
from an `IntersectionObserver` callback — unless the reveal must happen once and stay, since a view
timeline re-runs each time the element scrolls back into view. <!-- rule:forge-ui-platform-scroll-reveal -->
Forge ships two observers and neither is this pattern: `lazy` loads a module and `mountScrollSpy`
marks the active navigation link. What separates them is the callback body — neither touches a class
on the observed element.

### Layout the platform can drive

Default: declare `scroll-behavior` and clear a sticky header with `scroll-margin`, rather than
animating a scroll from script with a `behavior: 'smooth'` option or `offsetTop` arithmetic — unless
one call site must animate while the rest of the document stays instant, which the declarative
property cannot express because it also governs the reader's own scrolling. <!-- rule:forge-ui-platform-smooth-scroll -->
`mountScrollSpy` from `@y-core/forge/ui/client` marks which section the reader is in; the scrolling
itself is the browser's, and the header offset is `scroll-margin` rather than a number subtracted
from a measured `offsetTop`.

Default: page a slide track with scroll snap and `::scroll-button()` rather than stepping
`scrollLeft`, calling `.scrollBy()`, or translating the track by an index — unless every slide must
advance by exactly one index whatever its width, since snapping steps by snap position and a track of
uneven slides pages differently. <!-- rule:forge-ui-platform-carousel -->
The scrolled region is still bounded by `forge-ui-layout-scroll-area-bound`: a track fed by unbounded
data belongs inside `ScrollArea` rather than growing the page.

Default: position a panel against its trigger with `anchor()`, as forge's own menu rules do against
the popup's implicit anchor, rather than writing a measured `getBoundingClientRect()` into
`style.top`, `style.left`, `style.right` or `style.bottom` — unless the panel is anchored to a
**point** rather than an element, as a context menu opened at the pointer
is. <!-- rule:forge-ui-platform-anchor-positioning -->
That exception is a shipped path, not a hypothetical: `openPopoverAt` from
`@y-core/forge/ui/client` places a popup at coordinates, and `POPOVER_COORDS_ATTR` from
`@y-core/forge/ui/contracts` is the attribute that marks it so the anchored rules stand down.
`anchor()` needs both elements in one anchor scope, which a measured rectangle never required.

Default: let a `Textarea` grow with `field-sizing: content` rather than writing `scrollHeight` back
into `style.height` on every input — unless the reader owns the height, which forge's `Textarea`
allows: it ships `resize-y`, and a control the reader has dragged to a size should not resize itself
out from under them. <!-- rule:forge-ui-platform-field-sizing -->
The scripted version capped the height implicitly, by only ever measuring content that fitted. The
declarative one does not, so pair it with a `max-h-*` step or the control grows without bound.

### State a selector can read

Default: select an ancestor from a descendant's state with `:has()`, as
`forge-ui-interaction-trigger-state` already does for a popup's trigger, rather than reaching
`parentElement`, `parentNode` or `closest()` and calling `classList` on the result — unless the mark
must persist after the state that set it is gone, as a "has been opened once" flag does, since
`:has()` re-evaluates on every state change. <!-- rule:forge-ui-platform-parent-state -->
Going live is the upgrade in almost every case: a class the script set on one event stops agreeing
with the state the moment anything else changes it, and `:has()` cannot fall out of step because
there is nothing to keep in step.

Default: number list items with CSS counters rather than writing an index into `textContent` —
unless the number must be selected, copied or read back by a script, since generated content is not
in the DOM. <!-- rule:forge-ui-platform-counters -->
Rows arrive from the server and are swapped by htmx; the ordinal is a property of the position
rather than of the row, and a counter is the spelling that says so.

Default: animate a number by interpolating a registered `@property` and printing it through a
counter, rather than stepping `textContent` per frame with `toFixed`, `Math.round` or
`toLocaleString` inside `requestAnimationFrame` — unless assistive technology must announce the
value, which generated content is never announced as. <!-- rule:forge-ui-platform-count-up -->
That exception covers most product UI. `Meter` and `Progress` carry their value in the DOM because
it has to be there for the control's accessible value to exist at all; a count-up is a marketing
moment, and it is subject to `forge-ui-reduced-motion` like every other one.

Default: resolve a per-mode value with `light-dark()` rather than reading
`matchMedia('(prefers-color-scheme: …)')` in script — unless the theme is the **app's** rather than
the OS's, which is forge's own case. <!-- rule:forge-ui-platform-theme-detection -->
`ThemeToggle` from `@y-core/forge/ui/chrome` writes an explicit preference — `THEME_ATTR`,
`DARK_CLASS`, `THEME_STORAGE_KEY`, applied before first paint by `FOUC_SCRIPT` — and the media query
does not report that preference, because it is not the OS's. A class-driven or attribute-driven
theme is script's job by construction; a value that only ever follows the OS is not.

```tsx
// Wrong — a hand-built modal: the role claimed, the behaviour written, the tab order swept.
<div role="dialog" aria-modal="true" class="fixed inset-0 z-50">
  <div class="absolute top-1/2 left-1/2">
    <button type="button" aria-expanded={open} onclick="togglePanel()">Details</button>
  </div>
</div>

// Costs: three behaviours announced and none implemented — no top layer, no Escape, and a page
// behind that is reachable by Tab while the reader is told it is not.

// Right.
import { Dialog } from "@y-core/forge/ui/core";

<Dialog modal>
  <Collapsible>
    <Collapsible.Trigger icon="chevron-down">Details</Collapsible.Trigger>
    <Collapsible.Content>{detail}</Collapsible.Content>
  </Collapsible>
</Dialog>;
```

---

## Tier C — the authoring form

These change how a stylesheet is written rather than what it renders. Their overrides are almost
always about specificity or containment, so read the consequence rather than the syntax.

### Cascade and scope

Default: order a stylesheet's cascade in named `@layer` blocks, as `forge-ui.css` does with its
`components` and `utilities` layers, rather than relying on source order — unless the sheet's rules
must beat every layered rule in the document, as a preference override loaded last must, since an
unlayered rule outranks every layer. <!-- rule:forge-ui-platform-layer -->
That consequence is also the trap in a partial migration: moving *some* of a sheet into a layer
inverts the order it had, because everything left outside now wins.

Default: author plain CSS and use native nesting rather than `.scss` or `.sass` — unless the file
genuinely needs what the preprocessor has and CSS does not, such as a loop or a mixin generating
rules. <!-- rule:forge-ui-platform-nesting -->
Nesting alone is no longer a reason to compile anything. One difference survives the port and is
worth knowing before it bites: native nesting resolves a bare type selector differently from the
preprocessor, which needed no `&` in front of an element name.

Default: bound a family of five or more selectors sharing a class prefix with `@scope` rather than
carrying the prefix on every one — unless the family's members are not all inside one subtree, since
a scoped rule stops at the scope's lower boundary. <!-- rule:forge-ui-platform-scope -->
Forge's own stylesheet reaches components through `[data-slot~="…"]` attribute selectors rather than
a class prefix, so this is a rule about an app's own sheet rather than about forge's.

Default: group four or more selectors with `:is()` or `:where()` rather than a comma list — unless
the list's own specificity is what a later rule depends on, since `:is()` takes the specificity of
its most specific argument and `:where()` takes none, and neither equals the
list's. <!-- rule:forge-ui-platform-selector-list -->

### Sizing and containment

Default: size a component against its container with `@container`, as `Field`'s
`@container/field-group` does, rather than against the viewport with a `(min-width:)` or
`(max-width:)` media query — unless the thing being sized really is the page, as an application
shell's breakpoint is. <!-- rule:forge-ui-platform-container-query -->
`mountViewportCollapse` from `@y-core/forge/ui/client` is the shell-level case and is correctly
viewport-driven. Everything below it is not: a card that is narrow in a sidebar and wide in the main
column has no relationship to the window at all. Declaring `container-type` establishes containment
on that ancestor, which can change the ancestor's own sizing — that is the thing to check before
adding it.

Default: inherit a parent's tracks with `subgrid` rather than restating the same
`grid-template-columns` or `grid-template-rows` value in a descendant rule — unless the child's
tracks only coincidentally match and are meant to move independently
afterwards. <!-- rule:forge-ui-platform-subgrid -->
`Card.Header` is the shape this shows up around: it lays out on `grid-cols-[1fr_auto]`, and a child
that restates those tracks has quietly promised to be edited twice. Subgrid also makes the child
stretch to the parent's tracks, where an independently sized one did not.

Default: transition to an `auto` height under `interpolate-size: allow-keywords` — declared once at
`:root`, as `forge-ui.css` declares it — rather than standing a fixed `max-height` in for the height
you actually wanted — unless the collapsed box has a real maximum of its own that is not the
content's height, as a preview capped at a few lines has. <!-- rule:forge-ui-platform-interpolate-size -->
The keyword is allowed from the declaring element down, so a transition between two descendants needs
it declared above both. `Collapsible` and `Accordion` are the disclosures
`forge-ui-interaction-no-motion-on-layout` carves out for exactly this reason: their height change is
the moment rather than an accident of it.

Default: let a wrapper's children join a `grid` or `flex` parent with `display: contents` rather than
leaving an attribute-free `<div>` or `<span>` between them — unless the wrapper carries a background,
border, radius or transform, every one of which disappears with the box it was painted
on. <!-- rule:forge-ui-platform-display-contents -->
`forge-ui.css` uses it for the theme-icon spans, which are wrappers around a glyph and nothing else.
Check the accessibility role too: the box took its role with it until recently, and a wrapper that
was carrying one is not a candidate.

### Controls and type

Default: tint a native checkbox or radio with `accent-color` rather than `appearance-none` and a
hand-drawn box — unless the mark itself has to be redrawn, which is what `CheckboxGroup` and
`RadioGroup` do. <!-- rule:forge-ui-platform-accent-color -->
That override is forge's own position rather than a hypothetical, and `forge-ui-affordance-replacement`
is why: suppressing the appearance gives up the exemption WCAG 1.4.11 grants an unmodified control,
so the replacement owes both an explicit `border-input` boundary with a `checked:bg-primary` fill
**and** the forced-colors block that gives a High Contrast reader two distinguishable squares.
`accent-color` tints the control and cannot change its shape, so it is the right answer only where
the shape was never in question.

Default: cross-fade a full-document navigation with `startViewTransition()` rather than assigning
`location.href` or calling `location.assign()` bare — unless the navigation leaves the application,
as an external link or an identity provider hand-off does, where there is no next document to
capture. <!-- rule:forge-ui-platform-view-transition -->
A fragment swap is a different thing and belongs to [`11-htmx.md`](./11-htmx.md); this is the
document-level case. The capture freezes the page, so work started in the callback delays the frame
the reader is waiting on — and the whole moment is gated by `forge-ui-reduced-motion`.

Default: give a heading at `text-2xl` or larger the `text-balance` utility — `Card.Title`,
`Dialog.Title` and `Alert.Title` are where this lands — unless the heading is a single short line
that cannot wrap, or is long enough to wrap past the few lines balancing is capped
at. <!-- rule:forge-ui-platform-text-balance -->
That cap is why the rule states a condition rather than an always: past it the property silently does
nothing, and a heading you believed was balanced is not.

Default: give body copy `text-pretty` — the blocks already carrying `prose`, `max-w-prose` or
`leading-relaxed` under `forge-ui-measure-cap` — unless the block's height was measured for a fixed
box, since pretty wrapping changes the breaks and can take one more
line. <!-- rule:forge-ui-platform-text-pretty -->

Default: give a `Textarea` the `field-sizing-content` utility rather than leaving `rows` to be its
height — unless the reader owns the height, which `Textarea`'s own `resize-y` invites them
to. <!-- rule:forge-ui-platform-field-sizing-adopt -->
This is the unadopted case of `forge-ui-platform-field-sizing`, which is the scripted one; the
override is the same, and so is the caution — once the control sizes to content, `rows` stops being
the height and only a `max-h-*` step bounds it.

### The one place the modern answer is refused

Default: derive a suffixed shade — `-hover`, `-active`, `-subtle`, `-strong` and the rest — from the
token it shades with `color-mix()`, rather than declaring a second literal beside the first, unless
the derived value is one half of a pair whose ratio is measured under `forge-ui-contrast-floor`,
where a mix carrying alpha composites against whatever is behind it and the value you measured is not
the value that paints. <!-- rule:forge-ui-platform-color-mix -->

**Ring, border and outline tokens are excluded outright**, and the exclusion is a finding rather than
a preference. An earlier revision expressed the light `--ring` as a 50%-alpha `color-mix()`; because
a mix with `transparent` composites against the backdrop, the ring measured *below the very border it
was replacing* and under the 3:1 non-text floor WCAG 1.4.11 sets for a focus indicator.
[`09-interaction.md`](./09-interaction.md)'s `forge-ui-interaction-ring-token` records the outcome:
`--ring` is a solid step in both modes, one beyond `--input`, resolving through `--gray-11`. A focus
indicator cannot be expressed as a tint.

So for those three, the modern answer is the wrong answer in forge, and this file says so rather than
narrowing the rule and leaving a reader to wonder why the derived token they wrote was never
suggested. `forge-ui-contrast-floor` is Floor and outranks this Default wherever the two meet;
`forge-ui-color-scale-no-adhoc-tint` is the same instinct stated in utility terms — move a stop along
the ramp rather than faking the step in between.

```css
/* Wrong — a second literal, and a ring expressed as a tint. */
.panel-hover { background: #eceef0; }

/* Costs: a shade that stops tracking the token it came from, and a focus indicator whose measured
   ratio depends on whatever happens to be painted behind it. */

/* Right — derive the shade, and take the ring from a solid step. */
.panel-hover { background: color-mix(in oklch, var(--card), var(--foreground) 6%); }
```

---

## Sources

The catalogue this file rests on — which hand-written patterns are worth naming at all, and which
platform feature replaces each one — is curated by **CSS Radar** (`cssradar.com`) and by
**modern-css.com**, together with the two reference articles they publish on the subject. That
curation is what is credited here: the selection is theirs.

Every rule above is written fresh. Each was re-derived against forge's own components, tokens and
utilities, its trigger stated to match what forge's own check actually detects, and its override
condition argued from the consequence of adopting the feature rather than carried over from any
source. See [`UI_DESIGN_GUIDANCE.md`](../../../../.decisions/implementation/UI_DESIGN_GUIDANCE.md) §7 for the
constraint this footer discharges.
