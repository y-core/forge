import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A work tree with a bare `origin`, `main` pushed to it, for the workflow specs. */
export interface FixtureRepo {
  readonly cwd: string;
  readonly origin: string;
  /** Inside the fixture, so a check log goes when the fixture does. */
  readonly logDir: string;
  git(...args: string[]): string;
  commit(file: string, body: string, message?: string): string;
  remove(): void;
}

/** Creates a repository whose `main` holds `base.txt` and `lib/base.txt` and is pushed to a bare `origin`. */
export function fixtureRepo(): FixtureRepo {
  const top = mkdtempSync(join(tmpdir(), "forge-workflow-repo-"));
  const origin = join(top, "origin.git");
  const cwd = join(top, "work");
  const run = (dir: string, ...args: string[]): string => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  run(top, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  run(top, "init", "--quiet", "--initial-branch=main", cwd);
  for (const [key, value] of [
    ["user.email", "t@example.com"],
    ["user.name", "T"],
    ["commit.gpgsign", "false"],
  ])
    run(cwd, "config", key ?? "", value ?? "");
  run(cwd, "remote", "add", "origin", origin);
  const repo: FixtureRepo = {
    cwd,
    origin,
    logDir: join(top, "logs"),
    git: (...args) => run(cwd, ...args),
    commit: (file, body, message = `edit ${file}`) => {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), body);
      run(cwd, "add", file);
      run(cwd, "commit", "--quiet", "-m", message);
      return run(cwd, "rev-parse", "HEAD");
    },
    remove: () => rmSync(top, { recursive: true, force: true }),
  };
  repo.commit("base.txt", "base\n", "base");
  repo.commit("lib/base.txt", "base\n", "lib");
  run(cwd, "push", "--quiet", "origin", "main");
  return repo;
}
