import { URL_NOISE } from "./escape";

/** Resolution base for the parse pass. `.invalid` is reserved by RFC 2606, so it can never be a real origin. */
const PARSE_BASE = "https://redirect.invalid";

/** Reduces an untrusted return-to candidate to a same-origin path, falling back when it is not one. @public */
export function safeRedirectPath(candidate: string | null | undefined, fallback: string): string {
  if (typeof candidate !== "string") return fallback;
  const stripped = candidate.replace(URL_NOISE, "");

  // A leading slash is the whole same-origin claim: nothing else can carry a scheme or an
  // authority. Backslashes count as slashes because browsers resolve `/\host` as `//host`.
  if (!stripped.startsWith("/")) return fallback;
  if (/^[/\\]{2}/.test(stripped)) return fallback;

  let url: URL;
  try {
    url = new URL(stripped, PARSE_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_BASE) return fallback;
  // Checked again after parsing: dot-segment normalisation can open a path with `//` that the raw
  // string did not — `/..//evil.com/x` resolves to `//evil.com/x`, which a browser reads as a host.
  if (/^[/\\]{2}/.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
