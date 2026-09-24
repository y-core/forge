import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CliError } from "../../../src/tooling/cli/errors";
import type { Kind } from "../types";

/** Reads the declared tree from a parsed manifest, `governance.kind` included. @public */
export function readKind(manifest: unknown): Kind | undefined {
  const pkg = manifest as { warden?: { kind?: unknown }; governance?: { kind?: unknown } } | null;
  const declared = pkg?.warden?.kind ?? pkg?.governance?.kind;
  return declared === "libs" || declared === "apps" ? declared : undefined;
}

/** The parsed manifest, a parse failure reported against the file rather than raised as a `SyntaxError`. */
function parseManifest(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    throw new CliError("invalid-args", `${file} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Where a resolved kind came from — `default` is the absence of any declaration. @public */
export type KindSource = "flag" | "manifest" | "default";

/** Resolves the tree this repository clones, from `--kind` or the manifest, and says which. @public */
export function resolveKindSource(root: string, explicit?: string): { kind: Kind; source: KindSource } {
  if (explicit === "libs" || explicit === "apps") return { kind: explicit, source: "flag" };
  if (explicit !== undefined && explicit !== "") {
    throw new CliError("invalid-args", `unknown kind "${explicit}" — warden knows "libs" and "apps"`);
  }
  const manifest = resolve(root, "package.json");
  const declared = existsSync(manifest) ? readKind(parseManifest(manifest)) : undefined;
  return declared === undefined ? { kind: "apps", source: "default" } : { kind: declared, source: "manifest" };
}

/** Resolves the tree this repository clones, from `--kind` or the manifest. @public */
export function resolveKind(root: string, explicit?: string): Kind {
  return resolveKindSource(root, explicit).kind;
}
