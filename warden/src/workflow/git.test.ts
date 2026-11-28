import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { git, isClean, patchId, patchIds, runCheck } from "./git";
import { type FixtureRepo, fixtureRepo } from "./repo.fixture";

const repos: FixtureRepo[] = [];
afterAll(() => {
  for (const made of repos) made.remove();
});

function repo(): FixtureRepo {
  const made = fixtureRepo();
  repos.push(made);
  return made;
}

describe("git()", () => {
  it("answers trimmed stdout, or names the command and what git said", () => {
    const { cwd } = repo();
    expect(git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).toEqual({ ok: true, data: "main" });
    const missing = git(cwd, "rev-parse", "--verify", "no-such-ref");
    expect(missing.ok ? "" : missing.error).toStartWith("git rev-parse --verify no-such-ref failed (exit 128)");
  });
});

describe("patchId() and patchIds()", () => {
  it("gives a cherry-picked commit the same patch id as its original", () => {
    const fixture = repo();
    fixture.git("switch", "--quiet", "-c", "side");
    const original = fixture.commit("a.txt", "a\n");
    fixture.git("switch", "--quiet", "main");
    fixture.commit("b.txt", "b\n");
    fixture.git("cherry-pick", original);

    expect(patchId(fixture.cwd, "HEAD")).toEqual(patchId(fixture.cwd, original));
    const ids = patchIds(fixture.cwd, "origin/main..main");
    expect(ids.ok && ids.data.length).toBe(2);
  });
});

describe("isClean()", () => {
  it("reads a tracked edit as dirty and an untracked file as clean", () => {
    const fixture = repo();
    writeFileSync(join(fixture.cwd, "new.txt"), "x\n");
    expect(isClean(fixture.cwd)).toBe(true);
    writeFileSync(join(fixture.cwd, "base.txt"), "changed\n");
    expect(isClean(fixture.cwd)).toBe(false);
  });
});

describe("runCheck()", () => {
  it("writes the check's whole stream to a file, and names the file and the tail when it is red", () => {
    const { cwd, logDir } = repo();
    const green = runCheck({ cwd, logDir, check: ["sh", "-c", "echo fine"] }, "t");
    expect(green.ok && readFileSync(green.data, "utf-8")).toBe("fine\n");

    const red = runCheck({ cwd, logDir, check: ["sh", "-c", "echo broke; exit 3"] }, "t");
    expect(red.ok ? "" : red.error).toMatch(/^`sh -c echo broke; exit 3` is red \(exit 3\) — full log at .+\nbroke$/);
  });
});
