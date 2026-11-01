import { chmodSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";

import { err, ok } from "../../../result/result";
import type { Result } from "../../../result/types";
import { CliError } from "../../cli/errors";
import { countComments, formatPath } from "../../cli/jsonc";
import { applyJsoncEdits } from "../../cli/jsonc-edit";
import type { JsoncEdit } from "../../cli/types";
import type { WranglerConfig } from "../types";
import { diffConfig } from "./diff";
import { decodeWranglerSource } from "./parse";
import type { ConfigDiff, LoadedWranglerConfig, WriteOutcome } from "./types";

function describeUnsupported(diffs: ConfigDiff[]): string[] {
  return diffs
    .filter((d): d is Extract<ConfigDiff, { kind: "unsupported" }> => d.kind === "unsupported")
    .map((d) => `${formatPath(d.path)} (${d.reason})`);
}

function writeAtomic(path: string, text: string): void {
  // Same directory, so the rename is within one filesystem and therefore atomic; the pid keeps
  // two concurrent runs from staging through each other's temp file.
  const temp = join(dirname(path), `.${basename(path)}.forge-${process.pid}.tmp`);
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
    } catch {}
    throw e;
  }
}

/** Writes resolved IDs back into the config, preserving every byte the change does not touch. */
export function writeWranglerConfig(
  loaded: LoadedWranglerConfig,
  updated: WranglerConfig,
  options: { force?: boolean } = {},
): Result<WriteOutcome, CliError> {
  const diffs = diffConfig(loaded.config, updated);

  if (diffs.length === 0) {
    return ok({ path: loaded.path, written: false, edits: 0 });
  }

  const unsupported = describeUnsupported(diffs);
  const edits: JsoncEdit[] = diffs
    .filter((d): d is Extract<ConfigDiff, { kind: "set" }> => d.kind === "set")
    .map((d) => ({ path: d.path, value: d.value }));

  const comments = countComments(loaded.source);

  if (unsupported.length > 0) {
    if (!options.force) return err(refusal(loaded, unsupported, comments));
    return forceRewrite(loaded, updated, comments, unsupported);
  }

  const spliced = applyJsoncEdits(loaded.source, edits);
  if (!spliced.ok) {
    const reason = [`${spliced.error.message}`];
    if (!options.force) return err(refusal(loaded, reason, comments));
    return forceRewrite(loaded, updated, comments, reason);
  }

  const verification = verify(spliced.data, updated);
  if (verification !== null) {
    return err(
      new CliError(
        "invalid-args",
        `Refusing to write ${loaded.path}: the edited config did not reproduce the expected result (${verification}). ` +
          "This is a bug in forge's config writer, not something --force can fix. The file is unchanged.",
      ),
    );
  }

  writeAtomic(loaded.path, spliced.data);
  return ok({ path: loaded.path, written: true, edits: edits.length });
}

function verify(text: string, expected: WranglerConfig): string | null {
  let reparsed: unknown;
  try {
    reparsed = decodeWranglerSource(text, "<edited config>");
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
  return ok({ path: loaded.path, written: true, edits: 0, lost: { comments, unsupported } });
}
