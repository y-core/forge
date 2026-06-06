import type { FC } from "../../jsx/types";
import { cn } from "./utils/cn";

interface SkeletonProps {
  class?: string;
}

export const Skeleton: FC<SkeletonProps> = ({ class: cls }) => (
  <div data-slot='skeleton' aria-hidden='true' class={cn("animate-pulse rounded-md bg-muted", cls)} />
);
