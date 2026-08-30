import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import type { Result } from "../../../result/result";
import { v } from "../../../validation/mod";
import { CliError } from "../../core/errors";
import type { WranglerConfig } from "../types";
import type { ConfigDiff } from "./diff";
import { diffConfig, formatPath } from "./diff";
import type { JsoncEdit } from "./edit";
import { applyJsoncEdits } from "./edit";
import { countComments, stripJsonc } from "./jsonc";

export { stripJsonc } from "./jsonc";

// Permissive shape validation — wrangler configs carry many optional fields and
// arbitrary extra keys, so we use loose objects and assert only the pieces the sync
// handlers actually read. `name` is the one hard requirement.
const WranglerConfigSchema = v.looseObject({
  name: v.string('wrangler config must define a string "name"'),
  vars: v.optional(v.record(v.string(), v.unknown())),
  kv_namespaces: v.optional(v.array(v.looseObject({ binding: v.string() }))),
  d1_databases: v.optional(v.array(v.looseObject({ binding: v.string() }))),
  r2_buckets: v.optional(v.array(v.looseObject({ binding: v.string() }))),
  queues: v.optional(
    v.looseObject({
      producers: v.optional(v.array(v.looseObject({ binding: v.string() }))),
      consumers: v.optional(v.array(v.looseObject({ queue: v.string() }))),
    }),
  ),
});

/**
 * A config together with the exact bytes it was parsed from.
 *
 * Write-back needs the original text, and it needs to be the same text the offsets
 * were computed against — so the source travels with the config rather than being
 * re-read later, when the user may have edited the file mid-run.
 */
export interface LoadedWranglerConfig {
  path: string;
  source: string;
  config: WranglerConfig;
}

export function loadWranglerConfig(configPath: string): LoadedWranglerConfig {
  const abs = resolve(configPath);
  const source = readFileSync(abs, "utf-8");
  const json = stripJsonc(source);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`malformed wrangler config at ${abs}: invalid JSON — ${(err as Error).message}`);
  }

  const result = v.safeParse(WranglerConfigSchema, parsed);
  if (!result.success) {
    const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`malformed wrangler config at ${abs}: ${detail}`);
  }

  // Return the original parsed object (not the validated output) so write-back keeps
  // every field verbatim, including keys the schema does not enumerate.
  return { path: abs, source, config: parsed as WranglerConfig };
}

export function parseWranglerConfig(configPath: string): WranglerConfig {
  return loadWranglerConfig(configPath).config;
}

export interface WriteOutcome {
  path: string;
  /** False when the config was already up to date — in which case no write was attempted. */
  written: boolean;
  /** How many values were spliced in. */
  edits: number;
  /** Set only on a `--force` rewrite: what that rewrite destroyed. */
  lost?: { comments: number; unsupported: string[] };
}

function describeUnsupported(diffs: ConfigDiff[]): string[] {
  return diffs
    .filter((d): d is Extract<ConfigDiff, { kind: "unsupported" }> => d.kind === "unsupported")
    .map((d) => `${formatPath(d.path)} (${d.reason})`);
}

/**
 * Write `text` to `path` without ever leaving a half-written config behind.
 *
 * Temp file in the same directory, so the rename is within one filesystem and is
 * therefore atomic; the original's permissions are carried onto the replacement.
 */
function writeAtomic(path: string, text: string): void {
  // The pid keeps two concurrent runs in one directory from writing through each
  // other's temp file — a fixed name would let the second overwrite the first's
  // staged bytes between its write and its rename.
  const temp = join(dirname(path), `.${basename(path)}.foundry-${process.pid}.tmp`);
  try {
    writeFileSync(temp, text, "utf-8");
    try {
      chmodSync(temp, statSync(path).mode);
    } catch {
      // Not every filesystem permits chmod; the content matters more than the mode.
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

/**
 * Write resolved IDs back into the config, preserving every byte the change does
 * not touch.
 *
 * The edit is expressed as a diff, spliced into the original text, and then
 * **verified** by reparsing: if the spliced result does not reproduce `updated`
 * exactly, nothing is written — not even under `force`, since a splicer bug must
 * not be papered over by a destructive rewrite.
 *
 * `force` covers exactly one case: a change this writer cannot express surgically.
 * It falls back to a whole-file JSON rewrite and reports what that cost.
 */
export function writeWranglerConfig(
  loaded: LoadedWranglerConfig,
  updated: WranglerConfig,
  options: { force?: boolean } = {},
): Result<WriteOutcome, CliError> {
  const diffs = diffConfig(loaded.config, updated);

  if (diffs.length === 0) {
    return { ok: true, data: { path: loaded.path, written: false, edits: 0 } };
  }

  const unsupported = describeUnsupported(diffs);
  const edits: JsoncEdit[] = diffs
    .filter((d): d is Extract<ConfigDiff, { kind: "set" }> => d.kind === "set")
    .map((d) => ({ path: d.path, value: d.value }));

  const comments = countComments(loaded.source);

  if (unsupported.length > 0) {
    if (!options.force) return { ok: false, error: refusal(loaded, unsupported, comments) };
    return forceRewrite(loaded, updated, comments, unsupported);
  }

  const spliced = applyJsoncEdits(loaded.source, edits);
  if (!spliced.ok) {
    const reason = [`${spliced.error.message}`];
    if (!options.force) return { ok: false, error: refusal(loaded, reason, comments) };
    return forceRewrite(loaded, updated, comments, reason);
  }

  // Verify before committing: reparse what we are about to write and confirm it
  // means exactly what `updated` means.
  const verification = verify(spliced.data, updated);
  if (verification !== null) {
    return {
      ok: false,
      error: new CliError(
        "invalid-args",
        `Refusing to write ${loaded.path}: the edited config did not reproduce the expected result (${verification}). ` +
          "This is a bug in foundry's config writer, not something --force can fix. The file is unchanged.",
      ),
    };
  }

  writeAtomic(loaded.path, spliced.data);
  return { ok: true, data: { path: loaded.path, written: true, edits: edits.length } };
}

/** null when `text` parses to exactly `expected`; otherwise a description of the mismatch. */
function verify(text: string, expected: WranglerConfig): string | null {
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(stripJsonc(text));
  } catch (e) {
    return `the result no longer parses — ${(e as Error).message}`;
  }
  const residual = diffConfig(reparsed, expected);
  const first = residual[0];
  if (first === undefined) return null;
  return `${residual.length} difference(s) remain, first at ${formatPath(first.path)}`;
}

function refusal(loaded: LoadedWranglerConfig, reasons: string[], comments: number): CliError {
  const atRisk =
    comments > 0 ? `${comments} comment${comments === 1 ? "" : "s"} in that file would be lost` : "the file's formatting would be rewritten";

  return new CliError(
    "invalid-args",
    [
      `Refusing to write ${loaded.path}: this change cannot be made without rewriting the whole file.`,
      `  ${reasons.join("\n  ")}`,
      `${atRisk}. Re-run without --commit to inspect the plan, or with --commit --force to rewrite anyway.`,
    ].join("\n"),
  );
}

function forceRewrite(
  loaded: LoadedWranglerConfig,
  updated: WranglerConfig,
  comments: number,
  unsupported: string[],
): Result<WriteOutcome, CliError> {
  writeAtomic(loaded.path, `${JSON.stringify(updated, null, 2)}\n`);
  return { ok: true, data: { path: loaded.path, written: true, edits: 0, lost: { comments, unsupported } } };
}
