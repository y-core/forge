/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
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

/** Shape of a sprite-bound icon component, as returned by `createIcon`. @public */
export type ForgeIcon<Name extends string = string> = (props: Omit<IconProps, "symbol" | "sprite"> & { name: Name }) => ReturnType<FC>;

/** Renders an SVG `<use>` reference to one symbol in a sprite sheet. @public */
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
    {...(ariaLabel ? { role: "img" } : {})}
    stroke={stroke}
    stroke-width={strokeWidth}
    stroke-linecap={strokeLinecap}
    stroke-linejoin={strokeLinejoin}>
    <use href={`${sprite ?? ""}#${symbol}`} />
  </svg>
);

type SpriteIconName<M, P extends string = "icon-"> = keyof M extends `${P}${infer N}` ? N : never;

/** Binds a sprite URL to produce a typed Icon component. @public */
export function createIcon(sprite: string): ForgeIcon<string>;
export function createIcon<M extends Record<string, string>>(sprite: string, meta: M): ForgeIcon<SpriteIconName<M>>;
export function createIcon<M extends Record<string, string>, P extends string>(sprite: string, meta: M, prefix: P): ForgeIcon<SpriteIconName<M, P>>;
export function createIcon(sprite: string, meta?: Record<string, string>, prefix = "icon-"): ForgeIcon<string> {
  return function BoundIcon(p: Omit<IconProps, "symbol" | "sprite"> & { name: string }) {
    const { name, viewBox, ...rest } = p;
    const id = `${prefix}${String(name)}`;
    const resolvedViewBox = viewBox ?? meta?.[id];
    return <Icon {...rest} sprite={sprite} symbol={id} {...(resolvedViewBox !== undefined ? { viewBox: resolvedViewBox } : {})} />;
  };
}
