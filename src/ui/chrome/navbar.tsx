/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "../core/icon";
import { Menu } from "../core/menu";
import { slotToken } from "../core/utils/as-child";
import { asClass, cn } from "../core/utils/cn";
import { cva } from "../core/utils/cva";
import { Resumable } from "../server/resumable";

/** A leaf link. `href` is a route-map key resolved through {@link NavbarProps.resolveHref} — never used raw. @public */
export interface NavLink {
  /** Visible link text. */
  label: string;
  /** Route-map key (NOT a URL) — passed to `resolveHref` to produce the final `href`. */
  href: string;
  /** Auth tokens; the item shows only when one is in the active set. */
  filters?: string[];
}

/** A branch: a menu over child items (recurses for nested submenus). @public */
export interface NavMenu {
  /** Dropdown trigger text. */
  label: string;
  /** Child items rendered inside the dropdown. */
  items: NavItem[];
  /** Auth tokens; the menu shows only when one is in the active set. */
  filters?: string[];
}

/** A slot: an inline JSX node, OR a string key resolved from {@link NavbarProps.slots}. @public */
export interface NavSlot {
  /** Inline node to render, or a string key looked up in the `slots` map. */
  slot: JSXNode | string;
  /** Optional label rendered beside the slot content. */
  label?: string;
  /** Auth tokens; the slot shows only when one is in the active set. */
  filters?: string[];
}

/** One navbar entry — a link, a nested menu, or a slot. Discriminated by property presence. @public */
export type NavItem = NavLink | NavMenu | NavSlot;

/**
 * A heading over a list of *visible* child items — the shape a vertical rail needs, and the one a
 * {@link NavMenu} dropdown is the wrong affordance for. Legal at section level only.
 *
 * Two deliberate choices in how it renders:
 *
 * - The heading is a `<p>`, never an `<h2>`. `Navbar` cannot know what heading level it sits at, and
 *   picking one for its type size is the breach `forge-ui-heading-order` names. `role="group"` plus
 *   `aria-labelledby` gives the programmatic association without asserting a level.
 * - Children render at depth 0, so they are bar links rather than menu rows. A group's children are
 *   visible destinations — that is the whole point of reaching for a group over a menu.
 *
 * @public
 */
export interface NavGroup {
  /** Heading text rendered above the group's items. */
  heading: string;
  /** The group's items. Renders as visible bar links; nests no further. */
  group: NavItem[];
  /** Auth tokens; the group shows only when one is in the active set. */
  filters?: string[];
}

/** What a section may hold: any nav item, plus a group — which nests no further. @public */
export type NavSectionItem = NavItem | NavGroup;

/** A group of items; sibling sections spread across the bar via `justify-between`. @public */
export interface NavSection {
  /** The section's items. */
  items: NavSectionItem[];
}

/** The full navbar configuration the app feeds to {@link Navbar}. @public */
export interface NavDefinition {
  /** Top-level sections (typically 2 = ends, or 3 = ends + center). */
  sections: NavSection[];
}

/** Desktop edge the bar pins to; drives the responsive sticky class. @public */
export type NavPlacement = "top" | "bottom" | "left" | "right";

/** Which breakpoints the bar collapses behind its toggle at. @public */
export type NavCollapsible = "mobile" | "always";

/**
 * Props for {@link Navbar}. Extends `<nav>` attributes (id, class, aria, data-*) minus `children`,
 * since the tree is built from `config`, not JSX children.
 *
 * `aria-label` and `aria-labelledby` land on the landmark; every other attribute lands on the
 * `<details>` the bar is built from. See {@link Navbar} for why those are two different elements.
 */
export interface NavbarProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  /** Nested navbar configuration (`sections → items → items …`). */
  config: NavDefinition;
  /** Resolves a route-map key to a URL — REQUIRED, since `href` is always a key. */
  resolveHref: (key: string) => string;
  /** Fills string-keyed slots (e.g. `{ user_name: <span/>, signout: <button/> }`). */
  slots?: Record<string, JSXNode>;
  /** Initial auth tokens for correct first paint (e.g. `["user"]`). */
  activeFilters?: string[];
  /** Desktop edge to pin the bar to. Defaults per collapse mode: `"top"` for `collapsible="mobile"`,
   * `"left"` for `collapsible="always"` — a permanently collapsed full-width strip is nobody's
   * intent for the rail shape. */
  placement?: NavPlacement;
  /** Collapse behaviour. `"mobile"` (default) expands the bar at `md:` and hides the toggle there;
   * `"always"` keeps the toggle and the vertical panel at every breakpoint — the rail shape, whose
   * `placement` therefore defaults to `"left"` rather than `"top"`. */
  collapsible?: NavCollapsible;
  /** Renders the underlying `<details>` open on first paint. Attribute-only; there is no controller. */
  defaultOpen?: boolean;
  /** Bound icon — must supply `chevron-down`, `hamburger`, and `close`. Required. */
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
  /** Optional DOM id for the bar. Also namespaces the generated menu ids; supply a distinct
   * value when two bars share the same `placement`, otherwise `placement` disambiguates them.
   *
   * Without it, two same-placement bars both mint `navbar-menu-top-0`, and each trigger's
   * `commandfor` resolves to the first matching element in the document — so the second bar's
   * trigger toggles the first bar's popup. Inherited from the `<nav>` intrinsic either way;
   * declared here because the escape hatch is invisible to a consumer otherwise. */
  id?: string;
  /** Extra classes merged onto the root element. */
  class?: string;
}

/** Threaded through the recursive renderers so they can resolve hrefs/slots, seed filters, render
 * icons, and mint a unique id per menu popover (trigger↔content `commandfor` link). */
interface NavRenderCtx {
  resolveHref: (key: string) => string;
  slots?: Record<string, JSXNode> | undefined;
  activeFilters: string[];
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
  /** Namespace prefix for generated menu ids — the bar's `id` when given, else the placement it
   * actually renders at, so the fallback always names the edge the bar is pinned to. Two bars on a
   * page must not both mint `navbar-menu-top-0`, or their `commandfor` links would collide and a
   * trigger would toggle the wrong (first-in-document) popup. */
  idBase: string;
  seq: { n: number };
  /** Carried here rather than threaded as a second parameter, because every recursive renderer
   * would otherwise have to pass it through whether or not it reads it. */
  collapsible: NavCollapsible;
}

/**
 * One responsive sticky class string per placement, following the pattern
 * `sticky <mobile-edge> inset-y-0 md:<desktop-edge> md:inset-x-0`: a vertical mobile edge that is
 * cancelled and re-pinned to the horizontal desktop edge at `md:`.
 */
const placementVariants = cva({
  base: "group z-40 bg-background/95 backdrop-blur",
  variants: {
    placement: {
      top: "sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto",
      bottom: "sticky right-0 inset-y-0 md:inset-x-0 md:bottom-0 md:top-auto md:left-auto",
      left: "sticky top-0 inset-x-0 md:inset-y-0 md:left-0 md:right-auto md:bottom-auto",
      right: "sticky bottom-0 inset-x-0 md:inset-y-0 md:right-0 md:left-auto md:top-auto",
    },
  },
  defaultVariants: { placement: "top" },
});

/**
 * The `collapsible="always"` counterpart: a bar that never expands has no breakpoint to switch at,
 * so each placement is a single unconditional pin. The vertical edges cap at the viewport and scroll
 * their own overflow — a rail long enough to want one does not fit a screen.
 *
 * `max-h-dvh` and `overflow-y-auto` only bite once the `<details>` has a height to cap. A sticky box
 * travels within its containing block, and every box between the consumer's laid-out item and this
 * one has to carry a definite height for that to be more than a declaration — which is what
 * {@link RAIL_HEIGHT_CHAIN} supplies on the two boxes this component owns.
 *
 * A sibling object rather than a compound variant because `cva` here is a flat loop over `variants`
 * with no compound support; two objects selected by `collapsible` is what that leaves.
 */
const railPlacementVariants = cva({
  base: "group z-40 bg-background/95 backdrop-blur",
  variants: {
    placement: {
      top: "sticky top-0 inset-x-0",
      bottom: "sticky bottom-0 inset-x-0",
      left: "sticky top-0 left-0 max-h-dvh overflow-y-auto",
      right: "sticky top-0 right-0 max-h-dvh overflow-y-auto",
    },
  },
  // Rail mode's own `placement` default, restated. The two objects are mode-scoped — this one is
  // reached only when `collapsible === "always"`, where the default is `"left"`, while its sibling
  // is reached only in the expanding mode, where it is `"top"`. Neither can actually fire: the
  // component always resolves a placement and passes it explicitly. Restated anyway so a default
  // read here never contradicts the one the component applies.
  defaultVariants: { placement: "left" },
});

/**
 * What the two boxes between the consumer's layout and the `<details>` carry in rail mode.
 *
 * A percentage height resolves against the parent's height, and resolves to `auto` the moment one
 * ancestor is `auto` — so a single `h-full` anywhere in the chain buys nothing. The scope root and
 * the landmark both take it, which leaves the consumer owning exactly one link: giving the scope
 * root's parent a definite height (a stretched flex item does this by itself).
 *
 * Width needs no counterpart. Every box in the chain is `display: block`, so `width: auto` already
 * fills the parent.
 */
const RAIL_HEIGHT_CHAIN = "h-full";

/**
 * Summary (toggle) classes per collapse mode; `"always"` keeps the toggle at every breakpoint.
 *
 * The rail's toggle is `sticky` so it stays reachable while a long rail scrolls its own overflow,
 * and takes the panel's own background so the entries do not read through it. It sits at the start
 * while closed — where a 56px-wide collapsed rail still has room for it — and moves to the end once
 * open, beside the panel it closes. `group-open:` rather than an `open:` variant because the
 * `<summary>` is a *descendant* of the `.group` `<details>`, not the element carrying `open`.
 */
const SUMMARY_CLASS: Record<NavCollapsible, string> = {
  mobile: "md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
  always:
    "sticky top-0 flex items-center justify-start group-open:justify-end p-3 bg-background/95 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
};

/** Panel classes per collapse mode; `"always"` stays a disclosed vertical stack at every breakpoint. */
const PANEL_CLASS: Record<NavCollapsible, string> = {
  mobile: "hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2",
  always: "hidden group-open:flex flex-col gap-4 p-2",
};

/** Section classes per collapse mode; `"always"` never turns the row horizontal. */
const SECTION_CLASS: Record<NavCollapsible, string> = { mobile: "flex flex-col md:flex-row md:items-center gap-1", always: "flex flex-col gap-1" };

/**
 * Bar-level styling. Two constants rather than one because only one of the two consumers brings a
 * component base with it: `Menu.Trigger` already supplies the cursor, outline reset and focus ring,
 * so a bar *menu* would otherwise carry every one of them twice. A bar *link* is a plain `<a>` with
 * no base at all, so it states them itself.
 *
 * Nested rows need neither — inside a menu they are `Menu` parts, and the menu's own item styling
 * is the styling a menu row should have.
 *
 * A bar link also carries the current-page cue, keyed off whatever `aria-current` the app sets. It
 * shifts weight as well as colour, so the cue survives for a reader who cannot distinguish the two
 * hues; the `bg-accent`/`text-accent-foreground` pair is the same one hover already uses.
 */
const BAR_ITEM = "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground";
const BAR_LINK = `${BAR_ITEM} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold`;

/** Stamps `data-filter` (always) and an initial server-side `hidden` (when no active token matches). */
function filterAttrs(item: NavSectionItem, activeFilters: string[]): Record<string, unknown> {
  if (!item.filters?.length) return {};
  const visible = item.filters.some((f) => activeFilters.includes(f));
  const base: Record<string, unknown> = { "data-filter": item.filters.join(" ") };
  if (!visible) base.hidden = true;
  return base;
}

/** The chevron every menu trigger carries. Decorative, so it is hidden from assistive tech — the
 * trigger's `aria-haspopup` is what announces that the row opens something. */
function chevron(ctx: NavRenderCtx): JSXNode {
  return (
    <span aria-hidden='true' class='text-xs opacity-70'>
      <ctx.icon
        name='chevron-down'
        width={16}
        height={16}
        stroke='currentColor'
        stroke-width={1.5}
        stroke-linecap='round'
        stroke-linejoin='round'
      />
    </span>
  );
}

/**
 * Resolves a slot's content: a string key looks up `slots`, otherwise the node is used directly.
 *
 * Inside a menu the wrapper takes `role="none"`. A `role="menu"` may only contain menu items,
 * groups and separators, and an unroled `<span>` between them makes the whole menu's content model
 * illegal — `none` removes the span from the accessibility tree without removing its content.
 */
function renderSlot(item: NavSlot, depth: number, ctx: NavRenderCtx): JSXNode {
  const node = typeof item.slot === "string" ? ctx.slots?.[item.slot] : item.slot;
  const fattrs = filterAttrs(item, ctx.activeFilters);
  // No label and no filter marker → render the node inline with no wrapper.
  if (!item.label && !("data-filter" in fattrs)) return node ?? null;
  return (
    <span
      data-slot={slotToken("navbar-slot", fattrs["data-slot"])}
      {...(depth === 0 ? {} : { role: "none" })}
      class='inline-flex items-center gap-2'
      {...fattrs}>
      {item.label ? <span>{item.label}</span> : null}
      {node ?? null}
    </span>
  );
}

/**
 * Renders a single item, recursing into nested menus.
 *
 * `depth` is what decides which vocabulary an entry speaks. A depth-0 entry sits on the bar: its
 * menus are `Menu` roots and its links are plain bar links, because a bar link is not a menu item
 * and calling it one would announce a menubar this navbar deliberately does not claim to be. Below
 * that, every entry is inside a `role="menu"`, so it is a `Menu` part — a submenu trigger or a link
 * item — and nothing else is legal there.
 */
function renderItem(item: NavItem, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if ("slot" in item) return renderSlot(item, depth, ctx);

  if ("items" in item) {
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    const children = item.items.map((child) => renderItem(child, depth + 1, ctx));

    // A nested submenu emits its trigger and popup as siblings of the rows around them, with no
    // wrapper: a wrapping element inside a `role="menu"` would break the same content model
    // `role="none"` protects the slot from breaking.
    if (depth > 0) {
      return [
        <Menu.SubmenuTrigger id={id} {...fattrs}>
          <span>{item.label}</span>
          {chevron(ctx)}
        </Menu.SubmenuTrigger>,
        // `side='inline-end'` rather than the `bottom` default: a submenu opens *beside* the panel
        // that contains it, and on the default it would open below the whole parent panel. The
        // logical spelling rather than `right` because the panel's own edge is what "beside" means —
        // in an RTL subtree that is its left, and the keyboard already mirrors to match.
        <Menu.Popup id={id} side='inline-end'>
          {children}
        </Menu.Popup>,
      ];
    }

    return (
      <Menu {...fattrs}>
        <Menu.Trigger id={id} class={BAR_ITEM}>
          <span>{item.label}</span>
          {chevron(ctx)}
        </Menu.Trigger>
        <Menu.Popup id={id}>{children}</Menu.Popup>
      </Menu>
    );
  }

  const href = ctx.resolveHref(item.href);
  if (depth > 0) {
    return (
      <Menu.LinkItem href={href} {...fattrs}>
        {item.label}
      </Menu.LinkItem>
    );
  }

  return (
    <a href={href} data-slot={slotToken("navbar-link", fattrs["data-slot"])} class={BAR_LINK} {...fattrs}>
      {item.label}
    </a>
  );
}

/**
 * A labelled block of visible destinations. The heading is a `<p>` carrying the label through
 * `role="group"` + `aria-labelledby`, because the bar has no way to know which heading level it
 * would be nesting under. Children render at depth 0 — they are bar links, not menu rows.
 */
function renderGroup(item: NavGroup, ctx: NavRenderCtx): JSXNode {
  // Shares the menu counter rather than keeping its own, so a group and a menu in one bar can never
  // mint the same suffix. The visible cost is that menu ids in a bar containing groups are no longer
  // contiguous — harmless, but it will surprise whoever reads a pinned string.
  const headingId = `navbar-group-${ctx.idBase}-${ctx.seq.n++}`;
  const fattrs = filterAttrs(item, ctx.activeFilters);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the semantic element for `role="group"` is `<fieldset>`, which carries form-control grouping and a `<legend>` contract this navigation block has no business claiming
    <div
      data-slot={slotToken("navbar-group", fattrs["data-slot"])}
      role='group'
      aria-labelledby={headingId}
      class='flex flex-col gap-1'
      {...fattrs}>
      <p id={headingId} data-slot='navbar-group-heading' class='px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {item.heading}
      </p>
      {item.group.map((child) => renderItem(child, 0, ctx))}
    </div>
  );
}

/** A section is a flex group of items; siblings are spread by the container's `justify-between`. */
function renderSection(section: NavSection, ctx: NavRenderCtx): JSXNode {
  return (
    <div data-slot='navbar-section' class={SECTION_CLASS[ctx.collapsible]}>
      {section.items.map((item) => ("group" in item ? renderGroup(item, ctx) : renderItem(item, 0, ctx)))}
    </div>
  );
}

/**
 * A configuration-driven, responsive navbar. The app feeds a nested {@link NavDefinition}
 * (`sections → items → items …`); on desktop it renders a horizontal bar of `core/Menu` dropdowns
 * with nested submenus — the native Popover API for top-layer stacking, light-dismiss and Escape,
 * plus forge's menu keyboard layer for arrow navigation, typeahead and focus restoration — and on
 * mobile it collapses to a hamburger-toggled `<details>`. A small resumable scope (`navbar`) adds
 * runtime auth filtering.
 *
 * `collapsible="always"` keeps the toggle and the vertical panel at every breakpoint, which is the
 * rail shape — a `<details>` that never expands on its own, pinned to a vertical edge and, usually,
 * `defaultOpen`. `placement` follows the collapse mode when it is not given: `"top"` for the
 * expanding bar, `"left"` for the rail, since a permanently collapsed full-width strip is not a
 * shape anyone asks for on purpose.
 *
 * A vertical rail caps at the viewport and scrolls its own overflow, which needs a height to cap at:
 * the scope root and the landmark both take `h-full` in rail mode, so the only unmet link left is
 * the parent the consumer lays the scope root out in. Give it a definite height — a stretched flex
 * item in a `flex` row is one — and the pin holds; leave it `auto` and the whole chain resolves to
 * `auto` and the rail scrolls with the page instead.
 *
 * Three nested elements, each with one job. The outermost is the resumable scope's `<div>`, which
 * owns runtime auth filtering and has to contain everything it filters. Inside it sits a real
 * `<nav>` — the navigation landmark, so a screen reader user can jump to the bar the way they jump
 * to any other region; it carries `aria-label`/`aria-labelledby` and, in rail mode, its link of the
 * height chain, because a landmark with no name is one of several indistinguishable ones and a
 * height that stops at the landmark is a rail that cannot scroll. Innermost is the `<details>`,
 * which is the collapse mechanism and carries the placement classes, the `id` and every other
 * forwarded attribute. A `<nav>` rather than `role="navigation"` on the `<details>`: the native
 * element needs no role to be believed, and the `<details>` is a disclosure, which is a different
 * thing from a landmark and should not be named as one.
 *
 * The bar itself is **not** a `role="menubar"`. A menubar owes its triggers a roving tab stop of
 * their own, and forge has no menubar controller; claiming the role without the behaviour announces
 * a keyboard interface that is not there, which is worse than announcing nothing.
 *
 * Every `href` is a route-map key resolved via the required `resolveHref`. Items may carry `filters`
 * (auth tokens): an item shows only when one of its tokens is in the active set, seeded server-side
 * from `activeFilters` for a flash-free first paint and updated at runtime by dispatching
 * `new CustomEvent("navbar:filters", { detail: tokens })` on `document`.
 *
 * The required `icon` prop must supply `chevron-down`, `hamburger`, and `close` from the app sprite.
 *
 * @public
 */
export const Navbar: FC<NavbarProps> = ({
  config,
  resolveHref,
  slots,
  activeFilters = [],
  placement,
  collapsible = "mobile",
  defaultOpen = false,
  icon: Icon,
  class: cls,
  id,
  "data-slot": inherited,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...rest
}) => {
  const resolvedPlacement = placement ?? (collapsible === "always" ? "left" : "top");
  const ctx: NavRenderCtx = { resolveHref, slots, activeFilters, icon: Icon, idBase: id ?? resolvedPlacement, seq: { n: 0 }, collapsible };
  const variants = collapsible === "always" ? railPlacementVariants : placementVariants;
  // Rail-scoped: the expanding bar has nothing to cap, and an unconditional class would change every
  // existing `collapsible="mobile"` consumer's markup for a property that mode does not use.
  const heightLink: { class?: string } = collapsible === "always" ? { class: RAIL_HEIGHT_CHAIN } : {};
  return (
    <Resumable name='navbar' state={{ filters: activeFilters }} {...heightLink}>
      <nav
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
        {...(ariaLabelledby === undefined ? {} : { "aria-labelledby": ariaLabelledby })}
        {...heightLink}>
        <details
          data-slot={slotToken("navbar", inherited)}
          class={cn(variants({ placement: resolvedPlacement }), asClass(cls))}
          {...(id === undefined ? {} : { id })}
          {...(defaultOpen ? { open: true } : {})}
          {...rest}>
          <summary data-slot='navbar-toggle' aria-label='Menu' class={SUMMARY_CLASS[collapsible]}>
            <span class='group-open:hidden' aria-hidden='true'>
              <Icon name='hamburger' width={22} height={22} />
            </span>
            <span class='hidden group-open:inline' aria-hidden='true'>
              <Icon name='close' width={22} height={22} />
            </span>
          </summary>
          <div class={PANEL_CLASS[collapsible]}>{config.sections.map((section) => renderSection(section, ctx))}</div>
        </details>
      </nav>
    </Resumable>
  );
};
