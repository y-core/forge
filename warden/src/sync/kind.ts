import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CliError } from "../../../src/tooling/cli/errors";
import type { Kind } from "../types";

/** Reads the declared tree from a parsed manifest. `governance.kind` is honoured for one release so
 *  a repository mid-migration is not bricked. @public */
export function readKind(manifest: unknown): Kind | undefined {
  const pkg = manifest as { warden?: { kind?: unknown }; governance?: { kind?: unknown } } | null;
  const declared = pkg?.warden?.kind ?? pkg?.governance?.kind;
  return declared === "libs" || declared === "apps" ? declared : undefined;
}

/** Resolves the tree this repository clones, from `--kind` or the manifest. @public */
export function resolveKind(root: string, explicit?: string): Kind {
  if (explicit === "libs" || explicit === "apps") return explicit;
  if (explicit !== undefined && explicit !== "") {
    throw new CliError("invalid-args", `unknown kind "${explicit}" — warden knows "libs" and "apps"`);
  }
  const manifest = resolve(root, "package.json");
  const declared = existsSync(manifest) ? readKind(JSON.parse(readFileSync(manifest, "utf-8"))) : undefined;
  if (declared === undefined) {
    throw new CliError("invalid-args", 'no tree selected — add `"warden": { "kind": "libs" | "apps" }` to package.json, or pass --kind');
  }
  return declared;
}
