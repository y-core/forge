/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE, dialogAlertAttrs, dialogNameAttrs } from "../contracts/dialog-contract";
import type { DialogAlertFlags, DialogNaming } from "../contracts/types";
import { createDialogParts } from "./dialog-parts";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { mergeIdRefs } from "./utils/id-refs";

type DialogProps = DialogNaming & DialogOwnProps;

interface DialogOwnProps extends Omit<JSX.IntrinsicElements["dialog"], "children">, DialogAlertFlags {
  /** Element id — the `commandfor` target named by `Dialog.Trigger` / `Dialog.Close`. */
  id: string;
  // The `open` attribute always yields a non-modal dialog — no backdrop, no inertness, no top layer
  // — and `showModal()` throws on one already open, so `openModal` suppresses `open` below.
  /** Render open and *non-modal* — no backdrop, the rest of the page stays interactive. */
  open?: boolean | undefined;
  /** Open as a modal on resume. Requires the client runtime; `showModal()` has no markup spelling. */
  openModal?: boolean | undefined;
  children?: JSXNode | undefined;
}

const DialogRoot: FC<DialogProps> = ({
  id,
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
      data-slot={slotToken("dialog", inherited)}
      role={alerting.role}
      {...dialogNameAttrs(id, { label, labelledby, titled })}
      aria-labelledby={mergeIdRefs(ownLabelledBy, [dialogNameAttrs(id, { label, labelledby, titled })["aria-labelledby"]])}
      aria-describedby={mergeIdRefs(describedBy, [alerting["aria-describedby"]])}
      {...(open && !openModal ? { open: true } : {})}
      {...(openModal ? { "data-scope": DIALOG_SCOPE, [DIALOG_OPEN_MODAL_ATTR]: "" } : {})}
      {...(open && !openModal ? {} : { closedby: alerting.closedby })}
      class={cn("rounded-box border-field border-border bg-popover text-popover-foreground shadow-lg", cls)}
      {...props}>
      {children}
    </dialog>
  );
};

/** Compound modal dialog built on the native `<dialog>` and Invoker Commands APIs. @public */
export const Dialog = Object.assign(DialogRoot, createDialogParts("dialog", "px-6 py-5"));
