import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readRound, roundPath, serializeRound, writeTaskResult } from "./results";
import { roundFile, taskResult } from "./round.fixture";
import { removeAll } from "./task.fixture";
import type { RoundFile } from "./types";
import { callsTo, fakeWorld } from "./world.fixture";

const RECORDED = { forgeSha: "a".repeat(40), settingSources: ["user", "project"] };

const roots: string[] = [];
afterAll(() => removeAll(roots));

function world(): ReturnType<typeof fakeWorld> {
  const made = fakeWorld();
  roots.push(made.root);
  return made;
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .reverse()
      .map((key) => [key, reversedKeys((value as Record<string, unknown>)[key])]),
  );
}

describe("serializeRound()", () => {
  it("is byte-stable for equal input, whatever order its keys were built in", () => {
    const round = roundFile("r1", { b: taskResult(), a: taskResult() });
    expect(serializeRound(reversedKeys(round) as RoundFile)).toBe(serializeRound(round));
    expect(serializeRound(round)).toBe(serializeRound(structuredClone(round)));
  });

  it("sorts keys at every depth and keeps array order", () => {
    const text = serializeRound(roundFile("r1", { b: taskResult(), a: taskResult() }));
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(text.indexOf('"forgeSha"')).toBeLessThan(text.indexOf('"round"'));
    const parsed = JSON.parse(text) as RoundFile;
    expect(parsed.tasks.a?.runs.map((run) => run.rep)).toEqual([1, 2, 3]);
  });
});

describe("writeTaskResult()", () => {
  it("writes tests/evals/results/<round>.json and formats it with bun fmt", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    expect(path).toBe(join(w.env.evalsDir, "results", "r1.json"));
    expect(readRound(path)).toEqual(roundFile("r1"));
    expect(callsTo(w.spawn, "bun")).toContainEqual(["fmt", "--no-script", path]);
  });

  it("keeps the other tasks already in the round", () => {
    const w = world();
    writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    const path = writeTaskResult(w.env, "r1", RECORDED, "u", taskResult({ model: "sonnet" }));
    expect(Object.keys(readRound(path).tasks)).toEqual(["t", "u"]);
  });

  it("refuses to add to a round recorded at another forge commit", () => {
    const w = world();
    writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, forgeSha: "b".repeat(40) }, "u", taskResult())).toThrow(/name a new round/);
  });

  it("records the setting sources, and refuses to add to a round recorded under others", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    expect(readRound(path).settingSources).toEqual(["user", "project"]);
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, settingSources: ["user", "project", "local"] }, "u", taskResult())).toThrow(
      /recorded under setting sources user,project, not user,project,local/,
    );
  });

  it("records the claude version, and refuses to add to a round recorded under another", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", { ...RECORDED, claudeVersion: "2.1.330" }, "t", taskResult());
    expect(readRound(path).claudeVersion).toBe("2.1.330");
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, claudeVersion: "2.1.331" }, "u", taskResult())).toThrow(
      /recorded under 2.1.330, not 2.1.331 — name a new round/,
    );
  });

  it("records the session mode and Code Mode, and refuses to add to a round recorded under either other one", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", { ...RECORDED, mode: "interactive", codeMode: true }, "t", taskResult());
    expect(readRound(path)).toMatchObject({ mode: "interactive", codeMode: true });
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, mode: "print", codeMode: true }, "u", taskResult())).toThrow(
      /recorded in interactive mode, not print mode — name a new round/,
    );
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, mode: "interactive", codeMode: false }, "u", taskResult())).toThrow(
      /recorded with Code Mode on, not off — name a new round/,
    );
  });

  it("refuses to add a moded result to a round recorded before rounds carried a mode, and loads that round still", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    expect(readRound(path).mode).toBeUndefined();
    expect(() => writeTaskResult(w.env, "r1", { ...RECORDED, mode: "print", codeMode: false }, "u", taskResult())).toThrow(
      /recorded in an unrecorded mode, not print mode/,
    );
  });

  it("refuses to add to a round file that never recorded its setting sources", () => {
    const w = world();
    const path = roundPath(w.env, "r1");
    mkdirSync(join(w.env.evalsDir, "results"), { recursive: true });
    const { settingSources: _dropped, ...unrecorded } = roundFile("r1");
    writeFileSync(path, JSON.stringify(unrecorded), "utf-8");
    expect(() => writeTaskResult(w.env, "r1", RECORDED, "u", taskResult())).toThrow(/setting sources unrecorded/);
  });

  it("writes the same bytes for the same results", () => {
    const w = world();
    const path = writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    const first = readFileSync(path, "utf-8");
    writeTaskResult(w.env, "r1", RECORDED, "t", taskResult());
    expect(readFileSync(path, "utf-8")).toBe(first);
  });
});

describe("readRound() and roundPath()", () => {
  it("refuses a schema it does not write", () => {
    const w = world();
    const path = roundPath(w.env, "old");
    mkdirSync(join(w.env.evalsDir, "results"), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...roundFile("old"), schema: 3 }), "utf-8");
    expect(() => readRound(path)).toThrow(/schema 3/);
  });

  it("refuses a schema-1 round, written before records carried `invalid` and the round `settingSources`", () => {
    const w = world();
    const path = roundPath(w.env, "old");
    mkdirSync(join(w.env.evalsDir, "results"), { recursive: true });
    const { settingSources: _sources, ...round } = roundFile("old");
    const task = round.tasks.t!;
    const runs = task.runs.map(({ invalid: _invalid, ...run }) => run);
    const calibration = task.calibration.map(({ invalid: _invalid, ...record }) => record);
    writeFileSync(path, JSON.stringify({ ...round, schema: 1, tasks: { t: { ...task, runs, calibration } } }), "utf-8");
    expect(() => readRound(path)).toThrow(`${path} is schema 1, and this harness reads schema 2`);
  });

  it("names a round file that is missing", () => {
    expect(() => readRound(roundPath(world().env, "absent"))).toThrow(/no round file/);
  });

  it("refuses a round name that is not a safe file name", () => {
    expect(() => roundPath(world().env, "../x")).toThrow(/must be lowercase/);
  });
});
