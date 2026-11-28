import { afterAll, describe, expect, it } from "bun:test";

import { handoff } from "./handoff";
import { type FixtureRepo, fixtureRepo } from "./repo.fixture";

const repos: FixtureRepo[] = [];
afterAll(() => {
  for (const repo of repos) repo.remove();
});

const GREEN = ["true"];

function withTask(commits: number): FixtureRepo {
  const repo = fixtureRepo();
  repos.push(repo);
  repo.git("switch", "--quiet", "-c", "task/feat-1");
  for (let i = 0; i < commits; i++) repo.commit(`f${i}.txt`, `${i}\n`, `wip ${i}`);
  repo.git("switch", "--quiet", "main");
  return repo;
}

describe("handoff()", () => {
  it("squashes a branch to one commit on its base, checks it, and returns the resolution and the brief", () => {
    const repo = withTask(3);
    repo.commit("main-moved.txt", "m\n");
    const result = handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN, log: () => {} }, [{ id: "feat-1", message: "Add the thing" }]);
    if (!result.ok) throw new Error(result.error);

    const sha = repo.git("rev-parse", "task/feat-1");
    expect(repo.git("rev-list", "--count", "main..task/feat-1")).toBe("1");
    expect(repo.git("log", "-1", "--format=%s", "task/feat-1")).toBe("Add the thing");
    expect(repo.git("merge-base", "--is-ancestor", "main", "task/feat-1")).toBe("");
    expect(result.data.tasks[0]?.resolution).toBe(`sha: ${sha}; check: true green;`);
    expect(result.data.brief).toBe(`handoff: 1 task(s) in review\nids: feat-1\nsha: feat-1 ${sha.slice(0, 8)}`);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("keeps a branch's one commit when no message is given", () => {
    const repo = withTask(1);
    const before = repo.git("rev-parse", "task/feat-1");
    const result = handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN, log: () => {} }, [{ id: "feat-1" }]);
    expect(result.ok && result.data.tasks[0]?.sha).toBe(before);
  });

  it("refuses to squash several commits without the one commit's message", () => {
    const repo = withTask(2);
    expect(handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN, log: () => {} }, [{ id: "feat-1" }])).toEqual({
      ok: false,
      error: "feat-1: task/feat-1 holds 2 commits above main — pass --message with the one commit's message to squash them",
    });
  });

  it("does not hand off a commit whose check is red", () => {
    const repo = withTask(1);
    const result = handoff({ cwd: repo.cwd, logDir: repo.logDir, check: ["false"], log: () => {} }, [{ id: "feat-1" }]);
    expect(result.ok ? "" : result.error).toStartWith("feat-1: not handed off — `false` is red (exit 1)");
  });

  it("names a missing branch, a rebase conflict and a dirty tree", () => {
    const repo = withTask(1);
    expect(handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN }, [{ id: "feat-9" }])).toEqual({
      ok: false,
      error: "feat-9: there is no branch task/feat-9 to hand off",
    });

    repo.commit("f0.txt", "conflicting\n");
    const conflict = handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN, log: () => {} }, [{ id: "feat-1" }]);
    expect(conflict.ok ? "" : conflict.error).toStartWith("feat-1: rebasing task/feat-1 onto main stopped");
    expect(repo.git("status", "--porcelain")).toBe("");

    repo.commit("base.txt", "x\n");
    repo.git("reset", "--quiet", "HEAD~1");
    expect(handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN }, [{ id: "feat-1" }]).ok).toBe(false);
  });

  it("puts the branch back where it was when the squash commit fails", () => {
    const repo = withTask(2);
    const before = repo.git("rev-parse", "task/feat-1");
    const result = handoff({ cwd: repo.cwd, logDir: repo.logDir, check: GREEN, log: () => {} }, [{ id: "feat-1", message: "" }]);

    expect(result.ok ? "" : result.error).toStartWith(`feat-1: the squash commit failed, so task/feat-1 is back at ${before.slice(0, 8)}`);
    expect(repo.git("rev-parse", "task/feat-1")).toBe(before);
  });
});
