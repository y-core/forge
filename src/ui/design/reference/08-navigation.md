---
title: Navigation
description: "How a user knows where they are and how they get elsewhere — the navigation patterns forge's primitives support."
---

# Navigation

Everything here is a **Default** — rebuttable only by an explicit written brief. The Floor rules
cited below are not.

Forge splits navigation into two configuration-driven chrome components and one in-page primitive,
and the split is by _what the control does_, not by where it sits.

| Given | Choose | Subpath |
| --- | --- | --- |
| Destinations — places the user can go | `Navbar` | `@y-core/forge/ui/chrome` |
| Verbs — actions on the object currently open | `Toolbar` | `@y-core/forge/ui/chrome` |
| Peer views of one object already loaded | `Tabs` | `@y-core/forge/ui/core` |

Note that `Toolbar` is exported by both `@y-core/forge/ui/chrome` (the configuration-driven rail) and
`@y-core/forge/ui/core` (the `role="toolbar"` primitive the rail is built from). The one-barrel rule
in `06-forms.md` applies to the pair — `forge-ui-form-one-barrel`.

---

## 0. Quick Reference

- §1 `Navbar`: the destinations bar, built from a `NavDefinition` rather than from children
- §1a The definition and its four item shapes: `NavLink`, `NavMenu`, `NavSlot`, `NavGroup`, and the roles they carry
- §1b One bar, built from a definition: one per application, two or three sections, destinations only
- §1c Menus, groups and megamenus: when a dropdown hides the list the reader came to survey
- §1d Placement and the collapsible rail: what `collapsible="always"` resolves `placement` to, and why
- §1e The rail's box in the layout: width and `shrink-0` on the scope root, and the height chain scrolling needs
- §1f The collapsed rail's width: 56px, the toggle's edge, and the narrow width as an override over a wide base
- §1g The collapsed panel below `md`: `collapsedAs="drawer"`, its four dismissals, and the containing-block trap
- §1h Labelling destinations: name a destination for what the user wants, and carry visible text
- §1i Indicating the current location: the bar does not know the request, so the app renders the marker
- §2 `Dock`: three to five equal top-level destinations at phone width, and when it is a `Navbar` instead
- §3 `Toolbar`: verbs on the object currently open, grouped rather than separated item by item
- §4 `Pagination`, and when scrolling is not it: an addressable position, and the lists that need one
- §5 `Tabs`, and when it is a router in disguise: panels already on the page, never a URL
- §6 Theme: the published constants, the pre-paint script, and where the toggle lives

---

## 1. `Navbar`

### 1a. The definition and its four item shapes

`Navbar` is built from a `NavDefinition`, not from JSX children: `NavDefinition` holds `sections`,
and each `NavSection` holds `items`, typed `NavSectionItem` — any `NavItem`, plus `NavGroup`.

| Shape | Fields | Use for |
| --- | --- | --- |
| `NavLink` | `label`, `href`, `filters?` | A destination. `href` is a route-map **key**, resolved through `resolveHref` |
| `NavMenu` | `label`, `items`, `filters?` | A group of destinations behind one trigger |
| `NavSlot` | `slot`, `label?`, `filters?` | Anything that is not a destination — identity, a search box, a `ThemeToggle` |
| `NavGroup` | `heading`, `group`, `filters?` | A heading over destinations that stay **visible**. Section level only |

`resolveHref` takes a route-map **key** and returns a URL, and nothing requires that URL to be a
route: an in-page navigation resolves each key to a fragment, which is what lets one `Navbar` serve
as a table of contents for a single long page.

**`NavItem` does not widen to include `NavGroup`; only `NavSection.items` does.** The asymmetry is
the point — a group nested inside a `NavMenu` would be a group inside a `role="menu"` popup, and
keeping it out of `NavItem` makes that a compile error rather than a case the renderer has to
degrade at runtime.

A group's heading renders as a `<p>` carrying `role="group"` and `aria-labelledby`, never as an
`<h2>`. `Navbar` has no way to know which heading level it is nested under, and picking one for its
type size is exactly what `forge-ui-heading-order` forbids; the ARIA pairing gives the programmatic
association without asserting a level. Its children render as bar links rather than menu rows,
because visible destinations are the whole reason to reach for a group.

The bar is **not** a `role="menubar"`, and must not be given the role. A menubar owes its triggers a
roving tab stop of their own, and forge ships no menubar controller; claiming the role without the
behaviour announces a keyboard interface that is not there.

### 1b. One bar, built from a definition

**Default: one `Navbar` per application, and it holds destinations only.**
<!-- rule:forge-ui-nav-one-primary -->

Two primary bars means the user must learn which one holds what before they can navigate at all.
Override for a documented second axis — a persistent product switcher above a section nav, or a
page-scoped table of contents over the sections of the page currently open, which is a different
axis from the destinations bar rather than a rival to it. Anything narrower than a documented second
axis is a `NavSlot` in the first bar more often than it is a second bar.

**Default: build the bar from a `NavDefinition` rather than hand-writing links into a `<nav>`.**
<!-- rule:forge-ui-nav-config-driven -->

The definition is what gives every item its `data-filter` marker, its generated menu ids, and its
correct first paint from `activeFilters`. Override never for the bar itself; a page-level sub-nav
that is genuinely not the primary bar is ordinary markup.

**Default: two or three `NavSection`s.** <!-- rule:forge-ui-nav-section-count -->
Sibling sections spread across the bar, so two reads as ends and three as ends-plus-centre. A fourth
has no spatial meaning left to claim. Override under a brief for a dense application bar with a
declared zone model.

### 1c. Menus, groups and megamenus

**Default: `NavMenu` nests one level.** <!-- rule:forge-ui-nav-menu-depth -->
The renderer supports deeper nesting — a submenu opens `side="inline-end"` beside its parent panel —
but a destination three panels deep is a destination the user will not find twice. Override for a
reference-style application whose navigation is genuinely a tree.

**Default: when the destinations under a heading should be scannable, reach for `NavGroup`, not
`NavMenu`.** <!-- rule:forge-ui-nav-group-over-menu -->
A dropdown is the wrong affordance for destinations the user is meant to survey: it costs a click to
see anything, and it hides the very list that tells them what this surface contains. `NavGroup` keeps
the same heading and spends vertical space instead. Override when the bar is horizontal and short on
room — which is where a `NavMenu` earns its click — or when the group is long enough that showing it
would push the rest of the bar off screen. A horizontal bar with several groups under one label
folds them into a `NavMegaMenu`, whose panel keeps every group scannable at once.

**Default: grouped children earn a megamenu only when a section has three or more groups the reader
scans side by side; one group is a `NavMenu`, and a bar holds at most one megamenu.**
<!-- rule:forge-ui-nav-megamenu-when -->

A megamenu is the widest thing a bar can open, and its value is the side-by-side survey. Two
megamenus on one bar are two surveys competing for the same panel space; one group under a trigger
is a dropdown wearing a panel. Override never — the counts are the affordance.

**Default: identity, theme and search go in a `NavSlot`, never a `NavLink`.**
<!-- rule:forge-ui-nav-slot-not-link -->

A `NavLink` announces a destination; an account menu and a `ThemeToggle` are not destinations.
Override never.

### 1d. Placement and the collapsible rail

**Default: leave `placement` unset and let the collapse mode pick it — `"top"` for the ordinary bar.**
<!-- rule:forge-ui-nav-placement-top -->

`NavPlacement` also offers `bottom`, `left` and `right`. A left rail is the standing override for an
application with more than roughly seven primary destinations — and the shape `collapsible="always"`
already resolves to, so it needs no `placement` of its own. `bottom` suits a mobile-first surface,
and `right` a rail on the trailing edge; each of those is an override, taken deliberately.

**Default: a `collapsible="always"` bar is a left rail, and needs no `placement` to say so.**
<!-- rule:forge-ui-nav-rail-collapsible -->

`collapsible` decides which breakpoints the bar hides behind its toggle: `"mobile"`, the default,
expands the bar and hides the toggle from `md:` up, so a side rail under it cannot be collapsed at
all at the widths where it takes the most room — and a rail is the placement where reclaiming that
room matters most. `"always"` keeps the toggle and the vertical panel at every breakpoint, which is
the rail shape, so `placement` resolves to `"left"` under it rather than to the top strip a
never-expanding full-width bar would otherwise be. Pair it with `defaultOpen` when the rail should
start expanded; there is no controller behind that prop, so the state it renders is the state the
user sees. Override with `placement="right"` for a trailing-edge rail, or with an explicit horizontal
placement for the rare bar that stays collapsed at every width.

### 1e. The rail's box in the layout

**Default: the rail's width and `shrink-0` go on the flex item, which is the `Resumable` scope
root.** <!-- rule:forge-ui-nav-rail-flex-item -->
`Resumable` takes a `class` for exactly this: the scope root is the box the parent flex row lays out,
while `Navbar`'s own `class` lands on the `<details>` two boxes further in. A width set there only
_looks_ right, because every box between happens to size to its content — and a `shrink-0` set there
guards an element the flex algorithm was never going to shrink, leaving the item that can shrink
unguarded. Override when the rail's parent is not a flex row: a grid parent sizes the track, and the
width belongs to the track definition rather than to either box.

**Default: a vertical rail stays pinned to the viewport and scrolls its own overflow.**
<!-- rule:forge-ui-nav-rail-persists -->

That needs a **definite height on the scope root's parent**, and the reason is a cascade rule rather
than a forge one: a percentage height resolves against the parent's height and computes to `auto` the
moment one ancestor is `auto`, so a chain with a single gap buys nothing. Forge supplies the two
links above the `<details>` — the scope root and the `<nav>` landmark both take `h-full` in rail mode
— which leaves the consumer owning exactly one, the box the scope root is laid out in. A stretched
flex item in a `flex` row is one. Override for a short rail on a short page, where scrolling away
with the content costs the reader nothing.

### 1f. The collapsed rail's width

**Default: collapsed, the rail is one button wide — `w-14`, 56px — with the toggle at the leading
edge; open, it is 16rem with the toggle trailing.**
<!-- rule:forge-ui-nav-rail-collapsed-width -->

56px clears `forge-ui-hit-target` for the toggle, which is the only control a collapsed rail still
shows, and the toggle moves to the trailing edge once open, beside the panel it closes. **At `md`
and above** the rail stays in the flow at both widths — no floating, no absolute positioning,
nothing escaping its column on overflow — so the content beside it reflows rather than being
covered. The documented override is below `md`, where `collapsedAs="drawer"` takes the panel out of
the flow deliberately (`forge-ui-nav-drawer-when`); the flex item then wants `max-md:w-auto`, so an
open rail does not reserve a column for a panel that is not in it. State the narrow width as
the **override over a wide base** (`has-[…]:w-14` on a `w-64` item), never a narrow base widened when
open: a browser without `:has()` then degrades to the full column rather than pinning a strip that
clips the open panel. Override under a brief for a collapsed state that shows glyphs with labels,
which needs more than one button of width.

```tsx
// Wrong — the layout classes land on the `<details>`, not on the box the flex row lays out.
<Resumable name='app-rail'>
  <Navbar config={rail} resolveHref={routes.url} icon={AppIcon} collapsible='always' defaultOpen class='w-64 shrink-0' />
</Resumable>
```

Costs: the flex item has no width and no `shrink-0` of its own, so the column sizes to its content
and shrinks under pressure; the collapsed width never applies to the element that is actually in the
row, and the height chain the rail's own scrolling depends on starts at a box nobody stretched.

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

`collapsedAs` decides what the collapsed panel _does_, where `collapsible` decides _when_ it
collapses. `"inline"`, the default, expands the panel in the document flow, which pushes the page
down by the panel's height. `"drawer"` takes it out of the flow below `md`: a fixed panel sliding in
from one edge, over a backdrop, leaving the content behind it exactly where it was.

**Default: a bar whose panel would displace the page on a phone takes `collapsedAs="drawer"`.**
<!-- rule:forge-ui-nav-drawer-when -->

**Default: the edge is derived from `placement`, never configured.**
<!-- rule:forge-ui-nav-drawer-edge -->

**Default: a rail that opens off-canvas draws `panel-open`/`panel-close`; a top bar keeps its hamburger.**
<!-- rule:forge-ui-nav-drawer-glyphs -->

**Default: a drawer is dismissable four ways — the toggle, the backdrop, Escape, and a link inside it.**
<!-- rule:forge-ui-nav-drawer-dismiss -->

**Default: no ancestor of the bar carries `backdrop-filter`, `filter` or `transform`.**
<!-- rule:forge-ui-nav-drawer-containing-block -->

```tsx
// Wrong — the blurred header is the panel's containing block, so the drawer opens inside the header.
<header class='sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg'>
  <Navbar config={nav} resolveHref={hrefFor} icon={AppIcon} collapsedAs='drawer' />
</header>
```

Costs: the drawer's `inset-y-0` resolves against the header's own box, so the panel is one header
tall and clipped, and no amount of `z-index` recovers it — the trap is geometric, not paint order.

```tsx
// Right — the blur on a sibling layer behind the content, leaving the header itself an ordinary box.
<header class='sticky top-0 z-50 border-b border-border'>
  <div class='absolute inset-0 -z-10 bg-background/80 backdrop-blur-lg' aria-hidden='true' />
  <Navbar config={nav} resolveHref={hrefFor} icon={AppIcon} collapsedAs='drawer' />
</header>
```

The slide itself depends on the closed `<details>`'s content being rendered, which forge secures with
`[data-slot~="navbar"]::details-content { content-visibility: visible }`. An engine without
`::details-content` shows the panel without animating it — it still overlays correctly, and it is the
same dependency the desktop bar already has.

### 1h. Labelling destinations

**Default: name a destination for what the user wants there, not for the system that serves it.**
<!-- rule:forge-ui-nav-user-labels -->

A `NavLink` labelled "Invoices" beats one labelled "Billing service"; "Team" beats "Identity". The
label is the whole affordance, so it is where the naming work goes. Override when the system's own
term _is_ the user's term — a developer console, where "Workers" is what the user came for.

**Default: every `NavLink` carries visible text.** <!-- rule:forge-ui-nav-text-labels -->
Icon-only bar items depend on recognition the user does not have on their first visit, and each one
then needs its own accessible name under `forge-ui-accessible-name` plus a target meeting
`forge-ui-hit-target`. Override for a `Toolbar` rail, whose items are icon-only by design and carry
`label` for exactly that reason.

### 1i. Indicating the current location

`NavLink` has no current-page flag: the bar is rendered from configuration and does not know the
request. Render the indicator yourself, through the shape that exists for content the definition
cannot express.

```tsx
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

Costs: on any page reached from a link rather than from the bar, the user has no anchor at all —
which is most page loads.

```tsx
// Right — the active destination rendered as a slot the app controls.
import type { NavDefinition } from "@y-core/forge/ui/chrome";

const config: NavDefinition = {
  sections: [
    {
      items: [
        {
          slot: (
            <a href={hrefFor("projects")} aria-current={here === "projects" ? "page" : undefined}>
              Projects
            </a>
          ),
        },
        {
          slot: (
            <a href={hrefFor("team")} aria-current={here === "team" ? "page" : undefined}>
              Team
            </a>
          ),
        },
      ],
    },
  ],
};
```

**Default: the current destination is indicated on every page, by `aria-current` plus a visible
cue.** <!-- rule:forge-ui-nav-current-location -->
Colour alone does not qualify — `forge-ui-not-color-alone` — so pair it with weight or a rule.
Override when the surface has exactly one destination.

An in-page navigation has no request to read either: the URL does not change as the reader scrolls,
so the marker can only be a runtime one. `mountScrollSpy` from `@y-core/forge/ui/client` watches the
sections the fragment links point at and stamps `aria-current="location"` on the link for the one
being read. A bar-level link styles that state itself, shifting weight as well as colour, so the
paired cue is already there and the app adds nothing to get it.

---

## 2. `Dock`

A `Dock` is the phone-width primary navigation: a fixed bottom bar of three to five top-level
destinations of equal weight, each a glyph over a one-word label. It hides at `md:` and the `Navbar`
takes over, so the two are never visible at once.

Default: reach for `Dock` only when every destination is a top-level one and there are at most five;
a sixth belongs behind the `Navbar`'s menu, and a bar that must also hold a user slot or a search box
is a bottom-placed `Navbar`. <!-- rule:forge-ui-nav-dock-when -->

## 3. `Toolbar`

The chrome `Toolbar` renders a rail from a `ToolbarDefinition`: `groups`, each a `ToolbarGroup` of
`ToolbarItem`s, where an item is a `ToolbarAction`, a `ToolbarPopover`, a `ToolbarSeparator` or a
`ToolbarSlot`. A separator is emitted automatically between sibling groups.

**Default: `Toolbar` holds verbs that act on the object currently open; `Navbar` holds destinations.**
<!-- rule:forge-ui-nav-toolbar-verbs -->

Override never — a destination in a toolbar reads as an action and gets clicked by accident.

**Default: express grouping with `ToolbarGroup`, not with an explicit `ToolbarSeparator` between
every item.** <!-- rule:forge-ui-nav-toolbar-groups -->
Groups already separate; a separator between each item separates nothing. Override when a single
group needs one internal break, which is what the explicit shape is for.

**Default: an infrequent or multi-part action is a `ToolbarPopover`, not another `ToolbarAction`.**
<!-- rule:forge-ui-nav-toolbar-popover -->

A rail of twelve equally-weighted glyphs has no hierarchy. `ToolbarPopover` takes `content` and an
optional `titleAction`, which is where the second-tier controls belong. Override for a rail whose
every item is a peer tool — a drawing palette.

---

## 4. `Pagination`, and when scrolling is not it

A paged list has an addressable position: the reader can bookmark page 4, come back to it, and reach
the footer. Infinite scroll gives up all three, and it gives them up on exactly the lists — search
results, audit logs, order history — where returning to a known row is the task.

Default: page a long list with `Pagination`, never with infinite scroll, unless the list is a feed
with no stable ordering, where there is no position to return
to. <!-- rule:forge-ui-pagination-vs-scroll -->

`Carousel.Dots` is `Pagination` by anchor — each dot is an `href="#slide-id"` — so the same
addressability argument applies: a slide the reader can link to, and return to, is a slide worth
paging; a strip with no stable slides is a feed and wants no dots.

## 5. `Tabs`, and when it is a router in disguise

`Tabs` renders a tablist plus panels; an unselected `Tabs.Content` is `hidden`, so the first render is
correct with no JavaScript.

| Given | Choose |
| --- | --- |
| Peer views of one object, all already rendered | `Tabs` |
| Views the user should be able to link to or bookmark | links, not `Tabs` |
| Views that each need a fetch | links, or `Tabs` with `activation="manual"` |
| Steps in an order the user must follow | neither — a sequence, not a tab set |

**Default: `Tabs` only when every panel's content is already on the page.**
<!-- rule:forge-ui-nav-tabs-loaded -->

Override with `activation="manual"`, which waits for Enter, Space or a click rather than selecting on
focus, when a panel is expensive enough that arrow-key traversal would fire several loads.

**Default: a view with its own URL is a link, not a tab.** <!-- rule:forge-ui-nav-tabs-not-router -->
A tab set that changes the address bar is a router wearing a tablist's ARIA, and it breaks the back
button in a way the roles then misdescribe. Override never — route-addressable views are navigation.

**Default: hide a `Tabs` whose panels are all empty.** <!-- rule:forge-ui-nav-tabs-empty -->
The empty-state rule in `07-states.md` — `forge-ui-state-hide-empty-controls` — covers the general
case; this is the one that shows up most.

---

## 6. Theme

`@y-core/forge/ui/chrome` publishes the theme contract as constants so that no consumer restates it:

| Constant | Value | What it names |
| --- | --- | --- |
| `THEME_STORAGE_KEY` | `"themePreference"` | The `localStorage` key |
| `THEME_ATTR` | `"data-theme-preference"` | The `<html>` attribute recording the preference |
| `DARK_CLASS` | `"dark"` | The class `<html>` carries when dark is active |
| `DEFAULT_PREF` | `"system"` | The server-side default, resolved client-side |
| `FOUC_SCRIPT` | inline script | Sets both before first paint |

**Default: embed `FOUC_SCRIPT` in a nonce'd `<script>` in the `<head>`.**
<!-- rule:forge-ui-nav-fouc-script -->

Without it, a user whose stored preference is dark gets one light frame on every navigation. That is
a design defect, not a build detail: it is visible, it is repeated, and no amount of correct token
usage hides it. Override never.

**Default: read the theme constants rather than restating their string values.**
<!-- rule:forge-ui-nav-theme-constants -->

A hand-written `"dark"` in an app's own `@custom-variant` is a second writer of `DARK_CLASS` in a
repository forge's gate cannot see. Override never.

**Default: `ThemeToggle` lives in the chrome, as a `NavSlot`, not on a settings page.**
<!-- rule:forge-ui-nav-theme-toggle-placement -->

One button cycling light → dark → system, whose accessible name tracks the active theme with no
JavaScript because each glyph carries its own `sr-only` label. Override when the app already has a
preferences surface the user visits, in which case the toggle may appear in both.

```tsx
import { Navbar, ThemeToggle } from "@y-core/forge/ui/chrome";
import { createIcon } from "@y-core/forge/ui/core";

const AppIcon = createIcon("/assets/icons.svg");

<Navbar config={config} resolveHref={hrefFor} icon={AppIcon} slots={{ theme: <ThemeToggle icon={AppIcon} /> }} />;
```
