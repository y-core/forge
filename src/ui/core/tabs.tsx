/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { stateAttrs } from "../contracts/state-attrs";
import { TABS_SCOPE } from "../contracts/tabs-contract";
import type { Orientation } from "../contracts/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface TabsRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: Orientation | undefined;
  /** Select a tab as soon as it receives focus; `manual` waits for Enter, Space or a click. @default "automatic" */
  activation?: "automatic" | "manual" | undefined;
  children?: JSXNode | undefined;
}

interface TabsListProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: Orientation | undefined;
  children?: JSXNode | undefined;
}

interface TabProps extends Omit<JSX.IntrinsicElements["a"], "children" | "href"> {
  /** id of the `Tabs.Content` this tab controls; also the fragment its `href` navigates to. */
  for: string;
  selected?: boolean | undefined;
  /** Keeps the tab in the navigation ring but inert, as `aria-disabled` does — an anchor has no `disabled`. */
  disabled?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface TabsContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  id: string;
  selected?: boolean | undefined;
  children?: JSXNode | undefined;
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
    class={cn("flex", orientation === "vertical" ? "flex-row gap-4" : "flex-col gap-3", cls)}
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
    class={cn("flex gap-1", orientation === "vertical" ? "flex-col border-e border-border pe-2" : "border-b border-border pb-1", cls)}
    {...rest}>
    {children}
  </div>
);

const TAB_BASE = cn(
  "cursor-pointer rounded-field border-0 bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground no-underline " +
    "focus-ring hover:text-foreground " +
    "state-disabled aria-selected:bg-accent aria-selected:text-accent-foreground",
);

// An `<a href="#panel">`, not a `<button>`: the fragment is what makes a tab set operable with no
// script at all — the browser navigates, and the `:target` rules in `forge-ui.css` reveal the panel.
// `mountTabs` then intercepts the click and takes over, so the fragment is a fallback and not the
// mechanism.
const Tab: FC<TabProps> = ({ for: panelId, selected = false, disabled = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <a
    // A disabled tab renders no `href`: with the controller absent, the `:target` fallback in
    // `forge-ui.css` would reveal its panel and hide the selected one, so the prop's promise held
    // only once `data-tabs-mounted` was stamped.
    {...(disabled ? {} : { href: `#${panelId}` })}
    role='tab'
    data-slot={slotToken("tab", inherited)}
    aria-selected={selected}
    aria-controls={panelId}
    {...(disabled ? { "aria-disabled": "true" } : {})}
    {...stateAttrs({ selected, disabled })}
    {...(selected ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {})}
    class={cn(TAB_BASE, cls)}
    {...rest}>
    {children}
  </a>
);

const TabsContent: FC<TabsContentProps> = ({ id, selected = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    id={id}
    role='tabpanel'
    data-slot={slotToken("tabs-content", inherited)}
    tabindex={0}
    {...(selected ? {} : { hidden: true })}
    {...stateAttrs({ selected })}
    class={cn("focus-ring", cls)}
    {...rest}>
    {children}
  </div>
);

/** Compound tabs whose list is a single Tab stop with arrow-key navigation, selection following focus unless `activation="manual"`. @public */
export const Tabs = Object.assign(TabsRoot, { List: TabsList, Tab, Content: TabsContent });
