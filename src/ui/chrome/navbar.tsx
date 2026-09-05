/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { NAVBAR_DRAWER_ATTR, NAVBAR_SCOPE } from "../contracts/navbar-contract";
import type { ForgeIcon } from "../core/icon";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import { cva } from "../core/utils/cva";
import { Resumable } from "../server/resumable";
import { type NavCollapsible, type NavDefinition, type NavGlyph, type NavRenderCtx, renderSection } from "./navbar-items";

/** Desktop edge the bar pins to; drives the responsive sticky class. @public */
export type NavPlacement = "top" | "bottom" | "left" | "right";

/** How the collapsed panel presents below `md`: in the flow, or as an off-canvas overlay. @public */
export type NavCollapsedAs = "inline" | "drawer";

/** The two a drawer's toggle draws instead. One pair, drawn and mirrored under `rtl:` */
export type NavDrawerGlyph = "panel-open" | "panel-close";

/** What every bar takes, whatever its collapse mode; the tree is built from `config`, so `children` is removed. */
interface NavbarSharedProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  config: NavDefinition;
  /** Resolves a route-map key to a URL — REQUIRED, since `href` is always a key. */
  resolveHref: (key: string) => string;
  /** Fills string-keyed slots. */
  slots?: Record<string, JSXNode> | undefined;
  /** Initial auth tokens for correct first paint. */
  activeFilters?: string[] | undefined;
  /** Desktop edge to pin the bar to; defaults to `"top"`, or `"left"` when `collapsible="always"`. */
  placement?: NavPlacement | undefined;
  /** Which breakpoints the bar collapses behind its toggle at. */
  collapsible?: NavCollapsible | undefined;
  /** Renders the underlying `<details>` open on first paint. Attribute-only; there is no controller. */
  defaultOpen?: boolean | undefined;
  /** DOM id for the bar; also namespaces the generated menu ids, which two same-placement bars on
   * one page would otherwise collide on. */
  id?: string | undefined;
  class?: string | undefined;
}

/** The in-the-flow bar: the toggle is a hamburger, so the sprite owes nothing new. */
interface NavbarInlineProps extends NavbarSharedProps {
  /** How the collapsed panel presents below `md`: in the flow, or as an off-canvas overlay. */
  collapsedAs?: "inline" | undefined;
  icon: ForgeIcon<NavGlyph>;
}

/** A top bar that opens off-canvas: still a hamburger, which is the affordance a bar's menu has. */
interface NavbarBarDrawerProps extends NavbarSharedProps {
  collapsedAs: "drawer";
  collapsible?: "mobile" | undefined;
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

/** One responsive sticky class string per placement: a vertical mobile edge re-pinned horizontally at `md:`. */
const placementVariants = cva({
  base: "group z-40 bg-background/95 backdrop-blur",
  variants: {
    placement: {
      top: "sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto",
      bottom: "sticky inset-y-0 right-0 md:inset-x-0 md:top-auto md:bottom-0 md:left-auto",
      left: "sticky inset-x-0 top-0 md:inset-y-0 md:right-auto md:bottom-auto md:left-0",
      right: "sticky inset-x-0 bottom-0 md:inset-y-0 md:top-auto md:right-0 md:left-auto",
    },
  },
  defaultVariants: { placement: "top" },
});

/** The `collapsible="always"` counterpart: each placement is a single unconditional pin. */
const railPlacementVariants = cva({
  base: "group z-40 bg-background/95 backdrop-blur",
  variants: {
    placement: {
      top: "sticky inset-x-0 top-0",
      bottom: "sticky inset-x-0 bottom-0",
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
const DRAWER_RAIL_CLASS = cn(`${DRAWER_BAR_CLASS} max-md:max-h-none max-md:overflow-visible`);

/** The off-canvas panel below `md`. `visibility`, not `display`: `display` is not transitionable and
 * `visibility` is, and `invisible` still keeps the closed panel out of the tab order and the a11y tree. */
const DRAWER_PANEL_BASE = cn(
  "max-md:invisible max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:transition-[transform,visibility] max-md:duration-200 max-md:group-open:visible max-md:group-open:translate-x-0 motion-reduce:max-md:transition-none",
);

/** Which edge the panel slides from — derived from `placement`, never configured separately. */
type DrawerEdge = "leading" | "trailing";

const DRAWER_EDGE_CLASS: Record<DrawerEdge, string> = {
  leading: "max-md:start-0 max-md:-translate-x-full max-md:border-e max-md:rtl:translate-x-full",
  trailing: "max-md:end-0 max-md:translate-x-full max-md:border-s max-md:rtl:-translate-x-full",
};

/** The glyph pair is drawn once, for a leading edge in a left-to-right page, and mirrored into the other three cases */
const DRAWER_GLYPH_CLASS: Record<DrawerEdge, string> = { leading: "rtl:-scale-x-100", trailing: "-scale-x-100 rtl:scale-x-100" };

/** The scrim under the panel. A `<div>` rather than a `<button>`: it duplicates the summary's affordance, so it must not be a second tab stop. */
const DRAWER_BACKDROP_CLASS = cn(
  "hidden max-md:invisible max-md:fixed max-md:inset-0 max-md:z-30 max-md:block max-md:bg-foreground/40 max-md:opacity-0 max-md:transition-[opacity,visibility] max-md:group-open:visible max-md:group-open:opacity-100 motion-reduce:max-md:transition-none",
);

/** Keeps the toggle above both the scrim and the panel it opened — starts at the same edge and would otherwise cover the one control that shuts it*/
const DRAWER_SUMMARY_CLASS = "max-md:relative max-md:z-50";

/** Summary (toggle) classes per collapse mode; `"always"` keeps the toggle at every breakpoint. */
const SUMMARY_CLASS: Record<NavCollapsible, string> = {
  mobile: "flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden",
  always: "sticky top-0 flex cursor-pointer list-none items-center justify-start bg-background/95 p-3 focus-ring group-open:justify-end",
};

/** Panel classes per collapse mode; `"always"` stays a disclosed vertical stack at every breakpoint. */
const PANEL_CLASS: Record<NavCollapsible, string> = {
  mobile: "hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center",
  always: "hidden flex-col gap-4 p-2 group-open:flex",
};

/** Panel classes per collapse mode in drawer mode: the `≥md` half of the inline table, restated so
 * that nothing unprefixed decides `display` — below `md` the overlay's own `max-md:flex` does. */
const DRAWER_PANEL_CLASS: Record<NavCollapsible, string> = {
  mobile: "flex-col justify-between gap-4 p-2 md:flex md:flex-row md:items-center",
  always: "flex-col gap-4 p-2 md:hidden md:group-open:flex",
};

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
  const heightLink: { class?: string | undefined } = collapsible === "always" ? { class: RAIL_HEIGHT_CHAIN } : {};
  const drawer = collapsedAs === "drawer";
  const edge = resolvedPlacement === "right" || resolvedPlacement === "bottom" ? "trailing" : "leading";
  const drawerBar = collapsible === "always" ? DRAWER_RAIL_CLASS : DRAWER_BAR_CLASS;
  return (
    <Resumable name={NAVBAR_SCOPE} state={{ filters: activeFilters }} {...heightLink}>
      <nav aria-label={ariaLabel} aria-labelledby={ariaLabelledby} {...heightLink}>
        <details
          data-slot={slotToken("navbar", inherited)}
          class={cn(variants({ placement: resolvedPlacement }), drawer ? drawerBar : undefined, cls)}
          id={id}
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
