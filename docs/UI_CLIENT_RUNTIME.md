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
> modules are side-effectful; `src/ui/README.md` for controller options, signatures, and worked
> usage.

---

## 0. Quick Reference

- §1 Runtime Boundary: pointer to the governance rule that owns it
- §2 Mount Controllers: the browser controllers, their contracts, and what decides which are exported
- §2b Theme Controller and FOUC Prevention: where the theme surface lives, and what earns a pre-paint script
- §2c The `turnstile` scope — CAPTCHA controller: component-scoped, eager by default, self-healing, fails visible, and the opt-in challenge-at-submit mode
- §2d The Disposer Contract: every controller returns one, and why
- §2e mountMenu — Menu Keyboard Behaviour: what the platform owns and what the controller adds
- §2f mountTabs — Selection and Panel Visibility: automatic versus manual activation
- §2g mountTooltip — Hint Popover: why `popover="hint"` is what makes it compose
- §2h mountNumberField — Stepper Buttons: why its scope is eager
- §2i openPopoverAt — Coordinate Placement: the popup with no invoker to anchor to
- §2j mountCarouselDots — Strip-Driven Dot Marker: why it lifts the selected spelling off the row instead of restating it
- §2k mountScrollSpy — Fragment Nav Current Marker: what orders the entries, and what it refuses to emit
- §2l mountViewportCollapse — Width-Driven Disclosure: which state the server renders, and how the user takes over
- §3 Signals and Lazy Loading: client state without a framework
- §3a Signals — Reactive State: the settled-value guarantee and the rules that hold it up
- §3b Lazy Loading: the deferred import, and the failure that must not be silent
- §3c Resumable Scopes: `registerScope` and `resume`
- §4 htmx Bundle Import: the side-effect entry point
- §5 Never Use ui/client in an SSR Context: pointer to the governance rule that owns it

Every exported symbol's signature, options and worked usage — the controller primitives, the globals
a browser controller may not reach for, and `mountRovingFocus` among them — is documented with the
export surface in [`src/ui/README.md`](../src/ui/README.md). This document carries only what was
decided and why.

---

## 1. Runtime Boundary

See [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §1 for the SSR-versus-browser boundary,
which subpath tiers may be imported where, and why it is kept by import path rather than a runtime check.

---

## 2. Mount Controllers

Every mount controller is **idempotent per element and returns a disposer**, so calling one twice is
safe and a controller can be torn down. §2d states that contract as a rule.

**What a controller addresses decides whether it is exported.** A controller pointed at markup the
consumer wrote is public and carries its own per-root guard: `mountScrollSpy`, `mountCarouselDots`,
`mountViewportCollapse`, `openPopoverAt`, `mountRovingFocus`. A controller that is a registered
scope's `setup` body is not: `mountMenu`, `mountTabs`, `mountTooltip`, `mountNumberField`,
`mountInputFormat`, `mountTurnstile`, `mountExpandedState`. Those scopes are `eager`, so `resume()`
is their only correct caller and a second call would double-mount. Being internal without being
un-`@public` is what [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §1c permits —
its gate proves `@public → barrel`, not the converse. `mountRovingFocus` is public despite backing
four scopes because it is a primitive those scopes _call_ rather than a scope's `setup`.

### 2b. Theme Controller and FOUC Prevention

The theme surface is split across two subpaths, and the split matters:

- **`@y-core/forge/ui/chrome`** (SSR) exports `FOUC_SCRIPT`, `THEME_ATTR`, `DARK_CLASS`,
  `THEME_STORAGE_KEY`, and the `ThemeToggle` component.
- **`@y-core/forge/ui/chrome/client`** is a **side-effect module** that registers the `theme` and
  `navbar` resumable scopes — the latter applies the bar's runtime auth filtering and drives its
  viewport collapse (§2l) — and exports the `isDark` signal.

**`FOUC_SCRIPT` is an inline script for `<head>` that reads storage and sets the dark class
before first paint**, preventing a flash of unstyled content.

**Its hash must be listed in the CSP `script-src`.** Any _other_ server-rendered inline
`<script>` must instead carry the per-request nonce from `getNonce(c)` — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2a.

**A pre-paint inline script is for state the server cannot know, and a second one is not minted for
state it can.** Every surface that renders one state and corrects it on the client is tested against
that rule. The theme passes on every count: its value is in `localStorage`, which no server can
read, and the wrong intermediate state is a full-page inversion. The viewport-driven disclosure
(§2l) passes on none — its input is a width the stylesheet already answers, a disclosure default is
opt-in where a theme is universal and every inline script is a CSP hash _every_ consumer carries,
and its wrong intermediate state is "navigation visible", the accessible no-JS fallback rather than
a defect. **The residual is stated rather than hidden:** the correction lands when the app's client
entry runs, so deferring that entry behind a large bundle widens the window in which the disclosure
shows what the server rendered.

**The theme preference is held per document, not per scope.** A navbar toggle beside a settings
toggle is a legitimate composition, and each scope hydrating its own `pref` left the other advancing
from a stale value. The shared state is refcounted per document, the same shape `resume.ts` uses
(§3c), and its effects are created inside a **nested `withOwner`** so they land in a bag the resuming
scope's own owner does not empty — otherwise the first toggle disposed would take the painting with
it.

**`isDark` is a stable binding over the live documents, not a slot.** Its getter delegates to the
most recently acquired one, so it can be captured before `resume()` runs and still report the truth
afterwards; release promotes whichever document is still live, falling back to a constant `false`
when none is. A single slot fails both ways — a second document silently takes the export over, and
disposing either leaves `isDark` reading a computed whose sources are dead.

**Runtime auth filtering of the bar arrives as a document event, not through an exported setter.**
The `navbar` scope applies the token list the event carries to every filterable descendant; the
server seeds the same set at render, so the first paint is already correct. A channel rather than a
forge-held signal for two reasons: the emitter — a login, an htmx swap, an app's own router — need
not hold a reference to any forge module, and two bars on one page each resume their own scope while
both must follow one push. The listener is removed by the disposer `setup` returns (§2d).
`src/ui/README.md` owns the event's name and payload shape.

### 2c. The `turnstile` Scope — CAPTCHA Controller

**The capability arrives with the component, and there is no way to summon it without one.**
`<Turnstile>` stamps `data-scope="turnstile"` and `ui/core/client` registers that scope, so
`resume()` mounts a controller exactly where the markup rendered one. `mountTurnstile` is therefore
**not exported from `ui/client`**: a global one in a shared client entry ran on every route, so 598
pages of 600 paid for a capability two of them wanted.

**Its argument is the tree it searches, and it is required.** Given the scope root — which _is_ the
widget — it matches that node before descending; given an enclosing element it searches within it,
so a page with several widgets mounts one controller each. Searching the whole document instead
resolved every widget to the first one. It finds its `<form>` and site key from the markup, with no
selector to configure, and no-ops — reporting — when either is absent from the tree it was given.

Its deliberate behaviours:

- **Eager by default, deferrable per widget.** It loads Cloudflare's script at mount, because
  Cloudflare asks for it as early upon page entry as possible and because a challenge solved before
  the reader reaches the submit button is one they never wait on. `load="focus"` defers to the first
  `focusin` within the form, and is right for a form incidental to its page, where eager means a
  challenge issued to everyone who loads it. **There is no third, app-triggered mode**: `"lazy"`
  would collide with `ui/client`'s `lazy()`, which means an IntersectionObserver. It renders with
  `?render=explicit` and function-ref callbacks, so there are no global callback names, no implicit
  auto-render and no document scan; it renders on the async script's `load` event and **never calls
  `turnstile.ready()`**, which throws when the script loads async. **The preconnect hint is the
  app's job** — forge has no page-head API to hang it on.
- **The post-render focus restore acts only on a focus the reader was already holding; the guard is
  armed unconditionally.** A restore needs somewhere to restore _to_ and the guard does not: eagerly
  the render lands at page entry with `body` focused, yet Turnstile steals focus a beat after
  `render` returns, by which time the reader has clicked the first field — so arming on a held focus
  alone left that page undefended. A `focusout` originating inside the container is ignored, so
  tabbing between fields is unaffected. **The accepted hazard is a click-yank** within
  `TURNSTILE_FOCUS_GUARD_MS` of the render: from the event, the widget stealing focus and the reader
  choosing it are the same thing, and the steal is far commoner.
- **The injected script carries the page's own CSP nonce**, copied from an already-nonced `<script>`
  and read off the **property**, because the browser empties the `nonce` content attribute after
  insertion precisely to stop it being exfiltrated through a CSS attribute selector. **A `data-nonce`
  attribute of forge's own is therefore forbidden** — it would reopen the vector the emptying closes
  — and the value is written with `setAttribute`, not `script.nonce =`, which sets only the internal
  slot in some engines. The effect is that `script-src 'nonce-…' 'strict-dynamic'` works without
  widening anything to Cloudflare's origin
  ([`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §3).
- **The container reserves the widget's box, and only when the widget is always visible.** The
  reservation is keyed on `appearance`, not `challenge`: `appearance="always"` holds Cloudflare's
  published dimensions so the eager render stops shifting the layout during first paint, while
  `execute` and `interaction-only` reserve nothing — a widget that may never appear would otherwise
  leave a permanent hole. It is classes, never an inline `style`, for the dropped-`style` reason
  owned by [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1a.
- **The token is scoped to the form's own action, and to its own submission.** An `action` prop
  reaches `turnstile.render`, without which `verifyTurnstile`'s `expectedAction`
  ([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §4b) cannot be used at all and a token minted on
  one form verifies at any endpoint on the same host. A `cData` prop is the other half of
  `expectedCData` in the same way, and is the only way to tie a challenge to an app-side record; a
  `responseFieldName` prop reaches Cloudflare as `response-field-name` and renames the hidden token
  input the server's `tokenField` reads, which is what lets two widgets share a form. An `action`
  outside `TURNSTILE_ACTION_PATTERN`, or a `cData` outside `TURNSTILE_CDATA_PATTERN`, is **reported
  and still forwarded**, so the server stays the single enforcement point rather than the widget
  silently dropping what the author asked for; `responseFieldName` carries no pattern, being an HTML
  form field name forge has no charset ruling to enforce on. **One predicate decides both seams —
  the `htmx:confirm` hold and the `htmx:afterRequest` reset — and it tests the element htmx issued
  the request from**, so a descendant field's own request bubbles to the form and is neither held nor
  reset, and cannot burn the single-use token. **The test is structural because the answered URL
  cannot bear it**: a redirect leaves `responseURL` naming a URL the form never declared, and a
  submit control's own verb attribute overrides the form's.
- **Self-healing token, with expiry and timeout left to Cloudflare.** It resets the single-use token
  after every one of the form's own completed submissions, success or error, so a retry always
  carries a fresh token, and it clears the form only when the submission actually succeeded. It
  wires **no `expired-callback` or `timeout-callback`**: `refresh-expired` and `refresh-timeout`
  both default to `auto`, so a `reset()` of forge's own was at best redundant and at worst spent a
  second challenge.
- **Fails visible, never blocking — and the message comes back down.** There are **two** message
  slots, each overridable by prop: the general one (`children`), and an `unsupported` sibling for
  the one cause the general text actively misleads on — a browser Turnstile cannot run, where
  "disable any ad or script blockers" is advice the visitor cannot act on. **Two slots and not one
  per cause**, because the text is the app's to override and the controller cannot invent English of
  its own. Revealing is reversible: `retry` defaults to `auto`, so a transient fault the widget then
  solves itself takes its own message back down on success. **Under the default
  `challenge="render"` the submit button is intentionally not gated on Turnstile** — the server's
  `verifyTurnstile` ([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §4b) is the single fail-closed
  enforcement point, so a slow or blocked challenge can never brick the form.
- **A theme flip re-renders the widget, but never at the cost of a solved token.** The re-render
  runs only while no token has been issued; once one has, the widget keeps the colour it rendered in,
  since discarding it would make the visitor pay for a second challenge to change a colour. It
  observes the `dark` class deliberately — `ui/chrome`'s theme signal would be a cross-namespace
  dependency ([`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §3).
- **When the challenge runs is a second axis, and `challenge="submit"` is the opt-in.** `load`
  decides when the script is fetched; `challenge` decides when the challenge runs, and the two are
  independent. The default `"render"` runs it as the widget mounts, which starts the single-use
  token ageing immediately — fine for a short form, and wrong for one that takes longer than the
  token's lifetime to fill, where a backgrounded tab or a sleeping laptop can miss Cloudflare's
  `refresh-expired` auto-refresh and hand siteverify a `timeout-or-duplicate` token. Forge fails
  closed, so that costs the reader their submission. `challenge="submit"` instead runs exactly one
  challenge, at the press, from htmx's `htmx:confirm` seam; it is opt-in because render-time is the
  prevalent configuration and execute-at-submit is the documented remedy for long, multi-step or
  upload-bearing forms. `appearance` is its own prop rather than implied by the mode, because
  Cloudflare treats them as independent; pair `challenge="submit"` with `appearance="interaction-only"`.
- **In submit mode the button is held, for a bounded window that always ends — and is never opened
  on a widget that cannot answer.** The press is deferred, not gated: `verifyTurnstile` remains the
  single fail-closed enforcement point in either mode. The controller marks the submitter `disabled`
  and `aria-busy` for the window, because htmx applies `hx-disabled-elt` and its indicators only
  once the request is issued and the button would otherwise look dead. **The hold is conditional on
  widget health**: a render that threw or a pre-press `error-callback` leaves the widget dead, and a
  press then goes through unheld for `verifyTurnstile` to refuse, rather than sitting disabled for
  the full `TURNSTILE_EXECUTE_TIMEOUT_MS` on a widget that was never going to answer. **An
  interactive challenge swaps the budget rather than standing it down** — the busy state is dropped
  while the reader is being asked to click, and the 15s timer gives way to
  `TURNSTILE_INTERACTIVE_TIMEOUT_MS` (60s), far past a deliberate click and well inside the token's
  ~300s life, so a challenge the visitor walked away from cannot wedge the form for the page's life.
  **On failure the held request is dropped rather than issued**, because a POST with no token
  answers with a refusal naming the schema's first field, which reads as a form-validation error the
  reader cannot act on; the fallback is revealed and pressing submit again retries. A page whose
  script never loaded lets the press through unheld.
- **Forge bails on an invalid form only where htmx would have halted it anyway.** `htmx:confirm`
  fires before htmx validates, so a press on a form htmx _would_ halt must spend no challenge — but
  `form.checkValidity()` is the static algorithm and ignores `novalidate`, which htmx honours.
  `htmxWillValidate` mirrors htmx's own gate exactly: `hx-validate="true"` read off the issuing
  element alone (no inheritance, both spellings), `novalidate` honoured unless that attribute
  overrides it, and `formnovalidate` reaching the decision only when the issuing element is the form.
  **On a `novalidate` form, or a button-issued submission, an invalid press therefore spends a
  challenge** — htmx sends the request either way, the author has declared constraint validation is
  not the gate, and the alternative is a request leaving with an empty token.
- **Last press wins, and every dropped press is reported.** The hold is one record of the request
  and the control it was pressed on, so a token can never answer a different control's request: htmx
  records the pressed control as the form's `lastButtonClicked` and reads it back when the request is
  finally issued, so answering an earlier press would send one button's URL under the other's name. A
  second press displaces the first and re-arms the window, but rides the challenge already in flight
  — one press stays one challenge. Every way a hold ends without a request dispatches
  `TURNSTILE_ABANDONED_EVENT` on the **form**, bubbling and not cancelable, carrying
  `TurnstileAbandonedDetail` — `reason` (`timeout`, `interactive-timeout`, `error`, `unsupported`,
  `superseded`) and the `submitter` — un-busied before the dispatch, so a handler that focuses the
  control finds a live target. The event deliberately does not carry the held `issueRequest`:
  reviving it is the tokenless POST the drop exists to prevent. Teardown is the one exception and
  drops the hold silently, since it normally runs mid-swap and would dispatch into a page already
  going away. A reset from the form's own `htmx:afterRequest` cannot land on a live hold — a hold
  requires a healthy widget, an unheld request leaves only on a dead one — and would end it as a
  reported timed abandonment rather than a silent drop if it ever did.
- **Submit mode needs an htmx submission, and refuses without one.** A form with no htmx verb on it
  or on a descendant fires no `htmx:confirm` and has no request to hold, so the controller reports
  the authoring error and falls back to `challenge="render"` — a degraded but working form, never a
  dead submit button.

### 2d. The Disposer Contract

**Every controller returns a disposer that removes everything it installed, and a scope's `setup`
returns it.** `resume()` returns a teardown that runs every disposer collected during that resume,
so the two halves fit without either side knowing about the other.

**It is a contract, not a convenience.** A controller that cannot be disposed leaks a listener — and
often a `MutationObserver` and a pending timer — on every re-resume, and a page re-resuming after
each htmx swap accumulates one set per swap. Nothing warns; the page simply gets slower and starts
handling the same keystroke several times.

**The runtime owns the effects a `setup` creates; the author owns everything else.** Every `effect`
created while a scope's `setup` runs is collected and disposed with the scope — `withOwner` is the
primitive, and the scope runtime is its only caller. What a `setup` _returns_ is for what the runtime
cannot see: listeners, observers, timers, controller handles. It runs **after** the scope's effects
are disposed, so no reactive computation is alive while an author's teardown mutates the DOM those
effects write to.

**Ownership is the window in which `setup` runs, and nothing wider.** An effect created in an `on`
handler, or in a `.then()` resolving after `setup` returned, is owned by nothing and must be disposed
by whoever created it — per-invocation ownership would be wrong more often than right, since an
effect an action installs is normally meant to outlive that action.

Four consequences follow, each the rule rather than a special case:

- **A `setup` that returns nothing is legal**, and is not treated as a disposer.
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
focus management, and the two arrows that move between a panel and its submenu.

**The two horizontal arrows go through the platform rather than around it**, and which arrow means
which is **resolved from the popup's own writing direction** rather than hardcoded — so the pair
mirrors under `dir="rtl"`, including for a single RTL subtree inside an LTR page. The key pointing
_toward_ the submenu clicks the row's own trigger, whose `command="toggle-popover"` opens the panel;
the key pointing _away_ calls `hidePopover()`, the same path Escape already takes, so focus
restoration is one `toggle` handler rather than a second parallel one.

**Both keys are guarded twice**, and neither guard is optional: the handler bails on
`event.defaultPrevented`, because `keydown` bubbles from an open submenu to the panel containing it
and without the bail both controllers act on one press; and it calls `preventDefault()` on every key
it consumes, which is the other half of that contract.

Three further rulings: this lives in a controller mounted on the popup, **never in the scope
system**, whose delegated vocabulary carries no `keydown` by decision (§3c). **The opener is
captured, not derived from `commandfor`** — a menu can be opened by any invoker, and a context menu
has no single trigger button. And **it does no anchoring at all**: an invoker-opened popup gets an
implicit anchor, so every panel and submenu is placed by CSS alone (§2i).

### 2f. `mountTabs` — Selection and Panel Visibility

Adds the part specific to tabs on top of the composite controller: moving the selection, and the
panel visibility that follows it. **Panels are found through the `aria-controls` the markup already
declares**, so there is no second registry to keep in step.

**Automatic activation rides `focusin`**, which the arrow keys already produce, so the selection
follows roving focus without this controller knowing which key moved it. Manual activation listens
for `click`; which applies is read from the root's `data-activation`.

### 2g. `mountTooltip` — Hint Popover

**`popover="hint"` is the reason it composes**: a hint does not close an `auto` popover, so a tooltip
on a menu item does not dismiss the menu underneath it.

### 2h. `mountNumberField` — Stepper Buttons

Wires the increment and decrement buttons to the native input's own `stepUp` / `stepDown`, so
`min`, `max` and `step` are enforced by the platform rather than re-implemented.

**Its scope is eager, and that is forced by the markup**: the steppers carry no `data-on-*` action,
so a lazy scope would have nothing to resume it and the buttons would sit inert. The same reasoning
makes `toolbar`, `menu`, `tabs` and `tooltip` eager — every one is setup-only. `Dialog`, `Popover`,
`Accordion` and `Collapsible` stamp no scope at all, because the platform does the whole job
([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1h).

### 2i. `openPopoverAt` — Coordinate Placement

**Every other popup in forge is placed by CSS, against its trigger.** Every _invoker-opened_ popup
has an **implicit anchor** — its invoker — which `position-anchor`'s initial `auto` resolves to;
`src/ui/core/menu-anchor.browser.ts` measures that and pins the boundary this section depends on: a
popup shown by `showPopover()` rather than by an invoker has no implicit anchor at all. That is the
one case no anchor can serve — a **context menu has no trigger**. Nothing carries the anchor name,
every anchored rule resolves to nothing, and the UA's `[popover]` default centres the panel, the one
place a context menu must never be.

`openPopoverAt` shows the popup with its top-left corner on the point, clamped so the whole box stays
on screen. Four properties are load-bearing:

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
  platform light-dismisses it on the very `pointerup` that ended the right-click: `contextmenu` fires
  _between_ `pointerdown` and `pointerup`, and the dismiss pass on that release finds neither target
  inside a popup. `afterPointerUp` defers the show to a one-shot **capture-phase** `pointerup` on the
  owner document, ahead of the dismiss pass's own listeners and before any paint. Callers pass
  `event.buttons !== 0`, never a flat `true`: a keyboard-raised `contextmenu` (Menu key, `Shift+F10`)
  reports no buttons and is followed by no release, so an unconditional guard arms a listener the
  _next_ unrelated click fires.

The popup opts in with `Menu.Popup`'s `coords` prop, which stamps `data-coords` and selects the
coordinate rule; `openPopoverAt` stamps it too, so a popup that opens both ways needs no second
markup variant. Calling it again **repositions** an open popup.

**It returns a disposer, because the deferred path arms a listener.** The disposer cancels a pending
arm, and a second call on the same element cancels the first rather than arming a second — otherwise
the earlier one would show the panel at stale coordinates on the next release. The deferred show
bails when the element has left the document, since an htmx swap between the arm and the release
would otherwise call `showPopover()` on a detached node.

### 2j. `mountCarouselDots` — Strip-Driven Dot Marker

**`Carousel` is a scroll-snap strip with no script, so the server's `current` dot is a guess that
stops being true the moment the reader scrolls.** A dot is a fragment link: pressing it moves the
strip, but nothing in the platform moves the highlight with it. This controller closes that gap and
nothing else — the scrolling stays the platform's.

**It observes the slides against the _strip_ as the observer root, not the viewport**, and marks the
dot of the slide with the highest intersection ratio — against the viewport every slide of a visible
strip intersects at once.

**It lifts both class spellings off the server-rendered row rather than restating them.** Unlike
`mountScrollSpy`'s nav, a dot's selected look is baked into utility classes by `Pagination.Item`'s
variants, so there is no attribute for a stylesheet to select on. Reading the `on` and `off`
spellings off the rendered dots keeps the theme, the size and any caller class in the component
rather than making the controller a second home for them.

**It keeps the last marking while nothing is visible**, where §2k blanks the row. Mid-flick every
slide can fall below the first threshold, and a highlight that blinks off on every scroll is worse
than one that is briefly stale; a strip, unlike a page, always has a current slide.

**There is no autoplay, and adding one would need a ruling first.** An unrequested timed advance moves
content out from under a reader, which [`09-interaction.md`](../src/ui/design/reference/09-interaction.md) does not budget for.

### 2k. `mountScrollSpy` — Fragment Nav Current Marker

**A fragment nav has no navigation to hang a current marker off.** An on-page table of contents does
not change the URL as the reader scrolls, so nothing server-side can say which entry is current —
the gap between forge's rule that the current destination is always indicated and a page whose
destinations are all one document.

**Entries are ordered by the _targets'_ document position, never by link order.** "Which section is
being read" is a question about the page, and a nav may list its links in whatever order reads best.

**It emits `aria-current` and nothing else, with the value `location` rather than `page`.** The
visible cue is selected from the attribute directly by the stylesheet, so there is no parallel
`data-*` state to keep in step, and `page` would announce a navigation that never happened. **The
marker is rewritten from the whole visible set on every callback**, rather than moved from the
previous holder — so at most one link carries it, and none does while nothing intersects.

**It fails quiet in every direction, and that is safe here specifically**: no links, no resolvable
target, or a realm without `IntersectionObserver` yields a no-op disposer, and the links are real
anchors that navigate on their own. The disposer clears the attribute as well as disconnecting, since
a marker outliving its observer would show two current sections until the re-mount's first callback.

### 2l. `mountViewportCollapse` — Width-Driven Disclosure

**A `<details>` cannot make its own `open` state depend on viewport width** — no CSS writes that
property — so the only question is which state the server renders and which side JavaScript corrects.
**The server renders open**: with scripting unavailable the navigation is visible, which is the
accessible answer, so the controller only ever removes something. §2b states why that does not earn
a pre-paint script the way the theme does. The controller drives the property both ways while in
control.

**It stops driving the disclosure the moment the user does, for the lifetime of the mount.** A rail
that slams shut every time a phone rotates is worse than no controller at all. The decision is per
mount and **deliberately not persisted** — a persisted override would outlive the situation that
produced it. **The override is tracked by a counter of the controller's own writes, not by comparing
state**: every programmatic write fires exactly one `toggle`, in order, whereas a comparison reads
the user toggling _back_ to the controller's last value as the controller's own echo.

**The disposer restores the state it found — unless the user has taken over.** Once they have, what
is on screen is theirs, and restoring the server's state at teardown would be a second override at
the worst possible moment.

It fails quiet when the element is absent, is not a disclosure, or the realm has no `matchMedia`, and
the element is duck-typed on its `open` property rather than through `instanceof`, for the
cross-realm reason `src/ui/README.md`'s controller primitives give.

---

## 3. Signals and Lazy Loading

### 3a. Signals — Reactive State

`createSignal`, `computed` and `effect` are the whole seam. **Use signals for lightweight client
state that does not justify an HTMX round trip** — state that must survive navigation or be
authoritative belongs on the server.

**The engine is deliberately in-house, and those three names are the migration boundary.** Three
exports over roughly two hundred lines is below the cost of a facade over a third-party graph;
swapping the implementation behind them is the whole migration if that ever inverts.

**By the time a write returns, every dependent has observed the settled value.** A write enqueues
its subscribers and the queue drains synchronously — re-read after each run rather than snapshotted,
which collapses a chain to a single run of its shared reader. Synchronous rather than deferred to a
microtask: a scope action writes a signal, and the painted DOM has to be there before the handler
returns.

**A `computed` is lazy and pull-based**, so a read answers from its sources' _current_ values and
nothing can observe a derived value assembled before one of its sources moved — the torn read an
eager, push-based derivation produces. Whether a derived value really moved is decided at dequeue
against a per-source version that advances only on a real `Object.is` change, so an effect whose
sources moved under an unchanged value is dropped without running. **There is deliberately no dirty
flag**: an "already dirty, so stop propagating" short-circuit cannot coexist with the
throw-clears-the-queue rule below, because a flush abandoned by a thrower would leave the computed
marked dirty and wedge its queued reader for good.

**An effect runs exactly once per settled state, and that is a guarantee.** It rests on one rule:
**writing a signal during an `effect` or `computed` run throws.** With no writes in effects there is
no effect-to-effect edge, so a double run cannot be constructed at all. Ordering is not an
alternative route to the same guarantee: the edge that causes a double run is the _write_, which the
read graph cannot see and which is not knowable until it happens.

**Effects paint; commands belong in the handler that caused them.** The island model already
separates the roles (§3c): `on` handlers command, `computed` derives, `effect` paints. The
replacements need no new API — `computed` for derivation, an `on` handler for a command, and
`queueMicrotask` for a genuinely deferred one, which runs with no active node and so writes after
the flush has settled.

**A throwing effect clears the queue.** The throw reaches whoever performed the write, and the
effects queued behind the thrower are skipped until the next write — carrying them forward would run
them on an unrelated caller's stack. **A cycle throws past a per-node run cap**, a backstop rather than the
first line: an effect that writes the signal it reads is refused by the write rule before the cap
could count.

### 3b. Lazy Loading

`lazy` defers a dynamic import until the element carrying its `data-ref` **intersects the viewport**
— an IntersectionObserver, not an idle callback. It takes an **options object**, not positional
arguments, and accepts `within` so a controller inside an iframe or a shadow tree searches its own
document.

**A missing anchor and a missing IntersectionObserver both report.** Either leaves the module never
loaded, which is indistinguishable from never having been scheduled unless it is said out loud.

**A failed import retries; it does not die silently.** The rejection goes to `onError` — or, with no
handler, to `console.error`, because an error with nowhere to go is the one outcome this module
refuses. The element is re-observed after a fixed delay, and **both bounds are load-bearing**: the
cap exists because `observe()` invokes its callback _immediately_ for an element already on screen,
so an uncapped re-observe on a visible element is a spin loop; the delay is what makes the retry a
retry. Re-observing rather than calling `load()` again keeps an element scrolled out of view waiting
for re-entry instead of loading off-screen. A throw from `init` is reported the same way and stops
there, since the load succeeded. The disposer clears a pending retry timer, so a load still in
flight when a scope tears down neither re-observes nor runs `init`.

### 3c. Resumable Scopes

`registerScope(name, definition)` binds a scope's actions; `resume()` installs the single
delegated island listener that drives every registered scope.

**Register every scope before calling `resume()`**, the side-effect import that registers forge's own scopes included ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §2d).

**A component whose markup names a scope must guarantee the scope exists.** A side-effect module
registering scopes for markup a _sibling_ renders imports the module those scopes live in, rather
than leaving the app to discover the dependency from a warning. `ui/chrome/client` imports
`ui/core/client` for exactly this reason: chrome markup names the `menu` and `toolbar` scopes.

**A scope is lazy by default and resumes on the first delegated interaction inside it; an `eager`
scope runs its `setup` at `resume()`.** Choose `eager` whenever the markup carries no `data-on-*`
action of its own, because a lazy scope then has nothing that could ever resume it — that is the
whole setup-only family (§2h), and it is a correctness requirement rather than a performance
preference.

**Scope discovery descends into open shadow roots.** The eager pass walks the tree rather than
running one flat `querySelectorAll`, because a selector cannot cross a shadow boundary: a scope
rendered inside a web component would never be _visited_, so its `setup` would never run and nothing
would warn. Only an eager scope fails that way — the delegated half climbs out through `host`.
`resume(within)` accepts a `ShadowRoot` as the walk root, so a web component can resume only its own
subtree; the delegated listeners still go on the containing document, the scope events being
composed.

**Installing the listeners and resuming a tree are two jobs, and `resume` keeps them apart.** The
delegation is installed once per **document** and refcounted by the live `resume` calls holding it;
the eager pass runs on **every** call, over the root it was given. Conflating the two would make
`resume()` followed by `resume(shadowRoot)` return the first call's disposer without ever visiting
the shadow subtree. Each call's disposer owns only the scopes that call resumed; when its release
takes the refcount to zero, it first disposes every scope still active in the document — a
lazily-resumed scope belongs to no call's set and would otherwise outlive the listeners that were
its only route to teardown.

**One scope's `setup` cannot take the page down.** Each eager `setup` runs inside its own try/catch:
a throw is reported against the scope's name and the loop continues, so later scopes still resume and
a subsequent `resume()` re-attempts the one that threw. `hydrateState` therefore _throws_ on
malformed `data-state` rather than degrading to `{}` — that markup is server-authored and
deterministic per render, and a silent `{}` produced a scope whose every signal was missing.

**The delegated event vocabulary is `click`, `input`, `change`, `submit`. There is no `keydown`, by
decision.** Composite controllers own `keydown` at their **own widget root**, where arrow keys and
typeahead belong: a page-level keydown delegation would have to decide, for every keystroke, which
of several live widgets it was meant for — a question the widget's own root answers by construction.
The vocabulary is declared once and shared by the runtime's listeners and the server's emitted
`data-on-*` attributes, so adding a fifth event changes every attribute the server writes.

**One further delegated listener bridges native Invoker Commands, and it is not a fifth entry in
that vocabulary.** `resume` installs a `command` listener alongside the four, routing **only custom
commands** — those whose name begins with `--`. The platform's built-ins are left entirely to the
platform, which is what the markup-only menu of §2e depends on. The invoker enters the same walk a
`data-on-*` action does, so one handler table serves both routes and the server writes no new
attribute. **That listener must be capture-phase**, and that is the platform's constraint rather
than a preference: `command` is dispatched with `bubbles: false`, so a bubble-phase delegated
listener never sees it and every custom invoker action goes dead — silently, because the invoker
still fires and the platform still ignores a command it does not know.

---

## 4. htmx Bundle Import

**`@y-core/forge/ui/client/htmx` is imported for its side effect only, from the client entry**; it
uses no exports, attaches `htmx` to `window`, and registers the built-in extensions.

**The module is listed in `package.json` `sideEffects`, which is what stops a bundler tree-shaking
it away.** That file owns the list — never restate which modules are side-effectful. **Never import
htmx from a CDN URL**: this entry point is what pins the version to the forge package.

---

## 5. Never Use `ui/client` in an SSR Context

See [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §1a and §1b for the tier table and for
splitting a component across the boundary. The forge subpaths each tier covers are catalogued in
[`NAMESPACES.md`](./NAMESPACES.md) §3a.
