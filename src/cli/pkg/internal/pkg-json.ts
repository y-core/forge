import * as fs from "node:fs";
import { resolve } from "node:path";
import { ReleaseError } from "../types";

/** Reads the `version` field from `package.json` in `cwd`, throwing a {@link ReleaseError} if it is missing or unreadable. */
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

/** The repository's base URL for compare links, normalised, or `null` when `package.json` carries no usable `repository` field. */
export function readRepositoryUrl(cwd: string): string | null {
  const pkgPath = resolve(cwd, "package.json");
  let parsed: { repository?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { repository?: unknown };
  } catch {
    return null;
  }
  const repo = parsed.repository;
  const raw = typeof repo === "string" ? repo : typeof repo === "object" && repo !== null ? (repo as { url?: unknown }).url : undefined;
  if (typeof raw !== "string" || raw === "") return null;
  return raw.replace(/^git\+/, "").replace(/\.git$/, "");
}

/** Reads the changelog at `file`, or returns `null` when it does not exist. */
export function readChangelog(cwd: string, file: string): string | null {
  const path = resolve(cwd, file);
  if (!fs.existsSync(path)) return null;
  try {
    return fs.readFileSync(path, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("pkg-update", `Failed to read ${file}: ${msg}`);
  }
}

/** Writes `source` to the changelog at `file` verbatim. */
export function writeChangelog(cwd: string, file: string, source: string): void {
  try {
    // No trailing-newline normalisation: `promoteUnreleased` round-trips the document byte-for-byte,
    // and adding one here would put a spurious hunk in a file that never had one.
    fs.writeFileSync(resolve(cwd, file), source, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("pkg-update", `Failed to write ${file}: ${msg}`);
  }
}

/** Updates the `version` field in `package.json`, preserving its existing indentation. */
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
