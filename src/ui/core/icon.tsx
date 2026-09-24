/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import type { ForgeIcon, IconProps } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

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
