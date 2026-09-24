---
title: UI SSR Components
description: "The ui/core server-rendered component surface, its attribute pass-through contract, the ui/controls bound variants, and the server-side half of the signal-binding seam."
audience: consumer
---

# UI SSR Components

> Owns the server-rendered UI tier: the `ui/core` component contract, the `ui/controls` bound variants, and the server-side half of the
> signal-binding seam.
>
> Defers to: [`UI_CLASS_COMPOSITION.md`][ucc] for the `cn` / `cva` utilities, the conflict table, the `@utility` recipe layer, and the colour-scheme
> declaration contract; [`UI_CLIENT_RUNTIME.md`][ucr] for everything that runs in the browser and for the hard SSR/client boundary;
> [`STATE_ATTRIBUTES.md`][sa] for the `data-*` vocabulary a component emits and the sweep that holds it to one declaration; `src/ui/README.md` for
> the component gallery, props, and worked usage; [`SECURITY_HARDENING.md`][sh-2d] §2d for automatic URL sanitization;
> [`NAMESPACES.md`][namespaces-5b] §5b for the one-import rule that governs the `ui/core` / `ui/controls` name collision.
>
> Components produce a forge element tree that `renderToString` (`@y-core/forge/jsx`) serializes to `SafeHtml`. The JSX runtime is forge's own — set
> `/** @jsxImportSource @y-core/forge/jsx */` at the top of each `.tsx` file.

---

## 0. Quick Reference

- §1 ui/core Component Contract: the rules every SSR component obeys
- §1a Dropped and Unsanitized Pass-Through Attributes: why `style` never arrives, and the one family left unsanitized
- §1c Button and the asChild Invariant: the ratified throw, and the `data-slot` token list
- §1e Switch and Slider — CSS-Only Controls: the `peer-*` trap, the sanitized readout, the declined formatter seam
- §1f Turnstile — Server-Rendered Mount Point: deliberate omission of auto-render
- §1g Composite Widgets: the markers that make many focusable items one tab stop
- §1h Overlays and Disclosures: native popover and `<details>`; naming a panel; how a popup's side resolves against the reader's direction
- §1i Native-Input Primitive Decisions: an axis that is not an orientation, a scroll area that hijacks nothing, the bounds content-sizing needs, and
  a frame clipped rather than scrolled
- §1j Derived Ids Must Be Id Tokens: why a whitespace-bearing `name` or `scope` derives no wiring, and why suppressing won
- §1k One Consumption Path, Not Two: JSX as the terminal surface, the `data-scope` route, the rejected Custom Element mirror
- §1l Chrome Navigation Announces Only What It Implements: the not-a-menubar and not-a-rail-stop rulings
- §1m The Prop Vocabulary: the ratified props, the ban on `variant`, and the one `size` exemption
- §1n Optional Input Props Carry an Explicit `| undefined`: why the union is universal on input types, and what the guard-form spread was hiding
  from a11y lint
- §2 The Signal-Binding Seam: how SSR markup names a client-side binding
- §2a The Binding Ownership Boundary: what forge owns in both directions, and what the app supplies
- §2c ui/controls — Bound Variants: the static barrel, the bespoke case, and the deliberate name collision
- §2d Scoped Components Require the Client Scope Import: the `resume()` precondition

---

## 1. ui/core Component Contract

**Put every English name forge emits in `src/ui/contracts/labels.ts`, and give it a prop that overrides it.** Forge ships no
i18n surface, so a name a consumer cannot reach cannot be translated, and a default spelled at its call site is a second home for the string the
table exists to hold. `LABEL_DEFAULTS` is `@public` because a translating consumer's only other option is re-typing each string in a repository
forge's gate cannot see, where it silently stops matching. A conformance scan enforces this with no exemption row: no literal label default, no
literal text in an `sr-only` span, no literal `aria-label`, and no template-literal name carrying a word outside its interpolations.

**Key a catalogue on the key, never on the English value.** Every `LABEL_DEFAULTS` value is a string, so its key set types one directly as
`Record<keyof typeof LABEL_DEFAULTS, string>` and yields a compile error when forge adds a site. `STEP_STATE_LABELS` stays a second table because it
is indexed by a _runtime value_; nesting it would force every consumer of the flat one to handle a non-string member. Annotate neither
`Record<StepState, …>` — `ui/contracts` is a declared leaf and may not import `StepState`, and re-declaring the union would be two spellings of one
concept. `as const` needs no import and loses nothing: a new `StepState` member fails to compile at both read sites.

**The `Navbar` landmark is carved out and holds no key.** An unnamed `<nav>` already announces as "navigation", so a constant default replaces a
correct platform default with a guess — and gives two Navbars on one page the same name, which the demonstrator's catalog spec (forge-starter
`tests/unit/showcase/components.test.tsx`) catches under "gives every navigation landmark on every page a label, and no two the same".
`aria-label` / `aria-labelledby` stay the consumer's, passed through. A key with no default would translate into a string forge never emits.

**`Navbar`'s name is also deliberately not required at the type level, unlike every other container forge names.** `Tabs.List`, `ToggleGroup`,
`Toolbar`, `Filter.Group` and `Popover.Content` all refuse to compile unnamed, because each renders a role that takes no name from its contents
and is anonymous without one. A `<nav>` is the opposite case: one on a page is correctly named by its role alone, so requiring a name would make
every single-nav page invent one — the same guess the paragraph above rejects, moved from forge to the consumer. The obligation is therefore a
documented one, owed only by a page rendering more than one bar, and forge's own pages are held to it by that test rather than by the compiler.

**Import `../contracts/labels` at each call site, never `../contracts/mod`** — that is what keeps the barrel from pulling every contract table into
the Worker graph. Reference the table as `LABEL_DEFAULTS.x` rather than re-spelling the literal. `state-attrs.ts` and `vocabulary.ts` spell
attribute names literally because `client/*.ts` imports them and a runtime reference would drag the table into a browser bundle, but `labels.ts` is
Worker-side only: no `core/*.tsx` or `chrome/*.tsx` module reaches a browser entry. The idiom could not apply here anyway — a label's value _is_ the
payload, so a call-site literal would be a second home for the very string being centralised.

### 1a. Dropped and Unsanitized Pass-Through Attributes

**Never pass `style`.** Forge's CSP carries no `style-src 'unsafe-inline'`, so an inline style attribute could never take effect. Use `class` and
the theme tokens.

The renderer HTML-escapes forwarded values and routes URL-bearing attributes through `safeUrl`, collapsing a `javascript:`-style value to `"#"`.
**This is automatic; never call it from a component** ([`SECURITY_HARDENING.md`][sh-2d] §2d). htmx selector and JSON attributes are **not**
sanitized — [`HTMX.md`][htmx-7] §7 owns that trust obligation.

### 1c. Button and the `asChild` Invariant

**Give `asChild` exactly one JSX element child.** A string, number, fragment, array or empty child is a programming error, and **`Button` throws
rather than degrading** — a ratified invariant, consistent with [`ERROR_HANDLING.md`][eh-5a] §5a.

**Check the fragment case in `cloneAsChild`, not at the call site.** `isValidElement` accepts a `Fragment` — it is an element of this runtime — but
a fragment carries no attributes, so cloning onto one merges the class, the `data-slot` and every caller prop into a value the renderer never reads.
The failure is silent and total, and every `asChild` compound can reach it, so the guard belongs in the one place they all pass through. `Button`
would reach it by wrapping its children to make room for a loading spinner; the spinner is injected into the cloned child instead.

**Merge into `data-slot`; never replace it.** It is a token list, under `asChild` and on plain render alike, so composing compounds yields one
element that genuinely is both: `<Tooltip.Trigger asChild><Menu.Trigger/></Tooltip.Trigger>` renders a single button carrying
`data-slot="menu-trigger tooltip-trigger"`. Overwriting silently unmakes the inner compound, and every rule and query keyed on its slot stops
matching.

**Select `data-slot` with `~=`, never `=`.** The two have identical specificity (0,1,0), so nothing about the cascade shifts; `=` is simply wrong on
a composed element. A consumer keying on `[data-slot="…"]` exactly must make the same change to keep matching one.

**Declare `anchor-name` on one slot only.** It does not union across rules, so a composed element named by two leaves the cascade to pick one.
`forge-ui.css` declares forge's one named anchor on the tooltip trigger slot alone, and the set is closed: `Tooltip.Trigger` is the only trigger
compound offering `asChild`, which makes it always the outer wrapper.

**Destructure the inherited `"data-slot"` out of props and rewrite the literal in place** as `data-slot={slotToken("own-token", inherited)}`, own
token first (`slotToken` is owned by `src/ui/core/utils/as-child.ts`). A bare literal loses the compound's own token to any caller that passes
`data-slot`, because the rest-props spread that follows it wins. Rewrite in place rather than merging through a spread-last helper, which would move
the attribute's serialized position.

**The order is lint-enforced, not conventional.** `forge/data-slot-before-spread` fails any JSX element carrying a literal `data-slot` before a
spread of a **bare identifier** (`{...rest}`, `{...props}`, `{...attrs}`). A computed spread such as `{...stateAttrs({ selected })}` is outside the
rule: it is built at the call site out of values the component controls, so no caller token can hide inside it. It is off for `*.test.tsx` alone,
where a probe overrides its own caller token on purpose.

### 1e. Switch and Slider — CSS-Only Controls

**Never reach for `peer-*` from an element nested inside another — the failure is silent.** `peer-*` compiles to a general-sibling combinator, so it
reaches only siblings of the input. The track is one and uses `peer-checked:` directly; the **thumb is a child of the track**, so a `peer-` utility
on it matches nothing — no build error, no visual hint beyond a state that never moves. The thumb keys off a `data-slot`-anchored descendant
selector instead.

**`Slider`'s `output` prop carries the _sanitized_ value, never the raw `value` prop** — the string HTML's value-sanitization algorithm for
`input[type=range]` settles on, which is what positions the thumb. A readout taken from the prop can disagree with the thumb permanently, and
`Slider` ships no client controller to reconcile them. The algorithm is module-local to `slider.tsx` and takes the serialized attribute string
rather than the prop, so it parses byte-for-byte what the browser parses. **Mirroring that readout on input is the consumer's job** — forge stays
markup-only (§1a). This is §1h's "stamp only what the server can keep true" resolving _toward_ stamping.

**`output` stays a boolean, and the unformatted readout is a decision rather than a gap** — no formatting hook, no locale, no unit. A consumer
wanting `"50%"` composes their own `<output>`, as `Meter.Value`'s caller-supplied children already make presenting a number composition rather than
configuration. **Hand any future formatter seam the _sanitized_ string, never the raw prop.**

### 1f. Turnstile — Server-Rendered Mount Point

**`Turnstile` omits Cloudflare's `cf-turnstile` auto-render class deliberately** — the client controller owns rendering, so the widget lifecycle is
deterministic rather than implicit. **Inject `siteKey` server-side from the Worker env; never hardcode it.** The markup is inert without the
controller, whose options arrive as `data-` attributes ([`UI_CLIENT_RUNTIME.md`][ucr-2c] §2c).

**Stamp an option only where it differs from its default.** A page that opts into none renders the markup it always did, which is what makes a new
option additive rather than a change to every widget.

### 1g. Composite Widgets

A **composite** is a widget made of many focusable items that behaves as **one tab stop**, and every composite shares one roving-focus controller
([`src/ui/README.md`][ui-readme]). **Declare which elements are items in the markup; the controller never guesses.** How each widget declares them
differs, deliberately.

**`Toolbar` marks its items with an explicit `data-toolbar-item`, not a `data-slot` prefix**, because `Toolbar.Group` and `Toolbar.Separator` are
slots that must _not_ be focus stops and a prefix selector cannot express the exception. The marker is public: any foreign element inside a toolbar
opts in by carrying it.

**`Menu` identifies items by ARIA role, never by a forge-specific attribute.** That is load-bearing for a menu whose rows are built in the browser —
a runtime-constructed row is navigable the moment it is a correctly-roled menu item, with nothing forge-specific to remember to stamp. Every row
that must participate carries the role, including a navigating `<a>` and a nested popup's trigger, which a bare `Menu.Trigger` would leave unroled
for the parent's arrow navigation to skip.

**`ToggleGroup` emits no `role` at all**, because `<fieldset>` already has an implicit `group`; a hardcoded `role="toolbar"` would announce a
segmented control as a toolbar and offer the wrong interaction model. Its `type` prop publishes as `data-multiple`, present exactly when several
items may be pressed at once, and that is what the client reads to decide whether a click replaces the pressed item or adds to it (§2a).

An unselected `Tabs.Content` is `hidden` — the platform's own mechanism, so the initial render is correct with no JavaScript and the controller
flips the same attribute.

### 1h. Overlays and Disclosures

**Never re-create a platform overlay in JavaScript.** The overlays build on the native Popover API, `<dialog>` and `<details>`, so the top layer,
light-dismiss, Escape, exclusive-open and the disclosure toggle are all the platform's and cost nothing. **`<details>` owns open and closed; mirror
neither** — style the native `[open]`. `Menu` opens, closes and dismisses with **no JavaScript at all**, through invoker commands against a
`popover="auto"` popup; the client adds only what ARIA's menu pattern asks for and the platform does not supply (§1g). **`Tooltip` is
`popover="hint"` deliberately**: `auto` would put it in the platform's exclusive-open stack, so opening a tooltip would close an open menu beneath
it. `hint` has a light-dismiss stack of its own, which is the behaviour a tooltip wants and the reason it is not `manual`. `Accordion` is not a
composite — each item is its own disclosure and tab stop, as a native `<details>` list is.

**Accept that an `Accordion` header is not a heading, and do not simulate one.** APG's Accordion wraps each header button in an element with role
`heading` and an `aria-level`, so a reader walking headings with `H` reaches every section. A native `<summary>` cannot be given that wrapper: a
heading around the `<details>` encloses the panel as well, making the whole section's prose part of the heading, and a heading nested _inside_ the
`<summary>` is flattened, because the summary's role takes presentational children. The cost is real and is the one being accepted — `H` navigation
skips the accordion, and a reader finds its sections by Tab instead, where each `<summary>` is a stop that announces its own expanded state. What
buys it is everything §1h opens with: exclusive-open, the toggle, and correct first paint with no script. **A caller who needs `H` navigation
renders their own heading before each `Accordion.Item`** rather than inside its trigger, and forge neither emits nor simulates one; a component that
did would be asserting a structure the platform contradicts.

**Stamp no scope on an overlay whose behaviour is wholly the platform's.** `Dialog`, `Popover`, `Accordion` and `Collapsible` ship neither scope nor
controller. The one exception is `Dialog`'s `openModal`: a modal has no markup spelling at all, so `showModal()` has to run on resume, and that prop
alone stamps the dialog scope and an eager controller. It also suppresses `open`, which would otherwise render the dialog non-modal and make that
`showModal()` throw. `Menu` and `Tooltip` stamp one because they add a keyboard layer, eager by necessity rather than taste
([`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c).

**Stamp only what the server can keep true.** Placement is decided at render and fixed for the element's life, so stamp it. **Never stamp open
state** — that asserts a fact the platform owns and the component cannot follow. Read open state from the element itself: `:popover-open`, or
`[open]` on a `<dialog>` or `<details>`, the one source that cannot drift. Forward an initial `open`, which the server genuinely sets and the
platform maintains from there.

**Keep physical and logical spellings in one value space.** A side is stamped at SSR, where the Worker cannot know the reader's direction, so `Side`
carries both (`src/ui/contracts/state-attrs.ts`). Keep the physical members — a popup that must _not_ mirror needs them — and add no separate
logical type: splitting it would let a caller hold a value the attribute cannot express.

**Resolve direction with physical declarations selected by `:dir()`, never with logical CSS** (`src/ui/assets/css/forge-ui.css`). Both shorter
spellings are wrong and both are tempting. `anchor(inline-end)` is outright invalid — `<anchor-side>` has no logical keywords. And
`inset-inline-start: anchor(start)` parses but resolves against the **containing block's** writing mode; a top-layer popup's containing block is the
viewport, whose direction is the root element's, so a `dir="rtl"` subtree inside an LTR document resolves to the LTR answer — the original bug
reintroduced through its own fix. `:dir()` asks the _tree_, which is the only thing that knows. `position-try-fallbacks` needs nothing added:
`flip-inline` transforms _used_ declarations after the cascade settles, so `:dir()` selection happens first. Only the inline axis mirrors, so only
the rows resolving on it are `:dir()`-keyed.

**Name every `Popover.Content`, and never forward a `role` to it.** `role="dialog"` is `nameFrom: author`, so the type requires `label` or
`labelledby` — one of them, not neither — and a nameless panel is a compile error rather than an `aria-dialog-name` failure in a consumer's axe run.
`role` is not forwardable for the matching reason: `Popover.Trigger` emits a fixed `aria-haspopup="dialog"` and has no way to say otherwise, so a
re-roled panel would leave the pair disagreeing. Reach for `Menu.Popup` for a menu-role popup — it brings a trigger that agrees with it. Both are
breaking and land before v1.0.0 deliberately ([`FORGE_STRUCTURE.md`][la-7] §7): an optional name would have left every consumer's panel nameless by
default, which is the defect rather than a lesser form of it.

**Never emit a derived reference a rendered page might not resolve — make the caller assert the element it points at.** `Dialog` and `Drawer` take
`titled`, and `Menu.Popup` takes `triggered`; each is the caller saying the `.Title` or the forge trigger exists, and each is the only route to the
`${id}-title` or `${id}-trigger` reference. Every one of these roots is `nameFrom: author`, so a name has to come from somewhere, and the type makes
that a choice rather than a default: naming nothing does not compile. **The assertion is needed because single-pass SSR cannot check it** — a
caller's own component may render the `.Title`, and forge's invoker contract invites any `commandfor` element to open a `Menu.Popup`, so neither a
children walk nor a document query can tell a missing element from one forge cannot see. An unconditional reference was the alternative in both
places, and it leaves an IDREF resolving to nothing: inert under AccName, an `aria-valid-attr-value` violation in a consumer's axe run, and a panel
with no name for a reader who enters it. **The assertion also has to be what the emission reads** — a prop the root destructures and never passes on
leaves the derived reference unconditional, so the rule holds only on the type and evaporates under a spread of a wider object, an `as` cast or a
`.js` consumer.

**`Tabs.Content` is the one derived reference emitted unconditionally, because its target is not optional.** A tabpanel names itself from its tab
and from nothing else, and a panel no `Tab` controls is not a panel missing a name — it is one no reader can reach at all, since a tab is the only
thing that reveals it and it renders `hidden` until one selects it. There is no second way to name it and so nothing for an assertion to choose
between; the defect the assertion would catch is already a broken tab set, which a reader meets as an unreachable panel rather than as a dangling
IDREF.

**Give a `<dialog>` root the caller's name where there is one, and the derived reference only on their word** (`contracts/dialog-contract.ts`).
`Dialog` and `Drawer` take `label`, `labelledby` or `titled`, and `label` and `labelledby` suppress the `${id}-title` reference: a derived reference
emitted beside a caller's own would name a heading they never wrote. The requirement is breaking and lands before v1.0.0 deliberately
([`FORGE_STRUCTURE.md`][la-7] §7). **Point a deliberately titleless drawer's `labelledby` at its own trigger's id**: that is React Aria's fallback,
and `Drawer.Trigger`'s `commandfor` already proves the relationship exists, in the direction SSR cannot invert. **Emit `aria-describedby` only on
the same assertion the name takes** — the description computation _is_ a precedence table a UA must not look past, so a dangling one suppresses
`aria-description` and `title`. `Dialog`'s `described` is that assertion, and `Dialog.Description` is the element it points at, derived
`${id}-description` from the one id the caller wrote. `alert` renders the root `role="alertdialog"`, which is APG's Alert and Message Dialog: a
message interrupting the reader's work, named by its title and described by its text, so a reader whose focus lands on "Cancel" hears the
consequence and not the button alone.

**Project only the subset the stylesheet can render**, so an unrenderable value is unrepresentable rather than silently unstyled: `Popover.Content`
and `Tooltip.Content` take `PhysicalSide`, the named member of `Side` rather than a literal union of their own, so the projection tracks the value
space it is cut from.

**A `Table.Row`'s `selected` paints and does not announce, and a wide table is a named tab stop.** `aria-selected` is a supported state of role
`row`, but it is only _meaningful_ inside a `grid` or `treegrid`; a `<tr>` in a plain `<table>` is a `row` in a `table`, which has no selection
model to report it to, so the attribute was inert while `data-selected` painted. APG's Table pattern is non-interactive by design and selectable
rows are the Grid pattern, which brings a whole keyboard contract forge does not implement — so the state is a visual one and says so. **A caller
who needs the selection announced puts a control in the row**: a checkbox in the first cell is announced natively, is operable, and is what a reader
can act on, where an `aria-selected` on the row is neither. The scroll wrapper takes the shape `ScrollArea.Viewport` has — a named `<section>` that
is an unconditional tab stop — because a browser makes an overflowing scroller focusable only when it holds nothing focusable, and Safari not at
all, so a wide table of plain text was unscrollable from the keyboard (WCAG 2.1.1). That is why `Table` requires `label`.

### 1i. Native-Input Primitive Decisions

**`Switch` takes `labelPlacement` and publishes `data-label-position`** (`before` / `after`) for the label's side of the track. It is not an
orientation: orientation is the widget's own axis, a switch is always horizontal, and the two would fight the moment a stylesheet matched on either
(§1m).

**`ScrollArea` adds nothing to the platform's scrolling** — no hijacking, no synthetic thumb, no wheel listener.

**`Textarea` sizes to its content, and the two bounds either side of it are not optional.** `field-sizing-content` takes the height away from
`rows`, so `h-auto` is needed to clear the fixed height `field-chrome` sets ([`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e), and a floor and a cap are
both required: with no floor, every consumer that passes `rows` gets a collapsed one-line box, and with no cap the control grows without bound.
`src/ui/core/textarea.tsx` is authoritative over which utilities express them.

**Clip `OtpInput`'s frame with `overflow: clip`, never `hidden`.** The editor deliberately overhangs the frame's interior to leave the caret room
after the last glyph (`forge-ui.css`, `otp-editor`). Under `overflow: hidden` that frame is also a scroll container, so revealing the caret at the
clipped edge scrolls the whole grid a pad's width off its cells — permanently, on the first full code typed. `clip` forbids scrolling and clips the
same overhang.

### 1j. Derived Ids Must Be Id Tokens

**Derive an id only where it is a single id token.** A field whose `name` — or whose non-blank `scope` — is not one derives no `id`, no `for` and no
`aria-describedby` at all. HTML forbids ASCII whitespace inside an id and splits every IDREF list on it, so such an id can be _declared_ but never
_named_: the browser tokenizes the reference into fragments matching nothing, and deriving the same unusable string on both halves does not redeem
it. The field still renders and its `name` is still passed through; only the wiring is withheld. `src/ui/core/field.tsx` owns the predicates and the
character set, and is authoritative over any prose restating it.

**Test for HTML's ASCII whitespace, never JS `\s`.** `\s` also matches U+00A0 and the Unicode spaces, which are legal id characters no parser treats
as a separator — so splitting an IDREF on one breaks a _resolvable_ id into pieces, manufacturing the dangling reference this rule exists to
prevent.

**Suppress rather than sanitize**: collapsing whitespace would have forge rewrite caller input, which it does not do (§1e emits the caller's `value`
verbatim), and any collapse maps distinct names onto one id, so two distinguishable fields silently share wiring. **Suppress rather than throw**:
§1c's ratified throw is for a component that cannot render at all, and here it renders correctly with only the association unexpressible — a
degraded field rather than a broken one.

**Treat a blank `scope` as no scope, and a whitespace-bearing one as neither.** Blank falls back to the unscoped id, because the caller named no
scope. A non-blank scope that is not an id token **suppresses instead of falling back**: the unscoped id is precisely the one the scope exists to
avoid colliding with, so falling back would re-create the cross-wiring the prop was introduced to fix.

**The rule governs references forge emits, not ids it merely declares.** An id that is declared and never named by any IDREF stays outside the rule
and round-trips a `value` verbatim. Give any such id a reference and it must route through the same gate first.

---

### 1k. One Consumption Path, Not Two

**JSX is the only component surface, and that is terminal** — there is no Custom Element mirror and none will be added. A consumer without the forge
JSX runtime hand-writes the DOM contract instead ([`UI_CLIENT_RUNTIME.md`][ucr-5] §5). That path is supported rather than tolerated, and reaches
forge markup inside a consumer's own open shadow root.

**Leave form participation to the platform.** Every form control wraps a real `<input>` (§1e), so it submits, restores and validates with no script;
a form-associated element would hand-maintain `setFormValue` and `setValidity` to reach less, and lose it entirely without JS.

**Rejected — Custom Elements as a second path.** Each of these costs is sufficient alone: the spec's mandated hyphenated name moves the namespace
out of the import and into every consumer's markup as a vendor prefix; the registry is process-global and early-binding, reintroducing global
mutable state
([`CODE_RULES.md`][cr-1] §1) plus collision and FOUC failure modes late-binding delegation does not have; and the audience does not exist under the
no-build-step constraint ([`FORGE_STRUCTURE.md`][la-2] §2), since a consumer able to load the registering module already runs the bundler that
compiles the JSX. **Form-associated elements for the form controls alone** are rejected for the narrower version of the same reason.

### 1l. Chrome Navigation Announces Only What It Implements

**`Navbar` is not a `role="menubar"`, and that is a decision rather than an omission.** A menubar owes its triggers a roving tab stop of their own,
forge ships no menubar controller, and claiming the role without the behaviour announces a keyboard interface that is not there. A bar-level link
stays a plain link for the same reason. **A flyout's title action is likewise not a rail stop**: roving focus queries the whole rail subtree, so
marking that button would splice flyout content into the rail's arrow-key ring (§1g).

**`Navbar` keeps `<details>` for its collapsed nav; never rewire it onto `Drawer`.** The two are different overlay kinds: a `Drawer` is a `<dialog>`
— top layer, backdrop, inertness, a focus trap — and the collapsed nav is a disclosure with none of those, whose open state the platform owns with
no script. Rewiring one onto the other would turn a no-JS disclosure into a modal that needs `showModal()`, which is a behaviour change rather than
an extraction.

### 1m. The Prop Vocabulary

**Draw every presentational prop from one vocabulary**, declared in `src/ui/contracts/vocabulary.ts` and `state-attrs.ts` — authoritative over the
values; `src/ui/README.md` maps prop to component.

| Prop | What it decides | Declared as |
| --- | --- | --- |
| `tone` | the colour intent a surface carries | `Tone`, `TONES` |
| `appearance` | how that tone is painted — the emphasis level | `Appearance`, `APPEARANCES` |
| `size` | the control height, read from `--control-h-*` | `Size` |
| `shape` | a button's footprint beyond its size | `Shape` |
| `orientation` | the widget's own layout axis | `Orientation` |
| `invalid` | the control holds a validation error | `StateAttrsProps` |
| `busy` | the component is waiting on work | `StateAttrsProps` |

**Never declare a prop named `variant`.** One name answering two questions — which colour, and how much emphasis — is what let `secondary` mean an
outlined button and a filled chip at once. Asked separately the pair reads identically everywhere, and `toneVariants`
([`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e) paints both.

**`orientation` carries the two layout axes and nothing else**, because a stylesheet matches `data-orientation` on exactly that: `Switch`'s label
side is `labelPlacement` (§1i), and `FormField`'s width-driven collapse a separate `responsive` boolean.

**Some props sit outside the table.** `Turnstile`'s `size` is Cloudflare's, verbatim (§1f). `level` picks the heading tag on `EmptyState.Title`
(default `3`) and `Dialog`/`Drawer.Title` (default `2`), and nothing else — `data-slot`, the class and the derived `id` are identical at every
level, so `aria-labelledby` still resolves. It is the tool `forge-ui-heading-order` needed. Not `as`, which already names a type scale on
`FormField.Legend`.

**Where a native attribute collides with the vocabulary, the vocabulary wins and the native one is renamed.** `Select` omits the DOM's `size` and
takes `rows` for the visible option count, because `size` on every other control is the `Size` token and one name meaning a height token here and a
row count there is the `variant` mistake in a second costume. What was weighed and is settled: `rows` over `visibleRows` because it is the
name `<textarea>` already uses for the same idea; one prop over a separate `Listbox`, because the two render the same element and differ only in
whether the popup collapses — a second component would double the surface to express a boolean; and the shadowing is safe rather than a trap,
because `Omit` makes a spread carrying a numeric `size` a type error at the call site rather than a silent resize.

**`conformance.test.tsx` enforces these rules** by scanning `ui/core`, `ui/chrome` and `ui/controls`, carrying each exemption with its reason — so
adding one is visible, not a quiet edit.

### 1n. Optional Input Props Carry an Explicit `| undefined`

**Declare every optional property of a type a consumer passes values into as `name?: T | undefined`** — the whole of `src/jsx/types.ts` and every
`*Props` in `src/ui`. **Keep the bare `?:` for internal data structures and options objects**, the distinction `exactOptionalPropertyTypes` is
actually for. **Ask "does a consumer construct a value of this type", not "is it named `*Props`"**: a definition object handed to a component —
`NavSlot`, `NavMegaMenu`, `ToolbarPopover` — is a consumer input as much as an attribute bag is, and the suffix reading lets such a type drift.

**The second of these reasons is a correctness one.** `renderToString` skips a null or undefined attribute value (`src/jsx/render-to-string.ts`), so
absent and `undefined` are the same state at runtime and the flag would guard a distinction the renderer does not have. And without the union a
caller under the flag writes `{...(x !== undefined ? { "aria-label": x } : {})}` rather than `aria-label={x}` — a spread, which `jsx-a11y` cannot
see as an attribute, leaving every such site unlinted. `@types/react` writes `className?: string | undefined` for the same reason.
**Never fix such an error at a forge call site with a guard-form spread; widen the declaration instead.** What stays is the **truthiness** spread,
`{...(open ? { open: true } : {})}`, an omit-when-false HTML semantic.

---

## 2. The Signal-Binding Seam

### 2a. The Binding Ownership Boundary

**Forge owns the whole binding in both directions; the app supplies the signal record and whatever domain effects it layers on top.** The SSR side
stamps the field name and the browser side binds it — one delegated listener on the scope root for DOM → signal, one effect per field for signal →
DOM. **Value parsing and pressed-state reconciliation are forge's, not the app's**, the alternative having every consumer hand-write the write-back.

**Treat the signal as the state and the DOM as a paint of it.** Nothing is read back out of `aria-pressed`, so a signal-driven repaint restores a
group after markup that was replaced wholesale — which a design keeping pressed state in the DOM cannot do at all. Each paint is guarded by a
differs-check, load-bearing rather than an optimisation: assigning `value` mid-drag resets a range input. **Both directions cross an open shadow
boundary**, the repaint walking into every open shadow root under the scope root rather than running one flat `querySelectorAll`, which a selector
cannot make cross. A closed root is stepped over — the same answer the platform gives everywhere else.

**A button group expresses any value its signal can hold**, the type being inferred from the signal's current value rather than pinned by the
markup. Only a split that pinned the type ahead of the signal would limit a button group to strings.

**Failure follows the throw-or-report rule.** A `data-field` naming no signal in the record is a property of the markup rather than of the call, so
it reports and the rest of the widget keeps working.

### 2c. `ui/controls` — Bound Variants

**The static `ui/controls` barrel is the only bound-control API — there is no runtime factory to call.** The single-element wrappers come from an
internal, unexported factory, so their shape is uniform. **`ToggleGroup` is bespoke rather than factory-built**: its binding lives on the `.Item`
sub-component rather than the root and it stamps an extra `data-value`, which the single-element factory cannot express.

**No bound control stamps a `data-on-*` action** — `bindControls` listens once on the scope root instead, so a bound-control scope must be
`eager: true`, which [`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c already requires of any markup carrying no `data-on-*` action of its own.

**`Toggle` has no resumable scope of its own, and deliberately so.** It is a native checkbox whose `:checked` the CSS keys on, so there is no state
for a controller to maintain and no bespoke runtime to keep in step with `ToggleGroup`'s — which does have one, for the roving focus a checkbox
group lacks.

**Never rename the collision with `ui/core`; it is intentional.** [`NAMESPACES.md`][namespaces-5b] §5b owns the resulting rule: a module imports a
given control name from exactly one barrel, never both.

### 2d. Scoped Components Require the Client Scope Import

Some `ui/core` components render a **resumable scope**, whose behaviour wakes only once the matching scope is registered. **Import
`@y-core/forge/ui/core/client` once in the client entry, before calling `resume()`** — it is the side-effect module holding the registrations.

Without it the markup still renders but no handler is registered, so **`resume()` warns on every `data-scope` it finds unregistered. Treat that
warning as a missing client-entry import or a scope-name typo — never as an expected runtime condition.**

[cr-1]: ../warden/canon/shared/CODE_RULES.md#1-zero-global-state-rule
[eh-5a]: ../warden/canon/libs/ERROR_HANDLING.md#5a-expected-errors--return-result
[htmx-7]: ./HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[la-2]: ./FORGE_STRUCTURE.md#2-namespace-dependency-tiers
[la-7]: ./FORGE_STRUCTURE.md#7-pre-10-api-evolution
[namespaces-5b]: ./NAMESPACES.md#5b-uicore--ssr-components-only
[sa]: ./STATE_ATTRIBUTES.md
[sh-2d]: ./SECURITY_HARDENING.md#2d-getnonce-and-automatic-url-sanitization
[ucc]: ./UI_CLASS_COMPOSITION.md
[ucc-1e]: ./UI_CLASS_COMPOSITION.md#1e-the-utility-recipe-layer
[ucr]: ./UI_CLIENT_RUNTIME.md
[ucr-2c]: ./UI_CLIENT_RUNTIME.md#2c-the-turnstile-scope--captcha-controller
[ucr-3c]: ./UI_CLIENT_RUNTIME.md#3c-resumable-scopes
[ucr-5]: ./UI_CLIENT_RUNTIME.md#5-never-use-uiclient-in-an-ssr-context
[ui-readme]: ../src/ui/README.md
