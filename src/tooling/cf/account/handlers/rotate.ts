import { readFileSync } from "node:fs";

import { bytesToHex, randomBytes } from "../../../../crypto/mod";
import { err, ok } from "../../../../result/result";
import { editDevVars, GENERATE_MARKER, writeDevVars } from "./devvars";
import type { DevVar } from "./types";
import type { RotationPlan, RotationRefusal } from "./types";

/**
 * A fresh secret in the shape `openssl rand -hex 32` produces — 32 bytes of CSPRNG
 * output, hex-encoded.
 */
export function randomSecret(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export function planRotation(vars: readonly DevVar[], requested: readonly string[]): RotationPlan {
  const known = new Map(vars.map((v) => [v.name, v]));
  const unknown = requested.filter((name) => !known.has(name));
  const unmarked = requested.filter((name) => {
    const kind = known.get(name)?.kind;
    return kind !== undefined && kind !== "rotatable";
  });

  if (unknown.length > 0 || unmarked.length > 0) return err({ unknown, unmarked });
  return ok([...requested]);
}

/** The refusal, phrased so the reader knows which fix applies to which name. */
export function describeRefusal(refusal: RotationRefusal, path: string): string {
  const lines: string[] = [];
  if (refusal.unknown.length > 0) {
    lines.push(`Not defined in ${path}: ${refusal.unknown.join(", ")}`);
  }
  if (refusal.unmarked.length > 0) {
    lines.push(
      `Not marked rotatable in ${path}: ${refusal.unmarked.join(", ")}`,
      `Rotation overwrites a value irrecoverably, so it is opt-in. Add a "${GENERATE_MARKER}" line above a key only if this project generated it — never for a third-party credential.`,
    );
  }
  return lines.join("\n");
}

/**
 * Rotate the named keys in `.dev.vars` itself.
 *
 * Local and remote rotation are separate acts on purpose: a remote secret is never
 * copied onto this machine, so the two sides hold different values by design and
 * `--local` is how the development value is replaced.
 */
export function rotateSecrets(path: string, names: readonly string[]): string[] {
  const updates = new Map(names.map((name) => [name, randomSecret()]));
  writeDevVars(path, editDevVars(readFileSync(path, "utf-8"), updates));
  return [...updates.keys()];
}
