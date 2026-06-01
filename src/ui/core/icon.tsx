import type { FC } from "hono/jsx";
import { cn } from "./utils/cn";

export interface IconProps {
  symbol: string;
  sprite?: string;
  width?: number | string;
  height?: number | string;
  viewBox?: string;
  class?: string;
  "aria-hidden"?: string | boolean;
  "aria-label"?: string;
  stroke?: string;
  "stroke-width"?: number | string;
  "stroke-linecap"?: string;
  "stroke-linejoin"?: string;
}

export const Icon: FC<IconProps> = ({
  symbol,
  sprite,
  width,
  height,
  viewBox,
  class: cls,
  "aria-hidden": ariaHidden = "true",
  "aria-label": ariaLabel,
  stroke,
  "stroke-width": strokeWidth,
  "stroke-linecap": strokeLinecap,
  "stroke-linejoin": strokeLinejoin,
}) => {
  return (
    <svg
      data-slot="icon"
      width={width}
      height={height}
      viewBox={viewBox}
      class={cn(cls)}
      aria-hidden={ariaLabel ? undefined : String(ariaHidden)}
      aria-label={ariaLabel}
      stroke={stroke}
      stroke-width={strokeWidth}
      stroke-linecap={strokeLinecap}
      stroke-linejoin={strokeLinejoin}
    >
      <use href={`${sprite ?? ""}#${symbol}`} />
    </svg>
  );
};

/**
 * Factory that binds a sprite URL and viewBox metadata to produce a typed Icon component.
 * The returned component's `name` prop is narrowed to the icon names found in `meta`.
 */
export function createIcon<M extends Record<string, string>>(sprite: string, meta: M) {
  type Name = keyof M extends `icon-${infer N}` ? N : never;
  return function BoundIcon(p: Omit<IconProps, "symbol" | "sprite"> & { name: Name }) {
    const { name, viewBox, ...rest } = p;
    const id = `icon-${String(name)}`;
    return <Icon {...rest} sprite={sprite} symbol={id} viewBox={viewBox ?? (meta as Record<string, string>)[id]} />;
  };
}
