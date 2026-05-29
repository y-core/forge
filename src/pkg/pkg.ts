import * as fs from "node:fs";
import { resolve } from "node:path";
import { ReleaseError } from "./types";

export function readPackageVersion(cwd: string): string {
  const pkgPath = resolve(cwd, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (!parsed.version) {
      throw new ReleaseError("invalid-version", `No version field in ${pkgPath}`);
    }
    return parsed.version;
  } catch (err) {
    if (err instanceof ReleaseError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("invalid-version", `Failed to read package.json: ${msg}`);
  }
}

export function updatePackageVersion(version: string, cwd: string): void {
  const pkgPath = resolve(cwd, "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("pkg-update", `Failed to read package.json: ${msg}`);
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.version = version;
    const indentMatch = raw.match(/\n(\s+)"/);
    const indent = indentMatch ? indentMatch[1] : "  ";
    fs.writeFileSync(pkgPath, `${JSON.stringify(parsed, null, indent)}\n`, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("pkg-update", `Failed to write package.json: ${msg}`);
  }
}
