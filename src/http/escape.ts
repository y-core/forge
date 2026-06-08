// Standalone HTML escaping for non-template contexts (error pages, fragments, emails).
//
// Context: escapeHtml is safe for HTML text nodes and double-quoted attribute values.
// Do NOT use it to escape URL values (href, src, action) or inline JS — those contexts
// require scheme sanitization (see `safeUrl`) and JS string escaping respectively.
const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes `&`, `<`, `>`, `"`, and `'` for safe HTML text embedding. Single-pass via a lookup map. @public */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** URL schemes permitted in attribute values. Everything else collapses to `"#"`. */
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

// C0 controls + space (\u0000-\u0020) and DEL + C1 controls (\u007f-\u009f). Browsers ignore
// these when resolving a URL scheme, so strip them before scheme detection.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching C0/C1 control chars
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;

/**
 * Sanitizes a URL for safe use in `href`/`src`-style attributes. Relative and scheme-less URLs
 * pass through unchanged; absolute URLs are allowed only for `http`/`https`/`mailto`/`tel`.
 * Dangerous schemes (`javascript:`, `vbscript:`, `data:`, …) — including ones obscured with
 * leading/embedded whitespace, control characters, or mixed case — return `"#"`.
 * Protocol-relative URLs (`//host`, `\host`) are rejected.
 * The caller is still responsible for HTML-escaping the result. @public
 */
export function safeUrl(value: string): string {
  // Strip scheme-noise before detection (defeats `java\tscript:` / leading-newline tricks).
  const normalized = value.replace(URL_NOISE, "").toLowerCase();
  // Protocol-relative URLs (`//host`, `\\host`, `/\host`) bypass scheme detection — reject them.
  if (/^[/\\]{2}/.test(normalized)) return "#";
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  // No scheme → relative URL: cannot trigger script execution, pass through.
  if (!scheme) return value;
  return SAFE_URL_SCHEMES.has(`${scheme[1]}:`) ? value : "#";
}
