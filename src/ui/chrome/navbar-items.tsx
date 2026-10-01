/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { JSXNode } from "../../jsx/types";
import { currentAttrs } from "../contracts/state-attrs";
import { Menu } from "../core/menu";
import { Popover } from "../core/popover";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import type { NavCollapsible, NavGroup, NavItem, NavMegaMenu, NavMenu, NavRenderCtx, NavSection, NavSlot } from "./types";

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

/** The collapsed twin of a menu or megamenu: an inline disclosure, shown where the popover is not. */
const DISCLOSURE_CLASS: Record<NavCollapsible, string> = { mobile: "md:hidden", always: "" };

const BAR_DISCLOSURE = cn(`${BAR_LINK} w-full list-none justify-between [&::-webkit-details-marker]:hidden`);

/** Stamps `data-filter` (always) and an initial server-side `hidden` (when no active token matches). @internal */
export function filterAttrs(item: { filters?: string[] | undefined }, activeFilters: string[]): Record<string, unknown> {
  // An absent list is "not filtered"; an empty one is "no token can ever match", which must hide.
  // Collapsing the two showed a `requiredRoles()` lookup miss to every viewer.
  const filters = item.filters;
  if (filters === undefined) return {};
  const visible = filters.some((f) => activeFilters.includes(f));
  const base: Record<string, unknown> = { "data-filter": filters.join(" ") };
  if (!visible) base.hidden = true;
  return base;
}

/** The chevron every menu trigger carries. */
function chevron(ctx: NavRenderCtx, cls?: string): JSXNode {
  return (
    <span aria-hidden='true' class={cn("text-xs opacity-70", cls)}>
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
    <span data-slot={slotToken("navbar-slot")} {...(depth === 0 ? {} : { role: "none" })} class='inline-flex items-center gap-2' {...fattrs}>
      {item.label ? <span>{item.label}</span> : null}
      {node ?? null}
    </span>
  );
}

/** Whether the page the reader is on sits anywhere beneath this item. */
function containsCurrent(item: NavItem): boolean {
  if ("slot" in item) return false;
  if ("groups" in item) return item.groups.some((group) => group.group.some(containsCurrent));
  if ("items" in item) return item.items.some(containsCurrent);
  return item.current === true;
}

/** A native `<details>` that opens a branch in the flow, server-open over the current page. */
function renderDisclosure(item: NavMenu | NavMegaMenu, ctx: NavRenderCtx): JSXNode {
  const body = "groups" in item ? item.groups.map((group) => renderGroup(group, ctx)) : item.items.map((child) => renderInlineItem(child, ctx));
  return (
    <details
      data-slot={slotToken("navbar-disclosure")}
      class={DISCLOSURE_CLASS[ctx.collapsible]}
      {...(containsCurrent(item) ? { open: true } : {})}
      {...filterAttrs(item, ctx.activeFilters)}>
      <summary data-slot='navbar-disclosure-trigger' class={BAR_DISCLOSURE}>
        <span>{item.label}</span>
        {chevron(ctx, "motion-safe:transition-transform [[open]>summary>&]:rotate-180")}
      </summary>
      <div data-slot='navbar-disclosure-content' class='ms-3 flex flex-col gap-1 border-s border-border ps-2'>
        {body}
      </div>
    </details>
  );
}

/** The collapsed copy of a bar-level branch, minting its ids under a `-d` base from its own counter beside the desktop copy. */
function renderDisclosureTwin(item: NavMenu | NavMegaMenu, ctx: NavRenderCtx): JSXNode {
  return renderDisclosure(item, { ...ctx, idBase: `${ctx.idBase}-d`, seq: ctx.disclosureSeq });
}

/** Renders an item inside a disclosure: bar links, never menu rows, and no generated menu ids. */
function renderInlineItem(item: NavItem, ctx: NavRenderCtx): JSXNode {
  if ("slot" in item) return renderSlot(item, 0, ctx);
  if ("groups" in item || "items" in item) return renderDisclosure(item, ctx);
  return (
    <a
      href={ctx.resolveHref(item.href)}
      data-slot={slotToken("navbar-link")}
      {...currentAttrs(item.current ?? false)}
      class={BAR_LINK}
      {...filterAttrs(item, ctx.activeFilters)}>
      {item.label}
    </a>
  );
}

/** A `Popover` of link columns plus its collapsed disclosure twin at bar level, a submenu of groups when nested. */
function renderMegaMenu(item: NavMegaMenu, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if (depth > 0) {
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    return [
      <Menu.SubmenuTrigger for={id} {...fattrs}>
        <span>{item.label}</span>
        {chevron(ctx)}
      </Menu.SubmenuTrigger>,
      <Menu.Popup triggered id={id} side='inline-end' {...fattrs}>
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

  if (ctx.collapsible === "always") return renderDisclosure(item, ctx);

  const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
  const cols = MEGA_COLS[Math.min(item.groups.length, 4)] ?? "grid-cols-1";
  return [
    <Popover data-slot={slotToken("navbar-megamenu")} class='max-md:hidden' {...fattrs}>
      <Popover.Trigger for={id} class={BAR_ITEM}>
        <span>{item.label}</span>
        {chevron(ctx)}
      </Popover.Trigger>
      <Popover.Content id={id} label={item.label} side='bottom' align={item.align ?? "start"} class={MEGA_PANEL}>
        <div class={cn("grid gap-6", cols)}>{item.groups.map((group) => renderGroup(group, ctx))}</div>
      </Popover.Content>
    </Popover>,
    renderDisclosureTwin(item, ctx),
  ];
}

/** The desktop `Menu` of a bar-level branch, hidden below `md` where its disclosure twin shows. */
function renderBarMenu(id: string, children: JSXNode, item: NavMenu, ctx: NavRenderCtx): JSXNode {
  return (
    <Menu class='max-md:hidden' {...filterAttrs(item, ctx.activeFilters)}>
      <Menu.Trigger for={id} class={BAR_ITEM}>
        <span>{item.label}</span>
        {chevron(ctx)}
      </Menu.Trigger>
      <Menu.Popup triggered id={id}>
        {children}
      </Menu.Popup>
    </Menu>
  );
}

/** Renders a single item, recursing into nested menus; `depth` decides bar vocabulary from menu vocabulary. */
function renderItem(item: NavItem, depth: number, ctx: NavRenderCtx): JSXNode {
  const fattrs = filterAttrs(item, ctx.activeFilters);

  if ("slot" in item) return renderSlot(item, depth, ctx);

  if ("groups" in item) return renderMegaMenu(item, depth, ctx);

  if ("items" in item) {
    if (depth === 0 && ctx.collapsible === "always") return renderDisclosure(item, ctx);
    const id = `navbar-menu-${ctx.idBase}-${ctx.seq.n++}`;
    const children = item.items.map((child) => renderItem(child, depth + 1, ctx));

    // Emitted as bare siblings: a wrapping element inside a `role="menu"` breaks its content model.
    if (depth > 0) {
      return [
        <Menu.SubmenuTrigger for={id} {...fattrs}>
          <span>{item.label}</span>
          {chevron(ctx)}
        </Menu.SubmenuTrigger>,
        <Menu.Popup triggered id={id} side='inline-end' {...fattrs}>
          {children}
        </Menu.Popup>,
      ];
    }

    return [renderBarMenu(id, children, item, ctx), renderDisclosureTwin(item, ctx)];
  }

  const href = ctx.resolveHref(item.href);
  if (depth > 0) {
    return (
      <Menu.LinkItem href={href} {...currentAttrs(item.current ?? false)} {...fattrs}>
        {item.label}
      </Menu.LinkItem>
    );
  }

  return (
    <a href={href} data-slot={slotToken("navbar-link")} {...currentAttrs(item.current ?? false)} class={BAR_LINK} {...fattrs}>
      {item.label}
    </a>
  );
}

/** A labelled block of visible destinations, rendered as bar links rather than menu rows. */
function renderGroup(item: NavGroup, ctx: NavRenderCtx): JSXNode {
  const headingId = `navbar-group-${ctx.idBase}-${ctx.seq.n++}`;
  const fattrs = filterAttrs(item, ctx.activeFilters);
  return (
    <div data-slot={slotToken("navbar-group")} role='group' aria-labelledby={headingId} class='flex flex-col gap-1' {...fattrs}>
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
