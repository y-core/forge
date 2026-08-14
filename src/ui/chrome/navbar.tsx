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

/** Props for {@link Navbar}; the tree is built from `config`, so `children` is removed. */
export interface NavbarProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
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
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
  /** DOM id for the bar; also namespaces the generated menu ids, which two same-placement bars on
   * one page would otherwise collide on. */
  id?: string;
  class?: string;
}

/** Threaded through the recursive renderers. */
interface NavRenderCtx {
  resolveHref: (key: string) => string;
  slots?: Record<string, JSXNode> | undefined;
  activeFilters: string[];
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
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

/** A configuration-driven, responsive navbar built from a {@link NavDefinition}. @public */
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
