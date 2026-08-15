---
title: UI Client Runtime
description: "The browser-only UI tier: mount controllers, signals, lazy loading, the htmx side-effect import, and the hard SSR boundary."
---

# UI Client Runtime

> Owns the browser-only UI tier — `ui/client` controllers and signals, the `ui/chrome/client`
> theme registration, and the htmx side-effect import. **§5 is the load-bearing rule: these
> exports must never reach an SSR context.**
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the markup these controllers
> attach to and for the server half of the binding seam; `package.json` `sideEffects` for which
> modules are side-effectful; `src/ui/README.md` for controller options and worked usage.

---

## 0. Quick Reference

- §1 Runtime Boundary: pointer to the governance rule that owns it
- §2 Mount Controllers: the browser controllers, their contracts, and what decides which are exported
- §2b Theme Controller and FOUC Prevention: where the theme surface lives, and what earns a pre-paint script
- §2c The `turnstile` scope — CAPTCHA controller: component-scoped, engagement-gated, self-healing, fails visible
- §2d The Disposer Contract: every controller returns one, and why
- §2e mountMenu — Menu Keyboard Behaviour: arrow navigation, typeahead, focus, and the submenu arrows
- §2f mountTabs — Selection and Panel Visibility: automatic versus manual activation
- §2g mountTooltip — Hint Popover: hover and focus intent
- §2h mountNumberField — Stepper Buttons: why its scope is eager
- §2i openPopoverAt — Coordinate Placement: the popup with no invoker to anchor to
- §2k mountScrollSpy — Fragment Nav Current Marker: what orders the entries, and what it refuses to emit
- §2l mountViewportCollapse — Width-Driven Disclosure: which state the server renders, and how the user takes over
- §3 Signals and Lazy Loading: client state without a framework
- §3a Signals — Reactive State: `createSignal`, `computed`, `effect`
- §3b Lazy Loading: the deferred import, and the failure that must not be silent
- §3c Resumable Scopes: `registerScope` and `resume`
- §4 htmx Bundle Import: the side-effect entry point
- §5 Never Use ui/client in an SSR Context: pointer to the governance rule that owns it

The controller primitives every controller is built out of — the global reflexes a browser
controller may not reach for, their node-resolved replacements, the testable realm hazard, and
`mountRovingFocus`'s ring rules — are exported symbols, so they are documented where the rest of the
export surface is: [`src/ui/README.md`](../../src/ui/README.md) under `@y-core/forge/ui/client`.

---

## 1. Runtime Boundary

See [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §1 for the SSR-versus-browser boundary, which
subpath tiers may be imported where, and why it is kept by import path rather than a runtime
check.

---

## 2. Mount Controllers

Every mount controller is **idempotent per element and returns a disposer**, so calling one twice is
safe and a controller can be torn down. §2d states that contract as a rule; the shared primitives the
controllers below are built out of are documented with the export surface in `src/ui/README.md`.

**What a controller addresses decides whether it is exported.** A controller pointed at markup the
consumer wrote is public and carries its own per-root guard: `mountScrollSpy`,
`mountViewportCollapse`, `openPopoverAt`, `mountRovingFocus`. A controller that is a registered
scope's `setup` body is not: `mountMenu`, `mountTabs`, `mountTooltip`, `mountNumberField`,
`mountTurnstile`, `mountExpandedState`. Those scopes are `eager`, so `resume()` is their only correct
caller and a second call would double-mount. Being internal without being un-`@public` is what
[`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1c permits — its gate proves
`@public → barrel`, not the converse. `mountRovingFocus` is public despite backing four scopes
because it is a primitive those scopes *call* rather than a scope's `setup`, and an author building
their own composite is obliged to reach for it.

### 2b. Theme Controller and FOUC Prevention

The theme surface is split across two subpaths, and the split matters:

- **`@y-core/forge/ui/chrome`** (SSR) exports `FOUC_SCRIPT`, `THEME_ATTR`, `DARK_CLASS`,
  `THEME_STORAGE_KEY`, and the `ThemeToggle` component.
- **`@y-core/forge/ui/chrome/client`** is a **side-effect module** that registers the `theme` and
  `navbar` resumable scopes — the latter applies the bar's runtime auth filtering and drives its
  viewport collapse (§2l) — and exports the `isDark` signal.

**`FOUC_SCRIPT` is an inline script for `<head>` that reads storage and sets the dark class
before first paint**, preventing a flash of unstyled content.

**Its hash must be listed in the CSP `script-src`.** Any *other* server-rendered inline
`<script>` must instead carry the per-request nonce from `getNonce(c)` — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2a.

**A pre-paint inline script is for state the server cannot know, and a second one is not minted for
state it can.** This is where that precedent lives: any surface that renders one state and corrects
it on the client is tested against it. The theme passes on every count — its correct value is in
`localStorage`, which no server can read, and the wrong intermediate state is a full-page inversion.
The viewport-driven disclosure (§2l) passes on none, and gets no equivalent: its input is a
`matchMedia` read of a width the stylesheet already responds to; every inline script is a CSP hash
*every* consumer carries, and a disclosure default is opt-in where a theme is universal; and its
wrong intermediate state is "navigation visible", which is the accessible no-JS fallback rather than
a defect. **The residual is stated rather than hidden:** the correction lands when the app's client
entry runs, so deferring that entry behind a large bundle widens the window in which the disclosure
shows the state the server rendered.

**The theme preference is held per document, not per scope.** A navbar toggle beside a settings
toggle is a legitimate composition, and each scope hydrating its own `pref` meant cycling one left
the other advancing from a stale value. `ui/chrome/client.ts` therefore keeps a
`WeakMap<Document, …>` with a `holders` refcount, the same shape `resume.ts` uses (§3c): the first
`theme` scope builds the `pref` signal, the `matchMedia` listener and the two effects that paint
`<html>`; every later scope takes a share and re-points its own `state.pref` at the shared signal.
Those effects are created inside a **nested `withOwner`**, so they land in a bag the resuming
scope's own owner does not empty — otherwise the first toggle disposed would take the painting with
it. The last release disposes that bag and removes the listener.

**`isDark` is a stable binding over the live documents, not a slot.** Its getter delegates to the
most recently acquired one, so it can be captured before `resume()` runs and still report the truth
afterwards. A single slot fails both ways: a second document silently takes the export over, and disposing
either leaves `isDark` reading a computed whose sources are dead. Release promotes
whichever document is still live, falling back to a constant `false` when none is.

**Runtime auth filtering of the bar arrives as a document event, not through an exported setter.**
The `navbar` scope listens on its owner document and applies the token list the event carries to
every filterable descendant; the server seeds the same set at render, so the first paint is already
correct. A channel rather than a forge-held signal for two reasons: the emitter — a login, an htmx
swap, an app's own router — need not hold a reference to any forge module, and two bars on one page
each resume their own scope while both must follow one push. The listener is installed by `setup`
and removed by the disposer it returns (§2d), so a torn-down bar stops following the channel.
`src/ui/README.md` owns the event's name and payload shape.

### 2c. The `turnstile` Scope — CAPTCHA Controller

**The capability arrives with the component, and there is no way to summon it without one.**
`<Turnstile>` stamps `data-scope="turnstile"` on its own widget div and `ui/core/client` registers
that scope, so `resume()` mounts a controller exactly where the markup rendered one — the same wiring
`Menu`, `Tabs`, `Tooltip` and `NumberField` already use. `mountTurnstile` is therefore **not exported
from `ui/client`**, like its four siblings: an app side-effect-imports `ui/core/client` and calls
`resume()`, and that is the whole API. This is a correctness property, not a convenience — a global
`mountTurnstile()` in a shared client entry ran on every route, so 598 pages of 600 paid for a
capability two of them wanted and logged a miss for it. A page that renders no `<Turnstile>` has no
scope to resume, so nothing is fetched and nothing is reported.

**Its argument is the tree it searches, and it is required.** Given the scope root — which *is* the
widget — it matches that node before descending, as `resume.ts` does for `data-scope`; given an
enclosing element it searches within it. Either way a page with several `<Turnstile>` widgets mounts
one controller each. Searching the whole document instead resolved every widget to the first one:
the later ones never mounted, and disposing any of them removed the first one's live widget. It
finds its enclosing `<form>` via `closest("form")` and reads `siteKey` from the widget's
`data-sitekey` — there is no selector to configure. It no-ops, reporting, when the widget or its form
is absent from the tree it was pointed at; both are authoring errors, since a caller only reaches it
by rendering the component.

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
so the two halves fit without either side knowing about the other — a `setup` is typically just
`({ root }) => mountRovingFocus(root, { items: "[data-toolbar-item]" })`.

**It is a contract, not a convenience.** A controller that cannot be disposed leaks a listener — and
often a `MutationObserver` and a pending timer — on every re-resume, and a page re-resuming after
each htmx swap accumulates one set per swap. Nothing warns; the page simply gets slower and starts
handling the same keystroke several times.

**The runtime owns the effects a `setup` creates; the author owns everything else.** Every `effect`
created while a scope's `setup` runs is collected and disposed with the scope, so a disposer never
has to be threaded back out for one — `withOwner` is the primitive, and the scope runtime is its only
caller. What a `setup` *returns* is for what the runtime cannot see: listeners, observers, timers,
controller handles. It runs **after** the scope's effects are disposed, so no reactive computation is
alive while an author's teardown mutates the DOM those effects write to.

**Ownership is the window in which `setup` runs, and nothing wider.** An effect created in an `on`
handler, or in a `.then()` resolving after `setup` returned, is owned by nothing and must be disposed
by whoever created it. Per-invocation ownership would be wrong more often than right — an effect an
action installs is normally meant to outlive that action — so the boundary is stated, not closed.

Four consequences follow, each the rule rather than a special case:

- **A `setup` that returns nothing is legal**, and is not treated as a disposer. A scope with no
  listeners of its own has nothing to tear down.
- **A disposer must be idempotent-safe to call after its element is gone.** Removing a listener from
  a detached node is a no-op, which is why teardown never needs to check.
- **A `setup` that throws disposes the effects it created and leaves its root resumable.** A root
  marked resumed with no disposer would be unreachable by every teardown and inert on re-resume,
  which is a worse failure than the throw.
- **A throwing disposer is reported and does not stop the rest of teardown.** Teardown iterates every
  live scope, so one failure must not silently skip the scopes queued behind it.

### 2e. `mountMenu` — Menu Keyboard Behaviour

**It opens and closes only what the horizontal arrows ask it to.** Opening, closing, light-dismiss,
Escape and top-layer stacking belong to the Popover API, and selecting an item closes the menu
through `command="hide-popover"` ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h). What is left
is what ARIA's menu pattern asks for and the platform does not supply: arrow navigation, typeahead,
focus on the first item when the menu opens, focus back on the opener when it closes, and the two
arrows that move between a panel and its submenu.

**The two horizontal arrows go through the platform rather than around it**, and which arrow means
which is **resolved from the popup's own writing direction** rather than hardcoded (`isRtl`, `src/ui/README.md`) — so the
pair mirrors under `dir="rtl"`, including for a single RTL subtree inside an LTR page. The key
pointing *toward* the submenu calls `.click()` on a `menu-submenu-trigger` — the row's own
`command="toggle-popover"` is what opens the panel, and the nested popup's own `mountMenu` is what
moves focus into it. The key pointing *away* calls `hidePopover()` on a nested popup, the same path
Escape already takes, so focus restoration is the one `toggle` handler rather than a second parallel
one. Nothing about the state machine is reimplemented.

**Both keys are guarded twice**, and neither guard is optional: the handler bails on
`event.defaultPrevented`, because `keydown` bubbles from an open submenu to the panel containing it
and without the bail both controllers act on one press; and it calls `preventDefault()` on every key
it consumes, which is the other half of that contract. `mountRovingFocus` leaves both keys unclaimed
under `orientation: "vertical"`, so there is no contention with it.

Four further rulings: this lives in a controller mounted on the popup, **never in the scope
system**, whose delegated vocabulary carries no `keydown` by decision (§3c). **The opener is
captured, not derived from `commandfor`** — a menu can be opened by any invoker, and a context menu
has no single trigger button. **Focus is only reclaimed when the close actually stranded it**, since
a click elsewhere has already put focus where the user wants it. And **it does no anchoring at
all**: an invoker-opened popup gets an implicit anchor, so every panel and submenu is placed by CSS
alone, row-accurately — `menu-anchor.browser.ts` holds the measurement.

### 2f. `mountTabs` — Selection and Panel Visibility

Adds the part specific to tabs on top of the composite controller: moving the selection, and the
panel visibility that follows it. **Panels are found through the `aria-controls` the markup already
declares**, so there is no second registry to keep in step.

**Automatic activation rides `focusin`**, which the arrow keys already produce, so the selection
follows roving focus without this controller knowing which key moved it. Manual activation listens
for `click`; which applies is read from the root's `data-activation`.

### 2g. `mountTooltip` — Hint Popover

Shows on hover and on focus, hides on leave, blur and Escape. **`popover="hint"` is the reason it
composes**: a hint does not close an `auto` popover, so a tooltip on a menu item does not dismiss
the menu underneath it.

### 2h. `mountNumberField` — Stepper Buttons

Wires the increment and decrement buttons to the native input's own `stepUp` / `stepDown`, so
`min`, `max` and `step` are enforced by the platform rather than re-implemented.

**Its scope is eager, and that is forced by the markup**: the steppers carry no `data-on-*` action,
so a lazy scope would have nothing to resume it and the buttons would sit inert. The same reasoning
makes `toolbar`, `menu`, `tabs` and `tooltip` eager — every one is setup-only. `Dialog`, `Popover`,
`Accordion` and `Collapsible` stamp no scope at all, because the platform does the whole job
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h).

### 2i. `openPopoverAt` — Coordinate Placement

**Every other popup in forge is placed by CSS, against its trigger** — through the anchored rules in
`forge-ui.css`, which name no anchor bar the tooltip's. Every *invoker-opened* popup has an
**implicit anchor** — its invoker — which `position-anchor`'s initial `auto` resolves to, for
`command`/`commandfor` exactly as for `popovertarget`; `src/ui/core/menu-anchor.browser.ts` measures
that and pins the boundary this section depends on: a popup shown by `showPopover()` rather than by
an invoker has no implicit anchor at all. That is the one case no anchor can serve — a **context
menu has no trigger**. It opens where a right-click landed, on an element that is not a button, so
nothing carries the anchor name, every anchored rule resolves to nothing, and the UA's `[popover]`
default (`inset: 0; margin: auto`) centres the panel, the one place a context menu must never be.

`openPopoverAt(el, x, y, options?)` shows the popup with its top-left corner on the point, clamped so
the whole box stays on screen. Four properties are load-bearing:

- **The coordinates go through CSSOM** (`el.style.setProperty`), never a generated `style` attribute
  — for the CSP-and-dropped-`style` pair owned by
  [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1a.
- **The matching CSS rule must reset `inset` and `margin` explicitly.** Without that the UA default
  survives, the panel centres itself, and the custom properties hold perfectly correct values while
  nothing moves. That failure looks like a bug in the TypeScript and is not.
- **Clamping needs the box, not the point**, so the coordinates are written twice: once before the
  popup is shown, while it still measures zero, and once after. Both in one task, so the browser
  paints the corrected position rather than the provisional one.
- **A menu opened from `contextmenu` must be held back until the button is released**, or the
  platform light-dismisses it on the very `pointerup` that ended the right-click. `contextmenu` fires
  *between* `pointerdown` and `pointerup`, and the dismiss pass on that release finds neither target
  inside a popup — nothing was open when the button went down — so everything is hidden one event
  after it was shown and the reader sees a menu that flashes and vanishes. `afterPointerUp` defers
  the show to a one-shot **capture-phase** `pointerup` on the owner document: the dismiss pass runs
  ahead of listeners for the same event, so showing there is still within that one event and before
  any paint, and the pass finds nothing to dismiss. Callers pass `event.buttons !== 0`, never a flat
  `true` — a keyboard-raised `contextmenu` (Menu key, `Shift+F10`) reports no buttons and is followed
  by no release, so an unconditional guard arms a listener the *next* unrelated click fires. `once`,
  so a later click still light-dismisses normally.

The popup opts in with `Menu.Popup`'s `coords` prop, which stamps `data-coords` and selects the
coordinate rule; `openPopoverAt` stamps it too, so a popup that opens both ways needs no second
markup variant. Calling it again **repositions** an open popup, which is what a second right-click
elsewhere should do.

**It returns a disposer, because the deferred path arms a listener.** Nothing in `ui/client` installs
a listener and returns `void`. The disposer cancels a pending arm, and a second call on the same
element cancels the first rather than arming a second listener — otherwise the earlier one would show
the panel at stale coordinates on the next release. The deferred show also bails when the element has
left the document, since an htmx swap between the arm and the release would otherwise call
`showPopover()` on a detached node.

### 2k. `mountScrollSpy` — Fragment Nav Current Marker

**A fragment nav has no navigation to hang a current marker off.** An on-page table of contents or a
docs sidebar does not change the URL as the reader scrolls, so nothing server-side can say which
entry is current — which is the gap between forge's rule that the current destination is always
indicated and a page whose destinations are all one document.

**Entries are ordered by the *targets'* document position, never by link order**, computed with
`compareDocumentPosition` over the resolved sections. "Which section is being read" is a question
about the page, and a nav may list its links in whatever order reads best — a grouped table of
contents is often alphabetical within each group, exactly where link order names the wrong section.

**It emits `aria-current` and nothing else, with the value `location` rather than `page`.** The
visible cue is selected from the attribute directly by the stylesheet, so there is no parallel
`data-*` state to keep in step, and `page` would announce a navigation that never happened.

**The marker is rewritten from the whole visible set on every callback**, rather than moved from the
previous holder — so at most one link carries it, and none does while nothing intersects.

**It fails quiet in every direction, and that is safe here specifically**: no links, no resolvable
target, or a realm without `IntersectionObserver` yields a no-op disposer, and the links are real
anchors that navigate on their own. The disposer clears the attribute as well as disconnecting —
a marker outliving its observer would show two current sections until the re-mount's first callback.

### 2l. `mountViewportCollapse` — Width-Driven Disclosure

**A `<details>` cannot make its own `open` state depend on viewport width** — no CSS writes that
property — so the only question is which state the server renders and which side JavaScript
corrects. **The server renders open**: with scripting unavailable the navigation is visible, which is
the accessible answer, so the controller only ever removes something. §2b states why that trade-off
does not earn a pre-paint script the way the theme does. The controller drives the property both
ways while in control — collapsed while its query matches, expanded while it does not.

**It stops driving the disclosure the moment the user does, for the lifetime of the mount.** A rail
that slams shut every time a phone rotates is worse than no controller at all. The decision is per
mount and **deliberately not persisted** — a persisted override would outlive the situation that
produced it.

**The override is tracked by a counter of the controller's own writes, not by comparing state.**
Every programmatic write fires exactly one `toggle`, in order, so a counter tells the controller's
changes from the user's. A state comparison cannot: the user toggling *back* to the value the
controller last wrote is still the user deciding, and a comparison reads that as the controller's
own echo.

**The disposer restores the state it found — unless the user has taken over.** Once they have, what
is on screen is theirs, and restoring the server's state at teardown would be a second override at
the worst possible moment.

It fails quiet when the element is absent, is not a disclosure, or the realm has no `matchMedia`, and
the element is duck-typed on its `open` property rather than through `instanceof` for the
cross-realm reason `src/ui/README.md`'s controller primitives give.

---

## 3. Signals and Lazy Loading

### 3a. Signals — Reactive State

`createSignal`, `computed` and `effect` are the whole seam; `src/ui/README.md` carries their
signatures. **Use signals for lightweight client state that does not justify an HTMX round trip** —
state that must survive navigation or be authoritative belongs on the server.

**The engine is deliberately in-house, and those three names are the migration boundary.** Three
exports over roughly two hundred lines is below the cost of a facade over a third-party graph;
swapping the implementation behind them is the whole migration if that ever inverts.

**By the time a write returns, every dependent has observed the settled value.** A write enqueues
its subscribers and the queue drains synchronously — re-read after each run rather than snapshotted,
which collapses a chain to a single run of its shared reader. Synchronous rather than deferred to a
microtask, because a scope action writes a signal and the painted DOM has to be there before the
event handler returns.

**A `computed` is lazy and pull-based.** Its body never runs at creation, never runs if nothing
reads it, and re-derives on read only when a source actually moved. A read therefore answers from
its sources' *current* values, so nothing can observe a derived value assembled before one of its
sources moved — the torn read an eager, push-based derivation produces.

**Optimistic enqueue, drain-time drop.** A write enqueues the effects behind its subscribers,
walking *through* derived nodes, which hold no queue slot of their own. Whether a derived value
really moved is decided at dequeue, against the version each effect recorded per source; a
computed's version moves only on a real `Object.is` change, so an effect whose sources moved under
an unchanged value is dropped without running.

**There is no dirty flag, and that is a correctness decision rather than a simplification.** An
"already dirty, so stop propagating" short-circuit cannot coexist with the throw-clears-the-queue
rule below: a flush abandoned by a thrower drops the queued reader while the computed stays marked
dirty, so the next write short-circuits and that reader is wedged for good. The version walk costs
O(deps) per queued node — depth one and single-digit fan-out here — and has no such hazard.

**An effect runs exactly once per settled state, and that is a guarantee.** It rests on one rule:
**writing a signal during an `effect` or `computed` run throws.** With no writes in effects there is
no effect-to-effect edge, so a double run cannot be constructed at all. Ordering is not an
alternative route to the same guarantee: the shape that double-runs — one effect writing a signal a
second reads while a third writes a leaf — puts all three at depth 1 of the *read* graph, and the
edge that causes the double run is the *write*, which the read graph cannot see and which is not
knowable until it happens.

**Effects paint; commands belong in the handler that caused them.** The island model already
separates the roles (§3c): `on` handlers command, `computed` derives, `effect` paints. The throw
matches the module's posture — `computed` throws on a self-read, and the run cap catches a cycle —
and it additionally catches a write from inside a `computed`. Shipping the assertion with no build
step is safe because the rule is a property of the *call site*: an effect either writes or it does
not, deterministically (§2's throw-or-report rule). The sanctioned replacements need no new API —
`computed` for derivation, an `on` handler for a command, and `queueMicrotask` for a genuinely
deferred one, which runs with no active node and so writes after the flush has settled.

**A throwing effect clears the queue.** The throw reaches whoever performed the write, and the
effects queued behind the thrower are skipped until the next write — carrying them forward would run
them on an unrelated caller's stack.

**A cycle throws past a per-node run cap.** The cap counts *one node's* runs within one flush, so a
deep chain of *N* distinct nodes costs one run each and never approaches it; the budget is
independent of graph size, which is why it is small. It is a backstop rather than the first line —
an effect that writes the signal it reads is refused by the write rule before the cap could count.

### 3b. Lazy Loading

`lazy` takes an **options object**, not positional arguments, and accepts `within` so a controller
inside an iframe or a shadow tree searches its own document.

- **`lazy({ ref, load, init, rootMargin?, threshold?, onError?, within? })`** defers a dynamic
  import until the element carrying `data-ref="{ref}"` **intersects the viewport** — an
  IntersectionObserver, not an idle callback — then calls `init(mod, el)`. Returns a disposer.

**A missing anchor and a missing IntersectionObserver both report.** Either leaves the module never
loaded, which is indistinguishable from never having been scheduled unless it is said out loud.

**A failed `lazy` import retries; it does not die silently.** The rejection goes to `onError` — or,
with no handler, to `console.error`, because an error with nowhere to go is the one outcome this
module refuses. The element is re-observed after a fixed delay, and both bounds are load-bearing.
The cap — three `load()` calls — exists because `observe()` invokes its callback *immediately* for
an element already on screen, so an uncapped re-observe on a visible element is a spin loop. The
delay is what makes the retry a retry: re-observing at once spends the whole budget within a few
frames of the first failure, recovering only from an outage that is already over. Re-observing
rather than calling `load()` again is deliberate too — an element scrolled out of view waits for
re-entry instead of loading off-screen. A throw from `init` is reported the same way and stops
there, since the load succeeded. The disposer marks the controller disposed and clears a pending
retry timer, so a load still in flight when a scope tears down neither re-observes nor runs `init`.

### 3c. Resumable Scopes

`registerScope(name, definition)` binds a scope's actions; `resume()` installs the single
delegated island listener that drives every registered scope.

**Register every scope before calling `resume()`** — including the side-effect import that
registers forge's own scopes ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §2d).

**A component whose markup names a scope must guarantee the scope exists.** A side-effect module
registering scopes for markup a *sibling* renders imports the module those scopes live in, rather
than leaving the app to discover the dependency from a warning. `ui/chrome/client` imports
`ui/core/client` for exactly this reason: chrome markup names the `menu` and `toolbar` scopes.

**A scope is lazy by default and resumes on the first delegated interaction inside it; an `eager`
scope runs its `setup` at `resume()`.** Choose `eager` whenever the markup carries no `data-on-*`
action of its own, because a lazy scope then has nothing that could ever resume it — that is the
whole setup-only family (§2h), and it is a correctness requirement rather than a performance
preference.

**Scope discovery descends into open shadow roots.** The eager pass walks the tree rather than
running one flat `querySelectorAll`, because a selector cannot cross a shadow boundary: a scope
rendered inside a web component would otherwise never be *visited*, so its `setup` would never run
and nothing would warn. The delegated half has no such problem — `closestAcross` climbs out through
`host` — so a *lazy* scope inside a shadow root works either way and only an eager one would fail,
silently. A
closed root reports `shadowRoot === null` and is stepped over. `resume(within)` accepts a
`ShadowRoot` as the walk root, so a web component can resume only its own subtree; the delegated
listeners still go on the containing document, since the four scope events are composed.

**Installing the listeners and resuming a tree are two jobs, and `resume` keeps them apart.** The
delegation is installed once per **document** and refcounted by the live `resume` calls holding it;
the eager pass runs on **every** call, over the root it was given. Conflating the two would make
`resume()` followed by `resume(shadowRoot)` return the first call's disposer without ever visiting
the shadow subtree, so a web component resuming its own tree would come back silently inert. Each call's
disposer owns only the scopes that call resumed. When its release takes the refcount to zero, it
first disposes every scope still active in the document — a lazily-resumed scope belongs to no
call's set and would otherwise outlive the listeners that were its only route to teardown.

**One scope's `setup` cannot take the page down.** Each eager `setup` runs inside its own try/catch:
a throw is reported against the scope's name and the loop continues, so later scopes still resume and
a subsequent `resume()` re-attempts the one that threw. `hydrateState` therefore *throws* on
malformed or non-object `data-state` rather than degrading to `{}` — that markup is server-authored
and deterministic per render, and a silent `{}` produced a scope whose every signal was missing.

**The delegated event vocabulary is `click`, `input`, `change`, `submit`. There is no `keydown`, by
decision.** Composite controllers own `keydown` at their **own widget root**, where arrow keys and
typeahead belong: a page-level keydown delegation would have to decide, for every keystroke, which
of several live widgets it was meant for — a question the widget's own root answers by construction.
The vocabulary is declared once and shared by the runtime's listeners and the server's emitted
`data-on-*` attributes, so adding a fifth event changes every attribute the server writes.

**One further delegated listener bridges native Invoker Commands, and it is not a fifth entry in
that vocabulary.** `resume` installs a `command` listener alongside the four, on the same document
and released with them, routing **only custom commands** — those whose name begins with `--`. The
platform's built-ins are left entirely to the platform, which is what the markup-only menu of §2e
depends on. The action name is the command minus that prefix, and the invoker enters the same walk
a `data-on-*` action does: up through `[data-scope]` ancestors to the first scope whose `on` table
owns the name. One handler table serves both routes, and the server writes no new attribute.

**That listener must be capture-phase, and that is the platform's constraint rather than a
preference.** `command` is dispatched with `bubbles: false`, so a bubble-phase delegated listener
never sees it and every custom invoker action goes dead — silently, because the invoker still fires
and the platform still ignores a command it does not know.

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

See [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §1a and §1b for the tier table and for
splitting a component across the boundary. The forge subpaths each tier covers are catalogued in
[`NAMESPACES.md`](./NAMESPACES.md) §3a.
