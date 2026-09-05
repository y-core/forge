import { chmodSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

/** The comment marking the next key as one this project generates, so a fresh value may replace it. */
export const GENERATE_MARKER = "# foundry:generate";

/**
 * The comment that marks the next key as one whose **local value is pushed** to the
 * deployed surface.
 *
 * Pushing is opt-in because `.dev.vars` is a development file first: it holds
 * throwaway values and switches like `LOG_LEVEL=DEBUG` alongside the credentials
 * that belong on the remote, and only the author can tell which is which.
 */
export const PUSH_MARKER = "# foundry:push";

/** What a `.dev.vars` key is, decided by the mutually exclusive markers above it. */
export type DevVarKind = "local" | "secret" | "rotatable";

/** One key read from `.dev.vars`, with the line it came from and what its markers make it. */
export interface DevVar {
  name: string;
  value: string;
  kind: DevVarKind;
  line: number;
}

/**
 * `.dev.vars` sits beside the wrangler config, so the lookup is
 * "the directory containing the config" — not `resolve(configPath, "..")`, which
 * reads as that but means the parent of the *cwd* when handed a bare `"."`.
 */
export function devVarsPath(configPath: string): string {
  return join(dirname(resolve(configPath)), ".dev.vars");
}

/**
 * Read a value the way dotenv does, because that is what wrangler pushes.
 *
 * An unquoted value ends at the first ` #`, so `API_KEY=abc # prod key` sends
 * `abc` and not the comment. Double quotes suppress that cut and expand `\n`/`\r`;
 * single quotes are literal. A mismatched pair like `"x'` is left verbatim.
 */
function readValue(raw: string): string {
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote) {
    const inner = raw.slice(1, -1);
    return quote === '"' ? inner.replaceAll("\\n", "\n").replaceAll("\\r", "\r") : inner;
  }
  const hash = raw.indexOf(" #");
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/**
 * Parse `.dev.vars` text.
 *
 * A marker applies to the next key it precedes, and markers accumulate across
 * consecutive comment lines, so an ordinary explanatory comment between the marker
 * and its key does not silently cancel it. Everything is cleared once a key
 * consumes it.
 */
export function parseDevVars(content: string): DevVar[] {
  const vars: DevVar[] = [];
  const markers = new Set<string>();

  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("#")) {
      if (trimmed === GENERATE_MARKER || trimmed === PUSH_MARKER) markers.add(trimmed);
      return;
    }

    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const name = trimmed.slice(0, eq).trim();
    if (!name) return;

    const kind: DevVarKind = markers.has(GENERATE_MARKER) ? "rotatable" : markers.has(PUSH_MARKER) ? "secret" : "local";
    vars.push({ name, value: readValue(trimmed.slice(eq + 1).trim()), kind, line: index });
    markers.clear();
  });

  return vars;
}

/** Read and parse `.dev.vars`, or an empty list when it is absent or unreadable. */
export function readDevVars(path: string): DevVar[] {
  if (!existsSync(path)) return [];
  try {
    return parseDevVars(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`[foundry] could not read ${path}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Replace the values of the named keys, leaving every other byte — comments, blank
 * lines, key order, and the quoting style of the line being changed — untouched.
 *
 * A `.dev.vars` is hand-maintained and carries the rotate markers this tool depends
 * on, so it is edited line by line rather than regenerated.
 */
export function editDevVars(content: string, updates: ReadonlyMap<string, string>): string {
  const lines = content.split("\n");

  for (const entry of parseDevVars(content)) {
    const next = updates.get(entry.name);
    if (next === undefined) continue;

    const line = lines[entry.line];
    // Unreachable: `entry.line` indexes the very array `parseDevVars` derived the entry from.
    if (line === undefined) continue;
    const eq = line.indexOf("=");
    const rawValue = line.slice(eq + 1).trim();
    const quoted = rawValue.length >= 2 && (rawValue[0] === '"' || rawValue[0] === "'") && rawValue[rawValue.length - 1] === rawValue[0];
    const quote = quoted ? rawValue[0] : "";
    // On an unquoted value the trailing ` # note` is a comment, not part of what is
    // being replaced, so it is carried across the rotation.
    const hash = quoted ? -1 : rawValue.indexOf(" #");
    const comment = hash === -1 ? "" : rawValue.slice(hash);
    lines[entry.line] = `${line.slice(0, eq + 1)}${quote}${next}${quote}${comment}`;
  }

  return lines.join("\n");
}

/**
 * Write `.dev.vars` through a temp file created 0600, so a secret is never briefly
 * world-readable and a crash cannot leave a truncated file where credentials were.
 */
export function writeDevVars(path: string, content: string): void {
  const temp = join(dirname(path), `.${basename(path)}.foundry-${process.pid}.tmp`);
  try {
    writeFileSync(temp, content, { encoding: "utf-8", mode: 0o600 });
    try {
      chmodSync(temp, statSync(path).mode);
    } catch {
      // Not every filesystem permits chmod, and 0600 is the safer of the two modes.
    }
    renameSync(temp, path);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw e;
  }
}
