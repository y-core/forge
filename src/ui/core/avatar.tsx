import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { asClass, cn } from "./utils/cn";

type AvatarSize = "sm" | "md" | "lg";

interface AvatarProps {
  size?: AvatarSize;
  class?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
};

const AvatarRoot: FC<PropsWithChildren<AvatarProps>> = ({
  size = "md",
  class: cls,
  children,
}) => (
  <span
    data-slot="avatar"
    data-size={size}
    class={cn(
      "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
      sizeClasses[size],
      cls,
    )}
  >
    {children}
  </span>
);

type AvatarImageProps = Omit<JSX.IntrinsicElements["img"], "children"> & { alt: string };

const AvatarImage: FC<AvatarImageProps> = ({ class: cls, alt, ...props }) => (
  <img
    data-slot="avatar-image"
    class={cn("aspect-square size-full object-cover", asClass(cls))}
    alt={alt}
    {...props}
  />
);

interface AvatarFallbackProps {
  class?: string;
}

const AvatarFallback: FC<PropsWithChildren<AvatarFallbackProps>> = ({
  class: cls,
  children,
}) => (
  <span
    data-slot="avatar-fallback"
    class={cn(
      "flex size-full items-center justify-center font-medium text-muted-foreground",
      cls,
    )}
  >
    {children}
  </span>
);

export const Avatar = Object.assign(AvatarRoot, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
});
