/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { TURNSTILE } from "../contracts/turnstile-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

export type TurnstileProps = Omit<JSX.IntrinsicElements["div"], "children"> & {
  siteKey: string;
  size?: "compact" | "flexible" | "normal";
  children?: JSXNode;
};

const DEFAULT_FALLBACK = "The security challenge couldn't load. Please disable any ad or script blockers for this site and reload the page.";

/** Server-rendered Cloudflare Turnstile mount point, placed inside the form and rendered by `mountTurnstile()`. @public */
export const Turnstile: FC<TurnstileProps> = ({ siteKey, size = "normal", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("turnstile", inherited)}
    data-ref={TURNSTILE.widget}
    data-sitekey={siteKey}
    data-size={size}
    class={cn(asClass(cls))}
    {...rest}>
    <p data-ref={TURNSTILE.fallback} role='alert' hidden={true} class='text-sm text-destructive'>
      {children ?? DEFAULT_FALLBACK}
    </p>
  </div>
);
