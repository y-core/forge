import type { FC } from "../../jsx/types";
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

/**
 * Shape of a sprite-bound icon component — i.e. the value returned by {@link createIcon}.
 * Forge components that render an icon accept a `ForgeIcon` so the consuming app injects
 * its own bound icon (the sprite URL lives only in the app's generated assets module).
 *
 * `Name` is the set of icon names the component requires. Because function parameters are
 * contravariant, an app icon bound to a wider name set is assignable to a narrower `ForgeIcon`,
 * but the app's sprite must actually contain every required name or assignment fails to compile.
 */
export type ForgeIcon<Name extends string = string> = (props: Omit<IconProps, "symbol" | "sprite"> & { name: Name }) => ReturnType<FC>;

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
}) => (
  <svg
    data-slot='icon'
    width={width}
    height={height}
    viewBox={viewBox}
    class={cn(cls)}
    aria-hidden={ariaLabel ? undefined : String(ariaHidden)}
    aria-label={ariaLabel}
    stroke={stroke}
    stroke-width={strokeWidth}
    stroke-linecap={strokeLinecap}
    stroke-linejoin={strokeLinejoin}>
    <use href={`${sprite ?? ""}#${symbol}`} />
  </svg>
);

/**
 * Factory that binds a sprite URL and viewBox metadata to produce a typed Icon component.
 * The returned component's `name` prop is narrowed to the icon names found in `meta`.
 */
export function createIcon<M extends Record<string, string>>(sprite: string, meta: M) {
  type Name = keyof M extends `icon-${infer N}` ? N : never;
  return function BoundIcon(p: Omit<IconProps, "symbol" | "sprite"> & { name: Name }) {
    const { name, viewBox, ...rest } = p;
    const id = `icon-${String(name)}`;
    const resolvedViewBox = viewBox ?? (meta as Record<string, string>)[id];
    return <Icon {...rest} sprite={sprite} symbol={id} {...(resolvedViewBox !== undefined ? { viewBox: resolvedViewBox } : {})} />;
  };
}
