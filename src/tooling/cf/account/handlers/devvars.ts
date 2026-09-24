import { chmodSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

import { CliError } from "../../../cli/errors";
import type { DevVar, DevVarKind } from "./types";

/** The comment marking the next key as one this project generates, so a fresh value may replace it. */
export const GENERATE_MARKER = "# forge:generate";

/** The comment marking the next key as one whose local value is pushed to the deployed surface. */
export const PUSH_MARKER = "# forge:push";

/** The path of the `.dev.vars` sitting beside the given wrangler config. */
export function devVarsPath(configPath: string): string {
  return join(dirname(resolve(configPath)), ".dev.vars");
}

// Values follow dotenv's quoting and inline-comment rules, because that is the format wrangler pushes.
function readValue(raw: string): string {
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote) {
    const inner = raw.slice(1, -1);
    return quote === '"' ? inner.replaceAll("\\n", "\n").replaceAll("\\r", "\r") : inner;
  }
  const hash = raw.indexOf(" #");
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/** Parses `.dev.vars` text, applying the markers accumulated above a key to that key. */
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

/** Read and parse `.dev.vars`, or an empty list when it is absent; a present file that cannot be read is an error. */
export function readDevVars(path: string): DevVar[] {
  if (!existsSync(path)) return [];
  try {
    return parseDevVars(readFileSync(path, "utf-8"));
  } catch (err) {
    // An empty list reads as "declares no keys", which every caller acts on by doing nothing and
    // reporting success — so a file that is there but unreadable has to stop the run.
    throw new CliError("external", `could not read ${path}: ${(err as Error).message}`);
  }
}

/** Replaces the values of the named keys, leaving every other byte of the file untouched. */
export function editDevVars(content: string, updates: ReadonlyMap<string, string>): string {
  const lines = content.split("\n");

  for (const entry of parseDevVars(content)) {
    const next = updates.get(entry.name);
    if (next === undefined) continue;

    const line = lines[entry.line];
    if (line === undefined) continue;
    const eq = line.indexOf("=");
    const rawValue = line.slice(eq + 1).trim();
    const quoted = rawValue.length >= 2 && (rawValue[0] === '"' || rawValue[0] === "'") && rawValue[rawValue.length - 1] === rawValue[0];
    const quote = quoted ? rawValue[0] : "";
    const hash = quoted ? -1 : rawValue.indexOf(" #");
    const comment = hash === -1 ? "" : rawValue.slice(hash);
    lines[entry.line] = `${line.slice(0, eq + 1)}${quote}${next}${quote}${comment}`;
  }

  return lines.join("\n");
}

/** Writes `.dev.vars` through a 0600 temp file, so a secret is never briefly world-readable. */
export function writeDevVars(path: string, content: string): void {
  const temp = join(dirname(path), `.${basename(path)}.forge-${process.pid}.tmp`);
  try {
    writeFileSync(temp, content, { encoding: "utf-8", mode: 0o600 });
    try {
      chmodSync(temp, statSync(path).mode);
    } catch {
      // Not every filesystem permits chmod, and 0600 is safer than the mode it would have copied.
    }
    renameSync(temp, path);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {}
    throw e;
  }
}
