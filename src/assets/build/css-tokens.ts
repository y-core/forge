/**
 * Extract CSS custom-property (design token) maps per theme from compiled CSS text,
 * and resolve token `var()` chains to their terminal colour literal. Used by the cursor
 * bake step to look up theme-specific colours for each cursor.
 */

const MAX_RESOLVE_HOPS = 20;

function extractSelectorBlocks(cssText: string, selector: string): string[] {
  const blocks: string[] = [];
  const needle = `${selector}`;
  let searchFrom = 0;
  while (searchFrom < cssText.length) {
    const idx = cssText.indexOf(needle, searchFrom);
    if (idx === -1) break;
    const braceStart = cssText.indexOf("{", idx);
    if (braceStart === -1) break;
    // Ensure the selector token is not a substring of a larger selector (e.g. ".dark-x").
    const between = cssText.slice(idx + needle.length, braceStart).trim();
    const prevChar = idx > 0 ? (cssText[idx - 1] ?? "") : "";
    const boundaryBefore = prevChar === "" || /[\s,}{]/.test(prevChar);
    if (between.length > 0 && !between.startsWith(",") && !/^[.#:\[]/.test(between)) {
      searchFrom = braceStart + 1;
      continue;
    }
    if (!boundaryBefore) {
      searchFrom = braceStart + 1;
      continue;
    }
    // Find the matching close brace.
    let depth = 1;
    let i = braceStart + 1;
    for (; i < cssText.length && depth > 0; i++) {
      if (cssText[i] === "{") depth++;
      else if (cssText[i] === "}") depth--;
    }
    blocks.push(cssText.slice(braceStart + 1, i - 1));
    searchFrom = i;
  }
  return blocks;
}

function parseDeclarations(block: string, into: Map<string, string>): void {
  const declRegex = /--([a-zA-Z0-9-]+)\s*:\s*([^;}{]+?)\s*;/g;
  let match = declRegex.exec(block);
  while (match !== null) {
    if (match[1] && match[2] !== undefined) {
      into.set(`--${match[1]}`, match[2].trim());
    }
    match = declRegex.exec(block);
  }
}

/**
 * Parse compiled CSS text and extract a per-theme token map. Each theme inherits the
 * `:root` declarations then overlays its own selector's declarations. `selectors` maps a
 * theme key to a CSS selector, e.g. `{ light: ":root", dark: ".dark" }`. @public
 */
export function readThemeTokens(cssText: string, selectors: Record<string, string>): Record<string, Map<string, string>> {
  const base = new Map<string, string>();
  for (const block of extractSelectorBlocks(cssText, ":root")) {
    parseDeclarations(block, base);
  }

  const result: Record<string, Map<string, string>> = {};
  for (const [theme, selector] of Object.entries(selectors)) {
    const map = new Map(base);
    if (selector !== ":root") {
      for (const block of extractSelectorBlocks(cssText, selector)) {
        parseDeclarations(block, map);
      }
    }
    result[theme] = map;
  }
  return result;
}

function stripVar(value: string): { token: string; fallback: string | null } | null {
  const match = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (!match?.[1]) return null;
  return { token: match[1], fallback: match[2] !== undefined ? match[2].trim() : null };
}

/**
 * Recursively resolve a CSS custom-property name through `var()` chains to a terminal
 * colour literal. Returns null if the token is missing or the chain exceeds 20 hops. @public
 */
export function resolveToken(token: string, map: Map<string, string>): string | null {
  let current: string | undefined = map.get(token);
  if (current === undefined) return null;

  for (let hops = 0; hops < MAX_RESOLVE_HOPS; hops++) {
    const trimmed = current.trim();
    const parsed = stripVar(trimmed);
    if (!parsed) return trimmed;

    const next = map.get(parsed.token);
    if (next === undefined) {
      if (parsed.fallback !== null) return parsed.fallback;
      return null;
    }
    current = next;
  }
  return null;
}
