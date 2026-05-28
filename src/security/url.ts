import { v } from "../validation/mod";
import type { BaseUrlConfig, ParsedUrl } from "./types";

/** Valibot schema: validates a URL string and transforms it into a BaseUrlConfig with allowedOrigins. @public */
export const BaseUrlConfigSchema = v.pipe(
  v.string(),
  v.url(),
  v.transform((urlStr): BaseUrlConfig => {
    const parsed = parseUrl(urlStr);
    return { ...parsed, allowedOrigins: deriveAllowedOrigins(parsed) };
  }),
);

/**
 * Derives the list of allowed origins for a given parsed URL.
 * Always includes the base origin; adds the www-prefixed variant for non-www hostnames.
 * @public
 */
export function deriveAllowedOrigins(parsed: ParsedUrl): string[] {
  const origins = [parsed.origin];
  if (!parsed.hostname.startsWith("www.")) {
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
