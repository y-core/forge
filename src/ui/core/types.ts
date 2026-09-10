import type { JSX } from "../../jsx/types";
import type { JSXNode } from "../../jsx/types";
import type { FC } from "../../jsx/types";
import type { Appearance } from "../contracts/types";
import type { Shape } from "../contracts/types";
import type { Size } from "../contracts/types";
import type { Tone } from "../contracts/types";

/** The appearances a callout takes — a panel is filled or tinted, never outlined or bare. @public */
export type PanelAppearance = Extract<Appearance, "solid" | "soft">;

/** The appearances a badge takes — a chip has no ghost or link form. @public */
export type BadgeAppearance = Extract<Appearance, "solid" | "soft" | "outline">;

export interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  tone?: Tone | undefined;
  appearance?: Appearance | undefined;
  size?: Size | undefined;
  shape?: Shape | undefined;
  asChild?: boolean | undefined;
  /** Marks the button busy: `aria-busy`, `data-busy`, and a `Spinner` before the children when `loadingIcon` is given. */
  loading?: boolean | undefined;
  loadingIcon?: ForgeIcon<"spinner"> | undefined;
  children?: JSXNode | undefined;
}

/** Where an item settles in the strip once scrolling stops. @public */
export type CarouselSnap = "start" | "center";

/** Plain object describing a form field — pass explicitly to controls instead of relying on context. @public */
export interface FieldDescriptor {
  name: string;
  /** Distinguishes fields that share a `name` on one page. */
  scope?: string | undefined;
  /** A description element renders for this field. */
  description?: boolean | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
}

/** What {@link fieldDescribedBy} needs beyond the field's name. */
export interface FieldDescribedByOptions {
  scope?: string | undefined;
  /** A description element renders for this field. */
  description?: boolean | undefined;
  invalid?: boolean | undefined;
  /** An `aria-describedby` the caller already has, kept ahead of the derived ids. */
  existing?: string | undefined;
}

/** How an unchosen chip is painted. @public */
export type FilterAppearance = "ghost" | "soft";

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

/** Which corner of the wrapped content an indicator item sits on. @public */
export type IndicatorPlacement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

/** How a link marks itself as one — always underlined, underlined on hover, or never. Not the
 *  ratified `appearance` axis, which is an emphasis level: this decides text decoration. @public */
export type LinkDecoration = "underline" | "hover" | "plain";

export interface LinkProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  tone?: Tone | undefined;
  decoration?: LinkDecoration | undefined;
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

/** Which of the three bands a measured value reads as. @public */
export type MeterState = "optimum" | "suboptimum" | "poor";

/** How many digits a one-time code holds. @public */
export type OtpLength = 4 | 5 | 6 | 7 | 8;

/** The edge the layers behind the first child fan out towards. @public */
export type StackPlacement = "top" | "bottom" | "start" | "end";

export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

/** Whether one item may be pressed at a time, or several. @public */
export type ToggleGroupType = "single" | "multiple";

export type TurnstileProps = Omit<JSX.IntrinsicElements["div"], "children" | "tabindex"> & {
  siteKey: string;
  size?: "compact" | "flexible" | "normal" | undefined;
  load?: "eager" | "focus" | undefined;
  challenge?: "render" | "submit" | undefined;
  appearance?: "always" | "execute" | "interaction-only" | undefined;
  action?: string | undefined;
  cData?: string | undefined;
  responseFieldName?: string | undefined;
  language?: string | undefined;
  tabindex?: number | undefined;
  unsupported?: JSXNode | undefined;
  children?: JSXNode | undefined;
};
