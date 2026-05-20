import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReleaseError } from "./types";

export function readPackageVersion(cwd: string): string {
  const pkgPath = resolve(cwd, "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf-8");
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
  try {
    execSync(`npm version ${version} --no-git-tag-version`, { cwd, encoding: "utf-8" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("git-error", `npm version failed: ${msg}`);
  }
}
