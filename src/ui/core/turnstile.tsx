/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { TURNSTILE } from "../turnstile-contract";
import { asClass, cn } from "./utils/cn";

export type TurnstileProps = Omit<JSX.IntrinsicElements["div"], "children"> & {
  siteKey: string;
  size?: "compact" | "flexible" | "normal";
  /** Custom message shown when the challenge fails to load. Defaults to a generic prompt. */
  children?: JSXNode;
};

const DEFAULT_FALLBACK = "The security challenge couldn't load. Please disable any ad or script blockers for this site and reload the page.";

/**
 * Server-rendered Cloudflare Turnstile mount point. Pair with `mountTurnstile()` from
 * `@y-core/forge/ui/client`, which explicitly renders the widget into this container and manages
 * its lifecycle (engagement-gated load, reset-on-retry, visible fallback on failure).
 *
 * Deliberately omits Cloudflare's `cf-turnstile` auto-render class — the controller owns rendering,
 * so the lifecycle is deterministic rather than implicit. Place INSIDE the form so the token input
 * Turnstile injects is submitted with it. The fallback message ships hidden and is revealed by the
 * controller only when the challenge cannot load; override it by passing children.
 * @public
 */
export const Turnstile: FC<TurnstileProps> = ({ siteKey, size = "normal", class: cls, children, ...rest }) => (
  <div data-slot='turnstile' data-ref={TURNSTILE.widget} data-sitekey={siteKey} data-size={size} class={cn(asClass(cls))} {...rest}>
    <p data-ref={TURNSTILE.fallback} role='alert' hidden={true} class='text-sm text-red-600'>
      {children ?? DEFAULT_FALLBACK}
    </p>
  </div>
);
