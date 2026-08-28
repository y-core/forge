import { chmodSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

/**
 * The comment that marks the next key as one **this project generates**, so foundry
 * may make a fresh value for it directly on the remote.
 *
 * Named for what happens rather than for the category: generating destroys whatever
 * was there, so it is opt-in per key and the opt-in lives beside the key it governs.
 * An unmarked key is assumed to be a third-party credential that cannot be
 * re-obtained once overwritten.
 */
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

/**
 * What a `.dev.vars` key is, decided by the markers above it. The three are
 * mutually exclusive, and each names a different thing that happens to the value:
 *
 * - `local` — no marker. Stays on this machine; nothing ever sends it.
 * - `secret` — {@link PUSH_MARKER}. The local value is what goes remote, because
 *   it is a credential issued elsewhere and cannot be regenerated here.
 * - `rotatable` — {@link GENERATE_MARKER}. The local value is **never** sent; foundry
 *   generates a fresh value directly on the remote. So the local and remote values of
 *   a generated key are expected to differ, permanently.
 *
 * `GENERATE_MARKER` wins when both are present: it is the stronger claim, and the two
 * disagree about the one thing that matters — whether the local value leaves here.
 */
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

/** Strip a matching pair of surrounding quotes; a mismatched pair like `"x'` is left verbatim. */
function unquote(raw: string): string {
  const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0];
  return quoted ? raw.slice(1, -1) : raw;
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
    vars.push({ name, value: unquote(trimmed.slice(eq + 1).trim()), kind, line: index });
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
    const quote =
      rawValue.length >= 2 && (rawValue[0] === '"' || rawValue[0] === "'") && rawValue[rawValue.length - 1] === rawValue[0] ? rawValue[0] : "";
    lines[entry.line] = `${line.slice(0, eq + 1)}${quote}${next}${quote}`;
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
