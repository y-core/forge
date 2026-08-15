# `@y-core/forge/ui`

Source-distributed UI primitives for forge apps. Every component is a thin wrapper over a native element with default
Tailwind styling, predictable prop pass-through, and explicit composition. Field state and icon sprites are owned
through composition, not configuration.

> **Architecture reference:** the SSR-vs-client split, the island pattern, field binding and the
> colour-scheme contract are owned by
> [`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md),
> [`UI_CLIENT_RUNTIME.md`](../../.decisions/implementation/UI_CLIENT_RUNTIME.md) and
> [`THEME_GENERATION.md`](../../.decisions/implementation/THEME_GENERATION.md).

| Sub-path | What it is |
|---|---|
| [`ui/core`](#y-coreforgeuicore) | Server-rendered JSX component library |
| [`ui/core/client`](#y-coreforgeuicoreclient) | The scopes `ui/core` markup names (side-effect import) |
| [`ui/controls`](#y-coreforgeuicontrols) | Pre-bound signal-binding wrappers over `ui/core` |
| [`ui/contracts`](#y-coreforgeuicontracts) | The DOM contract both halves write, as pure data |
| [`ui/contracts/theme`](#y-coreforgeuicontractstheme) | Colour-scheme generation and the audited contrast pairs |
| [`ui/assets`](#y-coreforgeuiassets) | Forge's self-owned icon asset manifest |
| [`ui/assets/glyphs`](#y-coreforgeuiassetsglyphs) | Browser-safe sprite glyph parser |
| [`ui/assets/css/*.css`](#the-stylesheet) | The entry stylesheet and the optional themes (a subpath **pattern**) |
| [`ui/client`](#y-coreforgeuiclient) | Browser controllers, signals, and the island runtime |
| [`ui/client/htmx`](#y-coreforgeuiclienthtmx) | The pinned HTMX bundle (side-effect import) |
| [`ui/server`](#y-coreforgeuiserver) | SSR-only Flash and Resumable |
| [`ui/chrome`](#y-coreforgeuichrome) | SSR Navbar, Toolbar, ThemeToggle + theme constants |
| [`ui/chrome/client`](#y-coreforgeuichromeclient) | The chrome scopes island (side-effect import) |
| [`ui/show`](#y-coreforgeuishow) | Component showcase and theme customiser route helpers |
| [`ui/show/client`](#y-coreforgeuishowclient) | The showcase's scopes island (side-effect import) |
| [`ui/design/*.md`](#design-guidance) | The design corpus as markdown (a subpath **pattern**) |

---

## Prerequisites

forge ships TypeScript/TSX **source** — no build step, no emitted `.d.ts`. Consuming any component needs a
TypeScript-aware bundler (esbuild, Bun, Vite, or Wrangler) configured with `"jsx": "react-jsx"` and
`"jsxImportSource": "@y-core/forge/jsx"`. Each forge `.tsx` file also self-declares the runtime with a
`/** @jsxImportSource @y-core/forge/jsx */` pragma, so per-file overrides are unnecessary.

### The stylesheet

Components are Tailwind utilities over semantic tokens, so an app needs both the tokens and the generated rules for
the classes those components emit. One import supplies both:

```css
@import "tailwindcss";
@import "@y-core/forge/ui/assets/css/forge.css";
```

Tailwind v4's content scan ignores `node_modules`, so `forge.css` carries an `@source` path for every directory under
`src/ui/` whose files declare a utility class — resolved relative to itself, the only form that survives pnpm, a
workspace, a git dependency and a monorepo alike. Read `forge.css` for the current list; the gate's
`validate-css-sources` step enforces that scope in both directions.

An app that mounts [`ui/show`](#y-coreforgeuishow) adds one line of its own — the showcase is demo markup, so its
utilities are opt-in:

```css
@source "../../node_modules/@y-core/forge/src/ui/show";
```

**`forge.css` scans `ui/` and nothing else.** Other namespaces ship server-rendered markup whose classes are the app's
to scan; each says so in its own README where it applies.

### Themes and schemes

`theme-neutral.css` is the default scheme and `forge.css` imports it, so forge renders correctly with no theme file of
your own. Three alternatives ship beside it — `theme-stone.css` (warm), `theme-gray.css` (cool) and `theme-slate.css`
(strongly cool) — each `@import`ed *after* `forge.css`. Tailwind's ramp named `gray` is blue-tinted, so
`theme-gray.css` is the cool scheme and `theme-neutral.css` the achromatic one; the names invite the opposite reading.

A scheme file re-declares `--gray-1` … `--gray-12` in one `:root` block and **nothing else** — every semantic token
resolves through those steps. A step whose value differs by mode is written with `light-dark()` and the branch is
selected by `color-scheme`, which `theme-base.css` sets; a step that is the same colour in both modes is written bare.
Author your own the same way, after the forge imports. To re-point a single token instead — a brand hue is
`--primary`, not `--accent` — declare it once; it then applies in **both** modes, so anything that must differ by mode
is a *step* override, and steps carrying text or a control boundary have measured contrast behind them. The
one-declaration-site rule is [`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §5; the
ramps, dials and audited pairs are [`ui/contracts/theme`](#y-coreforgeuicontractstheme)'s.

**Status colours are tokens, not palette utilities.** `Alert`, `Toast`, `Badge` and the banners `@y-core/forge/http`
renders take their colour from a `--status-*` family — four intents (`danger`, `warning`, `success`, `info`) by five
roles (`-subtle`, `-subtle-foreground`, `-strong`, `-strong-foreground`, `-border`), each bridged to a Tailwind
utility such as `bg-status-danger-subtle`. They are deliberately separate from `--destructive` / `--success` /
`--warning`, which are fills your app owns
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §5c).

**Component rules sit in `@layer components`**, so a utility passed at the call site wins over a component default —
`<Dialog class="max-w-sm">` narrows the dialog, as it reads. The consequence runs the other way too: a rule your app
puts in `@layer components` loses to every forge utility in `@layer utilities`, whatever its specificity, so declare
`@layer app;` *after* the forge imports and put your chrome rules there.

### Dark mode

Forge's colours are custom properties whose mode `.dark` on `<html>` selects, so **every forge component works in dark
mode with no extra setup** and forge's own source contains no `dark:` utility. `forge.css` redefines the `dark:`
variant to follow that class rather than `prefers-color-scheme` — a takeover that reconfigures **your** `dark:`
utilities too. The consumer-facing account, including how to get the media query back, is
[MIGRATION.md](../../MIGRATION.md); the ruling is
[`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §5d.

---

## Design guidance

A pure-markdown **design corpus** ships inside this package at `src/ui/design/`. The boundary between it and this
README is one sentence: **this README says how to call a component; the corpus says which one to reach for, and what
good looks like once it is composed.** It is already sitting in `node_modules`, so point a Claude Code skills
directory at `node_modules/@y-core/forge/src/ui/design` (`SKILL.md` is the entry) or read the harness-neutral
`src/ui/design/index.md`, which carries the same routing table; every file it routes to is reachable through the
`./ui/design/*.md` subpath. **Load `src/ui/design/floor.md` before any UI work** — it is the only unconditional file;
`catalog.md` answers which component fits a job, and `reference/` holds one file per design dimension. The tier scheme
and rule identifiers are [`UI_DESIGN_GUIDANCE.md`](../../.decisions/implementation/UI_DESIGN_GUIDANCE.md)'s.

---

## `@y-core/forge/ui/core`

> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`

### Attribute pass-through contract

Every component forwards **unrecognized props** — including arbitrary `data-*` and `aria-*` — onto its root (or
designated inner) element, so client-side binding conventions attach without re-wrapping. Two renderer rules apply
([`src/jsx/render-to-string.ts`](../jsx/render-to-string.ts)): values are HTML-escaped and URL-bearing attributes
additionally scheme-sanitized via `safeUrl`; `style` is **dropped**, because forge's CSP carries no
`style-src 'unsafe-inline'` ([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §1a).

### Usage

```tsx
import { Button, Form, FormField, Input } from "@y-core/forge/ui/core";

<Form hx-post="/api/contact" hx-target="#contact-result">
  <FormField name="name" invalid={Boolean(errors.name)}>
    <FormField.Label name="name">Your name</FormField.Label>
    <Input name="name" field={{ name: "name", invalid: Boolean(errors.name) }} required />
    {errors.name && <FormField.Error name="name">{errors.name}</FormField.Error>}
  </FormField>
  <Button type="submit" variant="primary">Send message</Button>
</Form>
```

Render trees inside a route handler with `renderToString` (`@y-core/forge/jsx`) and return them through
`fragmentResponse` or `htmlResponse` (`@y-core/forge/http`).

### Exports

| Export | Renders | Notes |
|---|---|---|
| `Form` | `<form>` | HTMX attributes pass through; no client submission logic. Renders **no honeypot** — compose `Honeypot` yourself. |
| `Honeypot` | off-screen `<input>` | Decoy field paired with `isHoneypotFilled` (`@y-core/forge/form`). `field` defaults to `HONEYPOT_FIELD_DEFAULT`. Mutation forms only. |
| `FormField` | `<fieldset>` | Accessible field with `name` / `invalid` / `disabled`. Compounds: `.Label`, `.Description`, `.Error`, `.Set`, `.Legend`, `.Group`, `.Content`, `.Title`, `.Separator`. |
| `Field` | layout row | Lightweight label + control row — no form semantics. `orientation` is `"vertical"` (default) or `"horizontal"`. |
| `Input`, `Textarea`, `Select` | `<input>` / `<textarea>` / `<select>` | Accept an optional `field` descriptor to wire `id` / `name` / `aria-*`. `Select` requires an `icon` prop (a `ForgeIcon<"chevron-down">`) and compounds `.Option`, `.OptGroup`. |
| `Button` | `<button>` | `variant`: `"primary" \| "secondary" \| "ghost" \| "destructive"`; `size`: `"sm" \| "md" \| "lg" \| "icon" \| "icon-sm" \| "square"`. `asChild` renders onto a single element child instead. |
| `Alert` | `<div role="alert">` | `variant`: `AlertVariant`. Compounds: `.Title`, `.Description`. |
| `Card` | bordered container | Compounds: `.Header`, `.Title`, `.Description`, `.Action`, `.Content`, `.Footer`. |
| `Toast` | notification | `variant`: `ToastVariant`; `position`: `ToastPosition`. Compounds: `.Title`, `.Description`, `.Container`. |
| `Badge` | `<span>` | `variant`: `BadgeVariant`. |
| `Avatar` | avatar | Compounds: `Avatar.Image` (requires `alt`), `Avatar.Fallback`. |
| `Switch`, `Slider` | styled `<input>` | CSS-only toggle / native range; accept an optional `field`. `Switch`'s `orientation` (`"label-before"` / `"label-after"`) publishes `data-label-position`. A `Slider` with an `<output>` readout stamps the `slider` scope. |
| `ToggleGroup`, `ToggleGroup.Item` | `<fieldset>` of buttons | Segmented control. `type`: `"single" \| "multiple"`, published as `data-multiple`. `Item` takes `pressed`. **No `role`** — a `<fieldset>` is already a `group`. |
| `Toggle` | `<button aria-pressed>` | A single two-state pressable button. `pressed` for initial state. |
| `Toolbar` | `<div role="toolbar">` | One tab stop, arrow-key navigation. Compounds: `.Button`, `.Link`, `.Input`, `.Group`, `.Separator`. Items carry `data-toolbar-item`; a foreign element opts in by carrying it. |
| `Menu` | native popover, `role="menu"` | Trigger + popup on the Popover and Invoker Commands APIs — open, close, light-dismiss and Escape need no JavaScript. Compounds: `.Trigger`, `.Popup`, `.Item`, `.LinkItem`, `.SubmenuTrigger`, `.CheckboxItem`, `.RadioItem`, `.Group`, `.GroupLabel`, `.Separator`. |
| `Tabs` | tablist + panels | `orientation`; `activation`: `"automatic" \| "manual"`. Compounds: `.List`, `.Tab`, `.Panel`. An unselected panel is `hidden`, so the first render is correct with no JS. |
| `Collapsible` | native `<details>` | Compounds: `.Trigger`, `.Panel`. `<details>` owns open and closed. |
| `Accordion` | stack of `<details>` | Compounds: `.Item`, `.Trigger`, `.Content`. Each item is its own disclosure and its own tab stop. |
| `Tooltip` | `popover="hint"` | Compounds: `.Trigger`, `.Content`. A hint does not dismiss the `auto` popover beneath it. |
| `CheckboxGroup`, `RadioGroup` | `<fieldset>` of native inputs | Real `<input type="checkbox">` / `<input type="radio">`; radio grouping and roving focus are the platform's. Compounds on each: `.Label`, `.Item`, `.Description`, `.Error`. `scope` must be repeated on every `.Item`, since each derives its own id from `name`, `scope` and its `value`. |
| `Meter` | `<meter>` | A measurement in a known range — distinct from `Progress`, which is task completion. Compounds: `.Label`, `.Value`, `.Track`. |
| `NumberField` | numeric `<input>` + steppers | `min` / `max` / `step` enforced natively via `stepUp` / `stepDown`. Compounds: `.Input`, `.Increment`, `.Decrement`. |
| `ScrollArea` | scroll container | Almost entirely CSS — no scroll hijacking, no synthetic thumb. Compound: `.Viewport`. |
| `Dialog` | native `<dialog>` | Compounds: `.Trigger`, `.Close`, `.Header`, `.Body`, `.Footer`. Top layer, backdrop and Escape are the platform's. `openModal` centres in the viewport; `open` is the platform's non-modal mode and flows inline. |
| `Popover` | native popover | Compounds: `.Trigger`, `.Content`. Stamps `POPOVER_SCOPE`, so its invokers' `aria-expanded` is maintained. |
| `Progress`, `Separator`, `Skeleton`, `Spinner`, `Label` | misc primitives | `Spinner` requires an `icon` prop; its `size` is `"sm" \| "md" \| "lg"`. |
| `Turnstile` | CAPTCHA mount point | See below. |
| `Icon`, `createIcon` | `<svg><use>` | Sprite-backed icon and its factory. |
| `cn`, `asClass`, `cva` | class utilities | Class merging, `class`-prop narrowing, and class-variance authority. |
| `buttonVariants` | cva function | `Button`'s own variant resolver, for markup that must wear the button classes without being one. |
| `fieldId`, `fieldDescriptionId`, `fieldErrorId`, `fieldDescribedBy`, `fieldControlProps`, `FIELD_LABEL_CLASSES` | field helpers | See below. |

Components that need a keyboard — `Toolbar`, `Menu`, `Tabs`, `Tooltip`, `NumberField`, `ToggleGroup`, a modal
`Dialog`, a `Popover.Content`, a readout `Slider` — render a `data-scope` and are inert until
`@y-core/forge/ui/core/client` is imported: the markup stays valid and accessible, but the arrow keys are missing.

**Types:** `AlertVariant`, `BadgeVariant`, `ToastVariant`, `ToastPosition`, `ToggleGroupType`, `ButtonProps`,
`ButtonSize`, `FieldDescriptor`, `FieldDescribedByOptions`, `ForgeIcon<Name>`, `IconProps`, `TurnstileProps`.

### `FormField` — accessible form fields

`FormField`'s compound members auto-wire `for` / `id` / `aria-describedby` from the field `name` via the ID helpers —
pass the same `name` to each member.

| Helper | Returns |
|---|---|
| `fieldId(name, scope?)` | `field-${name}` — the control ID; `field-${scope}-${name}` when scoped |
| `fieldDescriptionId(name, scope?)` | the control ID plus `-description` |
| `fieldErrorId(name, scope?)` | the control ID plus `-error` |
| `fieldDescribedBy(name, opts)` | the `aria-describedby` value, or `undefined` when nothing to point at renders |
| `fieldControlProps(props, field)` | merges a `FieldDescriptor` into control props — what `Input` / `Select` / `Textarea` call internally |
| `FIELD_LABEL_CLASSES` | the shared label class string |

**`scope` separates two fields that share a `name` on one page**, and is caller-opt-in because deriving one
automatically would need module-level mutable state
([`PRODUCTION_TS_RULES.md`](../../.decisions/governance/PRODUCTION_TS_RULES.md) §1). **`description` declares that a
description element actually renders** and defaults to `false`, so `aria-describedby` is emitted only when something
really describes the field. A blank or whitespace-bearing `name` or `scope` derives no wiring at all, while the `name`
**attribute** still renders exactly as given
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §1j). `FormField.Error` renders
nothing when its child is `null`, `false` or empty; `CheckboxGroup` and `RadioGroup` share `.Description` and `.Error`
with it. Use `Field` for settings rows and labelled controls that are **not** validated form fields.

### `Button` — `asChild`

`asChild` merges the button's classes and forwarded props onto a single JSX element child via `cloneElement` instead
of rendering a `<button>` — `<Button asChild variant="ghost"><a href="/docs">Docs</a></Button>`. It requires **exactly
one JSX element child**; a string, number, fragment, array or empty child is a programming error and `Button`
**throws** rather than silently degrading.

### Icons — `createIcon`

`Select`, `Spinner`, and the chrome `ThemeToggle` / `Navbar` / `Toolbar` take an `icon` prop typed `ForgeIcon<Name>`.
Bind the sprite once with `createIcon("/assets/icons.svg")`; without a `meta` map that yields a permissive
`ForgeIcon<string>`, assignable to any narrower `ForgeIcon<Name>` by contravariance, so one `AppIcon` satisfies every
call site. An icon is decorative by default (`aria-hidden="true"`); pass `aria-label` and the `<svg>` emits
`role="img"` with that label instead.

### `cn`, `asClass`, and `cva`

`cn(...classes)` is variadic over `string | false | null | undefined` — it drops falsy entries, resolves conflicting
Tailwind utilities in favour of the later argument, and joins the rest with a space. `cn("h-full", "h-5")` is `"h-5"`;
`cn("h-full", "hover:h-5")` keeps both, because a modifier is part of the conflict key. Utilities outside forge's
conflict table pass through untouched ([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md)
§3d). `asClass(cls)` narrows an untyped JSX `class` prop to `string | undefined`. `cva(config)` builds a variant
function from `{ base?, variants?, defaultVariants? }`, callable with a variant map plus an optional `class` override
that composes last through `cn`:

```tsx
<button class={cn(button({ variant: "primary" }), asClass(className), isLoading && "opacity-50")}>Click</button>
```

### `Turnstile` — server-rendered CAPTCHA mount point

`Turnstile` renders a `[data-ref='turnstile']` container (with `data-sitekey` / `data-size`) holding a hidden fallback
alert. Place it **inside** the `<form>` so the token input Cloudflare injects is submitted with it; nothing else is
required, because the container stamps `TURNSTILE_SCOPE` and `resume()` mounts the controller.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `siteKey` | `string` | — | Required; injected server-side from the Worker env, never hardcoded. |
| `size` | `"compact" \| "flexible" \| "normal"` | `"normal"` | Widget size hint (`data-size`). |
| `children` | `JSXNode` | generic prompt | Optional; overrides the default hidden fallback message. |

---

## `@y-core/forge/ui/core/client`

> Import path: `@y-core/forge/ui/core/client` → `src/ui/core/client.ts`
> **Browser-only, side-effect import.** esbuild entry points only. No exports.

```typescript
// src/client/main.ts (esbuild entry point) — every island is imported this way:
import "@y-core/forge/ui/core/client";   // side-effect: registers the scopes
import { resume } from "@y-core/forge/ui/client";

resume();
```

**This import is not optional if the app renders any scoped component.** Without it the components render correctly
but never behave, and `resume()` `console.warn`s about the unregistered `data-scope` — silent in the markup, loud only
in the console.

| Scope | Contract |
|---|---|
| `toast` | `eager: true`. State key `duration` (ms, serialized by `Toast`); a positive value schedules removal on the toast's own realm clock. One action, `dismiss`, which removes the toast root. |
| `alert` | Lazy. No state. One action, `dismiss`, which removes the alert root. |
| `toolbar` | `eager`. Roving focus over `[data-toolbar-item]`, reading the root's `data-orientation`, plus its triggers' expanded state. |
| `menu` | `eager`. The popup's keyboard layer: roving focus with typeahead, ArrowRight/ArrowLeft into and out of a submenu, and focus returned to the opener on close. |
| `popover` | `eager`. Maintains each invoker's `aria-expanded` against the popup it names. |
| `tabs` | `eager`. Selection, panel visibility and roving focus over the tablist. |
| `tooltip` | `eager`. Hover and focus intent on a `popover="hint"` surface. |
| `toggle-group` | `eager`. The roving focus a checkbox group lacks, over `TOGGLE_GROUP_ITEM_SELECTOR`. |
| `number-field` | `eager`. Wires the steppers to the input's native `stepUp` / `stepDown`. |
| `slider` | Lazy. One action, `sync`, which writes the `<output>` readout from the input. |
| `dialog` | `eager`. Opens a `[data-open-modal]` dialog with `showModal()` on resume. |
| `turnstile` | `eager`, and the scope root *is* the widget. `setup` mounts the CAPTCHA controller on it ([`UI_CLIENT_RUNTIME.md`](../../.decisions/implementation/UI_CLIENT_RUNTIME.md) §2c). |

`toast` and `alert` remove their own root, so there is nothing to tear down. **Every other scope here is `eager` out
of necessity, not preference:** its markup carries no `data-on-*` action, so a lazy scope would have nothing that
could ever resume it.

---

## `@y-core/forge/ui/controls`

> Import path: `@y-core/forge/ui/controls` → `src/ui/controls/mod.ts`

Pre-bound wrappers over the `ui/core` primitives — the "bound decoration" layer. Each mirrors its `ui/core` sibling in
name and prop shape, adding a required `bind` prop (`data-field`) and an optional `action` prop (`data-on-<event>`
value). This static barrel is the **only** bound-control API; there is no runtime factory
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §2c). Alias on import to disambiguate
when a bound control and its primitive are both in scope.

### Usage

```tsx
import { Slider, Switch } from "@y-core/forge/ui/controls";
import { bindControls, registerScope, signalRecord } from "@y-core/forge/ui/client";
import { Resumable } from "@y-core/forge/ui/server";

// Server:
<Resumable name="chrome" state={settings}>
  <Switch bind="gridVisible" checked={settings.gridVisible}>Grid</Switch>
  <Slider bind="fov" min={1} max={120} value={settings.fov} output />
</Resumable>

// Client:
const sig = signalRecord(settings);
registerScope("chrome", { eager: true, setup: ({ root }) => bindControls(root, sig) });
```

### Exports

| Export | Wraps | Binding |
|---|---|---|
| `Input` | `core/Input` | `bind` → `data-field` |
| `Textarea` | `core/Textarea` | `bind` → `data-field` |
| `Switch` | `core/Switch` | `bind` → `data-field` |
| `Slider` | `core/Slider` | `bind` → `data-field` |
| `Select` | `core/Select` | `bind` → `data-field`; forwards required `icon`; re-exports `.Option`, `.OptGroup` |
| `ToggleGroup` | `core/ToggleGroup` | Bespoke: pass-through root; `.Item` adds `bind` → `data-field`, `value` → `data-value` |

**No control stamps a `data-on-*` action.** `bindControls` listens once on the scope root, so a bound control's markup
names its field and nothing else — which is why the scope must be `eager: true`. **`bind` vs `field`:** `field` wires
`id` / `name` / `aria-*` for form accessibility, `bind` wires `data-field` for signal binding, and both may coexist.
`ToggleGroup.Item`'s required `value` is stamped as `data-value`, which is how `bindControls` tells one member from
another.

---

## `@y-core/forge/ui/contracts`

> Import path: `@y-core/forge/ui/contracts` → `src/ui/contracts/mod.ts`
> **Runtime-neutral.** Pure data and pure functions — no DOM, no Node built-ins, no side effects.

The names forge's SSR components and its browser controllers **both** write, declared once so they cannot drift. They
are published rather than internal because an app consuming forge's components addresses the same DOM, and its only
other option is to re-type each name as a string literal in a repository forge's gate cannot see. **Import the
modules, not the barrel, in code you bundle** — forge's own components import each module directly, so a bundle
retains one table rather than fifteen.

### Exports

| Export | Kind | Description |
|---|---|---|
| `STATE_ATTRS` | const | Every state attribute forge emits, keyed by state name. A component emitting one outside the table fails a conformance test. |
| `stateAttrs(state)` | function | Builds the attributes for an SSR element: `<div {...stateAttrs({ selected, side, align })}>`. A falsy presence state emits nothing. |
| `applyStateAttrs(el, state)` | function | The browser half. Only keys present in `state` are touched, and a touched key is reconciled in full. |
| `StateAttrName`, `StateAttrsProps` | types | One declared attribute name, and the states a component may declare. |
| `Orientation`, `Side`, `Align` | types | Layout axis (`responsive` = vertical until wide enough), popup side (physical or logical spelling), popup alignment. |
| `SCOPE_EVENTS` | const tuple | `["click", "input", "change", "submit"]` — the events a resumable scope delegates on. **There is no `keydown`, by decision:** a composite controller owns keyboard at its own widget root. |
| `ScopeEvent` | type | One of the delegated events. |
| `scopeAttrs(props)`, `ScopeAttrsProps` | function, type | Typed `data-on-<event>` delegation attributes for a scope, keyed by action name. |
| `BIND_TEXT_ATTR`, `bindTextAttr(field)` | const, function | Names an element's text content as a view of one signal, and builds the attribute. |
| `BIND_ATTR_ATTR`, `bindAttrAttr(attr, field)` | const, function | Names one attribute as a view of one signal, spelled `attribute:field`. |
| `parseBindAttr(value)` | function | Splits a `data-bind-attr` value into `{ attribute, field }`, or `null` when malformed. |
| `ACTIVE_COMPOSITE_ITEM` | const | Marks which item of a roving-focus composite holds the tab stop on mount. |
| `MENU_SCOPE`, `MENU_ITEM_SELECTOR`, `MENU_RADIO_SELECTOR`, `MENU_GROUP_SELECTOR` | const | The Menu popup's scope, and its rows **by ARIA role** rather than a forge marker — so a row built in the browser is navigable the moment it is correctly roled. |
| `MENU_ITEM_CLASS`, `menuItemAttrs(opts)`, `MenuItemAttrsOptions`, `MenuAction` | const, function, types | The class every menu row wears, every attribute a client-built row needs (the element must be a `<button>`), and the actions a checkable row names. |
| `TOOLBAR_SCOPE`, `TOOLBAR_ITEM_ATTR`, `TOOLBAR_ITEM_SELECTOR` | const | The Toolbar root's scope and its roving-focus stop marker — an explicit marker, because `Toolbar.Group` and `Toolbar.Separator` are toolbar slots that must **not** be focus stops. |
| `TABS_SCOPE`, `TAB_SELECTOR`, `TABLIST_SELECTOR`, `TABS_MOUNTED_ATTR` | const | Tabs' scope, its two role selectors, and the marker retiring the `:target` fallback once the controller mounts. |
| `TOGGLE_GROUP_SCOPE`, `TOGGLE_GROUP_ITEM_SELECTOR` | const | The ToggleGroup scope, and the focusable element inside each `.Item`. |
| `TOOLTIP_SCOPE`, `TOOLTIP_MOUNTED_ATTR` | const | The Tooltip scope, and the marker retiring the CSS-only hover fallback. |
| `DIALOG_SCOPE`, `DIALOG_OPEN_MODAL_ATTR` | const | The Dialog scope, and the marker for a dialog the client opens with `showModal()`. |
| `POPOVER_SCOPE`, `POPOVER_COORDS_ATTR`, `ANCHOR_X_PROPERTY`, `ANCHOR_Y_PROPERTY`, `invokerAttrs(id)` | const, function | The Popover scope, the marker for a coordinate-placed popup, the two custom properties `openPopoverAt` writes, and an invoker's SSR expanded-state attributes. |
| `SLIDER_SCOPE`, `SliderAction` | const, type | The scope a readout `Slider` stamps, and the action its input names. |
| `NUMBER_FIELD_SCOPE` | const | The NumberField root's scope. |
| `NAVBAR_FILTERS_EVENT` | const | The document event the `navbar` scope listens for to re-sync its auth filters — dispatch it with the new token array as `detail`. |
| `TURNSTILE`, `TURNSTILE_SCOPE`, `TURNSTILE_SCRIPT_SRC`, `TURNSTILE_SCRIPT_TIMEOUT_MS` | const | The `data-ref` values, the scope name, the script URL and the load budget shared by `<Turnstile>` and its controller. |

**Boolean states are emitted by presence with an empty value — `data-selected=""`, never `"true"`;** `aria-*` keeps
its string form because WAI-ARIA requires it
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §4a/§4b). **Open state is deliberately
absent:** `Dialog`, `Popover`, `Accordion` and `Collapsible` are native, so `[open]` and `:popover-open` are the
platform's and forge neither mirrors nor republishes them. Consuming apps and their tests should match that grammar —
assert on presence (`toHaveAttribute("data-selected", "")`) and on the platform's own state.

---

## `@y-core/forge/ui/contracts/theme`

> Import path: `@y-core/forge/ui/contracts/theme` → `src/ui/contracts/theme/mod.ts`
> **Runtime-neutral.** Pure data and pure functions — safe in a Worker, a browser bundle, or a
> build script.

The colour model a forge scheme is generated from, and the contrast audit the gate and the theme customiser share. It
sits in `ui/contracts` because three consumers read the same declarations: the customiser page, the gate's contrast
check ([`config/steps.ts`](../../config/steps.ts)), and the scheme files. Chroma travels in **thousandths** through
`DIALS` and `DialValues`, and `buildTheme` converts; a dial's own range is on its `Dial` record, so a reader clamps
against the declaration. The generation pipeline is
[`THEME_GENERATION.md`](../../.decisions/implementation/THEME_GENERATION.md)'s.

```typescript
const theme = buildTheme(dials);   // both families, both modes
const css = schemeCss(theme, dials);  // a paste-ready theme-*.css
const ratios = liveRatios(theme);     // every audited pair, measured
```

### Exports

Declared across [`color.ts`](./contracts/theme/color.ts), [`contrast-pairs.ts`](./contracts/theme/contrast-pairs.ts),
[`contrast-accepted.ts`](./contracts/theme/contrast-accepted.ts) and
[`theme-contract.ts`](./contracts/theme/theme-contract.ts).

| Export | Kind | Description |
|---|---|---|
| `Mode` | type | `"light" \| "dark"` — the two blocks a scheme file declares. |
| `Scale<T>` | type | A twelve-position scale, as a tuple rather than an array. |
| `Oklch` | type | A colour in OKLCh: lightness 0–1, chroma, hue in degrees. |
| `Ramp` | type | The fixed half of a scale — per-step lightness, and per-step chroma as weights in 0–1. |
| `Dials` | type | The two free parameters: `hue` in degrees, `chroma` as the ramp's **peak**. |
| `ScaleFamily` | type | `"gray" \| "accent"` — the two scales a generated scheme declares. |
| `GRAY_RAMP` | const | The neutral scale's lightness, and the tint shape every scheme applies over it, per mode. |
| `ACCENT_RAMP` | const | The accent scale's lightness, and the chroma shape a scheme's accent dials apply over it. |
| `CHROMA_MAX` | const | The highest peak chroma each family's dial reaches. |
| `buildScale(ramp, dials)` | function | Twelve hex steps: the ramp's fixed lightness, its shape scaled by the chroma dial, at one hue. |
| `toSrgbGamut(l, c, h)` | function | The nearest OKLCh coordinate sRGB can represent, reached by reducing chroma alone. |
| `oklchCss(color)` | function | An OKLCh coordinate as the `oklch()` a scheme file carries. |
| `oklchToHex(l, c, h)` / `hexToOklch(hex)` | function | The two directions; hue is noise as chroma nears zero. |
| `relativeLuminance(hex)` | function | WCAG relative luminance of a `#rrggbb` colour. |
| `contrastRatio(a, b)` | function | The order-independent WCAG contrast ratio between two opaque `#rrggbb` colours, 1–21. |
| `CONTRAST_PAIRS` | const | Every foreground/background token pair forge measures, with the criterion each is bound by. |
| `ContrastPair`, `ContrastSide` | types | One audited pair, and one side of it. |
| `Criterion`, `CRITERION` | type, const | `"1.4.3" \| "1.4.11"`, and each criterion's floor and title. |
| `ScaleSide`, `ScalePair`, `scalePairs()` | type, type, function | A side — and a pair — resolvable on a generated scale, and the narrowed subset. |
| `SideStep`, `sideStep(side, mode)` | type, function | A step index, or one per mode where the token re-points, and the step a side resolves to in one mode. |
| `ACCENT_CONTRAST` | const | `--accent-contrast`: the gray ramp's first step in light and its last in dark, one token either way. |
| `ACCEPTED_CONTRAST`, `AcceptedContrastRow` | const, type | The decorative pairs WCAG 1.4.11 does not bind, each pinned at its measured value with a mandatory reason. |
| `DIALS`, `Dial`, `DialValues` | const, type, type | The five levers in render order, one lever's declaration (what it writes, what it is called, where it may travel), and every dial's value keyed by field. |
| `leverRows(dials?)` | function | Groups `DIALS` into rows: consecutive dials sharing a `group` ride one row. |
| `dialQuery(dials)` | function | The dials as a query string — the customiser's whole state, so a scheme is shareable as a link. |
| `buildTheme(dials)` | function | Both families in both modes — everything a scheme declares, from the five numbers. |
| `GeneratedTheme` | type | What `buildTheme` produces. |
| `schemeCss(theme, dials)` | function | The scheme as a `theme-*.css` file, ready to paste and standalone-complete. |
| `scaleVars(family, scales)` | function | One family's twelve declarations as `[property, value]` pairs, each already mode-complete. |
| `stepProperty(family, step)` | function | The custom property a 0-indexed step is declared under — `--gray-11`. |
| `lightDark(light, dark)` | function | One value covering both modes, collapsed to a bare value where the two agree. |
| `RADIUS_PROPERTY` | const | `--radius`, which the customiser drives directly rather than through a scale. |
| `SCHEME_PRESETS`, `SchemePreset`, `matchPreset(dials)`, `PRESET_FIELDS` | const, type, function, const | The four shipped schemes as dial positions, the shipped scheme a set of dials reproduces (or `undefined` between presets), and the only fields the picker drives. |
| `PRESET_PARAM`, `PRESET_ACTION`, `PRESET_CUSTOM` | const | The input-only query parameter a preset travels under (an explicit `gh`/`gc` beside it wins), the scope action a pick fires, and the option value standing for "no shipped scheme reproduces these dials". |
| `liveRatios(theme)`, `LiveRatio`, `ratioKey(token, bg, mode)` | function, type, function | Every audited pair a generated scheme can actually be measured on, in both modes; one computed cell; and the `data-ratio` value that cell carries. |
| `SCALE_ROWS`, `SCALE_ROW_ATTR`, `STEP_SEGMENTS`, `HEX_ATTR` | const | The four preview rows (each generated scale on the surface it belongs to), the attribute marking one, the five bands the twelve steps are drawn under, and the attribute on a printed hex. |
| `CUSTOMISE_SCOPE`, `COPY_SCOPE`, `COPY_ACTION`, `COPY_TARGETS`, `CopyTarget` | const, type | The lever panel's scope, the output block's scope, the action every copy button fires, and the copy controls with the element each reads. |
| `COPY_TARGET_ATTR`, `COPY_LABEL_ATTR`, `COPY_STATUS_ATTR`, `COPY_CONFIRM_MS` | const | A copy button's target id, its swappable label span, its `role='status'` span, and how long it reads "Copied". |

---

## `@y-core/forge/ui/assets`

> Import path: `@y-core/forge/ui/assets` → `src/ui/assets/mod.ts`

Forge owns all of its UI glyphs — `spinner`, `chevron-down`, `hamburger`, `close`, `panel-open`, `panel-close` in `src/ui/assets/core/`, plus
`sun`, `moon`, `monitor` in `src/ui/assets/theme/` — and the manifest exposes them as a `SpriteSource[]`, so a
consumer's build config never hand-lists forge's internal filenames:
`defineAssets({ spriteSources: [...forgeUiSpriteSources(), myOwnSprites] })`.

| Export | Kind | Description |
|---|---|---|
| `forgeUiSpriteSources()` | function | `SpriteSource[]` for every forge UI glyph, with absolute paths resolved via `import.meta.url`. |
| `FORGE_UI_ICON_NAMES` | const tuple | The glyph names as a `readonly` tuple — use for type narrowing or validation. |
| `ForgeUiIconName` | type | The union of those names. |
| `parseSpriteGlyphs`, `loadSpriteGlyphs` | functions | Re-exported from `ui/assets/glyphs` — import them from the direct subpath in client code. |

---

## `@y-core/forge/ui/assets/glyphs`

> Import path: `@y-core/forge/ui/assets/glyphs` → `src/ui/assets/glyphs.ts`
> **Runtime-neutral.** No DOM and no Node built-ins. `loadSpriteGlyphs` needs a `fetch`.

Parses a build-generated SVG sprite into a name-keyed glyph map, so an app can read a glyph's `viewBox` and inner
markup at runtime — for a CSS custom cursor, an inline `<svg>`, or a canvas draw, none of which can use the
`<use href="#icon-…">` indirection a `ForgeIcon<Name>` renders. `await loadSpriteGlyphs("/assets/icons.svg")` returns
`{ [name]: { viewBox, markup } }`.

**Why this subpath exists.** Both functions are also re-exported from
[`@y-core/forge/ui/assets`](#y-coreforgeuiassets), whose barrel additionally exports `forgeUiSpriteSources()` — a
module importing `node:path` and `node:url`. Import the parser here in client code, and from `ui/assets` in build
config.

| Export | Signature | Description |
|---|---|---|
| `parseSpriteGlyphs(svgText, prefix?)` | `GlyphSource` | Parses sprite text into `{ [name]: { viewBox, markup } }`. Only `<symbol>` ids starting with `prefix` (default `"icon-"`) are included, keyed by the bare name. |
| `loadSpriteGlyphs(url, prefix?)` | `Promise<GlyphSource>` | Fetches `url` and parses it. |

**Both degrade to `{}` and never throw** — on empty input, unparseable markup, a non-`ok` response, or a network error
— because a missing glyph map must leave the app on its stylesheet default rather than break boot. **Types:**
`GlyphEntry` (`{ viewBox, markup }`), `GlyphSource`.

---

## `@y-core/forge/ui/client`

> Import path: `@y-core/forge/ui/client` → `src/ui/client/mod.ts`
> **Browser-only.** These exports reference `document` / `window` / `localStorage` and throw if
> imported in Worker-executed SSR code. Restrict imports to your client esbuild entry.

```typescript
import { resume } from "@y-core/forge/ui/client";

resume();   // install the delegated island listener, and hydrate every eager scope
```

Theme is **not** a controller here — it is a resumable scope registered by
[`@y-core/forge/ui/chrome/client`](#y-coreforgeuichromeclient).

### Exports

| Export | Kind | Description |
|---|---|---|
| `createSignal(initial)` | function | Reactive cell; reading `.value` inside an `effect`/`computed` subscribes. |
| `computed(fn)` | function | Derived read-only signal — lazy: its body runs on read, and only when a dependency has moved. |
| `effect(fn)` | function | Runs `fn` immediately, re-runs on change; returns a disposer. |
| `Signal`, `ReadonlySignal` | types | The writable and read-only cell shapes. |
| `signalRecord(initial)`, `writeSignal(rec, key, value)`, `SignalRecord` | function, function, type | One independent signal per key of `initial`, and the typed per-key writer. |
| `registerScope(name, def)`, `ScopeDefinition`, `ResumeContext` | function, types | Registers a scope's `setup` + `on` action map under a `data-scope` name. |
| `resume(within?)` | function | Installs the delegated listeners once per document — refcounted across calls — and runs the eager pass. Returns a disposer for the scopes *this* call resumed. |
| `resumeScope(root)` | function | Resumes a single scope element now; returns its signal state. |
| `bindControls(root, signals)` | function | Two-way-binds every `[data-field]` under one root to a `SignalRecord`. Returns a disposer. |
| `bindText(root, signals, opts?)`, `BindTextOptions` | function, type | Binds every `[data-bind-text]` under `root` to the signal it names. Returns a disposer. |
| `bindAttr(root, signals)` | function | Binds every `[data-bind-attr]` under `root` to the signal it names. Returns a disposer. |
| `ownerDocument(node)` / `ownerWindow(node)` | function | The document and window **that node belongs to**. |
| `activeElement(node)` | function | The *deeply* focused element, descending through open shadow roots. |
| `eventTarget(event)` | function | The element actually hit, via `composedPath()`, before shadow retargeting rewrote `event.target`. |
| `asElement(target)` | function | Narrows without `instanceof`, so an element from another realm is accepted rather than discarded. |
| `closestAcross(node, sel)` / `contains(parent, child)` / `queryAcross(root, sel)` | function | `closest`, `contains` and `querySelectorAll` that step over shadow boundaries. |
| `isRtl(el)` | function | Whether an element resolves to right-to-left writing direction. |
| `safeStorage(win)` | function | That realm's `localStorage`, or `null` — a private-mode `getItem` throws even though the property is present, so only a real access answers. |
| `openPopoverAt(el, x, y, opts?)`, `OpenPopoverAtOptions` | function, type | Opens a native popover at a viewport coordinate, clamped on screen. Returns a disposer. |
| `mountRovingFocus(root, opts)`, `RovingFocusOptions` | function, type | Makes a composite you render one tab stop with arrow-key navigation. Returns a disposer. |
| `mountScrollSpy(opts)`, `ScrollSpyOptions` | function, type | Marks the section being read on a fragment nav. Returns a disposer. |
| `mountViewportCollapse(opts?)`, `ViewportCollapseOptions` | function, type | Drives a `<details>` rail from a media query. Returns a disposer. |
| `lazy(opts)`, `LazyImportOptions` | function, type | Defers a dynamic import until its anchor element scrolls into view. Returns a disposer. |

Each option type's fields and defaults are declared beside its controller, in
[`client/scroll-spy.ts`](./client/scroll-spy.ts), [`client/viewport-collapse.ts`](./client/viewport-collapse.ts),
[`client/composite.ts`](./client/composite.ts), [`client/popover-anchor.ts`](./client/popover-anchor.ts),
[`client/bind-display.ts`](./client/bind-display.ts) and [`client/lazy.ts`](./client/lazy.ts).

### Signals

A write flushes the graph before it returns, so every dependent has already observed the settled value on the next
line. A `computed` derives on **read**, never on write: its body never runs if nothing reads it, and no reader can
observe a derived value assembled before one of its sources moved.

### Resumable islands

The server marks an interactive region with a `data-scope` name and serialized `data-state` (via `Resumable`); the
client registers the scope's handlers and installs one delegated listener. A scope resumes on the **first**
interaction with any descendant carrying a `data-on-<event>` attribute — `data-state` is rebuilt into signals, `setup`
runs once, then the named action fires.

```typescript
registerScope("counter", {
  setup: ({ root, state }) => {
    const out = root.querySelector("[data-ref='out']");
    effect(() => { if (out) out.textContent = String(state.count.value); });
  },
  on: { inc: ({ state }) => { (state.count.value as number)++; } },
});

resume(); // returns a disposer for the scopes this call resumed
```

**The effect above needs no disposer, and that is the contract, not an omission.** Every effect created while a
`setup` runs is owned by the runtime and disposed with the scope; a `setup` returns a disposer only for what the
runtime cannot see — listeners, observers, timers, controller handles — and it runs *after* the scope's effects are
disposed. An effect created in an `on` handler, or after an `await`, belongs to whoever created it.

### Field binding

Pair the SSR `fieldAttr` helper (from `@y-core/forge/ui/server`) with `bindControls` to two-way-bind every control
under a scope root to a `SignalRecord`, with no per-field wiring — one listener on the root, one effect per field. DOM
→ signal resolves the nearest `[data-field]` across shadow boundaries, absorbing a click that landed on an inner
`<svg>`, and infers the value's type from what the signal currently holds: `boolean` reads `checked`, `number` goes
through `Number()`, a `string[]` toggles membership of `data-value`, anything else is the string. Signal → DOM paints
`checked` / `value` and `aria-pressed` / `data-pressed`, guarded by a differs-check so a paint never fights a drag in
progress.

**The signal is the state and the DOM is a paint of it**, so `aria-pressed` is never read back — which is what lets a
repaint restore a group after its markup was replaced wholesale
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §2a). The scope must be `eager: true`,
since a bound control stamps no `data-on-*` action. A `data-field` naming no signal in the record reports and is
skipped. `bindText` and `bindAttr` are the one-way siblings, for markup that only *displays* a signal.

### Controller primitives

The global reflexes a controller may not reach for, and their node-resolved replacements. They are `@public` because
an app writing its own controller needs the same guarantees. Each reflex has a failure mode that is invisible in the
common case and total in the uncommon one:

| Reflex | What breaks |
|---|---|
| bare `document` / `window` | they name the **top-level** realm — a controller mounted in an iframe installs its listeners on a document its element is not in, and reads its platform constructors off a realm that need not have them |
| `event.target` | retargeted at a shadow boundary: for an event that crossed one it reports the **host**, not the element hit |
| `document.activeElement` | the same problem in reverse — it stops at the host and never reports the focused item inside an open shadow root |
| `instanceof HTMLElement` | `false` for an element from another realm, because every realm has its own constructor. It compiles, it type-narrows, and it rejects a perfectly good element |
| `document.getElementById` | searches the document only, and an id inside a shadow root is not in it — a `commandfor` or `aria-controls` naming a sibling in the same shadow tree resolves to `null` |
| bare `getComputedStyle` | the top-level window's again, and a *global* direction read cannot see that one subtree of an LTR page is RTL |

**Every controller returns a disposer, and that is a contract.** Return it from a scope's `setup` and `resume()`'s
teardown runs it. The runtime owns effects, not listeners, so a `setup`'s own disposer covers the controllers and
listeners it installed and never the effects it created.

**A platform constructor is read off the resolved window too**, for two reasons the obvious regression test cannot see
— intersection geometry is realm-*insensitive*, so mounting into an iframe and asserting the observer fires **passes
on a revert**. A realm **may not have the constructor at all**, and reading it off the resolved window doubles as the
feature check, so the controller degrades to a no-op disposer rather than throwing; and an observer, timer id or
media-query list held past the teardown of the realm that minted it is a **cross-realm retention**. Both are testable
by pruning the constructor from one realm and asserting which side notices. **Direction is resolved where it is
consumed, never cached at mount**, and **an id reference is resolved in the tree that declares it**, because ids do
not cross a shadow boundary.

### Coordinate placement — `openPopoverAt`

Every other popup in forge is positioned by CSS Anchor Positioning against its invoker. **A context menu has no
invoker** — it opens where a right-click landed — so every anchored rule resolves to nothing and the UA's `[popover]`
default centres the panel in the viewport. 
`openPopoverAt(menu, event.clientX, event.clientY, { afterPointerUp: event.buttons !== 0 })` is the whole call
from a `contextmenu` handler.

**`afterPointerUp` is not optional there**: the event fires *between* `pointerdown` and `pointerup`, and the platform
light-dismisses the menu on that trailing release, so it flashes and vanishes. Pass `event.buttons !== 0` rather than
`true` — a `contextmenu` raised from the keyboard reports no buttons and is followed by no release. The popup opts in
with `Menu.Popup`'s `coords` prop (or `POPOVER_COORDS_ATTR`); coordinates travel as `ANCHOR_X_PROPERTY` /
`ANCHOR_Y_PROPERTY` written through **CSSOM**, never a generated `style` attribute. Calling it again with a new point
**repositions** an open popup.

### Scroll spy, viewport collapse, roving focus, lazy loading

```typescript
mountScrollSpy({ root: navEl });                                   // current-section marker
mountViewportCollapse({ selector: "#app-rail" });                  // width-driven disclosure
mountRovingFocus(rail, { items: "[data-slot~='rail-item']", orientation: "vertical" });
lazy({ ref: "map-section", load: () => import("./map"), init: (mod, el) => mod.initMap(el) });
```

`mountScrollSpy` stamps `aria-current="location"` — never `"page"`, since the page did not change — on exactly one
link, and emits no `data-*` state, so the visible cue is the stylesheet's alone. **Entries are ordered by the targets'
document position, not by link order**, because a nav may list its links in any order while "which section am I
reading" is a question about the page.

`mountViewportCollapse` wants the `<details>` rendered **open** — with scripting unavailable the navigation is
visible, which is the safe state — and **stops driving it the moment the user toggles it themselves**, per mount and
not persisted. It **throws** when the element it was told to drive is absent or is not a disclosure, and **reports**
when the realm has no `matchMedia`.

`mountRovingFocus` resolves its **items live on every interaction**, so a composite whose items are swapped, filtered
or reordered needs no re-registration. The ring's rules, each present because omitting it produces a bug: arrow keys
inside a text field belong to the caret until its edge; direction is read from the element, so an RTL island inside an
LTR page navigates as RTL; items present but not rendered are out of the ring; a nested composite keeps the key it
consumed; `disabled` leaves the ring while `aria-disabled` stays in it, focusable but inert. Mark the tab stop with
`ACTIVE_COMPOSITE_ITEM`. Forge's own composites mount it through their scopes, and a `RadioGroup` has the whole
contract from the platform, so this is for a composite **you** render.

`lazy` retries a rejected `load()` a bounded number of times; a rejection with no `onError`, a throwing `init`, a
missing anchor and a realm with no `IntersectionObserver` all **report**, because a module that never loads is
otherwise indistinguishable from one that was never scheduled.

---

## `@y-core/forge/ui/client/htmx`

> Import path: `@y-core/forge/ui/client/htmx` → `src/ui/client/htmx.ts`
> **Browser-only, side-effect import.** esbuild entry points only.

```typescript
import "@y-core/forge/ui/client/htmx"; // side-effect only — no exports used
```

It imports the htmx bundle, attaches it to `window`, and disables htmx's built-in indicator styles
(`htmx.config.includeIndicatorStyles = false`). It re-exports `htmx` for the rare call site that needs the instance
directly, but the bare side-effect import is the canonical usage. Mark the import so esbuild does not tree-shake it,
and never load htmx from a CDN — this entry pins the version through forge.

---

## `@y-core/forge/ui/server`

> Import path: `@y-core/forge/ui/server` → `src/ui/server/mod.ts`
> **SSR-only.** These run in Workers/SSR contexts; never bundle them into the browser.

### Usage — flash messages

```tsx
const flash = createFlash({ secrets: [env.SESSION_SECRET] });

await flash.success(c, "Profile saved.");   // in a POST handler, then redirect
const messages = await flash.get(c);         // in the next loader; clears as it reads

<FlashContainer messages={messages} position="bottom-right" />   {/* full page render */}
<FlashOob messages={messages} />                                  {/* HTMX out-of-band swap */}
```

> **Flash toasts are scoped components.** `Flash` / `FlashContainer` / `FlashOob` render `Toast`,
> which drives dismiss and timed auto-close through the `toast` resumable scope. The app's client
> entry must `import "@y-core/forge/ui/core/client"` **before** calling `resume()`
> ([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §2d).

### Exports

| Export | Kind | Description |
|---|---|---|
| `createFlash(options)` | factory | Returns a `Flasher` over a signed cookie. Convenience methods `success` / `info` / `warning` / `error`, plus `set` / `get`. |
| `Flash` | component | Renders an array of `FlashMessage` as dismissible toasts. |
| `FlashContainer` | component | A `Toast.Container` wrapping `Flash` — use on full page render. |
| `FlashOob` | component | Wraps each toast in an HTMX OOB-swap div targeting `#flash-container`. |
| `Resumable` | component | Wraps children in a `data-scope` + serialized `data-state` island. Optional `id` (a `commandfor` sink) and `class` — the scope root is a real box in its parent's layout, so width, `shrink` and border belong there. |
| `fieldAttr(name)` | helper | Stamps `data-field` so `bindControls` knows which signal the control drives. |

`createFlash(options)` takes `FlashCookieOptions` — `secrets`, plus optional `name` (`"flash"`), `path` (`"/"`),
`maxAge` (`60`) and `sameSite` (`"Lax"`).

**Types:** `FlashMessage`, `FlashType`, `FlashCookieOptions`, `Flasher`, `ResumableProps`.

### Resumable islands

`Resumable` is the SSR half of the island pattern: its `name` must match the client-side `registerScope`, and `state`
is the serializable object rehydrated into signals. `scopeAttrs` (from [`ui/contracts`](#y-coreforgeuicontracts)) and
`registerScope` are both generic over the action-name union, so a typo in an action name is a compile error and client
and server share one action namespace. `Resumable` performs no eager hydration of its own.

---

## `@y-core/forge/ui/chrome`

> Import path: `@y-core/forge/ui/chrome` → `src/ui/chrome/mod.ts`
> **SSR-only.** Their interactive halves are scopes registered by `@y-core/forge/ui/chrome/client`.

### Usage

```tsx
import { Navbar, ThemeToggle, Toolbar, type NavDefinition } from "@y-core/forge/ui/chrome";

const nav: NavDefinition = {
  sections: [
    { items: [{ label: "Home", href: "home" }, { label: "Docs", items: [{ label: "Guides", href: "guides" }] }] },
    { items: [{ slot: "user_name" }, { label: "Sign out", href: "signout", filters: ["user"] }] },
  ],
};

<Navbar config={nav} resolveHref={routes.url} slots={{ user_name: <span>{user.name}</span> }}
        activeFilters={user ? ["user"] : []} icon={AppIcon} />
<Toolbar config={tools} icon={AppIcon} placement="left" />
<ThemeToggle icon={AppIcon} />
```

For a left rail, set `collapsible="always"` and put the layout classes on the wrapping box the parent lays out — not
on `Navbar` — with that box's parent supplying the definite height the `h-full` chain inside resolves against; write
the collapsed width as an override on a `w-64` base so a browser without `:has()` keeps the full column. The three
rulings are `forge-ui-nav-rail-flex-item`, `forge-ui-nav-rail-persists` and `forge-ui-nav-rail-collapsed-width` in
[`ui/design/reference/08-navigation.md`](./design/reference/08-navigation.md).

### Exports

| Export | Kind | Description |
|---|---|---|
| `Navbar` | component | Renders `NavbarProps.config`. Required: `config`, `resolveHref`, `icon` (`ForgeIcon<NavGlyph>`, or `ForgeIcon<NavGlyph \| NavDrawerGlyph>` under `collapsedAs="drawer"` **with** `collapsible="always"` — the rail drawer, whose toggle draws the panel pair instead of the hamburger). Optional: `slots`, `activeFilters`, `placement`, `collapsible` (default `"mobile"`), `collapsedAs` (default `"inline"`), `defaultOpen` (default `false`), `id`, `class`, plus `<nav>` pass-through. |
| `Toolbar` | component | Renders `ToolbarProps.config`. Required: `config`, `icon` (`ForgeIcon<G>`, `G` being the config's glyph-name union). Optional: `placement` (default `"left"`), `commandTarget`, `id`, `class`, plus `<nav>` pass-through. |
| `ThemeToggle` | component | Theme-cycle button. Required: `icon` (`ForgeIcon<"sun" \| "moon" \| "monitor">`). Optional: `size` (default `20`), `class`. |
| `FOUC_SCRIPT` | const string | Inline script that applies the stored preference before first paint. |
| `THEME_ATTR` | const string | `"data-theme-preference"` — the `<html>` attribute recording the active preference. |
| `THEME_STORAGE_KEY` | const string | `"themePreference"` — the `localStorage` key. |
| `DARK_CLASS` | const string | `"dark"` — the class toggled on `<html>`. |
| `DEFAULT_PREF` | const string | `"system"` — the server default, resolved against the OS preference client-side. |

**Types:** `NavbarProps`, `NavDefinition`, `NavSection`, `NavSectionItem`, `NavItem`, `NavLink`, `NavMenu`, `NavSlot`,
`NavGroup`, `NavPlacement`, `NavCollapsible`, `ToolbarProps`, `ToolbarDefinition`, `ToolbarGroup`, `ToolbarItem`,
`ToolbarAction`, `ToolbarPopover`, `ToolbarSeparator`, `ToolbarSlot`, `ToolbarTitleAction`, `ToolbarPlacement`,
`ThemeToggleProps`.

### `Navbar` config

A `NavDefinition` is `{ sections: NavSection[] }`; a `NavSection` is `{ items: NavSectionItem[] }`; a `NavSectionItem`
is a `NavItem` or a `NavGroup`; a `NavItem` is a `NavLink` (`label`, `href`, `filters?`), a `NavMenu` (`label`,
`items`, `filters?` — recurses), or a `NavSlot` (`slot`, `label?`, `filters?`). Sibling sections spread across the bar
via `justify-between`. `NavPlacement` is `"top" | "bottom" | "left" | "right"`.

**`NavGroup`** (`heading`, `group`, `filters?`) renders a heading over destinations that stay **visible** — a
`role="group"` wrapper with a `<p>` heading, since `Navbar` cannot know which heading level it is nested under. **Only
`NavSection.items` widens to accept it**, so a group nested inside a `NavMenu` is a compile error rather than a
runtime degradation.

**`collapsible`** decides which breakpoints the bar hides behind its toggle: `"mobile"` (the default) expands the
panel and hides the toggle from `md:` up, while `"always"` keeps both at every breakpoint, which is why `placement`
defaults to `"left"` there. `defaultOpen` renders the underlying `<details>` open on first paint, attribute-only —
pair it with `mountViewportCollapse` for a rail that should follow viewport width. **`id` namespaces the generated
menu ids** on both `Navbar` and `Toolbar`, falling back to the placement each renders at; supply a distinct value when
two bars share a placement, or both mint the same id and the second bar's trigger toggles the first bar's popup.

Two rules the type does not express: **`href` is a route-map key, never a URL**, always passed through the required
`resolveHref`; and a `NavSlot.slot` that is a `string` is looked up in the `slots` map while a `JSXNode` is rendered
inline. An item with **`filters`** shows only when one of its tokens is in the active set — `activeFilters` seeds it
server-side for a flash-free first paint, and at runtime the app dispatches `NAVBAR_FILTERS_EVENT` on `document` with
the new tokens as `detail`.

### `Toolbar` config

A `ToolbarDefinition<A, G>` is `{ groups: ToolbarGroup<A, G>[] }` (a separator is auto-emitted between sibling
groups); a `ToolbarItem<A, G>` is a `ToolbarAction` (`kind: "action"` — `icon`, `label`, `action`, optional
`dispatch`, `ref`, `data`, `active`, `size`), a `ToolbarPopover` (`kind: "popover"` — `icon`, `label`, `content`,
optional `ref`, `compact`, `titleAction`), a `ToolbarSeparator`, or a `ToolbarSlot`. A `ToolbarTitleAction<A, G>` is
the button stamped inline on a flyout's title row. `ToolbarPlacement` is `"left" | "right" | "top" | "bottom"`.

The generic `A` is the app's action-name union, shared with `registerScope<A>`; `G` is the app's glyph-name union,
shared with the `icon` prop — so a typo in either is a compile error rather than a dead button or an empty `<use>`. An
action item dispatches through the scope (`data-on-click`, the default) or through the native Invoker `CommandEvent`
bridge with `dispatch: "command"`, which emits `command="--action"` against the `commandTarget` element id; both land
in the same `on` table.

### Wiring

1. **Register the scopes** — the client entry side-effect-imports `@y-core/forge/ui/chrome/client`
   **before** `resume()`, or `Navbar` renders without runtime auth filtering and `ThemeToggle` does
   nothing on click.
2. **Stamp `FOUC_SCRIPT` into `<head>`** — `<script>{rawHtml(FOUC_SCRIPT)}</script>` — so the theme
   applies before first paint, and add its hash to the CSP `script-src`; it is inline and carries no
   nonce.
3. **Ship the theme CSS.** `ThemeToggle` renders its three icons inside `theme-light-icon`,
   `theme-dark-icon` and `theme-system-icon` spans, and which is visible is decided by CSS keyed off
   `html[data-theme-preference]` in `src/ui/assets/css/forge-ui.css`. Those class names are a
   contract — rename one and the toggle renders all three glyphs at once. The same mechanism
   supplies the accessible name: each span carries an `sr-only` label, and `display: none` removes
   the other two from the accessible-name computation.

| Component | What its markup stamps |
|---|---|
| `Toolbar` | `role="toolbar"`, `TOOLBAR_SCOPE`, and `data-orientation` / `aria-orientation` — `vertical` for a `left` or `right` rail, `horizontal` for `top` or `bottom`. Every action and popover trigger carries `TOOLBAR_ITEM_ATTR`, so the whole rail is **one tab stop**. Separators are `<hr aria-orientation>`, whose axis is *across* the rail. |
| `Navbar` | Bar-level dropdowns are `core/Menu`; rows below the bar are `Menu.SubmenuTrigger` and `Menu.LinkItem`. Each popup carries `MENU_SCOPE`. |
| `ThemeToggle` | `data-scope="theme"`, and three `sr-only` labels rather than one static `aria-label`. |

**`Navbar` is not a `role="menubar"`, and a flyout's title action is not a rail stop** — both rulings, not omissions
([`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) §1l). The rail carrying
`TOOLBAR_SCOPE` means an app action fired inside it passes through a scope on its way up, which is safe: action
routing continues to the enclosing scope when the inner table lacks the action. Every glyph chrome needs ships in
`forgeUiSpriteSources()`.

---

## `@y-core/forge/ui/chrome/client`

> Import path: `@y-core/forge/ui/chrome/client` → `src/ui/chrome/client.ts`
> **Browser-only, side-effect import.** esbuild entry points only.

Registers the `theme` and `navbar` scopes at module load; no DOM is touched until a scope resumes. It also
**side-effect-imports `@y-core/forge/ui/core/client`**, because chrome's markup names the `menu` and `toolbar` scopes
and a component whose markup names a scope has to guarantee the scope exists. Import it in the client entry **before**
`resume()`, since the eager pass only hydrates scopes registered by then; registration is idempotent, so importing
both is harmless.

| Scope | Contract |
|---|---|
| `theme` | `eager`. State key `pref`. One action, `cycleTheme`, advancing `light → dark → system → light`. `setup` acquires the **document's** theme — one `pref` seeded from `localStorage`, one `(prefers-color-scheme: dark)` listener, and the effects keeping `THEME_ATTR`, `localStorage` and `DARK_CLASS` on `<html>` in sync — re-points its own `pref` at it, and releases it on disposal. |
| `navbar` | `eager`. State key `filters`. No actions — `setup` alone syncs `hidden` on every `[data-filter]` descendant and listens for `NAVBAR_FILTERS_EVENT`. Eager out of necessity: the navbar's markup emits no `data-on-*` anywhere. |

| Export | Type | Description |
|---|---|---|
| `isDark` | `ReadonlySignal<boolean>` | Whether the resolved theme is dark (`pref === "dark"`, or `"system"` with a matching media query). |

```typescript
import { isDark } from "@y-core/forge/ui/chrome/client";
import { effect } from "@y-core/forge/ui/client";

effect(() => renderer.setBackground(isDark.value ? "#111" : "#fff"));
```

`isDark` is a **stable binding** — a fixed object whose `.value` getter delegates to whichever signal is currently
live — so it is safe to capture before `resume()` runs, reading `false` until a theme scope resumes. **The preference
belongs to the document, not to a toggle:** every `theme` scope in a document shares one `pref` signal, and the media
listener plus the two effects that paint `<html>` are installed once per document by whichever scope resumes first, so
a navbar toggle beside a settings one is a supported composition. **`resume()` owns teardown** for every scope, so
there is nothing for the caller to unmount and no handle to hold.

---

## `@y-core/forge/ui/show`

> Import path: `@y-core/forge/ui/show` → `src/ui/show/mod.ts`
> Its markup is opt-in for Tailwind — see [the stylesheet](#the-stylesheet).

A drop-in, living reference for every `@y-core/forge` UI component, plus a **theme customiser** that generates a
complete forge colour scheme from the five dials, previews it on four scale/surface rows and on a real composed UI,
reports live WCAG ratios for every audited pair, and emits a paste-ready scheme file.

### Routes

`showcaseRoutes(base)` returns six pages and seven HTMX fragment endpoints; `registerShowcase` mounts every one,
wrapped in your `layout`. The catalog is cut by **consumer prerequisite**: the page a demo lands on is what you must
wire up for it to work.

| Route | Path (default base) | What it is | Prerequisite |
|---|---|---|---|
| `ui.index` | `/showcase/ui` | Server-rendered primitives. | none — works with JavaScript disabled |
| `ui.interactive` | `/showcase/ui/interactive` | The `ui/core` components that register a scope. | `import "@y-core/forge/ui/core/client"` + `resume()` |
| `ui.runtime` | `/showcase/ui/runtime` | Signals, `bindControls`, `lazy()`. | `import "@y-core/forge/ui/show/client"` + `resume()` |
| `ui.htmx` | `/showcase/ui/htmx` | The fragment demos and the Flash channel. | `import "@y-core/forge/ui/client/htmx"` + the seven `ui.api.*` endpoints |
| `ui.chrome` | `/showcase/ui/chrome` | The configuration-driven navbar, toolbar and theme toggle. | `import "@y-core/forge/ui/chrome/client"` + a `NavDefinition` you supply |
| `ui.theme` | `/showcase/ui/theme` | The theme customiser. Its whole state is the query string, each dial clamped to its own range, so a scheme is shareable as a link with no `localStorage` and no FOUC script. | none |
| `ui.api.*` | `/showcase/ui/api/…` | Seven fragment endpoints (`preview`, `validate`, `search`, `paginate`, `dependent`, `toast`, `avatar`). | — |

**The bundle does not split.** `ui/show/client` registers every scope and side-effect-imports `ui/chrome/client` and
`ui/core/client`, so each page ships everything; the pages *document* the prerequisite rather than enforcing it. The
customiser paints through CSSOM rather than server-rendering colour, because forge ships `style-src 'self'` and the
JSX renderer drops `style` attributes — every hex is server-rendered **as text**, so the page reads correctly with no
JavaScript ([`THEME_GENERATION.md`](../../.decisions/implementation/THEME_GENERATION.md) §2c).

### Usage

`ShowcaseContent` is layout-less — wrap it in your app's `Layout`. It needs the showcase data, an `icon` prop (a
`ShowcaseIcon`, whose every glyph `forgeUiSpriteSources()` supplies), and the `page` to render (defaults to
`"index"`):

```tsx
const data = loadShowcase(c, { basePath: "/showcase" });
return renderPage(<Layout><ShowcaseContent data={data} icon={icon} page='interactive' /></Layout>);
```

### Exports

| Export | Kind | Description |
|---|---|---|
| `showcaseRoutes(base?)` | function | Builds the showcase route subtree under `base` (default `"/showcase/ui"`). |
| `registerShowcase(app, routes, options)` | function | Registers every showcase page and API endpoint on a `Forge` app. |
| `ShowcaseUiRoutes`, `ShowcaseOptions`, `ShowcaseIcon` | types | The `ui` subtree `showcaseRoutes` returns; `registerShowcase`'s `{ icon, context, layout }`; and the `ForgeIcon` union every section needs. |
| `ShowcaseContent` | component | One showcase page body, selected by `page`. |
| `showcasePaths(basePath, apiPath?)` | function | Every showcase URL path derived from a base path — the single source of truth the page and its endpoints share. |
| `loadShowcase` | loader | Builds `ShowcaseData` (`{ paths }`) for the page. |
| `CustomiseContent` | component | The theme customiser body — levers, the four-row scale preview, live WCAG readouts, the composition band, and the generated scheme file with its copy controls. |
| `loadCustomise` | loader | Builds `CustomiseData` (`{ dials, path }`) by reading the five dials off the query string, clamped and snapped to each dial's own range. |
| `CustomiseData`, `CustomiseIcon` | types | The customiser's loader output, and its icon constraint. |
| `CompositionsSection` | component | The composition band: the catalog's primitives assembled into the surfaces an application ships. |
| `CollectionSurface` | component | One collection in its four states — populated, empty, loading and failed — shown as siblings. |
| `SettingsSurface` | component | A settings form: `FormField` where a value is validated, `Field` where a row is only laid out. |
| `FeedbackSurface` | component | Two near-neighbour choices made side by side: `Alert` against `Toast`, `Spinner` against `Skeleton`. |
| `loadPreview` / `renderPreview` | loader / renderer | Variant + size preview demo. |
| `loadValidate` / `renderValidate` | loader / renderer | Inline validation demo. |
| `loadSearch` / `renderSearch` | loader / renderer | Live search demo. |
| `loadPaginate` / `renderPaginate` | loader / renderer | Pagination demo. |
| `loadDependent` / `renderDependent` | loader / renderer | Dependent-select demo. |
| `loadToast` / `renderToast` | loader / renderer | Toast trigger demo. |
| `renderAvatar` | renderer | Serves the showcase's own portrait SVG, so the catalog never reaches for a remote image. The only `render*` with no loader pair — it reads nothing from the request. |
| `PreviewSection`, `ValidateSection`, `SearchSection`, `PaginateSection`, `DependentSection`, `ToastSection` | components | Each demo's section, for apps composing the demos individually. |
| `PreviewFragment`, `ValidateFragment`, `SearchFragment`, `PaginateFragment`, `DependentFragment`, `ToastFragment` | components | Each demo's swappable HTMX fragment. |
| `SHOW_PREVIEW_ID`, `SHOW_VALIDATE_ID`, `SHOW_SEARCH_ID`, `SHOW_PAGINATE_ID`, `SHOW_DEPENDENT_ID` | const | The HTMX target ids each demo's fragment swaps into, for apps composing the demos individually. |

Each `render*` helper paired with a loader serializes its fragment with `renderToString` and returns a
`fragmentResponse`; `renderAvatar` returns an `image/svg+xml` response instead. The two taking an icon-bound component
(`renderPreview`, `renderDependent`) take the same bound icon as `ShowcaseContent`.

**Types:** `ShowcaseData`, `ShowcasePaths`, `PreviewData`, `ValidateData`, `SearchData`, `PaginateData`,
`DependentData`, `ToastData`.

---

## `@y-core/forge/ui/show/client`

> Import path: `@y-core/forge/ui/show/client` → `src/ui/show/client.ts`
> **Browser-only, side-effect import.**

Import it in the client entry before `resume()`, as `ui/core/client` is imported.

It registers `show-filter` — a catalog list filtered against a search input with a `computed()`-derived result count
and no server roundtrip — and `show-controls`, which runs `bindControls` over every `data-field` control in the demo
band and writes each `[data-readout]` element from the signal behind it. That scope is `eager`, because a bound
control stamps no `data-on-*` action for a lazy resume to trigger on.

---

## See also

- [`UI_SSR_COMPONENTS.md`](../../.decisions/implementation/UI_SSR_COMPONENTS.md) — the component
  contract, the signal-binding seam, the class utilities, the state-attribute contract, the scheme
  declaration contract.
- [`UI_CLIENT_RUNTIME.md`](../../.decisions/implementation/UI_CLIENT_RUNTIME.md) — mount
  controllers, the disposer contract, signals, lazy loading, resumable scopes.
- [`THEME_GENERATION.md`](../../.decisions/implementation/THEME_GENERATION.md) — the dial model, the
  emission contract, the contrast audit.
- [`UI_DESIGN_GUIDANCE.md`](../../.decisions/implementation/UI_DESIGN_GUIDANCE.md) — the design
  corpus's rule tiers and identifiers.
- [`UI_SHOWCASE.md`](../../.decisions/implementation/UI_SHOWCASE.md) — mounting `ui/show`, and its
  coverage contract.
- [MIGRATION.md](../../MIGRATION.md) — the consumer-facing `dark:` variant takeover.
