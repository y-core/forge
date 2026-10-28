/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC, JSXNode } from "../../render/jsx/types";
import { LABEL_DEFAULTS } from "../contracts/labels";
import { NAVBAR_DRAWER_ATTR, NAVBAR_SCOPE } from "../contracts/navbar-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import { stateAttrs } from "../contracts/state-attrs";
import type { NavbarAction } from "../contracts/types";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import { Resumable } from "../server/resumable";
import { renderSection } from "./navbar-items";
import type { NavCollapsible, NavDrawerEdge, NavPlacement, NavRenderCtx } from "./types";
import type { NavbarProps } from "./types";

const PIN_BASE = "z-40";

const BAR_CLASS = "group bg-background/95 backdrop-blur";

/** One responsive sticky class string per placement: a vertical mobile edge re-pinned horizontally at `md:`. */
const PLACEMENT_PIN_CLASS: Record<NavPlacement, string> = {
  top: "sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto",
  bottom: "sticky inset-y-0 right-0 md:inset-x-0 md:top-auto md:bottom-0 md:left-auto",
  left: "sticky inset-x-0 top-0 md:inset-y-0 md:right-auto md:bottom-auto md:left-0",
  right: "sticky inset-x-0 bottom-0 md:inset-y-0 md:top-auto md:right-0 md:left-auto",
};

/** The `collapsible="always"` counterpart: each placement is a single unconditional pin. */
const RAIL_PIN_CLASS: Record<NavPlacement, string> = {
  top: "sticky inset-x-0 top-0",
  bottom: "sticky inset-x-0 bottom-0",
  left: "sticky top-0 left-0 max-h-dvh overflow-y-auto",
  right: "sticky top-0 right-0 max-h-dvh overflow-y-auto",
};

type NavBlockEdge = Extract<NavPlacement, "top" | "bottom">;

const NARROW_EDGE: Record<NavCollapsible, Partial<Record<NavPlacement, NavBlockEdge>>> = {
  mobile: { top: "top", left: "top", bottom: "bottom", right: "bottom" },
  always: { top: "top", bottom: "bottom" },
};

const RAIL_HEIGHT_CHAIN = "h-full";

const BAR_ROW_CLASS = "h-(--forge-navbar-row)";

const BAR_ROW_DESKTOP_CLASS = "md:h-(--forge-navbar-row)";

const DRAWER_BAR_CLASS = "max-md:bg-transparent max-md:backdrop-blur-none";

const DRAWER_RAIL_CLASS = cn(`${DRAWER_BAR_CLASS} max-md:max-h-none max-md:overflow-visible`);

const DRAWER_PANEL_BASE = cn(
  "max-md:invisible max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:transition-[translate,opacity,visibility] max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:transition-[translate,opacity] max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:group-open:translate-x-0 motion-reduce:max-md:opacity-0 motion-reduce:max-md:group-open:opacity-100",
);

const DRAWER_CLEARANCE_CLASS: Record<NavBlockEdge, string> = { top: "max-md:pt-(--forge-navbar-row)", bottom: "max-md:pb-(--forge-navbar-row)" };

/** Which edge the panel slides from — derived from `placement` unless `drawerEdge` overrides it, since a top bar's leading edge may already hold an app's own drawer. */
const DRAWER_EDGE_CLASS: Record<NavDrawerEdge, string> = {
  leading: "max-md:start-0 max-md:border-e motion-safe:max-md:-translate-x-full motion-safe:max-md:rtl:translate-x-full",
  trailing: "max-md:end-0 max-md:border-s motion-safe:max-md:translate-x-full motion-safe:max-md:rtl:-translate-x-full",
};

/** The glyph pair is drawn once, for a leading edge in a left-to-right page, and mirrored into the other three cases */
const DRAWER_GLYPH_CLASS: Record<NavDrawerEdge, string> = { leading: "rtl:-scale-x-100", trailing: "-scale-x-100 rtl:scale-x-100" };

/** The scrim under the panel. A `<div>` rather than a `<button>`: it duplicates the summary's affordance, so it must not be a second tab stop. */
const DRAWER_BACKDROP_CLASS = cn(
  "hidden max-md:invisible max-md:fixed max-md:inset-0 max-md:z-30 max-md:block max-md:bg-foreground/40 max-md:opacity-0 max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:opacity-100 max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:transition-[opacity,visibility] motion-reduce:max-md:transition-[opacity,visibility]",
);

/** Lifts the toggle above the scrim and the panel it opened, on the token row the panel's clearance pads by — it starts at the same edge and would otherwise cover the one control that shuts it */
const DRAWER_SUMMARY_CLASS = "max-md:relative max-md:z-50 max-md:h-(--forge-navbar-row)";

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

/** Panel classes per collapse mode in drawer mode: the `≥md` half only, so nothing unprefixed decides `display`. */
const DRAWER_PANEL_CLASS: Record<NavCollapsible, string> = {
  mobile: "flex-col justify-between gap-4 p-2 md:flex md:flex-row md:items-center",
  always: "flex-col gap-4 p-2 md:hidden md:group-open:flex",
};

/** The toggle's open and close glyphs, chosen from the props union's discriminants. */
function renderToggleGlyphs(props: NavbarProps, edge: NavDrawerEdge): JSXNode {
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
    toggleLabel = LABEL_DEFAULTS.navbarToggle,
    collapsedAs = "inline",
    drawerEdge,
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
  const ctx: NavRenderCtx = {
    resolveHref,
    slots,
    activeFilters,
    icon: Icon,
    idBase: id ?? resolvedPlacement,
    seq: { n: 0 },
    disclosureSeq: { n: 0 },
    collapsible,
  };
  const pinClass = cn(PIN_BASE, collapsible === "always" ? RAIL_PIN_CLASS[resolvedPlacement] : PLACEMENT_PIN_CLASS[resolvedPlacement]);
  const pinsBar = collapsible === "always" && (resolvedPlacement === "left" || resolvedPlacement === "right");
  const heightLink: { class?: string | undefined } = collapsible === "always" ? { class: RAIL_HEIGHT_CHAIN } : {};
  const drawer = collapsedAs === "drawer";
  const horizontal = resolvedPlacement === "top" || resolvedPlacement === "bottom";
  const narrowEdge = NARROW_EDGE[collapsible][resolvedPlacement];
  const rowDesktop = horizontal && collapsible === "mobile" ? BAR_ROW_DESKTOP_CLASS : undefined;
  const edge =
    (collapsible === "always" ? undefined : drawerEdge) ??
    (resolvedPlacement === "right" || resolvedPlacement === "bottom" ? "trailing" : "leading");
  const drawerBar = collapsible === "always" ? DRAWER_RAIL_CLASS : DRAWER_BAR_CLASS;
  return (
    <Resumable name={NAVBAR_SCOPE} state={{ filters: activeFilters }} class={cn(pinsBar ? undefined : pinClass, heightLink.class)}>
      <nav aria-label={ariaLabel} aria-labelledby={ariaLabelledby} {...heightLink}>
        <details
          data-slot={slotToken("navbar", inherited)}
          {...stateAttrs({ side: resolvedPlacement })}
          class={cn(BAR_CLASS, pinsBar ? pinClass : undefined, drawer ? drawerBar : undefined, cls)}
          id={id}
          {...(defaultOpen ? { open: true } : {})}
          {...(drawer ? { [NAVBAR_DRAWER_ATTR]: true } : {})}
          {...(collapsible === "mobile" && !horizontal ? { "data-narrow-edge": narrowEdge } : {})}
          {...rest}>
          <summary
            data-slot='navbar-toggle'
            aria-label={toggleLabel}
            class={cn(SUMMARY_CLASS[collapsible], narrowEdge !== undefined ? BAR_ROW_CLASS : undefined, drawer ? DRAWER_SUMMARY_CLASS : undefined)}>
            {renderToggleGlyphs(props, edge)}
          </summary>
          {drawer ? (
            <div
              data-slot='navbar-backdrop'
              {...scopeAttrs<NavbarAction>({ onClick: "closeNav" })}
              aria-hidden='true'
              class={DRAWER_BACKDROP_CLASS}
            />
          ) : null}
          <div
            class={
              drawer
                ? cn(
                    DRAWER_PANEL_CLASS[collapsible],
                    rowDesktop,
                    DRAWER_PANEL_BASE,
                    DRAWER_EDGE_CLASS[edge],
                    DRAWER_CLEARANCE_CLASS[narrowEdge ?? "top"],
                  )
                : cn(PANEL_CLASS[collapsible], rowDesktop)
            }>
            {config.sections.map((section) => renderSection(section, ctx))}
          </div>
        </details>
      </nav>
    </Resumable>
  );
};
