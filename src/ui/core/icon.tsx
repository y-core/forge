/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

export interface IconProps {
  symbol: string;
  sprite?: string | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  viewBox?: string | undefined;
  class?: string | undefined;
  /** A token composed after `icon`, so a caller can address this glyph inside a larger component. */
  "data-slot"?: string | undefined;
  "aria-hidden"?: string | boolean | undefined;
  "aria-label"?: string | undefined;
  stroke?: string | undefined;
  "stroke-width"?: number | string | undefined;
  "stroke-linecap"?: string | undefined;
  "stroke-linejoin"?: string | undefined;
}

/** Shape of a sprite-bound icon component, as returned by `createIcon`. @public */
export type ForgeIcon<Name extends string> = (props: Omit<IconProps, "symbol" | "sprite"> & { name: Name }) => ReturnType<FC>;

/** Renders an SVG `<use>` reference to one symbol in a sprite sheet. @public */
export const Icon: FC<IconProps> = ({
  symbol,
  sprite,
  width,
  height,
  viewBox,
  class: cls,
  "data-slot": inherited,
  "aria-hidden": ariaHidden = "true",
  "aria-label": ariaLabel,
  stroke,
  "stroke-width": strokeWidth,
  "stroke-linecap": strokeLinecap,
  "stroke-linejoin": strokeLinejoin,
}) => (
  <svg
    data-slot={slotToken("icon", inherited)}
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
    return <Icon {...rest} sprite={sprite} symbol={id} viewBox={resolvedViewBox} />;
  };
}
