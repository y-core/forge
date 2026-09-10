/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { JSXElement, JSXNode } from "../../jsx/types";
import { invokerAttrs } from "../contracts/overlay-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import { stateAttrs } from "../contracts/state-attrs";
import { TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { Button } from "../core/button";
import { Toolbar as CoreToolbar } from "../core/toolbar";
import type { ForgeIcon } from "../core/types";
import { slotToken } from "../core/utils/as-child";
import { cn } from "../core/utils/cn";
import { commandAttrs } from "../server/command-attrs";
import type { ToolbarAction, ToolbarGroup, ToolbarItem, ToolbarPlacement, ToolbarProps } from "./types";

/** Threaded through the item renderers. */
interface RenderCtx<G extends string> {
  placement: ToolbarPlacement;
  icon: ForgeIcon<G>;
  commandTarget: string | undefined;
  /** Namespace prefix for generated flyout ids — the rail's `id` when given, else its placement. */
  idBase: string;
  seq: { n: number };
}

const FLYOUT_CLS = "min-w-52 rounded-box border border-border bg-popover p-2 pb-2.5 text-popover-foreground shadow-md";
const FLYOUT_TITLE_CLS = "px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase";
const FLYOUT_BODY_CLS = "flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5";

function isVerticalPlacement(placement: ToolbarPlacement): boolean {
  return placement === "left" || placement === "right";
}

/** The rail's own box: a column on the side placements, a row on the end ones. */
function railClass(placement: ToolbarPlacement): string {
  return `group ${isVerticalPlacement(placement) ? "flex flex-col items-center" : "flex flex-row items-center"}`;
}

/** `core/Toolbar.Separator` with the rail's own margins; the rule's axis is across the rail. */
function separator(placement: ToolbarPlacement): JSXNode {
  const vertical = isVerticalPlacement(placement);
  return <CoreToolbar.Separator orientation={vertical ? "horizontal" : "vertical"} class={cn("shrink-0", vertical ? "my-1" : "mx-1")} />;
}

/** Activation attributes for an action item: native Invoker command or delegated scope event. */
function actionAttrs<A extends string, G extends string>(item: ToolbarAction<A, G>, commandTarget: string | undefined): Record<string, string> {
  return item.dispatch === "command" ? commandAttrs<A>(item.action, commandTarget ?? "") : scopeAttrs<A>({ onClick: item.action });
}

function renderItem<A extends string, G extends string>(item: ToolbarItem<A, G>, ctx: RenderCtx<G>): JSXNode {
  const { placement, icon: Icon } = ctx;
  if (item.kind === "separator") return separator(placement);

  if (item.kind === "slot") return item.slot;

  if (item.kind === "action") {
    const { icon, label, ref, data = {}, active, size = "md" } = item;
    return (
      <CoreToolbar.Button
        data-slot={slotToken("toolbar-action", data["data-slot"])}
        shape='icon'
        size={size}
        {...(active === undefined ? {} : { pressed: active })}
        data-ref={ref}
        title={label}
        aria-label={label}
        class={cn(active && "active")}
        {...actionAttrs(item, ctx.commandTarget)}
        {...data}>
        <Icon name={icon} viewBox='0 0 24 24' class='h-5 w-5' />
      </CoreToolbar.Button>
    );
  }

  const { icon, label, ref, content, compact, titleAction } = item;
  const id = `toolbar-flyout-${ctx.idBase}-${ctx.seq.n++}`;
  return (
    <div data-slot='toolbar-popover' class='relative flex w-full flex-col items-center'>
      <CoreToolbar.Button
        data-slot='toolbar-trigger'
        shape='icon'
        command='toggle-popover'
        commandfor={id}
        {...invokerAttrs(id)}
        data-ref={ref}
        title={label}
        aria-label={label}>
        <Icon name={icon} viewBox='0 0 24 24' class='h-5 w-5' />
      </CoreToolbar.Button>
      <div id={id} data-slot='toolbar-flyout' popover='auto' data-side={placement} data-compact={compact ? "" : undefined} class={FLYOUT_CLS}>
        <div data-slot='toolbar-flyout-title' class={cn(FLYOUT_TITLE_CLS, "flex items-center justify-between gap-2")}>
          <span>{label}</span>
          {/* Unmarked on purpose: roving focus queries the whole rail subtree, so a toolbar-item
              marker here would splice flyout buttons into the rail's arrow-key ring. */}
          {titleAction && (
            <Button
              data-slot='toolbar-title-action'
              data-ref={titleAction.ref}
              tone='neutral'
              appearance='ghost'
              shape='icon'
              size='sm'
              title={titleAction.label}
              aria-label={titleAction.label}
              {...scopeAttrs<A>({ onClick: titleAction.action })}>
              <Icon name={titleAction.icon} viewBox='0 0 24 24' class='h-4 w-4' />
            </Button>
          )}
        </div>
        <div data-slot='toolbar-flyout-body' class={FLYOUT_BODY_CLS}>
          {content}
        </div>
      </div>
    </div>
  );
}

function renderGroup<A extends string, G extends string>(group: ToolbarGroup<A, G>, ctx: RenderCtx<G>): JSXNode {
  const vertical = isVerticalPlacement(ctx.placement);
  return (
    <div data-slot='toolbar-group' class={cn("flex", vertical ? "w-full flex-col items-center gap-0.5" : "flex-row items-center gap-0.5")}>
      {group.items.map((item) => renderItem(item, ctx))}
    </div>
  );
}

/** A configuration-driven icon rail with placement-aware flyout panels. @public */
export const Toolbar = <A extends string = string, G extends string = string>({
  config,
  icon: Icon,
  placement = "left",
  commandTarget,
  class: cls,
  id,
  "data-slot": inherited,
  ...rest
}: ToolbarProps<A, G>): JSXElement => {
  const ctx: RenderCtx<G> = { placement, icon: Icon, commandTarget, idBase: id ?? placement, seq: { n: 0 } };
  const children: JSXNode[] = [];
  for (const [i, group] of config.groups.entries()) {
    if (i > 0) children.push(separator(placement));
    children.push(renderGroup(group, ctx));
  }

  const orientation = isVerticalPlacement(placement) ? "vertical" : "horizontal";

  return (
    <div
      id={id}
      role='toolbar'
      data-slot={slotToken("toolbar", inherited)}
      data-scope={TOOLBAR_SCOPE}
      {...stateAttrs({ orientation })}
      aria-orientation={orientation}
      class={cn(railClass(placement), cls)}
      {...rest}>
      {children}
    </div>
  );
};
