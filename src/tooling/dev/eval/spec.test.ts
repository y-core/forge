import { afterAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadTask, specHash } from "./spec";
import { removeAll, SAMPLE_FILES, sampleSpec, writeTaskDir } from "./task.fixture";

const roots: string[] = [];
afterAll(() => removeAll(roots));

function taskDir(spec: unknown = sampleSpec(), omit: readonly string[] = []): string {
  const { root, dir } = writeTaskDir(spec, SAMPLE_FILES, omit);
  roots.push(root);
  return dir;
}

describe("loadTask()", () => {
  it("returns the spec with its absolute directory when every file it names is present", () => {
    const dir = taskDir();
    expect(loadTask(dir)).toEqual({ ...sampleSpec(), dir });
  });

  it("defaults the bait to none", () => {
    const { bait: _bait, ...spec } = sampleSpec();
    const dir = taskDir(spec, ["bait/helper.patch"]);
    expect(loadTask(dir).bait).toEqual([]);
  });

  it("refuses a trap with no plant patch, since calibration could not prove its detector", () => {
    expect(() => loadTask(taskDir(sampleSpec(), ["plants/co-location.patch"]))).toThrow(/missing plants\/co-location\.patch/);
  });

  it.each([
    ["prompt.md"],
    ["reference.patch"],
    ["bait/helper.patch"],
    ["accept/src/sample/sample.accept.test.ts"],
    ["accept/src/sample/refusal.accept.test.ts"],
  ])("refuses a spec whose %s is missing", (file) => {
    expect(() => loadTask(taskDir(sampleSpec(), [file]))).toThrow(`missing ${file}`);
  });

  it("refuses an unknown field, naming it", () => {
    expect(() => loadTask(taskDir({ ...sampleSpec(), reps: 3 }))).toThrow(/reps/);
  });

  it("refuses a path that climbs out of the task directory", () => {
    expect(() => loadTask(taskDir({ ...sampleSpec(), bait: ["../outside.patch"] }))).toThrow(/bait\.0: must be relative/);
  });

  it("refuses two traps sharing an id", () => {
    const spec = sampleSpec();
    const [first] = spec.traps;
    if (first === undefined) throw new Error("sampleSpec has no trap");
    expect(() => loadTask(taskDir({ ...spec, traps: [first, first] }))).toThrow(/trap ids must be unique/);
  });

  it("refuses an id that does not match the task's directory", () => {
    const dir = taskDir();
    writeFileSync(join(dir, "task.json"), JSON.stringify({ ...sampleSpec(), id: "other-task" }), "utf-8");
    expect(() => loadTask(dir)).toThrow(/does not match its directory/);
  });

  it("names the file when task.json is not JSON", () => {
    const dir = taskDir();
    writeFileSync(join(dir, "task.json"), "{", "utf-8");
    expect(() => loadTask(dir)).toThrow(/task\.json is not JSON/);
  });
});

describe("specHash()", () => {
  it("is equal for two directories holding the same files", () => {
    expect(specHash(taskDir())).toBe(specHash(taskDir()));
  });

  it("changes when any file's content changes", () => {
    const dir = taskDir();
    const before = specHash(dir);
    writeFileSync(join(dir, "accept", "src", "sample", "sample.accept.test.ts"), "changed\n", "utf-8");
    expect(specHash(dir)).not.toBe(before);
  });

  it("changes when a file is added", () => {
    const dir = taskDir();
    const before = specHash(dir);
    writeFileSync(join(dir, "notes.md"), "", "utf-8");
    expect(specHash(dir)).not.toBe(before);
  });
});
