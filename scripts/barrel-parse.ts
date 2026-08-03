import { readFileSync } from "node:fs";

/**
 * Every spelling of the banned star re-export: the bare form, the namespaced
 * `export * as ns from "./x"` — the same leak of every internal symbol behind one extra token —
 * and the type-only `export type * from "./x"`. One pattern with optional `type` and `as` clauses
 * keeps the three from drifting apart.
 *
 * The type-only form is erased at emit, so it cannot create a runtime cycle; it leaks every
 * internal type into the surface and is just as ungreppable, which is two of the ban's three
 * stated harms (`NAMESPACE_DESIGN.md` §1b). It also used to fail *misleadingly*: a barrel of
 * nothing but `export type *` left `hasTypeExports` false and was rejected as "no value exports
 * found in barrel", which is not what is wrong with it.
 */
const EXPORT_STAR_RE = /export\s+(?:type\s+)?\*(?:\s*as\s+[A-Za-z_$][\w$]*)?\s+from\s+/;

/** How far past the end of a TSDoc block a `@public` tag may still reach for its declaration. */
const DECLARATION_LOOKAHEAD = 9;

/** Runtime value exports of a barrel, plus whether it uses a banned star or type-only re-export. */
export function parseBarrelExports(filePath: string): { values: string[]; hasExportStar: boolean; hasTypeExports: boolean } {
  const source = readFileSync(filePath, "utf-8").replace(/\/\/.*$/gm, "");

  const hasExportStar = EXPORT_STAR_RE.test(source);
  const values: string[] = [];
  let hasTypeExports = false;

  // Phase 1: export { ... } blocks (with optional leading `type` keyword)
  // The `s` flag lets [^}]+ span newlines for multi-line brace groups.
  const blockRe = /export\s+(type\s+)?\{([^}]+)\}/gs;
  for (const match of source.matchAll(blockRe)) {
    if (match[1]) {
      hasTypeExports = true; // type-only block — erased at runtime
      continue;
    }
    for (const part of match[2].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) continue; // inline type marker
      const asIdx = trimmed.indexOf(" as ");
      const name = asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
      if (name) values.push(name);
    }
  }

  // Phase 2: inline export definitions
  const defRe = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$]\w*)/g;
  for (const match of source.matchAll(defRe)) {
    values.push(match[1]);
  }

  return { values, hasExportStar, hasTypeExports };
}

/**
 * Collects every identifier a barrel makes available — runtime values, re-exported types, and
 * both sides of an `as` alias — so a `@public` source symbol can be matched whether the barrel
 * re-exports it directly or under a new name.
 */
export function parseBarrelExportNames(filePath: string): Set<string> {
  const source = readFileSync(filePath, "utf-8").replace(/\/\/.*$/gm, "");
  const names = new Set<string>();

  const blockRe = /export\s+(?:type\s+)?\{([^}]+)\}/gs;
  for (const match of source.matchAll(blockRe)) {
    for (const part of match[1].split(",")) {
      let trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
      const asIdx = trimmed.indexOf(" as ");
      if (asIdx >= 0) {
        names.add(trimmed.slice(0, asIdx).trim());
        names.add(trimmed.slice(asIdx + 4).trim());
      } else {
        names.add(trimmed);
      }
    }
  }

  const defRe = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/g;
  for (const match of source.matchAll(defRe)) names.add(match[1]);

  return names;
}

/** Extracts the exported identifier(s) declared on a single line, or `null` if none. */
export function exportNamesFromLine(line: string): string[] | null {
  const decl = line.match(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/);
  if (decl) return [decl[1]];

  const block = line.match(/export\s+(?:type\s+)?\{([^}]+)\}/);
  if (block) {
    const names = block[1]
      .split(",")
      .map((part) => {
        let trimmed = part.trim();
        if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
        const asIdx = trimmed.indexOf(" as ");
        return asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
      })
      .filter(Boolean);
    return names.length > 0 ? names : null;
  }
  return null;
}

/**
 * The index of the line closing the TSDoc block that contains `index`, or `index` itself when that
 * line is not inside one.
 *
 * The block's own `/**` is located first, so a `@public` written outside a comment can never send
 * the forward search hunting for a `*\/` that belongs to some later block.
 */
function tsdocBlockEnd(lines: string[], index: number): number {
  let start = -1;
  for (let i = index; i >= 0; i--) {
    if (lines[i].includes("/**")) {
      start = i;
      break;
    }
    if (i < index && lines[i].includes("*/")) break; // an earlier block already closed — not ours
  }
  if (start < 0) return index;

  for (let i = start; i < lines.length; i++) {
    // On the opening line the search must begin past `/**`, so a one-line block closes on itself.
    const from = i === start ? lines[i].indexOf("/**") + 3 : 0;
    if (lines[i].indexOf("*/", from) >= 0) return i;
  }
  return index;
}

/**
 * Finds every `@public`-tagged exported symbol in a source file. A `@public` JSDoc tag binds to the
 * next `export` declaration after the end of its own comment block (skipping intervening
 * `biome-ignore` comment lines), matching the codebase convention of tagging the symbol above.
 *
 * The search starts at the block's last line rather than at the tag, so the reach is set by the
 * comment's actual extent: a thoroughly documented symbol must not fall out of the barrel check
 * for the crime of having a long TSDoc block, and an `@example` body inside that block cannot be
 * mistaken for the declaration.
 */
export function findPublicSymbols(filePath: string): string[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("@public")) continue;
    const blockEnd = tsdocBlockEnd(lines, i);
    for (let j = blockEnd; j < Math.min(lines.length, blockEnd + DECLARATION_LOOKAHEAD); j++) {
      const names = exportNamesFromLine(lines[j]);
      if (names) {
        found.push(...names);
        break;
      }
    }
  }
  return found;
}
