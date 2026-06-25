/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "../core/icon";
import { Popover } from "../core/popover";
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

/** A branch: a `<details>` dropdown over child items (recurses for nested submenus). @public */
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

/** A group of items; sibling sections spread across the bar via `justify-between`. @public */
export interface NavSection {
  /** The section's items. */
  items: NavItem[];
}

/** The full navbar configuration the app feeds to {@link Navbar}. @public */
export interface NavConfig {
  /** Top-level sections (typically 2 = ends, or 3 = ends + center). */
  sections: NavSection[];
}

/** Desktop edge the bar pins to; drives the responsive sticky class. @public */
export type NavPlacement = "top" | "bottom" | "left" | "right";

/**
 * Props for {@link Navbar}. Extends `<nav>` attributes (id, class, aria, data-*) minus `children`,
 * since the tree is built from `config`, not JSX children.
 */
export interface NavbarProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  /** Nested navbar configuration (`sections → items → items …`). */
  config: NavConfig;
  /** Resolves a route-map key to a URL — REQUIRED, since `href` is always a key. */
  resolveHref: (key: string) => string;
  /** Fills string-keyed slots (e.g. `{ user_name: <span/>, signout: <button/> }`). */
  slots?: Record<string, JSXNode>;
  /** Initial auth tokens for correct first paint (e.g. `["user"]`). */
  activeFilters?: string[];
  /** Desktop edge to pin the bar to. Default `"top"`. */
  placement?: NavPlacement;
  /** Bound icon — must supply `chevron-down`, `hamburger`, and `close`. Required. */
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
  /** Extra classes merged onto the root element. */
  class?: string;
}

/** Threaded through the recursive renderers so they can resolve hrefs/slots, seed filters, and render icons. */
interface NavRenderCtx {
  resolveHref: (key: string) => string;
  slots?: Record<string, JSXNode> | undefined;
  activeFilters: string[];
  icon: ForgeIcon<"chevron-down" | "hamburger" | "close">;
}

/**
 * One responsive sticky class string per placement, following the pattern
 * `sticky <mobile-edge> inset-y-0 md:<desktop-edge> md:inset-x-0`: a vertical mobile edge that is
 * cancelled and re-pinned to the horizontal desktop edge at `md:`.
 */
const placementVariants = cva({
  base: "group z-40 border-border bg-background/95 backdrop-blur",
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

/** Top-level entries read as a menubar button; nested entries read as full-width menu rows. */
const TRIGGER_TOP =
  "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";
const ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** Stamps `data-filter` (always) and an initial server-side `hidden` (when no active token matches). */
function filterAttrs(item: NavItem, activeFilters: string[]): Record<string, unknown> {
  if (!item.filters?.length) return {};
  const visible = item.filters.some((f) => activeFilters.includes(f));
  const base: Record<string, unknown> = { "data-filter": item.filters.join(" ") };
  if (!visible) base.hidden = true;
  return base;
}

/** Resolves a slot's content: a string key looks up `slots`, otherwise the node is used directly. */
function renderSlot(item: NavSlot, ctx: NavRenderCtx): JSXNode {
  const node = typeof item.slot === "string" ? ctx.slots?.[item.slot] : item.slot;
  const fattrs = filterAttrs(item, ctx.activeFilters);
  // No label and no filter marker → render the node inline with no wrapper.
  if (!item.label && !("data-filter" in fattrs)) return node ?? null;
  return (
    <span data-slot='navbar-slot' class='inline-flex items-center gap-2' {...fattrs}>
      {item.label ? <span>{item.label}</span> : null}
      {node ?? null}
    </span>
  );
}

/** Renders a single item, recursing into nested menus. `depth` selects menubar-button vs menu-row styling. */
function renderItem(item: NavItem, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if ("slot" in item) return renderSlot(item, ctx);

  if ("items" in item) {
    return (
      <Popover class={depth === 0 ? "" : "block w-full"} {...fattrs}>
        <Popover.Trigger class={depth === 0 ? TRIGGER_TOP : ROW}>
          <span>{item.label}</span>
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
        </Popover.Trigger>
        <Popover.Content>{item.items.map((child) => renderItem(child, depth + 1, ctx))}</Popover.Content>
      </Popover>
    );
  }

  return (
    <a href={ctx.resolveHref(item.href)} data-slot='navbar-link' class={depth === 0 ? TRIGGER_TOP : ROW} {...fattrs}>
      {item.label}
    </a>
  );
}

/** A section is a flex group of items; siblings are spread by the container's `justify-between`. */
function renderSection(section: NavSection, ctx: NavRenderCtx): JSXNode {
  return (
    <div data-slot='navbar-section' class='flex flex-col md:flex-row md:items-center gap-1'>
      {section.items.map((item) => renderItem(item, 0, ctx))}
    </div>
  );
}

/**
 * A configuration-driven, responsive navbar/menubar. The app feeds a nested {@link NavConfig}
 * (`sections → items → items …`); on desktop it renders a horizontal bar of `<details>` dropdowns
 * with nested submenus, and on mobile it collapses to a hamburger-toggled `<details>` — all without
 * JavaScript. A small resumable scope (`navbar`) adds outside-click-close and runtime auth filtering.
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
export const Navbar: FC<NavbarProps> = ({ config, resolveHref, slots, activeFilters = [], placement = "top", icon: Icon, class: cls, ...rest }) => {
  const ctx: NavRenderCtx = { resolveHref, slots, activeFilters, icon: Icon };
  return (
    <Resumable name='navbar' state={{ filters: activeFilters }}>
      <details data-slot='navbar' class={cn(placementVariants({ placement }), asClass(cls))} {...rest}>
        <summary
          data-slot='navbar-toggle'
          aria-label='Menu'
          class='md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span class='group-open:hidden' aria-hidden='true'>
            <Icon name='hamburger' width={22} height={22} />
          </span>
          <span class='hidden group-open:inline' aria-hidden='true'>
            <Icon name='close' width={22} height={22} />
          </span>
        </summary>
        <div class='hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2'>
          {config.sections.map((section) => renderSection(section, ctx))}
        </div>
      </details>
    </Resumable>
  );
};
