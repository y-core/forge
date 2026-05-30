// Standalone HTML escaping for non-template contexts (error pages, fragments, emails).
// Hono's `html` template auto-escapes but requires template syntax and a render context.
//
// Context: escapeHtml is safe for HTML text nodes and double-quoted attribute values.
// Do NOT use it to escape URL values (href, src, action) or inline JS — those contexts
// require percent-encoding and JS string escaping respectively.
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes `&`, `<`, `>`, `"`, and `'` for safe HTML text embedding. Single-pass via a lookup map. @public */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}
