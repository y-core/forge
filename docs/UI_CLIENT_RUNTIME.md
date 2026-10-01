---
title: UI Client Runtime
description: "The browser-only UI tier: mount controllers, signals, lazy loading, the htmx side-effect import, and the hard SSR boundary."
audience: consumer
---

# UI Client Runtime

> Owns the browser-only UI tier — `ui/client` controllers and signals, the `ui/chrome/client` theme registration, and the htmx side-effect import.
> **§5 is the load-bearing rule: these exports must never reach an SSR context.**
>
> Defers to: [`UI_SSR_COMPONENTS.md`][usc] for the markup these controllers attach to and for the server half of the binding seam; `package.json`
> `sideEffects` for which modules are side-effectful; [`SECURITY_HARDENING.md`][sh-2g] §2g for the Trusted Types policy htmx runs under;
> `src/ui/README.md` for controller options, signatures, and worked usage.

---

## 0. Quick Reference

- §2 Mount Controllers: the disposer every controller returns, and what decides which are exported
- §2a State-Only Islands versus Contract-Bearing Scopes: when to reach for `Resumable`, and when the scope root is hand-rendered
- §2b Theme Controller and FOUC Prevention: where the theme surface lives, and what earns a pre-paint script
- §2c The `turnstile` scope — CAPTCHA controller: component-scoped, eager by default, self-healing, fails visible, and the opt-in
  challenge-at-submit mode that holds a press and replays it
- §2d The Disposer Contract: every controller returns one, and why
- §2i openPopoverAt — Coordinate Placement: the popup with no invoker to anchor to
- §2j mountCarouselDots — Strip-Driven Dot Marker: why it lifts the selected spelling off the row instead of restating it
- §2k mountScrollSpy — Fragment Nav Current Marker: what orders the entries, and what it refuses to emit
- §2l mountViewportCollapse — Width-Driven Disclosure: which state the server renders, and how the user takes over
- §2m announce — The Page's One Voice: channels, the settle, the cancel, and which channels belong to forge
- §3 Signals and Lazy Loading: client state without a framework
- §3a Signals — Reactive State: the settled-value guarantee and the rules that hold it up
- §3b Lazy Loading: the deferred import, and the failure that must not be silent
- §3c Resumable Scopes: `registerScope` and `resume`, how a swapped-out scope is disposed, and the inert-click guard
- §4 htmx Bundle Import: the side-effect entry point, the `forge-htmx` extension, and why htmx's indicator sheet is removed
- §4a Which Responses Swap: HTML 4xx Yes, 5xx No: why a rendered refusal lands in its target, and any other failure does not
- §4b Why the Entry Listens on `document`: htmx dispatches on `document` for an element a swap removed
- §5 Never Use ui/client in an SSR Context: pointer to the governance rule that owns it

---

## 2. Mount Controllers

Every mount controller is **idempotent per element and returns a disposer**, so calling one twice is safe and a controller can be torn down (§2d).

**What a controller addresses decides whether it is exported.** A controller pointed at markup the consumer wrote is public and carries its own
per-root guard, and the barrel `src/ui/client/mod.ts` names each one. A controller that is a registered scope's `setup` body is not exported,
because those scopes are `eager`, `resume()` is their only correct caller, and a second call would double-mount; `src/ui/core/client.ts` registers
them. Being internal without being un-`@public` is what [`NAMESPACE_DESIGN.md`][nd-1c] §1c permits — its gate proves `@public → barrel`, not the
converse. `mountRovingFocus` is public despite backing scopes of its own, because it is a primitive those scopes _call_ rather than a scope's
`setup`.

### 2a. State-Only Islands versus Contract-Bearing Scopes

**`Resumable` is for a state-only island; a contract-bearing scope root is hand-rendered.** That is the rule, not a gap in `Resumable`.

`Resumable`'s props are a closed shape with no rest spread, and the closed shape is the job: the component resumes _state_, stamping `data-scope`
and serialising `state` for the signals to rehydrate from. A wiring contract is a different mechanism — named attributes a controller reads off the
element carrying `data-scope` — and wrapping that element in a `Resumable` moves the attributes off the root the controller reads. A rest spread
would admit arbitrary attributes to a component whose whole value is its closed shape, and would make two mechanisms that do different jobs look
interchangeable.

**Reach for `Resumable` when the server hands the browser values to rehydrate; render the scope root by hand when the server hands it a contract to
act on.** The passkey ceremony is that case — `AuthPasskeyScope` in `src/auth/web/views/passkey-enrol.tsx` stamps `auth`'s `PASSKEY_*` data
([`NAMESPACES.md`][namespaces-5h] §5h).

### 2b. Theme Controller and FOUC Prevention

The theme surface is split across two subpaths, and the split matters. **`@y-core/forge/ui/chrome`** renders on the server: the pre-paint
`FOUC_SCRIPT` and the `ThemeToggle` markup. **`@y-core/forge/ui/chrome/client`** is a **side-effect module** that registers the `theme` and
`navbar` resumable scopes and exports the `isDark` signal.

**`FOUC_SCRIPT` is an inline script for `<head>` that reads storage and sets the dark class before first paint**, so no wrong theme flashes.

**Its hash must be listed in the CSP `script-src`.** Any _other_ server-rendered inline `<script>` must instead carry the per-request nonce from
`getNonce(c)` — see [`SECURITY_HARDENING.md`][sh-2a] §2a.

**A pre-paint inline script is for state the server cannot know, and a second one is not minted for state it can.** Every surface that renders one
state and corrects it on the client is tested against that rule. The theme passes on every count: its value is in `localStorage`, which no server
can read, and the wrong intermediate state is a full-page inversion. The viewport-driven disclosure (§2l) passes on none — its input is a width the
stylesheet already answers, a disclosure default is opt-in where a theme is universal and every inline script is a CSP hash _every_ consumer
carries, and its wrong intermediate state is "navigation visible", the accessible no-JS fallback rather than a defect. **The residual is stated
rather than hidden:** the correction lands when the app's client entry runs, so deferring that entry behind a large bundle widens the window in
which the disclosure shows what the server rendered.

**The theme preference is held per document, not per scope.** A navbar toggle beside a settings toggle is a legitimate composition, and each scope
hydrating its own preference left the other advancing from a stale value. Disposing one toggle therefore leaves the painting running for any other
still live in the same document.

**`isDark` is a stable binding over the live documents, not a slot**, so it can be captured before `resume()` runs and still report the truth
afterwards, and it reads `false` once no document holds a theme scope. A single slot fails both ways — a second document silently takes the export
over, and disposing either leaves `isDark` reading sources that are dead.

**Runtime auth filtering of the bar arrives as an event, not through an exported setter.** The server seeds the same token set at render, so the
first paint is already correct. A channel rather than a forge-held signal, because the emitter — a login, an htmx swap, an app's own router — need
not hold a reference to any forge module. **Where the event is dispatched is its address**: dispatched on `document`, every bar follows it;
dispatched on or inside one bar, only that bar does, whether or not the event bubbles and inside an open shadow root too. `src/ui/README.md` owns
the event's name and payload shape.

**Any script on the page may dispatch it, and that is a ratified fail-open, not a hole** ([`BOUNDARIES.md`][boundaries-5c] §5c). The listeners take
any dispatcher and the payload is unauthenticated, so a forged `navbar:filters` can repaint the bar with any token set. What it cannot do is widen
what the viewer may reach: `filters` decides which of the **already-delivered** items are painted, and the server put every one of those hrefs in
the HTML before the event existed. Reaching a destination is the route guard's decision — `requireSignedIn`, `requireAdmin` — which runs on the
server and never consults the bar. **The degradation is presentational:** the worst outcome is a navigation bar showing links the viewer's own
requests will be refused at, which is the same outcome as a stale first paint.

### 2c. The `turnstile` Scope — CAPTCHA Controller

**The capability arrives with the component, and there is no way to summon it without one.** `<Turnstile>` stamps `data-scope="turnstile"` and
`ui/core/client` registers that scope, so `resume()` mounts a controller exactly where the markup rendered one. `mountTurnstile` is therefore **not
exported from `ui/client`**: a global one in a shared client entry runs on every route, so every page pays for a capability a handful of them want.

**Its argument is the tree it searches, and it is required.** Given the scope root — which _is_ the widget — it matches that node before descending;
given an enclosing element it searches within it, so a page with several widgets mounts one controller each. Searching the whole document instead
resolves every widget to the first one. It finds its `<form>` and site key from the markup, with no selector to configure, and no-ops — reporting —
when either is absent from the tree it was given.

**The server is the only enforcement point, in either mode.** `verifyTurnstile` ([`INPUT_VALIDATION.md`][iv-4a] §4a) fails closed, so nothing the
controller does may brick a form: a slow, blocked or dead widget degrades the page and never gates it.

Its deliberate behaviours:

- **Eager by default, deferrable per widget.** The script loads at mount, so a challenge is solved before the reader reaches submit. `load="focus"`
  defers to the first `focusin` within the form, for a form incidental to its page. **There is no third, app-triggered mode**: `"lazy"` would
  collide with `ui/client`'s `lazy()`, which means an IntersectionObserver. **It never calls `turnstile.ready()`**, which throws under an async
  load.
- **The post-render focus guard is armed unconditionally; the restore acts only on a focus the reader held.** Turnstile steals focus a beat after
  `render` returns, by which time an eagerly rendered page's reader has clicked the first field — so arming on a held focus alone left that page
  undefended, while a restore needs somewhere to restore _to_. A `focusout` from inside the container is ignored, so tabbing between fields is
  unaffected. **The accepted hazard is a click-yank** within `TURNSTILE_FOCUS_GUARD_MS`: from the event, a steal and a deliberate click are the same
  thing, and the steal is far commoner.
- **The injected script carries the page's own CSP nonce**, copied from an already-nonced `<script>` and read off the **property**, because the
  browser empties the `nonce` content attribute after insertion to stop it being exfiltrated through a CSS attribute selector. **A `data-nonce`
  attribute of forge's own is therefore forbidden**, and the value is written with `setAttribute` rather than `script.nonce =`, which sets only the
  internal slot in some engines. So `script-src 'nonce-…' 'strict-dynamic'` works without widening anything to Cloudflare's origin
  ([`SECURITY_HARDENING.md`][sh-3] §3).
- **The container reserves the widget's box only when the widget is always visible.** The reservation is keyed on `appearance`, not `challenge`:
  `always` holds Cloudflare's published dimensions so the eager render stops shifting first paint, while `execute` and `interaction-only` reserve
  nothing rather than leaving a permanent hole. Classes, never a `style` attribute ([`UI_SSR_COMPONENTS.md`][usc-1a] §1a).
- **The token is scoped to the form's own action, and to its own submission.** `action`, `cData` and `responseFieldName` are the widget halves of
  `verifyTurnstile`'s options, and why each pair must be set together is [`INPUT_VALIDATION.md`][iv-4a] §4a's. A value outside
  `TURNSTILE_ACTION_PATTERN` or `TURNSTILE_CDATA_PATTERN` is **reported and still forwarded**, so the server stays the one enforcement point.
  **One predicate decides both htmx seams — the `htmx:config:request` hold and the `htmx:finally:request` reset — by testing the element htmx
  issued the request from**, so a descendant field's own request is neither held nor reset and cannot burn the single-use token. **The test is
  structural because the answered URL cannot bear it**: a redirect leaves `responseURL` naming a URL the form never declared.
- **Self-healing token, with expiry and timeout left to Cloudflare.** The token resets whenever one of the form's own requests ends — a success, an
  error status or a network failure; the form clears only on a 2xx. No `expired-callback` or `timeout-callback` is wired — `refresh-expired` and
  `refresh-timeout` both default to `auto`, so a `reset()` of forge's own was redundant at best and a second challenge at worst.
- **Fails visible, and the message comes back down.** Two message slots, each overridable by prop: the general one (`children`) and an `unsupported`
  sibling for the one cause the general text misleads on — a browser Turnstile cannot run, where "disable your ad blocker" is advice the visitor
  cannot act on. **Those slots, and not one per cause**, because the text is the app's and the controller cannot invent English of its own. `retry`
  defaults to `auto`, so a transient fault the widget then solves takes its own message back down.
- **A theme flip re-renders the widget, but never at the cost of a solved token.** Once a token has been issued the widget keeps the colour it
  rendered in, rather than making the visitor pay for a second challenge to change a colour. It observes the `dark` class deliberately —
  `ui/chrome`'s theme signal would be a cross-namespace dependency ([`NAMESPACE_DESIGN.md`][nd-3] §3).
- **When the challenge runs is a second axis, and `challenge="submit"` is the opt-in.** `load` decides when the script is fetched, `challenge` when
  the challenge runs. The default `"render"` starts the single-use token ageing at mount — right for a short form, wrong for one that outlives the
  token, where a backgrounded tab can miss the auto-refresh and hand siteverify a `timeout-or-duplicate`. `"submit"` runs exactly one challenge at
  the press, from `htmx:config:request`; it is opt-in because render-time is the prevalent configuration. `appearance` stays independent, as
  Cloudflare treats it — pair `challenge="submit"` with `appearance="interaction-only"`.
- **In submit mode the press is deferred, for a bounded window that always ends, and never on a widget that cannot answer.** The submitter is marked
  `disabled` and `aria-busy` for the window, since htmx's own indicators start only once the request is issued. **The hold is conditional on widget
  health**: a render that threw, a pre-press `error-callback` or a script that never loaded lets the press through unheld for `verifyTurnstile` to
  refuse, rather than sitting disabled for `TURNSTILE_EXECUTE_TIMEOUT_MS`. **An interactive challenge swaps the budget rather than standing it
  down** — the busy state drops while the reader is asked to click, and the window becomes `TURNSTILE_INTERACTIVE_TIMEOUT_MS`, well inside the
  token's life. **On failure the held request is dropped rather than issued**: a tokenless POST answers with a refusal naming the schema's first
  field, which reads as a validation error the reader cannot act on. The fallback is revealed and a second press retries.
- **The press is held at `htmx:config:request` and replayed when the token arrives.** The controller cancels htmx's request and records the control
  pressed; on the token it dispatches the press again — a `submit` carrying that control as its submitter for a form, a `click` for a control — and
  the replayed press goes through because the token input is now filled. **Holding inside htmx's request instead would fail on each count**: htmx
  has collected the body before any hook runs, so the token would have to be patched into it; htmx's own request timeout would race the interactive
  window; and htmx's per-element request queue would break last press wins.
- **An invalid form spends no challenge wherever htmx halts it, and forge runs no validity check of its own.** htmx validates a form before
  `htmx:config:request` fires, so a press it halts never reaches the hold. **On a `novalidate` form, a button-issued submission, or a press whose
  control carries `formnovalidate`, an invalid press therefore spends a challenge** — htmx sends the request either way.
- **A form whose own `hx-trigger` names some other event is not supported in submit mode.** Its press is held like any other, but the replay issues
  only a `submit` or a `click`, which that form does not listen for — so the press is never sent. The replay is deliberately not generalised to an
  arbitrary trigger.
- **Last press wins, because each replay carries its own submitter, and every dropped press is reported.** A second press displaces the first and
  re-arms the window but rides the challenge in flight, so one press stays one challenge, and the replay carries the second press's control alone —
  answering with the first would send one button's `name=value` under the other's press. Every hold that ends without a request dispatches
  `TURNSTILE_ABANDONED_EVENT` on the **form**, bubbling and not cancelable, its detail a `TurnstileAbandonedDetail`; the submitter is un-busied
  before dispatch so a handler that focuses it finds a live target. It deliberately carries no way to release the held press: reviving it is the
  tokenless POST the drop exists to prevent. Teardown is the one silent exception, since it runs mid-swap into a page already going away.
- **Submit mode needs an htmx submission, and refuses without one.** A form with no htmx verb fires no `htmx:config:request` and has no request to
  hold, so the controller reports the authoring error and falls back to `challenge="render"` — a degraded form, never a dead submit button.

### 2d. The Disposer Contract

**Every controller returns a disposer that removes everything it installed, and a scope's `setup` returns it.** `resume()` returns a teardown that
runs every disposer collected during that resume, so the two halves fit without either side knowing about the other.

**It is a contract, not a convenience.** A controller that cannot be disposed leaks a listener — and often a `MutationObserver` and a pending timer
— on every re-resume, and a page re-resuming after each htmx swap accumulates one set per swap. Nothing warns; the page simply gets slower and
starts handling the same keystroke several times.

**The runtime owns the effects a `setup` creates; the author owns everything else.** Every `effect` created while a scope's `setup` runs is
collected and disposed with the scope. What a `setup` _returns_ is for what the runtime cannot see: listeners, observers, timers, controller
handles. It runs **after** the scope's effects are disposed, so no reactive computation is alive while an author's teardown mutates the DOM those
effects write to.

**Ownership is the window in which `setup` runs, and nothing wider.** An effect created in an `on` handler, or in a `.then()` resolving after
`setup` returned, is owned by nothing and must be disposed by whoever created it — per-invocation ownership would be wrong more often than right,
since an effect an action installs is normally meant to outlive that action.

These consequences follow, each the rule rather than a special case:

- **A `setup` that returns nothing is legal**, and is not treated as a disposer.
- **A disposer must be idempotent-safe to call after its element is gone.** Removing a listener from a detached node is a no-op, which is why
  teardown never needs to check.
- **A `setup` that throws disposes the effects it created and leaves its root resumable.** A root marked resumed with no disposer would be
  unreachable by every teardown and inert on re-resume, which is a worse failure than the throw.
- **A throwing disposer is reported and does not stop the rest of teardown.** Teardown iterates every live scope, so one failure must not silently
  skip the scopes queued behind it.

### 2i. `openPopoverAt` — Coordinate Placement

**Every other popup in forge is placed by CSS, against its trigger.** An _invoker-opened_ popup's **implicit anchor** is its invoker, which
`position-anchor`'s initial `auto` resolves to; `src/ui/core/menu-anchor.browser.ts` pins the boundary this section depends on: a popup shown by
`showPopover()` has no implicit anchor at all. A **context menu has no trigger**, so nothing carries the anchor name, every anchored rule resolves
to nothing, and the UA's `[popover]` default centres the panel — the one place a context menu must never be.

`openPopoverAt` shows the popup with its top-left corner on the point, clamped so the whole box stays on screen. These properties are load-bearing:

- **The coordinates go through CSSOM** (`el.style.setProperty`), never a generated `style` attribute — for the CSP-and-dropped-`style` pair owned by
  [`UI_SSR_COMPONENTS.md`][usc-1a] §1a.
- **The placement is cleared when the popup closes**, because a CSSOM write still leaves a `style` attribute. htmx 4's settle copies an old id'd
  element's attributes onto its same-id replacement with `setAttribute`, which forge's CSP blocks: `style-src-attr` falls back to a `style-src`
  with no `'unsafe-inline'`. Only the anchor properties are removed, and the attribute only once empty, so a caller's own inline styles survive.
- **The matching CSS rule must reset `inset` and `margin` explicitly.** Without that the UA default survives, the panel centres itself, and the
  custom properties hold perfectly correct values while nothing moves. That failure looks like a bug in the TypeScript and is not.
- **Clamping needs the box, not the point**, so the coordinates are written twice: once before the popup is shown, while it still measures zero, and
  once after. Both in one task, so the browser paints the corrected position rather than the provisional one.
- **A menu opened from `contextmenu` must be held back until the button is released**, or the platform light-dismisses it on the very `pointerup`
  that ended the right-click: `contextmenu` fires _between_ `pointerdown` and `pointerup`, and the dismiss pass on that release finds neither target
  inside a popup. `afterPointerUp` defers the show to a **capture-phase** `pointerup` on the owner document, ahead of the dismiss pass's own
  listeners and before any paint. Callers pass `event.buttons !== 0`, never a flat `true`: a keyboard-raised `contextmenu` (Menu key, `Shift+F10`)
  reports no buttons and is followed by no release, so an unconditional guard arms a listener the _next_ unrelated click fires.

The popup opts in with `Menu.Popup`'s `coords` prop, which stamps `data-coords` and selects the coordinate rule; `openPopoverAt` stamps it too, so a
popup that opens both ways needs no second markup variant. Calling it again **repositions** an open popup.

**It returns a disposer, because the deferred path arms a listener.** A second call on the same element cancels the first's pending show, which
would otherwise land at stale coordinates on the next release, and a show deferred past an htmx swap that removed the element never happens. A
popup open when its region swaps keeps its placement into the settle, so the caller closes it first.

### 2j. `mountCarouselDots` — Strip-Driven Dot Marker

**`Carousel` is a scroll-snap strip with no script, so the server's `current` dot is a guess that stops being true the moment the reader scrolls.**
A dot is a fragment link: pressing it moves the strip, but nothing in the platform moves the highlight with it. This controller closes that gap and
nothing else — the scrolling stays the platform's.

**It observes the slides against the _strip_ as the observer root, not the viewport**, because against the viewport every slide of a visible strip
intersects at once.

**It lifts both class spellings off the server-rendered row rather than restating them.** Unlike `mountScrollSpy`'s nav, a dot's selected look is
baked into utility classes by `Pagination.Item`'s variants, so there is no attribute for a stylesheet to select on. Reading the `on` and `off`
spellings off the rendered dots keeps the theme, the size and any caller class in the component alone, never in the controller.

**It keeps the last marking while nothing is visible**, where §2k blanks the row. Mid-flick every slide can fall below the first threshold, and a
highlight that blinks off on every scroll is worse than one that is briefly stale; a strip, unlike a page, always has a current slide.

**There is no autoplay, and adding one would need a ruling first.** An unrequested timed advance moves content out from under a reader, which
[`09-interaction.md`][interaction] does not budget for.

### 2k. `mountScrollSpy` — Fragment Nav Current Marker

**A fragment nav has no navigation to hang a current marker off.** An on-page table of contents does not change the URL as the reader scrolls, so
nothing server-side can say which entry is current — the gap between forge's rule that the current destination is always indicated and a page whose
destinations are all one document.

**Entries are ordered by the _targets'_ document position, never by link order.** "Which section is being read" is a question about the page, and a
nav may list its links in whatever order reads best.

**The offset line is read off the page unless the caller passes a `rootMargin`.** It comes from the root element's `scroll-padding-top` and the
spied targets' `scroll-margin-top` — the offset a fragment jump already lands at, so the section the jump lands is the one marked. It is read once,
at mount.

**It emits `aria-current` and nothing else, with the value `location` rather than `page`.** The visible cue is selected from the attribute directly
by the stylesheet, so there is no parallel `data-*` state to keep in step, and `page` would announce a navigation that never happened. **The marker
is rewritten from the whole visible set on every callback**, rather than moved from the previous holder — so at most one link carries it, and none
does while nothing intersects.

**It fails quiet in every direction, and that is safe here specifically**: no links, no resolvable target, or a realm without `IntersectionObserver`
yields a no-op disposer, and the links are real anchors that navigate on their own. The disposer clears the attribute as well as disconnecting,
since a marker outliving its observer would show two current sections until the re-mount's first callback.

### 2l. `mountViewportCollapse` — Width-Driven Disclosure

**A `<details>` cannot make its own `open` state depend on viewport width** — no CSS writes that property — so the only question is which state the
server renders and which side JavaScript corrects. **The server renders open**: with scripting unavailable the navigation is visible, which is the
accessible answer, so the controller only ever removes something. §2b states why that does not earn a pre-paint script the way the theme does. The
controller drives the property both ways while in control.

**The collapse it makes at mount lands rather than plays.** Every CSS transition that write starts under the disclosure is finished at once.
Correcting the server's state is not a change the reader caused (`rule:forge-ui-density-motion-budget`), and a drawer's backdrop fading out over
the first frames of the page takes the reader's first tap. A later collapse across the breakpoint animates as usual.

**It stops driving the disclosure the moment the user does, for the lifetime of the mount.** A rail that slams shut every time a phone rotates is
worse than no controller at all. The decision is per mount and **deliberately not persisted** — a persisted override would outlive the situation
that produced it. **The override is tracked by a counter of the controller's own writes, not by comparing state**: every programmatic write fires
exactly one `toggle`, in order, whereas a comparison reads the user toggling _back_ to the controller's last value as the controller's own echo.

**The disposer restores the state it found — unless the user has taken over.** Once they have, what is on screen is theirs, and restoring the
server's state at teardown would be a second override at the worst possible moment.

It fails quiet when the element is absent, is not a disclosure, or the realm has no `matchMedia`, and the element is duck-typed on its `open`
property rather than through `instanceof`, for the cross-realm reason `src/ui/README.md`'s controller primitives give.

### 2m. `announce` — The Page's One Voice

**Every announcement goes through `announce()`, into the two regions `<Announcer />` renders** ([`UI_SSR_COMPONENTS.md`][usc-1o] §1o). Separate
live regions interleave their speech with no order between them, which is why forge's own visual components hand their text over rather than
speaking for themselves.

**A channel is a stream in which only the latest message matters.** A message waits `ANNOUNCE_SETTLE_MS` before it is spoken, and a later message
on the same channel replaces it, so a burst of status text is heard once, as its final state. **An identical consecutive message on a channel is
skipped unless `repeat` is set** — set it where a second identical message is a new event, as a second failed submission is. **Empty text cancels
the channel's pending message and forgets its last one**, so a prompt cancelled with Esc and raised again is spoken again.

**Each message is appended to its region as a node of its own, and removed after `ANNOUNCE_LINGER_MS`.** Two channels settling together both reach
the screen reader rather than the second overwriting the first before it is read, and a repeat is a new node rather than a rewrite of the old one.
The regions are not `aria-atomic`, so an addition is read alone and a message still lingering is never spoken twice. Removing it keeps spent text
out of a browse-mode reader's path.

**An app message uses a channel of its own, never one forge speaks on.** Sharing one would let the app's `announce()` cancel or replace forge's
message. `ui`'s channels are the `ANNOUNCE_*_CHANNEL` constants in `src/ui/contracts/announcer-contract.ts`; the passkey ceremony in
`auth/client` speaks on one of its own. **The toast channel is the one that never
drops a message**: a later toast joins the pending ones instead of replacing them, so two toasts from separate swaps inside one settle are both
spoken.

**The busy channel exists for its cancel.** The htmx entry sends it empty text when a request ends, so a request answered inside the settle is
never announced: the reader hears the spinner's label only for a wait long enough to notice. **The cancel rides `htmx:after:request` and
`htmx:error`, never `htmx:finally:request`.** htmx fires `htmx:after:request` when the response arrives and before it swaps, and `htmx:error`
covers a network failure, which never reaches `htmx:after:request`. `htmx:finally:request` fires only after the swap, so a cancel there would
silence the spinner the swapped content had just queued.

**Without an `<Announcer />` the call is a no-op that warns once per document.** A missing announcer is one layout mistake, and a warning per call
would bury every other one. **The state is per document**, so a frame's announcer is its own, and `within` takes any node in the document to speak
in.

---

## 3. Signals and Lazy Loading

### 3a. Signals — Reactive State

`createSignal`, `computed` and `effect` are the whole seam. **Use signals for lightweight client state that does not justify an HTMX round trip** —
state that must survive navigation or be authoritative belongs on the server.

**The engine is deliberately in-house, and those names are the migration boundary.** A seam this small sits below the cost of a facade over a
third-party graph; swapping the implementation behind them is the whole migration if that ever inverts.

**By the time a write returns, every dependent has observed the settled value.** The flush is synchronous rather than deferred to a microtask,
because a scope action writes a signal and the painted DOM has to be there before the handler returns.

**A `computed` is lazy and pull-based**, so a read answers from its sources' _current_ values and nothing can observe a derived value assembled
before one of its sources moved — the torn read an eager, push-based derivation produces. An effect whose sources moved under an unchanged value is
dropped without running. **There is deliberately no dirty flag**: an "already dirty, so stop propagating" short-circuit cannot coexist with the
throw-clears-the-queue rule below, because a flush abandoned by a thrower would leave the computed marked dirty and wedge its queued reader for
good.

**An effect runs exactly once per settled state, and that is a guarantee.** It rests on one rule: **writing a signal during an `effect` or
`computed` run throws.** With no writes in effects there is no effect-to-effect edge, so a double run cannot be constructed at all. Ordering is not
an alternative route to the same guarantee: the edge that causes a double run is the _write_, which the read graph cannot see and which is not
knowable until it happens.

**Effects paint; commands belong in the handler that caused them.** The island model already separates the roles (§3c): `on` handlers command,
`computed` derives, `effect` paints. The replacements need no new API — `computed` for derivation, an `on` handler for a command, and
`queueMicrotask` for a genuinely deferred one, which runs with no active node and so writes after the flush has settled.

**A throwing effect clears the queue.** The throw reaches whoever performed the write, and the effects queued behind the thrower are skipped until
the next write — carrying them forward would run them on an unrelated caller's stack. **A cycle throws past a per-node run cap**, a backstop rather
than the first line: an effect that writes the signal it reads is refused by the write rule before the cap could count.

### 3b. Lazy Loading

`lazy` defers a dynamic import until the element carrying its `data-ref` **intersects the viewport** — an IntersectionObserver, not an idle
callback.

**A missing anchor and a missing IntersectionObserver both report.** Either leaves the module never loaded, which is indistinguishable from never
having been scheduled unless it is said out loud.

**A failed import retries; it does not die silently.** The rejection goes to `onError` — or, with no handler, to `console.error`, because an error
with nowhere to go is the one outcome this module refuses. The element is re-observed after a fixed delay, and **both bounds are load-bearing**: the
cap exists because `observe()` invokes its callback _immediately_ for an element already on screen, so an uncapped re-observe on a visible element
is a spin loop; the delay is what makes the retry a retry. Re-observing rather than calling `load()` again keeps an element scrolled out of view
waiting for re-entry instead of loading off-screen. A throw from `init` is reported the same way and stops there, since the load succeeded. The
disposer clears a pending retry, so a load still in flight when a scope tears down neither re-observes nor runs `init`.

### 3c. Resumable Scopes

**Register every scope before calling `resume()`**, the side-effect import that registers forge's own scopes included
([`UI_SSR_COMPONENTS.md`][usc-2d] §2d).

**A component whose markup names a scope must guarantee the scope exists.** A side-effect module registering scopes for markup a _sibling_ renders
imports the module those scopes live in, rather than leaving the app to discover the dependency from a warning. `ui/chrome/client` imports
`ui/core/client` for exactly this reason: chrome markup names scopes `ui/core/client` registers.

**A scope is lazy by default and resumes on the first delegated interaction inside it; an `eager` scope runs its `setup` at `resume()`.** Choose
`eager` whenever the markup carries no `data-on-*` action of its own, because a lazy scope then has nothing that could ever resume it — a
correctness requirement rather than a performance preference.

**Scope discovery descends into open shadow roots.** A selector cannot cross a shadow boundary, so an eager scope rendered inside a web component
would otherwise never be visited, its `setup` would never run, and nothing would warn. `resume(within)` accepts a `ShadowRoot`, so a web component
can resume only its own subtree.

**Installing the listeners and resuming a tree are two jobs, and `resume` keeps them apart.** The delegation is installed once per **document**; the
eager pass runs on **every** call, over the root it was given, so `resume()` followed by `resume(shadowRoot)` still visits the shadow subtree. Each
call's disposer owns only the scopes that call resumed, and the release that removes the listeners first disposes every scope still active in the
document — a lazily-resumed scope belongs to no call's set and would otherwise outlive its only route to teardown.

**One scope's `setup` cannot take the page down.** A throw from an eager `setup` is reported against the scope's name and the loop continues, so
later scopes still resume and a subsequent `resume()` re-attempts the one that threw. `hydrateState` therefore _throws_ on malformed `data-state`
rather than degrading to `{}` — that markup is server-authored and deterministic per render, and a silent `{}` produced a scope whose every signal
was missing.

**A removal is not a resume, so the htmx entry sweeps after every swap.** Detached scopes are otherwise swept only as something else resumes, so a
swap that removes scoped markup and introduces none never reaches the sweep — and a retained scope keeps its document-level listeners alive. That
is a leak rather than untidiness, so `ui/client/htmx` disposes every scope whose root has left its document on `htmx:finally:swap`. **It is a sweep
rather than a per-element hook** because htmx's `htmx:before:cleanup` fires only for elements that carry htmx attributes, and a plain `data-scope`
subtree inside a swapped container carries none.

**`disposeScopesIn` is for an app's own removals.** It disposes the scope at an element and every scope below it before the app detaches them — a
removal htmx did not make raises no swap event, so nothing else would dispose those scopes until the next resume.

**The delegated event vocabulary is `click`, `input`, `change`, `submit`. There is no `keydown`, by decision.** Composite controllers own `keydown`
at their **own widget root**, where arrow keys and typeahead belong: a page-level keydown delegation would have to decide, for every keystroke,
which of several live widgets it was meant for — a question the widget's own root answers by construction. The vocabulary is declared once and
shared by the runtime's listeners and the server's emitted `data-on-*` attributes, so adding an event changes every attribute the server writes.

**One further delegated listener bridges native Invoker Commands, and it is not another entry in that vocabulary.** It routes **only custom
commands** — those whose name begins with `--` — and leaves the platform's built-ins entirely to the platform, which is what the markup-only menu of
[`UI_SSR_COMPONENTS.md`][usc-1h] §1h depends on. The invoker enters the same handler table a `data-on-*` action does, so the server writes no new
attribute. **That listener must be capture-phase**, and that is the platform's constraint rather than a preference: `command` is dispatched with
`bubbles: false`, so a bubble-phase delegated listener never sees it and every custom invoker action goes dead — silently, because the invoker
still fires and the platform still ignores a command it does not know.

**An inert element runs no action, and the runtime stops the platform acting on an `aria-disabled` one too.** Neither route runs an action on a
`disabled` or `aria-disabled="true"` element. `aria-disabled` is only advisory to the platform, which still submits, navigates, fires `command` and
toggles `popovertarget` on a click, so `resume` also cancels, in the capture phase, any click inside an `aria-disabled="true"` element before a
listener or a default acts on it. Enter and Space on such an element arrive as that same click.

---

## 4. htmx Bundle Import

**`@y-core/forge/ui/client/htmx` is imported for its side effect only, from the client entry.** It loads htmx, registers the `forge-htmx`
extension, decides which responses swap (§4a), removes htmx's own indicator stylesheet, and wires resumable scopes and the announcer to htmx's
events on `document` (§4b).

**The `forge-htmx` extension is how htmx meets Trusted Types.** It hands htmx a named pass-through policy for the HTML and script sinks htmx writes
to, so a CSP that requires Trusted Types can name it, and it refuses a request whose URL is `js:` or `javascript:`, which htmx would otherwise
evaluate ([`HTMX.md`][htmx-7a] §7a). The CSP recipe, why a pass-through policy is acceptable, the fail-closed path and what enforcement forbids in
markup are [`SECURITY_HARDENING.md`][sh-2g] §2g's.

**htmx's indicator stylesheet is removed because it would outrank forge's.** htmx adopts an unlayered constructed stylesheet for its indicator class
when it is imported, before any later code can set its config, so the entry filters that sheet out of `document.adoptedStyleSheets` instead. An
unlayered rule beats every `@layer` rule, so it would override `forge-ui.css`'s layered indicator rules and any caller class on the element; those
rules replace it, and also hide an indicator on a page whose script never ran.

**The module is listed in `package.json` `sideEffects`, which is what stops a bundler tree-shaking it away.** That file owns the list — never
restate which modules are side-effectful. **Never import htmx from a CDN URL**: this entry point is what pins the version to the forge package.

### 4a. Which Responses Swap: HTML 4xx Yes, 5xx No

**A 4xx `text/html` response swaps into its target, and no other failure does.** A 5xx never swaps, and a 4xx of any other type swaps nothing and
has its text spoken on the `failure` channel (§2m).

**An HTML 4xx swaps because forge answers a refused submission with a fragment written for the target**: `defineAction`'s 422 of validation errors,
and the `auth` actions' form re-rendered at 422 with a `FieldError`. Suppressing it would leave the reader no word of what was wrong.

**Any other failure does not swap because it is not markup written for the target.** forge's CSRF and cross-origin refusals, its 404 and its 429
answer in plain text, and its 5xx bodies are a full error page or plain text; swapped in, either would replace the form or card it answers.

**An element's `hx-status:` attribute overrides the content-type rule**, because htmx reads it after `htmx:after:request`: `hx-status:403` swaps a
403 whatever its type. A handler that answers a swap request with an HTML 4xx owns the body it sends.

### 4b. Why the Entry Listens on `document`

**Every listener the entry installs is on `document`, never on `document.body`, because htmx dispatches an event on `document` once the element
it concerns has left the page.** A control that swaps itself away — `hx-target="this"` with `hx-swap="outerHTML"` — is detached by the time
the swap ends, so its `htmx:finally:swap`, and an `htmx:error` raised after the swap, are dispatched on `document` itself and never pass through
`<body>`. A body listener would miss the disposal of detached scopes (§3c), and a failure's cancel of the busy channel (§2m). An event from an
element still in the page bubbles to `document`, so one listener there hears both.

---

## 5. Never Use `ui/client` in an SSR Context

See [`BOUNDARIES.md`][boundaries-1] §1 for the SSR-versus-browser boundary and why it is kept by import path rather than a runtime check, and
[`BOUNDARIES.md`][boundaries-1a] §1a and §1b for the tier table and for splitting a component across the boundary. Each forge subpath a tier covers
is described by its namespace's README ([`NAMESPACES.md`][namespaces-3a] §3a).

[boundaries-1]: ../warden/canon/libs/BOUNDARIES.md#1-ssr-versus-browser--the-hard-runtime-boundary
[boundaries-1a]: ../warden/canon/libs/BOUNDARIES.md#1a-what-may-be-imported-where
[boundaries-5c]: ../warden/canon/libs/BOUNDARIES.md#5c-recording-a-fail-open-exception
[htmx-7a]: ./HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[interaction]: ../src/ui/design/reference/09-interaction.md
[iv-4a]: ./INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[namespaces-3a]: ./NAMESPACES.md#3a-a-namespace-is-described-by-its-own-readme
[namespaces-5h]: ./NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[nd-1c]: ../warden/canon/libs/NAMESPACE_DESIGN.md#1c-what-the-export-gate-proves
[nd-3]: ../warden/canon/libs/NAMESPACE_DESIGN.md#3-namespace-classification
[sh-2a]: ./SECURITY_HARDENING.md#2a-createsecurityheaders-factory-pattern
[sh-2g]: ./SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[sh-3]: ./SECURITY_HARDENING.md#3-cors-and-origin-protection
[usc]: ./UI_SSR_COMPONENTS.md
[usc-1a]: ./UI_SSR_COMPONENTS.md#1a-dropped-and-unsanitized-pass-through-attributes
[usc-1h]: ./UI_SSR_COMPONENTS.md#1h-overlays-and-disclosures
[usc-1o]: ./UI_SSR_COMPONENTS.md#1o-announcer--the-one-live-region
[usc-2d]: ./UI_SSR_COMPONENTS.md#2d-scoped-components-require-the-client-scope-import
