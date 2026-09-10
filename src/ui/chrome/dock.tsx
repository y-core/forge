/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { currentAttrs } from "../contracts/state-attrs";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import { filterAttrs } from "./navbar-items";
import type { DockHideAbove, DockProps } from "./types";

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
