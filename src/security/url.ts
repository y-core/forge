import { safeCheck, v } from "../validation/mod";
import type { BaseUrlConfig, DeriveAllowedOriginsOptions, ParsedUrl } from "./types";

const LOOPBACK_ALLOWANCE = "http://localhost and http://127.0.0.1 are allowed for local development";

/** Valibot schema transforming an https URL string (or an http loopback URL) into a `BaseUrlConfig`; the origin set it feeds: SECURITY_HARDENING.md §3f. @public */
export const BaseUrlConfigSchema = v.pipe(
  v.string(),
  v.url(),
  // The message names the requirement, never the env key that supplies the value: which key that is
  // belongs to the consumer, and the refusal's own `<field>:` prefix already locates it.
  safeCheck((urlStr: string) => {
    try {
      return isHttpsOrLoopback(new URL(urlStr));
    } catch {
      return false;
    }
  }, `must use https: (${LOOPBACK_ALLOWANCE})`),
  v.transform((urlStr): BaseUrlConfig => {
    const parsed = parseUrl(urlStr);
    return { ...parsed, allowedOrigins: deriveAllowedOrigins(parsed) };
  }),
);

/** Derives the allowed origins for a parsed URL, optionally adding the www-prefixed variant. @public */
export function deriveAllowedOrigins(parsed: ParsedUrl, options: DeriveAllowedOriginsOptions = {}): string[] {
  const origins: string[] = [];
  const add = (origin: string): void => {
    if (!origins.includes(origin)) origins.push(origin);
  };
  add(parsed.origin);
  if (options.includeWww && !parsed.hostname.startsWith("www.")) {
    add(parsed.origin.replace("://", "://www."));
  }
  for (const entry of options.extraOrigins ?? []) {
    add(parseExtraOrigin(entry).origin);
  }
  return origins;
}

function parseExtraOrigin(entry: string): URL {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`extraOrigins entry is not a normalized origin: ${entry}`);
  }
  if (entry !== url.origin) {
    throw new Error(`extraOrigins entry is not a normalized origin: ${entry}`);
  }
  if (!isHttpsOrLoopback(url)) {
    throw new Error(`extraOrigins entry must use https: (${LOOPBACK_ALLOWANCE}): ${entry}`);
  }
  return url;
}

function isHttpsOrLoopback(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
}

/** Parses a URL string and returns structured origin/hostname/protocol. Throws on invalid input. @public */
export function parseUrl(input: string): ParsedUrl {
  const url = new URL(input);
  return { origin: url.origin, hostname: url.hostname, protocol: url.protocol };
}
