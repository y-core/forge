const EXPORT_STAR_RE = /export\s+(?:type\s+)?\*(?:\s*as\s+[A-Za-z_$][\w$]*)?\s+from\s+/;

const DECLARATION_LOOKAHEAD = 9;

/** Runtime value exports of a barrel, plus whether it uses a banned star or type-only re-export. */
export function parseBarrelExports(source: string): { values: string[]; hasExportStar: boolean; hasTypeExports: boolean } {
  const stripped = source.replace(/\/\/.*$/gm, "");

  const hasExportStar = EXPORT_STAR_RE.test(stripped);
  const values: string[] = [];
  let hasTypeExports = false;

  const blockRe = /export\s+(type\s+)?\{([^}]+)\}/gs;
  for (const match of stripped.matchAll(blockRe)) {
    if (match[1]) {
      hasTypeExports = true;
      continue;
    }
    const body = match[2];
    if (body === undefined) continue;
    for (const part of body.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) continue;
      const asIdx = trimmed.indexOf(" as ");
      const name = asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
      if (name) values.push(name);
    }
  }

  const defRe = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$]\w*)/g;
  for (const match of stripped.matchAll(defRe)) {
    const name = match[1];
    if (name === undefined) continue;
    values.push(name);
  }

  return { values, hasExportStar, hasTypeExports };
}

/** Collects every identifier a barrel makes available, including re-exported types and alias names. */
export function parseBarrelExportNames(source: string): Set<string> {
  const stripped = source.replace(/\/\/.*$/gm, "");
  const names = new Set<string>();

  const blockRe = /export\s+(?:type\s+)?\{([^}]+)\}/gs;
  for (const match of stripped.matchAll(blockRe)) {
    const body = match[1];
    if (body === undefined) continue;
    for (const part of body.split(",")) {
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
  for (const match of stripped.matchAll(defRe)) {
    const name = match[1];
    if (name === undefined) continue;
    names.add(name);
  }

  return names;
}

/** Collects only the identifiers a consumer can import — the exported side of each re-export, alias resolved. */
export function parseConsumerExportNames(source: string): Set<string> {
  const stripped = source.replace(/\/\/.*$/gm, "");
  const names = new Set<string>();

  const blockRe = /export\s+(?:type\s+)?\{([^}]+)\}/gs;
  for (const match of stripped.matchAll(blockRe)) {
    const body = match[1];
    if (body === undefined) continue;
    for (const part of body.split(",")) {
      let trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
      const asIdx = trimmed.indexOf(" as ");
      names.add(asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed);
    }
  }

  const defRe = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/g;
  for (const match of stripped.matchAll(defRe)) {
    const name = match[1];
    if (name === undefined) continue;
    names.add(name);
  }

  return names;
}

/** Extracts the exported identifier(s) declared on a single line, or `null` if none. */
export function exportNamesFromLine(line: string): string[] | null {
  const decl = line.match(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/);
  const declName = decl?.[1];
  if (declName !== undefined) return [declName];

  const block = line.match(/export\s+(?:type\s+)?\{([^}]+)\}/);
  const blockBody = block?.[1];
  if (blockBody !== undefined) {
    const names = blockBody
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

function tsdocBlockEnd(lines: string[], index: number): number {
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.includes("/**")) {
      start = i;
      break;
    }
    if (i < index && line.includes("*/")) break;
  }
  if (start < 0) return index;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const from = i === start ? line.indexOf("/**") + 3 : 0;
    if (line.indexOf("*/", from) >= 0) return i;
  }
  return index;
}

/** Finds every `@public`-tagged exported symbol in a source file. */
export function findPublicSymbols(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.includes("@public")) continue;
    const blockEnd = tsdocBlockEnd(lines, i);
    for (let j = blockEnd; j < Math.min(lines.length, blockEnd + DECLARATION_LOOKAHEAD); j++) {
      const candidate = lines[j];
      if (candidate === undefined) continue;
      const names = exportNamesFromLine(candidate);
      if (names) {
        found.push(...names);
        break;
      }
    }
  }
  return found;
}
