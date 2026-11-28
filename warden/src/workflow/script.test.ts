import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type FixtureRepo, fixtureRepo } from "./repo.fixture";
import { handoffScript, mergeScript } from "./script";

const repos: FixtureRepo[] = [];
afterAll(() => {
  for (const made of repos) made.remove();
});

let printed: string[] = [];
const { log, error } = console;
beforeEach(() => {
  printed = [];
  console.log = (line: string) => printed.push(line);
  console.error = (line: string) => printed.push(line);
});
afterEach(() => {
  console.log = log;
  console.error = error;
});

function repo(): FixtureRepo {
  const made = fixtureRepo();
  repos.push(made);
  made.git("switch", "--quiet", "-c", "task/feat-1");
  made.commit("lib/a.txt", "a\n", "wip");
  made.git("switch", "--quiet", "main");
  return made;
}

describe("handoffScript()", () => {
  it("prints each resolution and the brief, and exits 0", () => {
    const fixture = repo();
    expect(handoffScript(["feat-1", "--message", "Add a"], { cwd: fixture.cwd, logDir: fixture.logDir, check: ["true"], log: () => {} })).toBe(0);
    expect(printed.at(-1)).toBe(
      `\ncc-reviewer brief:\nhandoff: 1 task(s) in review\nids: feat-1\nsha: feat-1 ${fixture.git("rev-parse", "--short=8", "task/feat-1")}`,
    );
  });

  it("exits 2 with the usage on no ids, or one message for several tasks", () => {
    expect(handoffScript([], { cwd: "/" })).toBe(2);
    expect(handoffScript(["a", "b", "--message=x"], { cwd: "/" })).toBe(2);
  });
});

describe("mergeScript()", () => {
  it("merges <id>=<sha> pairs, then prepares the push it prints", () => {
    const fixture = repo();
    const sha = fixture.git("rev-parse", "task/feat-1");
    expect(mergeScript(["merge", `feat-1=${sha}`], { cwd: fixture.cwd, logDir: fixture.logDir })).toBe(0);
    expect(mergeScript(["push", "--ids=feat-1"], { cwd: fixture.cwd, logDir: fixture.logDir, check: ["true"] })).toBe(0);
    expect(printed.at(-1)).toEndWith("Run:\ngit push origin main\ngit branch -D task/feat-1");
  });

  it("stops a push adding a root file and a new directory, naming both, and prepares it under --structure-approved", () => {
    const fixture = repo();
    fixture.git("switch", "--quiet", "task/feat-1");
    fixture.commit("TODO.md", "t\n");
    fixture.commit("lib/new/b.txt", "b\n");
    fixture.git("switch", "--quiet", "main");
    const env = { cwd: fixture.cwd, logDir: fixture.logDir, check: ["true"] };
    expect(mergeScript(["merge", `feat-1=${fixture.git("rev-parse", "task/feat-1")}`], env)).toBe(0);

    expect(mergeScript(["push", "--message=m", "--ids=feat-1"], env)).toBe(1);
    expect(printed.at(-1)).toContain("new root file(s): TODO.md; new director(ies): lib/new");
    expect(fixture.git("rev-list", "--count", "origin/main..main")).toBe("3");
    expect(mergeScript(["push", "--message=m", "--ids=feat-1", "--structure-approved"], env)).toBe(0);
    expect(printed.at(-1)).toEndWith("Run:\ngit push origin main\ngit branch -D task/feat-1");
  });

  it("exits 2 on an unknown step or a malformed pair", () => {
    expect(mergeScript(["rebase"], { cwd: "/" })).toBe(2);
    expect(mergeScript(["merge", "feat-1"], { cwd: "/" })).toBe(2);
  });
});
