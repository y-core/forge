---
title: Navigation
description: "How a user knows where they are and how they get elsewhere — the navigation patterns forge's primitives support."
---

# Navigation

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules cited below are not.

Forge splits navigation into two configuration-driven chrome components and one in-page primitive, and the split is by _what the control does_, not
by where it sits.

| Given | Choose | Subpath |
| --- | --- | --- |
| Destinations — places the user can go | `Navbar` | `@y-core/forge/ui/chrome` |
| Verbs — actions on the object currently open | `Toolbar` | `@y-core/forge/ui/chrome` |
| Peer views of one object already loaded | `Tabs` | `@y-core/forge/ui/core` |

Note that `Toolbar` is exported by both `@y-core/forge/ui/chrome` (the configuration-driven rail) and `@y-core/forge/ui/core` (the `role="toolbar"`
primitive the rail is built from). The one-barrel rule in `06-forms.md` applies to the pair — `forge-ui-form-one-barrel`.

---

## 0. Quick Reference

- §1 `Navbar`: the destinations bar, built from a `NavDefinition` rather than from children
- §1a The definition and its item shapes: what each shape is for, and where a `NavGroup` may sit
- §1b One bar, built from a definition: one per application, two or three sections, destinations only
- §1c Menus, groups and megamenus: when a dropdown hides the list the reader came to survey
- §1d Placement and the collapsible rail: what `collapsible="always"` resolves `placement` to, and why
- §1e The rail's box in the layout: width and `shrink-0` on the scope root, and the height chain scrolling needs
- §1f The collapsed rail's width: 56px, the toggle's edge, and the narrow width as an override over a wide base
- §1g The collapsed panel below `md`: `collapsedAs="drawer"`, its dismissals, and the containing-block trap
- §1h Labelling destinations: name a destination for what the user wants, and carry visible text
- §1i Indicating the current location: the bar does not know the request, so the app renders the marker
- §2 `Dock`: three to five equal top-level destinations at phone width, and when it is a `Navbar` instead
- §3 `Toolbar`: verbs on the object currently open, grouped rather than separated item by item
- §4 `Pagination`, and when scrolling is not it: an addressable position, and the lists that need one
- §5 `Tabs`, and when it is a router in disguise: panels already on the page, never a URL
- §6 Theme: the published constants, the pre-paint script, and where the toggle lives

---

## 1. `Navbar`

### 1a. The definition and its item shapes

`Navbar` is built from a `NavDefinition`, not from JSX children: `NavDefinition` holds `sections`, and each `NavSection` holds `items`, typed
`NavSectionItem` — any `NavItem`, plus `NavGroup`.

| Shape | Use for |
| --- | --- |
| `NavLink` | A destination. Its `href` is a route-map **key**, resolved through `resolveHref` |
| `NavMenu` | A group of destinations behind one trigger |
| `NavSlot` | Anything that is not a destination — identity, a search box, a `ThemeToggle` |
| `NavMegaMenu` | A wide panel of `NavGroup` columns opened from one bar trigger — §1c says when it earns its place |
| `NavGroup` | A heading over destinations that stay **visible**. At section level, or as a `NavMegaMenu` column |

`filters` is a visibility convenience and never a permission: every filtered item's label and `href` still reach every viewer, so the route needs
its own guard. An empty list hides, since no token can match it.

`resolveHref` takes a route-map **key** and returns a URL, and nothing requires that URL to be a route: an in-page navigation resolves each key to a
fragment, which is what lets one `Navbar` serve as a table of contents for a single long page.

**`NavItem` does not widen to include `NavGroup`; only `NavSection.items` does.** The asymmetry is the point — a group nested inside a `NavMenu`
would be a group inside a `role="menu"` popup, and keeping it out of `NavItem` makes that a compile error rather than a case the renderer has to
degrade at runtime.

A group renders as a `<div role="group" aria-labelledby>` labelled by a `<p>` heading, never an `<h2>`, because `Navbar` cannot know which level it
is nested under (`forge-ui-heading-order`). Its children render as bar links, since visible destinations are the reason to reach for a group.

Never give the bar `role="menubar"`: forge ships no menubar controller, so the role would announce a keyboard interface that is not there.

### 1b. One bar, built from a definition

<!-- rule:forge-ui-nav-one-primary --> A second primary bar means the user must learn which one holds what before they can navigate at all. A
page-scoped table of contents is a different axis from the destinations bar rather than a rival to it. Anything narrower than a documented second
axis is a `NavSlot` in the first bar more often than it is a second bar.

<!-- rule:forge-ui-nav-config-driven --> The definition is what gives every item its `data-filter` marker, its generated menu ids, and its correct
first paint from `activeFilters`.

<!-- rule:forge-ui-nav-section-count --> Sibling sections spread across the bar, so two reads as ends and three as ends-plus-centre. A fourth has no
spatial meaning left to claim.

### 1c. Menus, groups and megamenus

<!-- rule:forge-ui-nav-menu-depth --> The renderer supports deeper nesting — on the desktop bar a submenu opens `side="inline-end"` beside its
parent panel, and in the collapsed panel it nests as an indented disclosure — but a destination three levels deep is a destination the user will not
find twice.

<!-- rule:forge-ui-nav-group-over-menu --> A dropdown is the wrong affordance for destinations the user is meant to survey: it costs a click to see
anything, and it hides the very list that tells them what this surface contains. `NavGroup` keeps the same heading and spends vertical space
instead. A horizontal bar with several groups under one label folds them into a `NavMegaMenu`, whose panel keeps every group scannable at once.

<!-- rule:forge-ui-nav-megamenu-when --> A megamenu is the widest thing a bar can open, and its value is the side-by-side survey. A second megamenu
on one bar is a second survey competing for the same panel space; one group under a trigger is a dropdown wearing a panel. The counts are the
affordance.

<!-- rule:forge-ui-nav-slot-not-link --> A `NavLink` announces a destination; an account menu and a `ThemeToggle` are not destinations.

### 1d. Placement and the collapsible rail

<!-- rule:forge-ui-nav-placement-top --> Of `NavPlacement`'s other values, `bottom` suits a mobile-first surface and `right` a rail on the trailing
edge.

<!-- rule:forge-ui-nav-rail-collapsible --> Under the default `"mobile"`, a side rail cannot be collapsed at all at the widths where it takes the
most room — and a rail is the placement where reclaiming that room matters most. How `collapsible` resolves `placement`, and how `defaultOpen`
behaves below `md`, is the props' TSDoc.

### 1e. The rail's box in the layout

<!-- rule:forge-ui-nav-rail-flex-item --> `Resumable` takes a `class` for exactly this: the scope root is the box the parent flex row lays out,
while `Navbar`'s own `class` lands on the `<details>` two boxes further in. A width set there only _looks_ right, because every box between happens
to size to its content — and a `shrink-0` set there guards an element the flex algorithm was never going to shrink, leaving the item that can shrink
unguarded.

<!-- rule:forge-ui-nav-rail-persists --> That needs a **definite height on the scope root's parent**, and the reason is a cascade rule rather than a
forge one: a percentage height resolves against the parent's height and computes to `auto` the moment one ancestor is `auto`, so a chain with a
single gap buys nothing. Forge supplies the two links above the `<details>` — the scope root and the `<nav>` landmark both take `h-full` in rail
mode — which leaves the consumer owning exactly one, the box the scope root is laid out in. A stretched flex item in a `flex` row is one.

### 1f. The collapsed rail's width

<!-- rule:forge-ui-nav-rail-collapsed-width --> 56px clears `forge-ui-hit-target` for the toggle, which is the only control a collapsed rail still
shows, and the toggle moves to the trailing edge once open, beside the panel it closes. **At `md` and above** the rail stays in the flow at both
widths — no floating, no absolute positioning, nothing escaping its column on overflow — so the content beside it reflows rather than being covered.
The documented override is below `md`, where `collapsedAs="drawer"` takes the panel out of the flow deliberately (`forge-ui-nav-drawer-when`); the
flex item then wants `max-md:w-auto`, so an open rail does not reserve a column for a panel that is not in it. State the narrow width as the
**override over a wide base** (`has-[…]:w-14` on a `w-64` item), never a narrow base widened when open: a browser without `:has()` then degrades to
the full column rather than pinning a strip that clips the open panel.

```tsx
import { Navbar } from "@y-core/forge/ui/chrome";
import { Resumable } from "@y-core/forge/ui/server";

// Wrong — the layout classes land on the `<details>`, not on the box the flex row lays out.
<Resumable name='app-rail'>
  <Navbar config={rail} resolveHref={routes.url} icon={AppIcon} collapsible='always' defaultOpen class='w-64 shrink-0' />
</Resumable>
```

Costs: the flex item has no width or `shrink-0` of its own, so the column sizes to its content, the collapsed width never applies, and the rail's
height chain starts at a box nobody stretched.

```tsx
// Right — width, shrink and the collapsed override on the flex item; the parent supplies the height.
import { Navbar } from "@y-core/forge/ui/chrome";
import { Resumable } from "@y-core/forge/ui/server";

<div class='flex min-h-dvh'>
  <Resumable name='app-rail' class='w-64 shrink-0 border-r border-border has-[[data-slot~=navbar]:not([open])]:w-14'>
    <Navbar config={rail} resolveHref={routes.url} icon={AppIcon} collapsible='always' defaultOpen />
  </Resumable>
  <main class='flex-1 min-w-0'>…</main>
</div>;
```

### 1g. The collapsed panel below `md`

<!-- rule:forge-ui-nav-drawer-when --> `collapsedAs` decides what the collapsed panel _does_, where `collapsible` decides _when_ it collapses.
`"inline"`, the default, expands the panel in the document flow, which pushes the page down by the panel's height. `"drawer"` takes it out of the
flow below `md`: a fixed panel sliding in from one edge, over a backdrop, leaving the content behind it exactly where it was.

A panel of a few links pushes the page down by less than a drawer's backdrop and slide are worth.

<!-- rule:forge-ui-nav-drawer-edge --> A rail takes no `drawerEdge`.

A drawer's glyphs and its ways out are Floor: `forge-ui-nav-drawer-glyphs` and `forge-ui-nav-drawer-dismiss`, in `floor.md`.

<!-- rule:forge-ui-nav-drawer-containing-block --> Only a fixed-position drawer is captured by a filtered or transformed ancestor.

```tsx
import { Navbar } from "@y-core/forge/ui/chrome";

// Wrong — the blurred header is the panel's containing block, so the drawer opens inside the header.
<header class='sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg'>
  <Navbar config={nav} resolveHref={hrefFor} icon={AppIcon} collapsedAs='drawer' />
</header>
```

Costs: the drawer's `inset-y-0` resolves against the header's own box, so the panel is one header tall and clipped, and no amount of `z-index`
recovers it — the trap is geometric, not paint order.

```tsx
import { Navbar } from "@y-core/forge/ui/chrome";

// Right — the blur on a sibling layer behind the content, leaving the header itself an ordinary box.
<header class='sticky top-0 z-50 border-b border-border'>
  <div class='absolute inset-0 -z-10 bg-background/80 backdrop-blur-lg' aria-hidden='true' />
  <Navbar config={nav} resolveHref={hrefFor} icon={AppIcon} collapsedAs='drawer' />
</header>
```

The slide itself depends on the closed `<details>`'s content being rendered, which forge secures with
`[data-slot~="navbar"]::details-content { content-visibility: visible }`. An engine without `::details-content` shows the panel without animating it
— it still overlays correctly, and it is the same dependency the desktop bar already has.

### 1h. Labelling destinations

<!-- rule:forge-ui-nav-user-labels --> A `NavLink` labelled "Invoices" beats one labelled "Billing service"; "Team" beats "Identity". The label is
the whole affordance, so it is where the naming work goes.

<!-- rule:forge-ui-nav-text-labels --> Icon-only bar items depend on recognition the user does not have on their first visit, and each one then
needs its own accessible name under `forge-ui-accessible-name` plus a target meeting `forge-ui-hit-target`.

### 1i. Indicating the current location

A `NavLink` item takes `current`, which sets `aria-current="page"` and `data-selected` on its link and gives a bar link its current-page cue. The
bar is rendered from configuration and does not know the request, so the app sets the flag from the route it is rendering.

```tsx
import type { NavDefinition } from "@y-core/forge/ui/chrome";

// Wrong — the bar renders, and nothing on the page says where you are.
const config: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Projects", href: "projects" },
        { label: "Team", href: "team" },
      ],
    },
  ],
};
```

Costs: on any page reached from a link rather than from the bar, the user has no anchor at all.

```tsx
// Right — the active destination flagged on the item the app already describes.
import type { NavDefinition } from "@y-core/forge/ui/chrome";

const config: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Projects", href: "projects", current: here === "projects" },
        { label: "Team", href: "team", current: here === "team" },
      ],
    },
  ],
};
```

<!-- rule:forge-ui-nav-current-location --> Colour alone does not qualify — `forge-ui-not-color-alone` — so pair it with weight or a rule.

An in-page navigation has no request to read either: the URL does not change as the reader scrolls, so the marker can only be a runtime one.
`mountScrollSpy` from `@y-core/forge/ui/client` watches the sections the fragment links point at and stamps `aria-current="location"` on the link
for the one being read. A bar-level link styles that state itself, shifting weight as well as colour, so the paired cue is already there and the app
adds nothing to get it.

Which `aria-current` value a link takes is Floor: `forge-ui-nav-current-in-page`, in `floor.md`.

---

## 2. `Dock`

<!-- rule:forge-ui-nav-dock-when --> A `Dock` is the phone-width primary navigation: a fixed bottom bar of three to five top-level destinations of
equal weight, each a glyph over a one-word label. It hides from the `hideAbove` breakpoint up — `md` by default, or `lg` — and the `Navbar` takes
over there, so the two are never visible at once; `hideAbove="never"` keeps it at every width.

## 3. `Toolbar`

The chrome `Toolbar` renders a rail from a `ToolbarDefinition`: `groups`, each a `ToolbarGroup` of `ToolbarItem`s, where an item is a
`ToolbarAction`, a `ToolbarPopover`, a `ToolbarSeparator` or a `ToolbarSlot`. A separator is emitted automatically between sibling groups.

<!-- rule:forge-ui-nav-toolbar-verbs --> A destination in a toolbar reads as an action and gets clicked by accident.

<!-- rule:forge-ui-nav-toolbar-groups --> Groups already separate; a separator between each item separates nothing.

<!-- rule:forge-ui-nav-toolbar-popover --> A rail of twelve equally-weighted glyphs has no hierarchy. `ToolbarPopover` takes `content` and an
optional `titleAction`, which is where the second-tier controls belong.

---

## 4. `Pagination`, and when scrolling is not it

<!-- rule:forge-ui-pagination-vs-scroll --> A paged list has an addressable position: the reader can bookmark page 4, come back to it, and reach the
footer. Infinite scroll gives up all three, and it gives them up on exactly the lists — search results, audit logs, order history — where returning
to a known row is the task.

`Carousel.Dots` is `Pagination` by anchor — each dot is an `href="#slide-id"` — so the same addressability argument applies: a slide the reader can
link to, and return to, is a slide worth paging; a strip with no stable slides is a feed and wants no dots.

## 5. `Tabs`, and when it is a router in disguise

<!-- rule:forge-ui-nav-tabs-loaded --> `Tabs` renders a tablist plus panels; an unselected `Tabs.Content` is `hidden="until-found"`, so the first
render is correct with no JavaScript and find-in-page reaches every panel — once `mountTabs` runs, a match selects its panel's tab.

| Given | Choose |
| --- | --- |
| Peer views of one object, all already rendered | `Tabs` |
| Views the user should be able to link to or bookmark | links, not `Tabs` |
| Views that each need a fetch | links, or `Tabs` with `activation="manual"` |
| Steps in an order the user must follow | neither — a sequence, not a tab set |

`activation="manual"` waits for Enter, Space or a click rather than selecting on focus.

<!-- rule:forge-ui-nav-tabs-not-router --> A tab set that changes the address bar is a router wearing a tablist's ARIA, and it breaks the back
button in a way the roles then misdescribe. Route-addressable views are navigation.

<!-- rule:forge-ui-nav-tabs-empty --> The empty-state rule in `07-states.md` — `forge-ui-state-hide-empty-controls` — covers the general case; this
is that case for `Tabs`.

**Without script, the cue follows the panel on screen and the announced selection does not.** Following another tab's fragment, or a
find-in-page match in a hidden panel, shows that panel, hides the selected one and takes the cue off the server's tab, so no tab looks selected.
`aria-selected` still names the server's tab to assistive technology until `mountTabs` runs, and no stylesheet can change it.

**Without script, a set reads only its own parts, by position: each `Tabs.Content` written directly inside `Tabs`, and each `Tabs.Tab` directly
inside `Tabs.List`.** So a nested set's reveal leaves the outer panel that holds it on screen, and following an outer tab leaves the inner set's
selected panel in place. A `Tabs.Content` you wrap in an element of your own switches once `mountTabs` runs, but without script a wrapped panel
that is revealed shows beside the selected one instead of replacing it.

---

## 6. Theme

`@y-core/forge/ui/chrome` publishes the theme contract as constants so that no consumer restates it:

| Constant | What it names |
| --- | --- |
| `THEME_STORAGE_KEY` | The `localStorage` key |
| `THEME_ATTR` | The `<html>` attribute recording the preference |
| `DARK_CLASS` | The class `<html>` carries when dark is active |
| `DEFAULT_THEME_PREF` | The server-side default, resolved client-side |
| `FOUC_SCRIPT` | The inline script that sets both before first paint |

<!-- rule:forge-ui-nav-fouc-script --> Without it, a user whose stored preference is dark gets one light frame on every navigation. That is a design
defect, not a build detail: it is visible and it is repeated.

Reading the constants rather than restating them is Floor: `forge-ui-nav-theme-constants`, in `floor.md`.

<!-- rule:forge-ui-nav-theme-toggle-placement --> One button cycling light → dark → system, whose accessible name tracks the active theme with no
JavaScript because each glyph carries its own `sr-only` label.

```tsx
import { Navbar, ThemeToggle } from "@y-core/forge/ui/chrome";
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<Navbar config={config} resolveHref={hrefFor} icon={AppIcon} slots={{ theme: <ThemeToggle icon={AppIcon} /> }} />;
```
