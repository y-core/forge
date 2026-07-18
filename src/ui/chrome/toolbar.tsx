/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { Button } from "../core/button";
import type { ForgeIcon } from "../core/icon";
import { asClass, cn } from "../core/utils/cn";
import { cva } from "../core/utils/cva";
import { commandAttrs } from "../server/command-attrs";
import { scopeAttrs } from "../server/scope-attrs";

/** Root rail item that fires a delegated action immediately on click. @public */
export interface ToolbarAction<A extends string = string> {
  kind: "action";
  /** Sprite glyph name, rendered via the bound `icon`. */
  icon: string;
  /** Tooltip / aria-label. */
  label: string;
  /** Action name dispatched on click — into an ancestor scope (`data-on-click`) or, with
   * `dispatch:"command"`, through the native Invoker `CommandEvent` bridge (`--action`). */
  action: A;
  /** How the action reaches a handler. `"scope"` (default) emits `data-on-click`; `"command"`
   * emits `command="--action"` targeting the toolbar's `commandTarget`. Both hit the same `on` table. */
  dispatch?: "scope" | "command";
  /** data-ref (test/parity hook). */
  ref?: string;
  /** Extra data-* attributes (e.g. `{ "data-tool": "line" }`). */
  data?: Record<string, string>;
  /** Stamps class="active" at SSR for boot highlight. */
  active?: boolean;
  /** Forge Button size; default "icon". */
  size?: "icon" | "icon-sm";
}

/** An action button rendered inline on a popover's flyout title row. @public */
export interface ToolbarTitleAction<A extends string = string> {
  /** App sprite glyph, rendered via the bound `icon`. */
  icon: string;
  /** Tooltip + aria-label. */
  label: string;
  /** Delegated action dispatched on click (bubbles to an ancestor scope). */
  action: A;
  /** data-ref (test/parity hook). */
  ref?: string;
}

/** Root rail item that opens a placement-aware flyout of arbitrary content. @public */
export interface ToolbarPopover<A extends string = string> {
  kind: "popover";
  /** Sprite glyph name for the trigger icon. */
  icon: string;
  /** Trigger aria-label + flyout title-chip text. */
  label: string;
  /** data-ref on the trigger button. */
  ref?: string;
  /** The app's control primitives rendered inside the flyout body. */
  content: JSXNode;
  /** Shrink flyout to content width (no min-w-52 floor). */
  compact?: boolean;
  /** Optional action button stamped inline on the flyout title row. */
  titleAction?: ToolbarTitleAction<A>;
}

/** @public */
export interface ToolbarSeparator {
  kind: "separator";
}

/** @public */
export interface ToolbarSlot {
  kind: "slot";
  slot: JSXNode;
}

/** @public */
export type ToolbarItem<A extends string = string> = ToolbarAction<A> | ToolbarPopover<A> | ToolbarSeparator | ToolbarSlot;

/** A cluster of items; a separator is auto-emitted between sibling groups. @public */
export interface ToolbarGroup<A extends string = string> {
  items: ToolbarItem<A>[];
}

/** Full toolbar configuration. @public */
export interface ToolbarDefinition<A extends string = string> {
  groups: ToolbarGroup<A>[];
}

/** Edge the rail pins to; drives flex direction + flyout direction. @public */
export type ToolbarPlacement = "left" | "right" | "top" | "bottom";

/**
 * Props for {@link Toolbar}. Extends `<nav>` attributes minus `children`,
 * since the tree is built from `config`.
 * @public
 */
export interface ToolbarProps<A extends string = string> extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  config: ToolbarDefinition<A>;
  /** App sprite icon — glyph names are app-defined. Required. */
  icon: ForgeIcon<string>;
  /** Edge the rail pins to. Default `"left"`. */
  placement?: ToolbarPlacement;
  /** `commandfor` sink (element id, bare or `#id`) for actions with `dispatch:"command"`. */
  commandTarget?: string;
  /** Optional DOM id for the rail. Also namespaces the generated flyout ids; supply a distinct
   * value when two rails share the same `placement`, otherwise `placement` disambiguates them. */
  id?: string;
  /** Extra classes merged onto the root element. */
  class?: string;
}

/** Threaded through the item renderers: bound icon, placement, a per-render popover-id counter,
 * the id namespace that keeps flyout ids unique across multiple rails on one page, and the
 * optional `commandfor` sink for command-dispatch actions. */
interface RenderCtx {
  placement: ToolbarPlacement;
  icon: ForgeIcon<string>;
  commandTarget: string | undefined;
  /** Namespace prefix for generated flyout ids — the rail's `id` when given, else its placement.
   * Two rails on a page must not both mint `toolbar-flyout-0`, or their `commandfor` links would
   * collide and a trigger would toggle the wrong (first-in-document) flyout. */
  idBase: string;
  seq: { n: number };
}

const railVariants = cva({
  base: "group",
  variants: {
    placement: {
      left: "flex flex-col items-center",
      right: "flex flex-col items-center",
      top: "flex flex-row items-center",
      bottom: "flex flex-row items-center",
    },
  },
  defaultVariants: { placement: "left" },
});

const TRIGGER_CLS =
  "list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";
const FLYOUT_CLS = "min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md";
const FLYOUT_TITLE_CLS = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5";
const FLYOUT_BODY_CLS = "flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto";

function isVerticalPlacement(placement: ToolbarPlacement): boolean {
  return placement === "left" || placement === "right";
}

function separatorNode(placement: ToolbarPlacement): JSXNode {
  return <div data-slot='toolbar-separator' class={cn("bg-border shrink-0", isVerticalPlacement(placement) ? "w-6 h-px my-1" : "h-6 w-px mx-1")} />;
}

/** Activation attributes for an action item: native Invoker command or delegated scope event. */
function actionAttrs<A extends string>(item: ToolbarAction<A>, commandTarget: string | undefined): Record<string, string> {
  return item.dispatch === "command" ? commandAttrs<A>(item.action, commandTarget ?? "") : scopeAttrs<A>({ onClick: item.action });
}

function renderItem<A extends string>(item: ToolbarItem<A>, ctx: RenderCtx): JSXNode {
  const { placement, icon: Icon } = ctx;
  if (item.kind === "separator") return separatorNode(placement);

  if (item.kind === "slot") return item.slot;

  if (item.kind === "action") {
    const { icon, label, ref, data = {}, active, size = "icon" } = item;
    return (
      <Button
        data-slot='toolbar-action'
        variant='ghost'
        size={size}
        data-ref={ref}
        title={label}
        aria-label={label}
        class={cn(active && "active")}
        {...actionAttrs(item, ctx.commandTarget)}
        {...data}>
        <Icon name={icon} viewBox='0 0 24 24' class='w-5 h-5' />
      </Button>
    );
  }

  // popover — a native top-layer flyout toggled by its trigger button
  const { icon, label, ref, content, compact, titleAction } = item;
  const id = `toolbar-flyout-${ctx.idBase}-${ctx.seq.n++}`;
  return (
    <div data-slot='toolbar-popover' class='relative flex flex-col items-center w-full'>
      <button
        type='button'
        data-slot='toolbar-trigger'
        command='toggle-popover'
        commandfor={id}
        data-ref={ref}
        class={TRIGGER_CLS}
        title={label}
        aria-label={label}>
        <Icon name={icon} viewBox='0 0 24 24' class='w-5 h-5' />
      </button>
      <div id={id} data-slot='toolbar-flyout' popover='auto' data-placement={placement} data-compact={compact ? "" : undefined} class={FLYOUT_CLS}>
        <div data-slot='toolbar-flyout-title' class={cn(FLYOUT_TITLE_CLS, "flex items-center justify-between gap-2")}>
          <span>{label}</span>
          {titleAction && (
            <Button
              data-slot='toolbar-title-action'
              data-ref={titleAction.ref}
              variant='ghost'
              size='icon-sm'
              title={titleAction.label}
              aria-label={titleAction.label}
              {...scopeAttrs<A>({ onClick: titleAction.action })}>
              <Icon name={titleAction.icon} viewBox='0 0 24 24' class='w-4 h-4' />
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

function renderGroup<A extends string>(group: ToolbarGroup<A>, ctx: RenderCtx): JSXNode {
  const vertical = isVerticalPlacement(ctx.placement);
  return (
    <div data-slot='toolbar-group' class={cn("flex", vertical ? "flex-col items-center gap-0.5 w-full" : "flex-row items-center gap-0.5")}>
      {group.items.map((item) => renderItem(item, ctx))}
    </div>
  );
}

/**
 * A configuration-driven icon rail with placement-aware flyout panels. Action items fire a
 * delegated scope event (or a native Invoker command with `dispatch:"command"`) on click; popover
 * items open natively via the Popover API (`popover="auto"`) for top-layer stacking, exclusive
 * open, and light-dismiss — zero JavaScript for open/close.
 *
 * Feed a {@link ToolbarDefinition} and an `icon` prop (the app sprite binding). The `placement`
 * drives flex direction and flyout position (the flyout is anchored to its trigger via CSS).
 *
 * @public
 */
export const Toolbar: FC<ToolbarProps> = ({ config, icon: Icon, placement = "left", commandTarget, class: cls, id, ...rest }) => {
  const ctx: RenderCtx = { placement, icon: Icon, commandTarget, idBase: id ?? placement, seq: { n: 0 } };
  const children: JSXNode[] = [];
  for (const [i, group] of config.groups.entries()) {
    if (i > 0) children.push(separatorNode(placement));
    children.push(renderGroup(group, ctx));
  }

  return (
    <nav {...(id === undefined ? {} : { id })} data-slot='toolbar' class={cn(railVariants({ placement }), asClass(cls))} {...rest}>
      {children}
    </nav>
  );
};
