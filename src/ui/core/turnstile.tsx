/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { LABEL_DEFAULTS } from "../contracts/labels";
import { TURNSTILE, TURNSTILE_SCOPE } from "../contracts/turnstile-contract";
import type { TurnstileProps } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

// Cloudflare's published widget dimensions, held only for `appearance="always"`: the other two modes
// show nothing until they must, so a reservation there would leave a permanent hole.
const RESERVED_BOX = { compact: "h-35 w-37.5", flexible: "h-16.25 w-full min-w-75", normal: "h-16.25 w-75" };

/** Server-rendered Cloudflare Turnstile mount point, placed inside the form and rendered by `mountTurnstile()`. @public */
export const Turnstile: FC<TurnstileProps> = ({
  siteKey,
  size = "normal",
  load = "eager",
  challenge = "render",
  appearance = "always",
  action,
  cData,
  responseFieldName,
  language,
  tabindex,
  unsupported,
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
    data-cdata={cData}
    data-response-field-name={responseFieldName}
    data-language={language}
    data-tabindex={tabindex}
    class={cn(appearance === "always" ? RESERVED_BOX[size] : undefined, cls)}
    {...rest}>
    <p data-ref={TURNSTILE.fallback} role='alert' hidden={true} class='text-sm text-destructive-text'>
      {children ?? LABEL_DEFAULTS.turnstileFallback}
    </p>
    <p data-ref={TURNSTILE.unsupported} role='alert' hidden={true} class='text-sm text-destructive-text'>
      {unsupported ?? LABEL_DEFAULTS.turnstileUnsupported}
    </p>
  </div>
);
