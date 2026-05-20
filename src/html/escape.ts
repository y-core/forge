// Standalone HTML escaping for non-template contexts (error pages, fragments, emails).
// Hono's `html` template auto-escapes but requires template syntax and a render context.
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
