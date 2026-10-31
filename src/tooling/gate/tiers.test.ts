import { describe, expect, it } from "bun:test";

import { checkResult } from "./finding";
import { declaredSteps, defineSteps, isStepsConfig, mergeTiers, resolveTiers, tier } from "./tiers";
import type { ResolvedTiers, Step, StepTiers } from "./types";

const row = (label: string): Step => ({ label, run: () => checkResult([], label) });

const command = (label: string): Step => ({ label, tail: 10, cmd: [label] });

function resolved(tiers: StepTiers): ResolvedTiers {
  const resolution = resolveTiers(tiers);
  if (!resolution.ok) throw new Error(resolution.error);
  return resolution.data;
}

function refusal(tiers: StepTiers): string {
  const resolution = resolveTiers(tiers);
  return resolution.ok ? "resolved" : resolution.error;
}

function labelsIn(table: ResolvedTiers): Record<string, string[]> {
  return Object.fromEntries(Object.entries(table).map(([key, run]) => [key, run.steps.map((step) => step.label)]));
}

function frozen(tiers: StepTiers): StepTiers {
  for (const entries of Object.values(tiers)) Object.freeze(entries);
  return Object.freeze(tiers);
}

const duplicate = (labels: string, key: string): string =>
  `Duplicate step label in the ${key} tier: ${labels}. A label is the \`--only\` token and the name reported on failure, so it must name exactly one step.`;

const LADDER: StepTiers = {
  static: [row("lint"), row("format")],
  unit: [tier("static"), row("test")],
  runtime: [tier("unit"), command("db:lint")],
  scheduled: [tier("runtime"), command("test:browser")],
};

describe("tier()", () => {
  it("builds a reference naming the tier", () => {
    expect([tier("static"), tier("unit"), tier("runtime"), tier("scheduled")]).toEqual([
      { tier: "static" },
      { tier: "unit" },
      { tier: "runtime" },
      { tier: "scheduled" },
    ]);
  });
});

describe("defineSteps()", () => {
  it("returns the very table it was handed", () => {
    const config = { inputs: ["config/**"], tiers: { static: [row("lint")] } };

    expect(defineSteps(config)).toBe(config);
  });
});

describe("resolveTiers() — expansion", () => {
  it("expands a reference in place, between the rows declared around it", () => {
    expect(labelsIn(resolved({ static: [row("lint")], unit: [row("a"), tier("static"), row("b")] })).unit).toEqual(["a", "lint", "b"]);
  });

  it("expands a ladder of references transitively, each tier a prefix of the one above it in declared order", () => {
    expect(labelsIn(resolved(LADDER))).toEqual({
      static: ["lint", "format"],
      unit: ["lint", "format", "test"],
      runtime: ["lint", "format", "test", "db:lint"],
      scheduled: ["lint", "format", "test", "db:lint", "test:browser"],
    });
  });

  it("keeps a tier's declared order rather than sorting it", () => {
    expect(labelsIn(resolved({ static: [row("format"), row("lint"), row("alpha")] })).static).toEqual(["format", "lint", "alpha"]);
  });

  it("includes the very step objects the lower tier declares", () => {
    const lint = row("lint");

    expect(resolved({ static: [lint], unit: [tier("static")] }).unit?.steps[0]).toBe(lint);
  });

  it("records, for every row a tier reaches, the tier that declares it directly", () => {
    expect(resolved(LADDER).runtime?.home).toEqual({ lint: "static", format: "static", test: "unit", "db:lint": "runtime" });
  });

  it("homes a row reached through two levels of reference in the tier that declares it", () => {
    expect(resolved(LADDER).scheduled?.home).toEqual({
      lint: "static",
      format: "static",
      test: "unit",
      "db:lint": "runtime",
      "test:browser": "scheduled",
    });
  });

  it("holds only a tier's own rows where it names no reference", () => {
    expect(labelsIn(resolved({ static: [row("lint")], scheduled: [row("browser")] }))).toEqual({ static: ["lint"], scheduled: ["browser"] });
  });

  it("leaves a tier the table does not declare out of the result", () => {
    expect(Object.keys(resolved({ static: [row("lint")], runtime: [tier("static"), row("db")] }))).toEqual(["static", "runtime"]);
  });

  it("resolves a declared but empty tier to no rows", () => {
    expect(resolved({ static: [], unit: [tier("static")] })).toEqual({ static: { steps: [], home: {} }, unit: { steps: [], home: {} } });
  });

  it("accepts one label in two tiers that do not include each other", () => {
    expect(labelsIn(resolved({ static: [row("lint")], unit: [row("lint")] }))).toEqual({ static: ["lint"], unit: ["lint"] });
  });

  it("reads its input without mutating it", () => {
    const input = frozen({ static: [row("lint")], unit: [tier("static"), row("test")] });

    expect(labelsIn(resolved(input)).unit).toEqual(["lint", "test"]);
    expect(input.unit?.map((entry) => ("label" in entry ? entry.label : entry))).toEqual([{ tier: "static" }, "test"]);
  });
});

describe("resolveTiers() — references it refuses", () => {
  it("refuses a reference to a tier the table does not declare, naming both tiers and the key to add", () => {
    expect(refusal({ unit: [tier("static"), row("test")] })).toBe(
      'The unit tier includes tier("static"), which the table does not declare — add a `static` key, or drop the reference.',
    );
  });

  it("refuses a reference to the same or a higher tier, which the types forbid and a cast or plain JS does not", () => {
    const self = { static: [row("lint")], unit: [tier("unit") as never] };
    const higher = { static: [row("lint")], unit: [tier("runtime") as never], runtime: [row("db")] };

    expect([refusal(self), refusal(higher)]).toEqual([
      'The unit tier includes tier("unit"), which is not below it — a tier may include only a lower one.',
      'The unit tier includes tier("runtime"), which is not below it — a tier may include only a lower one.',
    ]);
  });

  it("refuses, at compile time and at run time alike, a tier including itself or one above it", () => {
    const tables: StepTiers[] = [
      // @ts-expect-error -- a tier may include only a lower one
      { static: [tier("static")] },
      // @ts-expect-error -- a tier may include only a lower one
      { unit: [tier("unit")] },
      // @ts-expect-error -- a tier may include only a lower one
      { runtime: [tier("scheduled")], scheduled: [] },
    ];

    expect(tables.map(refusal)).toEqual([
      'The static tier includes tier("static"), which is not below it — a tier may include only a lower one.',
      'The unit tier includes tier("unit"), which is not below it — a tier may include only a lower one.',
      'The runtime tier includes tier("scheduled"), which is not below it — a tier may include only a lower one.',
    ]);
  });
});

describe("resolveTiers() — duplicate labels", () => {
  it("refuses a label one tier declares twice directly, whether the rows are checks or commands", () => {
    expect([refusal({ static: [row("lint"), row("lint")] }), refusal({ static: [command("lint"), command("lint")] })]).toEqual([
      duplicate("lint", "static"),
      duplicate("lint", "static"),
    ]);
  });

  it("refuses a label a tier declares directly and also reaches through a reference, naming the including tier", () => {
    expect(refusal({ static: [row("lint")], unit: [tier("static"), row("lint")] })).toBe(duplicate("lint", "unit"));
  });

  it("names every duplicated label once, however many times each repeats", () => {
    expect(refusal({ static: [row("a"), row("a"), row("a"), row("b"), row("b"), row("c")] })).toBe(duplicate("a, b", "static"));
  });

  it("refuses the whole table for a duplicate in scheduled, so a static run of it is refused too", () => {
    const tiers: StepTiers = { static: [row("lint")], scheduled: [row("browser"), row("browser")] };

    expect(refusal(tiers)).toBe(duplicate("browser", "scheduled"));
  });

  it("refuses a duplicate brought in by including a tier twice", () => {
    expect(refusal({ static: [row("lint")], unit: [tier("static"), tier("static")] })).toBe(duplicate("lint", "unit"));
  });
});

describe("mergeTiers()", () => {
  it("concatenates each tier the first table's rows first, references kept where they stood", () => {
    const [a, b, c] = [row("a"), row("b"), row("c")];

    expect(mergeTiers({ static: [a], unit: [tier("static"), b] }, { unit: [c] })).toEqual({ static: [a], unit: [tier("static"), b, c] });
  });

  it("declares a tier either table declares, even an empty one, and no tier neither declares", () => {
    const a = row("a");

    expect(mergeTiers({ static: [] }, { runtime: [a] })).toEqual({ static: [], runtime: [a] });
    expect(Object.keys(mergeTiers({ static: [] }, { runtime: [a] }))).toEqual(["static", "runtime"]);
  });

  it("mutates neither table", () => {
    const left = frozen({ unit: [row("a")] });
    const right = frozen({ unit: [row("b")] });

    expect(mergeTiers(left, right).unit?.map((entry) => ("label" in entry ? entry.label : entry))).toEqual(["a", "b"]);
    expect([left.unit?.length, right.unit?.length]).toEqual([1, 1]);
  });

  it("merges two complete tables into one that resolves to the duplicate-label refusal, since each expands its lower tier", () => {
    const complete = (): StepTiers => ({ static: [row("lint")], unit: [tier("static")] });

    expect(refusal(mergeTiers(complete(), complete()))).toBe(duplicate("lint", "static"));
  });
});

describe("declaredSteps()", () => {
  it("lists every step a table declares directly, skipping references", () => {
    const [a, b] = [row("a"), row("b")];

    expect(declaredSteps({ static: [a], unit: [tier("static"), b] })).toEqual([a, b]);
  });

  it("walks the tiers in ascending order whatever order the table's keys were written in", () => {
    const [lint, test, db, browser] = [row("lint"), row("test"), row("db"), row("browser")];

    expect(declaredSteps({ scheduled: [browser], runtime: [db], unit: [test], static: [lint] })).toEqual([lint, test, db, browser]);
  });

  it("keeps a tier's declared order", () => {
    const [b, a] = [row("b"), row("a")];

    expect(declaredSteps({ static: [b, a] })).toEqual([b, a]);
  });

  it("lists nothing for an empty table", () => {
    expect(declaredSteps({})).toEqual([]);
  });
});

const LOADED_DEFAULTS: { value: unknown; expected: boolean }[] = [
  { value: { tiers: {} }, expected: true },
  { value: { inputs: ["x"], tiers: { static: [] } }, expected: true },
  { value: [], expected: false },
  { value: null, expected: false },
  { value: undefined, expected: false },
  { value: "config", expected: false },
  { value: {}, expected: false },
  { value: { tiers: [] }, expected: false },
  { value: { tiers: null }, expected: false },
  { value: { tiers: "static" }, expected: false },
];

describe("isStepsConfig()", () => {
  for (const { value, expected } of LOADED_DEFAULTS) {
    it(`answers ${expected} for ${JSON.stringify(value)}`, () => {
      expect(isStepsConfig(value)).toBe(expected);
    });
  }
});
