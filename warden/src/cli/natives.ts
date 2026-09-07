import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../../src/tooling/cli/errors";

/** The platform-arch the editor architecture is built for by default. @public */
export const DEFAULT_ARCH = "darwin-arm64";

/** Parent package → platform package name; each family spells the platform suffix differently. @public */
export function bindings(arch: string): Array<{ parent: string; pkg: string }> {
  return [
    { parent: "oxlint", pkg: `@oxlint/binding-${arch}` },
    { parent: "oxfmt", pkg: `@oxfmt/binding-${arch}` },
    { parent: "oxlint-tsgolint", pkg: `@oxlint-tsgolint/${arch}` },
    { parent: "typescript", pkg: `@typescript/typescript-${arch}` },
  ];
}

/** Spawned as processes rather than `dlopen`'d, so these two alone need the executable bit. @public */
export function executables(arch: string): string[] {
  return [`node_modules/@typescript/typescript-${arch}/lib/tsc`, `node_modules/@oxlint-tsgolint/${arch}/tsgolint`];
}

/** The version `root` declares for `name`, stripped of its range prefix; null when it declares none. @public */
export function declaredVersion(root: string, name: string): string | null {
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) throw new CliError("invalid-args", `no package.json in ${root} — run this from a repository root`);
  const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const range = { ...pkg.dependencies, ...pkg.devDependencies }[name];
  return range ? range.replace(/^[\^~]/, "") : null;
}

/** The version already unpacked at `dir`, or null when nothing is installed there. @public */
export function installedVersion(dir: string): string | null {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return null;
  try {
    return (JSON.parse(readFileSync(manifest, "utf-8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Downloads one prebuilt package into `target`, verifying it against the registry's own sha1. */
async function fetchBinding(pkg: string, version: string, target: string): Promise<void> {
  // Only the slash is escaped: the registry serves `@scope%2fname`, and rejects an encoded `@`.
  const meta = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/${version}`);
  if (!meta.ok) throw new CliError("invalid-args", `registry returned ${meta.status} for ${pkg}@${version}`);
  const { tarball, shasum } = ((await meta.json()) as { dist: { tarball: string; shasum: string } }).dist;

  const response = await fetch(tarball);
  if (!response.ok) throw new CliError("invalid-args", `registry returned ${response.status} for ${tarball}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  const digest = createHash("sha1").update(bytes).digest("hex");
  if (digest !== shasum) throw new CliError("invalid-args", `sha1 mismatch for ${pkg}@${version}: expected ${shasum}, got ${digest}`);

  const tmp = mkdtempSync(join(tmpdir(), "warden-natives-"));
  try {
    const archive = join(tmp, "pkg.tgz");
    writeFileSync(archive, bytes);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    execFileSync("tar", ["xzf", archive, "-C", target, "--strip-components=1"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Places the prebuilt bindings for `arch` into `root`'s node_modules, skipping any whose parent is
 *  not a dependency. @public */
export async function placeNatives(root: string, arch: string): Promise<void> {
  for (const { parent, pkg } of bindings(arch)) {
    const version = declaredVersion(root, parent);
    if (!version) {
      console.log(`skip     ${pkg} — ${parent} is not a dependency`);
      continue;
    }
    const target = join(root, "node_modules", pkg);
    if (installedVersion(target) === version) {
      console.log(`ok       ${pkg}@${version}`);
      continue;
    }
    await fetchBinding(pkg, version, target);
    console.log(`fetched  ${pkg}@${version}`);
  }

  // The bit is set here and in the tarball, but the macOS side of a shared mount does not always
  // observe it, so the same chmod has to be run from the host before the editor can spawn them.
  const spawnable = executables(arch).filter((exe) => existsSync(join(root, exe)));
  for (const exe of spawnable) chmodSync(join(root, exe), 0o755);

  console.log(`\n${arch} bindings in place.`);
  if (spawnable.length > 0) {
    console.log("If the editor reports 'Permission denied', run this on the host, then restart it:");
    for (const exe of spawnable) console.log(`  chmod +x ${exe}`);
  }
}
