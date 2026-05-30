import { v } from "../validation/mod";
import type { BaseUrlConfig, ParsedUrl } from "./types";

export interface DeriveAllowedOriginsOptions {
  /** When true, adds the `www.` variant for non-www hostnames. Defaults to false. */
  includeWww?: boolean;
}

/** Valibot schema: validates a URL string and transforms it into a BaseUrlConfig with allowedOrigins. Rejects non-https URLs (http://localhost is allowed for local development). @public */
export const BaseUrlConfigSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((urlStr) => {
    try {
      const url = new URL(urlStr);
      return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }, "BASE_URL must use https: (http://localhost is allowed for local development)"),
  v.transform((urlStr): BaseUrlConfig => {
    const parsed = parseUrl(urlStr);
    return { ...parsed, allowedOrigins: deriveAllowedOrigins(parsed) };
  }),
);

/**
 * Derives the list of allowed origins for a given parsed URL.
 * Always includes the base origin. Pass `{ includeWww: true }` to also add the www-prefixed
 * variant for non-www hostnames.
 * @public
 */
export function deriveAllowedOrigins(
  parsed: ParsedUrl,
  options: DeriveAllowedOriginsOptions = {},
): string[] {
  const origins = [parsed.origin];
  if (options.includeWww && !parsed.hostname.startsWith("www.")) {
    origins.push(`${parsed.protocol}//www.${parsed.hostname}`);
  }
  return origins;
}

/** Parses a URL string and returns structured origin/hostname/protocol. Throws on invalid input. @public */
export function parseUrl(input: string): ParsedUrl {
  const url = new URL(input);
  return {
    origin: url.origin,
    hostname: url.hostname,
    protocol: url.protocol,
  };
}
