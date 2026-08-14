/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface SkeletonProps extends Omit<JSX.IntrinsicElements["div"], "children"> {}

/** A pulsing placeholder block standing in for content that has not loaded. @public */
export const Skeleton: FC<SkeletonProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("skeleton", inherited)} aria-hidden='true' class={cn("animate-pulse rounded-md bg-muted", cls)} {...rest} />
);
