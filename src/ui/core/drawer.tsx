/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { type PhysicalSide, stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

interface DrawerProps extends Omit<JSX.IntrinsicElements["dialog"], "children"> {
  /** Element id — the `commandfor` target named by `Drawer.Trigger` / `Drawer.Close`. */
  id: string;
  /** Viewport edge the panel is anchored to; physical because a drawer must not mirror with direction. */
  side?: PhysicalSide | undefined;
  /** Render open and *non-modal* — no backdrop, the rest of the page stays interactive. */
  open?: boolean | undefined;
  /** Open as a modal on resume. Requires the client runtime; `showModal()` has no markup spelling. */
  openModal?: boolean | undefined;
  children?: JSXNode | undefined;
}

type DrawerSectionProps = JSX.IntrinsicElements["div"];

interface DrawerTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Drawer` this button opens as a modal — its `commandfor` target. */
  for: string;
  children?: JSXNode | undefined;
}

interface DrawerCloseProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Drawer` this button closes — its `commandfor` target. */
  for: string;
  /** Run the cancelable close-request algorithm (`request-close`) instead of `close`. */
  request?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface DrawerTitleProps extends Omit<JSX.IntrinsicElements["h2"], "children" | "id"> {
  /** id of the `Drawer` this heading names — the root's `aria-labelledby` target is derived from it. */
  for: string;
  children?: JSXNode | undefined;
}

const DRAWER_BASE = "fixed m-0 flex flex-col border-field border-border bg-popover p-0 text-popover-foreground shadow-lg";

// The panel's own axis, not the caller's: the inline sides fill the block axis and the block sides
// fill the inline one, and a utility is the only spelling a caller's `w-96` can still beat.
const DRAWER_AXIS: Record<PhysicalSide, string> = {
  left: "h-dvh max-h-none w-80 max-w-[85vw]",
  right: "h-dvh max-h-none w-80 max-w-[85vw]",
  top: "h-auto max-h-[85vh] w-full max-w-none",
  bottom: "h-auto max-h-[85vh] w-full max-w-none",
};

const DrawerRoot: FC<DrawerProps> = ({ id, side = "left", open, openModal, class: cls, children, "data-slot": inherited, ...props }) => (
  <dialog
    id={id}
    data-slot={slotToken("drawer", inherited)}
    aria-labelledby={`${id}-title`}
    {...(open ? { open: true } : {})}
    {...(openModal ? { "data-scope": DIALOG_SCOPE, [DIALOG_OPEN_MODAL_ATTR]: "" } : {})}
    closedby='any'
    class={cn(DRAWER_BASE, DRAWER_AXIS[side], cls)}
    {...stateAttrs({ side })}
    {...props}>
    {children}
  </dialog>
);

const DrawerTrigger: FC<DrawerTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...props }) => {
  return (
    <button type='button' data-slot={slotToken("drawer-trigger", inherited)} command='show-modal' commandfor={target} class={cls} {...props}>
      {children}
    </button>
  );
};

const DrawerClose: FC<DrawerCloseProps> = ({ for: target, request = false, class: cls, children, "data-slot": inherited, ...props }) => {
  return (
    <button
      type='button'
      data-slot={slotToken("drawer-close", inherited)}
      command={request ? "request-close" : "close"}
      commandfor={target}
      class={cls}
      {...props}>
      {children}
    </button>
  );
};

// The root's `aria-labelledby` is derived from its required `id`, so the heading's id is derived the
// same way from the `for` the compound's other statics already take.
const DrawerTitle: FC<DrawerTitleProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
  <h2 data-slot={slotToken("drawer-title", inherited)} id={`${target}-title`} class={cn("text-base font-semibold", cls)} {...rest}>
    {children}
  </h2>
);

const DrawerHeader: FC<DrawerSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("drawer-header", inherited)} class={cn(PANEL_HEADER, cls)} {...rest}>
    {children}
  </div>
);

const DrawerContent: FC<DrawerSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("drawer-content", inherited)} class={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", cls)} {...rest}>
    {children}
  </div>
);

const DrawerFooter: FC<DrawerSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("drawer-footer", inherited)} class={cn(PANEL_FOOTER, cls)} {...rest}>
    {children}
  </div>
);

/** Edge-anchored modal panel built on the native `<dialog>` and Invoker Commands APIs. @public */
export const Drawer = Object.assign(DrawerRoot, {
  Trigger: DrawerTrigger,
  Close: DrawerClose,
  Title: DrawerTitle,
  Header: DrawerHeader,
  Content: DrawerContent,
  Footer: DrawerFooter,
});
