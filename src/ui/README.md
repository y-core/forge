# `@y-core/forge/ui`

Source-distributed UI primitives for forge apps, split across fourteen import sub-paths. The family
covers server-rendered JSX primitives (`@y-core/forge/ui/core`) with their client scopes
(`@y-core/forge/ui/core/client`), pre-bound signal-binding wrappers (`@y-core/forge/ui/controls`),
the DOM contract those two halves share (`@y-core/forge/ui/contracts`), forge's self-owned icon asset
manifest (`@y-core/forge/ui/assets`) and its browser-safe glyph parser
(`@y-core/forge/ui/assets/glyphs`), browser-side controllers and a framework-free reactive runtime
(`@y-core/forge/ui/client`), SSR-only stateful components (`@y-core/forge/ui/server`),
configuration-driven app chrome — navbar, toolbar, theme toggle — (`@y-core/forge/ui/chrome`) with
its client island (`@y-core/forge/ui/chrome/client`), the pinned HTMX bundle
(`@y-core/forge/ui/client/htmx`), a ready-made component showcase (`@y-core/forge/ui/show`,
`@y-core/forge/ui/show/client`), and the addressable stylesheets and theme ramps
(`@y-core/forge/ui/assets/css/*.css`) — a subpath **pattern**, so it names a family rather than one
file, and each real `.css` in that directory is reachable.

Every component is a thin wrapper over a native element with default Tailwind styling, predictable prop
pass-through, and explicit composition. Field state and icon sprites are owned through composition, not
configuration.

> **Architecture reference:** the authoritative design rationale (SSR-vs-client split, the resumability
> island pattern, field binding) lives in [`UI_SSR_COMPONENTS.md`](../../.decisions/UI_SSR_COMPONENTS.md)
> and [`UI_CLIENT_RUNTIME.md`](../../.decisions/UI_CLIENT_RUNTIME.md).

---

## Table of Contents

- [`@y-core/forge/ui/core`](#y-coreforgeuicore) — server-side JSX component library
- [`@y-core/forge/ui/core/client`](#y-coreforgeuicoreclient) — toast + alert scopes island (side-effect import)
- [`@y-core/forge/ui/controls`](#y-coreforgeuicontrols) — pre-bound signal-binding wrapper layer
- [`@y-core/forge/ui/contracts`](#y-coreforgeuicontracts) — the shared DOM contract as pure data
- [`@y-core/forge/ui/assets`](#y-coreforgeuiassets) — forge's self-owned icon asset manifest
- [`@y-core/forge/ui/assets/glyphs`](#y-coreforgeuiassetsglyphs) — browser-safe sprite glyph parser
- [`@y-core/forge/ui/assets/css/*.css`](#the-stylesheet--one-import-one-ramp) — the entry stylesheet and the theme ramps
- [`@y-core/forge/ui/client`](#y-coreforgeuiclient) — browser controllers + signals runtime
- [`@y-core/forge/ui/server`](#y-coreforgeuiserver) — SSR-only Flash and Resumable
- [`@y-core/forge/ui/chrome`](#y-coreforgeuichrome) — SSR Navbar, Toolbar, ThemeToggle + theme constants
- [`@y-core/forge/ui/chrome/client`](#y-coreforgeuichromeclient) — chrome scopes island (side-effect import)
- [`@y-core/forge/ui/client/htmx`](#y-coreforgeuiclienthtmx) — HTMX bundle (side-effect import)
- [`@y-core/forge/ui/show`](#y-coreforgeuishow) — component showcase route helpers
- [`@y-core/forge/ui/show/client`](#y-coreforgeuishowclient) — showcase filter island script

---

## Prerequisites

forge ships TypeScript/TSX **source** — there is no build step and no emitted `.d.ts`. To consume any
component you need a TypeScript-aware bundler (esbuild, Bun, Vite, or Wrangler) configured with the
forge JSX runtime:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@y-core/forge/jsx"
  }
}
```

Without `jsxImportSource: "@y-core/forge/jsx"`, JSX in component files compiles against the wrong
runtime and fails. Each forge `.tsx` file also self-declares the runtime with a
`/** @jsxImportSource @y-core/forge/jsx */` pragma, so per-file overrides are unnecessary.

### The stylesheet — one import, one ramp

forge's components are Tailwind utilities over semantic tokens, so an app needs **two** things from
this package: the tokens, and the *generated rules* for the utility classes the components emit.
A single import supplies both:

```css
/* your app's stylesheet */
@import "tailwindcss";
@import "@y-core/forge/ui/assets/css/forge.css";
```

**Why one import rather than importing `theme-base.css` directly.** Tailwind v4's automatic content
scan **ignores `node_modules`**, so without help none of forge's classes are ever generated — the
markup renders and every class on it has no rule. `forge.css` fixes that from inside the package: it
carries an `@source` path for **every directory whose files declare a utility class** — components
and published class strings alike — and `scripts/validate-css-sources.ts` fails the gate if a
directory is neither scanned nor registered as class-free, so the guarantee cannot quietly lapse when
a new directory appears. Read `forge.css` for the current list. The paths resolve **relative to
itself**, which is the only form that survives pnpm, a workspace, a git dependency and a monorepo
alike. Writing them consumer-side would mean hardcoding `../../node_modules/@y-core/forge/…`, which
is wrong under most of those.

Use `@y-core/forge/ui/assets/css/forge-show.css` instead if the app mounts
[`@y-core/forge/ui/show`](#y-coreforgeuishow) — same file plus the showcase's own classes, kept
opt-in so an app that does not mount it pays nothing.

#### Supply a `--palette-*` ramp

`theme-base.css` maps every semantic token — `--background`, `--primary`, `--border`, `--sidebar`
and the rest — onto **eleven stops, `--palette-50` through `--palette-950`**, overriding only where
it diverges from that mapping. Supplying the ramp is how an app themes forge, and any
`theme-*.css` in `src/ui/assets/css/` is a working example: an app's own ramp is structurally
identical to `theme-slate.css`.

```css
:root {
  --palette-50:  oklch(0.98 0.003 250);
  /* … through … */
  --palette-950: oklch(0.16 0.010 250);
}
```

**Override an individual token on top of the ramp** for the cases a ramp cannot express — a brand
hue is one, and in forge's vocabulary a brand hue is `--primary`, not `--accent`:

```css
:root { --primary: var(--color-brand-accent); }
```

That is the supported extension point in both directions: the ramp is the general case, per-token
override is the tail. There is no `unstyled` escape hatch, deliberately — see the note on layers
below for why one would not solve the problem it looks like it solves.

#### Component rules are in `@layer components`

Everything below `theme-base.css`'s token blocks is layered, so **a utility you pass at the call
site wins over a component default** — `<Dialog class="max-w-sm">` narrows the dialog, as it reads.
(These rules were unlayered before `v0.0.74`, and unlayered CSS outranks *all* layered CSS whatever
its selector weight, so such a `max-w-sm` silently did nothing.)

**If your app's own component rules lose to forge's utilities, the fight is between layers, not
selectors.** `@import "tailwindcss"` declares `@layer theme, base, components, utilities;`, so rules
you put in `@layer components` lose to every forge utility in `@layer utilities` regardless of
specificity. Declare a layer of your own *after* `utilities` and put them there:

```css
@import "tailwindcss";
@import "@y-core/forge/ui/assets/css/forge.css";

@layer app;              /* declared last — so it wins */
@layer app { /* your chrome rules */ }
```

#### Dark mode with Tailwind v4

Forge's palette is a set of CSS custom properties that `.dark` on `<html>` re-maps, resolved at
runtime through `@theme inline`. **So every forge component works in dark mode with no extra setup**
— `bg-popover`, `text-muted-foreground` and the rest all follow the class the theme scope toggles.

**Your own `dark:` utilities do not, and this is the one piece of setup that is easy to miss.**
Tailwind v4 defaults the `dark:` variant to `prefers-color-scheme`, so a `dark:bg-slate-900` of
your own would follow the *operating system* while every forge component follows the *user's
choice* — and the two disagree the moment someone picks a theme that is not `system`. Point the
variant at the class instead:

```css
/* your app's stylesheet, alongside the forge imports */
@custom-variant dark (&:where(.dark, .dark *));
```

One line, and `dark:` now means the same thing to your utilities as it does to forge's palette.
Nothing in `ui/assets` declares it, because a consumer's variant configuration is a consumer's to
own — but every app using both forge components and its own `dark:` utilities needs it.

---

## `@y-core/forge/ui/core`

> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`

### Features

- Server-rendered JSX components — produce static HTML via `renderToString`, with no required browser
  JavaScript.
- Compound components (`Card.Header`, `Alert.Title`, `Select.Option`, `Toast.Description`) for explicit
  composition.
- Variant-driven styling through `cva`, conditional class merging through `cn`.
- An accessible field system: controls inside a `FormField` inherit `id`, `name`, `aria-invalid`, and
  `aria-describedby`.
- Sprite-backed icons via `createIcon`; icon-consuming components accept an `icon` prop directly.
- A `Turnstile` CAPTCHA mount point that pairs with the arg-less `mountTurnstile()` controller
  (`@y-core/forge/ui/client`) for a resilient, engagement-gated challenge lifecycle.

### Attribute pass-through contract

Every component forwards **unrecognized props** — including arbitrary `data-*` and `aria-*` attributes — onto its root (or designated inner) element. Each component destructures only its own declared props and spreads the rest, so client-side binding conventions (`data-ref`, `data-on-click`, custom hooks for test selectors) attach without re-wrapping forge components:

```tsx
<Button data-ref='save-btn' data-on-click='saveDoc'>Save</Button>
// → <button … data-ref="save-btn" data-on-click="saveDoc">Save</button>
```

Two renderer-level rules apply to forwarded attributes (see `src/jsx/render-to-string.ts`):

- Values are **HTML-escaped** (`data-note="a&b"` renders `data-note="a&amp;b"`); URL-bearing attributes (`href`, `src`, …) are additionally scheme-sanitized via `safeUrl`.
- `style` is **dropped** — forge's CSP has no `style-src 'unsafe-inline'`, so inline styles would be blocked by the browser and must not ship.

This contract is pinned by pass-through tests in `ui/controls/controls.test.tsx`, `ui/core/button.test.tsx`, and `ui/core/field.test.tsx`.

### Usage

```tsx
import {
  Card, Button, Form, FormField, Input, Textarea, Alert,
} from "@y-core/forge/ui/core";

const ContactCard = ({ errors }: { errors: { name?: string; message?: string } }) => (
  <Card class="w-96">
    <Card.Header>
      <Card.Title>Contact us</Card.Title>
      <Card.Description>We reply within one business day.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Form hx-post="/api/contact" hx-target="#contact-result">
        <FormField name="name" invalid={Boolean(errors.name)}>
          <FormField.Label name="name">Your name</FormField.Label>
          <Input name="name" field={{ name: "name", invalid: Boolean(errors.name) }} required />
          {errors.name && <FormField.Error name="name">{errors.name}</FormField.Error>}
        </FormField>
        <Button type="submit" variant="primary">Send message</Button>
      </Form>
    </Card.Content>
  </Card>
);
```

### Core Components & APIs

| Export | Renders | Notes |
|---|---|---|
| `Form` | `<form>` | HTMX attributes pass through; no client submission logic. |
| `FormField` | `<fieldset>` | Accessible form field with `name` / `invalid` / `disabled`. Compounds: `FormField.Label`, `FormField.Description`, `FormField.Error`. |
| `Field` | layout row | Lightweight label + control row — no form semantics. |
| `Input`, `Textarea`, `Select` | `<input>` / `<textarea>` / `<select>` | Accept an optional `field` descriptor to wire `id` / `name` / `aria-*`. `Select` requires an `icon` prop (a `ForgeIcon`). |
| `Button` | `<button>` | `variant`: `"primary" | "secondary" | "ghost"`; `size`: `"sm" | "md" | "lg" | "icon" | "icon-sm"`. `asChild` renders onto a single element child instead of a `<button>`. |
| `Alert` | `<div role="alert">` | `variant`: `AlertVariant`. Compounds: `Alert.Title`, `Alert.Description`. |
| `Card` | bordered container | Compounds: `Card.Header`, `Card.Title`, `Card.Description`, `Card.Content`, `Card.Footer`. |
| `Toast` | notification | `variant`: `ToastVariant`; `position`: `ToastPosition`. Compounds: `Toast.Title`, `Toast.Description`, `Toast.Container`. |
| `Badge` | `<span>` | `variant`: `BadgeVariant`. |
| `Avatar` | avatar | Compound: `Avatar.Fallback`. |
| `Switch`, `Slider` | styled `<input>` | CSS-only toggle / native range; accept an optional `field` descriptor. `Switch` publishes `data-label-position` (`before` / `after`). |
| `ToggleGroup`, `ToggleGroup.Item` | `<fieldset>` of buttons | Segmented control. `type`: `"single" | "multiple"` — published as `data-multiple` and read by `bindGroup`. `Item` takes `pressed` for initial state. **No `role`** — a `<fieldset>` is already a `group`. |
| `Toolbar` | `<div role="toolbar">` | One tab stop, arrow-key navigation. Compounds: `Toolbar.Button`, `Toolbar.Link`, `Toolbar.Input`, `Toolbar.Group`, `Toolbar.Separator`. Items are marked with `data-toolbar-item`; a foreign element opts in by carrying it. |
| `Menu` | native popover, `role="menu"` | Trigger + popup on the Popover and Invoker Commands APIs — open, close, light-dismiss and Escape need no JavaScript. Compounds: `Menu.Trigger`, `Menu.Popup`, `Menu.Item`, `Menu.LinkItem`, `Menu.SubmenuTrigger`, `Menu.CheckboxItem`, `Menu.RadioItem`, `Menu.Group`, `Menu.GroupLabel`, `Menu.Separator`. |
| `Tabs` | tablist + panels | `orientation`; `activation`: `"automatic" | "manual"`. Compounds: `Tabs.List`, `Tabs.Tab`, `Tabs.Panel`. An unselected panel is `hidden`, so the first render is correct with no JS. |
| `Toggle` | `<button aria-pressed>` | A single two-state pressable button. `pressed` for initial state. |
| `Collapsible` | native `<details>` | Compounds: `Collapsible.Trigger`, `Collapsible.Content`. `<details>` owns open and closed; the controller only publishes them. |
| `Accordion` | stack of `<details>` | Compounds: `Accordion.Item`, `Accordion.Trigger`, `Accordion.Content`. Each item is its own disclosure and its own tab stop. |
| `Tooltip` | `popover="hint"` | Compounds: `Tooltip.Trigger`, `Tooltip.Content`. A hint does not dismiss the `auto` popover beneath it. |
| `CheckboxGroup`, `RadioGroup` | `<fieldset>` of native inputs | Real `<input type="checkbox">` / `<input type="radio">`. Radio grouping and its roving focus are the platform's. Compound: `.Item` on each. |
| `Meter` | `<meter>` | A measurement in a known range — distinct from `Progress`, which is task completion. |
| `NumberField` | numeric `<input>` + steppers | `min` / `max` / `step` enforced natively via `stepUp` / `stepDown`. Compounds: `NumberField.Input`, `NumberField.Increment`, `NumberField.Decrement`. |
| `ScrollArea` | scroll container | Almost entirely CSS — no scroll hijacking, no synthetic thumb. Compound: `ScrollArea.Viewport`. |
| `Dialog` | native `<dialog>` | Compounds: `Dialog.Trigger`, `Dialog.Close`. Top layer, backdrop and Escape are the platform's. |
| `Progress`, `Separator`, `Skeleton`, `Spinner`, `Popover`, `Label` | misc primitives | `Spinner` requires an `icon` prop. |
| `Icon`, `createIcon` | `<svg><use>` | Sprite-backed icon and its factory. |
| `cn`, `asClass`, `cva` | class utilities | Class merging, `class`-prop narrowing, and class-variance authority (all `@public`). |

Components that need a keyboard — `Toolbar`, `Menu`, `Tabs`, `Tooltip`, `Collapsible`,
`NumberField` — render a `data-scope` and are inert until `@y-core/forge/ui/core/client` is imported.
The markup stays valid and accessible without it; what is missing is the arrow keys.

#### `FormField` — accessible form fields

`FormField` is the `<fieldset>`-based accessible field. Its compound members auto-wire `for` / `id` /
`aria-describedby` from the field `name` via the ID helpers — pass the same `name` to each member:

| Helper | Returns |
|---|---|
| `fieldId(name)` | `field-${name}` — the control ID |
| `fieldDescriptionId(name)` | `field-${name}-description` |
| `fieldErrorId(name)` | `field-${name}-error` |

`fieldControlProps(props, field)` is the pure function that merges a `FieldDescriptor`
(`{ name, invalid?, disabled? }`) into control props — it is what `Input` / `Select` / `Textarea` call
internally when given a `field` prop. `FIELD_LABEL_CLASSES` is the shared label class string.

```tsx
import { fieldErrorId } from "@y-core/forge/ui/core";

<Input name="email" type="email" aria-describedby={fieldErrorId("email")} />
```

`FormField.Error` renders nothing when its child is `null`, `false`, or empty, so it is safe to include
unconditionally.

#### `Field` — layout primitive

`Field` is distinct from `FormField`. Use `Field` for settings rows and labelled controls that are not
validated form fields; use `FormField` when you need `name` / `invalid` / error / description wiring.

```tsx
import { Field, Slider, Select } from "@y-core/forge/ui/core";

<Field label="Field of view"><Slider min={10} max={120} value={50} output /></Field>
<Field label="Device" orientation="horizontal"><Select name="device" icon={icon}>…</Select></Field>
```

`orientation` is `"vertical"` (default), `"horizontal"`, or `"responsive"`.

#### `Button` — `asChild`

Pass `asChild` to merge the button's classes and forwarded props onto a single JSX element child (an
`<a>`, for example) via `cloneElement`, instead of rendering a `<button>`:

```tsx
import { Button } from "@y-core/forge/ui/core";

<Button asChild variant="ghost"><a href="/docs">Docs</a></Button>
```

`asChild` requires **exactly one JSX element child**. A string, number, fragment, array, or empty
child is a programming error and `Button` **throws** — it does not silently degrade. Keep the child a
single element (wrap dynamic content yourself before passing it).

#### Icons — `createIcon`

Several components (`Select`, `Spinner`, and the chrome `ThemeToggle`, `Navbar`, and `Toolbar`) render
an icon and accept an `icon` prop typed as `ForgeIcon<Name>`. Bind your app's sprite once with
`createIcon` and pass it at each call site:

```tsx
import { createIcon, Select, Spinner } from "@y-core/forge/ui/core";

// Bind the sprite URL once. Without a meta map, `name` is `string` (permissive).
const AppIcon = createIcon("/assets/icons.svg");

<Select name="country" icon={AppIcon}>
  <Select.Option value="us">United States</Select.Option>
  <Select.OptGroup label="Europe">
    <Select.Option value="uk">United Kingdom</Select.Option>
  </Select.OptGroup>
</Select>
<Spinner icon={AppIcon} size="md" />
```

`createIcon(sprite)` without a `meta` map yields a permissive `ForgeIcon<string>` for apps whose icon
set is dynamic; a `ForgeIcon<string>` is assignable to any narrower `ForgeIcon<Name>` by
contravariance, so the same `AppIcon` can satisfy `ThemeToggle`'s `ForgeIcon<"sun"|"moon"|"monitor">`
or `Select`'s `ForgeIcon<"chevron-down">`.

By default an icon is decorative (`aria-hidden="true"`, no accessible name). Pass `aria-label` to turn
it into a labelled graphic — the `<svg>` then emits `role="img"` with that label and drops
`aria-hidden`, so screen readers announce it:

```tsx
<AppIcon name="download" aria-label="Download report" />
// → <svg role="img" aria-label="Download report">…</svg>
```

#### `cn`, `asClass`, and `cva` — class utilities

`cn`, `asClass`, and `cva` are ratified `@public` utilities. `cn(...classes)` is variadic over
`string | false | null | undefined` — it drops falsy entries and joins the rest with a space (use
short-circuit expressions for conditionals; it does not interpret arrays or objects). `asClass(cls)`
narrows an untyped JSX `class` prop to `string | undefined`. `cva(config)` is the class-variance
authority — build a variant function once from a `{ base?, variants?, defaultVariants? }` object, then
call it with a variant map (plus an optional `class` override) to resolve a class string:

```tsx
import { cn, asClass, cva } from "@y-core/forge/ui/core";

const button = cva({
  base: "inline-flex items-center rounded-md font-medium",
  variants: {
    variant: { primary: "bg-primary text-white", outline: "border border-input bg-transparent" },
    size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-base" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

<button class={cn(button({ variant: "outline" }), asClass(className), isLoading && "opacity-50")}>Click</button>
```

#### `Turnstile` — server-rendered CAPTCHA mount point

`Turnstile` renders a `[data-ref='turnstile']` container (with `data-sitekey` / `data-size`) holding a
hidden `[data-ref='turnstile-fallback']` alert. Place it **inside** the `<form>` so the token input
Cloudflare injects is submitted with it, then pair it with the arg-less `mountTurnstile()` controller
from `@y-core/forge/ui/client`, which owns rendering and the widget lifecycle. It deliberately omits
Cloudflare's `cf-turnstile` auto-render class so the lifecycle stays deterministic.

```tsx
import { Form, Turnstile, Button } from "@y-core/forge/ui/core";

<Form hx-post="/api/contact" hx-target="#result">
  {/* form fields */}
  <Turnstile siteKey={turnstileSiteKey} size="normal" />
  <Button type="submit">Send</Button>
</Form>
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `siteKey` | `string` | — | Required; injected server-side from the Worker env, never hardcoded. |
| `size` | `"compact" \| "flexible" \| "normal"` | `"normal"` | Widget size hint (`data-size`). |
| `children` | `JSXNode` | generic prompt | Optional; overrides the default hidden fallback message. |

### Integration Guide

Render component trees inside a route handler with `renderToString` (`@y-core/forge/jsx`) and return
them through `fragmentResponse` or `htmlResponse` (`@y-core/forge/http`):

```tsx
import { renderToString } from "@y-core/forge/jsx";
import { fragmentResponse } from "@y-core/forge/http";
import { Alert } from "@y-core/forge/ui/core";

// HTMX fragment — no DOCTYPE, swapped into an existing document.
return fragmentResponse(await renderToString(
  <Alert variant="destructive">
    <Alert.Title>Submission Failed</Alert.Title>
    <Alert.Description>{message}</Alert.Description>
  </Alert>,
));
```

URL-valued attributes (`href`, `src`, `action`, `formaction`, …) are scheme-sanitized by the renderer,
so a `javascript:`-style value collapses to `"#"` in the emitted HTML.

### Types

`AlertVariant`, `BadgeVariant`, `ToastVariant`, `ToastPosition`, `FieldDescriptor`, `ForgeIcon`,
`IconProps`, `TurnstileProps`.

---

## `@y-core/forge/ui/core/client`

> Import path: `@y-core/forge/ui/core/client` → `src/ui/core/client.ts`
> **Browser-only, side-effect import.** esbuild entry points only. No exports.

### Features

- Registers the `toast` and `alert` resumable scopes — the client halves of the `Toast` and `Alert`
  primitives, and of every flash message rendered through `Flash` / `FlashContainer` / `FlashOob`.
- Registers the six **setup-only** scopes that give the keyboard-driven primitives their behaviour:
  `toolbar`, `menu`, `tabs`, `tooltip`, `collapsible` and `number-field`, plus the `toggle` action
  scope.

### Usage

```typescript
// src/client/main.ts (esbuild entry point):
import "@y-core/forge/ui/core/client";  // side-effect: registers the scopes
import { resume } from "@y-core/forge/ui/client";

resume();
```

**This import is not optional if the app renders toasts or dismissible alerts.** Without it the
components render correctly but never dismiss, and `resume()` `console.warn`s about the unregistered
`data-scope` — the failure is silent in the markup and loud only in the console.

### Core Components & APIs

| Scope | Contract |
|---|---|
| `toast` | `eager: true` — hydrates at `resume()` so a server-rendered toast can auto-close without waiting for a click. State key `duration` (milliseconds, serialized into `data-state` by `Toast`); a positive value schedules removal. One action, `dismiss`, which removes the toast root. |
| `alert` | Lazy. No state. One action, `dismiss`, which removes the alert root. |
| `toolbar` | `eager: true`. Mounts roving focus over `[data-toolbar-item]`. Reads the root's `data-orientation` to choose which arrows navigate, so a vertical rail needs no second declaration on the client. |
| `menu` | `eager: true`. Mounts the menu keyboard layer and transition state on the popup. |
| `tabs` | `eager: true`. Mounts selection, panel visibility and roving focus over the tablist. |
| `tooltip` | `eager: true`. Hover and focus intent on a `popover="hint"` surface. |
| `collapsible` | `eager: true`. Publishes the `<details>` element's own open state as state attributes — it never decides it. |
| `number-field` | `eager: true`. Wires the steppers to the input's native `stepUp` / `stepDown`. |
| `toggle` | Lazy. One action, `toggle`, which flips `aria-pressed` and `data-pressed` together. |

`toast` and `alert` remove their own root element, so there is nothing to tear down and no handle to
hold. **Every other scope here is `eager` out of necessity, not preference:** its markup carries no
`data-on-*` action, so a lazy scope would have nothing that could ever resume it and the widget
would sit inert on the page.

---

## `@y-core/forge/ui/controls`

> Import path: `@y-core/forge/ui/controls` → `src/ui/controls/mod.ts`

### Features

Pre-bound wrappers over the `ui/core` primitives — the "bound decoration" layer. The barrel exports
`Input`, `Textarea`, `Select`, `Slider`, `Switch`, and `ToggleGroup`. Each control mirrors its
`ui/core` sibling in name and prop shape, adding only a required `bind` prop (`data-field`) and an
optional `action` prop (`data-on-<event>` value). This static barrel is the **only** bound-control
API — there is no runtime factory to call. The five single-element wrappers are built from an
**internal** `createBoundControl(Core, { event, defaultAction })` helper (`@internal`, not exported);
`ToggleGroup` is bespoke because its binding lives on the `.Item` sub-component. Import `Switch` from
`@y-core/forge/ui/controls` and it's already decorated; import from `@y-core/forge/ui/core` for the
undecorated primitive. Alias to disambiguate if both are in scope:

```tsx
import { Switch } from "@y-core/forge/ui/controls";
import { Switch as SwitchPrimitive } from "@y-core/forge/ui/core";
```

### Usage

```tsx
import { Switch, Slider, Select, ToggleGroup } from "@y-core/forge/ui/controls";
import { bindField, bindGroup, registerScope, signalRecord } from "@y-core/forge/ui/client";
import { Resumable } from "@y-core/forge/ui/server";

// --- Server (SSR view) ---
<Resumable name="chrome" state={settings}>
  <Switch bind="gridVisible" checked={settings.gridVisible}>Grid</Switch>
  <Slider bind="fov" min={1} max={120} value={settings.fov} output />
  <Select bind="language" icon={AppIcon}>
    <Select.Option value="en">English</Select.Option>
  </Select>
  <ToggleGroup aria-label="Projection">
    <ToggleGroup.Item bind="projection" value="perspective" pressed={settings.projection === "perspective"}>
      Perspective
    </ToggleGroup.Item>
    <ToggleGroup.Item bind="projection" value="parallel" pressed={settings.projection === "parallel"}>
      Parallel
    </ToggleGroup.Item>
  </ToggleGroup>
</Resumable>

// --- Client ---
const sig = signalRecord(settings);
registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } });
```

### Core Components & APIs

| Export | Wraps | Binding |
|---|---|---|
| `Input` | `core/Input` | `bind` → `data-field`; `onInput` → `action` (default `"bindField"`) |
| `Textarea` | `core/Textarea` | `bind` → `data-field`; `onInput` → `action` (default `"bindField"`) |
| `Switch` | `core/Switch` | `bind` → `data-field`; `onChange` → `action` (default `"bindField"`) |
| `Slider` | `core/Slider` | `bind` → `data-field`; `onInput` → `action` (default `"bindField"`) |
| `Select` | `core/Select` | `bind` → `data-field`; `onChange` → `action` (default `"bindField"`); forwards required `icon`; re-exports `.Option`, `.OptGroup` |
| `ToggleGroup` | `core/ToggleGroup` | Bespoke (not `createBoundControl`-built): pass-through root; `.Item` adds `bind` → `data-field`, `value` → `data-value`, `onClick` → `action` (default `"bindGroup"`) |

**`bind` vs `field`:** the `bind` prop is orthogonal to the existing `field?: FieldDescriptor`. `field`
wires `id` / `name` / `aria-*` for form accessibility; `bind` wires `data-field` + `data-on-<event>`
for signal binding. Both may coexist on one control.

**`ToggleGroup.Item` + `bindGroup`:** the `.Item` takes a required `value` prop stamped as `data-value`.
Pair it with the client-side `bindGroup(signals)` action, which reads `data-field` + `data-value` on
click and writes the raw string into the matching signal, bypassing `parseControlValue` (button groups
can't express boolean/number values). The `bindField` action handles `Input` / `Textarea` / `Switch`
/ `Slider` / `Select`.

---

## `@y-core/forge/ui/contracts`

> Import path: `@y-core/forge/ui/contracts` → `src/ui/contracts/mod.ts`
> **Runtime-neutral.** Pure data and pure functions — no DOM, no Node built-ins, no side effects.
> Safe in a Worker, a browser bundle, or a build script.

### Features

The names forge's SSR components and its browser controllers **both** write, declared once so they
cannot drift. A state attribute or a scope name is written in two places that cannot see each other —
a `.tsx` running on the Worker and a `.ts` running in the browser — and drift between them is
*silent*: the selector stops matching, so the component looks unstyled rather than broken.

**That argument reaches one step further out, which is why these are published rather than internal.**
An app consuming forge's components has to address the same DOM — stamp a `data-scope`, select on
`data-open`, mark an element `data-toolbar-item`. With no export its only option is to re-type each
name as a string literal, making it a third writer of the same attribute, in a repository forge's gate
cannot see.

### Usage

```typescript
import { applyStateAttrs, MENU_ITEM_SELECTOR, SCOPE_EVENTS, TOOLBAR_ITEM_ATTR } from "@y-core/forge/ui/contracts";

// Reconcile a live element's published state — never hand-write `data-open` / `data-closed`.
applyStateAttrs(panel, { open: true });

// Build a row the Menu controller will navigate, with nothing forge-specific to remember.
row.setAttribute("role", "menuitem");
row.matches(MENU_ITEM_SELECTOR);   // → true
```

**Import the modules, not the barrel, in code you bundle.** `@y-core/forge/ui/contracts` is a
convenience for a consumer; forge's own components import each module directly
(`../contracts/state-attrs`) so a bundle retains one table rather than eight.

### Core Components & APIs

| Export | Kind | Description |
|---|---|---|
| `STATE_ATTRS` | `const` | Every state attribute forge emits, keyed by state name. Adding a styling hook means adding it here first — a component emitting one outside the table fails a conformance test. |
| `stateAttrs(state)` | function | Builds the attributes for an SSR element: `<div {...stateAttrs({ open, side, align })}>`. A falsy presence state emits nothing at all. |
| `applyStateAttrs(el, state)` | function | The browser half. Only the keys present in `state` are touched, and within a touched key reconciliation is total — `open: false` clears `data-open` **and** writes `data-closed` in one call. |
| `SCOPE_EVENTS` | `const` tuple | `["click", "input", "change", "submit"]` — the events a resumable scope delegates on. **There is no `keydown`, by decision:** a composite controller owns keyboard at its own widget root, because arrow keys are scoped to a widget, not to a page region. |
| `MENU_SCOPE`, `MENU_ITEM_SELECTOR` | `const` | The Menu popup's scope name, and its items **by ARIA role** rather than by a forge marker — so a row built in the browser is navigable the moment it is correctly roled. |
| `TOOLBAR_SCOPE`, `TOOLBAR_ITEM_ATTR`, `TOOLBAR_ITEM_SELECTOR` | `const` | The Toolbar root's scope name and its roving-focus stop marker. An explicit marker rather than a `data-slot^='toolbar-'` prefix match, because `Toolbar.Group` and `Toolbar.Separator` are toolbar slots that must **not** be focus stops. |
| `TABS_SCOPE`, `TAB_SELECTOR`, `TABLIST_SELECTOR` | `const` | Tabs' scope name and its two role selectors. |
| `TOGGLE_SCOPE`, `COLLAPSIBLE_SCOPE`, `TOOLTIP_SCOPE`, `NUMBER_FIELD_SCOPE` | `const` | The remaining scope names registered by `@y-core/forge/ui/core/client`. |
| `TURNSTILE`, `TURNSTILE_SCRIPT_SRC`, `TURNSTILE_SCRIPT_TIMEOUT_MS` | `const` | The `data-ref` values, script URL and load budget shared by `<Turnstile>` and `mountTurnstile()`. |

**Boolean states are emitted by presence with an empty value — `data-open=""`, never `"true"`.**
`[data-open]` is a cheaper and more honest selector than `[data-open="true"]`. `aria-*` keeps its
`"true"` / `"false"` string form because WAI-ARIA requires it; the whole point of `data-pressed`
beside `aria-pressed` is that CSS should not have to read ARIA.

> **Consuming apps: match that grammar.** An app that writes `data-open="true"` onto a forge component
> puts one attribute name with two value grammars into a single document — precisely the drift this
> namespace exists to prevent, re-created one repository further out. Assert on presence
> (`toHaveAttribute("data-open", "")`), and pair it with the platform's own state
> (`toHaveJSProperty("open", true)`) where the element has one.

### Types

`StateAttrName`, `StateAttrsProps`, `Orientation`, `Side`, `Align`, `TransitionState`, `ScopeEvent`.

---

## `@y-core/forge/ui/assets`

> Import path: `@y-core/forge/ui/assets` → `src/ui/assets/mod.ts`

### Features

Forge owns all 7 of its UI glyphs: `spinner`, `chevron-down`, `hamburger`, `close` (in
`src/ui/assets/core/`) plus `sun`, `moon`, `monitor` (in `src/ui/assets/theme/`). The asset manifest
exposes them as a `SpriteSource[]` so the consumer's build config never has to hand-list forge's
internal filenames or reach into `node_modules` paths.

### Usage

```typescript
import { forgeUiSpriteSources } from "@y-core/forge/ui/assets";
import { defineAssets } from "@y-core/forge/assets";

export default defineAssets({
  spriteSources: [
    ...forgeUiSpriteSources(),          // forge's 7 glyphs, self-described
    { path: "./src/assets/icons", files: ["tool-select.svg", "tool-push-pull.svg", ...] },
  ],
  // …
});
```

`forgeUiSpriteSources()` returns two `SpriteSource` objects with absolute paths resolved via
`import.meta.url` — safe regardless of where forge is installed in `node_modules`.

### Core Components & APIs

| Export | Kind | Description |
|---|---|---|
| `forgeUiSpriteSources()` | function | Returns `SpriteSource[]` for all forge UI glyphs. Spread into `spriteSources` in your assets config. |
| `FORGE_UI_ICON_NAMES` | `const` tuple | The 7 glyph names as a `readonly` tuple — use for type narrowing or validation. |
| `ForgeUiIconName` | type | `"spinner" | "chevron-down" | "hamburger" | "close" | "sun" | "moon" | "monitor"`. |
| `parseSpriteGlyphs`, `loadSpriteGlyphs` | functions | Re-exported from `ui/assets/glyphs` — see below for when to import them from the direct subpath instead. |

---

## `@y-core/forge/ui/assets/glyphs`

> Import path: `@y-core/forge/ui/assets/glyphs` → `src/ui/assets/glyphs.ts`
> **Runtime-neutral.** No DOM and no Node built-ins — safe in a browser bundle, a Worker, or a build
> script. `loadSpriteGlyphs` needs a `fetch` implementation.

### Features

- Parses a build-generated SVG sprite into a name-keyed glyph map, so an app can read a glyph's
  `viewBox` and inner markup at runtime — for a CSS custom cursor, an inline `<svg>`, or a canvas
  draw, none of which can use the `<use href="#icon-…">` indirection a `ForgeIcon` renders.

### Usage

```typescript
import { loadSpriteGlyphs } from "@y-core/forge/ui/assets/glyphs";

const glyphs = await loadSpriteGlyphs("/assets/icons.svg");   // {} on any failure
const move = glyphs.move;                                      // { viewBox, markup } | undefined
```

**Why this subpath exists.** These two functions are also re-exported from
[`@y-core/forge/ui/assets`](#y-coreforgeuiassets) — but that barrel also exports
`forgeUiSpriteSources()`, whose module imports `node:path` and `node:url`. Importing the parser from
the barrel therefore drags Node built-ins into a browser bundle. Import from
`@y-core/forge/ui/assets/glyphs` in client code and from `@y-core/forge/ui/assets` in build config.

### Core Components & APIs

| Export | Signature | Description |
|---|---|---|
| `parseSpriteGlyphs(svgText, prefix?)` | `GlyphSource` | Parses sprite text into `{ [name]: { viewBox, markup } }`. Only `<symbol>` ids starting with `prefix` (default `"icon-"`) are included, and the key is the bare name (`"move"` for `id="icon-move"`). |
| `loadSpriteGlyphs(url, prefix?)` | `Promise<GlyphSource>` | Fetches `url` and parses it. |

**Both degrade to `{}` and never throw** — on empty input, unparseable markup, a non-`ok` response,
or a network error. That is deliberate: a missing glyph map must leave the app on its stylesheet
default (e.g. the default cursor), not break boot. Callers must handle an absent key rather than
relying on a rejection.

### Types

`GlyphEntry` (`{ viewBox, markup }`), `GlyphSource` (`Record<string, GlyphEntry>`).

---

## `@y-core/forge/ui/client`

> Import path: `@y-core/forge/ui/client` → `src/ui/client/mod.ts`
> **Browser-only.** These exports reference `document` / `window` / `localStorage` and throw if
> imported in Worker-executed SSR code. Restrict imports to your client esbuild entry (`src/client/`).

### Features

- A framework-free reactive signals runtime (`createSignal`, `computed`, `effect`).
- The resumability-lite island runtime (`registerScope`, `resume`, `resumeScope`) — server-stamped
  state hydrated on first interaction, zero work at page load.
- DOM controllers (`mountNav`, `mountTurnstile`) — each idempotent and returning a cleanup
  function. `mountTurnstile()` is arg-less and drives the `<Turnstile>` ui/core mount point with a
  resilient, engagement-gated lifecycle.
- Generic control↔signal field binding (`bindField`, `bindGroup`, `parseControlValue`, `applyControlValue`).
- Lazy resource loading (`lazy`, `loadScriptOnEvent`, `loadStylesheet`).

### Usage

```typescript
import { mountNav, mountTurnstile, resume } from "@y-core/forge/ui/client";

mountNav();
mountTurnstile();         // resilient Cloudflare Turnstile (renders the <Turnstile> mount point)
resume();                 // install the single delegated island listener
```

Theme is **not** a controller here — it is a resumable scope registered by
[`@y-core/forge/ui/chrome/client`](#y-coreforgeuichromeclient).

### Core Components & APIs

#### Signals runtime

```typescript
import { createSignal, computed, effect } from "@y-core/forge/ui/client";

const count = createSignal(0);
const doubled = computed(() => count.value * 2);
effect(() => console.log("doubled:", doubled.value)); // runs immediately, then on change
count.value = 5;                                       // logs "doubled: 10"
```

| Export | Signature | Description |
|---|---|---|
| `createSignal<T>(initial)` | `Signal<T>` | Reactive cell; reading `.value` inside an `effect`/`computed` subscribes. |
| `computed<T>(fn)` | `ReadonlySignal<T>` | Derived read-only signal, recomputed on dependency change. |
| `effect(fn)` | `() => void` | Runs `fn` immediately, re-runs on change; returns a disposer. |
| `signalRecord(initial)` | `SignalRecord<T>` | One independent signal per key of `initial`. |
| `writeSignal(rec, key, value)` | `void` | Typed per-key writer for a `SignalRecord`. |

#### Resumable islands

The island pattern: the server marks an interactive region with a `data-scope` name and serialized
`data-state` (via the `Resumable` component from `@y-core/forge/ui/server`); the client registers the
scope's setup + action handlers and installs one delegated listener. A scope resumes on the **first**
interaction with any descendant carrying a `data-on-<event>` attribute — `data-state` is rebuilt into
signals, `setup` runs once, then the named action fires.

```typescript
import { registerScope, resume, effect } from "@y-core/forge/ui/client";

registerScope("counter", {
  setup: ({ root, state }) => {
    const out = root.querySelector("[data-ref='out']");
    effect(() => { if (out) out.textContent = String(state.count.value); });
  },
  on: {
    inc: ({ state }) => { (state.count.value as number)++; },
  },
});

resume(); // idempotent — a second call is a no-op and returns the same teardown
```

| Export | Signature | Description |
|---|---|---|
| `registerScope<A>(name, def)` | `void` | Registers a scope's `setup` + `on` action map under a `data-scope` name. |
| `resume()` | `() => void` | Installs one delegated listener per supported event; returns a teardown. Idempotent. |
| `resumeScope(root)` | `Record<string, Signal<unknown>> \| undefined` | Resumes a single scope element now; returns its signal state. |

A `ScopeDefinition` has `eager?` (resume at `resume()` time, not on first interaction), `setup?` (bind
DOM effects once), and `on` (action handlers keyed by `data-on-<event>` value). Handlers receive a
`ResumeContext` (`{ root, el, state }`).

#### Field binding

Pair the SSR `fieldAttr` / `scopeAttrs` helpers (from `@y-core/forge/ui/server`) with `bindField` to
two-way-bind controls to a `SignalRecord` with no per-field wiring. forge owns the generic glue; the app
layers its own effects (persist, render) on the same signals.

```typescript
import { bindField, signalRecord, registerScope } from "@y-core/forge/ui/client";

const sig = signalRecord({ gridVisible: true, fov: 50 });
registerScope("settings", { on: { bindField: bindField(sig) } });
```

`bindField(signals)` reads the control's `data-field` attribute, parses its value by the target signal's
current type, and writes `signals[field]`. `parseControlValue(el, current)` does the typed parse
(boolean → `checked`, number → `Number(value)`, else `value` string); `applyControlValue(el, value)` is
the inverse — seed an uncontrolled input from a typed value after a programmatic reset.

`bindGroup(signals)` is the companion action for button-group (segmented) controls stamped by
`controls/` `ToggleGroup.Item`. On click it resolves the nearest ancestor with both
`data-field` and `data-value` via `closest("[data-field][data-value]")` — handling clicks on inner
`<svg>` or `<span>` — then writes the raw `data-value` string into `signals[field]`, bypassing
`parseControlValue` (button groups can't express boolean or numeric values). Register it alongside
`bindField`:

```typescript
import { bindField, bindGroup, signalRecord, registerScope } from "@y-core/forge/ui/client";

const sig = signalRecord({ gridVisible: true, fov: 50, projection: "perspective" });
registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } });
```

#### Controller primitives

Three modules no consumer mounts directly, and every controller above is built out of. They are
`@public` because an app writing its own controller needs the same guarantees.

| Export | What it gives you |
|---|---|
| `ownerDocument(node)` / `ownerWindow(node)` | the document and window **that node belongs to** — a controller inside an iframe must not install listeners on the top-level document |
| `activeElement(node)` | the *deeply* focused element, descending through open shadow roots. `document.activeElement` stops at the host |
| `eventTarget(event)` | the element actually hit, via `composedPath()`, before shadow retargeting rewrote `event.target` to the host |
| `asElement(target)` | narrows without `instanceof`, so an element from another realm is accepted rather than silently discarded |
| `closestAcross(node, sel)` / `contains(parent, child)` | `closest` and `contains` that step over shadow boundaries |
| `mountRovingFocus(root, opts)` | the composite controller — one tab stop, arrow keys, Home/End, typeahead, RTL, disabled-item skip, focus restoration. Returns a disposer |
| `mountTransitionState(el)` | publishes `data-starting-style` / `data-ending-style` around an open or close, reconciled with `data-open` / `data-closed`. One controller, never per-component animation code |
| `mountPopupTriggerState(popup)` | the same observation pointed the other way — publishes `data-popup-open` on the popup's **invokers** while it is open |
| `openPopoverAt(el, x, y, opts?)` | opens a native popover at a viewport coordinate, clamped on screen, for a popup that has no invoker to anchor to |

`mountRovingFocus` takes `{ items, orientation?, loop?, typeahead?, typeaheadTimeout? }` and resolves
its items **live from the DOM on every interaction**, so a widget whose rows are rebuilt between
openings needs no re-mounting. Mark the item that should hold the tab stop on mount with
`ACTIVE_COMPOSITE_ITEM` (`data-composite-item-active`) — the pressed tool, the selected tab, the
checked radio.

Three behaviours are worth knowing because they are easy to assume away: arrow keys inside a **text
field** belong to the caret until it reaches the edge of the text; direction is read from the
**element**, not from a global, so an RTL island inside an LTR page navigates as RTL; and an item
that is in the DOM but not rendered — a closed submenu's row, a filtered-out link — is not in the
ring at all.

**Every controller returns a disposer, and that is a contract.** Return it from a scope's `setup`
and `resume()`'s teardown runs it; a controller that cannot be disposed leaks a listener on every
re-resume.

#### Menu, tabs, tooltip and number-field controllers

`mountMenu(popup, opts?)`, `mountTabs(root, opts?)`, `mountTooltip(root)` and
`mountNumberField(root)` are the controllers the `ui/core/client` scopes mount. Call them directly
only when the markup is somewhere `resume()` cannot reach — inside a shadow root, say.

`mountMenu` **opens and closes nothing**: the Popover API owns that, and an item closes the menu
through `command="hide-popover"` in the markup. What it adds is what ARIA's menu pattern asks for
and the platform does not supply — arrow navigation, typeahead, focus on the first item at open, and
focus back on the opener at close. The opener is *captured* rather than derived from `commandfor`,
because a context menu has no single trigger button, and focus is only reclaimed when the close
actually stranded it.

#### Coordinate placement — `openPopoverAt`

Every other popup in forge is positioned by CSS Anchor Positioning against its invoker: a popover's
implicit anchor is the button its `commandfor` names, and the whole placement set in `theme-base.css`
is keyed off `anchor()`. **A context menu has no invoker** — it opens where a right-click landed, on
an element that is not a trigger — so every anchored rule resolves to nothing and the UA's `[popover]`
default centres the panel in the viewport.

```typescript
import { openPopoverAt } from "@y-core/forge/ui/client";

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openPopoverAt(menu, event.clientX, event.clientY);   // { margin } keeps a gap at each edge
});
```

The popup opts in with `Menu.Popup`'s `coords` prop (or the `data-coords` attribute directly), which
selects the coordinate rule; `openPopoverAt` also stamps it, so a popup that opens both ways needs no
second markup variant. Coordinates travel as `--anchor-x` / `--anchor-y` written through **CSSOM**,
never as a generated `style` attribute — forge's CSP carries no `style-src 'unsafe-inline'`, and the
JSX renderer drops `style` outright. Calling it again with a new point **repositions** an open popup
rather than closing and reopening it. The position is clamped to the viewport, so a menu opened at any
edge is fully on screen.

#### Nav and Turnstile controllers

`mountNav(options?)` wires the navigation toggle: open/close, outside-click and Escape to close, and
auto-close on link click.

`mountTurnstile()` is **arg-less** and returns a cleanup function. It drives the `<Turnstile>` ui/core
component (rendered inside a `<form>`), finding the `[data-ref='turnstile']` widget and its enclosing
form via `widget.closest("form")` — no selectors or options to configure. It is **engagement-gated**
(loads Cloudflare's script once on the first `focusin` within the form, then explicitly renders the
widget — no auto-render, no global callbacks), **self-healing** (resets the single-use token after
every completed submission via `htmx:afterRequest` and on expiry/timeout, clearing the form only on
success), and **fails visible** (reveals the widget's hidden fallback message on load/render failure).
The submit button is intentionally **not** gated — the server `verifyTurnstile` is the single
fail-closed enforcement point. The site key and size are read from the widget's `data-sitekey` /
`data-size` attributes (injected server-side, never hardcoded); the theme follows the app's resolved
theme (`.dark` on `<html>`) at render time. Pair it with the `<Turnstile siteKey=… />` component from
`@y-core/forge/ui/core`.

#### Lazy loading

```typescript
import { lazy, loadScriptOnEvent, loadStylesheet } from "@y-core/forge/ui/client";

// Defer a dynamic import until its anchor element scrolls into view (IntersectionObserver).
lazy({ ref: "map-section", load: () => import("./map"), init: (mod, el) => mod.initMap(el) });

// Inject a <script> on the first occurrence of an event (with optional SRI).
loadScriptOnEvent({
  triggerSelector: "[data-ref='widget']",
  event: "focus",
  scriptSrc: "https://example.com/widget.js",
  integrity: false,
});

// Inject a stylesheet; resolves on load, rejects on error.
await loadStylesheet("/print.css", false);
```

`lazy` takes a `LazyImportOptions<T>` object (`ref`, `load`, `init`, optional `rootMargin` / `threshold`)
and returns a disposer. `loadScriptOnEvent` takes a `LazyLoadOptions` object; `integrity` is an SRI hash
string or `false` to opt out (`false` skips `crossOrigin`).

### Integration Guide

This namespace is browser-only. Import it exclusively from your client esbuild entry (e.g.
`src/client/main.ts`) or from a `<script>` that references the built bundle. Never import it in
`src/views/`, route handlers, or any code the Worker executes — Cloudflare Workers has no DOM and the
import throws at runtime.

### Types

`Signal`, `ReadonlySignal`, `SignalRecord`, `ResumeContext`, `ScopeDefinition`, `LazyImportOptions`,
`LazyLoadOptions`, `NavControllerOptions`.

---

## `@y-core/forge/ui/server`

> Import path: `@y-core/forge/ui/server` → `src/ui/server/mod.ts`
> **SSR-only.** These run in Workers/SSR contexts; never bundle them into the browser.

### Features

- Flash messages — cookie-backed, one-shot, rendered as toasts (`createFlash`, `Flash`,
  `FlashContainer`, `FlashOob`).
- The server half of the resumability island pattern (`Resumable`, `scopeAttrs`, `fieldAttr`).

### Usage — flash messages

```typescript
import { createFlash } from "@y-core/forge/ui/server";

const flash = createFlash({ secrets: [env.SESSION_SECRET] });

// In a POST handler — queue a message into the signed cookie:
await flash.success(c, "Profile saved.");
// then redirect; the next page reads + clears it.

// In the next page's loader:
const messages = await flash.get(c); // [{ type: "success", text: "Profile saved." }]
```

Render the messages in the page shell. Use `FlashContainer` for the SSR-on-load case, or `FlashOob` to
inject toasts via an HTMX out-of-band swap into `#flash-container`:

```tsx
import { FlashContainer, FlashOob } from "@y-core/forge/ui/server";

// On full page render:
<FlashContainer messages={messages} position="bottom-right" />

// In an HTMX fragment response — swaps toasts into the existing container:
<FlashOob messages={messages} />
```

> **Flash toasts are scoped components.** `Flash` / `FlashContainer` / `FlashOob` render `Toast`,
> which drives dismiss and timed auto-close through the `toast` resumable scope. Registering that
> scope is a **side-effect import** — the app's client entry must
> `import "@y-core/forge/ui/core/client"` **before** calling `resume()`, or the toasts render but
> never dismiss and `resume()` `console.warn`s about the unregistered `data-scope`. See
> [`@y-core/forge/ui/core/client`](#y-coreforgeuicoreclient) and
> [`UI_SSR_COMPONENTS.md`](../../.decisions/UI_SSR_COMPONENTS.md) §2d.

### Core Components & APIs

| Export | Kind | Description |
|---|---|---|
| `createFlash(options)` | factory | Returns a `Flasher` over a signed cookie. Convenience methods `success` / `info` / `warning` / `error`, plus `set` / `get`. |
| `Flash` | component | Renders an array of `FlashMessage` as dismissible toasts. |
| `FlashContainer` | component | A `Toast.Container` wrapping `Flash` — use on full page render. |
| `FlashOob` | component | Wraps each toast in an HTMX OOB-swap div targeting `#flash-container`. |
| `Resumable` | component | Wraps children in a `data-scope` + serialized `data-state` island. |
| `scopeAttrs(props)` | helper | Builds typed `data-on-<event>` delegation attributes for a scope. |
| `fieldAttr(name)` | helper | Stamps `data-field` so the client `bindField` action knows which signal to write. |

`createFlash(options)` takes `FlashCookieOptions` (`secrets`, optional `name` / `path` / `maxAge` /
`sameSite`); defaults are `name: "flash"`, `path: "/"`, `maxAge: 60`, `sameSite: "Lax"`. `flash.get`
clears the cookie as it reads — messages are one-shot.

### Integration Guide — resumable islands

`Resumable` is the SSR half of the island pattern documented under `@y-core/forge/ui/client`. The `name`
must match the client-side `registerScope`; `state` is the serializable object rehydrated into signals:

```tsx
import { Resumable, scopeAttrs, fieldAttr } from "@y-core/forge/ui/server";

<Resumable name="settings" state={{ gridVisible: true }}>
  <Switch {...scopeAttrs({ onChange: "bindField" })} {...fieldAttr("gridVisible")} checked={true} />
</Resumable>
```

`scopeAttrs` and `registerScope` are both generic over the action-name union, so a typo in an action
name is a compile error and client + server share one action namespace. `Resumable` performs no eager
hydration — the scope resumes on the first interaction with any descendant carrying `data-on-<event>`.

### Types

`FlashMessage`, `FlashType`, `FlashCookieOptions`, `Flasher`, `ResumableProps`, `ScopeAttrsProps`.

---

## `@y-core/forge/ui/chrome`

> Import path: `@y-core/forge/ui/chrome` → `src/ui/chrome/mod.ts`
> **SSR-only.** These are JSX components and plain constants rendered in Workers/SSR contexts. Their
> interactive halves are resumable scopes registered by `@y-core/forge/ui/chrome/client`.

### Features

- `Navbar` — a configuration-driven responsive navbar/menubar built from a nested `NavDefinition`.
  Desktop renders a horizontal bar of native `Popover` dropdowns (top-layer, light-dismiss, zero JS);
  mobile collapses to a hamburger-toggled `<details>`. Items may carry auth `filters`.
- `Toolbar` — a configuration-driven icon rail with placement-aware flyouts, built from a
  `ToolbarDefinition` and generic over the app's action-name union.
- `ThemeToggle` — a three-icon theme-cycle button wrapped in the `theme` resumable scope.
- Theme constants shared by the SSR view and the client scope, including the FOUC-prevention inline
  script `FOUC_SCRIPT`. This module performs no DOM access, so it is safe to import server-side.

### Usage

```tsx
import { Navbar, ThemeToggle, Toolbar, type NavDefinition, type ToolbarDefinition } from "@y-core/forge/ui/chrome";
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

const nav: NavDefinition = {
  sections: [
    { items: [{ label: "Home", href: "home" }, { label: "Docs", items: [{ label: "Guides", href: "guides" }] }] },
    { items: [{ slot: "user_name" }, { label: "Sign out", href: "signout", filters: ["user"] }] },
  ],
};

const tools: ToolbarDefinition<"selectTool" | "addLayer"> = {
  groups: [
    { items: [{ kind: "action", icon: "cursor", label: "Select", action: "selectTool", active: true }] },
    { items: [{ kind: "popover", icon: "layers", label: "Layers", content: <LayerList />,
               titleAction: { icon: "plus", label: "Add layer", action: "addLayer" } }] },
  ],
};

<Navbar config={nav} resolveHref={routes.url} slots={{ user_name: <span>{user.name}</span> }}
        activeFilters={user ? ["user"] : []} icon={AppIcon} />
<Toolbar config={tools} icon={AppIcon} placement="left" />
<ThemeToggle icon={AppIcon} />
```

### Core Components & APIs

| Export | Kind | Description |
|---|---|---|
| `Navbar` | component | Renders `NavbarProps.config`. Required: `config`, `resolveHref`, `icon` (`ForgeIcon<"chevron-down" \| "hamburger" \| "close">`). Optional: `slots`, `activeFilters`, `placement` (default `"top"`), `class`, plus `<nav>` pass-through. |
| `Toolbar` | component | Renders `ToolbarProps.config`. Required: `config`, `icon` (`ForgeIcon<string>`). Optional: `placement` (default `"left"`), `commandTarget`, `id`, `class`, plus `<nav>` pass-through. |
| `ThemeToggle` | component | Theme-cycle button. Required: `icon` (`ForgeIcon<"sun" \| "moon" \| "monitor">`). Optional: `size` (default `20`), `class`. |
| `FOUC_SCRIPT` | `const` string | Inline script that applies the stored preference before first paint. |
| `THEME_ATTR` | `const` string | `"data-theme-preference"` — the `<html>` attribute recording the active preference. |
| `THEME_STORAGE_KEY` | `const` string | `"themePreference"` — the `localStorage` key. |
| `DARK_CLASS` | `const` string | `"dark"` — the class toggled on `<html>`. |
| `DEFAULT_PREF` | `const` string | `"system"` — the server default, resolved against the OS preference client-side. |

**`Navbar` config shape.** A `NavDefinition` is `{ sections: NavSection[] }`; a `NavSection` is
`{ items: NavItem[] }`; a `NavItem` is a `NavLink` (`label`, `href`, `filters?`), a `NavMenu`
(`label`, `items`, `filters?` — recurses for nested submenus), or a `NavSlot` (`slot`, `label?`,
`filters?`). Sibling sections spread across the bar via `justify-between`. `NavPlacement` is
`"top" | "bottom" | "left" | "right"`.

Two rules the type does not express: **`href` is a route-map key, never a URL** — it is always passed
through the required `resolveHref`, so links cannot be hardcoded; and a `NavSlot.slot` that is a
`string` is looked up in the `slots` map, while a `JSXNode` is rendered inline.

**Auth filters.** An item with `filters` shows only when one of its tokens is in the active set.
`activeFilters` seeds that set server-side for a flash-free first paint; at runtime the app pushes a
new set by dispatching `new CustomEvent("navbar:filters", { detail: tokens })` on `document`, which
the `navbar` scope applies to every `[data-filter]` descendant.

**`Toolbar` config shape.** A `ToolbarDefinition<A>` is `{ groups: ToolbarGroup<A>[] }` (a separator
is auto-emitted between sibling groups); a `ToolbarGroup<A>` is `{ items: ToolbarItem<A>[] }`; a
`ToolbarItem<A>` is a `ToolbarAction<A>` (`kind: "action"` — `icon`, `label`, `action`, optional
`dispatch`, `ref`, `data`, `active`, `size`), a `ToolbarPopover<A>` (`kind: "popover"` — `icon`,
`label`, `content`, optional `ref`, `compact`, `titleAction`), a `ToolbarSeparator`
(`kind: "separator"`), or a `ToolbarSlot` (`kind: "slot"`, `slot`). A `ToolbarTitleAction<A>`
(`icon`, `label`, `action`, `ref?`) is the button stamped inline on a flyout's title row.
`ToolbarPlacement` is `"left" | "right" | "top" | "bottom"`.

The generic `A` is the app's action-name union, shared with `registerScope<A>` — a typo in an action
name is a compile error on both sides. An action item dispatches through the scope (`data-on-click`,
the default) or through the native Invoker `CommandEvent` bridge with `dispatch: "command"`, which
emits `command="--action"` against the `commandTarget` element id; both land in the same `on` table.
Give a rail an explicit `id` when two rails share a `placement` — flyout ids are namespaced by
`id ?? placement`, and two rails minting the same id would cross-link their `commandfor` triggers.

### Integration Guide

Chrome is SSR markup plus a client island. Three wiring steps, all required:

1. **Register the scopes.** The app's client entry must side-effect-import
   `@y-core/forge/ui/chrome/client` **before** calling `resume()`, or `Navbar` renders without runtime
   auth filtering, `ThemeToggle` does nothing on click, and `resume()` `console.warn`s about the
   unregistered `data-scope`.
2. **Stamp `FOUC_SCRIPT` into `<head>`** so the theme is applied before first paint, and add its hash
   to the CSP `script-src` — it is an inline script and carries no nonce:

   ```tsx
   import { FOUC_SCRIPT } from "@y-core/forge/ui/chrome";
   import { rawHtml } from "@y-core/forge/http";

   <script>{rawHtml(FOUC_SCRIPT)}</script>
   ```

3. **Ship the theme CSS.** `ThemeToggle` renders its three icons inside `theme-light-icon`,
   `theme-dark-icon`, and `theme-system-icon` spans; which one is visible is decided entirely by CSS
   keyed off `html[data-theme-preference]` in `src/ui/assets/css/forge-ui.css`. Those class names are
   a contract — rename one and the toggle renders all three glyphs at once. The same mechanism gives
   the button its accessible name: each span carries an `sr-only` label, and the CSS that shows one
   span hides the other two with `display: none`, which also removes them from the accessible-name
   computation. So the name says which theme is active, with no JavaScript and no `aria-label` that
   could disagree with the glyph.

#### The contracts chrome's markup carries

| Component | What it stamps |
|---|---|
| `Toolbar` | `role="toolbar"`, `data-scope="toolbar"`, and `data-orientation` / `aria-orientation` — `vertical` for a `left` or `right` rail, `horizontal` for `top` or `bottom`. Every action and every popover trigger carries `data-toolbar-item`, so the whole rail is **one tab stop**. Separators are `<hr aria-orientation>`, whose axis is *across* the rail. |
| `Navbar` | Bar-level dropdowns are `core/Menu`; rows below the bar are `Menu.SubmenuTrigger` and `Menu.LinkItem`. Each popup carries `data-scope="menu"`. |
| `ThemeToggle` | `data-scope="theme"`, and three `sr-only` labels rather than one static `aria-label`. |

**A flyout's title action is deliberately *not* a rail stop.** Roving focus queries the whole `<nav>`
subtree and a flyout is inside it, so marking that button would splice flyout content into the rail's
arrow-key ring.

**`Navbar` is not a `role="menubar"`,** and that is a decision rather than an omission: a menubar
owes its triggers a roving tab stop of their own, forge has no menubar controller, and claiming the
role without the behaviour announces a keyboard interface that is not there. A bar-level link stays a
plain link for the same reason — a link on a bar is not a menu item.

**The rail carries `data-scope="toolbar"`, so an app action fired from inside it now passes through a
scope on its way up.** That is safe by design: action routing continues to the enclosing scope when
the inner one's table does not have the action. It is called out because it is the change most likely
to look like it should break a consumer's tool buttons, and does not.

The glyphs every chrome component needs (`chevron-down`, `hamburger`, `close`, `sun`, `moon`,
`monitor`) all ship in `forgeUiSpriteSources()` — see [`@y-core/forge/ui/assets`](#y-coreforgeuiassets).

### Types

`NavbarProps`, `NavDefinition`, `NavSection`, `NavItem`, `NavLink`, `NavMenu`, `NavSlot`,
`NavPlacement`, `ToolbarProps`, `ToolbarDefinition`, `ToolbarGroup`, `ToolbarItem`, `ToolbarAction`,
`ToolbarPopover`, `ToolbarSeparator`, `ToolbarSlot`, `ToolbarTitleAction`, `ToolbarPlacement`,
`ThemeToggleProps`.

---

## `@y-core/forge/ui/chrome/client`

> Import path: `@y-core/forge/ui/chrome/client` → `src/ui/chrome/client.ts`
> **Browser-only, side-effect import.** esbuild entry points only.

### Features

- Registers the `theme` and `navbar` resumable scopes — the client halves of `ThemeToggle` and
  `Navbar`. Registration happens at module load; no DOM is touched until a scope resumes.
- **Side-effect-imports `@y-core/forge/ui/core/client`.** Chrome's markup names the `menu` and
  `toolbar` scopes, and a component whose markup names a scope has to guarantee the scope exists —
  otherwise an app importing only this module gets `resume()` warnings and a navbar and toolbar that
  are dead to the keyboard. Importing both is harmless; registration is idempotent.
- Exports `isDark`, a `ReadonlySignal<boolean>` tracking the resolved theme.

### Usage

```typescript
// src/client/main.ts (esbuild entry point):
import "@y-core/forge/ui/chrome/client";  // side-effect: registers the scopes
import { resume } from "@y-core/forge/ui/client";

resume();  // hydrates the eager `theme` and `navbar` scopes now, plus every core scope
```

To react to the resolved theme, import the signal by name:

```typescript
import { isDark } from "@y-core/forge/ui/chrome/client";
import { effect } from "@y-core/forge/ui/client";

effect(() => renderer.setBackground(isDark.value ? "#111" : "#fff"));
```

`isDark` is a **stable binding** — a fixed object whose `.value` getter delegates to whichever signal
the theme scope currently owns — so it is safe to destructure or capture before `resume()` runs. It
reads `false` until the theme scope resumes.

### Core Components & APIs

| Scope | Contract |
|---|---|
| `theme` | `eager: true` — hydrates at `resume()`, not on first interaction, so the preference reconciles without waiting for a click. State key `pref`. One action, `cycleTheme`, advancing `light → dark → system → light`. `setup` reconciles `pref` against `localStorage` (the FOUC script already applied it), then keeps `THEME_ATTR`, `localStorage`, and the `DARK_CLASS` on `<html>` in sync, tracking `(prefers-color-scheme: dark)` for the `system` case. |
| `navbar` | `eager: true`. State key `filters`. No actions — `setup` alone syncs `hidden` on every `[data-filter]` descendant and listens for the `navbar:filters` document event. Eager out of necessity: the navbar's markup emits no `data-on-*` anywhere (native `<details>`, native popovers, plain links), so a lazy scope would have nothing to resume it and auth filtering would silently never run. |

| Export | Type | Description |
|---|---|---|
| `isDark` | `ReadonlySignal<boolean>` | Whether the resolved theme is dark (`pref === "dark"`, or `pref === "system"` with a matching media query). |

### Integration Guide

Both scopes return a disposer from `setup`, and **`resume()` owns teardown** — the disposers it
collects run when the teardown function `resume()` returned is called. There is nothing for the caller
to unmount, and no controller handle to hold: importing this module and calling `resume()` is the
whole lifecycle. The import must come **before** `resume()`, since the eager `theme` pass only
hydrates scopes registered by then.

---

## `@y-core/forge/ui/client/htmx`

> Import path: `@y-core/forge/ui/client/htmx` → `src/ui/client/htmx.ts`
> **Browser-only, side-effect import.** esbuild entry points only.

### Features

- Pins the `htmx.org` bundle version through the forge package.
- Attaches `htmx` to `window` and configures it (`htmx.config.includeIndicatorStyles = false`).

### Usage

```typescript
// src/client/main.ts (esbuild entry point):
import "@y-core/forge/ui/client/htmx"; // side-effect only — no exports used
```

This module runs for its side effects: it imports the htmx bundle and disables htmx's built-in indicator
styles. It also re-exports `htmx` for the rare case a call site needs the instance directly, but the
canonical usage is the bare side-effect import above. Mark the import so esbuild does **not** tree-shake
it, and never import htmx from a CDN — this entry pins the version through forge.

---

## `@y-core/forge/ui/show`

> Import path: `@y-core/forge/ui/show` → `src/ui/show/mod.ts`

### Features

- A drop-in, living reference page for every `@y-core/forge` UI component — static catalog, HTMX demos,
  theme toggle, and a resumability island.
- Route helpers (`load*` / `render*`) and a single path table (`showcasePaths`) so the page and its API
  endpoints never drift.

### Usage

`ShowcaseContent` is layout-less — wrap it in your app's `Layout`. It needs the showcase data and an
`icon` prop (a `ForgeIcon` supplying forge's required glyphs — all present if you include
`forgeUiSpriteSources()` in your assets config):

```tsx
import { loadShowcase, ShowcaseContent } from "@y-core/forge/ui/show";
import { renderPage } from "@y-core/forge/jsx";

export function showcasePage(c, icon) {
  const data = loadShowcase(c, { basePath: "/showcase" });
  return renderPage(<Layout><ShowcaseContent data={data} icon={icon} /></Layout>);
}
```

### Core Components & APIs

| Export | Kind | Description |
|---|---|---|
| `ShowcaseContent` | component | The full showcase page body. |
| `showcasePaths(basePath, apiPath?)` | helper | Returns all showcase URL paths derived from a base path. |
| `loadShowcase` | loader | Builds `ShowcaseData` (`{ paths }`) for the page. |
| `loadPreview` / `renderPreview` | loader / renderer | Variant + size preview demo. |
| `loadValidate` / `renderValidate` | loader / renderer | Inline validation demo. |
| `loadSearch` / `renderSearch` | loader / renderer | Live search demo. |
| `loadPaginate` / `renderPaginate` | loader / renderer | Pagination demo. |
| `loadDependent` / `renderDependent` | loader / renderer | Dependent-select demo. |
| `loadToast` / `renderToast` | loader / renderer | Toast trigger demo. |

Each `render*` helper serializes its fragment with `renderToString` and returns a `fragmentResponse`.
The `*Section` and `*Fragment` JSX components (`PreviewSection`, `ValidateSection`, …) and the
`SHOW_*_ID` target IDs are also exported for apps that compose the demos individually.

### Integration Guide

Wire each route to its `load*` + `render*` pair, using `showcasePaths` as the single source of truth for
both the page and the HTMX API endpoints. The `render*` helpers that include an icon-bound component
(`renderPreview`, `renderDependent`) take the same bound icon as `ShowcaseContent`.

### Types

`ShowcaseData`, `ShowcasePaths`, `PreviewData`, `ValidateData`, `SearchData`, `PaginateData`,
`DependentData`, `ToastData`.

---

## `@y-core/forge/ui/show/client`

> Import path: `@y-core/forge/ui/show/client` → `src/ui/show/client.ts`
> **Browser-only, side-effect import.**

### Features

- The browser script for the showcase's resumability island — a live component-filter list.

### Usage

```typescript
// In the showcase client entry:
import "@y-core/forge/ui/show/client";
import { resume } from "@y-core/forge/ui/client";

resume(); // installs the delegated listener that activates the registered scope
```

This module calls `registerScope("show-filter", …)` for its side effect. The scope filters the catalog
list against a search input and updates a `computed()`-derived result count with no server roundtrip. It
demonstrates the island pattern end-to-end: `ShowcaseContent` renders the `data-scope='show-filter'`
region with serialized `data-state`, and this script resumes it on first interaction.

---

## Cross-references

- [`UI_CLIENT_RUNTIME.md`](../../.decisions/UI_CLIENT_RUNTIME.md) — authoritative design doc for the SSR-vs-client
  split, the resumability island pattern, and field binding.
- [`@y-core/forge/jsx`](../../README.md) — `renderToString` / `renderPage` to serialize component trees.
- [`@y-core/forge/http`](../../README.md) — `fragmentResponse` / `htmlResponse` / `rawHtml` to return rendered HTML.
- [`@y-core/forge/security`](../../README.md) — CSP `script-src` for the `FOUC_SCRIPT` hash and inline-script nonces.
