import { requiredGroup } from "../config/config";
import type { AppContext } from "../context/types";
import type { TurnstileVerifyOptions } from "../form/types";
import { parseEnv } from "../validation/parse-env";
import { v } from "../validation/validation";

const SITE_KEY = { TURNSTILE_SITE_KEY: v.string() };
const SECRET_KEY = { TURNSTILE_SECRET_KEY: v.string() };
const TURNSTILE_KEY_SCHEMAS = {
  siteKey: v.pipe(
    requiredGroup(SITE_KEY),
    v.transform((keys) => keys.TURNSTILE_SITE_KEY),
  ),
  secretKey: v.pipe(
    requiredGroup(SECRET_KEY),
    v.transform((keys) => keys.TURNSTILE_SECRET_KEY),
  ),
};

/** `override` when given, and otherwise the one binding `key` names, throwing a message naming it when missing or blank. @public */
export async function readTurnstileKey<Bindings>(
  c: AppContext<Bindings>,
  key: "siteKey" | "secretKey",
  override?: () => string | Promise<string>,
): Promise<string> {
  return override === undefined ? parseEnv(TURNSTILE_KEY_SCHEMAS[key], c.env) : await override();
}

/** The request's own hostname and its `CF-Connecting-IP`, with `override` merged over them. @internal */
export function turnstileVerifyOptions<Bindings>(
  c: AppContext<Bindings>,
  override: Partial<Omit<TurnstileVerifyOptions, "tokenField">> = {},
): Omit<TurnstileVerifyOptions, "tokenField"> {
  const remoteIp = c.request.headers.get("CF-Connecting-IP");
  return { expectedHostname: c.url.hostname, ...(remoteIp === null ? {} : { remoteIp }), ...override };
}
