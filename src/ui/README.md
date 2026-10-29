---
title: The UI Component Surface
description: "How to call forge's UI surface: which subpath to import from, what each one is allowed to run in, and the task each one solves."
audience: consumer
---

# `@y-core/forge/ui`

Source-distributed UI primitives for forge apps. Every component is a thin wrapper over a native element with default Tailwind styling, predictable
prop pass-through, and explicit composition.

Which component to reach for, and what good looks like once it is composed, is the design corpus's question — see
[`@y-core/forge/ui/design/*.md`](#y-coreforgeuidesignmd). The rulings behind the surface are the documents under [See also](#see-also). What a
subpath exports is its own `mod.ts`.

| Sub-path | What it is |
| --- | --- |
| [`ui/core`](#y-coreforgeuicore) | Server-rendered JSX component library |
| [`ui/core/client`](#y-coreforgeuicoreclient) | The scopes `ui/core` markup names (side-effect import) |
| [`ui/controls`](#y-coreforgeuicontrols) | Pre-bound signal-binding wrappers over `ui/core` |
| [`ui/contracts`](#y-coreforgeuicontracts) | The DOM contract both halves write, as pure data |
| [`ui/contracts/theme`](#y-coreforgeuicontractstheme) | Colour-scheme generation and the audited contrast pairs |
| [`ui/assets`](#y-coreforgeuiassets) | Forge's self-owned icon asset manifest |
| [`ui/assets/build`](#y-coreforgeuiassetsbuild) | The build-time computation behind those assets |
| [`ui/assets/glyphs`](#y-coreforgeuiassetsglyphs) | Browser-safe sprite glyph parser |
| [`ui/assets/css/*.css`](#y-coreforgeuiassetscsscss) | The entry stylesheet and the optional themes (a subpath **pattern**) |
| [`ui/client`](#y-coreforgeuiclient) | Browser controllers, signals, and the island runtime |
| [`ui/client/htmx`](#y-coreforgeuiclienthtmx) | The pinned HTMX bundle (side-effect import) |
| [`ui/server`](#y-coreforgeuiserver) | SSR-only flash messages and island roots |
| [`ui/chrome`](#y-coreforgeuichrome) | SSR navigation chrome and the theme toggle |
| [`ui/chrome/client`](#y-coreforgeuichromeclient) | The chrome scopes island (side-effect import) |
| [`ui/design/*.md`](#y-coreforgeuidesignmd) | The design corpus as markdown (a subpath **pattern**) |

---

## Prerequisites

forge ships TypeScript/TSX **source** — no build step, no emitted `.d.ts`. Consuming any component needs a TypeScript-aware bundler (esbuild, Bun,
Vite, or Wrangler) configured with `"jsx": "react-jsx"` and `"jsxImportSource": "@y-core/forge/render/jsx"`. Each forge `.tsx` file also
self-declares the runtime with a `/** @jsxImportSource @y-core/forge/render/jsx */` pragma, so per-file overrides are unnecessary.

---

## `@y-core/forge/ui/assets/css/*.css`

The stylesheet forge's components are painted by, and the scheme and shape files that re-point their colours. Every file here is CSS a consuming
stylesheet `@import`s; nothing is imported from TypeScript.

### Import one stylesheet, and take one path only

Components are Tailwind utilities over semantic tokens, so an app needs both the tokens and the generated rules for the classes those components
emit. One import supplies both:

```css
@import "@y-core/forge/ui/assets/css/tailwind.css";
```

That file is `@import "tailwindcss" source(none)` followed by `forge.css`, and it is the one place forge states that composition — the app's
stylesheet, its Tailwind build, and the class sorter in `.oxfmtrc.json` all read it. Import it from anywhere in the tree: `@import "tailwindcss"`
resolves from the file's own location, which reaches forge's peer dependency under pnpm's strict layout and the app's own copy under a hoisted one.

**Take the second path only if you must pass Tailwind import options of your own** — a prefix — since an option cannot be added to an import
nested inside a file you do not control:

```css
@import "tailwindcss" source(none) prefix(tw);
@import "@y-core/forge/ui/assets/css/forge.css";
```

`forge.css` never imports Tailwind itself, which is what keeps that path open. **Take one path or the other, never both** — importing Tailwind twice
emits preflight twice. **Keep `source(none)` on your own import**: the gate's coverage row fails a stylesheet that leaves automatic detection on.

### Tell Tailwind which directories to scan

`tailwind.css` turns Tailwind's automatic detection off, so the build scans only what an `@source` line names. Name your own source directories
in your stylesheet, relative to it:

```css
@source "../src";
@source not "../src/**/*.test.ts";
```

`forge.css` carries its own `@source` paths for `src/ui/`, resolved relative to itself — nothing is required of you for the `ui` components.

**`forge.css` scans `ui/` and nothing else.** Other namespaces ship server-rendered markup whose classes are the app's to scan. Each of those
ships a `sources.css` for your stylesheet to import, and says so in its own README where it applies:

```css
@import "@y-core/forge/render/htmx/sources.css";
```

**A file no `@source` names gets no CSS, and nothing at build time says so** — its classes render with no rule behind them. Under
`cloudflareWorkerSteps`, setting `design` adds the `validate-css-coverage` row, which fails each `.ts` or `.tsx` file under `design.sources`
that declares utility classes no `@source` covers. The failure names the `@source` line to add. A test file is never required to be covered.
The row also warns on a scanned directory where no file declares a class, which is scan breadth you can cut.

### Pick a colour scheme, and a shape independently of it

`theme-neutral.css` is the default scheme and `forge.css` imports it, so forge renders correctly with no theme file of your own. Others ship beside
it — `theme-stone.css` (warm), `theme-gray.css` (cool) and `theme-slate.css` (strongly cool) — each `@import`ed _after_ `forge.css`.
Tailwind's ramp named `gray` is blue-tinted, so `theme-gray.css` is the cool scheme and `theme-neutral.css` the achromatic one; the names invite the
opposite reading.

**Shape is a second, independent set**, declared in `theme-base.css`. A colour scheme never declares a shape token, so any scheme composes with any
shape; `shape-compact.css` is the alternate, imported after `forge.css` exactly as a scheme is. A flat theme is one line in a shape file,
`:root { --elevation: 0; }`; the focus ring is not a shadow and survives it. The ruling is [`THEME_GENERATION.md`][tg-1d] §1d.

### Write a scheme of your own, or re-point one token

A scheme file re-declares the gray scale's steps in one `:root` block and **nothing else** — every semantic token resolves through those
steps. A step whose value differs by mode is written with `light-dark()` and the branch is selected by `color-scheme`, which `theme-base.css` sets;
a step that is the same colour in both modes is written bare. Author your own the same way, after the forge imports.

To re-point a single token instead — a brand hue is `--primary`, not `--accent` — declare it a single time, and it applies in **both** modes. So
anything that must differ by mode is a _step_ override, and steps carrying text or a control boundary have measured contrast behind them. The
one-declaration-site rule is [`UI_CLASS_COMPOSITION.md`][ucc-2] §2; the ramps, dials and audited pairs belong to
[`ui/contracts/theme`](#y-coreforgeuicontractstheme).

**Status colours are tokens, not palette utilities.** `Alert`, `Toast`, `Badge` and the banners `@y-core/forge/http` renders take their colour from
a `--status-*` family — each intent (`danger`, `warning`, `success`, `info`) crossed with a role, and each bridged to a Tailwind utility such as
`bg-status-danger-subtle`. They are deliberately separate from `--destructive` / `--success` / `--warning`, which are fills your app owns
([`UI_CLASS_COMPOSITION.md`][ucc-2c] §2c). Each intent also carries a `--X-text` sibling — the tone read as text on a page surface — because the
fill is held across modes and the text step is not ([`THEME_GENERATION.md`][tg-4] §4).

### Add a scale step or a font face without colliding with colour

**A scale token you add is namespaced away from colour.** A font size is `@theme { --text-size-hero: 3.5rem; }`, giving `text-size-hero` — not
`--text-hero`. Tailwind's `--text-*` namespace carries font size while the `text-*` utility also carries colour, so `text-hero` reads as a colour to
anything working from the class name, `cn` included: `cn("text-hero text-red-500")` returns `text-red-500` alone, with no error. Under the reserved
spelling the class merges against `text-2xl` and coexists with `text-red-500`. The reasoning is [`UI_CLASS_COMPOSITION.md`][ucc-2f] §2f.

**A font face you add is namespaced away from weight, for the same reason.** A face is
`@theme { --font-face-display: "Literata", serif; }`, giving `font-face-display` — not `--font-display`. Tailwind's `font-*` utility is modally
weight, so `font-display` reads as one and `cn("font-display", "font-semibold")` drops the face. Under the reserved spelling it merges against
`font-sans` and coexists with `font-semibold`.

### Override a component's own styling

**Component rules sit in `@layer components`**, so a utility passed at the call site wins over a component default — `<Dialog class="max-w-sm">`
narrows the dialog, as it reads. Declare `@layer app;` _after_ the forge imports and put your own chrome rules there; why the remedy is a layer and
never specificity is [`UI_CLASS_COMPOSITION.md`][ucc-2e] §2e.

### Retime or remove the open and close motion

A modal `Dialog`, a `Popover`, a `Menu`, a `Tooltip` and a `Toolbar` flyout fade and scale as they open and close, a `Drawer` slides in from its
edge, and a `Toast` fades in as it arrives. A dismissed toast or alert fades out before it is removed. A `Dialog` or `Drawer` rendered with
`openModal` is already open when the page paints, so it opens without motion and moves only when it closes. When the reader's system asks for
reduced motion, they fade without scaling or sliding.

To retime every one of them, `Collapsible` and `Accordion` included, set `--forge-motion-enter` and `--forge-motion-exit` in your own `:root`. To
change one, put utilities on the component — `<Popover.Content class="transition-none">` opens it instantly, and a `duration-*` replaces the timing
in both directions. An `ease-*` does the same, except on a `<Dialog open>`: there it also replaces the `step-end` that holds the panel in place
while it fades, so a closing one jumps out of place partway through. Retime a non-modal dialog with `duration-*` alone; on Firefox and WebKit a
retimed one closes without the fade either way.

A custom `transition-property` list names `display` and `overlay` beside its own properties, with `transition-discrete`, or the panel stops painting
on the first exit frame. A custom motion that leaves `scale` out of `transition-property` also sets `--forge-motion-scale: 1` on the component, or
the closed scale snaps on exit. One that leaves `opacity` out, such as a slide, sets `--forge-motion-opacity: 1` the same way, or the panel turns
invisible on the first exit frame. A centre-aligned `Popover`, `Menu` or `Tooltip` spends `translate` on centring itself, so a custom slide on one
replaces it and the panel leaves diagonally — slide only start- or end-aligned popups.

### Get dark mode

Forge's colours are custom properties whose mode `.dark` on `<html>` selects, so **every forge component works in dark mode with no extra setup**
and forge's own source contains no `dark:` utility. `forge.css` redefines the `dark:` variant to follow that class rather than
`prefers-color-scheme` — a takeover that reconfigures **your** `dark:` utilities too. To get the media query back, re-declare `@custom-variant dark`
yourself _after_ the forge imports — `@custom-variant` is last-declaration-wins. The ruling is [`UI_CLASS_COMPOSITION.md`][ucc-2d] §2d.

Nothing above wires the toggle itself; that is [`ui/chrome`](#y-coreforgeuichrome)'s.

---

## `@y-core/forge/ui/design/*.md`

A pure-markdown **design corpus**, shipped inside this package at `src/ui/design/` and reachable file by file through the `./ui/design/*.md`
subpath.

It is already sitting in `node_modules`, so read `src/ui/design/index.md` — the corpus's entry point in any harness, carrying the routing table that
sends a question to the one file answering it. **Load `src/ui/design/floor.md` before any UI work** — it is the only unconditional file;
`catalog.md` answers which component fits a job, and `reference/` holds one file per design dimension. The two rule tiers are
[`UI_DESIGN_GUIDANCE.md`][udg-2] §2's and the `forge-ui-` identifier scheme §3's.

---

## `@y-core/forge/ui/core`

Server-rendered JSX components. They emit markup and nothing else: no component here reaches `document`, and a component that needs a keyboard is
inert until [`ui/core/client`](#y-coreforgeuicoreclient) is imported.

### Build a form

```tsx
import { Button, Form, FormField, Input } from "@y-core/forge/ui/core";

<Form hx-post='/api/contact' hx-target='#contact-result'>
  <FormField invalid={Boolean(errors.name)}>
    <FormField.Label name='name'>Your name</FormField.Label>
    <Input name='name' field={{ name: "name", error: errors.name }} required />
    <FormField.Error name='name'>{errors.name}</FormField.Error>
  </FormField>
  <Button type='submit'>Send message</Button>
</Form>;
```

Render trees inside a route handler with `renderToString` (`@y-core/forge/render/jsx`) and return them through `fragmentResponse` or `htmlResponse`
(`@y-core/forge/http`).

**Pass `csrfToken` to `Form` and it does both halves**: the hidden field, and the token merged into `hx-headers`. Pass `csrfHeader` as well when
`csrfProtection` renamed the header, because on some forms the header is the only copy that arrives.

**A form htmx or the browser submits by GET or DELETE gets no hidden field**, only the header. Those verbs send the form's fields in the URL,
and a token in a URL reaches every log that records one. A DELETE form that must also work without JavaScript keeps the plain form and moves the
verb onto its button. A button reads no `hx-headers` from its form, so give it the header too:

```tsx
import { Button, Form } from "@y-core/forge/ui/core";

<Form csrfToken={token} action='/items/1'>
  <Button type='submit' hx-delete='/items/1' hx-headers={JSON.stringify({ "X-CSRF-Token": token })}>
    Remove
  </Button>
</Form>;
```

Without JavaScript the form POSTs the hidden field to `action`, so that route needs a POST handler as well as the DELETE one. With htmx the button
sends the DELETE, which carries none of the form's fields. Both requests go to one path, so one token covers them.

### Wire a label, a description and an error to one control

`FormField.Label`, `.Description` and `.Error` derive `for` and `id` from a `name`, and the control derives its `id` and `aria-describedby` from the
same `name` in its `field` descriptor, so **pass one `name` to every member and to the control's `field`** and the wiring happens. Reach for `Field`
instead when the row is a settings control rather than a validated form field: it is a label-and-control layout with no form semantics. Its caption
names the one control it wraps through `aria-labelledby`, so give that control an `id` or a `field` and no `Label` of its own.

The decisions below are yours, and both default to the quiet answer:

- **`scope`** separates two fields that share a `name` on one page. It is caller-opt-in because deriving one automatically would need module-level
  mutable state ([`CODE_RULES.md`][cr-1] §1). Repeat it on every member, and on every `.Item` of a `CheckboxGroup` or `RadioGroup` — each item
  derives its own id from `name`, `scope` and its `value`.
- **`description`** declares that a description element actually renders, and defaults to `false`, so `aria-describedby` is emitted only when
  something really describes the field.

A blank or whitespace-bearing `name` or `scope` derives no wiring at all, while the `name` **attribute** still renders exactly as given
([`UI_SSR_COMPONENTS.md`][usc-1j] §1j). `FormField.Error` renders nothing when its message is blank (`null`, `false`, `""`, an empty array or
whitespace only), so an error slot costs nothing on the happy path. **Pass the message to the control as `field={{ name, error }}`.** A non-blank
`error` emits `aria-invalid` and adds the error id to `aria-describedby`, by the same test that decides whether `FormField.Error` renders, so the
control never names an error that did not render. A `CheckboxGroup` or `RadioGroup` takes the same message as its own `error`, which marks and
describes the fieldset by the same test. `FormField`'s own `invalid` only recolours its fieldset and reaches no control.

When you are building the same wiring by hand — a control forge does not ship, inside a `FormField` — the id helpers exported beside `FormField`
derive the same strings the components use, and `fieldControlProps` is the merge `Input` / `Select` / `Textarea` perform internally.
An `aria-describedby` you pass yourself, to a control, a group root, a `Tooltip.Trigger`, a `Dialog` or a `Drawer`, is kept ahead of the ids forge
adds, never replaced by them.

### Choose a tone, an appearance and a size

Presentational props are drawn from one vocabulary, so a value means the same thing on every component that takes it. **No component takes a prop
named `variant`** — colour is `tone` and emphasis is `appearance`, asked separately ([`UI_SSR_COMPONENTS.md`][usc-1m] §1m). The values are
declared in [`ui/contracts`](#y-coreforgeuicontracts).

| Prop | Values | Taken by |
| --- | --- | --- |
| `tone` | `neutral`, `primary`, `secondary`, `destructive`, `info`, `success`, `warning` | `Button`, `Link`, `Badge`, `Alert`, `Toast`, `Status`, `Steps`, `Timeline`, `Table.Row`, core `Toolbar.Button` / `Toolbar.Link` |
| `appearance` | `solid`, `soft`, `outline`, `ghost`, `link` | `Button` and core `Toolbar.Button` / `Toolbar.Link` take the whole set; the rest are narrowed to what they can paint — `Badge` takes `solid`/`soft`/`outline`, `Alert` and `Toast` take `solid`/`soft`, `Filter.Item` takes `soft`/`ghost` |
| `size` | `sm`, `md`, `lg` | `Button`, `Avatar`, `Spinner`, `Kbd`, `Status`, `Table`, `Toggle`, `ToggleGroup.Item`, `Carousel.Dots`, the `Pagination` and `Filter` items, core `Toolbar.Button` / `.Link` / `.Input`, chrome `Dock` / `ThemeToggle` / `ToolbarAction`, and every field control; `Badge` takes `sm`/`md` |
| `shape` | `default`, `icon`, `square`, `circle` | `Button` and core `Toolbar.Button` / `Toolbar.Link` — an icon-only button is `shape='icon'`, never a size |
| `orientation` | `horizontal`, `vertical` | anything with a layout axis: `Tabs`, `Toolbar`, `ToggleGroup`, `Slider`, `Progress`, `Separator`, `ScrollArea`, `FormField`, `Field`, `CheckboxGroup`, `RadioGroup`, `Join`, `Steps`, `Timeline` |
| `invalid`, `busy` | boolean | every field control, each emitting `aria-invalid` / `aria-busy` beside `data-invalid` / `data-busy`; `CheckboxGroup` and `RadioGroup` take an `error` message instead of `invalid`, while their `.Item` keeps `invalid`; a `CheckboxGroup` root stamps `data-invalid` without `aria-invalid`, which ARIA 1.2 deprecates on its `group` role, so mark its `.Item`s `invalid` to announce it; `Button` writes `busy` through `loading` |

Some props deliberately sit outside it: `Switch`'s label side is `labelPlacement`, and `FormField`'s width-driven collapse is `responsive` — neither
is an axis, so neither rides `orientation`. `Turnstile`'s `size` is Cloudflare's, passed through verbatim.

**`loading` marks a button unavailable as well as busy** — `aria-busy` and `aria-disabled` together, which keeps the reader's focus where it is
where a native `disabled` would drop it, and refuses the button's own scope action. **On a `type="submit"` button, pair it with `disabled`**:
`aria-disabled` is advisory, and the platform submits the form on Enter regardless, so a second press during the request dispatches a second submit.
The `challenge="submit"` controller already does both to the submitter it holds.

### Set orientation, type or size once on the root

A compound root passes its own setting down to the parts that depend on it. You set the prop on the root rather than on each part:

```tsx
import { Tabs } from "@y-core/forge/ui/core";

<Tabs orientation='vertical'>
  <Tabs.List label='Settings'>…</Tabs.List>
</Tabs>
```

`Tabs` passes its `orientation` to `Tabs.List`, and `ToggleGroup` passes its `type` to each `.Item`. `RadioGroup` and `CheckboxGroup` pass
their `size` to each `.Item`, and a vertical `Toolbar` stacks each `.Group` and turns each `.Separator` to run across it. The bound
`ToggleGroup`, `RadioGroup` and `CheckboxGroup` from [`ui/controls`](#y-coreforgeuicontrols) do the same.

**A prop you set on the part wins.** The root fills in only the props the part leaves unset.

**The root cannot reach a part inside your own component.** It sees only the parts written directly in its children. Plain elements and fragments
between them are fine, but a component of yours that renders a `Tabs.List` hides that List from the root. In that case, pass the prop to the part
yourself.

### Attach your own `data-*` and `aria-*` attributes

Every component forwards **unrecognized props** onto its root (or designated inner) element, so a client-side binding convention attaches without
re-wrapping anything. The renderer applies its own rules ([`src/render/jsx/render-to-string.ts`](../render/jsx/render-to-string.ts)): values are HTML-escaped and URL-bearing
attributes additionally scheme-sanitized via `safeUrl`; `style` is **dropped**, because forge's CSP carries no `style-src 'unsafe-inline'`
([`UI_SSR_COMPONENTS.md`][usc-1a] §1a). Anything you need to position or colour at runtime is therefore a class or a custom property written through
CSSOM, never a generated `style` string.

### Open a dialog, menu, popover or tab panel with no JavaScript

Overlays and disclosures are native: `<dialog>`, the Popover and Invoker Commands APIs, and `<details>`. Open, close, light-dismiss, Escape, the top
layer and the backdrop are the platform's, and forge publishes no open state of its own — assert on `[open]` and `:popover-open`, not on a forge
attribute. The one thing it mirrors is a `Popover` or `Menu` trigger's `aria-expanded`, which `ui/core/client` keeps in step with the popup.

**The pairing you write is `for` on the trigger and `id` on the surface.** `Dialog`, `Drawer`, `Popover`, `Menu` and `Tabs` all take it that way,
and a `Menu.Item`'s own `for` names the popup its selection closes — `false` leaves the popup open.

**An unselected `Tabs.Content` renders `hidden="until-found"`, so the first paint is already correct and find-in-page can reach the panel.**
Following a tab's link shows its panel, and so does a find-in-page match inside it; once `mountTabs` runs, the match also selects the panel's tab.
An engine without `until-found` treats the panel as plain hidden. A disabled tab's panel is `hidden=""` once mounted, which find-in-page never
reveals. So a test expects `hidden="until-found"` and `tabindex="-1"` on an unselected panel, with or without the controller.

**A `Dialog` or `Drawer` must be named, and the type says so**: pass `titled` when you compose a `.Title`, and the root points `aria-labelledby` at
that heading, so the overlay is named by what the reader sees; pass `label` or `labelledby` instead when there is no heading to point at. Naming
none of the three does not compile — single-pass SSR cannot see whether you wrote a `.Title`, so an unconditional reference would dangle and the
overlay would open unnamed.

`openModal` on a `Dialog` asks for the centred modal mode; `open` is the platform's non-modal mode and flows inline. On a `Drawer`, `open` docks
the panel at its edge above the page, with no backdrop and the page still usable. **A non-modal `open` surface is closed only by a control you
render**, such as a `.Close`, never by an outside click or Escape, so the reader can work beside it. A modal one closes on Escape or a
backdrop click, except an `alert` `Dialog` or `Drawer`, which closes on Escape alone. The rulings behind the choices are
[`UI_SSR_COMPONENTS.md`][usc-1h] §1h.

### Make a keyboard-driven component actually respond

`Toolbar`, `Menu`, `Tabs`, `Tooltip`, `NumberField`, `ToggleGroup`, a modal `Dialog`, a `Popover.Content` and an unbound readout `Slider` render a
`data-scope` and are **inert until `@y-core/forge/ui/core/client` is imported**: the markup stays valid and accessible, but the arrow keys are
missing. That import is [the next section](#y-coreforgeuicoreclient). `Filter` is scoped too, and without the import its `×` falls back to a
native reset: that empties a choice made on the page but restores one the server rendered, and inside your own form it resets the whole form.

### Render a button as something that is not a `<button>`

`asChild` merges the button's classes and forwarded props onto a single JSX element child via `cloneElement` instead of rendering a `<button>`:

```tsx
import { Button } from "@y-core/forge/ui/core";

<Button asChild tone='neutral' appearance='ghost'>
  <a href='/docs'>Docs</a>
</Button>;
```

It requires **exactly one JSX element child**; a string, number, fragment, array or empty child is a programming error and `Button` **throws**
rather than silently degrading ([`UI_SSR_COMPONENTS.md`][usc-1c] §1c). `Link` and `Breadcrumbs.Link` take the same prop, for merging onto a router
link. A disabled or loading `Button` rendered onto a link — an `<a>`, or a router link component given an `href` — stays a focus stop announced as
disabled, but loses its `href`, so it cannot navigate. When you need the button's paint on markup that is not a button at all — a pagination anchor,
a bespoke control — the `buttonVariants` resolver returns the class string on its own.

### Name an icon-only button with a tooltip

Give the trigger `kind="label"` and the tooltip's text becomes the button's accessible name, read once. Leave out `aria-label`: a label-mode
trigger carrying one throws.

```tsx
import { Toolbar, Tooltip } from "@y-core/forge/ui/core";

<Tooltip>
  <Tooltip.Trigger for='bold-tip' kind='label' asChild>
    <Toolbar.Button disabled={!canFormat}>
      <AppIcon name='bold' />
    </Toolbar.Button>
  </Tooltip.Trigger>
  <Tooltip.Content id='bold-tip'>Bold</Tooltip.Content>
</Tooltip>;
```

The default `kind="description"` is for a trigger that already has a name and wants a hint beside it. A disabled trigger renders
`aria-disabled="true"` rather than `disabled`, so it still takes hover and focus and the tooltip can say why it is unavailable; the client runtime
cancels its clicks ([`UI_SSR_COMPONENTS.md`][usc-1h] §1h). To toggle one in the browser, set both the attribute and the state hook:

```ts
trigger.setAttribute("aria-disabled", String(disabled));
applyStateAttrs(trigger, { disabled });
```

`applyStateAttrs` is exported from `@y-core/forge/ui/contracts`. Never set `disabled` on the trigger at runtime, which takes the tooltip away with
the click.

### Bind the icon sprite once

`Select`, `Spinner`, and the chrome `ThemeToggle` / `Navbar` / `Dock` / `Toolbar` take a required `icon` prop typed `ForgeIcon<Name>` — forge never
reaches for a glyph you did not hand it. Bind the sprite once with `createIcon("/assets/icons.svg")`; without a `meta` map that yields a permissive
`ForgeIcon<string>`, assignable to any narrower `ForgeIcon<Name>` by contravariance, so one `AppIcon` satisfies every call site.

An icon is decorative by default (`aria-hidden="true"`). Pass `aria-label` and the `<svg>` emits `role="img"` with that label instead — which is
what an icon-only control needs, since the name has nowhere else to come from.

### Compose a class string, and let the caller's class win

**Reach for what the class expression actually needs — a `const`, `cva`, or `cn`:**

| What you are building | Reach for | Why |
| --- | --- | --- |
| a class string that never varies | a module-scope `const` | it resolves once at load, not once per rendered element |
| classes that change with a `tone`, `size`, `shape` or other axis | `cva`, with the caller's class in the resolver's `class` slot | `cva` already ends in `cn`, so a second `cn` around it re-resolves settled output |
| two or more independent sources — a base, a caller class, a condition | `cn` | last argument wins each conflict, so precedence is the argument order |
| one string that may conflict with itself | `cn`, with one argument | `cn("p-4 p-8")` is `"p-8"` — a single-argument call is not a no-op |

`cn` drops falsy entries, resolves conflicting Tailwind utilities in favour of the later argument, and joins the rest with a space.
`cn("h-full", "h-5")` is `"h-5"`; `cn("h-full", "hover:h-5")` keeps both, because a modifier is part of the conflict key. Utilities outside forge's
conflict table pass through untouched, and the conflict model itself is [`UI_CLASS_COMPOSITION.md`][ucc-1a] §1a's.

A `cva` resolver composes its stages through `cn` in precedence order — base, then matching variants, then matching compounds, then the caller's
`class`. **Put the caller's `class` last, always**: that is the whole of the caller-wins guarantee, and anywhere earlier it loses to the component's
own defaults, silently and only for the utilities that happen to collide.

```tsx
import { buttonVariants, cn } from "@y-core/forge/ui/core";

// A resolver takes the caller's class itself — this is what `Button` does with its own props.
const className = buttonVariants({ tone, appearance, size, shape, class: cls });

// A non-variant condition alongside a resolver is what `cn` is for, and the caller's class still comes last.
<button aria-busy={isLoading} class={buttonVariants({ tone: "primary", class: cn(isLoading && "cursor-wait", cls) })}>Click</button>;
```

The `tone` × `appearance` paint every toned control composes over is published as `toneVariants`, for markup of your own that must sit in the
same palette. It carries a hover fill, so put it on something the pointer acts on. A static panel takes `toneSurface`, the same paint without the
hover fill ([`UI_CLASS_COMPOSITION.md`][ucc-1e] §1e):

```tsx
import { toneSurface } from "@y-core/forge/ui/core";

<section class={toneSurface({ tone: "info", appearance: "soft", class: "rounded-box border-field p-4 text-sm" })}>
  Scheduled maintenance starts at 22:00 UTC.
</section>;
```

### Put a glyph inside a file input

`FileInput` takes no children, and `FILE_INPUT_BASE` styles the native `::file-selector-button` — a pseudo-element nothing can be placed inside. So
an icon in the box is a composition _over_ the control rather than a child of it: position the input `relative`, reserve the gutter with a padding
class (`class='pe-10'`), and lay the glyph over that gutter as an `aria-hidden`, `pointer-events-none` sibling.

```tsx
import { createIcon, FileInput } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<div class='relative max-w-xs'>
  <FileInput name='avatar' class='pe-10' />
  <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground'>
    <AppIcon name='upload' width={16} height={16} />
  </span>
</div>
```

`pointer-events-none` is what keeps the glyph from swallowing the click that opens the file picker, and `aria-hidden` keeps it out of a name the
control's own label already carries.

### Keep a table's header in view while its rows scroll

Set `pinRows` and put the `Table` directly inside an element with a `max-height`. The table's scroll wrapper copies its direct parent's
`max-height`, so that limit is what turns the wrapper into a scroller and the header into a sticky one:

```tsx
import { Table } from "@y-core/forge/ui/core";

<div class='max-h-96'>
  <Table label='Orders' pinRows>
    <Table.Header>
      <Table.Row>
        <Table.Head>Order</Table.Head>
        <Table.Head>Total</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>{rows}</Table.Body>
  </Table>
</div>;
```

A parent sized with `h-96` instead, or a `max-h-96` one level further up, pins nothing: the table grows to its full height and the header scrolls
away with the page ([`UI_SSR_COMPONENTS.md`][usc-1h] §1h).

### Take a one-time code

Put an `OtpInput` inside a `FormField`, with `length` set to the number of digits the code has, and size the server schema to the same number:

```tsx
import { FormField, OtpInput } from "@y-core/forge/ui/core";
import { formDigits, v } from "@y-core/forge/validation";

<FormField invalid={Boolean(errors.code)}>
  <FormField.Label name='code'>Verification code</FormField.Label>
  <OtpInput length={6} field={{ name: "code", error: errors.code }} />
  <FormField.Error name='code'>{errors.code}</FormField.Error>
</FormField>;

const schema = v.object({ code: v.pipe(formDigits(), v.length(6)) });
```

With `@y-core/forge/ui/core/client` imported, a typed or pasted code is reduced to its first six digits as it arrives, so `123 456` and `123-456`
both read `123456`. Without it the code posts as typed and the schema reduces it, so the server gets the same value either way. `OtpInput` does
not accept `pattern` or `maxlength`: either one blocks a code pasted as `123 456`.

### Group a card or phone number as the reader leaves the field

`Input`'s `format` is a template whose `#` are the slots the value fills and whose every other character is a literal:
`format='#### #### #### ####'` groups a card number, `format='(###) ###-####'` a phone number. Reach for it only after the native affordances, which
need no script: `inputmode`, `pattern`, `autocomplete` and `maxlength` are Tier 0, and CSS is Tier 1. Nothing regroups **as** the user types — that
is a caret-bug generator forge does not ship — so the value is regrouped only when focus leaves the field.

**A literal is removed only where the template places it, so a leading literal may be typed fully, partly or not at all.** With
`format='+1 (###) ###-####'`, the values `4155551212`, `14155551212` and `+1 (415) 555-1212` all group as `+1 (415) 555-1212`, because a leading
character equal to a digit literal is read as that literal. A literal typed where the template has a slot is kept as content, and a value with
more characters than the template has slots is left as typed.

**The formatted string is what the form posts.** `format` is cosmetic to the user, not to the wire: a `format=` field serialises as
`"4111 1111 1111 1111"`, and the server schema is half of the contract. Pair it with `formDigits()` from
[`@y-core/forge/validation`][validation-readme], which reduces the value to its digits so the field parses identically whether or not the script
ran. With a digit literal, `formDigits()` keeps the literal's digits — `+1 (415) 555-1212` parses as `"14155551212"` — so size the schema for
them, or reduce the value in the handler with `stripFormat(format, value)` from [`@y-core/forge/ui/contracts`](#y-coreforgeuicontracts).
`format` is never validation — the schema is the truth.

**The server paints the formatted value itself**, running the same transform at render time, so a first paint with JS disabled already reads
grouped, a re-render after a failed submit agrees with the post-blur value, and the controller's first write is a no-op. Nothing is required of the
app.

**`format` and `bind` do not compose.** A bound control's signal _is_ its state, and re-spacing the value would lie to every reader that parses it
back — `Number("1,234.50")` is `NaN`. The `ui/controls` `Input` does not accept `format`, so passing both is a type error; a `ui/core` `Input`
given `data-field` by hand and a `format` renders its value raw, and the client refuses the format with one warning and leaves it alone.

**Pair it with `tabular-nums` as a caller class** — `class='max-w-xs tabular-nums'` — so the groups do not shift width as digits change. It is
deliberately not in the component's own classes, which every consumer wears.

### Put a CAPTCHA on a form

`Turnstile` renders the container for Cloudflare's widget: a frame the widget mounts into, followed by two hidden alerts — the general fallback and
the unsupported-browser message. Place it **inside** the `<form>` so the token input Cloudflare injects is submitted with it; nothing else is
required, since the container stamps the `turnstile` scope and `resume()` mounts the controller ([`UI_CLIENT_RUNTIME.md`][ucr-2c] §2c). `siteKey` is
required and comes from the Worker env, never a literal.

**Add the preconnect hint to your page head yourself** — forge has no page-head API to hang it on, and under the eager default every page entry
opens the connection:

```html
<link rel="preconnect" href="https://challenges.cloudflare.com" />
```

The choices below are worth making deliberately; everything else has a default that is right for a form the visitor came to fill in.

- **When the script loads.** `load` is `"eager"` by default. Choose `"focus"` for a form incidental to its page, and the fetch waits for the first
  `focusin` inside it.
- **When the challenge runs.** `challenge` is `"render"` by default. Choose `"submit"` for a form that takes longer to fill than the 300-second
  token lives, and exactly one challenge runs at the press. It needs an htmx submission on the form or a descendant; without one the controller
  reports it and falls back to `"render"`. Cloudflare's documented pairing for it is `appearance="interaction-only"`, which is an independent axis.
- **What the token is scoped to.** `action` and `cData` are what make `verifyTurnstile({ expectedAction })` and `{ expectedCData }` usable on the
  server, and `cData` is the only way to tie a challenge to an app-side record. Each has a Cloudflare charset; a value outside it is reported and
  **still forwarded**, leaving the server the one enforcement point.
- **More than one widget in one form.** `responseFieldName` renames the hidden token input, and pairs with the server's `tokenField` option.

Under `challenge="submit"` the submitter is `disabled` and `aria-busy` while the press is held, and is re-enabled before
`TURNSTILE_ABANDONED_EVENT` fires. How the hold ends, and which presses it holds at all, is [`UI_CLIENT_RUNTIME.md`][ucr-2c] §2c's.

**Every hold that ends without a request tells the page.** Listen for it when the page should react — refocusing the submitter, or surfacing your
own message:

```ts
import { TURNSTILE_ABANDONED_EVENT, type TurnstileAbandonedDetail } from "@y-core/forge/ui/contracts";

form.addEventListener(TURNSTILE_ABANDONED_EVENT, (event) => {
  const { reason, submitter } = (event as CustomEvent<TurnstileAbandonedDetail>).detail;
  submitter?.focus();
});
```

---

## `@y-core/forge/ui/core/client`

**Browser-only, side-effect import. esbuild entry points only; it has no exports.**

### Register the scopes `ui/core` markup names

```ts
// src/client/main.ts (esbuild entry point) — every island is imported this way:
import "@y-core/forge/ui/core/client"; // side-effect: registers the scopes
import { resume } from "@y-core/forge/ui/client";

resume();
```

**This import is not optional if the app renders any scoped component.** Without it the components render correctly but never behave, and `resume()`
`console.warn`s about the unregistered `data-scope` — silent in the markup, loud only in the console. The rule is
[`UI_SSR_COMPONENTS.md`][usc-2d] §2d.

One import registers every scope `ui/core` markup names; `src/ui/core/client.ts` is the list, and what each one does is
[`UI_CLIENT_RUNTIME.md`][ucr-2] §2's.

A `Toast` you render yourself carries its auto-dismiss delay as island state under the key `ui/contracts` publishes; a positive value schedules
removal on the toast's own realm clock. A timed toast waits while it is hovered, while it holds keyboard focus, or while its page is hidden.

---

## `@y-core/forge/ui/controls`

Pre-bound wrappers over the `ui/core` primitives — the "bound decoration" layer. Each mirrors its `ui/core` sibling in name and prop shape, so alias
on import when a bound control and its primitive are both in scope. This static barrel is the **only** bound-control API; there is no runtime
factory ([`UI_SSR_COMPONENTS.md`][usc-2c] §2c).

### Bind a control to a signal without wiring each field

```tsx
import { Slider, Switch } from "@y-core/forge/ui/controls";
import { bindControls, registerScope } from "@y-core/forge/ui/client";
import { Resumable } from "@y-core/forge/ui/server";

// Server:
<Resumable name='chrome' state={settings}>
  <Switch bind='gridVisible' checked={settings.gridVisible}>
    Grid
  </Switch>
  <Slider bind='fov' min={1} max={120} value={settings.fov} output />
</Resumable>;

// Client:
registerScope("chrome", { eager: true, setup: ({ root, state }) => bindControls(root, state) });
```

The required `bind` prop names the signal. **The scope must be `eager: true`**,
because no bound control stamps a `data-on-*` action of its own — `bindControls` listens once on the scope root, so a bound control's markup names
its field and nothing else.

**Where `bind` lands differs for a compound**, and that is the only thing to remember about this barrel: a plain control binds on itself, while
`CheckboxGroup`, `RadioGroup` and `ToggleGroup` pass their root through unchanged and bind on `.Item` — whose required `value` is stamped alongside,
which is how `bindControls` tells one member from another. `NumberField` binds on `.Input` alone; its steppers are unchanged.

### Decide between `bind` and `field`

They answer different questions and may coexist on one control. `field` wires `id` / `name` / `aria-*` for **form accessibility**, so the control
posts and is announced correctly. `bind` wires `data-field` for **signal binding**, so the control's value is client state. A settings panel that
also submits carries both.

---

## `@y-core/forge/ui/contracts`

**Runtime-neutral.** Pure data and pure functions — no DOM, no Node built-ins, no side effects.

The names forge's SSR components and its browser controllers **both** write, declared once so they cannot drift — and published, because an app
consuming forge's components addresses the same DOM.

**Import the modules, not the barrel, in code you bundle** — forge's own components import each module directly, so a bundle retains one table
rather than every table.

### Name a popover panel

`Popover.Content` is `role="dialog"`, which takes its name only from the author, so one of `label` or `labelledby` is **required** — a nameless
panel will not compile. Prefer `labelledby` pointing at the trigger's own text, which is the name the reader saw before they opened it:

```tsx
import { Popover } from "@y-core/forge/ui/core";

<Popover>
  <Popover.Trigger for='share'>
    <span id='share-trigger'>Share</span>
  </Popover.Trigger>
  <Popover.Content id='share' labelledby='share-trigger'>
    …
  </Popover.Content>
</Popover>
```

`Popover.Trigger` already renders a control-height button box, so restyle it through `class` rather than wrapping it in a `Button`.

`role` is not forwardable either. The trigger always says `aria-haspopup="dialog"`, so a re-roled panel would leave the pair disagreeing; a
menu-role popup is `Menu.Popup`, which comes with a trigger that agrees with it.

### Translate the names forge falls back to

Forge ships no i18n surface, so every English name it emits is a default you can override by a prop. `LABEL_DEFAULTS` is where all of them live —
one table for the whole library, so a translation layer has one seam rather than one per component. `STEP_STATE_LABELS` sits beside it for the
table indexed by a runtime value, a `Steps.Step` or `Timeline.Item` state.

```ts
import { LABEL_DEFAULTS } from "@y-core/forge/ui/contracts";

// Key on the key. A new site in a later forge release is a compile error here, not a missed string.
const fr: Record<keyof typeof LABEL_DEFAULTS, string> = { alertDismiss: "Fermer", breadcrumbs: "Fil d'Ariane" /* … */ };

<Alert dismissible dismissLabel={fr.alertDismiss} />;
```

**Key your catalogue on the key, never on the English value.** Matching `"Dismiss"` to decide what to render makes every wording fix in forge a
silent breaking change for you, and one forge's gate cannot detect. The key is the stable name; the value is the thing you are replacing.

`Carousel`'s role descriptions, `carouselRoleDescription` and `carouselSlideRoleDescription`, have no prop of their own: pass the translation as
`aria-roledescription` on `Carousel` or `Carousel.Item`, together with the `label` without which no role description reaches a reader.

One name has no default and takes none: `Navbar`'s `<nav>` landmark. An unnamed `<nav>` already announces as "navigation", so a constant default
would replace a correct platform default with a guess — and give two Navbars on one page the same name. Pass `aria-label` or `aria-labelledby`
yourself wherever a page renders more than one.

### Assert on forge's markup in your own tests

**Boolean states are emitted by presence with an empty value — `data-selected=""`, never `"true"`** — while `aria-*` keeps its string form because
WAI-ARIA requires it ([`STATE_ATTRIBUTES.md`][sa-1a] §1a and §1b). Assert the same grammar: `toHaveAttribute("data-selected", "")` for a forge
state, and the platform's own `[open]` / `:popover-open` for anything native, since forge publishes no open state of its own.

The full table of state names, `data-state` among them, and the presentational enums (`data-tone`, `data-appearance`, `data-size`) that sit
beside them, are declared in this subpath rather than restated anywhere — a component emitting a state outside the table fails a conformance test.

### Build markup in the browser that forge's controllers will drive

A row you create at runtime needs the same attributes the server would have stamped, and this subpath is where they come from rather than a string
literal of your own. The helpers cover it in both directions: `stateAttrs` / `presentationAttrs` build the SSR attribute bags, and `applyStateAttrs`
is the browser half — only keys present in the state object are touched, and a touched key is reconciled in full.

Selectors and scope names follow the same rule. Forge's `menu` scope finds its rows **by ARIA role** rather than a forge marker, so a `<button>` you
build with `menuItemAttrs` and the published class is navigable the moment it is correctly roled. It is painted the same way too: a checkable row
draws its tick from `data-checked`, so write the state with `applyStateAttrs` beside `aria-checked`. `Toolbar`, by contrast, uses an explicit item
marker, because `Toolbar.Group` and `Toolbar.Separator` are toolbar slots that must **not** be focus stops.

### Share one action namespace between server and client

`scopeAttrs` builds the typed `data-on-<event>` delegation attributes a scope's markup carries, and it is generic over the same action-name union
`registerScope` takes — so a typo in an action name is a compile error rather than a dead button.

`SCOPE_EVENTS` is the closed list a resumable scope delegates on: click, input, change and submit. **There is no `keydown`, by decision** — a
composite controller owns keyboard at its own widget root.

---

## `@y-core/forge/ui/contracts/theme`

**Runtime-neutral.** Pure data and pure functions — safe in a Worker, a browser bundle, or a build script.

The colour model a forge scheme is generated from, and the contrast audit the gate, a customiser page and the scheme files share. Forge ships the
generator and no customiser page; the demonstrator, forge-starter, carries the customiser that consumes it. The generation pipeline is
[`THEME_GENERATION.md`][tg]'s.

### Generate a scheme file from a set of dials

```ts
const theme = buildTheme(dials); // both families, both modes
const css = schemeCss(theme, dials); // a paste-ready theme-*.css
const ratios = liveRatios(theme); // every audited pair, measured
```

`schemeCss` output is standalone-complete: paste it beside `forge.css` and import it after, exactly as a shipped scheme is imported. `dialQuery`
turns the same dials into a query string, which is how a customiser makes a scheme shareable as a link with no storage of its own.

**Chroma travels in thousandths** through the dial declarations, and `buildTheme` converts. Each dial carries its own range on its declaration, so a
UI driving them clamps against the declaration rather than a number you copied.

### Measure a pair yourself

`contrastRatio` takes two opaque `#rrggbb` colours and is order-independent; `relativeLuminance` is the WCAG figure behind it. The pairs forge
itself audits, and the criterion binding each, are declared here — so a check of your own measures the same set the gate does rather than a list
that drifts from it. The decorative pairs WCAG 1.4.11 does not bind are declared separately, each pinned at its measured value with a mandatory
reason.

The OKLab→sRGB arithmetic is published too, under either gamut policy; `toSrgbGamut` is the one that reduces chroma alone to reach a representable
coordinate.

---

## `@y-core/forge/ui/assets`

Forge owns all of its UI glyphs — the control and navigation set in `src/ui/assets/core/`, and the theme glyphs in `src/ui/assets/theme/`.

### Add forge's glyphs to your sprite build

The manifest exposes them as a `SpriteSource[]`, so a consumer's build config never hand-lists forge's internal filenames:

```ts
defineAssets({ spriteSources: [...forgeUiSpriteSources(), myOwnSprites] });
```

`forgeUiSpriteSources` comes from [`ui/assets/build`](#y-coreforgeuiassetsbuild), never from this barrel — it resolves absolute paths and is
therefore build-time only. This barrel re-exports the glyph names and the runtime parser from
[`ui/assets/glyphs`](#y-coreforgeuiassetsglyphs); in client code import them from that subpath directly, which is the one that states nothing behind
it reaches a Node built-in.

Every glyph forge's own chrome needs ships in `forgeUiSpriteSources()`, so a `ForgeIcon` bound to the resulting sprite satisfies `Navbar`, `Dock`,
`Toolbar`, `ThemeToggle`, `Select` and `Spinner` without further work.

---

## `@y-core/forge/ui/assets/build`

**Build-time only.** Reaches `node:fs`, `node:path` and `node:url`; never import it from a Worker-executed file.

The build-time computation behind the artifacts `ui/assets` owns. Why it lives beside the artifact rather than in the asset pipeline is
[`ASSET_PIPELINE.md`][ap-2c] §2c's.

### Assemble a sprite, read a theme token, bake a cursor

Reach here from a build script, not from a route. **`sanitizeSVG`, which `svgToSymbol` applies, drops any construct it does not recognise** rather
than carrying it through. That makes an SVG from a designer safe to inline; it is defence in depth for a source you already trust, not a substitute
for a DOM sanitizer on one you do not. To bake a themed cursor, `readThemeTokens` reads the per-theme custom properties out of compiled CSS,
`resolveToken` follows a `var()` chain to a literal, and `buildCursors` turns each cursor × theme into a CSS `cursor` value.

---

## `@y-core/forge/ui/assets/glyphs`

**Runtime-neutral.** No DOM and no Node built-ins; `loadSpriteGlyphs` needs a `fetch`.

### Read a glyph's markup at runtime

Some uses cannot go through the `<use href="#icon-…">` indirection a `ForgeIcon<Name>` renders — a CSS custom cursor, an inline `<svg>` you
recolour, a canvas draw. Parse the build-generated sprite instead and read the glyph directly:

```ts
const glyphs = await loadSpriteGlyphs("/assets/icons.svg"); // { [name]: { viewBox, markup } }
```

`parseSpriteGlyphs` is the synchronous half, for sprite text you already hold. Both take an optional id prefix, defaulting to `"icon-"`, and key the
result by the bare name.

**Both degrade to `{}` and never throw** — on empty input, unparseable markup, a non-`ok` response, or a network error — because a missing glyph map
must leave the app on its stylesheet default rather than break boot. Guard on an empty map, not on a rejection.

**`loadSpriteGlyphs` is a boot-time read.** A successful result is memoized per URL and prefix for the life of the isolate, which a deploy resets,
so calling it inside a handler costs a subrequest and a parse on the first request alone. A failure is never memoized: one transient error would
otherwise blank every glyph until the isolate is replaced.

The name tuple published here is the one to narrow or validate against when a glyph name arrives from outside your code.

---

## `@y-core/forge/ui/client`

**Browser-only.** Importing this subpath touches no DOM, so it loads in a Worker without error. Calling an export that does — `resume()`,
`announce()` — throws a `ReferenceError` there, inside a live request. Nothing at runtime stops the import, so keep it out of server code by path:
import it only from your client esbuild entry, and set your gate preset's `ssrBoundary` option so `validate-ssr-boundary` fails a server file that
reaches it ([gate presets][gate-presets]).

### Start the runtime

```ts
import { resume } from "@y-core/forge/ui/client";

resume(); // install the delegated island listener, and hydrate every eager scope
```

`resume(within?)` installs the delegated listeners once per document — refcounted across calls — and returns a disposer for the scopes _this_ call
resumed. Call it after every `registerScope` and after every scope-registering side-effect import, since the eager pass only hydrates what is
registered by then.

**Call `resume(shadowRoot)` for a shadow root you attach after `resume()` ran.** Without it, a click or an input inside it still reaches its
handler, but a `change`, `submit`, `reset` or `command` does not ([`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c).

Narrower calls exist for markup that arrives later: `resumeScope(root)` resumes one scope element now and answers with its signal state, and
`disposeScopesIn(el)` disposes the scope at an element and every scope below it — call it **before** you remove scoped markup yourself. An htmx swap
needs no call: [`ui/client/htmx`](#y-coreforgeuiclienthtmx) disposes every scope a swap removed ([`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c).

Theme is **not** a controller here — it is a resumable scope registered by [`ui/chrome/client`](#y-coreforgeuichromeclient).

### Tell a screen reader something

Stamp `<Announcer />` from `ui/core` once in your layout, then speak through it from the client:

```ts
import { announce } from "@y-core/forge/ui/client";

announce("Draft saved", { channel: "save-status" });
announce("Payment declined", { politeness: "assertive" });
announce("", { channel: "save-status" }); // cancels a message still settling
```

Give each independent stream its own `channel`: a later message replaces one on the same channel that has not been spoken yet, and an identical
message is skipped unless you pass `repeat: true`. Toasts, a failed submission's first field error, and htmx request spinners are announced for
you, so do not repeat them. Without an `<Announcer />` the call does nothing and warns once. The channel semantics are
[`UI_CLIENT_RUNTIME.md`][ucr-2m] §2m.

### Hold state in signals

`createSignal` is the cell, `computed` the derived read-only view, and `effect` the subscription that returns a disposer. Reading `.value` inside a
`computed` or an `effect` is what subscribes.

A write flushes the graph before it returns, so every dependent has already observed the settled value on the next line. A `computed` derives on
**read**, never on write: its body never runs if nothing reads it, and no reader can observe a derived value assembled before one of its sources
moved. A `computed` created in a scope's `setup` is released with the scope, as an effect is, and from then on reads its last value without
following its sources. The guarantees and what they cost are [`UI_CLIENT_RUNTIME.md`][ucr-3a] §3a.

`signalRecord(initial)` is the shape the island runtime and `bindControls` both speak: one independent signal per key, with `writeSignal` as the
typed per-key writer.

### Resume an island

The server marks an interactive region with a `data-scope` name and serialized state (via `Resumable`); the client registers the scope's handlers
and installs one delegated listener. A scope resumes on the **first** interaction with any descendant carrying a `data-on-<event>` attribute — state
is rebuilt into signals, `setup` runs once, then the named action fires.

```ts
registerScope("counter", {
  setup: ({ root, state }) => {
    const out = root.querySelector("[data-ref='out']");
    effect(() => {
      if (out) out.textContent = String(state.count.value);
    });
  },
  on: {
    inc: ({ state }) => {
      (state.count.value as number)++;
    },
  },
});

resume(); // returns a disposer for the scopes this call resumed
```

**The effect above needs no disposer, and that is the contract, not an omission.** Every effect and `computed` created while a `setup` runs is owned
by the runtime and disposed with the scope; a `setup` returns a disposer only for what the runtime cannot see — listeners, observers, timers,
controller handles — and it runs _after_ the scope's effects are disposed. An effect created in an `on` handler, or after an `await`, belongs to
whoever created it.
`setup` also receives a `signal`, aborted when the scope is disposed: hand it to `fetch` and to `addEventListener`, and neither needs a disposer.

Set `eager: true` when the markup carries no `data-on-*` action at all, since nothing would otherwise trigger a lazy resume. When to reach for
`Resumable` and when to hand-render the scope root is [`UI_CLIENT_RUNTIME.md`][ucr-2a] §2a.

### Two-way-bind every control under one root

Pair the SSR `fieldAttr` helper (from [`ui/server`](#y-coreforgeuiserver)), or the [`ui/controls`](#y-coreforgeuicontrols) wrappers, with
`bindControls` — one listener on the root, one effect per field, no per-field wiring.

DOM → signal resolves the nearest `[data-field]` across shadow boundaries, absorbing a click that landed on an inner `<svg>`, and **infers the
value's type from what the signal currently holds**: `boolean` reads `checked`, `number` goes through `Number()`, a `string[]` toggles membership of
the item's value, anything else is the string. So seed the record with the type you want back. Signal → DOM paints `checked` / `value` and the
pressed state, guarded by a differs-check so a paint never fights a drag in progress. A form reset, whether scripted or from a reset button, and
whether the form sits inside the root or wraps it, repaints every bound control from its signal, because the signal is the state. Inside a shadow
root, `change` and `reset` are heard only in one that was open under the root when `bindControls` ran.

**The signal is the state and the DOM is a paint of it**, so the pressed state is never read back — which is what lets a repaint restore a group
after its markup was replaced wholesale ([`UI_SSR_COMPONENTS.md`][usc-2a] §2a). A `data-field` naming no signal reports and is skipped.

`bindText` and `bindAttr` are the one-way siblings, for markup that only _displays_ a signal — text content, or one named attribute. Bound to a
boolean, an `aria-*` attribute or `draggable`, `contenteditable` or `spellcheck` is written `"true"` or `"false"`, `translate` is written `"yes"`
or `"no"`, and `autocapitalize` is written `"on"` or `"off"`, as the renderer writes them; any other attribute is present for `true` and removed for
`false`.

**`bindAttr` sanitizes at least as strictly as the renderer does**, because a signal is seeded from `data-island-state` and so is as reachable as a
request parameter. A value bound to `href`, `src`, `data` or any other URL attribute has a scheme outside http/https/mailto/tel collapsed to `"#"`;
a bare `on*` name, any `hx-on` spelling, `hx-vals`, `hx-headers`, `hx-confirm` or `hx-trigger` in either prefix, `srcdoc`, or `style` — which the
renderer drops under the shipped `style-src 'self'` — is refused outright, reported and skipped. htmx evaluates those `hx-*` values as script
([`HTMX.md`][htmx-7b] §7b). `bindAttrAttr` from `ui/contracts`, which stamps the binding at render time, throws on those names instead. A value
bound to `hx-action` or a request verb such as `hx-get` that begins `js:` or `javascript:` removes the attribute, with one warning, until a safe
value arrives ([`HTMX.md`][htmx-7a] §7a). No other `hx-*` value is sanitized, for the reason that section gives.

### Write a controller that survives an iframe, a shadow root or a foreign realm

If you write your own controller, reach for this subpath's DOM helpers rather than the global reflex. Each reflex has a failure mode that is
invisible in the common case and total in the uncommon one:

| Reflex | What breaks |
| --- | --- |
| bare `document` / `window` | they name the **top-level** realm — a controller mounted in an iframe installs its listeners on a document its element is not in, and reads its platform constructors off a realm that need not have them |
| `event.target` | retargeted at a shadow boundary: for an event that crossed one it reports the **host**, not the element hit |
| `document.activeElement` | the same problem in reverse — it stops at the host and never reports the focused item inside an open shadow root |
| `instanceof HTMLElement` | `false` for an element from another realm, because every realm has its own constructor. It compiles, it type-narrows, and it rejects a perfectly good element |
| `document.getElementById` | searches the document only, and an id inside a shadow root is not in it — a `commandfor` or `aria-controls` naming a sibling in the same shadow tree resolves to `null` |
| bare `getComputedStyle` | the top-level window's again, and a _global_ direction read cannot see that one subtree of an LTR page is RTL |

The node-resolved replacements are `ownerDocument` / `ownerWindow`, `eventTarget`, `activeElement`, `asElement`, `elementById`, `queryAcross` /
`closestAcross` / `contains`, and `isRtl`. `safeStorage(win)` is the same idea for `localStorage`, which a private-mode `getItem` throws from even
though the property is present — only a real access answers, so the helper returns the store or `null`.

**Every controller returns a disposer, and that is a contract** ([`UI_CLIENT_RUNTIME.md`][ucr-2d] §2d). Return it from a scope's `setup` and
`resume()`'s teardown runs it. The runtime owns effects and computeds, not listeners, so a `setup`'s own disposer covers the controllers and
listeners it installed and never the effects or computeds it created.

**A platform constructor is read off the resolved window too.** A realm **may not have the constructor at all**, and reading it off the resolved
window doubles as the feature check, so the controller degrades to a no-op disposer rather than throwing; and an observer, timer id or media-query
list held past the teardown of the realm that minted it is a **cross-realm retention**.
**Direction is resolved where it is consumed, never cached at mount**, and **an id reference is resolved in the tree that declares it**, because ids
do not cross a shadow boundary.

### Open a menu where the pointer landed

Every other popup in forge is positioned by CSS Anchor Positioning against its invoker. **A context menu has no invoker** — it opens where a
right-click landed — so every anchored rule resolves to nothing and the UA's `[popover]` default centres the panel in the viewport.
`openPopoverAt(menu, event.clientX, event.clientY, { afterPointerUp: event.buttons !== 0 })` is the whole call from a `contextmenu` handler.

**`afterPointerUp` is not optional there**: the event fires _between_ `pointerdown` and `pointerup`, and the platform light-dismisses the menu on
that trailing release, so it flashes and vanishes. Pass `event.buttons !== 0` rather than `true` — a `contextmenu` raised from the keyboard reports
no buttons and is followed by no release.

The popup opts in with `Menu.Popup`'s `coords` prop, or the marker attribute `ui/contracts` publishes. Coordinates travel as two custom properties
written through **CSSOM**, never a generated `style` attribute. Calling it again with a new point **repositions** an open popup, so a second
right-click needs no close first. The ruling is [`UI_CLIENT_RUNTIME.md`][ucr-2i] §2i.

### Mark what the reader is looking at

```ts
mountScrollSpy({ root: navEl }); // current-section marker
mountCarouselDots({ root: dotsNavEl }); // current-slide marker
mountViewportCollapse({ selector: "#app-rail" }); // width-driven disclosure
mountRovingFocus(rail, { items: "[data-slot~='rail-item']", orientation: "vertical" });
```

Each option type's fields and defaults are declared beside its controller under [`client/`](./client/).

`mountScrollSpy` stamps `aria-current="location"` — never `"page"`, since the page did not change — on exactly one link, and emits no `data-*`
state, so the visible cue is the stylesheet's alone. `mountCarouselDots` marks the current dot the same way, for the same reason: a dot is a
fragment link within the page it sits on. `Pagination` proper keeps `"page"`, which is what its links actually change.
**Entries are ordered by the targets' document position, not by link order**, because a nav may list its links in any order while "which section am
I reading" is a question about the page.

`mountCarouselDots` observes the slides **against the strip**, not the viewport, and moves the dot row's server-rendered selected class onto the dot
for the most-visible slide — the highlight follows a swipe as well as a press. It **keeps the last marking** while no slide clears a threshold,
rather than blanking the row mid-flick, and adds **no autoplay**: the strip is scrolled by the reader and the platform alone.

`mountViewportCollapse` wants the `<details>` rendered **open** — with scripting unavailable the navigation is visible, which is the safe state —
and **stops driving it the moment the user toggles it themselves**, per mount and not persisted. It **throws** when the element it was told to drive
is absent or is not a disclosure, and **reports** when the realm has no `matchMedia`. `mountNavDrawer` is its off-canvas sibling: it gives an open
`<details>` its modal behaviour — Escape, scroll lock, focus trap — for as long as its media query matches. On open it moves focus to the panel's
first focusable control, waiting out the disclosure's open transition (`::details-content` as well as the panel's own). **The panel is the first
child of the `<details>` that holds a focusable control**, skipping the `<summary>` and a `navbar-backdrop` slot, so an unmarked backdrop placed
before the panel is passed over; pass `panelSelector` when your panel is not a direct child. When nothing focusable resolves, it **warns** rather
than throws, since a menu with no links is valid markup and the chrome mounts drawers itself.

`mountRovingFocus` makes a composite you render one tab stop, and resolves its **items live on every interaction**, so a composite whose items are
swapped, filtered or reordered needs no re-registration. The ring's rules: arrow keys inside a text field belong to the caret until its edge;
direction is read from the element, so an RTL island inside an LTR page navigates as RTL; items present but not rendered are out of the ring; a
nested composite keeps the key it consumed; `disabled` leaves the ring while `aria-disabled` stays in it, focusable but inert. Mark the initial tab
stop with the attribute `ui/contracts` publishes for it. Forge's own composites mount it through their scopes, and a `RadioGroup` has the whole
contract from the platform, so this is for a composite **you** render.

### Defer a module until it scrolls into view

```ts
lazy({ ref: "map-section", load: () => import("./map"), init: (mod, el) => mod.initMap(el) });
```

`ref` names a `data-ref` anchor in the markup; the import is issued the first time that anchor approaches the viewport, and `init` receives the
module and the element. Options and defaults are in [`client/lazy.ts`](./client/lazy.ts).

It retries a rejected `load()` a bounded number of times, and a rejection with no `onError`, a throwing `init`, a missing anchor and a realm with no
`IntersectionObserver` all **report**, because a module that never loads is otherwise indistinguishable from one that was never scheduled
([`UI_CLIENT_RUNTIME.md`][ucr-3b] §3b).

---

## `@y-core/forge/ui/client/htmx`

**Browser-only, side-effect import.** esbuild entry points only.

```ts
import "@y-core/forge/ui/client/htmx"; // side-effect only — no exports used
```

It loads htmx onto `window`, removes htmx's built-in indicator stylesheet so forge's own busy states are the only ones painted, and wires scopes and
the announcer to every swap. **A morph never changes an element's `style` attribute**: a style your script wrote survives it, and a `style`
the server sends on that element is neither applied nor removed, so change a morphed element's look through a class. It re-exports `htmx` for
the rare call site that needs the instance directly, but the bare side-effect import is the canonical usage. Mark the import so esbuild does not
tree-shake it, and **never load htmx from a CDN** — this entry pins the version through forge ([`UI_CLIENT_RUNTIME.md`][ucr-4] §4).

### Enforce Trusted Types on an htmx page

The entry creates a Trusted Types policy for htmx under the name `HTMX_TRUSTED_TYPES_POLICY`, and `<Turnstile>` creates one under
`TURNSTILE_TRUSTED_TYPES_POLICY` that admits only Cloudflare's script URL. List both names in your CSP:

```ts
import { createSecurityHeaders, NONCE } from "@y-core/forge/security";
import { HTMX_TRUSTED_TYPES_POLICY, TURNSTILE_TRUSTED_TYPES_POLICY } from "@y-core/forge/ui/contracts";

app.use(
  "*",
  createSecurityHeaders({
    scriptSrc: ["'self'", NONCE],
    trustedTypes: { policies: [HTMX_TRUSTED_TYPES_POLICY, TURNSTILE_TRUSTED_TYPES_POLICY] },
  }),
);
```

Under enforcement, keep your `<script src>` tags in `<head>` — `pageShell` already does — and write no `hx-on:*` handler and no `js:` value.
If you set htmx's `extensions` config, it must name the policy too. What each constraint protects is
[`SECURITY_HARDENING.md`][sh-2g] §2g.

### Answer a request that failed

A 4xx `text/html` response swaps into the request's target and a 5xx leaves the target as it was. So answer a refused submission with the fragment
the reader should see — the form re-rendered with its errors, at 422 — and let a server error fall through to your own error handling
([`UI_CLIENT_RUNTIME.md`][ucr-4a] §4a).

**A 4xx in any other content type leaves the target alone and is announced instead**, so a CSRF refusal's plain-text `Forbidden` is spoken
rather than replacing the form. The page needs `<Announcer />` for the reader to hear it. To swap such a response anyway, name its status on
the element that sends the request, as in `hx-status:403='swap:innerHTML'`. An explicit `hx-status:` wins over this rule.

---

## `@y-core/forge/ui/server`

**SSR-only.** These run in Workers/SSR contexts; never bundle them into the browser.

### Show a message on the page after a redirect

```tsx
import { createKeyRingResolver, importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createFlash, FlashContainer, FlashOob } from "@y-core/forge/ui/server";

const flash = createFlash({ ring: createKeyRingResolver<Env>((c) => importKeyRing(parseKeyRingSecrets(c.env.SESSION_SECRET))) });

await flash.success(c, "Profile saved.");   // in a POST handler, then redirect
const messages = await flash.get(c);         // in the next loader; clears as it reads

<FlashContainer messages={messages} position="bottom-right" />; // full page render
<FlashOob messages={messages} />; // HTMX out-of-band swap
```

`createFlash` takes a key-ring resolver, as the session does, and returns a flasher over a cookie signed under the ring it resolves for each
request — so build the flasher once at module scope, and let `createKeyRingResolver` import the ring once per env. The session's resolver serves,
because each cookie name signs under a subkey of its own. The cookie's name, path, max-age and `sameSite` all have defaults, so pass one only when
the app needs it to differ. `success` / `info` / `warning` / `error` are conveniences over `set`, and `get` clears as it reads.

**Every flash call in one request reaches the next page**, in the order the calls were made — calls started together, as in `Promise.all`,
count in the order they were started, and a call that throws leaves the others' messages in place. Past the cookie's 4096-byte limit the oldest
messages are dropped first, and a single message too large to fit on its own throws.

**Choose the renderer by how the page is arriving.** `FlashContainer` is the full-page render — a toast container wrapping the messages.
`FlashOob` wraps each toast in an HTMX out-of-band swap targeting the container already on the page, which is what a fragment response needs.
`Flash` alone renders the messages without a container, for a container you place yourself.

> **Flash toasts are scoped components.** All three render `Toast`, which drives dismiss and timed auto-close through the `toast` resumable scope.
> The app's client entry must `import "@y-core/forge/ui/core/client"` **before** calling `resume()` ([`UI_SSR_COMPONENTS.md`][usc-2d] §2d).

### Mark an island the client will resume

`Resumable` is the SSR half of the island pattern: its `name` must match the client-side `registerScope`, and `state` is the serializable object
rehydrated into signals. It performs no eager hydration of its own — the client decides that.

`id` and `class` exist for composition rather than behaviour: `id` makes the scope root a `commandfor` sink, and `class` dresses it — the scope
root is a real box in its parent's layout, so width, `shrink` and border belong there rather than on a wrapper you add around it.

`fieldAttr(name)` stamps the `data-field` attribute `bindControls` reads, for a control that is not a [`ui/controls`](#y-coreforgeuicontrols)
wrapper.

### Route a native Invoker command into a scope

`commandAttrs(action, commandfor)` builds the `command` / `commandfor` pair that routes a custom `--action` into a resumable scope, and accepts the
sink's id with or without its `#`. Reach for it when the invoker is outside the scope root — the delegated listener only sees events inside it — or
when the platform's own command event is the mechanism you want.

The handler that runs is the one on the scope holding the `commandfor` target, wherever the invoker sits, and its `el` is the invoker. An invoker
inside one scope that names an element in another runs the other scope's handler.

---

## `@y-core/forge/ui/chrome`

**SSR-only.** Their interactive halves are scopes registered by [`ui/chrome/client`](#y-coreforgeuichromeclient).

```tsx
import { Navbar, ThemeToggle, Toolbar, type NavDefinition } from "@y-core/forge/ui/chrome";

const nav: NavDefinition = {
  sections: [
    { items: [{ label: "Home", href: "home" }, { label: "Docs", items: [{ label: "Guides", href: "guides" }] }] },
    { items: [{ slot: "user_name" }, { label: "Sign out", href: "signout", filters: ["user"] }] },
  ],
};

<Navbar config={nav} resolveHref={routes.url} slots={{ user_name: <span>{user.name}</span> }}
        activeFilters={user ? ["user"] : []} icon={AppIcon} />;
<Toolbar config={tools} icon={AppIcon} placement="left" />;
<ThemeToggle icon={AppIcon} />;
```

### Describe a navigation bar as data

A `NavDefinition` is a list of sections, each a list of items; an item is a link, a menu (which recurses), a mega menu, a slot, or a group. Sibling
sections spread across the bar via `justify-between`.

The type does not express these rules, and both bite silently:

- **`href` is a route-map key, never a URL.** It is always passed through the required `resolveHref`, so a bar cannot hardcode a path the router
  later moves.
- **A `slot` that is a `string` is looked up in the `slots` map**, while a `JSXNode` is rendered inline — which is how a user's name reaches a bar
  that is otherwise static data.

**A group renders a heading over destinations that stay visible** — a `role="group"` wrapper with a `<p>` heading, since `Navbar` cannot know which
heading level it is nested under. Only a section's items and a mega menu's groups accept one, so a group nested inside a menu is a compile error
rather than a runtime degradation.

**Below `md`, and always on a rail, a menu or megamenu renders as an inline disclosure of its items; above `md` it is the popover.** The
disclosure is a native `<details>` that opens in the flow and pushes the items below it down, a nested menu nests as an indented disclosure, and
one holding the current page renders open. Both copies carry the item's `filters`.

**A mega menu is `Navbar` growth, not a new export.** At bar level it renders a `Popover` whose panel is a grid of its groups, capped at four
columns. There is no `role="menu"` — a block of links is navigation, Tab walks it, and light-dismiss and Escape are the platform's. Inside a menu
it degrades to a submenu of groups. Its `align` is `Popover`'s physical alignment — pass `"end"` on the last bar item so a wide panel stays inside
the viewport.

**`filters` shows an item only when one of its tokens is in the active set.** `activeFilters` seeds the set server-side for a flash-free paint, and
at runtime the app dispatches `NAVBAR_FILTERS_EVENT` (from `ui/contracts`) with the new tokens, a `string[]`, as `detail` — any other `detail` is
ignored. Dispatched on `document`, it re-syncs every bar. Dispatched
on a bar, or on anything inside one, it re-syncs that bar only, so a demo or a preview never repaints the site's own navigation. `Dock` takes the
same prop but is server-hidden only: there is no runtime re-sync for it.

**`filters` is presentation, not access control.** A filtered item's markup — its label and its `href` — is rendered and sent to every viewer;
`hidden` only stops it being painted, and the filters event is one any script on the page can dispatch. Gate the route itself. An empty list
therefore hides the item rather than showing it, so a token lookup that misses cannot reveal what it was meant to conceal.

### Choose how the bar collapses

`collapsible` decides which breakpoints the bar hides behind its toggle. `"mobile"` (the default) expands the panel and hides the toggle from `md:`
up; `"always"` keeps both at every breakpoint, which is why `placement` defaults to `"left"` there. `defaultOpen` renders the underlying `<details>`
open on first paint. The `navbar` scope `ui/chrome/client` registers mounts `mountViewportCollapse` on every bar, so below `md` an open bar closes
at resume, and reopens on widening unless the reader toggled it. A `collapsedAs="drawer"` bar also gets `mountNavDrawer`. You call neither for a
`Navbar`.

**A drawer slides from the edge `placement` derives** — the leading edge for `top` and `left`, the trailing edge for `right` and `bottom` — and
`drawerEdge` overrides it. Reach for it when the app keeps a drawer of its own on a top bar's leading edge: `drawerEdge="trailing"` opens the site
menu from the other side, so the two never share an edge. A rail takes no `drawerEdge`: its toggle shows at every width, so its panel slides
from the edge `placement` names.

**`id` namespaces the generated menu ids** on both `Navbar` and `Toolbar`, falling back to the placement each renders at. Supply a distinct value
when two bars share a placement, or both mint the same id and the second bar's trigger toggles the first bar's popup.

For a left rail, set `collapsible="always"` and put the layout classes on the wrapping box the parent lays out — not on `Navbar` — with that box's
parent supplying the definite height the `h-full` chain inside resolves against; write the collapsed width as an override on a `w-64` base so a
browser without `:has()` keeps the full column. The rulings are `forge-ui-nav-rail-flex-item`, `forge-ui-nav-rail-persists` and
`forge-ui-nav-rail-collapsed-width` in [`ui/design/reference/08-navigation.md`][navigation].

### Keep the bar on screen

**A `top` or `bottom` bar sticks from the outermost box `Navbar` renders**, so render it as a direct child of the element that scrolls — usually
`<body>`. A wrapper of your own around it is exactly the bar's height and leaves it nothing to stick within. `class`, `id` and every other
attribute you pass land on the inner `<details>`: they dress the bar, and do not change where it sticks.

**A top or bottom bar sizes its row from `--forge-navbar-height`, and its height is reserved as the page's scroll padding**, so a focused control
scrolls clear of it. On a phone a `left` bar pins to the top edge and a `right` bar to the bottom, and each is sized and reserved the same way; at
`md` and up it is a column and reserves nothing. Resize the bar by setting the token on `html`, never with a height class, which the reserve cannot
see. The bar's row and its reserve never go below 1.75rem, the 28px [Floor][floor] (§1f), whatever the token is set to. An inline bar opened on a
phone is taller than its reserve while it is open. A drawer's toggle fills that row on a phone, a rail's included, and the open panel starts below
it, or ends above it on a bottom bar, so the toggle never covers a link; a rail still reserves no scroll padding.

`Dock` is the phone-width alternative: a fixed bottom bar of three to five equal-weight destinations, hidden above a breakpoint you choose. It is
markup only — no scope, no controller. While the bar shows, forge's stylesheet reserves its height at the foot of the page: as scroll padding, so a
focused control scrolls clear of it, and as `<body>` padding, so the last one can. A bottom `Navbar`, or a `right` one on a phone, reserves its
height at the same edge, its reserve adds to the Dock's, and the Navbar rests on top of the Dock rather than beneath it; so does the panel of a
`side="bottom"` `Drawer`.

**Render one `Dock` per page, and resize it with `--forge-dock-height` on `html` and nothing else.** The reserve reads the token, never the bar,
so each of these leaves it wrong:

- **A class that changes the bar's position, such as `static`** — the page still reserves the fixed bar's height. forge has no in-flow Dock;
  render a `<nav>` of your own for one.
- **A class that sets the bar's height, such as `h-20`** — the reserve stays at the token. Set `--forge-dock-height` on `html` instead.
- **More than one `Dock`** — the reserve follows whichever `size` and `hideAbove` rules match, not the bar that shows. Render one.
- **A `pb-*` on your `<body>`** — it replaces the reserve's padding. Include the bar's height in it.

### Describe a toolbar as data

A `ToolbarDefinition<A, G>` is a list of groups, and a separator is auto-emitted between sibling groups. An item is an action, a popover, a
separator, or a slot.

**Both generics are the point of the type.** `A` is the app's action-name union, shared with `registerScope<A>`; `G` is the app's glyph-name union,
shared with the `icon` prop — so a typo in either is a compile error rather than a dead button or an empty `<use>`.

**An action item dispatches one of two ways, and both land in the same `on` table.** The default routes through the scope's `data-on-click`.
`dispatch: "command"` routes through the native Invoker `CommandEvent` bridge instead, emitting `command="--action"` against the `commandTarget`
element id — which is what you want when the handler lives on a scope the rail is not inside.

The whole rail is **one tab stop**: every action and popover trigger carries the toolbar item marker, and roving focus reads the root's orientation
— vertical for a `left` or `right` rail, horizontal for `top` or `bottom`. Separators are `<hr>` whose axis is _across_ the rail.

**`Navbar` is not a `role="menubar"`, and a flyout's title action is not a rail stop** — both rulings, not omissions
([`UI_SSR_COMPONENTS.md`][usc-1l] §1l). The rail carrying a scope means an app action fired inside it passes through a scope on its way up, which is
safe: action routing continues to the enclosing scope when the inner table lacks the action.

### Add a theme toggle that does not flash

In this order:

1. **Register the scopes** — the client entry side-effect-imports `@y-core/forge/ui/chrome/client` **before** `resume()`, or `Navbar` renders
   without runtime auth filtering and `ThemeToggle` does nothing on click.
2. **Stamp `FOUC_SCRIPT` into `<head>`** — `<script>{rawHtml(FOUC_SCRIPT)}</script>` — so the stored preference applies before first paint, and add
   its hash to the CSP `script-src`; it is inline and carries no nonce.
3. **Ship the theme CSS.** `ThemeToggle` renders its icons inside `theme-light-icon`, `theme-dark-icon` and `theme-system-icon` spans, and
   which is visible is decided by CSS keyed off the theme attribute in `src/ui/assets/css/forge-ui.css`. Those class names are a contract — rename
   one and the toggle renders all three glyphs at once. The same mechanism supplies the accessible name: each span carries an `sr-only` label, and
   `display: none` removes the other two from the accessible-name computation.

The attribute, the storage key, the `<html>` class and the server default are all exported beside `FOUC_SCRIPT`, so a page that must read or seed
the preference does so by name, never by literal. Why the pre-paint script is earned here and nowhere else is [`UI_CLIENT_RUNTIME.md`][ucr-2b] §2b.

---

## `@y-core/forge/ui/chrome/client`

**Browser-only, side-effect import.** esbuild entry points only.

### Register the theme and navbar scopes

Registration happens at module load; no DOM is touched until a scope resumes. It also **side-effect-imports `@y-core/forge/ui/core/client`**,
because chrome's markup names the `menu` and `toolbar` scopes and a component whose markup names a scope has to guarantee the scope exists. Import
it in the client entry **before** `resume()`, since the eager pass only hydrates scopes registered by then; registration is idempotent, so importing
both entries is harmless.

The theme toggle cycles `light → dark → system → light`.

### Read the resolved theme from your own code

```ts
import { isDark } from "@y-core/forge/ui/chrome/client";
import { effect } from "@y-core/forge/ui/client";

effect(() => renderer.setBackground(isDark.value ? "#111" : "#fff"));
```

`isDark` is a `ReadonlySignal<boolean>` and a **stable binding** — a fixed object whose `.value` getter delegates to whichever signal is currently
live — so it is safe to capture before `resume()` runs. It reads `false` until a theme scope resumes, and an effect that read it earlier re-runs
then.

**The preference belongs to the document, not to a toggle:** every `theme` scope in a document shares one preference signal, and the media listener
plus the two effects that paint `<html>` are installed once per document by whichever scope resumes first. A navbar toggle beside a settings one is
a supported composition. **`resume()` owns teardown** for every scope, so there is nothing for the caller to unmount and no handle to hold.

---

## See also

- [`UI_SSR_COMPONENTS.md`][usc] — the component contract, the signal-binding seam, the state-attribute contract.
- [`UI_CLASS_COMPOSITION.md`][ucc] — the class utilities, the conflict table, the recipe layer, the scheme declaration contract.
- [`UI_CLIENT_RUNTIME.md`][ucr] — mount controllers, the disposer contract, signals, lazy loading, resumable scopes.
- [`THEME_GENERATION.md`][tg] — the dial model, the emission contract, the contrast audit.
- [`UI_DESIGN_GUIDANCE.md`][udg] — the design corpus's rule tiers and identifiers.

[ap-2c]: ../../docs/ASSET_PIPELINE.md#2c-the-namespace-orchestrates-builders-and-is-not-one
[cr-1]: ../../warden/canon/shared/CODE_RULES.md#1-zero-global-state-rule
[floor]: ./design/floor.md#1f-hit-target-and-reduced-motion
[gate-presets]: ../tooling/gate/README.md#starting-from-a-preset
[htmx-7a]: ../../docs/HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[htmx-7b]: ../../docs/HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[navigation]: ./design/reference/08-navigation.md
[sa-1a]: ../../docs/STATE_ATTRIBUTES.md#1a-presence-not-value
[sh-2g]: ../../docs/SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[tg]: ../../docs/THEME_GENERATION.md
[tg-1d]: ../../docs/THEME_GENERATION.md#1d-shape-tokens-are-not-a-scheme
[tg-4]: ../../docs/THEME_GENERATION.md#4-a-status-hue-holds-its-fill
[ucc]: ../../docs/UI_CLASS_COMPOSITION.md
[ucc-1a]: ../../docs/UI_CLASS_COMPOSITION.md#1a-conflict-resolution-the-fail-open-boundary-and-the-memo
[ucc-1e]: ../../docs/UI_CLASS_COMPOSITION.md#1e-the-utility-recipe-layer
[ucc-2]: ../../docs/UI_CLASS_COMPOSITION.md#2-colour-scheme-declaration-contract
[ucc-2c]: ../../docs/UI_CLASS_COMPOSITION.md#2c-status-hues-are-forges-brand-fills-are-the-apps
[ucc-2d]: ../../docs/UI_CLASS_COMPOSITION.md#2d-the-dark-variant-is-class-driven-and-that-is-a-takeover
[ucc-2e]: ../../docs/UI_CLASS_COMPOSITION.md#2e-a-consumer-rule-loses-by-layer-not-by-selector
[ucc-2f]: ../../docs/UI_CLASS_COMPOSITION.md#2f-a-reserved-root-where-a-utility-root-carries-two-concerns
[ucr]: ../../docs/UI_CLIENT_RUNTIME.md
[ucr-2]: ../../docs/UI_CLIENT_RUNTIME.md#2-mount-controllers
[ucr-2a]: ../../docs/UI_CLIENT_RUNTIME.md#2a-state-only-islands-versus-contract-bearing-scopes
[ucr-2b]: ../../docs/UI_CLIENT_RUNTIME.md#2b-theme-controller-and-fouc-prevention
[ucr-2c]: ../../docs/UI_CLIENT_RUNTIME.md#2c-the-turnstile-scope--captcha-controller
[ucr-2d]: ../../docs/UI_CLIENT_RUNTIME.md#2d-the-disposer-contract
[ucr-2i]: ../../docs/UI_CLIENT_RUNTIME.md#2i-openpopoverat--coordinate-placement
[ucr-2m]: ../../docs/UI_CLIENT_RUNTIME.md#2m-announce--the-pages-one-voice
[ucr-3a]: ../../docs/UI_CLIENT_RUNTIME.md#3a-signals--reactive-state
[ucr-3b]: ../../docs/UI_CLIENT_RUNTIME.md#3b-lazy-loading
[ucr-3c]: ../../docs/UI_CLIENT_RUNTIME.md#3c-resumable-scopes
[ucr-4]: ../../docs/UI_CLIENT_RUNTIME.md#4-htmx-bundle-import
[ucr-4a]: ../../docs/UI_CLIENT_RUNTIME.md#4a-which-responses-swap-html-4xx-yes-5xx-no
[udg]: ../../docs/UI_DESIGN_GUIDANCE.md
[udg-2]: ../../docs/UI_DESIGN_GUIDANCE.md#2-rule-tiers--floor-and-defaults
[usc]: ../../docs/UI_SSR_COMPONENTS.md
[usc-1a]: ../../docs/UI_SSR_COMPONENTS.md#1a-dropped-and-unsanitized-pass-through-attributes
[usc-1c]: ../../docs/UI_SSR_COMPONENTS.md#1c-button-and-the-aschild-invariant
[usc-1h]: ../../docs/UI_SSR_COMPONENTS.md#1h-overlays-and-disclosures
[usc-1j]: ../../docs/UI_SSR_COMPONENTS.md#1j-derived-ids-must-be-id-tokens
[usc-1l]: ../../docs/UI_SSR_COMPONENTS.md#1l-chrome-navigation-announces-only-what-it-implements
[usc-1m]: ../../docs/UI_SSR_COMPONENTS.md#1m-the-prop-vocabulary
[usc-2a]: ../../docs/UI_SSR_COMPONENTS.md#2a-the-binding-ownership-boundary
[usc-2c]: ../../docs/UI_SSR_COMPONENTS.md#2c-uicontrols--bound-variants
[usc-2d]: ../../docs/UI_SSR_COMPONENTS.md#2d-scoped-components-require-the-client-scope-import
[validation-readme]: ../validation/README.md
