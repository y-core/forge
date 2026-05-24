// Standalone HTML escaping for non-template contexts (error pages, fragments, emails).
// Hono's `html` template auto-escapes but requires template syntax and a render context.
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
