/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { JSXNode } from "../../jsx/types";
import { currentAttrs } from "../contracts/state-attrs";
import { Menu } from "../core/menu";
import { Popover } from "../core/popover";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import type { NavCollapsible, NavGroup, NavItem, NavMegaMenu, NavRenderCtx, NavSection, NavSlot } from "./types";

/** Section classes per collapse mode; `"always"` never turns the row horizontal. */
const SECTION_CLASS: Record<NavCollapsible, string> = { mobile: "flex flex-col gap-1 md:flex-row md:items-center", always: "flex flex-col gap-1" };

/** Bar-level styling; a bar link adds the focus ring and current-page cue `Menu.Trigger` already carries. */
const BAR_ITEM = "inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground";
const BAR_LINK = cn(
  `${BAR_ITEM} cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground`,
);

/** The megamenu panel: as wide as its columns, never wider than the viewport. */
const MEGA_PANEL = "w-max max-w-[calc(100vw-2rem)] p-4";

/** One literal per column count — Tailwind scans source, so a computed `grid-cols-${n}` never compiles. */
const MEGA_COLS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"] as const;

/** The collapsed twin of a megamenu: the same groups as a stacked list, shown where the popover is not. */
const MEGA_LIST_CLASS: Record<NavCollapsible, string> = { mobile: "flex flex-col gap-2 md:hidden", always: "flex flex-col gap-2" };

/** Stamps `data-filter` (always) and an initial server-side `hidden` (when no active token matches). @internal */
export function filterAttrs(item: { filters?: string[] | undefined }, activeFilters: string[]): Record<string, unknown> {
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

/** A megamenu at bar level is a `Popover` of link columns plus its collapsed list twin; inside a menu it
 * degrades to a submenu of groups, and in a rail only the list form renders. No `role="menu"`: a block
 * of links is navigation, so Tab walks it and light-dismiss and Escape are the platform's. */
function renderMegaMenu(item: NavMegaMenu, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if (depth > 0) {
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    return [
      <Menu.SubmenuTrigger for={id} {...fattrs}>
        <span>{item.label}</span>
        {chevron(ctx)}
      </Menu.SubmenuTrigger>,
      <Menu.Popup id={id} side='inline-end'>
        {item.groups.map((group) => {
          const labelId = `navbar-group-${ctx.idBase}-${ctx.seq.n++}`;
          return (
            <Menu.Group aria-labelledby={labelId} {...filterAttrs(group, ctx.activeFilters)}>
              <Menu.GroupLabel id={labelId}>{group.heading}</Menu.GroupLabel>
              {group.group.map((child) => renderItem(child, depth + 1, ctx))}
            </Menu.Group>
          );
        })}
      </Menu.Popup>,
    ];
  }

  const list = () => (
    <div data-slot={slotToken("navbar-megamenu-list", fattrs["data-slot"])} class={MEGA_LIST_CLASS[ctx.collapsible]} {...fattrs}>
      {item.groups.map((group) => renderGroup(group, ctx))}
    </div>
  );
  if (ctx.collapsible === "always") return list();

  const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
  const cols = MEGA_COLS[Math.min(item.groups.length, 4)] ?? "grid-cols-1";
  return [
    <Popover data-slot={slotToken("navbar-megamenu", fattrs["data-slot"])} class='max-md:hidden' {...fattrs}>
      <Popover.Trigger for={id} class={BAR_ITEM}>
        <span>{item.label}</span>
        {chevron(ctx)}
      </Popover.Trigger>
      <Popover.Content id={id} side='bottom' align={item.align ?? "start"} class={MEGA_PANEL}>
        <div class={cn("grid gap-6", cols)}>{item.groups.map((group) => renderGroup(group, ctx))}</div>
      </Popover.Content>
    </Popover>,
    list(),
  ];
}

/** Renders a single item, recursing into nested menus; `depth` decides bar vocabulary from menu vocabulary. */
function renderItem(item: NavItem, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if ("slot" in item) return renderSlot(item, depth, ctx);

  if ("groups" in item) return renderMegaMenu(item, depth, ctx);

  if ("items" in item) {
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    const children = item.items.map((child) => renderItem(child, depth + 1, ctx));

    // Emitted as bare siblings: a wrapping element inside a `role="menu"` breaks its content model.
    if (depth > 0) {
      return [
        <Menu.SubmenuTrigger for={id} {...fattrs}>
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
        <Menu.Trigger for={id} class={BAR_ITEM}>
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
    <a href={href} data-slot={slotToken("navbar-link", fattrs["data-slot"])} {...currentAttrs(item.current ?? false)} class={BAR_LINK} {...fattrs}>
      {item.label}
    </a>
  );
}

/** A labelled block of visible destinations, rendered as bar links rather than menu rows. */
function renderGroup(item: NavGroup, ctx: NavRenderCtx): JSXNode {
  const headingId = `navbar-group-${ctx.idBase}-${ctx.seq.n++}`;
  const fattrs = filterAttrs(item, ctx.activeFilters);
  return (
    <div
      data-slot={slotToken("navbar-group", fattrs["data-slot"])}
      role='group'
      aria-labelledby={headingId}
      class='flex flex-col gap-1'
      {...fattrs}>
      <p id={headingId} data-slot='navbar-group-heading' class='px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        {item.heading}
      </p>
      {item.group.map((child) => renderItem(child, 0, ctx))}
    </div>
  );
}

/** A section is a flex group of items; siblings are spread by the container's `justify-between`. @internal */
export function renderSection(section: NavSection, ctx: NavRenderCtx): JSXNode {
  return (
    <div data-slot='navbar-section' class={SECTION_CLASS[ctx.collapsible]}>
      {section.items.map((item) => ("group" in item ? renderGroup(item, ctx) : renderItem(item, 0, ctx)))}
    </div>
  );
}
