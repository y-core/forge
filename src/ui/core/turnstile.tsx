/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { TURNSTILE, TURNSTILE_SCOPE } from "../contracts/turnstile-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

export type TurnstileProps = Omit<JSX.IntrinsicElements["div"], "children"> & {
  siteKey: string;
  size?: "compact" | "flexible" | "normal";
  load?: "eager" | "focus";
  challenge?: "render" | "submit";
  appearance?: "always" | "execute" | "interaction-only";
  action?: string;
  children?: JSXNode;
};

const DEFAULT_FALLBACK = "The security challenge couldn't load. Please disable any ad or script blockers for this site and reload the page.";

/** Server-rendered Cloudflare Turnstile mount point, placed inside the form and rendered by `mountTurnstile()`. @public */
export const Turnstile: FC<TurnstileProps> = ({
  siteKey,
  size = "normal",
  load = "eager",
  challenge = "render",
  appearance = "always",
  action,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <div
    data-slot={slotToken("turnstile", inherited)}
    data-scope={TURNSTILE_SCOPE}
    data-ref={TURNSTILE.widget}
    data-sitekey={siteKey}
    data-size={size}
    data-load={load}
    data-challenge={challenge === "render" ? undefined : challenge}
    data-appearance={appearance === "always" ? undefined : appearance}
    data-action={action}
    class={cn(asClass(cls))}
    {...rest}>
    <p data-ref={TURNSTILE.fallback} role='alert' hidden={true} class='text-sm text-destructive'>
      {children ?? DEFAULT_FALLBACK}
    </p>
  </div>
);
