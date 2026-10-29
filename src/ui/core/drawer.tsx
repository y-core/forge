/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE, dialogAlertAttrs, dialogNameAttrs } from "../contracts/dialog-contract";
import { stateAttrs } from "../contracts/state-attrs";
import type { DialogAlertFlags, DialogNaming, PhysicalSide } from "../contracts/types";
import { createDialogParts } from "./dialog-parts";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { mergeIdRefs } from "./utils/id-refs";

type DrawerProps = DialogNaming & DrawerOwnProps;

interface DrawerOwnProps extends Omit<JSX.IntrinsicElements["dialog"], "children">, DialogAlertFlags {
  /** Element id — the `commandfor` target named by `Drawer.Trigger` / `Drawer.Close`. */
  id: string;
  /** Viewport edge the panel is anchored to; physical because a drawer must not mirror with direction. */
  side?: PhysicalSide | undefined;
  // The `open` attribute always yields a non-modal dialog — no backdrop, no inertness, no top layer
  // — and `showModal()` throws on one already open, so `openModal` suppresses `open` below.
  /** Render open and *non-modal* — no backdrop, the rest of the page stays interactive. */
  open?: boolean | undefined;
  /** Open as a modal on resume. Requires the client runtime; `showModal()` has no markup spelling. */
  openModal?: boolean | undefined;
  children?: JSXNode | undefined;
}

const DRAWER_BASE = "fixed z-40 m-0 flex-col border-field border-border bg-popover p-0 text-popover-foreground shadow-lg open:flex";

const DRAWER_AXIS: Record<PhysicalSide, string> = {
  left: "h-dvh max-h-none w-80 max-w-[85vw]",
  right: "h-dvh max-h-none w-80 max-w-[85vw]",
  top: "h-auto max-h-[85vh] w-full max-w-none",
  bottom: "h-auto max-h-[85vh] w-full max-w-none",
};

const DrawerRoot: FC<DrawerProps> = ({
  id,
  side = "left",
  label,
  labelledby,
  titled,
  alert = false,
  described = false,
  open,
  openModal,
  class: cls,
  children,
  "data-slot": inherited,
  "aria-describedby": describedBy,
  "aria-labelledby": ownLabelledBy,
  ...props
}) => {
  const alerting = dialogAlertAttrs(id, { alert, described });
  return (
    <dialog
      id={id}
      data-slot={slotToken("drawer", inherited)}
      role={alerting.role}
      {...dialogNameAttrs(id, { label, labelledby, titled })}
      aria-labelledby={mergeIdRefs(ownLabelledBy, [dialogNameAttrs(id, { label, labelledby, titled })["aria-labelledby"]])}
      aria-describedby={mergeIdRefs(describedBy, [alerting["aria-describedby"]])}
      {...(open && !openModal ? { open: true } : {})}
      {...(openModal ? { "data-scope": DIALOG_SCOPE, [DIALOG_OPEN_MODAL_ATTR]: "" } : {})}
      {...(open && !openModal ? {} : { closedby: alerting.closedby })}
      class={cn(DRAWER_BASE, DRAWER_AXIS[side], cls)}
      {...stateAttrs({ side })}
      {...props}>
      {children}
    </dialog>
  );
};

/** Edge-anchored modal panel built on the native `<dialog>` and Invoker Commands APIs. @public */
export const Drawer = Object.assign(DrawerRoot, createDialogParts("drawer", "min-h-0 flex-1 overflow-y-auto px-6 py-5"));
