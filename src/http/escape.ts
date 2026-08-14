const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes `&`, `<`, `>`, `"`, and `'` for safe HTML text embedding. @public */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** URL schemes permitted in attribute values. Everything else collapses to `"#"`. */
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

// Browsers ignore C0/C1 controls and spaces when resolving a scheme, so `java\tscript:` executes
// unless they are stripped before scheme detection.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching C0/C1 control chars
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;

/** Sanitizes a URL for `href`/`src` attributes, collapsing anything but http/https/mailto/tel to `"#"`. @public */
export function safeUrl(value: string): string {
  const normalized = value.replace(URL_NOISE, "").toLowerCase();
  // Protocol-relative URLs (`//host`, `/\host`) carry no scheme, so they bypass scheme detection.
  if (/^[/\\]{2}/.test(normalized)) return "#";
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return value;
  return SAFE_URL_SCHEMES.has(`${scheme[1]}:`) ? value : "#";
}
