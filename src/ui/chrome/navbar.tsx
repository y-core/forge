/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { NAVBAR_DRAWER_ATTR } from "../contracts/navbar-contract";
import type { ForgeIcon } from "../core/icon";
import { Menu } from "../core/menu";
import { slotToken } from "../core/utils/as-child";
import { asClass, cn } from "../core/utils/cn";
import { cva } from "../core/utils/cva";
import { Resumable } from "../server/resumable";

/** A leaf link. `href` is a route-map key resolved through {@link NavbarProps.resolveHref} — never used raw. @public */
export interface NavLink {
  label: string;
  /** Route-map key (NOT a URL) — passed to `resolveHref` to produce the final `href`. */
  href: string;
  /** Auth tokens; the item shows only when one is in the active set. */
  filters?: string[];
}

/** A branch: a menu over child items (recurses for nested submenus). @public */
export interface NavMenu {
  label: string;
  items: NavItem[];
  /** Auth tokens; the menu shows only when one is in the active set. */
  filters?: string[];
}

/** A slot: an inline JSX node, OR a string key resolved from {@link NavbarProps.slots}. @public */
export interface NavSlot {
  slot: JSXNode | string;
  label?: string;
  /** Auth tokens; the slot shows only when one is in the active set. */
  filters?: string[];
}

/** One navbar entry — a link, a nested menu, or a slot. Discriminated by property presence. @public */
export type NavItem = NavLink | NavMenu | NavSlot;

/** A heading over a list of visible child items; legal at section level only. @public */
export interface NavGroup {
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
  items: NavSectionItem[];
}

/** The full navbar configuration the app feeds to {@link Navbar}. @public */
export interface NavDefinition {
  sections: NavSection[];
}

/** Desktop edge the bar pins to; drives the responsive sticky class. @public */
export type NavPlacement = "top" | "bottom" | "left" | "right";

/** Which breakpoints the bar collapses behind its toggle at. @public */
export type NavCollapsible = "mobile" | "always";

/** How the collapsed panel presents below `md`: in the flow, or as an off-canvas overlay. @public */
export type NavCollapsedAs = "inline" | "drawer";

/** The glyphs every bar draws: the menu chevron and the inline toggle's own pair. @public */
export type NavGlyph = "chevron-down" | "hamburger" | "close";

/** The two a drawer's toggle draws instead. One pair, drawn and mirrored under `rtl:` */
export type NavDrawerGlyph = "panel-open" | "panel-close";

/** What every bar takes, whatever its collapse mode; the tree is built from `config`, so `children` is removed. */
interface NavbarSharedProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  config: NavDefinition;
  /** Resolves a route-map key to a URL — REQUIRED, since `href` is always a key. */
  resolveHref: (key: string) => string;
  /** Fills string-keyed slots. */
  slots?: Record<string, JSXNode>;
  /** Initial auth tokens for correct first paint. */
  activeFilters?: string[];
  /** Desktop edge to pin the bar to; defaults to `"top"`, or `"left"` when `collapsible="always"`. */
  placement?: NavPlacement;
  /** Which breakpoints the bar collapses behind its toggle at. */
  collapsible?: NavCollapsible;
  /** Renders the underlying `<details>` open on first paint. Attribute-only; there is no controller. */
  defaultOpen?: boolean;
  /** DOM id for the bar; also namespaces the generated menu ids, which two same-placement bars on
   * one page would otherwise collide on. */
  id?: string;
  class?: string;
}

/** The in-the-flow bar: the toggle is a hamburger, so the sprite owes nothing new. */
interface NavbarInlineProps extends NavbarSharedProps {
  /** How the collapsed panel presents below `md`: in the flow, or as an off-canvas overlay. */
  collapsedAs?: "inline";
  icon: ForgeIcon<NavGlyph>;
}

/** A top bar that opens off-canvas: still a hamburger, which is the affordance a bar's menu has. */
interface NavbarBarDrawerProps extends NavbarSharedProps {
  collapsedAs: "drawer";
  collapsible?: "mobile";
  icon: ForgeIcon<NavGlyph>;
}

/** A rail that opens off-canvas: its toggle draws the panel pair, so those two glyphs are owed too. */
interface NavbarRailDrawerProps extends NavbarSharedProps {
  collapsedAs: "drawer";
  collapsible: "always";
  icon: ForgeIcon<NavGlyph | NavDrawerGlyph>;
}

/** Props for {@link Navbar}. `collapsedAs` and `collapsible` decide the glyphs owed: opens off-canvas. @public */
export type NavbarProps = NavbarInlineProps | NavbarBarDrawerProps | NavbarRailDrawerProps;

/** Threaded through the recursive renderers. */
interface NavRenderCtx {
  resolveHref: (key: string) => string;
  slots?: Record<string, JSXNode> | undefined;
  activeFilters: string[];
  icon: ForgeIcon<NavGlyph>;
  /** Namespace prefix for generated menu ids — the bar's `id` when given, else its placement. */
  idBase: string;
  seq: { n: number };
  collapsible: NavCollapsible;
}

/** One responsive sticky class string per placement: a vertical mobile edge re-pinned horizontally at `md:`. */
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

/** The `collapsible="always"` counterpart: each placement is a single unconditional pin. */
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
  defaultVariants: { placement: "left" },
});

/** What the two boxes between the consumer's layout and the `<details>` carry in rail mode. */
const RAIL_HEIGHT_CHAIN = "h-full";

/** What the bar itself paints below `md` it would position against the bar, not the viewport. */
const DRAWER_BAR_CLASS = "max-md:bg-transparent max-md:backdrop-blur-none";

/** The rail's own scrolling box has to be released too, or the out-of-flow panel is clipped by it. */
const DRAWER_RAIL_CLASS = `${DRAWER_BAR_CLASS} max-md:max-h-none max-md:overflow-visible`;

/** The off-canvas panel below `md`. `visibility`, not `display`: `display` is not transitionable and
 * `visibility` is, and `invisible` still keeps the closed panel out of the tab order and the a11y tree. */
const DRAWER_PANEL_BASE =
  "max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:invisible max-md:group-open:visible max-md:group-open:translate-x-0 max-md:transition-[transform,visibility] max-md:duration-200 motion-reduce:max-md:transition-none";

/** Which edge the panel slides from — derived from `placement`, never configured separately. */
type DrawerEdge = "leading" | "trailing";

const DRAWER_EDGE_CLASS: Record<DrawerEdge, string> = {
  leading: "max-md:start-0 max-md:border-e max-md:-translate-x-full max-md:rtl:translate-x-full",
  trailing: "max-md:end-0 max-md:border-s max-md:translate-x-full max-md:rtl:-translate-x-full",
};

/** The glyph pair is drawn once, for a leading edge in a left-to-right page, and mirrored into the other three cases */
const DRAWER_GLYPH_CLASS: Record<DrawerEdge, string> = { leading: "rtl:-scale-x-100", trailing: "-scale-x-100 rtl:scale-x-100" };

/** The scrim under the panel. A `<div>` rather than a `<button>`: it duplicates the summary's affordance, so it must not be a second tab stop. */
const DRAWER_BACKDROP_CLASS =
  "hidden max-md:block max-md:fixed max-md:inset-0 max-md:z-30 max-md:bg-foreground/40 max-md:invisible max-md:opacity-0 max-md:group-open:visible max-md:group-open:opacity-100 max-md:transition-[opacity,visibility]";

/** Keeps the toggle above both the scrim and the panel it opened — starts at the same edge and would otherwise cover the one control that shuts it*/
const DRAWER_SUMMARY_CLASS = "max-md:relative max-md:z-50";

/** Summary (toggle) classes per collapse mode; `"always"` keeps the toggle at every breakpoint. */
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

/** Panel classes per collapse mode in drawer mode: the `≥md` half of the inline table, restated so
 * that nothing unprefixed decides `display` — below `md` the overlay's own `max-md:flex` does. */
const DRAWER_PANEL_CLASS: Record<NavCollapsible, string> = {
  mobile: "md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2",
  always: "md:hidden md:group-open:flex flex-col gap-4 p-2",
};

/** Section classes per collapse mode; `"always"` never turns the row horizontal. */
const SECTION_CLASS: Record<NavCollapsible, string> = { mobile: "flex flex-col md:flex-row md:items-center gap-1", always: "flex flex-col gap-1" };

/** Bar-level styling; a bar link adds the focus ring and current-page cue `Menu.Trigger` already carries. */
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

/** The chevron every menu trigger carries. */
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

/** Resolves a slot's content: a string key looks up `slots`, otherwise the node is used directly. */
function renderSlot(item: NavSlot, depth: number, ctx: NavRenderCtx): JSXNode {
  const node = typeof item.slot === "string" ? ctx.slots?.[item.slot] : item.slot;
  const fattrs = filterAttrs(item, ctx.activeFilters);
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

/** Renders a single item, recursing into nested menus; `depth` decides bar vocabulary from menu vocabulary. */
function renderItem(item: NavItem, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if ("slot" in item) return renderSlot(item, depth, ctx);

  if ("items" in item) {
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    const children = item.items.map((child) => renderItem(child, depth + 1, ctx));

    // Emitted as bare siblings: a wrapping element inside a `role="menu"` breaks its content model.
    if (depth > 0) {
      return [
        <Menu.SubmenuTrigger id={id} {...fattrs}>
          <span>{item.label}</span>
          {chevron(ctx)}
        </Menu.SubmenuTrigger>,
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

/** A labelled block of visible destinations, rendered as bar links rather than menu rows. */
function renderGroup(item: NavGroup, ctx: NavRenderCtx): JSXNode {
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

/** The toggle's two states, taken from the props union rather than from a widened `icon`: only the
 * rail-drawer member's `icon` is typed for the panel pair, so the discriminants are what reach them.
 * A bar keeps the hamburger even when it opens off-canvas — that glyph is what a bar's menu is. */
function renderToggleGlyphs(props: NavbarProps, edge: DrawerEdge): JSXNode {
  if (props.collapsedAs === "drawer" && props.collapsible === "always") {
    const Glyph = props.icon;
    const mirror = DRAWER_GLYPH_CLASS[edge];
    return [
      <span class={cn("group-open:hidden", mirror)} aria-hidden='true'>
        <Glyph name='panel-open' width={22} height={22} />
      </span>,
      <span class={cn("hidden group-open:inline", mirror)} aria-hidden='true'>
        <Glyph name='panel-close' width={22} height={22} />
      </span>,
    ];
  }
  const Glyph = props.icon;
  return [
    <span class='group-open:hidden' aria-hidden='true'>
      <Glyph name='hamburger' width={22} height={22} />
    </span>,
    <span class='hidden group-open:inline' aria-hidden='true'>
      <Glyph name='close' width={22} height={22} />
    </span>,
  ];
}

/** A configuration-driven, responsive navbar built from a {@link NavDefinition}. @public */
export const Navbar: FC<NavbarProps> = (props) => {
  const {
    config,
    resolveHref,
    slots,
    activeFilters = [],
    placement,
    collapsible = "mobile",
    collapsedAs = "inline",
    defaultOpen = false,
    icon: Icon,
    class: cls,
    id,
    "data-slot": inherited,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
    ...rest
  } = props;
  const resolvedPlacement = placement ?? (collapsible === "always" ? "left" : "top");
  const ctx: NavRenderCtx = { resolveHref, slots, activeFilters, icon: Icon, idBase: id ?? resolvedPlacement, seq: { n: 0 }, collapsible };
  const variants = collapsible === "always" ? railPlacementVariants : placementVariants;
  const heightLink: { class?: string } = collapsible === "always" ? { class: RAIL_HEIGHT_CHAIN } : {};
  const drawer = collapsedAs === "drawer";
  const edge = resolvedPlacement === "right" || resolvedPlacement === "bottom" ? "trailing" : "leading";
  const drawerBar = collapsible === "always" ? DRAWER_RAIL_CLASS : DRAWER_BAR_CLASS;
  return (
    <Resumable name='navbar' state={{ filters: activeFilters }} {...heightLink}>
      <nav
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
        {...(ariaLabelledby === undefined ? {} : { "aria-labelledby": ariaLabelledby })}
        {...heightLink}>
        <details
          data-slot={slotToken("navbar", inherited)}
          class={cn(variants({ placement: resolvedPlacement }), drawer ? drawerBar : undefined, asClass(cls))}
          {...(id === undefined ? {} : { id })}
          {...(defaultOpen ? { open: true } : {})}
          {...(drawer ? { [NAVBAR_DRAWER_ATTR]: true } : {})}
          {...rest}>
          <summary data-slot='navbar-toggle' aria-label='Menu' class={cn(SUMMARY_CLASS[collapsible], drawer ? DRAWER_SUMMARY_CLASS : undefined)}>
            {renderToggleGlyphs(props, edge)}
          </summary>
          {drawer ? <div data-slot='navbar-backdrop' data-on-click='closeNav' aria-hidden='true' class={DRAWER_BACKDROP_CLASS} /> : null}
          <div class={drawer ? cn(DRAWER_PANEL_CLASS[collapsible], DRAWER_PANEL_BASE, DRAWER_EDGE_CLASS[edge]) : PANEL_CLASS[collapsible]}>
            {config.sections.map((section) => renderSection(section, ctx))}
          </div>
        </details>
      </nav>
    </Resumable>
  );
};
