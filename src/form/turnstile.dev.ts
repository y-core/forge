import { isDevBuildArmed, whenArmed } from "../context/armed.dev";
import { admitsTestingSecret as refuseTestingSecret } from "./turnstile.strict";
import type { RelaxTestingSecret } from "./types";

// Under one of Cloudflare's published testing secrets siteverify answers a fixed body: its own `hostname`, and no `action` or `cdata`.
const TESTING_SECRETS: ReadonlySet<string> = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

/** Whether `secretKey` is one of Cloudflare's published Turnstile testing secrets. @internal */
export function isTurnstileTestingSecret(secretKey: string): boolean {
  return TESTING_SECRETS.has(secretKey);
}

/** Admits a Turnstile testing secret in a build armed for development, and refuses it otherwise. @internal */
export const admitsTestingSecret: RelaxTestingSecret = whenArmed(isDevBuildArmed, isTurnstileTestingSecret, refuseTestingSecret);
