import { v } from "../validation/mod";
import type { BaseUrlConfig, DeriveAllowedOriginsOptions, ParsedUrl } from "./types";

/** Valibot schema transforming an https URL string (or `http://localhost`) into a `BaseUrlConfig`. @public */
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

/** Derives the allowed origins for a parsed URL, optionally adding the www-prefixed variant. @public */
export function deriveAllowedOrigins(parsed: ParsedUrl, options: DeriveAllowedOriginsOptions = {}): string[] {
  const origins = [parsed.origin];
  if (options.includeWww && !parsed.hostname.startsWith("www.")) {
    origins.push(`${parsed.protocol}//www.${parsed.hostname}`);
  }
  return origins;
}

/** Parses a URL string and returns structured origin/hostname/protocol. Throws on invalid input. @public */
export function parseUrl(input: string): ParsedUrl {
  const url = new URL(input);
  return { origin: url.origin, hostname: url.hostname, protocol: url.protocol };
}
