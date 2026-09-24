import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type GateMode, selectSteps } from "../src/tooling/gate/mod";
import release from "./release";
import { STEPS } from "./steps";

const ROOT = join(import.meta.dir, "..");

/** The steps a mode selects, by the label `--only` addresses. */
const labels = (mode: GateMode): string[] => {
  const selection = selectSteps(STEPS, { mode });
  return selection.ok ? selection.steps.map((step) => step.label) : [];
};

/** The steps that exist at `full` and nowhere below it — the ones a release is the only run to reach. */
const RELEASE_ONLY = ["validate-changelog", "test:browser", "test:workerd", "db:schema"];

describe("the gate a release runs", () => {
  it("names the script rather than the binary, which is what tells an unrunnable gate from a failing one", () => {
    expect(release.gateCommand).toEqual(["bun", "run", "release:gate"]);
  });

  it("names a script that runs the full tier first, then the demonstrator's coverage spec against this checkout", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
    const script = release.gateCommand?.[2] ?? "";
    const gate = scripts[script] ?? "";

    expect(Object.hasOwn(scripts, script)).toBe(true);
    expect(gate.split("&&")[0]?.trim()).toBe("bun run verify:full");
    expect(scripts["verify:full"]).toContain("--full");
    expect(gate).toContain("src/tooling/dev/coverage.ts ../starter tests/unit/showcase/coverage.fixture.test.tsx");
  });

  // A step whose `requires` probe fails is skipped below `full` and failed at `full`, so re-tiering
  // one of these downward would not move it into the release's reach — it would silence it.
  it("reaches the steps that exist only at full, none of which any lower tier selects", () => {
    expect(RELEASE_ONLY.every((label) => labels("full").includes(label))).toBe(true);
    expect(RELEASE_ONLY.filter((label) => labels("standard").includes(label))).toEqual([]);
  });
});
