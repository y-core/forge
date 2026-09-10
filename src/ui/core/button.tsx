/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Appearance, Shape, Size, Tone } from "../contracts/types";
import { Spinner } from "./spinner";
import type { ButtonProps } from "./types";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";
import { toneVariants } from "./utils/tone";

const buttonBox = cva({
  base: "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors",
  variants: {
    size: { sm: "h-control-sm px-3 text-sm", md: "h-control-md px-4 text-sm", lg: "h-control-lg px-6 text-base" },
    shape: { default: "", icon: "w-control-md px-0", square: "aspect-square w-full p-0", circle: "w-control-md rounded-selector px-0" },
  },
  compoundVariants: [
    { shape: ["icon", "circle"], size: "sm", class: "w-control-sm" },
    { shape: ["icon", "circle"], size: "lg", class: "w-control-lg" },
  ],
  defaultVariants: { size: "md", shape: "default" },
});

// Two cells only, applied over `toneVariants` rather than beside it: a neutral button rests on the
// page's own chrome, so its outline and ghost take `--input` and `--accent` instead of the tone.
const NEUTRAL_CHROME: Partial<Record<Appearance, string>> = {
  outline: "border-input text-foreground hover:bg-accent hover:text-accent-foreground",
  ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
};

/** Resolves the shared button box, paint, size and shape classes for every button-shaped component. @public */
export function buttonVariants(
  props: {
    tone?: Tone | undefined;
    appearance?: Appearance | undefined;
    size?: Size | undefined;
    shape?: Shape | undefined;
    class?: string | undefined;
  } = {},
): string {
  const tone = props.tone ?? "primary";
  const appearance = props.appearance ?? "solid";
  return cn(
    buttonBox({ size: props.size, shape: props.shape }),
    toneVariants({ tone, appearance }),
    tone === "neutral" ? NEUTRAL_CHROME[appearance] : undefined,
    props.class,
  );
}

/** A native `<button>`, or under `asChild` its props merged onto a single JSX element child. @public */
export const Button: FC<ButtonProps> = ({
  tone,
  appearance,
  size,
  shape,
  asChild = false,
  loading = false,
  loadingIcon,
  type,
  disabled,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = buttonVariants({ tone, appearance, size, shape, class: cls });
  const busy = loading ? { "aria-busy": "true", ...stateAttrs({ busy: true }) } : {};
  const spinner = loading && loadingIcon ? <Spinner icon={loadingIcon} size={size ?? "md"} /> : null;
  const content = spinner ? (
    <>
      {spinner}
      {children}
    </>
  ) : (
    children
  );

  const slot = slotToken("button", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: { ...busy, ...rest },
      type,
      disabled,
      ...(spinner ? { prefix: spinner } : {}),
      message:
        "Button with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ButtonProps>>;
  }

  return (
    <button type={type ?? "button"} data-slot={slot} class={className} disabled={disabled} {...busy} {...rest}>
      {content}
    </button>
  );
};
