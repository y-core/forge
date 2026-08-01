/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import { asClass, cn } from "./utils/cn";

type TabsOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface TabsRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: TabsOrientation;
  /** Select a tab as soon as it receives focus. `manual` waits for Enter, Space or a click, which
   * suits panels that are expensive to render. @default "automatic" */
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

const TabsRoot: FC<TabsRootProps> = ({ orientation = "horizontal", activation = "automatic", class: cls, children, ...rest }) => (
  <div
    data-slot='tabs'
    data-scope={TABS_SCOPE}
    data-activation={activation}
    {...stateAttrs({ orientation })}
    class={cn("flex", orientation === "vertical" ? "flex-row gap-4" : "flex-col gap-3", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

const TabsList: FC<TabsListProps> = ({ orientation = "horizontal", class: cls, children, ...rest }) => (
  <div
    role='tablist'
    data-slot='tabs-list'
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

const Tab: FC<TabProps> = ({ for: panelId, selected = false, class: cls, children, ...rest }) => (
  <button
    type='button'
    role='tab'
    data-slot='tab'
    aria-selected={String(selected) as "true" | "false"}
    aria-controls={panelId}
    {...stateAttrs({ selected })}
    class={cn(TAB_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/** `hidden` on an unselected panel is the platform's own mechanism — no JS is needed to make the
 * initial render correct, and the controller flips the same attribute. */
const TabsPanel: FC<TabsPanelProps> = ({ id, selected = false, class: cls, children, ...rest }) => (
  <div
    id={id}
    role='tabpanel'
    data-slot='tabs-panel'
    tabindex={0}
    {...(selected ? {} : { hidden: true })}
    {...stateAttrs({ selected })}
    class={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/**
 * Compound tabs. The list is a single Tab stop with arrow-key navigation from `mountRovingFocus`;
 * selection follows focus unless `activation="manual"`.
 *
 * ```tsx
 * <Tabs>
 *   <Tabs.List>
 *     <Tabs.Tab for='panel-a' selected>A</Tabs.Tab>
 *     <Tabs.Tab for='panel-b'>B</Tabs.Tab>
 *   </Tabs.List>
 *   <Tabs.Panel id='panel-a' selected>…</Tabs.Panel>
 *   <Tabs.Panel id='panel-b'>…</Tabs.Panel>
 * </Tabs>
 * ```
 *
 * Keyboard behaviour arrives with the `ui/core/client` side-effect import.
 * @public
 */
export const Tabs = Object.assign(TabsRoot, { List: TabsList, Tab, Panel: TabsPanel });
