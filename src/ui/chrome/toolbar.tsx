/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { Button } from "../core/button";
import type { ForgeIcon } from "../core/icon";
import { asClass, cn } from "../core/utils/cn";
import { cva } from "../core/utils/cva";
import { Resumable } from "../server/resumable";
import { scopeAttrs } from "../server/scope-attrs";

/** Root rail item that fires a delegated action immediately on click. @public */
export interface ToolbarAction<A extends string = string> {
  kind: "action";
  /** Sprite glyph name, rendered via the bound `icon`. */
  icon: string;
  /** Tooltip / aria-label. */
  label: string;
  /** Delegated action dispatched on click (bubbles to an ancestor scope). */
  action: A;
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
  /** data-ref on the `<summary>` trigger. */
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
  /** `<details name>` group for exclusive-open; default `"toolbar-flyouts"`. */
  flyoutGroup?: string;
  /** Extra classes merged onto the root element. */
  class?: string;
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

const flyoutVariants = cva({
  base: "absolute top-0 z-10 p-2 pb-2.5 min-w-52 rounded-xl border border-border bg-popover text-popover-foreground shadow-md",
  variants: { placement: { left: "left-full ml-2", right: "right-full mr-2", top: "top-full left-0 mt-2", bottom: "bottom-full left-0 mb-2" } },
  defaultVariants: { placement: "left" },
});

const TRIGGER_CLS =
  "list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring group-open/popover:bg-primary group-open/popover:text-primary-foreground";
const FLYOUT_TITLE_CLS = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5";
const FLYOUT_BODY_CLS = "flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto";

function isVerticalPlacement(placement: ToolbarPlacement): boolean {
  return placement === "left" || placement === "right";
}

function separatorNode(placement: ToolbarPlacement): JSXNode {
  return <div data-slot='toolbar-separator' class={cn("bg-border shrink-0", isVerticalPlacement(placement) ? "w-6 h-px my-1" : "h-6 w-px mx-1")} />;
}

function renderItem<A extends string>(item: ToolbarItem<A>, placement: ToolbarPlacement, flyoutGroup: string, Icon: ForgeIcon<string>): JSXNode {
  if (item.kind === "separator") return separatorNode(placement);

  if (item.kind === "slot") return item.slot;

  if (item.kind === "action") {
    const { icon, label, action, ref, data = {}, active, size = "icon" } = item;
    return (
      <Button
        data-slot='toolbar-action'
        variant='ghost'
        size={size}
        data-ref={ref}
        title={label}
        aria-label={label}
        class={cn(active && "active")}
        {...scopeAttrs<A>({ onClick: action })}
        {...data}>
        <Icon name={icon} viewBox='0 0 24 24' class='w-5 h-5' />
      </Button>
    );
  }

  // popover
  const { icon, label, ref, content, compact, titleAction } = item;
  return (
    <details data-slot='toolbar-popover' name={flyoutGroup} class='group/popover relative flex flex-col items-center w-full'>
      <summary data-slot='toolbar-trigger' data-ref={ref} class={TRIGGER_CLS} title={label} aria-label={label}>
        <Icon name={icon} viewBox='0 0 24 24' class='w-5 h-5' />
      </summary>
      <div data-slot='toolbar-flyout' data-compact={compact ? "" : undefined} class={flyoutVariants({ placement })}>
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
    </details>
  );
}

function renderGroup<A extends string>(group: ToolbarGroup<A>, placement: ToolbarPlacement, flyoutGroup: string, Icon: ForgeIcon<string>): JSXNode {
  const vertical = isVerticalPlacement(placement);
  return (
    <div data-slot='toolbar-group' class={cn("flex", vertical ? "flex-col items-center gap-0.5 w-full" : "flex-row items-center gap-0.5")}>
      {group.items.map((item) => renderItem(item, placement, flyoutGroup, Icon))}
    </div>
  );
}

/**
 * A configuration-driven icon rail with placement-aware flyout panels.
 * Action items fire a delegated scope event on click; popover items open
 * natively via `<details name>` for exclusive open and outside-click-close
 * (handled by the `toolbar` resumable scope). Zero JavaScript for open/close.
 *
 * Feed a {@link ToolbarDefinition} and an `icon` prop (the app sprite binding).
 * The `placement` drives flex direction and flyout position.
 *
 * @public
 */
export const Toolbar: FC<ToolbarProps> = ({ config, icon: Icon, placement = "left", flyoutGroup = "toolbar-flyouts", class: cls, ...rest }) => {
  const children: JSXNode[] = [];
  for (const [i, group] of config.groups.entries()) {
    if (i > 0) children.push(separatorNode(placement));
    children.push(renderGroup(group, placement, flyoutGroup, Icon));
  }

  return (
    <Resumable name='toolbar'>
      <nav data-slot='toolbar' class={cn(railVariants({ placement }), asClass(cls))} {...rest}>
        {children}
      </nav>
    </Resumable>
  );
};
