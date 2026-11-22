import { isDevBuildArmed, whenArmed } from "../relax/armed";
import { TURNSTILE_TEST_KEYS } from "./turnstile-keys";
import { admitsTestingSecret as refuseTestingSecret } from "./turnstile.strict";
import type { RelaxTestingSecret } from "./types";

// Under one of Cloudflare's published testing secrets siteverify answers a fixed body: its own `hostname`, and no `action` or `cdata`.
const TESTING_SECRETS: ReadonlySet<string> = new Set(Object.values(TURNSTILE_TEST_KEYS.secret));

/** Whether `secretKey` is one of Cloudflare's published Turnstile testing secrets. @internal */
export function isTurnstileTestingSecret(secretKey: string): boolean {
  return TESTING_SECRETS.has(secretKey);
}

/** Admits a Turnstile testing secret in a build armed for development, and refuses it otherwise. @internal */
export const admitsTestingSecret: RelaxTestingSecret = whenArmed(isDevBuildArmed, isTurnstileTestingSecret, refuseTestingSecret);
