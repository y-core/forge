/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

interface DialogProps extends Omit<JSX.IntrinsicElements["dialog"], "children"> {
  /** Element id — the `commandfor` target named by `Dialog.Trigger` / `Dialog.Close`. */
  id: string;
  // `open` and `openModal` are separate props because the platform gives them separate meanings that
  // markup alone cannot express: the `open` attribute always yields a *non-modal* dialog — no
  // backdrop, no inertness, no top layer — while `Dialog.Trigger`'s `show-modal` command yields a
  // modal one. Rendering `openModal` as `open` was the divergence: the CSS above styles a backdrop
  // that a non-modal dialog never gets.
  /** Render open and *non-modal* — no backdrop, the rest of the page stays interactive. */
  open?: boolean | undefined;
  /** Open as a modal on resume. Requires the client runtime; `showModal()` has no markup spelling. */
  openModal?: boolean | undefined;
  children?: JSXNode | undefined;
}

type DialogSectionProps = JSX.IntrinsicElements["div"];

interface DialogTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Dialog` this button opens as a modal — its `commandfor` target. */
  for: string;
  children?: JSXNode | undefined;
}

interface DialogCloseProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Dialog` this button closes — its `commandfor` target. */
  for: string;
  /** Run the cancelable close-request algorithm (`request-close`) instead of `close`. */
  request?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface DialogTitleProps extends Omit<JSX.IntrinsicElements["h2"], "children" | "id"> {
  /** id of the `Dialog` this heading names — the root's `aria-labelledby` target is derived from it. */
  for: string;
  /** Heading level, from where the dialog sits in the document. Never from its size — the class is
   *  fixed, so a level change is a semantic one. Defaults to `2`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  children?: JSXNode | undefined;
}

const DialogRoot: FC<DialogProps> = ({ id, open, openModal, class: cls, children, "data-slot": inherited, ...props }) => (
  <dialog
    id={id}
    data-slot={slotToken("dialog", inherited)}
    aria-labelledby={`${id}-title`}
    {...(open ? { open: true } : {})}
    {...(openModal ? { "data-scope": DIALOG_SCOPE, [DIALOG_OPEN_MODAL_ATTR]: "" } : {})}
    closedby='any'
    class={cn("rounded-box border border-border bg-popover text-popover-foreground shadow-lg", cls)}
    {...props}>
    {children}
  </dialog>
);

const DialogTrigger: FC<DialogTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...props }) => {
  return (
    <button type='button' data-slot={slotToken("dialog-trigger", inherited)} command='show-modal' commandfor={target} class={cls} {...props}>
      {children}
    </button>
  );
};

const DialogClose: FC<DialogCloseProps> = ({ for: target, request = false, class: cls, children, "data-slot": inherited, ...props }) => {
  return (
    <button
      type='button'
      data-slot={slotToken("dialog-close", inherited)}
      command={request ? "request-close" : "close"}
      commandfor={target}
      class={cls}
      {...props}>
      {children}
    </button>
  );
};

// The root's `aria-labelledby` is derived from its required `id`, so the heading's id is derived the
// same way from the `for` the compound's other statics already take — one written id per dialog, and
// no context to prop-drill.
const DialogTitle: FC<DialogTitleProps> = ({ for: target, level, class: cls, children, "data-slot": inherited, ...rest }) => {
  const Heading = `h${level ?? 2}` as "h2";
  return (
    <Heading data-slot={slotToken("dialog-title", inherited)} id={`${target}-title`} class={cn("text-base font-semibold", cls)} {...rest}>
      {children}
    </Heading>
  );
};

const DialogHeader: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("dialog-header", inherited)} class={cn(PANEL_HEADER, cls)} {...rest}>
    {children}
  </div>
);

const DialogContent: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("dialog-content", inherited)} class={cn("px-6 py-5", cls)} {...rest}>
    {children}
  </div>
);

const DialogFooter: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("dialog-footer", inherited)} class={cn(PANEL_FOOTER, cls)} {...rest}>
    {children}
  </div>
);

/** Compound modal dialog built on the native `<dialog>` and Invoker Commands APIs. @public */
export const Dialog = Object.assign(DialogRoot, {
  Trigger: DialogTrigger,
  Close: DialogClose,
  Title: DialogTitle,
  Header: DialogHeader,
  Content: DialogContent,
  Footer: DialogFooter,
});
