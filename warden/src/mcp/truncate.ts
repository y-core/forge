const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 6000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

/** Caps one response, naming the narrower path rather than only that it was cut.
 *
 *  A whole document is the largest thing this server can emit, and a bare ellipsis leaves a reader
 *  to guess whether the rule they wanted was in the part that was dropped. The tail names the two
 *  tools that reach the missing part directly. @public */
export function truncate(body: string, path: string): string {
  if (body.length <= MAX_CHARS) return body;
  const tokens = Math.ceil(body.length / CHARS_PER_TOKEN);
  return `${body.slice(0, MAX_CHARS)}\n\n--- TRUNCATED ---\nResponse was ~${tokens.toLocaleString()} tokens (limit: ${MAX_TOKENS.toLocaleString()}). Use knowledge_outline on ${path} and knowledge_read the one section you need.`;
}
