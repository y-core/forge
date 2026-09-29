import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

const GIT_LOCATION_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
];

/** The process environment without git's repository-location variables, so a spawned `git` finds its repository from `cwd` alone. */
export function worktreeGitEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of GIT_LOCATION_VARIABLES) delete env[name];
  return env;
}

function git(cwd: string, args: string[], env?: Record<string, string | undefined>): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: env ?? worktreeGitEnv() });
  return { ok: result.status === 0, out: result.stdout ?? "" };
}

/** Resolves `name` inside the git directory of the work tree at `cwd`, or `undefined` outside one. */
export function worktreeGitPath(cwd: string, name: string): string | undefined {
  const result = git(cwd, ["rev-parse", "--git-path", name]);
  return result.ok ? resolve(cwd, result.out.trim()) : undefined;
}

/** Hashes the working tree at `cwd` as `git write-tree` would after `git add -A`, leaving the real index untouched. */
export function worktreeHash(cwd: string): string | undefined {
  const index = worktreeGitPath(cwd, "index");
  if (index === undefined) return undefined;
  const dir = mkdtempSync(join(tmpdir(), "forge-receipt-"));
  try {
    if (existsSync(index)) copyFileSync(index, join(dir, "index"));
    const env = { ...worktreeGitEnv(), GIT_INDEX_FILE: join(dir, "index") };
    if (!git(cwd, ["add", "-A"], env).ok) return undefined;
    const written = git(cwd, ["write-tree"], env);
    return written.ok ? written.out.trim() : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function paths(out: string): string[] {
  return out.split("\0").filter((path) => path !== "");
}

/** Lists every path the working tree at `cwd` changes against `HEAD`, untracked files in and ignored ones out, relative to `cwd`. */
export function worktreeChanges(cwd: string): readonly string[] | undefined {
  const prefix = git(cwd, ["rev-parse", "--show-prefix"]);
  if (!prefix.ok) return undefined;
  const headless = !git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok;
  const listings = headless
    ? [git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name", ":/"])]
    : [
        git(cwd, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
        git(cwd, ["ls-files", "-z", "--others", "--exclude-standard", "--full-name", ":/"]),
      ];
  if (listings.some((listing) => !listing.ok)) return undefined;
  const base = "/" + prefix.out.trim();
  const relative = listings.flatMap((listing) => paths(listing.out)).map((path) => posix.relative(base, "/" + path));
  return [...new Set(relative)].sort();
}
