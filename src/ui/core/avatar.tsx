/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type AvatarSize = "sm" | "md" | "lg";
type AvatarImageProps = Omit<JSX.IntrinsicElements["img"], "children"> & { alt: string };

interface AvatarProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  size?: AvatarSize;
}

type AvatarFallbackProps = Omit<JSX.IntrinsicElements["span"], "children">;

const sizeClasses: Record<AvatarSize, string> = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base" };

const AvatarRoot: FC<PropsWithChildren<AvatarProps>> = ({ size = "md", class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("avatar", inherited)}
    data-size={size}
    class={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted", sizeClasses[size], cls)}
    {...rest}>
    {children}
  </span>
);

const AvatarImage: FC<AvatarImageProps> = ({ class: cls, alt, "data-slot": inherited, ...props }) => (
  <img data-slot={slotToken("avatar-image", inherited)} class={cn("aspect-square size-full object-cover", asClass(cls))} alt={alt} {...props} />
);

const AvatarFallback: FC<PropsWithChildren<AvatarFallbackProps>> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("avatar-fallback", inherited)}
    class={cn("flex size-full items-center justify-center font-medium text-muted-foreground", cls)}
    {...rest}>
    {children}
  </span>
);

export const Avatar = Object.assign(AvatarRoot, { Image: AvatarImage, Fallback: AvatarFallback });
