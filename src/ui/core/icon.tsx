import type { FC } from "hono/jsx";
import { useIconSprite } from "./icon-context";
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
  const contextSprite = useIconSprite();
  const resolvedSprite = sprite || contextSprite;

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
      <use href={`${resolvedSprite}#${symbol}`} />
    </svg>
  );
};
