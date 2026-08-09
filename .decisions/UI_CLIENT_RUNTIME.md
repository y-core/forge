---
title: UI Client Runtime
description: "The browser-only UI tier: mount controllers, signals, lazy loading, the htmx side-effect import, and the hard SSR boundary."
---

# UI Client Runtime

> Owns the browser-only UI tier — `ui/client` controllers and signals, the `ui/chrome/client`
> theme registration, and the htmx side-effect import. **§4 is the load-bearing rule: these
> exports must never reach an SSR context.**
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the markup these controllers
> attach to and for the server half of the binding seam; `package.json` `sideEffects` for which
> modules are side-effectful; `src/ui/README.md` for controller options and worked usage.

---

## 0. Quick Reference

- §1 Runtime Boundary: what `ui/client` is and where it may be imported
- §2 Mount Controllers: the browser controllers and their contracts
- §2a mountNav — Navigation Controller: menu toggle and active-link marking
- §2b Theme Controller and FOUC Prevention: where the theme surface actually lives
- §2c mountTurnstile — CAPTCHA Controller: engagement-gated, self-healing, fails visible
- §2d The Disposer Contract: every controller returns one, and why
- §2e mountMenu — Menu Keyboard Behaviour: arrow navigation, typeahead, focus, and the submenu arrows
- §2f mountTabs — Selection and Panel Visibility: automatic versus manual activation
- §2g mountTooltip — Hint Popover: hover and focus intent
- §2h mountNumberField — Stepper Buttons: why its scope is eager
- §2i openPopoverAt — Coordinate Placement: the popup with no invoker to anchor to
- §2j mountAnchorBinding — Runtime Invoker Anchoring: the popup whose trigger is known only at runtime
- §3 Signals and Lazy Loading: client state without a framework
- §3a Signals — Reactive State: `createSignal`, `computed`, `effect`
- §3b Lazy Loading Utilities: deferred imports and event-triggered resources
- §3c Resumable Scopes: `registerScope` and `resume`
- §4 htmx Bundle Import: the side-effect entry point
- §5 Never Use ui/client in an SSR Context: the hard boundary and how it is kept
- §6 Controller Primitives: the shared internals every controller is built from
- §6a Owner-Document Utilities: the global reflexes a controller may not reach for, and their node-resolved replacements
- §6b mountRovingFocus — The Composite Controller: one function over a DOM subtree
- §6c mountTransitionState — The Transition Protocol: one controller, never per-component
- §6d mountPopupTriggerState — The Trigger's Own State: `data-popup-open` and its producer

---

## 1. Runtime Boundary

**`ui/client` exports run only in the browser, after the page is delivered.** They reference
`document`, `window`, and `localStorage`, none of which exist in a Worker.

Import them only from the esbuild client entry (`src/client/`) or code it bundles. §5 states the
rule and its failure mode.

---

## 2. Mount Controllers

Every mount controller is **idempotent per element and returns a disposer**, so calling one twice is
safe and a controller can be torn down. §2d states that contract as a rule; §6 covers the shared
primitives the controllers below are built out of.

### 2a. `mountNav` — Navigation Controller

Wires the mobile hamburger toggle and applies active-link highlighting from
`window.location.pathname`. **Call once per page** from the bundled client entry.

### 2b. Theme Controller and FOUC Prevention

The theme surface is split across two subpaths, and the split matters:

- **`@y-core/forge/ui/chrome`** (SSR) exports `FOUC_SCRIPT`, `THEME_ATTR`, `DARK_CLASS`,
  `THEME_STORAGE_KEY`, and the `ThemeToggle` component.
- **`@y-core/forge/ui/chrome/client`** is a **side-effect module** that registers the theme and
  nav chrome controllers and exports the `isDark` signal.

**`FOUC_SCRIPT` is an inline script for `<head>` that reads storage and sets the dark class
before first paint**, preventing a flash of unstyled content.

**Its hash must be listed in the CSP `script-src`.** Any *other* server-rendered inline
`<script>` must instead carry the per-request nonce from `getNonce(c)` — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2a.

### 2c. `mountTurnstile` — CAPTCHA Controller

**`mountTurnstile()` is arg-less.** It finds the `[data-ref='turnstile']` widget rendered by the
`Turnstile` component ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1f) and its enclosing
`<form>` via `closest("form")` — there is no form, widget, submit, or result selector to
configure, and it reads `siteKey` from the widget's `data-sitekey`. It no-ops when the widget or
its form is absent.

Three behaviours are deliberate:

- **Engagement-gated.** It loads Cloudflare's script on the first `focusin` within the form —
  real intent to submit, not page load or scrolling — then renders the widget explicitly with
  function-ref callbacks, so there are no global callback names and no implicit auto-render. It
  renders on the async script's `load` event and **never calls `turnstile.ready()`**, which
  throws when the script loads async.
- **Self-healing token.** It resets the single-use token after **every** completed submission,
  success or error, and on expiry or timeout, so a retry always carries a fresh token. It clears
  the form only when the submission actually succeeded.
- **Fails visible, never blocking.** On load or render failure it reveals the widget's hidden
  fallback message. **The submit button is intentionally not gated on Turnstile** — the server's
  `verifyTurnstile` ([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §4b) is the single
  fail-closed enforcement point, so a slow or blocked challenge can never brick the form.

### 2d. The Disposer Contract

**Every controller returns a disposer that removes everything it installed, and a scope's `setup`
returns it.** `resume()` returns a teardown that runs every disposer collected during that resume,
so the two halves fit without either side knowing about the other:

```typescript
registerScope("toolbar", {
  setup: ({ root }) => mountRovingFocus(root, { items: "[data-toolbar-item]" }),
})
```

**It is a contract, not a convenience.** A controller that cannot be disposed leaks a listener — and
often a `MutationObserver` and a pending timer — on every re-resume, and a page that re-resumes after
each htmx swap accumulates one set per swap. Nothing warns; the page simply gets slower and starts
handling the same keystroke several times.

Two consequences follow, and both are the rule rather than a special case:

- **A `setup` that returns nothing is legal**, and is not treated as a disposer. A scope with no
  listeners of its own has nothing to tear down.
- **A disposer must be idempotent-safe to call after its element is gone.** Removing a listener from
  a detached node is a no-op, which is why teardown never needs to check.

### 2e. `mountMenu` — Menu Keyboard Behaviour

**It opens and closes only what the horizontal arrows ask it to.** Opening, closing, light-dismiss,
Escape and top-layer stacking belong to the Popover API, and selecting an item closes the menu
through `command="hide-popover"` in the markup
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h). What is left is what ARIA's menu pattern asks
for and the platform does not supply: arrow navigation over the items, typeahead, focus on the first
item when the menu opens, focus back on the opener when it closes, and the two arrows that move
between a panel and its submenu.

**The two horizontal arrows go through the platform rather than around it**, and which arrow means
which is **resolved from the popup's own writing direction** rather than hardcoded (§6a) — so the
pair mirrors under `dir="rtl"`, including for a single RTL subtree inside an LTR page. The key
pointing *toward* the submenu calls `.click()` on a `menu-submenu-trigger` — the row's own
`command="toggle-popover"` is what opens the panel, and the nested popup's own `mountMenu` is what
moves focus into it. The key pointing *away* calls `hidePopover()` on a nested popup, the same path
Escape already takes, so focus restoration is the one `toggle` handler rather than a second parallel
one. Nothing about the state machine is reimplemented.

**Both keys are guarded twice**, and neither guard is optional: the handler bails on
`event.defaultPrevented`, because `keydown` bubbles from an open submenu to the panel containing it
and without the bail both controllers act on one press; and it calls `preventDefault()` on every key
it consumes, which is the other half of that same contract. `mountRovingFocus` leaves both keys
unclaimed under `orientation: "vertical"` (§6b), so there is no contention with it.

**This lives in a controller mounted on the popup, never in the scope system.** The delegated
vocabulary is `click` / `input` / `change` / `submit`, with no `keydown`, by decision (§3c).

**The opener is captured, not derived from `commandfor`** — a menu can be opened by any invoker, and
a context menu has no single trigger button.

**Focus is only reclaimed when the close actually stranded it.** A click elsewhere on the page has
already put focus where the user wants it, and yanking it back to the trigger would be worse than
the problem restoration exists to fix.

**It mounts `mountAnchorBinding` only on a nested popup** (§2j). After the stylesheet's panel-level
binding every other menu is already anchored correctly with no JavaScript at all, so restricting it
keeps inline writes off elements that do not need one.

### 2f. `mountTabs` — Selection and Panel Visibility

Adds the part specific to tabs on top of the composite controller: moving the selection, and the
panel visibility that follows it. **Panels are found through the `aria-controls` the markup already
declares**, so there is no second registry to keep in step.

**Automatic activation rides `focusin`**, which the arrow keys already produce — so the selection
follows roving focus without this controller knowing which key moved it. Manual activation listens
for `click` instead. Which applies is read from the root's `data-activation`.

### 2g. `mountTooltip` — Hint Popover

Shows on hover and on focus, hides on leave, blur and Escape. **`popover="hint"` is the reason it
composes**: a hint does not close an `auto` popover, so a tooltip on a menu item does not dismiss
the menu underneath it.

### 2h. `mountNumberField` — Stepper Buttons

Wires the increment and decrement buttons to the native input's own `stepUp` / `stepDown`, so
`min`, `max` and `step` are enforced by the platform rather than re-implemented.

**Its scope is eager, and that is forced by the markup**: the steppers carry no `data-on-*` action,
so a lazy scope would have nothing to resume it and the buttons would sit inert on the page. The
same reasoning makes `toolbar`, `menu`, `tabs`, `tooltip`, `collapsible`, `accordion`, `dialog` and
`popover` eager — every one of them is setup-only.

### 2i. `openPopoverAt` — Coordinate Placement

**Every other popup in forge is placed by CSS, against its trigger** — through an *explicit*
`anchor-name` / `position-anchor` pair declared in `theme-base.css`. There is **no implicit anchor to
lean on**: the one a UA supplies comes from `popovertarget`, and forge invokes with
`command`/`commandfor` throughout, which sets no anchor at all. Measured on Chrome 151, an
invoker-opened popup computes `position-anchor: normal` and every `anchor()` resolves to nothing. An
earlier revision of the placement block assumed otherwise and was dead for every surface it named;
`src/ui/core/menu-anchor.browser.ts` is the geometry that would now catch it.

This is the one case no anchor can serve: a **context menu has no trigger**. It opens where a
right-click landed, on an element that is not a button, so nothing carries the anchor name, every
anchored rule resolves to nothing, and the UA's `[popover]` default (`inset: 0; margin: auto`) centres
the panel — the one place a context menu must never be.

`openPopoverAt(el, x, y, options?)` shows the popup with its top-left corner on the point, clamped so
the whole box stays on screen. Three properties are load-bearing:

- **The coordinates go through CSSOM** (`el.style.setProperty`), never a generated `style` attribute.
  Two independent reasons, either sufficient: forge's CSP carries no `style-src 'unsafe-inline'`, so
  an inline style would be blocked in exactly the app this exists for, and the JSX renderer drops
  `style` outright, so there would be nothing to write server-side either.
- **The matching CSS rule must reset `inset` and `margin` explicitly.** Without that the UA default
  survives, the panel centres itself, and the custom properties hold perfectly correct values while
  nothing moves. That failure looks like a bug in the TypeScript and is not.
- **Clamping needs the box, not the point**, so the coordinates are written twice: once before the
  popup is shown, while it still measures zero, and once after. Both in one task, so the browser
  paints the corrected position rather than the provisional one.

The popup opts in with `Menu.Popup`'s `coords` prop, which stamps `data-coords` and selects the
coordinate rule; `openPopoverAt` stamps it too, so a popup that opens both ways needs no second
markup variant. Calling it again **repositions** an open popup, which is what a second right-click
elsewhere should do.

### 2j. `mountAnchorBinding` — Runtime Invoker Anchoring

The other half of §2i's escape hatch, in the same module and for the same CSSOM reason. `openPopoverAt`
serves the popup with **no** trigger; this serves the popup whose trigger is only known at runtime.

**The submenu is the case, and the constraint is structural.** `Menu.SubmenuTrigger` and its nested
`Menu.Popup` are siblings among the rows of the parent panel with **no wrapper** — a wrapper inside a
`role="menu"` would break the ARIA content model — and the SSR renderer drops every `style` attribute,
so no per-instance `anchor-name` can be emitted server-side. The stylesheet's answer is to name the
**parent panel**, which is correct but coarse: the submenu pins to the panel's edge, top-aligned,
rather than beside the row that opened it.

**Naming the rows instead does not work, and it was measured rather than reasoned about.** An open
popup is in the top layer, where the resolution algorithm treats every candidate as laid out before
it, so every trigger in the panel becomes acceptable and it returns "the last element in tree order" —
the wrong row for every submenu but the last (csswg-drafts #11602, closed as intentional). Naming the
panel puts the lookup on the *ancestor* branch, where the nearest match wins deterministically.

`mountAnchorBinding(popup)` resolves the invoker on `beforetoggle`, mints a stable per-element anchor
name, and writes `anchor-name` on the trigger and `position-anchor` on the popup through CSSOM. Inline
CSSOM beats any stylesheet rule, and the placement matrix is anchor-*agnostic* — written in terms of
`anchor()`, never of a particular name — so the box resolves against whatever `position-anchor`
currently says. Three details are the whole of the correctness:

- **`beforetoggle`, not `toggle`.** It fires before the open state's style and layout pass, so the
  first painted frame is already anchored; `toggle` is one frame late and the panel visibly flashes
  from the viewport centre. The same reasoning `mountTransitionState` uses for its enter (§6c).
- **The trigger's `anchor-name` is read from the *cascade* and appended to, never overwritten.** A
  composed trigger already carries `--forge-tooltip` from a stylesheet rule, which `el.style` cannot
  see; a bare inline write would clobber it and leave the tooltip centred — the exact failure this
  mechanism exists to remove. The name is minted once per element via a `WeakMap`, so re-opening
  reuses it rather than growing the list.
- **A coordinate-placed popup returns early.** `openPopoverAt` owns placement outright there.

**It is deliberately not folded into `mountPopupTriggerState`.** That name has a documented contract —
publishing `data-popup-open` on the invokers — and conflating the two would be a silent widening.
They do differ in one visible way: with several invokers for one popup, `mountPopupTriggerState`
stamps all of them, while `anchor()` resolves against a single element, so this picks the **first in
document order**.

---

## 3. Signals and Lazy Loading

### 3a. Signals — Reactive State

`createSignal` returns a signal with a `.value` getter/setter; `computed` derives a read-only
signal; `effect` subscribes to every signal read during its execution and re-runs on change.

**Use signals for lightweight client state that does not justify an HTMX round trip.** State
that must survive navigation or be authoritative belongs on the server.

### 3b. Lazy Loading Utilities

All three take an **options object**, not positional arguments, and each accepts `within` so a
controller inside an iframe or a shadow tree searches and injects into its own document.

- **`lazy({ ref, load, init, rootMargin?, threshold?, onError?, within? })`** defers a dynamic
  import until the element carrying `data-ref="{ref}"` **intersects the viewport** — an
  IntersectionObserver, not an idle callback — then calls `init(mod, el)`. Returns a disposer.
- **`loadScriptOnEvent({ triggerSelector, event, scriptSrc, integrity, onLoad?, within? })`**
  injects a `<script>` the first time a DOM event fires on the trigger — for analytics or chat
  widgets that must not block page load. `integrity` is required: an SRI hash, or `false` to opt
  out explicitly.
- **`loadStylesheet(href, integrity, within?)`** injects a `<link rel="stylesheet">` and resolves on
  its `load` event. Positional, unlike the other two, because it has no optional behaviour to name.

**A failed `lazy` import retries; it does not die silently.** The rejection goes to `onError` and
the element is re-observed after a fixed delay, so a transient chunk failure is not the end of that
control. Both bounds are load-bearing rather than tidy. The cap — three `load()` calls — exists
because `observe()` invokes its callback *immediately* for an element already on screen, so an
uncapped re-observe on a visible element is a spin loop. The delay is what makes the retry a retry:
re-observing at once spends the entire attempt budget within a few frames of the first failure,
recovering only from an outage that is already over. Re-observing rather than calling `load()` again
is deliberate too — an element scrolled out of view in the meantime waits for re-entry instead of
loading off-screen. A throw from `init` is a different failure: it is reported to `onError` and stops
there, since the load succeeded and re-running it would only re-run the same failing `init`. The
disposer marks the controller disposed and clears a pending retry timer, so a load still in flight
when a scope tears down never touches the element again: it neither re-observes nor runs `init`.

**`loadStylesheet` joins concurrent callers to one `<link>`.** The in-flight promise is cached per
`(document, href)`, so a second caller arriving before the first link's `load` waits for the real
event instead of being told by the duplicate check that an appended-but-unloaded link is ready. A
link this function did not create — SSR markup, third-party code — still resolves immediately, since
there is no event left to wait for. A failed load removes its `<link>` as well as evicting the cache
entry, and needs both: the next call misses the cache and falls through to the duplicate check, so a
dead link left in the head would be read as an already-loaded stylesheet and resolve.

### 3c. Resumable Scopes

`registerScope(name, definition)` binds a scope's actions; `resume()` installs the single
delegated island listener that drives every registered scope.

**Register every scope before calling `resume()`** — including the side-effect import that
registers forge's own scopes ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §2d).

**A component whose markup names a scope must guarantee the scope exists.** A side-effect module
that registers scopes for markup a *sibling* module renders imports the module those scopes live in,
rather than leaving the app to discover the dependency from a warning. `ui/chrome/client` imports
`ui/core/client` for exactly this reason: chrome markup names the `menu` and `toolbar` scopes.

**A scope is lazy by default and resumes on the first delegated interaction inside it; an `eager`
scope runs its `setup` at `resume()`.** Choose `eager` whenever the markup carries no `data-on-*`
action of its own, because a lazy scope then has nothing that could ever resume it — that is the
whole setup-only family (§2h), and it is a correctness requirement rather than a performance
preference.

**Scope discovery descends into open shadow roots.** The eager pass walks the tree rather than
running one flat `querySelectorAll`, because a selector cannot cross a shadow boundary: a scope
rendered inside a web component was previously never *visited*, so its `setup` never ran and nothing
warned. The delegated half never had this problem — `closestAcross` climbs out through `host` (§6a) —
which is why a *lazy* scope inside a shadow root always worked and an eager one silently did not. A
closed root reports `shadowRoot === null` and is stepped over, the same answer the platform gives
everywhere else. `resume(within)` accepts a `ShadowRoot` as the walk root, so a web component can
resume only its own subtree; the delegated listeners still go on the containing document either way,
since the four scope events are composed and cross the boundary themselves.

**The delegated event vocabulary is `click`, `input`, `change`, `submit`. There is no `keydown`, by
decision.** Composite controllers own `keydown` at their **own widget root**, which is where arrow
keys and typeahead belong: they are scoped to a widget, not to a page region. A page-level keydown
delegation would have to decide, for every keystroke, which of several live widgets it was meant
for — a question the widget's own root answers by construction. The vocabulary is declared once and
shared by the runtime's listener set and the server's emitted `data-on-*` attributes, so adding a
fifth event changes every attribute the server writes; that is the cost the rule exists to make
visible.

---

## 4. htmx Bundle Import

**Import the htmx bundle for its side effect only, from the client entry:**

```typescript
import "@y-core/forge/ui/client/htmx"   // no exports used
```

It attaches `htmx` to `window` and registers the built-in extensions.

**The module is listed in `package.json` `sideEffects`, which is what stops a bundler
tree-shaking it away.** That file owns the list — never restate which modules are side-effectful.

**Never import htmx from a CDN URL** — this entry point is what pins the version to the forge
package.

---

## 5. Never Use `ui/client` in an SSR Context

**Importing a `ui/client` export in Worker-executed code throws at runtime.** Cloudflare Workers
have no DOM, so `document`, `window`, and `localStorage` are undefined.

The boundary is kept by import path, not by a runtime check:

| Subpath | Where it may be imported |
|---|---|
| `@y-core/forge/ui/core`, `ui/chrome`, `ui/server` | Worker-safe — SSR views, handlers, routers |
| `@y-core/forge/ui/client` | **Browser only** — the client entry and code it bundles |
| `@y-core/forge/ui/client/htmx` | **Browser only** — the esbuild entry point, side-effect import |
| `@y-core/forge/ui/*/client` | **Browser only** — side-effect scope/controller registration |

**When a component needs both SSR markup and client behaviour, render the markup with `ui/core`
and wire the behaviour from the bundled client entry.** Never inline a `ui/client` import in a
`.tsx` file outside the client directory — that is the mistake the path convention exists to
make visible.

---

## 6. Controller Primitives

Three modules that no consumer mounts directly and every controller is built out of. They earn a
section because the rules in them are the ones a new controller most often gets wrong.

### 6a. Owner-Document Utilities

**A browser controller never reaches for a bare global.** Each of these reflexes has a failure mode
that is invisible in the common case and total in the uncommon one:

| Reflex | What breaks |
|---|---|
| bare `document` / `window` | they name the **top-level** realm — a controller mounted in an iframe installs its listeners on the wrong document and silently never fires |
| `event.target` | retargeted at a shadow boundary: for an event that crossed one it reports the **host**, not the element hit |
| `document.activeElement` | the same problem in reverse — it stops at the host and never reports the focused item inside an open shadow root |
| `instanceof HTMLElement` | `false` for an element from another realm, because every realm has its own constructor. It compiles, it type-narrows, and it rejects a perfectly good element |
| `document.getElementById` | searches the document only, and an id inside a shadow root is not in it — a `commandfor` or `aria-controls` naming a sibling in the same shadow tree resolves to `null` |
| bare `getComputedStyle` | the top-level window's again, and a *global* direction read cannot see that one subtree of an LTR page is RTL |

The replacements resolve everything **from a node**: the document and window a node belongs to, the
*deeply* focused element, the real target via `composedPath()`, a duck-typed element narrowing on
`nodeType`, the resolved writing direction, root-scoped id resolution, and shadow-crossing `closest`
and `contains`. `src/ui/client/dom.ts` owns that inventory and the hazard each entry closes.

**Direction is resolved where it is consumed, never cached at mount.** Reading it forces a style
recalculation, so a controller resolves it at the keystroke that actually depends on it (§6b) rather
than once per mount — and a mount-time read would go stale the moment `dir` flips at runtime.

**Root-scoped id resolution is a primitive of this namespace, not of the package.** It carries no
`@public` tag and is not barrelled, so no `@y-core/forge/ui/client` consumer can reach it — the same
posture as the transition module's trigger lookup (§6d). Both are shared *inside* `ui/client`, and
the tag is what decides whether a symbol must appear in a barrel at all
([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §1c). The rule it exists to serve is public and binds
every controller here: **an id reference is resolved in the tree that declares it**, because ids do
not cross a shadow boundary. A detached subtree has no root that can answer, and falls back to the
owner document — which is exactly what the document-scoped lookup already returned, so adopting it
widens the answer without changing any case that previously worked.

**These are the primitives a composite is built out of, which is why they come first.** "Which item
has focus" and "which item was hit" are the two questions a roving-focus controller exists to answer,
and both are wrong by default — a controller written against bare globals reports the shadow *host*
the moment a widget is used inside a web component.

### 6b. `mountRovingFocus` — The Composite Controller

One function over a **DOM subtree**, not a component tree: no contexts, no hooks, no ref merging, no
list registry. It takes a root, a selector for its items, an orientation, and returns a disposer.

**Items are resolved live from the DOM on every interaction.** A composite whose items are added,
removed or reordered needs no re-registration — which is exactly what an SSR-first library wants,
because the server already rendered the items and nothing on the client should have to re-declare
them. A menu whose rows are rebuilt between openings works without re-mounting.

Four behaviours are easy to omit and are all required:

- **Arrow keys inside a text field belong to the caret, not to the widget.** The composite takes
  over only at the very edge of the text, with no selection and no Shift — so arrowing out of a
  filled search box feels like leaving it rather than like the toolbar stealing the keystroke.
- **Direction is read from the element, not from a global.** A single RTL subtree inside an LTR page
  must navigate as RTL, and only the resolved style knows that.
- **Items that are in the DOM but not rendered are not in the ring.** A closed submenu's popup is
  still a descendant of its parent popup, and a filtered-out row is still in the document; navigating
  into either strands focus on something that cannot take it.
- **A nested composite keeps the key it consumed.** `keydown` bubbles from an inner widget to the
  outer one, so the outer controller stands down when the event was already handled — otherwise both
  move focus and the inner move is immediately overwritten.

**Both disabled forms are honoured**: `disabled` removes an element from the tab order, while
`aria-disabled` keeps it focusable but inert — the right shape for a toolbar button that must stay
discoverable.

### 6c. `mountTransitionState` — The Transition Protocol

**One reusable controller, never per-component animation code.** It publishes
`data-starting-style` and `data-ending-style` around an open or close so CSS can animate both
directions, and reconciles `data-open` / `data-closed` with the element's real state.

It attaches to what the platform already reports — a popover's `toggle` and `beforetoggle`, a
`<details>` element's `toggle` — so it **never decides** whether something is open. The element
owns that; this only makes the state visible to a stylesheet.

That single `isOpen` check is why one controller covers three element kinds: it reads
`:popover-open` for a popover and `.open` otherwise, and `.open` is a real property on both
`HTMLDialogElement` and `HTMLDetailsElement`. Adding the `dialog`, `popover` and `accordion` scopes
needed no change to it at all.

### 6d. `mountPopupTriggerState` — The Trigger's Own State

**The same observation, pointed the other way.** `mountTransitionState` describes the popup;
this describes what points *at* it, publishing `data-popup-open` on the popup's invokers while it is
open. Same element to attach to, same four events, opposite direction — which is why it lives in the
same module.

It exists because CSS has no selector that walks from a popup to its trigger. "The toolbar button
that stays lit while its flyout is up" is a fact about the *button*, and no amount of styling the
flyout can express it.

Two decisions in the lookup, and both are the kind that is silently wrong the other way:

- **Triggers are resolved document-wide**, with
  `ownerDocument(popup).querySelectorAll('[commandfor="…"]')`. `commandfor` is a document-scoped
  reference — a trigger is very often *outside* the popup's subtree — so a subtree query would find
  none of them and the attribute would simply never appear.
- **`commandfor` alone does not make an element a trigger.** `Menu.Item` emits
  `command="hide-popover"` and `Dialog.Close` emits `command="close"`, both naming the popup they
  live in; an unfiltered lookup would light up every row of an open menu. The filter is on the
  command *verb* — `toggle-popover`, `show-popover`, `show-modal`.

The lookup is re-run on every state change rather than cached, so a trigger added or removed while
the popup lives is neither missed nor left stamped on a detached node.
