---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the binding seam, the class utilities, and the colour-scheme and CSS-layering contracts."
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound
> variants, the server-side half of the signal-binding seam, the `cn` / `asClass` / `cva`
> class utilities, and the contract a colour scheme file is declared against.
>
> Defers to: [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for everything that runs in the
> browser and for the hard SSR/client boundary; `src/ui/README.md` for the component gallery,
> props, and worked usage; [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d for automatic
> URL sanitization; [`NAMESPACES.md`](./NAMESPACES.md) §5b for the one-import rule
> that governs the `ui/core` / `ui/controls` name collision.
>
> Components produce a forge element tree that `renderToString` (`@y-core/forge/jsx`) serializes
> to `SafeHtml`. The JSX runtime is forge's own — set
> `/** @jsxImportSource @y-core/forge/jsx */` at the top of each `.tsx` file.

---

## 0. Quick Reference

- §1 ui/core Component Contract: the rules every SSR component obeys
- §1a Dropped and Unsanitized Pass-Through Attributes: why `style` never arrives, and the one family left unsanitized
- §1c Button and the asChild Invariant: the ratified throw, and the `data-slot` token list
- §1e Switch and Slider — CSS-Only Controls: the `peer-*` trap, the sanitized readout, the declined formatter seam
- §1f Turnstile — Server-Rendered Mount Point: deliberate omission of auto-render
- §1g Composite Widgets: the markers that make many focusable items one tab stop
- §1h Overlays and Disclosures: native popover and `<details>`; how a popup's side resolves against the reader's direction
- §1i Native-Input Primitive Decisions: an axis that is not an orientation, and a scroll area that hijacks nothing
- §1j Derived Ids Must Be Id Tokens: why a whitespace-bearing `name` or `scope` derives no wiring, and why suppressing won
- §1k One Consumption Path, Not Two: JSX as the terminal surface, the `data-scope` route, the rejected Custom Element mirror
- §1l Chrome Navigation Announces Only What It Implements: the not-a-menubar and not-a-rail-stop rulings
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a The Binding Ownership Boundary: what forge owns in both directions, and what the app supplies
- §2c ui/controls — Bound Variants: the static barrel, the bespoke case, and the deliberate name collision
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition
- §3 Class Utilities: ratified public composition helpers
- §3d Conflict Resolution and the Fail-Open Boundary: what the resolver decides, where it stops, and the ratified inversion
- §4 State Attribute Contract: one declaration two tiers must agree on
- §4a Presence, Not Value: why `data-selected` and never `data-selected="true"`
- §4b ARIA States Are Not Styling Hooks: why both are emitted
- §4c The Caller Is Authoritative: class precedence and state precedence as one rule
- §5 Colour Scheme Declaration Contract: one declaration site per step, and what selects between the modes
- §5a OKLCh Solids: why a scheme's steps are written in the space the ramps are authored in
- §5b The Rejected Wide-Gamut Branch: why a second set of values would outrun the contrast audit
- §5c Status Hues Are Forge's: which colour roles an app may re-point, and which carry meaning
- §5d The dark: Variant Is Class-Driven: the takeover a consumer stylesheet inherits
- §5e A Consumer Rule Loses by Layer: why the remedy is a layer and never specificity

---

## 1. ui/core Component Contract

### 1a. Dropped and Unsanitized Pass-Through Attributes

**`style` is dropped deliberately** — forge's CSP carries no `style-src 'unsafe-inline'`, so an
inline style attribute could never take effect. Use `class` and the theme tokens.

The renderer HTML-escapes forwarded values and routes URL-bearing attributes through `safeUrl`, so
a `javascript:`-style value collapses to `"#"`. **This is automatic; components never call it.** See
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d.

htmx selector and JSON attributes are **not** sanitized — [`HTMX.md`](./HTMX.md) §7 owns that
trust obligation.

### 1c. Button and the `asChild` Invariant

**`asChild` requires exactly one JSX element child.** A string, number, fragment, array, or
empty child is a programming error and **`Button` throws rather than degrading** — a ratified
invariant, consistent with [`ERROR_HANDLING.md`](../governance/ERROR_HANDLING.md) §5a.

**`data-slot` is a token list, and `asChild` appends to it rather than replacing it.** Composing two
compounds produces one element that genuinely is both: `<Tooltip.Trigger asChild><Menu.Trigger/>
</Tooltip.Trigger>` renders a single button carrying `data-slot="menu-trigger tooltip-trigger"`.
Overwriting silently unmade the inner compound — every rule and query keyed on the child's own slot
stopped matching, and the tooltip lost the `anchor-name` that positions its content box.

**Every forge selector on `data-slot` therefore uses `~=`, not `=`.** The two have identical
specificity (0,1,0), so nothing about the cascade shifts; `=` is simply wrong on a composed element.
A consumer keying on `[data-slot="…"]` exactly must make the same change to keep matching one.

**`anchor-name` does not union across rules.** Two rules each naming the same composed element leave
the cascade to pick one, so `forge-ui.css` declares the one named pair forge has — `--forge-tooltip`,
held inside an `anchor-scope` on the tooltip root — on the trigger slot alone. The set is
closed because `Tooltip.Trigger` is the only one of the four trigger compounds that offers `asChild`,
which makes it always the outer wrapper.

**The merge is not specific to `asChild` — every compound merges on plain render too.** A `ui/core`
or `ui/chrome` compound destructures an inherited `"data-slot"` out of its props and writes
`data-slot={slotToken("own-token", inherited)}`, own token first. A bare literal instead loses the
compound's own token to any caller that passes `data-slot`, because the rest-props spread that
follows it wins. `slotToken` is owned by `src/ui/core/utils/as-child.ts`.

**The attribute order is gate-enforced, not conventional.** `src/pkg/gate/checks/jsx.ts` — matchers
in `src/pkg/gate/checks/jsx-parse.ts` — fails on any JSX element carrying a literal `data-slot` before a spread of
a **bare identifier** (`{...rest}`, `{...props}`, `{...attrs}`). A computed spread such as
`{...stateAttrs({ selected })}` is deliberately outside the rule: it is built at the call site out of
values the component itself controls, so no caller token can hide inside it. There is no per-site
suppression, matching `exports.ts` and `docs.ts`.

**The destructure preserves attribute position, which is why it is the recipe.** The JSX transform
merges duplicate keys in source order — a later spread overwrites the *value* but keeps the *first*
insertion position — so a literal rewritten in place serializes byte-identically. A spread-last
props helper would achieve the same merge while moving `data-slot` after `class` in every rendered
string, for no behavioural gain.

### 1e. Switch and Slider — CSS-Only Controls

**The track and the thumb need different selectors, and this is easy to get wrong.** `peer-*`
compiles to a **general-sibling** combinator (`:is(:where(.peer):checked ~ *)`), so it reaches only
elements that are siblings of the input. The track is such a sibling and uses `peer-checked:`
directly. The **thumb is a child of the track**, so a `peer-` utility on it matches nothing at all —
silently, with no build error and no visual hint beyond the state never moving. The thumb therefore
keys off a `data-slot`-anchored descendant selector instead. **A decorative element nested inside
another cannot use `peer-*`.**

**`Slider`'s `output` prop carries the *sanitized* value rather than the raw `value` prop** — the
string HTML's value-sanitization algorithm for `input[type=range]` settles on, which is what
positions the thumb; a readout taken from the prop can disagree with the thumb permanently, and
`Slider` ships no client controller to reconcile them. The algorithm is module-local to
`slider.tsx` and takes the serialized attribute string rather than the prop, so it parses
byte-for-byte what the browser parses. **Mirroring that readout on input is a consumer concern** —
forge stays markup-only (§1a). This is §1h's "a server may only stamp what it can keep true"
resolving *toward* stamping: the sanitized value is a total function of attributes forge emits in
the same breath.

**`output` stays a boolean, and the unformatted readout is a decision rather than a gap** — no
formatting hook, no locale, no unit; a consumer wanting `"50%"` composes their own `<output>`.
**`Meter` is the precedent and the argument**: `Meter.Value`'s text is caller-supplied children, so
presenting a number is already composition rather than configuration, and a formatter prop here
would make the two disagree about who owns it. **Any future formatter seam receives the *sanitized*
string, never the raw prop.**

### 1f. Turnstile — Server-Rendered Mount Point

**`Turnstile` deliberately omits Cloudflare's `cf-turnstile` auto-render class** — the client
controller owns rendering, so the widget lifecycle is deterministic rather than implicit.
**`siteKey` is injected server-side from the Worker env, never hardcoded**, and the markup is inert
without the client controller ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2c).

### 1g. Composite Widgets

A **composite** is a widget made of many focusable items that behaves as **one tab stop**.
`Toolbar`, `Menu`, `Tabs` and `ToggleGroup` are the four, and they share one controller
(`mountRovingFocus`, documented in [`src/ui/README.md`](../../src/ui/README.md)). **The markup declares which elements are
items; the controller never guesses.** How it declares them differs by widget, deliberately.

**`Toolbar` uses an explicit `data-toolbar-item` marker rather than a `data-slot` prefix**, because
`Toolbar.Group` and `Toolbar.Separator` are slots that must *not* be focus stops and a prefix
selector cannot express the exception. The marker is public, so any foreign element inside a toolbar
opts in by carrying it.

**`Menu` identifies items by ARIA role rather than by a forge-specific attribute**, which is
load-bearing for a menu whose rows are built in the browser: a runtime-constructed row is navigable
the moment it is a correctly-roled menu item, with nothing forge-specific to remember to stamp.
`Menu.LinkItem` is a roled `<a>` for rows that navigate, keeping middle-click, open-in-new-tab and
no-JavaScript navigation that a `<button>` drops; `Menu.SubmenuTrigger` is the roled trigger a
nested popup needs, since a bare `Menu.Trigger` carries no role and the parent's arrow navigation
would skip it.

**`ToggleGroup` announces what it actually is.** It emits no `role` at all, because `<fieldset>`
already has an implicit `group`; a hardcoded `role="toolbar"` would announce a segmented control as
a toolbar and offer the wrong interaction model. Its `type` prop
(`"single" | "multiple"`) is published as `data-multiple`, present exactly when several items may be
pressed at once, and that is what the client reads to decide whether a click replaces the pressed
item or adds to it (§2a).

An unselected `Tabs.Panel` is `hidden`, which is the platform's own mechanism: the initial render is
correct with no JavaScript, and the controller flips the same attribute.

### 1h. Overlays and Disclosures

**Nothing here re-creates a platform overlay in JavaScript.** `Menu` and `Tooltip` are built on the
native Popover API, `Dialog` on native `<dialog>`, and `Collapsible` on native `<details>`, so the
top layer, light-dismiss, Escape, exclusive-open and the disclosure toggle are all the platform's
and cost nothing.

- **`Menu`** — opening, closing and dismissing involve **no JavaScript at all**, being
  `command="toggle-popover"` / `command="hide-popover"` against a `popover="auto"` popup; the client
  adds only what ARIA's menu pattern asks for and the platform does not supply (§1g).
- **`Collapsible`** — **`<details>` owns open and closed**, and nothing mirrors them: style the native `[open]`.
- **`Tooltip`** — a `popover="manual"` surface, shown and hidden by its controller. `auto` would put
  it in the platform's exclusive-open stack, so opening a tooltip would close an open menu beneath
  it; `manual` keeps it out of that stack entirely.
- **`Accordion`** — not a composite: each item is its own disclosure and tab stop, as a native `<details>` list is.

**An overlay whose behaviour is wholly the platform's stamps no scope.** `Dialog`, `Popover`,
`Accordion` and `Collapsible` ship neither scope nor controller. `Menu` and `Tooltip` stamp one
because they add a keyboard layer, and it is eager by necessity rather than taste
([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c).

**A server may only stamp what it can keep true.** `Popover.Content` emits `side` and `align`,
decided at render and fixed for the element's life, and emits no open-state attribute of its own:
that would assert a fact the platform owns and the component cannot follow. Open state is read from
the element itself — `:popover-open` on a popover, `[open]` on a `<dialog>` or `<details>` — which
is the one source that cannot drift. `Dialog` and `Accordion.Item` do forward an initial `open`,
because `<dialog open>` and `<details open>` are attributes the server genuinely sets and the
platform maintains from there.

**A side is stamped at SSR, where the Worker cannot know the reader's direction, so `Side` carries
physical and logical spellings in one value space** (`src/ui/contracts/state-attrs.ts`). The
physical members stay, because a popup that must *not* mirror needs them, and there is deliberately
no separate logical type: `data-side` is one attribute with one value space, and splitting the type
would let a caller hold a value the attribute cannot express.

**The mechanism is physical declarations selected by `:dir()`, not logical CSS**
(`src/ui/assets/css/forge-ui.css`). Both shorter spellings are wrong and both are tempting.
`anchor(inline-end)` is outright invalid — `<anchor-side>` has no logical keywords. And
`inset-inline-start: anchor(start)` parses but resolves against the **containing block's** writing
mode; a top-layer `position: fixed` popup's containing block is the viewport, whose direction is the
root element's, so a `dir="rtl"` subtree inside an LTR document resolves to the LTR answer — the
original bug reintroduced through its own fix. `:dir()` asks the *tree*, which is the only thing
that knows. `position-try-fallbacks` needs nothing added: `flip-inline` transforms *used*
declarations after the cascade settles, so `:dir()` selection happens first.

**Align runs on the axis perpendicular to the side, in whichever vocabulary the side used.**
`inline-*` sides align on the block axis, which does not mirror, so they join the physical rows
verbatim; `block-*` sides align on the inline axis, which does, so those rows are `:dir()`-keyed.
`block-*` *placement* rows carry no `:dir()` at all, direction mirroring the inline axis only.

**A component projects the subset its stylesheet can render**, so an unrenderable value is
unrepresentable rather than silently unstyled: `Tooltip`'s block is a complete *physical* matrix, so
`tooltip.tsx` narrows its prop with `Exclude<Side, …>`. Prefer that projection form — `popover.tsx`
narrows with an independent literal union instead, which does not track future growth of `Side`.

### 1i. Native-Input Primitive Decisions

**`Switch` publishes `data-label-position`** (`before` / `after`) for the label's placement relative
to the track. It is not `data-orientation`: orientation is the widget's own axis, and a switch is
always horizontal — the two would fight the moment a stylesheet matched on either.

**`ScrollArea` adds no behaviour to the platform's scrolling** — no hijacking, no synthetic thumb,
no wheel listener.

### 1j. Derived Ids Must Be Id Tokens

**Every id forge derives for a form field must be a single id token, and a field whose `name` — or
whose non-blank `scope` — is not one derives no `id`, no `for` and no `aria-describedby` at all.**
HTML forbids ASCII whitespace inside an id and splits every IDREF list on it, so such an id can be
*declared* but never *named*: the browser tokenizes the reference into fragments matching nothing.
Deriving the same unusable string on both halves does not redeem it — the harm is the platform's
tokenization, not a disagreement between forge's code paths. The field still renders and its `name`
is still passed through; only the wiring is withheld. `src/ui/core/field.tsx` owns the predicates
and the character set, and is authoritative over any prose restating it
([`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5a).

**The hostile set is exactly HTML's ASCII whitespace, and JS `\s` is the wrong class for it.** `\s`
also matches U+00A0 and the Unicode spaces, which are legal id characters no parser treats as a
separator — so splitting an IDREF on one breaks a *resolvable* id into pieces, manufacturing the
dangling reference this rule exists to prevent.

**Suppressing beats sanitizing**, because collapsing whitespace would have forge rewrite caller
input, which it does not do (§1e emits the caller's `value` verbatim), and any collapse maps
distinct names onto one id so two distinguishable fields silently share wiring. **Suppressing beats
throwing**, because §1c's ratified throw is for a component that cannot render at all
([`ERROR_HANDLING.md`](../governance/ERROR_HANDLING.md) §5a) — here the component renders correctly
and only the association is unexpressible, a degraded field rather than a broken one.

**A blank `scope` is no scope; a whitespace-bearing one is not.** Blank falls back to the unscoped
id, because the caller named no scope. A non-blank scope that is not an id token **suppresses
instead of falling back**, since the unscoped id is precisely the one the scope exists to avoid
colliding with — falling back would re-create the cross-wiring the prop was introduced to fix.

**The rule governs references forge emits, not ids it merely declares.** The groups' per-item id is
declared and never named by any IDREF — the input is wrapped in its `<label>` — so it stays outside
the rule and round-trips a `value` verbatim. Giving any such id a reference means routing it through
the same gate first.

---

### 1k. One Consumption Path, Not Two

**JSX is the only component surface, and that is terminal** — there is no Custom Element mirror and
none will be added. A consumer without the forge JSX runtime hand-writes the DOM contract instead: a
`[data-scope]` root with `data-state`, `data-on-*` on its interactive descendants, and the client
island imported before `resume()` ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §5). That path is
supported rather than tolerated, and reaches forge markup inside a consumer's own open shadow root.

**Form participation is the platform's.** `Toggle`, `Switch` and `ToggleGroup.Item` each wrap a real
`<input>` (§1e), so they submit, restore and validate with no script; a form-associated element would
hand-maintain `setFormValue` and `setValidity` to reach less, and lose it entirely without JS.

**Rejected — Custom Elements as a second path.** Three costs, each sufficient: the spec's mandated
hyphenated name moves the namespace out of the import and into every consumer's markup as a vendor
prefix; the registry is process-global and early-binding, reintroducing global mutable state
([`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §1) plus collision and FOUC
failure modes late-binding delegation does not have; and the audience does not exist under the
no-build-step constraint ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §2), since a
consumer able to load the registering module already runs the bundler that compiles the JSX.
**Form-associated elements for the form controls alone** are rejected for the narrower version of
the same reason: cost without anything the wrapped native input does not already give.

### 1l. Chrome Navigation Announces Only What It Implements

**`Navbar` is not a `role="menubar"`, and that is a decision rather than an omission.** A menubar
owes its triggers a roving tab stop of their own, forge ships no menubar controller, and claiming
the role without the behaviour announces a keyboard interface that is not there. A bar-level link
stays a plain link for the same reason. **A flyout's title action is likewise not a rail stop**:
roving focus queries the whole `<nav>` subtree, so marking that button would splice flyout content
into the rail's arrow-key ring (§1g).

---

## 2. The Signal-Binding Seam

### 2a. The Binding Ownership Boundary

**Forge owns the whole binding in both directions; the app supplies the signal record and whatever
domain effects it layers on top.** `fieldAttr` stamps the field name on the SSR side and
`bindControls(root, signals)` binds it in the browser: one delegated listener on the scope root for
DOM → signal, and one effect per field for signal → DOM. **Value parsing and pressed-state
reconciliation are forge's, not the app's** — the alternative has every consumer hand-writing the
write-back.

**The signal is the state and the DOM is a paint of it.** Nothing is read back out of
`aria-pressed`, so a signal-driven repaint restores a group after markup that was replaced wholesale
— which a design keeping pressed state in the DOM cannot do at all. Each paint is
guarded by a differs-check, which is load-bearing rather than an optimisation: assigning `value`
mid-drag resets a range input. Both directions cross an open shadow boundary: the delegated listener
resolves through `composedPath()`, and each field's repaint walks into every open shadow root under
the scope root rather than running one flat `querySelectorAll`, which a selector cannot make cross. A
closed root is stepped over, the same answer the platform gives everywhere else.

**A button group can express any value its signal can hold.** The type is inferred from the signal's
current value — `boolean` reads `checked`, `number` goes through `Number()`, a `string[]` toggles
membership of `data-value`, anything else is the string. Nothing about the markup limits a button
group to strings; only a split that fixed the type ahead of the signal would.

**Failure follows the throw-or-report rule.** A `data-field` naming no signal in the record is a
property of the markup rather than of the call, so it reports and the rest of the widget keeps
working.

### 2c. `ui/controls` — Bound Variants

**The static `ui/controls` barrel is the only bound-control API — there is no runtime factory to
call.** The single-element wrappers come from an internal, unexported factory, so their shape is
uniform. **`ToggleGroup` is bespoke rather than factory-built**: its binding lives on the `.Item`
sub-component rather than the root and it stamps an extra `data-value`, which the single-element
factory cannot express.

**Neither stamps a `data-on-*` action.** `bindControls` listens once on the scope root, so the markup
names the field and nothing else. A bound-control scope must therefore be `eager: true`, which
[`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c already requires of any markup carrying no
`data-on-*` action of its own.

**The name collision with `ui/core` is intentional and must not be renamed.**
[`NAMESPACES.md`](./NAMESPACES.md) §5b owns the resulting rule: a module imports a
given control name from exactly one of the two barrels, never both.

### 2d. Scoped Components Require the Client Scope Import

Some `ui/core` components render a **resumable scope** — a region stamped with `data-scope` and
a serialized `data-state` whose behaviour wakes only once the matching scope is registered. The
scope registrations live in `@y-core/forge/ui/core/client`, a side-effect module an app must import
once in the client entry, before calling `resume()`.

Without it the markup still renders but no handler is registered, so **`resume()` warns on every
`data-scope` it finds unregistered. Treat that warning as a missing client-entry import or a
scope-name typo — never as an expected runtime condition.**

---

## 3. Class Utilities

`cn`, `asClass`, and `cva` are **ratified `@public` utilities** — apps compose classes with them
exactly as forge's own components do.

### 3d. Conflict Resolution and the Fail-Open Boundary

**Conflict resolution is a table lookup, and the table is `src/ui/core/utils/class-groups.ts`** —
a utility mapped to the CSS concern it sets, with `cn` keeping the last utility to claim a concern.
The file is `@internal` and absent from every barrel, being data rather than API, and it is
**authoritative over any prose describing forge's covered utility surface**: a second copy of a
table is indistinguishable from an amendment the moment the two disagree.

Two things scope a conflict beyond the concern itself: a utility's **modifier prefix** and its
**importance marker** both belong to the key, so `hover:h-5` never displaces `h-full`.

**The coverage boundary.** The table covers the families forge's own primitives emit plus those a
consumer override plausibly targets. **It is not a complete map of Tailwind and will never be.** A
utility outside it passes through untouched — so two conflicting utilities from an uncovered family
are *both* emitted and stylesheet order decides between them. That is the behaviour every consumer
already had before conflict resolution existed; an uncovered family is a gap, not a regression.

**Fail-open, and the inversion is deliberate.** An unrecognised utility is always kept, inverting
the fail-closed posture of [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §5a. The reasoning is
specific to this seam and does not generalise: the "failure" is forge's incomplete knowledge of a
third-party utility vocabulary rather than untrusted input, so nothing here decides whether to trust
a caller; there is no security boundary, since `cn` produces a `class` attribute the renderer
escapes anyway (§1a); failing closed would silently delete a consumer's own class or a utility from
a newer Tailwind, with no error and no fix available from outside forge; and failing open's worst
case is the status quo ante every consumer already lives with.

**Importance is kept, diverging from the stated design reference.** forge keeps `!important` in the
conflict key, so a later *normal* utility cannot displace an earlier *important* one and
`cn("h-full!", "h-5")` keeps both. tailwind-merge strips importance and would drop the first. That
behaviour is wrong at the cascade — `!important` wins regardless of source order — so deleting the
important utility changes what renders. Where the reference is wrong about CSS, forge does not
follow it.

**Closed value spaces are matched by exact whole-utility entry; only open ones are matched by
prefix.** The reason is false positives: a `select-` prefix entry would let a consumer's
`select-wrapper` claim the user-select concern and silently delete a real `select-none`. A value
space that can be enumerated is enumerated.

**A covered utility may still occupy a concern alone**, with no override edge to a related one, so
both survive. Which families are covered at all is `class-groups.ts`'s answer, not this document's.

**Extending the table is a data edit, not a decision.** Adding a family is one line in
`class-groups.ts` plus a test case, and needs no governing-document change, because additions
strictly **narrow** behaviour: a family moves from pass-through to resolved, and nothing the table
already drops starts surviving.

**The ratified decision is an in-house resolver, with tailwind-merge as a design reference only.**
A Workers library pays a runtime dependency's cost into every consumer bundle and again per render
on the SSR path, against a general-purpose Tailwind parser almost none of which forge needs. The
in-house table is tractable precisely because forge is a fixed set of primitives rather than a
general Tailwind consumer.

**No cache, also deliberately.** A memo keyed on the argument list is unbounded mutable module
state needing its own eviction policy ([`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md)
§1), and Cloudflare evicts isolates aggressively enough that a cold refill is paid often rather than
amortised. It stays retrofittable behind the unchanged signature.

---

## 4. State Attribute Contract

**State attributes are the styling hooks CSS matches on to react to a component's state, and they
are declared once, in a module both tiers import.** This is not an SSR concern but the one contract
the server-rendered component and the browser controller must agree on, and neither owns it: a state
attribute is written in **two places that cannot see each other**, and drift is *silent* — the
selector stops matching, so the component looks unstyled rather than broken. The same argument
produced the delegated-event vocabulary ([`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c).

**The declaration is `src/ui/contracts/state-attrs.ts`, and it is authoritative over any prose
naming forge's state attributes.** Nothing here enumerates it, for the reason §3d gives about
`class-groups.ts`.

**Adding a styling hook means adding it to that declaration first.** A component that emits a state
attribute outside the table fails a conformance test — smuggling a hook past it is the exact failure
the single declaration exists to prevent.

**And a declared name with no producer is removed.** A hook that is never emitted is the *inverse*
of the drift above and just as misleading: a consumer styles against it and gets a rule that can
never match. Removal is also cheapest before publication, since afterwards it is a breaking change —
so a hook is added with its producer, never ahead of it.

**The question a producerless hook has to answer is whether an element's state it describes is one a
selector cannot already reach.** Where the answer is yes, it gets a controller rather than a
deletion; where a selector already reaches the state — `:has()` reading a popup's own
`:popover-open` from the trigger's rule — the mirrored attribute describes nothing the DOM does not
already say, and it goes.

**`data-selected` is not `data-checked`.** ARIA models tab selection as `aria-selected`, not
`aria-checked`, so reusing `data-checked` would announce a tab as a radio; and calling it structural
rather than a state would be false, because it is precisely a state a stylesheet reacts to.

### 4a. Presence, Not Value

**Boolean states are emitted by presence, with an empty value — `data-selected=""`, never
`data-selected="true"`.** `[data-selected]` is a cheaper and a more honest selector than
`[data-selected="true"]`, and a false state emits nothing at all, so an unstyled state costs no bytes.

The valued attributes — `data-orientation`, `data-side`, `data-align` — are the exception, because
they carry a choice rather than a flag.

**A state the platform already exposes is not in the table.** Open state is `[open]` or
`:popover-open` on the element itself (§1h); republishing it as a `data-` flag would be a second
copy of a fact forge does not own.

### 4b. ARIA States Are Not Styling Hooks

**A component emits both** — `aria-pressed="true"` beside `data-pressed`, `aria-selected` beside
`data-selected` — and that duplication is deliberate rather than redundant.

`aria-*` keeps its `"true"` / `"false"` string form because WAI-ARIA requires it. The whole point of
the `data-` hook beside it is that **CSS should not have to read ARIA**: a stylesheet matching
`[aria-pressed="true"]` couples presentation to an accessibility contract, so the day the correct
ARIA for a widget changes, the styling breaks with it. The two are reconciled together by one
function, so a controller can never write one without the other.

**`aria-orientation` is emitted on both axes, including the role's default.** `Tabs.List` and
`Toolbar` write `horizontal` as readily as `vertical`, where base-ui omits the default value. The
divergence is deliberate: an attribute present exactly when a caller passed a non-default is one a
test has to assert two ways and a reader has to know a role table to interpret.

### 4c. The Caller Is Authoritative

**A caller's explicit state attribute wins over the component's computed one** — the same principle
as class precedence (§3d) on a different mechanism: **the caller is authoritative over both the
class list and the state attributes.** The mechanism is spread order: a component spreads its state
attributes **before** the forwarded caller props, so a duplicate key resolves to the caller's, and
where the two land on different elements nothing collides. The `ui/core` conformance sweep asserts
it for every participating component.

---

## 5. Colour Scheme Declaration Contract

**A scheme file declares each role step exactly once, and no forge stylesheet declares a custom
property under `.dark`.** A step whose value differs by mode is written with `light-dark()`, and the
branch is selected by `color-scheme`, which `theme-base.css` sets on the light and dark roots.

The rule is about declaration *sites*, not the selector, which is why it is stated that way and not
as "no `.dark` block". `theme-base.css` sets `color-scheme: dark` under `.dark` — that is the
mechanism, and it carries no value a consumer's own scheme could half-supply. The gate enforces the
rule in exactly this shape: a `.dark` rule declaring no custom property passes.

**The two-block form is what this refuses** — the same steps under `:root`, then again under
`.dark` — because it cannot be supplied safely. Both selectors weigh 0-1-0 and both match the
document element, so source order decides, and a consumer's scheme is imported after forge's own. A
consumer supplying only the `:root` half beats forge's dark half and leaks light values into dark
mode, with no error and no warning: light mode looks correct and the defect is visible only to a
reader already on the dark theme. **A documented requirement that fails silently is a design defect
rather than a documentation gap**, and it is the second declaration site that makes the requirement
possible to get wrong at all.

`color-scheme` is declared in `theme-base.css` rather than in the scheme files, so a scheme carries
colour and nothing structural: the scheme is the file a consumer replaces, and the mode wiring is the
file they do not. Declaring it also hands the mode to the user agent, so scrollbars and the
UA-rendered controls forge cannot paint — the native `<select>` popup among them — follow the theme
rather than contradicting it.

The generator that produces such a file — its dials, its pipeline, and the contrast audit it reports
against — is [`THEME_GENERATION.md`](./THEME_GENERATION.md)'s.

**A generated scheme is standalone-complete.** The customiser emits every property a scheme owns,
including the contrast step that pairs with the accent, because a file that is correct only when
layered over forge's default is the same silent half-supply in a different shape.

**The degradation is accepted rather than mitigated.** A browser without `light-dark()` holds the
declaration as an uninterpretable token stream, and every `var()` reading it is invalid at
computed-value time, so the page loses its colours rather than falling back to one mode.
`light-dark()` is Baseline, and forge owes no compatibility shim before its first stable release.

### 5a. OKLCh Solids

**A step is written in OKLCh**, the space its value was produced in.

The ramps in `src/ui/contracts/theme/color.ts` are authored as a per-step lightness with a chroma shape
over it, so OKLCh is the scheme's own space and hex was a lossy render of it. Writing that space into
the file makes a scheme legible and hand-editable: shifting the hue of every step becomes a
substitution rather than a regeneration. It costs the contrast gate nothing, because the resolver
already reads `oklch()` — the palette values `theme-colors.css` aliases arrive from Tailwind in that
form.

**The emitted OKLCh is gamut-mapped, never the raw ramp coordinate.** Chroma is reduced at constant
lightness and hue until the colour is representable in sRGB, and the reduced coordinates are what the
file carries. A raw coordinate outside sRGB renders wider on a display that can show it, and the
audited ratio would then describe a colour that reader never sees.

### 5b. The Rejected Wide-Gamut Branch

**No scheme ships a `display-p3` branch.** The wide-gamut values a `@supports` and `color-gamut`
pair would carry are not the values forge audits.

WCAG relative luminance is defined over sRGB, and forge's checks reproduce that procedure rather than
an equivalent one. A second set of values behind a feature query is a second theme the gate does not
walk and cannot measure, which would leave every pinned ratio describing the fallback alone. The gain
is a slightly more saturated accent for a reader on a wide-gamut display; the cost is that forge's
accessibility claims would hold only for a branch that reader does not receive. The claim is worth
more than the saturation.

The same test rejects the per-scale surface, indicator, and track properties a wider palette library
declares: forge resolves those through its semantic layer, and a step nothing reads is surface a
consumer can come to depend on before any component justifies it.

### 5c. Status Hues Are Forge's; Brand Fills Are the App's

**`--status-*` is deliberately separate from `--destructive` / `--success` / `--warning`, and the
split is an ownership one.** The latter are fills an app owns and may re-point at its brand; the
status hues are forge's, so a failure panel keeps meaning "failed" whatever `--destructive` has been
pointed at. An app that means to change what "failed" *looks like* re-points the underlying step,
not the semantic alias.

### 5d. The dark: Variant Is Class-Driven, and That Is a Takeover

**`forge.css` redefines Tailwind's `dark:` variant to follow the theme class rather than
`prefers-color-scheme`,** because otherwise a `dark:` utility follows the *operating system* while
every forge token follows the *user's choice* — and the two disagree the moment someone picks a
theme that is not `system`.

**It reconfigures a consumer's own `dark:` utilities too, and nothing catches that**: forge has no
Tailwind dependency, so no gate here ever compiles CSS. Stating the takeover is the obligation this
section carries — the escape hatch is the cascade, since `@custom-variant` is last-declaration-wins.

### 5e. A Consumer Rule Loses by Layer, Not by Selector

**Every rule in `forge-ui.css` sits in `@layer components`, so a utility passed at a call site wins
over a component default** — which is what makes `class` on a forge component behave as it reads.
The consequence runs the other way too: a rule an app puts in `@layer components` is outranked by
every forge utility in `@layer utilities`, whatever its specificity. **The remedy is a layer, not a
selector** — one declared after `utilities`. Reaching for higher specificity instead appears to work
until the next utility is added.
