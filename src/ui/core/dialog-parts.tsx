/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import { descriptionId, titleId } from "../contracts/naming";
import { buttonBox } from "./button";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

interface DialogDescriptionProps extends Omit<JSX.IntrinsicElements["p"], "children" | "id"> {
  /** id of the `<dialog>` root this message describes — the root's `aria-describedby` target is derived from it. */
  for: string;
  children?: JSXNode | undefined;
}

type DialogSectionProps = JSX.IntrinsicElements["div"];

interface DialogTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `<dialog>` root this button opens as a modal — its `commandfor` target. */
  for: string;
  children?: JSXNode | undefined;
}

interface DialogCloseProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `<dialog>` root this button closes — its `commandfor` target. */
  for: string;
  /** Run the cancelable close-request algorithm (`request-close`) instead of `close`. */
  request?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface DialogTitleProps extends Omit<JSX.IntrinsicElements["h2"], "children" | "id"> {
  /** id of the `<dialog>` root this heading names — the root's `aria-labelledby` target is derived from it. */
  for: string;
  /** Heading level, from where the root sits in the document; the class is fixed. Defaults to `2`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  children?: JSXNode | undefined;
}

/** The Trigger, Close, Title, Description, Header, Content and Footer a `<dialog>` compound names by its slot prefix. @internal */
export function createDialogParts(
  prefix: "dialog" | "drawer",
  contentClass: string,
): {
  Trigger: FC<DialogTriggerProps>;
  Close: FC<DialogCloseProps>;
  Title: FC<DialogTitleProps>;
  Description: FC<DialogDescriptionProps>;
  Header: FC<DialogSectionProps>;
  Content: FC<DialogSectionProps>;
  Footer: FC<DialogSectionProps>;
} {
  const Trigger: FC<DialogTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...props }) => {
    return (
      <button
        type='button'
        data-slot={slotToken(`${prefix}-trigger`, inherited)}
        command='show-modal'
        commandfor={target}
        class={cn(buttonBox({ size: "sm" }), "border-transparent", cls)}
        {...props}>
        {children}
      </button>
    );
  };

  const Close: FC<DialogCloseProps> = ({ for: target, request = false, class: cls, children, "data-slot": inherited, ...props }) => {
    return (
      <button
        type='button'
        data-slot={slotToken(`${prefix}-close`, inherited)}
        command={request ? "request-close" : "close"}
        commandfor={target}
        class={cn(buttonBox({ size: "sm" }), "border-transparent", cls)}
        {...props}>
        {children}
      </button>
    );
  };

  const Title: FC<DialogTitleProps> = ({ for: target, level, class: cls, children, "data-slot": inherited, ...rest }) => {
    const Heading = `h${level ?? 2}` as "h2";
    return (
      <Heading data-slot={slotToken(`${prefix}-title`, inherited)} id={titleId(target)} class={cn("text-base font-semibold", cls)} {...rest}>
        {children}
      </Heading>
    );
  };

  const Description: FC<DialogDescriptionProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
    <p
      data-slot={slotToken(`${prefix}-description`, inherited)}
      id={descriptionId(target)}
      class={cn("text-sm text-muted-foreground", cls)}
      {...rest}>
      {children}
    </p>
  );

  const Header: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
    <div data-slot={slotToken(`${prefix}-header`, inherited)} class={cn(PANEL_HEADER, cls)} {...rest}>
      {children}
    </div>
  );

  const Content: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
    <div data-slot={slotToken(`${prefix}-content`, inherited)} class={cn(contentClass, cls)} {...rest}>
      {children}
    </div>
  );

  const Footer: FC<DialogSectionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
    <div data-slot={slotToken(`${prefix}-footer`, inherited)} class={cn(PANEL_FOOTER, cls)} {...rest}>
      {children}
    </div>
  );

  return { Trigger, Close, Title, Description, Header, Content, Footer };
}
