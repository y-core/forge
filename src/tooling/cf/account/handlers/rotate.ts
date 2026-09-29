import { readFileSync } from "node:fs";

import { bytesToHex, randomBytes } from "../../../../crypto/mod";
import { err, ok } from "../../../../result/result";
import { editDevVars, GENERATE_MARKER, parseDevVars, RING_MARKER, writeDevVars } from "./devvars";
import type { DevVar } from "./types";
import type { RotationPlan, RotationRefusal } from "./types";

/** A fresh secret of hex-encoded CSPRNG bytes. */
export function randomSecret(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export function planRotation(vars: readonly DevVar[], requested: readonly string[]): RotationPlan {
  const known = new Map(vars.map((v) => [v.name, v]));
  const unknown = requested.filter((name) => !known.has(name));
  const unmarked = requested.filter((name) => {
    const kind = known.get(name)?.kind;
    return kind !== undefined && kind !== "rotatable" && kind !== "ring";
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
      `A key ring rotates by prepending a key and keeping the old ones: mark it "${RING_MARKER}" instead.`,
    );
  }
  return lines.join("\n");
}

/** Rotates the named keys in `.dev.vars` itself, prepending to a ring and replacing anything else, returning the names it rotated. */
export function rotateSecrets(path: string, names: readonly string[]): string[] {
  const content = readFileSync(path, "utf-8");
  const rings = new Map(
    parseDevVars(content)
      .filter((v) => v.kind === "ring")
      .map((v) => [v.name, v.value.trim()]),
  );
  const updates = new Map(
    names.map((name) => {
      const ring = rings.get(name);
      return [name, ring ? `${randomSecret()},${ring}` : randomSecret()];
    }),
  );
  writeDevVars(path, editDevVars(content, updates));
  return [...updates.keys()];
}
