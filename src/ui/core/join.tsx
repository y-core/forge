/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface JoinProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: Orientation | undefined;
  children?: JSXNode | undefined;
}

/** Groups adjacent controls into one shape, collapsing the inner radii and the doubled border between them. @public */
export const Join: FC<JoinProps> = ({ orientation = "horizontal", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("join", inherited)}
    class={cn("inline-flex items-stretch", orientation === "vertical" && "flex-col", cls)}
    {...stateAttrs({ orientation })}
    {...rest}>
    {children}
  </div>
);
