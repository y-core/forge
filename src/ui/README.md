# `@y-core/forge/ui`

Source-distributed UI primitives for forge apps, split across six import sub-paths. The family covers
server-rendered JSX components (`@y-core/forge/ui`), browser-side controllers and a framework-free
reactive runtime (`@y-core/forge/ui/client`), SSR-only stateful components (`@y-core/forge/ui/server`),
the pinned HTMX bundle (`@y-core/forge/ui/client/htmx`), and a ready-made component showcase
(`@y-core/forge/ui/show`, `@y-core/forge/ui/show/client`).

Every component is a thin wrapper over a native element with default Tailwind styling, predictable prop
pass-through, and explicit composition. Field state and icon sprites are owned through composition, not
configuration.

> **Architecture reference:** the authoritative design rationale (SSR-vs-client split, the resumability
> island pattern, field binding) lives in [`UI_COMPONENTS.md`](../../.decisions/UI_COMPONENTS.md).

---

## Table of Contents

- [`@y-core/forge/ui`](#y-coreforgeui-1) — server-side JSX component library
- [`@y-core/forge/ui/client`](#y-coreforgeuiclient) — browser controllers + signals runtime
- [`@y-core/forge/ui/server`](#y-coreforgeuiserver) — SSR-only Flash, Resumable, ThemeToggle
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

---

## `@y-core/forge/ui`

> Import path: `@y-core/forge/ui` → `src/ui/mod.ts`

### Features

- Server-rendered JSX components — produce static HTML via `renderToString`, with no required browser
  JavaScript.
- Compound components (`Card.Header`, `Alert.Title`, `Select.Option`, `Toast.Description`) for explicit
  composition.
- Variant-driven styling through `cva`, conditional class merging through `cn`.
- An accessible field system: controls inside a `FormField` inherit `id`, `name`, `aria-invalid`, and
  `aria-describedby`.
- Sprite-backed icons bound once per app with `createIcon` / `bindIcon`.

### Usage

```tsx
import {
  Card, Button, Form, FormField, Input, Textarea, Alert,
} from "@y-core/forge/ui";

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
| `Input`, `Textarea`, `Select` | `<input>` / `<textarea>` / `<select>` | Accept an optional `field` descriptor to wire `id` / `name` / `aria-*`. `Select` requires an `icon` (use `bindIcon`). |
| `Button` | `<button>` | `variant`: `"primary" | "secondary" | "ghost"`; `size`: `"sm" | "md" | "lg"`. |
| `Alert` | `<div role="alert">` | `variant`: `AlertVariant`. Compounds: `Alert.Title`, `Alert.Description`. |
| `Card` | bordered container | Compounds: `Card.Header`, `Card.Title`, `Card.Description`, `Card.Content`, `Card.Footer`. |
| `Toast` | notification | `variant`: `ToastVariant`; `position`: `ToastPosition`. Compounds: `Toast.Title`, `Toast.Description`, `Toast.Container`. |
| `Badge` | `<span>` | `variant`: `BadgeVariant`. |
| `Avatar` | avatar | Compound: `Avatar.Fallback`. |
| `Switch`, `Slider` | styled `<input>` | CSS-only toggle / native range; accept an optional `field` descriptor. |
| `Progress`, `Separator`, `Skeleton`, `Spinner`, `Popover`, `Label` | misc primitives | `Spinner` requires an `icon`. |
| `Icon`, `createIcon` | `<svg><use>` | Sprite-backed icon and its factory. |
| `bindIcon` | factory | Binds `Spinner` / `Select` / `ThemeToggle` to one app icon. |
| `bindControls` | factory | Pre-binds `Switch` / `Slider` / `Select` / `ToggleGroup.Item` to a scope action + `data-field`. |
| `cn`, `cva` | class utilities | Class merging and class-variance authority. |

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
import { fieldErrorId } from "@y-core/forge/ui";

<Input name="email" type="email" aria-describedby={fieldErrorId("email")} />
```

`FormField.Error` renders nothing when its child is `null`, `false`, or empty, so it is safe to include
unconditionally.

#### `Field` — layout primitive

`Field` is distinct from `FormField`. Use `Field` for settings rows and labelled controls that are not
validated form fields; use `FormField` when you need `name` / `invalid` / error / description wiring.

```tsx
import { Field, Slider, Select } from "@y-core/forge/ui";

<Field label="Field of view"><Slider min={10} max={120} value={50} output /></Field>
<Field label="Device" orientation="horizontal"><Select name="device" icon={icon}>…</Select></Field>
```

`orientation` is `"vertical"` (default), `"horizontal"`, or `"responsive"`.

#### Icons — `createIcon` and `bindIcon`

Several components (`Select`, `Spinner`, and the server-only `ThemeToggle`) render an icon and accept an
`icon` prop typed as `ForgeIcon<Name>`. Bind your app's sprite once with `createIcon`, then either pass
the bound icon directly or pre-bind the icon-consuming components with `bindIcon`:

```tsx
import { createIcon, bindIcon } from "@y-core/forge/ui";

// Bind the sprite URL once. With a meta map, `name` is narrowed to the sprite's `icon-*` keys.
const icon = createIcon("/assets/icons.svg", { "icon-spinner": "0 0 24 24", "icon-chevron-down": "0 0 24 24" });

// Pre-bind icon-consuming components so call sites omit the `icon` prop.
const { Spinner, Select, ThemeToggle } = bindIcon(icon);

<Select name="country">
  <Select.Option value="us">United States</Select.Option>
  <Select.OptGroup label="Europe">
    <Select.Option value="uk">United Kingdom</Select.Option>
  </Select.OptGroup>
</Select>
<Spinner size="md" />
```

`bindIcon(icon)` requires an icon supplying every glyph forge's bound components need: `spinner`,
`chevron-down`, `sun`, `moon`, `monitor`. `createIcon(sprite)` without a `meta` map yields a permissive
`ForgeIcon<string>` for apps whose icon set is dynamic; a `ForgeIcon<string>` is assignable to any
narrower `ForgeIcon<Name>` by contravariance.

#### Bound controls — `bindControls`

`bindControls<A>(action?)` pre-binds `Switch`, `Slider`, `Select`, and `ToggleGroup.Item` to
a resumable-scope action and a `SignalRecord` field, mirroring the `bindIcon(icon)` pattern. Capture
the action name once; call sites write a single `bind` prop instead of manually spreading `scopeAttrs`
+ `fieldAttr` on every control. `A` is the app's action-name union — typed against the same union as
`registerScope<A>`, so a typo is a compile error.

```tsx
import { bindControls } from "@y-core/forge/ui";
import { bindField, bindGroup, registerScope, signalRecord } from "@y-core/forge/ui/client";
import { Resumable } from "@y-core/forge/ui/server";

// --- Server (SSR view) ---
// Call once with the app's action-name union:
const Bound = bindControls<ChromeAction>("bindField");

// Each control needs only a `bind` prop:
<Resumable name="chrome" state={settings}>
  <Bound.Switch bind="gridVisible" checked={settings.gridVisible}>Grid</Bound.Switch>
  <Bound.Slider bind="fov" min={1} max={120} value={settings.fov} output />
  <Bound.Select bind="language" icon={AppIcon}>
    <Bound.Select.Option value="en">English</Bound.Select.Option>
  </Bound.Select>
  <Bound.ToggleGroup aria-label="Projection">
    <Bound.ToggleGroup.Item bind="projection" value="perspective" pressed={settings.projection === "perspective"}>
      Perspective
    </Bound.ToggleGroup.Item>
    <Bound.ToggleGroup.Item bind="projection" value="parallel" pressed={settings.projection === "parallel"}>
      Parallel
    </Bound.ToggleGroup.Item>
  </Bound.ToggleGroup>
</Resumable>

// --- Client ---
const sig = signalRecord(settings);
registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } });
```

**`bind` vs `field`:** the `bind` prop is orthogonal to the existing `field?: FieldDescriptor`. `field`
wires `id` / `name` / `aria-*` for form accessibility; `bind` wires `data-field` + `data-on-<event>`
for signal binding. Both may coexist on one control.

**`ToggleGroup.Item` + `bindGroup`:** `Bound.ToggleGroup.Item` takes a required `value` prop stamped as
`data-value`. Pair it with the client-side `bindGroup(signals)` action (from `@y-core/forge/ui/client`),
which reads `data-field` + `data-value` on click and writes the raw string into the matching signal,
bypassing `parseControlValue` (button groups can't express boolean/number values). The `bindField`
action handles `Switch` / `Slider` / `Select` (which read `checked` / `value` directly from the
element). Pressed-state reconciliation — updating `.active` classes and `aria-pressed` — stays
app-side as an effect on the same signal.

#### `cn` and `cva` — class utilities

`cn` merges class strings and drops falsy values (backed by `clsx`). `cva` is the class-variance
authority — build a variant function once, call it with a variant map to resolve a class string:

```tsx
import { cn, cva } from "@y-core/forge/ui";

const button = cva({
  base: "inline-flex items-center rounded-md font-medium",
  variants: {
    variant: { primary: "bg-primary text-white", outline: "border border-input bg-transparent" },
    size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-base" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

<button class={cn(button({ variant: "outline" }), isLoading && "opacity-50")}>Click</button>
```

### Integration Guide

Render component trees inside a route handler with `renderToString` (`@y-core/forge/render`) and return
them through `fragmentResponse` or `htmlResponse` (`@y-core/forge/http`):

```tsx
import { renderToString } from "@y-core/forge/render";
import { fragmentResponse } from "@y-core/forge/http";
import { Alert } from "@y-core/forge/ui";

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
`IconProps`, `JSXNode`.

---

## `@y-core/forge/ui/client`

> Import path: `@y-core/forge/ui/client` → `src/ui/client/mod.ts`
> **Browser-only.** These exports reference `document` / `window` / `localStorage` and throw if
> imported in Worker-executed SSR code. Restrict imports to your client esbuild entry (`src/client/`).

### Features

- A framework-free reactive signals runtime (`createSignal`, `computed`, `effect`).
- The resumability-lite island runtime (`registerScope`, `resume`, `resumeScope`) — server-stamped
  state hydrated on first interaction, zero work at page load.
- DOM controllers (`mountNav`, `mountTheme`, `mountTurnstile`) — each idempotent and returning a cleanup
  function.
- Theme management with a FOUC-prevention inline script (`FOUC_SCRIPT`).
- Generic control↔signal field binding (`bindField`, `bindGroup`, `parseControlValue`, `applyControlValue`).
- Lazy resource loading (`lazy`, `loadScriptOnEvent`, `loadStylesheet`).

### Usage

```typescript
import { mountNav, mountTheme, mountTurnstile, isDark, resume } from "@y-core/forge/ui/client";

mountNav();
mountTheme();
mountTurnstile(isDark);   // theme-aware Cloudflare Turnstile
resume();                 // install the single delegated island listener
```

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
`bindControls` `ToggleGroup.Item`. On click it resolves the nearest ancestor with both
`data-field` and `data-value` via `closest("[data-field][data-value]")` — handling clicks on inner
`<svg>` or `<span>` — then writes the raw `data-value` string into `signals[field]`, bypassing
`parseControlValue` (button groups can't express boolean or numeric values). Register it alongside
`bindField`:

```typescript
import { bindField, bindGroup, signalRecord, registerScope } from "@y-core/forge/ui/client";

const sig = signalRecord({ gridVisible: true, fov: 50, projection: "perspective" });
registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } });
```

#### Theme controller

```typescript
import { mountTheme, isDark, FOUC_SCRIPT } from "@y-core/forge/ui/client";
```

`mountTheme(options?)` cycles `light → dark → system` on clicks of the `[data-ref='theme-toggle']`
button (override via `options.toggleSelector`), persists the preference to `localStorage`, and toggles
the `dark` class and `data-theme-preference` attribute on `<html>`. It is idempotent and returns a
cleanup function. `isDark` is a `ReadonlySignal<boolean>` reflecting the resolved theme — feed it to
`mountTurnstile` for theme-aware widgets.

`FOUC_SCRIPT` is an inline script **string** to stamp into `<head>` so the theme is applied before first
paint (preventing a flash of unstyled content):

```tsx
import { FOUC_SCRIPT } from "@y-core/forge/ui/client";
import { rawHtml } from "@y-core/forge/http";

<script>{rawHtml(FOUC_SCRIPT)}</script>
```

Its companion constants are also exported: `THEME_STORAGE_KEY` (`"themePreference"`), `THEME_ATTR`
(`"data-theme-preference"`), `DARK_CLASS` (`"dark"`), `DEFAULT_PREF` (`"system"`). Include the
`FOUC_SCRIPT` hash in the CSP `script-src`.

#### Nav and Turnstile controllers

`mountNav(options?)` wires the navigation toggle: open/close, outside-click and Escape to close, and
auto-close on link click. `mountTurnstile(isDark, options?)` mounts a theme-aware Cloudflare Turnstile
widget on a `[data-ref='turnstile']` element, disables the submit button until verified, and resets or
removes the widget after a successful HTMX swap. The site key is read from the widget's `data-sitekey`
attribute (injected server-side, never hardcoded).

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
`LazyLoadOptions`, `NavControllerOptions`, `ThemeControllerOptions`, `TurnstileOptions`.

---

## `@y-core/forge/ui/server`

> Import path: `@y-core/forge/ui/server` → `src/ui/server/mod.ts`
> **SSR-only.** These run in Workers/SSR contexts; never bundle them into the browser.

### Features

- Flash messages — cookie-backed, one-shot, rendered as toasts (`createFlash`, `Flash`,
  `FlashContainer`, `FlashOob`).
- The server half of the resumability island pattern (`Resumable`, `scopeAttrs`, `fieldAttr`).
- An icon-bound `ThemeToggle` button.

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
| `ThemeToggle` | component | Theme-cycle button (needs an `icon`; bind via `bindIcon`). |

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

`ShowcaseContent` is layout-less — wrap it in your app's `Layout`. It needs the showcase data and a bound
icon supplying `spinner`, `chevron-down`, `sun`, `moon`, `monitor`:

```tsx
import { loadShowcase, ShowcaseContent } from "@y-core/forge/ui/show";
import { renderPage } from "@y-core/forge/render";

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

- [`UI_COMPONENTS.md`](../../.decisions/UI_COMPONENTS.md) — authoritative design doc for the SSR-vs-client
  split, the resumability island pattern, and field binding.
- [`@y-core/forge/render`](../../README.md) — `renderToString` / `renderPage` to serialize component trees.
- [`@y-core/forge/http`](../../README.md) — `fragmentResponse` / `htmlResponse` / `rawHtml` to return rendered HTML.
- [`@y-core/forge/security`](../../README.md) — CSP `script-src` for the `FOUC_SCRIPT` hash and inline-script nonces.
