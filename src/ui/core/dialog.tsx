/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

interface DialogProps extends Omit<JSX.IntrinsicElements["dialog"], "children"> {
  /** Element id — the `commandfor` target named by `Dialog.Trigger` / `Dialog.Close`. */
  id: string;
  children?: JSXNode;
}

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

const DialogRoot: FC<DialogProps> = ({ id, class: cls, children, ...props }) => (
  <dialog
    id={id}
    data-slot='dialog'
    class={cn("rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-lg", asClass(cls))}
    {...props}>
    {children}
  </dialog>
);

const DialogTrigger: FC<DialogTriggerProps> = ({ for: target, class: cls, children, ...props }) => {
  const className = asClass(cls);
  return (
    <button
      type='button'
      data-slot='dialog-trigger'
      command='show-modal'
      commandfor={target}
      {...(className ? { class: className } : {})}
      {...props}>
      {children}
    </button>
  );
};

const DialogClose: FC<DialogCloseProps> = ({ for: target, request = false, class: cls, children, ...props }) => {
  const className = asClass(cls);
  return (
    <button
      type='button'
      data-slot='dialog-close'
      command={request ? "request-close" : "close"}
      commandfor={target}
      {...(className ? { class: className } : {})}
      {...props}>
      {children}
    </button>
  );
};

/**
 * Compound modal dialog built on the native `<dialog>` + Invoker Commands APIs. `Dialog.Trigger`
 * emits `command="show-modal"` and `Dialog.Close` emits `command="close"` (or `"request-close"`
 * with `request`); the shared id links each button's `commandfor` to the dialog. Top-layer
 * rendering, the `::backdrop`, focus trapping, and Esc-to-cancel are handled by the platform.
 *
 * ```tsx
 * <>
 *   <Dialog.Trigger for="confirm">Delete…</Dialog.Trigger>
 *   <Dialog id="confirm">
 *     …
 *     <Dialog.Close for="confirm">Cancel</Dialog.Close>
 *   </Dialog>
 * </>
 * ```
 *
 * @public
 */
export const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger, Close: DialogClose });
