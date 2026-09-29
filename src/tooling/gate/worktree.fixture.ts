import { spawnSync } from "node:child_process";

import { gateFixtureRoot } from "./checks/gate.fixture";
import { worktreeGitEnv } from "./worktree";

function gitIn(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: worktreeGitEnv() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${result.stderr ?? ""}`);
}

/** A throwaway git repository holding exactly `files`, all committed. */
export function worktreeFixture(files: Record<string, string> = {}): string {
  const root = gateFixtureRoot(files, "forge-worktree-");
  gitIn(root, ["init", "-q"]);
  gitIn(root, ["add", "-A"]);
  gitIn(root, [
    "-c",
    "user.name=gate",
    "-c",
    "user.email=gate@fixture.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  return root;
}
