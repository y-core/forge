---
title: UI Components
description: "forge JSX components, renderToString, safeUrl, getNonce, Form, Field, FormField, Input, Select, Button, Switch, Slider, fieldAttr, bindField, parseControlValue, Alert, Card, Icon, createIcon, cn, cva, SSR components, ui/core, ui/client, mountNav, mountTheme, mountTurnstile, FOUC_SCRIPT, createSignal, computed, effect, htmx sideEffect, Tailwind v4"
weight: 30
---

# UI Components

> Authoritative source for forge's two UI namespaces: ui/core (SSR JSX components)
> and ui/client (browser-side controllers). Covers the SSR-vs-client split, component
> catalog, and HTMX integration.
>
> Complements [ROUTING_AND_MIDDLEWARE.md](./ROUTING_AND_MIDDLEWARE.md) (route views),
> [INPUT_VALIDATION.md](./INPUT_VALIDATION.md) (form components).
>
> SSR rendering: components produce a forge `RemixElement` tree; `renderToString`
> (from `@y-core/forge/render`) serializes it to a `SafeHtml` string. The JSX runtime is
> forge's own (`@y-core/forge/jsx-runtime`), set via `/** @jsxImportSource @y-core/forge */`
> at the top of each `.tsx` file — it is NOT a third-party JSX runtime.

---

## 0. Quick Reference

- §1 ui/core namespace: Form, Field (layout), FormField, Input, Button, Switch, Slider, Alert, Card, Icon, cn, cva
- §1j generic field binding: fieldAttr (ui/server) + bindField/bindGroup/parseControlValue/applyControlValue (ui/client); bindControls pre-binds wrappers; bind vs field distinction; bindGroup/data-value for segmented controls
- §2 SSR component patterns: composing Field+FieldLabel+FieldError+Input
- §3 cn and cva: class name utilities for conditional and variant styling
- §4 ui/client namespace: mountNav, mountTheme, mountTurnstile, FOUC_SCRIPT, signals
- §5 HTMX sideEffect import: ui/client/htmx for htmx bundle
- §6 SSR-vs-client split rule: when to use ui/core vs ui/client

---

## 1. ui/core Namespace (SSR Components)

> All components in ui/core are forge JSX components rendered server-side via
> `renderToString`. They produce static HTML with no browser JavaScript dependency.
> URL-valued attributes (`href`, `src`, `action`, `formaction`, `poster`, `cite`,
> `background`) are scheme-sanitized automatically by the renderer via `safeUrl`, so a
> `javascript:`-style value collapses to `"#"` in the emitted HTML.

### 1a. Form Component

    import { Form } from "@y-core/forge/ui"

    <Form hx-post="/api/contact" hx-target="#result">
      {/* form fields */}
    </Form>

Renders an HTML `<form>` element. Accepts all standard HTML form attributes plus HTMX
data attributes (`hx-post`, `hx-get`, `hx-target`, `hx-swap`, etc.). No client-side
submission logic is added — behavior is delegated entirely to HTMX or native form
submission.

### 1b. FormField Components — Accessible Form Fields

> **Naming:** `FormField` is the `<fieldset>`-based accessible form field (formerly
> exported as `Field`). The bare name `Field` now refers to the lightweight **layout**
> field — a label + control with no form semantics (see §1i).

    import { FormField, FieldLabel, FieldError, FieldDescription, Input } from "@y-core/forge/ui"
    import { fieldId, fieldErrorId, fieldDescriptionId } from "@y-core/forge/ui"

    <FormField name="email">
      <FieldLabel>Email</FieldLabel>
      <Input type="email" name="email" />
      <FieldDescription>We'll never share your email.</FieldDescription>
      <FieldError>{errors.email}</FieldError>
    </FormField>

`FormField` provides a scoped context for its `name` prop. `FieldLabel`, `FieldDescription`,
and `FieldError` auto-wire `for`/`id`/`aria-describedby` relationships via the ID
helpers:

- `fieldId(name)` — base input ID
- `fieldErrorId(name)` — ID for the error message element
- `fieldDescriptionId(name)` — ID for the description element

Pass these to `aria-describedby` and `aria-errormessage` on `Input` when composing
outside of `Field` context.

### 1c. Input, Textarea, Select Components

    import { Input, Textarea, Select, SelectOption, SelectOptGroup } from "@y-core/forge/ui"

    <Input type="text" name="name" placeholder="Your name" />
    <Textarea name="message" rows={4} />
    <Select name="country">
      <SelectOption value="us">United States</SelectOption>
      <SelectOptGroup label="Europe">
        <SelectOption value="uk">United Kingdom</SelectOption>
      </SelectOptGroup>
    </Select>

All accept standard HTML attributes. `Input` renders `<input>`, `Textarea` renders
`<textarea>`, `Select` renders `<select>` with optional grouping via `SelectOptGroup`.

### 1d. Button Component

    import { Button } from "@y-core/forge/ui"

    <Button type="submit">Send Message</Button>
    <Button type="button" hx-get="/api/data" hx-target="#result">Load</Button>

Renders a styled `<button>`. Accepts `type`, HTMX attributes, and all standard button
attributes. Does not add JavaScript event listeners — HTMX handles interactivity.

### 1e. Alert Component

    import { Alert, AlertTitle, AlertDescription, type AlertVariant } from "@y-core/forge/ui"

    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>Something went wrong.</AlertDescription>
    </Alert>

`AlertVariant`: `"default" | "destructive" | "success"`. Used for inline feedback in
HTMX response fragments (see §2b). `AlertTitle` renders as a `<p>` with strong styling;
`AlertDescription` renders body text below it.

### 1f. Card Components

    import {
      Card, CardHeader, CardTitle, CardDescription,
      CardContent, CardFooter, CardAction
    } from "@y-core/forge/ui"

    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
        <CardDescription>Description</CardDescription>
      </CardHeader>
      <CardContent>Content here</CardContent>
      <CardFooter>
        <CardAction><Button>Act</Button></CardAction>
      </CardFooter>
    </Card>

`Card` is a bordered container. `CardHeader` groups `CardTitle` and `CardDescription`.
`CardAction` anchors actions (buttons, links) to the footer right edge.

### 1g. Icon Component

    import { Icon, createIcon } from "@y-core/forge/ui"

    <Icon name="arrow-right" size={20} />

`Icon` renders an `<svg><use href="sprite#symbol">` from a sprite sheet. `createIcon(sprite, meta)`
binds a sprite URL to a typed `ForgeIcon` whose `name` is narrowed to the sprite's `icon-*` keys
(viewBox resolved from `meta`). `createIcon(sprite)` — **no `meta`** — yields a permissive
`ForgeIcon<string>` for apps whose icon set is dynamic (names not known at compile time); the viewBox
comes from the `viewBox` prop. A `ForgeIcon<string>` is assignable to any narrower `ForgeIcon<Name>`
(contravariance), so it still satisfies components that require a specific icon (e.g. `Select`'s
`chevron-down`).

### 1h. Switch and Slider Components

    import { Switch, Slider } from "@y-core/forge/ui"

    <Switch checked name="grid">Snap to grid</Switch>
    <Slider min={0} max={100} step={1} value={40} output />

`Switch` renders a CSS-only toggle: a `sr-only` `<input type="checkbox" role="switch">`
holds state and focus while sibling `peer-checked:` / `peer-focus-visible:` utilities
paint the decorative (`aria-hidden`) track and thumb — no client JS. Optional `children`
render as a trailing label inside the wrapping `<label>`. `Slider` renders a native
`<input type="range">` styled cross-browser via `accent-primary`; pass `output` to wrap it
with an `<output>` readout seeded to `value` (mirroring it on input is a consumer concern —
forge stays markup-only per §6). Both accept all standard `<input>` attributes, spread
delegation/`data-*` attributes through, and take an optional `field` descriptor that wires
`id` / `name` / `aria-*` exactly like `Input` / `Select` / `Textarea` (§1c).

### 1i. Field (layout) Component

    import { Field } from "@y-core/forge/ui"

    <Field label="Field of view"><Slider min={10} max={120} value={50} output /></Field>
    <Field label="Device" orientation="horizontal"><Select …/></Field>

`Field` is a lightweight **layout** primitive — a caption (`<span data-slot="field-label">`) tightly
bound to its control children, with no form semantics. It is distinct from `FormField` (§1b, the
`<fieldset>`-based accessible form field): use `Field` for settings rows and labelled controls that
aren't validated form fields, `FormField` when you need `name`/`invalid`/error/description wiring.
`orientation` is `"vertical"` (default) or `"horizontal"`; theme-token styled and `class`-overridable.

### 1j. Generic field binding (`fieldAttr` + `bindField` + `bindGroup`)

forge owns the generic glue between a control and a reactive signal; the app supplies the signal
record and any domain effects layered on it.

    // SSR (ui/server): name the bound field; pair with scopeAttrs for the event → action
    import { scopeAttrs, fieldAttr } from "@y-core/forge/ui/server"
    <Switch {...scopeAttrs({ onChange: "bindField" })} {...fieldAttr("gridVisible")} checked={v} />

    // Client (ui/client): register the bindField action over a SignalRecord
    import { bindField, bindGroup, parseControlValue, applyControlValue } from "@y-core/forge/ui/client"
    registerScope("settings", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig), ...appActions } })

`fieldAttr(name)` stamps `data-field`. `bindField(signals)` returns a resumable-scope action that, on
the bound event, reads `data-field`, parses the control's value by the target signal's current type
(`parseControlValue`: boolean→`checked`, number→`Number(value)`, else string), and writes
`signals[field]`. `applyControlValue` is the inverse — seed an uncontrolled input from a typed value
(e.g. after a programmatic reset). Domain effects (persist, render, readouts) stay app-side as
additional effects on the same signals.

**`bind` vs `field` distinction:** the `bind` prop (on `bindControls` wrappers) drives the
`data-field` / `data-on-*` signal-binding contract; the `field?: FieldDescriptor` prop on `Input` /
`Select` / `Switch` drives `id` / `name` / `aria-*` form-accessibility wiring. They are orthogonal
and may coexist on one control.

**Bound control wrappers — `bindControls`:** call once with the app's action-name union `A`
and a scope action name; get back `{ Switch, Slider, Select, ToggleGroup }` where each component
pre-spreads `scopeAttrs` + `fieldAttr` from a single `bind` prop instead of requiring manual spread
at every call site.

    import { bindControls } from "@y-core/forge/ui"
    const Bound = bindControls<ChromeAction>("bindField")
    // Switch/Slider bind onChange/onInput; ToggleGroup.Item binds onClick
    <Bound.Switch bind="gridVisible" checked={v}>Grid</Bound.Switch>
    <Bound.Slider bind="fov" min={1} max={120} value={v} output />
    <Bound.ToggleGroup.Item bind="projection" value="perspective" pressed={v === "perspective"}>…</Bound.ToggleGroup.Item>

**`bindGroup` + `data-value` — segmented controls:** `Bound.ToggleGroup.Item` takes a required
`value` prop stamped as `data-value` (forge's private server↔client contract). The client-side
`bindGroup(signals)` action resolves `el.closest("[data-field][data-value]")` (handles inner
`<svg>` / `<span>` click targets), then writes the raw `data-value` string into `signals[field]`,
bypassing `parseControlValue` (button groups cannot express boolean / number). Pressed-state
reconciliation (`.active` class, `aria-pressed`) stays app-side as an effect on the same signal.

---

## 2. SSR Component Patterns

> Canonical patterns for combining ui/core components in route views.

### 2a. Form with Validation Errors Pattern

    <Form hx-post="/api/contact" hx-target="#contact-result">
      <FormField name="name">
        <FieldLabel>Name</FieldLabel>
        <Input
          name="name"
          value={name}
          aria-describedby={fieldErrorId("name")}
        />
        <FieldError>{errors?.name}</FieldError>
      </FormField>
      <FormField name="email">
        <FieldLabel>Email</FieldLabel>
        <Input
          type="email"
          name="email"
          value={email}
          aria-describedby={fieldErrorId("email")}
        />
        <FieldError>{errors?.email}</FieldError>
      </FormField>
      <Button type="submit">Submit</Button>
    </Form>
    <div id="contact-result" data-ref="contact-result" />

The `errors` object comes from the handler after zod validation (see
[INPUT_VALIDATION.md](./INPUT_VALIDATION.md)). `FieldError` renders nothing when its
child is `undefined` or empty string, so it is safe to always include.

### 2b. HTMX Response Fragment Target

The form's `hx-target` points to the result `<div>`. On the handler side, successful
and failed submissions serialize a JSX fragment with `renderToString` and wrap the
resulting `SafeHtml` in a `text/html` `Response` via `fragmentResponse` (no DOCTYPE,
since the fragment is swapped into an existing document):

    import { fragmentResponse } from "@y-core/forge/http"
    import { renderToString } from "@y-core/forge/render"

    // handler returns on error:
    return fragmentResponse(await renderToString(
      <Alert variant="destructive">
        <AlertTitle>Submission Failed</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    ))

    // handler returns on success:
    return fragmentResponse(await renderToString(
      <Alert variant="success">
        <AlertTitle>Message Sent</AlertTitle>
      </Alert>
    ))

The fragment replaces the inner content of `#contact-result` via the default
`hx-swap="innerHTML"`. For full pages use `htmlResponse(await renderToString(<Page/>))`,
which prepends `<!DOCTYPE html>`. For plain text/JSON banners that need no JSX, the
`renderError` / `renderSuccess` / `renderValidationErrors` helpers (also from
`@y-core/forge/http`) return ready-to-send `SafeHtml`.

---

## 3. cn and cva Class Utilities

> Tailwind v4 utility helpers for conditional and variant class composition.

### 3a. cn — Conditional Class Names

    import { cn } from "@y-core/forge/ui"

    <div class={cn("base-class", isActive && "active", className)} />

`cn` merges class strings and filters falsy values. Uses `clsx` internally. Accepts
strings, arrays, objects (`{ "class": condition }`), and nested combinations. Use `cn`
whenever a component conditionally applies Tailwind classes or accepts a `className` prop
override.

### 3b. cva — Class Variance Authority

    import { cva } from "@y-core/forge/ui"

    const buttonVariants = cva("inline-flex items-center rounded-md font-medium", {
      variants: {
        variant: {
          primary: "bg-primary text-white hover:bg-primary/90",
          outline: "border border-input bg-transparent hover:bg-accent",
          ghost:   "hover:bg-accent hover:text-accent-foreground",
        },
        size: {
          sm: "h-8 px-3 text-sm",
          md: "h-10 px-4 text-base",
          lg: "h-12 px-6 text-lg",
        },
      },
      defaultVariants: { variant: "primary", size: "md" },
    })

    // usage:
    <button class={buttonVariants({ variant: "outline", size: "sm" })}>Click</button>

`cva` returns a variant function. Call it with a variant map to produce the resolved
class string. Combine with `cn` when additional conditional classes are needed:

    <button class={cn(buttonVariants({ variant }), isLoading && "opacity-50")} />

---

## 4. ui/client Namespace (Browser Controllers)

> ui/client exports run only in the browser. Never import in SSR-executed files.
> See §6 for the hard split rule.

### 4a. mountTheme — Dark Mode Controller

    import { mountTheme, FOUC_SCRIPT } from "@y-core/forge/ui/client"
    import { rawHtml } from "@y-core/forge/http"

    // In layout <head> — runs synchronously before first paint:
    <script>{rawHtml(FOUC_SCRIPT)}</script>

    // In <body> — wires the toggle button:
    <script>mountTheme()</script>

`FOUC_SCRIPT` is a minified inline script that reads `localStorage` and sets the `dark`
class on `<html>` before the browser paints. This prevents flash-of-unstyled-content
(FOUC) on dark mode. `mountTheme()` attaches click handlers to the theme toggle button.
The script hash for `FOUC_SCRIPT` must be included in the CSP `script-src` via
`makeSecurityHeaders` (see [SECURITY_HARDENING.md](./SECURITY_HARDENING.md)). Any other
inline `<script>` rendered server-side must carry the per-request nonce, obtained with
`getNonce(c)` from `@y-core/forge/security` and emitted as `<script nonce={getNonce(c)}>`.

### 4b. mountNav — Navigation Controller

    import { mountNav } from "@y-core/forge/ui/client"

    <script>mountNav()</script>

Wires the mobile hamburger menu toggle and applies active-link highlighting based on
`window.location.pathname`. Call once per page in a bundled client script or inline
`<script>` tag.

### 4c. mountTurnstile — CAPTCHA Controller

    import { mountTurnstile } from "@y-core/forge/ui/client"

    <script>mountTurnstile({ siteKey: turnstileSiteKey })</script>

Initialises Cloudflare Turnstile on forms that include a `[data-turnstile]` element.
`siteKey` is injected server-side from the Worker env (never hardcoded). The controller
appends the hidden `cf-turnstile-response` token to form submissions.

### 4d. Signals — Reactive State

    import { createSignal, computed, effect } from "@y-core/forge/ui/client"

    const count = createSignal(0)
    const doubled = computed(() => count.value * 2)

    effect(() => {
      console.log("doubled:", doubled.value)
    })

    count.value = 5  // triggers effect, logs "doubled: 10"

Signals provide fine-grained reactive state without a framework. `createSignal` returns
a signal with `.value` getter/setter. `computed` derives a read-only signal. `effect`
subscribes to all signals read during its execution and re-runs on change. Use for
lightweight client state that does not justify HTMX round-trips.

### 4e. Lazy Loading Utilities

    import { lazy, loadScriptOnEvent, loadStylesheet } from "@y-core/forge/ui/client"

    lazy(() => import("./expensive-module"))          // deferred dynamic import
    loadScriptOnEvent("click", "/analytics.js")       // load script on first event
    loadStylesheet("/print.css")                       // inject <link> stylesheet

`lazy` defers a dynamic import until the browser is idle. `loadScriptOnEvent` injects a
`<script>` tag the first time a given DOM event fires — useful for analytics or chat
widgets that must not block page load. `loadStylesheet` injects a `<link rel="stylesheet">`.

---

## 5. HTMX Import (sideEffect)

> The htmx bundle must be imported as a side-effect — never tree-shaken.

### 5a. htmx Bundle Import

    // src/client/main.ts (esbuild entry point):
    import "@y-core/forge/ui/client/htmx"  // side-effect only — no exports used

This import is marked `"sideEffects": true` in the forge `package.json`. It attaches
`htmx` to `window` and registers all built-in extensions. esbuild must NOT tree-shake
this import. Never import htmx directly from a CDN URL — use this entry point so the
version is pinned by the forge package.

The output bundle lands at `public/assets/js/main.js` and is referenced in the layout
`<script src="/assets/js/main.js" defer>` tag. The CSP `script-src` covers this file
via the `'self'` allowlist (no hash required for external files).

---

## 6. SSR-vs-Client Split Rule

> Hard boundary: ui/core runs at build time and request time on the Worker;
> ui/client runs exclusively in the browser after the page is delivered.

### 6a. When to Use ui/core (SSR)

Use ui/core components for all of the following:

- HTML structure: forms, cards, alerts, buttons, inputs
- Route view JSX serialized inside request handlers via `renderToString` and returned
  through `htmlResponse` / `fragmentResponse`
- Components that carry no JS behavior — styling and markup only
- Any component imported in `src/views/`, `src/handlers/`, or `src/router.tsx`

### 6b. When to Use ui/client (Browser)

Use ui/client exports for all of the following:

- DOM controllers that require `document` or `window` (theme, nav, turnstile)
- Reactive client state managed with signals
- Deferred or event-triggered resource loading
- Code imported only inside `src/client/` (esbuild entry) or inline `<script>` tags

### 6c. Never Use ui/client in SSR Context

ui/client exports reference browser globals (`document`, `window`, `localStorage`).
Importing them in Worker-executed code throws at runtime on Cloudflare Workers, which
has no DOM. The import boundary is enforced by path convention:

- `@y-core/forge/ui` — safe in Workers (SSR)
- `@y-core/forge/ui/client` — browser only; restricted to `src/client/`
- `@y-core/forge/ui/client/htmx` — browser only; esbuild entry point only

If a component needs both SSR markup and client behavior, render the markup with ui/core
and wire behavior via a `mountX()` call in a `<script>` tag that references the bundled
client entry. Never inline ui/client imports in JSX files outside `src/client/`.
