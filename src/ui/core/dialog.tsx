/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { DIALOG_SCOPE } from "../contracts/overlay-contract";
import { stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface DialogProps extends Omit<JSX.IntrinsicElements["dialog"], "children"> {
  /** Element id — the `commandfor` target named by `Dialog.Trigger` / `Dialog.Close`. */
  id: string;
  children?: JSXNode;
}

type DialogSectionProps = JSX.IntrinsicElements["div"];

interface DialogTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Dialog` this button opens as a modal — its `commandfor` target. */
  for: string;
  children?: JSXNode;
}

interface DialogCloseProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Dialog` this button closes — its `commandfor` target. */
  for: string;
  /** Run the cancelable close-request algorithm (`request-close`) instead of `close`. */
  request?: boolean;
  children?: JSXNode;
}

const DialogRoot: FC<DialogProps> = ({ id, open, class: cls, children, "data-slot": inherited, ...props }) => (
  <dialog
    id={id}
    data-slot={slotToken("dialog", inherited)}
    data-scope={DIALOG_SCOPE}
    {...(open ? { open } : {})}
    {...stateAttrs({ open: open === true })}
    class={cn("rounded-xl border border-border bg-popover text-popover-foreground shadow-lg", asClass(cls))}
    {...props}>
    {children}
  </dialog>
);

const DialogTrigger: FC<DialogTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...props }) => {
  const className = asClass(cls);
  return (
    <button
      type='button'
      data-slot={slotToken("dialog-trigger", inherited)}
      command='show-modal'
      commandfor={target}
      {...(className ? { class: className } : {})}
      {...props}>
      {children}
    </button>
  );
};

const DialogClose: FC<DialogCloseProps> = ({ for: target, request = false, class: cls, children, "data-slot": inherited, ...props }) => {
  const className = asClass(cls);
  return (
    <button
      type='button'
      data-slot={slotToken("dialog-close", inherited)}
      command={request ? "request-close" : "close"}
      commandfor={target}
      {...(className ? { class: className } : {})}
      {...props}>
      {children}
    </button>
  );
};

const DialogHeader: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("dialog-header", inherited)}
    class={cn("grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5", cls)}
    {...rest}>
    {children}
  </div>
);

const DialogBody: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("dialog-body", inherited)} class={cn("px-6 py-5", cls)} {...rest}>
    {children}
  </div>
);

const DialogFooter: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("dialog-footer", inherited)} class={cn("flex items-center gap-2 border-t border-border px-6 py-4", cls)} {...rest}>
    {children}
  </div>
);

/** Compound modal dialog built on the native `<dialog>` and Invoker Commands APIs. @public */
export const Dialog = Object.assign(DialogRoot, {
  Trigger: DialogTrigger,
  Close: DialogClose,
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
});
