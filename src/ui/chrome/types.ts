import type { JSX } from "../../jsx/types";
import type { JSXNode } from "../../jsx/types";
import type { Size } from "../contracts/types";
import type { Align } from "../contracts/types";
import type { ForgeIcon } from "../core/types";

/** One dock destination: a glyph over a label. `href` is a route-map key resolved through {@link DockProps.resolveHref}. @public */
export interface DockItem<G extends string = string> {
  label: string;
  /** Route-map key (NOT a URL) — passed to `resolveHref` to produce the final `href`. */
  href: string;
  /** Sprite glyph name, rendered via the bound `icon`. */
  icon: G;
  /** Marks the destination the reader is on: `aria-current="page"` plus `data-selected`. */
  current?: boolean | undefined;
  /** Auth tokens; the item shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** The breakpoint the dock hides from, where a `Navbar` takes over; `never` keeps it at every width. @public */
export type DockHideAbove = "md" | "lg" | "never";

/** Props for {@link Dock}. @public */
export interface DockProps<G extends string = string> extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  items: DockItem<G>[];
  /** Resolves a route-map key to a URL — REQUIRED, since `href` is always a key. */
  resolveHref: (key: string) => string;
  icon: ForgeIcon<G>;
  /** The bar's accessible name. @default "Primary" */
  label?: string | undefined;
  size?: Size | undefined;
  hideAbove?: DockHideAbove | undefined;
  /** Initial auth tokens for correct first paint; server-hidden only, with no runtime re-sync. */
  activeFilters?: string[] | undefined;
}

/** A leaf link. `href` is a route-map key resolved through {@link NavRenderCtx.resolveHref} — never used raw. @public */
export interface NavLink {
  label: string;
  /** Route-map key (NOT a URL) — passed to `resolveHref` to produce the final `href`. */
  href: string;
  /** This link is the page the reader is on. `BAR_LINK`'s `aria-[current]:*` utilities paint it. */
  current?: boolean | undefined;
  /** Auth tokens; the item shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** A branch: a menu over child items (recurses for nested submenus). @public */
export interface NavMenu {
  label: string;
  items: NavItem[];
  /** Auth tokens; the menu shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** A slot: an inline JSX node, OR a string key resolved from {@link NavRenderCtx.slots}. @public */
export interface NavSlot {
  slot: JSXNode | string;
  label?: string | undefined;
  /** Auth tokens; the slot shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** A megamenu: a wide panel of link columns, one per group, opened from a bar trigger. @public */
export interface NavMegaMenu {
  label: string;
  /** The columns, at most four across; each renders as a headed `NavGroup`. */
  groups: NavGroup[];
  /** Which edge of the trigger the panel aligns to; `end` keeps a wide panel on the last bar item inside the viewport. */
  align?: Align | undefined;
  /** Auth tokens; the megamenu shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** One navbar entry — a link, a nested menu, a megamenu, or a slot. Discriminated by property presence. @public */
export type NavItem = NavLink | NavMenu | NavSlot | NavMegaMenu;

/** A heading over a list of visible child items; legal at section level and as a megamenu column. @public */
export interface NavGroup {
  heading: string;
  /** The group's items. Renders as visible bar links; nests no further. */
  group: NavItem[];
  /** Auth tokens; the group shows only when one is in the active set. */
  filters?: string[] | undefined;
}

/** What a section may hold: any nav item, plus a group — which nests no further. @public */
export type NavSectionItem = NavItem | NavGroup;

/** A group of items; sibling sections spread across the bar via `justify-between`. @public */
export interface NavSection {
  items: NavSectionItem[];
}

/** The full navbar configuration the app feeds to `Navbar`. @public */
export interface NavDefinition {
  sections: NavSection[];
}

/** The glyphs every bar draws: the menu chevron and the inline toggle's own pair. @public */
export type NavGlyph = "chevron-down" | "hamburger" | "close";

/** Which breakpoints the bar collapses behind its toggle at. @public */
export type NavCollapsible = "mobile" | "always";

/** Threaded through the recursive renderers. @internal */
export interface NavRenderCtx {
  resolveHref: (key: string) => string;
  slots?: Record<string, JSXNode> | undefined;
  activeFilters: string[];
  icon: ForgeIcon<NavGlyph>;
  /** Namespace prefix for generated menu ids — the bar's `id` when given, else its placement. */
  idBase: string;
  seq: { n: number };
  collapsible: NavCollapsible;
}

/** Desktop edge the bar pins to; drives the responsive sticky class. @public */
export type NavPlacement = "top" | "bottom" | "left" | "right";

/** How the collapsed panel presents below `md`: in the flow, or as an off-canvas overlay. @public */
export type NavCollapsedAs = "inline" | "drawer";

/** The two a drawer's toggle draws instead. One pair, drawn and mirrored under `rtl:` */
export type NavDrawerGlyph = "panel-open" | "panel-close";

/** Props for {@link Navbar}. `collapsedAs` and `collapsible` decide the glyphs owed: opens off-canvas. @public */
export type NavbarProps = NavbarInlineProps | NavbarBarDrawerProps | NavbarRailDrawerProps;

/** Props for {@link ThemeToggle}. @public */
export interface ThemeToggleProps {
  /** Bound icon supplying the `sun`, `moon`, and `monitor` glyphs. */
  icon: ForgeIcon<"sun" | "moon" | "monitor">;
  /** Control size, mapped to a 16 / 20 / 24 px icon. @default "md" */
  size?: Size | undefined;
  /** Additional classes merged onto the toggle button. */
  class?: string | undefined;
}

/** Root rail item that fires a delegated action immediately on click. @public */
export interface ToolbarAction<A extends string = string, G extends string = string> {
  kind: "action";
  /** Sprite glyph name, rendered via the bound `icon`. */
  icon: G;
  /** Tooltip / aria-label. */
  label: string;
  action: A;
  /** How the action reaches a handler: `"scope"` emits `data-on-click`, `"command"` a native Invoker command. */
  dispatch?: "scope" | "command" | undefined;
  /** data-ref (test/parity hook). */
  ref?: string | undefined;
  data?: Record<string, string> | undefined;
  /** Stamps class="active" at SSR for boot highlight. Tri-state: `false` announces an unpressed
   *  toggle, absent announces a plain action button. */
  active?: boolean | undefined;
  /** Height of the icon-shaped item; default `md`. */
  size?: Size | undefined;
}

/** An action button rendered inline on a popover's flyout title row. @public */
export interface ToolbarTitleAction<A extends string = string, G extends string = string> {
  /** App sprite glyph, rendered via the bound `icon`. */
  icon: G;
  /** Tooltip + aria-label. */
  label: string;
  action: A;
  /** data-ref (test/parity hook). */
  ref?: string | undefined;
}

/** Root rail item that opens a placement-aware flyout of arbitrary content. @public */
export interface ToolbarPopover<A extends string = string, G extends string = string> {
  kind: "popover";
  /** Sprite glyph name for the trigger icon. */
  icon: G;
  /** Trigger aria-label + flyout title-chip text. */
  label: string;
  /** data-ref on the trigger button. */
  ref?: string | undefined;
  /** The app's control primitives rendered inside the flyout body. */
  content: JSXNode;
  /** Shrink flyout to content width (no min-w-52 floor). */
  compact?: boolean | undefined;
  titleAction?: ToolbarTitleAction<A, G> | undefined;
}

/** @public */
export interface ToolbarSeparator {
  kind: "separator";
}

/** Rail item that renders caller-supplied markup in place of a button. @public */
export interface ToolbarSlot {
  kind: "slot";
  slot: JSXNode;
}

/** @public */
export type ToolbarItem<A extends string = string, G extends string = string> =
  | ToolbarAction<A, G>
  | ToolbarPopover<A, G>
  | ToolbarSeparator
  | ToolbarSlot;

/** A cluster of items; a separator is auto-emitted between sibling groups. @public */
export interface ToolbarGroup<A extends string = string, G extends string = string> {
  items: ToolbarItem<A, G>[];
}

/** Full toolbar configuration. @public */
export interface ToolbarDefinition<A extends string = string, G extends string = string> {
  groups: ToolbarGroup<A, G>[];
}

/** Edge the rail pins to; drives flex direction + flyout direction. @public */
export type ToolbarPlacement = "left" | "right" | "top" | "bottom";

/** Props for {@link Toolbar}; the tree is built from `config`, so `children` is removed. @public */
export interface ToolbarProps<A extends string = string, G extends string = string> extends Omit<JSX.IntrinsicElements["div"], "children"> {
  config: ToolbarDefinition<A, G>;
  /** App sprite icon — glyph names are app-defined. Required. */
  icon: ForgeIcon<G>;
  /** Edge the rail pins to. Default `"left"`. */
  placement?: ToolbarPlacement | undefined;
  /** `commandfor` sink (element id, bare or `#id`) for actions with `dispatch:"command"`. */
  commandTarget?: string | undefined;
  /** DOM id for the rail; also namespaces the generated flyout ids, which two same-placement rails
   * on one page would otherwise collide on. */
  id?: string | undefined;
  class?: string | undefined;
}

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
