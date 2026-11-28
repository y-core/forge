import { afterAll, describe, expect, it } from "bun:test";

import { addedStructure, mergeReviewed, preparePush } from "./merge";
import { type FixtureRepo, fixtureRepo } from "./repo.fixture";

const repos: FixtureRepo[] = [];
afterAll(() => {
  for (const made of repos) made.remove();
});

const GREEN = ["true"];

function repo(): FixtureRepo {
  const made = fixtureRepo();
  repos.push(made);
  return made;
}

function task(fixture: FixtureRepo, id: string, file: string, from = "main"): string {
  fixture.git("switch", "--quiet", "-c", `task/${id}`, from);
  const sha = fixture.commit(file, `${id}\n`, `Do ${id}`);
  fixture.git("switch", "--quiet", "main");
  return sha;
}

describe("mergeReviewed()", () => {
  it("fast-forwards main to a reviewed sha", () => {
    const fixture = repo();
    const sha = task(fixture, "a", "lib/a.txt");
    expect(mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [{ id: "a", sha }])).toEqual({
      ok: true,
      data: [{ id: "a", sha, rebased: false }],
    });
    expect(fixture.git("rev-parse", "main")).toBe(sha);
  });

  it("rebases a task whose base moved, and merges it while its patch id holds", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/a.txt");
    const b = task(fixture, "b", "lib/b.txt");
    const merged = mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [
      { id: "a", sha: a },
      { id: "b", sha: b },
    ]);

    expect(merged.ok && merged.data.map((entry) => entry.rebased)).toEqual([false, true]);
    expect(fixture.git("log", "--format=%s", "origin/main..main").split("\n")).toEqual(["Do b", "Do a"]);
  });

  it("sends back a task whose rebase conflicts, since the resolution was never reviewed", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/same.txt");
    const b = task(fixture, "b", "lib/same.txt");
    const merged = mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [
      { id: "a", sha: a },
      { id: "b", sha: b },
    ]);
    expect(merged.ok ? "" : merged.error).toStartWith("b: rebasing task/b onto main stopped on a conflict");
    expect(fixture.git("rev-parse", "main")).toBe(a);
  });
});

describe("preparePush()", () => {
  it("rebases onto the remote holding patch ids, checks the tip, squashes, and prints the push without running it", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/a.txt");
    const b = task(fixture, "b", "lib/b.txt", a);
    mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [
      { id: "a", sha: a },
      { id: "b", sha: b },
    ]);
    // Someone else pushed meanwhile.
    fixture.git("switch", "--quiet", "-c", "other", "origin/main");
    fixture.commit("lib/other.txt", "o\n");
    fixture.git("push", "--quiet", "origin", "other:main");
    fixture.git("switch", "--quiet", "main");

    const prepared = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: GREEN }, { message: "minor: Do a and b", ids: ["a", "b"] });
    if (!prepared.ok) throw new Error(prepared.error);

    expect(prepared.data.state).toBe("ready");
    expect(fixture.git("log", "--format=%s", "origin/main..main")).toBe("minor: Do a and b");
    expect(prepared.data.state === "ready" && prepared.data.push).toEqual(["git push origin main", "git branch -D task/a", "git branch -D task/b"]);
    expect(fixture.git("ls-remote", "origin", "main").split("\t")[0]).not.toBe(fixture.git("rev-parse", "main"));
  });

  it("stops after the rebase for an epic's full gate, then goes on once given the tip it checked", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/a.txt");
    mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [{ id: "a", sha: a }]);

    const first = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: ["false"] }, { full: true });
    expect(first).toEqual({
      ok: true,
      data: { state: "needs-full-gate", tip: a, next: `send \`bun run verify\` on ${a} to cc-tester, then rerun with --checked=${a}` },
    });
    expect(preparePush({ cwd: fixture.cwd, logDir: fixture.logDir }, { full: true, checked: "0".repeat(40) }).ok).toBe(false);
    const second = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: ["false"] }, { full: true, checked: a });
    expect(second.ok && second.data.state).toBe("ready");
  });

  it("pushes nothing when the check is red, or when several commits have no squash message", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/a.txt");
    const b = task(fixture, "b", "lib/b.txt", a);
    mergeReviewed({ cwd: fixture.cwd, logDir: fixture.logDir }, [
      { id: "a", sha: a },
      { id: "b", sha: b },
    ]);

    const red = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: ["false"] }, { message: "m" });
    expect(red.ok ? "" : red.error).toStartWith("not pushed — `false` is red");
    expect(preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: GREEN }, {})).toEqual({
      ok: false,
      error: "2 commits are unpushed — pass --message with the squashed commit's message",
    });
  });

  it("stops on a unit adding a root file and a new directory, naming both, and goes on with --structure-approved", () => {
    const fixture = repo();
    fixture.git("switch", "--quiet", "-c", "task/a", "main");
    fixture.commit("NOTES.md", "n\n");
    const a = fixture.commit("lib/deep/x.ts", "x\n", "Do a");
    fixture.git("switch", "--quiet", "main");
    mergeReviewed({ cwd: fixture.cwd }, [{ id: "a", sha: a }]);
    const env = { cwd: fixture.cwd, logDir: fixture.logDir, check: GREEN };

    expect(preparePush(env, { message: "m" })).toEqual({
      ok: false,
      error:
        "the unit adds structure the user has not approved — new root file(s): NOTES.md; new director(ies): lib/deep. Nothing is pushed: ask the user, and rerun with --structure-approved only once they say yes",
    });
    expect(fixture.git("rev-parse", "main")).toBe(a);
    const approved = preparePush(env, { message: "m", structureApproved: true });
    expect(approved.ok && approved.data.state).toBe("ready");
  });

  it("names a new root directory, and passes a unit adding files only inside existing directories", () => {
    const fixture = repo();
    const a = task(fixture, "a", "tools/x.ts");
    mergeReviewed({ cwd: fixture.cwd }, [{ id: "a", sha: a }]);
    expect(addedStructure(fixture.cwd, "origin/main", "main")).toEqual({ ok: true, data: ["new director(ies): tools"] });

    const inside = repo();
    const b = task(inside, "b", "lib/y.ts");
    mergeReviewed({ cwd: inside.cwd }, [{ id: "b", sha: b }]);
    expect(addedStructure(inside.cwd, "origin/main", "main")).toEqual({ ok: true, data: [] });
  });

  it("puts main back at the checked tip when the squash commit fails", () => {
    const fixture = repo();
    const a = task(fixture, "a", "lib/a.txt");
    const b = task(fixture, "b", "lib/b.txt", a);
    mergeReviewed({ cwd: fixture.cwd }, [
      { id: "a", sha: a },
      { id: "b", sha: b },
    ]);

    const result = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: GREEN }, { message: "" });
    expect(result.ok ? "" : result.error).toStartWith(`the squash commit failed, so main is back at the checked tip ${b.slice(0, 8)}`);
    expect(fixture.git("rev-parse", "main")).toBe(b);
  });

  it("puts main back where it was when the rebase changes an unpushed commit's patch", () => {
    const fixture = repo();
    fixture.commit("lib/ctx.txt", "a\nx\ny\nc\n", "context");
    fixture.git("push", "--quiet", "origin", "main");
    const local = fixture.commit("lib/ctx.txt", "a\nx\ny\nC\n", "local edit");
    fixture.git("switch", "--quiet", "-c", "other", "origin/main");
    fixture.commit("lib/ctx.txt", "A\nx\ny\nc\n", "upstream edit in its context");
    fixture.git("push", "--quiet", "origin", "other:main");
    fixture.git("switch", "--quiet", "main");

    const result = preparePush({ cwd: fixture.cwd, logDir: fixture.logDir, check: GREEN }, {});
    expect(result.ok ? "" : result.error).toContain(`nothing is pushed, and main is back at ${local.slice(0, 8)}`);
    expect(fixture.git("rev-parse", "main")).toBe(local);
  });
});
