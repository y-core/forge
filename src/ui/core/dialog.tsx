/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE, dialogNameAttrs } from "../contracts/dialog-contract";
import { descriptionId, titleId } from "../contracts/naming";
import type { DialogNaming } from "../contracts/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

type DialogProps = DialogNaming & DialogOwnProps;

interface DialogOwnProps extends Omit<JSX.IntrinsicElements["dialog"], "children"> {
  /** Element id — the `commandfor` target named by `Dialog.Trigger` / `Dialog.Close`. */
  id: string;
  // The `open` attribute always yields a non-modal dialog — no backdrop, no inertness, no top layer
  // — and `showModal()` throws on one already open, so `openModal` suppresses `open` below.
  /** Render open and *non-modal* — no backdrop, the rest of the page stays interactive. */
  open?: boolean | undefined;
  /** Open as a modal on resume. Requires the client runtime; `showModal()` has no markup spelling. */
  openModal?: boolean | undefined;
  /** Announce as an alert dialog — a message interrupting the reader's work, which APG asks be described. */
  alert?: boolean | undefined;
  /** This root renders a `.Description` whose `for` is its own id, and points `aria-describedby` at it. */
  described?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface DialogDescriptionProps extends Omit<JSX.IntrinsicElements["p"], "children" | "id"> {
  /** id of the `Dialog` this message describes — the root's `aria-describedby` target is derived from it. */
  for: string;
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
  /** Heading level, from where the dialog sits in the document; the class is fixed. Defaults to `2`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
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
  ...props
}) => (
  <dialog
    id={id}
    data-slot={slotToken("dialog", inherited)}
    {...(alert ? { role: "alertdialog" } : {})}
    {...dialogNameAttrs(id, { label, labelledby, titled })}
    // Emitted on the caller's word, exactly as the title reference is: a description that resolves to
    // nothing suppresses `aria-description` and `title` rather than merely being ignored.
    {...(described ? { "aria-describedby": descriptionId(id) } : {})}
    {...(open && !openModal ? { open: true } : {})}
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

const DialogTitle: FC<DialogTitleProps> = ({ for: target, level, class: cls, children, "data-slot": inherited, ...rest }) => {
  const Heading = `h${level ?? 2}` as "h2";
  return (
    <Heading data-slot={slotToken("dialog-title", inherited)} id={titleId(target)} class={cn("text-base font-semibold", cls)} {...rest}>
      {children}
    </Heading>
  );
};

const DialogDescription: FC<DialogDescriptionProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
  <p data-slot={slotToken("dialog-description", inherited)} id={descriptionId(target)} class={cn("text-sm text-muted-foreground", cls)} {...rest}>
    {children}
  </p>
);

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
  Description: DialogDescription,
  Header: DialogHeader,
  Content: DialogContent,
  Footer: DialogFooter,
});
