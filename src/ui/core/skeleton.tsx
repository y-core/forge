/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { cn } from "./utils/cn";

interface SkeletonProps extends Omit<JSX.IntrinsicElements["div"], "children"> {}

export const Skeleton: FC<SkeletonProps> = ({ class: cls, ...rest }) => (
  <div data-slot='skeleton' aria-hidden='true' class={cn("animate-pulse rounded-md bg-muted", cls)} {...rest} />
);
