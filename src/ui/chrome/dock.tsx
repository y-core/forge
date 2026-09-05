/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { currentAttrs } from "../contracts/state-attrs";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Size } from "../contracts/vocabulary";
import type { ForgeIcon } from "../core/icon";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import { filterAttrs } from "./navbar-items";

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

const ROOT = "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]";

const HIDE_CLASS: Record<DockHideAbove, string | undefined> = { md: "md:hidden", lg: "lg:hidden", never: undefined };

const ITEM =
  "flex flex-col items-center gap-1 text-xs text-muted-foreground focus-ring aria-[current]:font-semibold aria-[current]:text-foreground";

const ICON_PX: Record<Size, number> = { sm: 18, md: 20, lg: 24 };

const ITEM_SIZE: Record<Size, string> = { sm: "py-1", md: "py-2", lg: "py-3 text-sm" };

/** A fixed bottom bar of three to five equal-weight destinations — the phone-width primary navigation. @public */
export const Dock = <G extends string = string>({
  items,
  resolveHref,
  icon: Icon,
  label = "Primary",
  size = "md",
  hideAbove = "md",
  activeFilters = [],
  class: cls,
  "data-slot": inherited,
  ...rest
}: DockProps<G>): ReturnType<FC> => (
  <nav
    aria-label={label}
    data-slot={slotToken("dock", inherited)}
    {...presentationAttrs({ size })}
    class={cn(ROOT, HIDE_CLASS[hideAbove], cls)}
    {...rest}>
    <ul data-slot='dock-list' class='m-0 grid list-none auto-cols-fr grid-flow-col p-0'>
      {items.map((item) => (
        <li {...filterAttrs(item, activeFilters)}>
          <a href={resolveHref(item.href)} data-slot='dock-item' {...currentAttrs(item.current ?? false)} class={cn(ITEM, ITEM_SIZE[size])}>
            <Icon name={item.icon} width={ICON_PX[size]} height={ICON_PX[size]} aria-hidden='true' />
            <span data-slot='dock-label'>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
);
