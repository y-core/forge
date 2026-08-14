/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type TabsOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface TabsRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: TabsOrientation;
  /** Select a tab as soon as it receives focus; `manual` waits for Enter, Space or a click. @default "automatic" */
  activation?: "automatic" | "manual";
  children?: JSXNode;
}

interface TabsListProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: TabsOrientation;
  children?: JSXNode;
}

interface TabProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Tabs.Panel` this tab controls. */
  for: string;
  selected?: boolean;
  children?: JSXNode;
}

interface TabsPanelProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  id: string;
  selected?: boolean;
  children?: JSXNode;
}

const TabsRoot: FC<TabsRootProps> = ({
  orientation = "horizontal",
  activation = "automatic",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <div
    data-slot={slotToken("tabs", inherited)}
    data-scope={TABS_SCOPE}
    data-activation={activation}
    {...stateAttrs({ orientation })}
    class={cn("flex", orientation === "vertical" ? "flex-row gap-4" : "flex-col gap-3", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

const TabsList: FC<TabsListProps> = ({ orientation = "horizontal", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    role='tablist'
    data-slot={slotToken("tabs-list", inherited)}
    aria-orientation={orientation}
    {...stateAttrs({ orientation })}
    class={cn("flex gap-1", orientation === "vertical" ? "flex-col border-r border-border pr-2" : "border-b border-border pb-1", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

const TAB_BASE =
  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground bg-transparent border-0 cursor-pointer outline-none " +
  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-selected:bg-accent aria-selected:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

const Tab: FC<TabProps> = ({ for: panelId, selected = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='tab'
    data-slot={slotToken("tab", inherited)}
    aria-selected={selected}
    aria-controls={panelId}
    {...stateAttrs({ selected })}
    {...(selected ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {})}
    class={cn(TAB_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

const TabsPanel: FC<TabsPanelProps> = ({ id, selected = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    id={id}
    role='tabpanel'
    data-slot={slotToken("tabs-panel", inherited)}
    tabindex={0}
    {...(selected ? {} : { hidden: true })}
    {...stateAttrs({ selected })}
    class={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/** Compound tabs whose list is a single Tab stop with arrow-key navigation, selection following focus unless `activation="manual"`. @public */
export const Tabs = Object.assign(TabsRoot, { List: TabsList, Tab, Panel: TabsPanel });
