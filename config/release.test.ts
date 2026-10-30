import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type GateTier, selectSteps } from "../src/tooling/gate/mod";
import release from "./release";
import { STEPS } from "./steps";

const ROOT = join(import.meta.dir, "..");

/** The steps a tier selects, by the label `--only` addresses. */
const labels = (tier: GateTier): string[] => {
  const selection = selectSteps(STEPS, { tier });
  return selection.ok ? selection.steps.map((step) => step.label) : [];
};

/** The steps that need a runtime, and so exist nowhere below `runtime`. */
const RUNTIME_ROWS = ["test:workerd", "db:lint", "db:schema"];

/** The steps a scheduled run is the only run to reach; the Chromium suite is one, too slow for the run a task closes on. */
const SCHEDULED_ONLY = ["validate-changelog", "test:browser"];

describe("the gate a release runs", () => {
  it("names the script rather than the binary, which is what tells an unrunnable gate from a failing one", () => {
    expect(release.gateCommand).toEqual(["bun", "run", "verify:scheduled"]);
  });

  // A consumer's suite in the gate would let a consumer's progress block a forge release (BUILD_TOOLING.md §2l).
  it("runs the scheduled tier and nothing outside this checkout", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
    const gate = scripts[release.gateCommand?.[2] ?? ""] ?? "";

    expect(gate).toBe("bun run src/tooling/root/bin.ts verify --tier scheduled");
    expect(Object.values(scripts).filter((script) => script.includes("../"))).toEqual([]);
  });

  // A step whose `requires` probe fails is skipped below `runtime` and failed from it up, so re-tiering
  // a runtime row downward would not move it into the scheduled tier's reach — it would silence it.
  it("holds every runtime row out of the tiers that skip an absent runtime", () => {
    expect(RUNTIME_ROWS.every((label) => labels("runtime").includes(label))).toBe(true);
    expect(RUNTIME_ROWS.filter((label) => labels("unit").includes(label))).toEqual([]);
  });

  it("reaches the scheduled rows at scheduled alone", () => {
    expect(SCHEDULED_ONLY.every((label) => labels("scheduled").includes(label))).toBe(true);
    expect(SCHEDULED_ONLY.filter((label) => labels("runtime").includes(label))).toEqual([]);
  });

  it("publishes a script per tier, the bare one running the runtime tier", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
    const gate = "bun run src/tooling/root/bin.ts verify";

    expect([scripts.verify, scripts["verify:static"], scripts["verify:unit"], scripts["verify:scheduled"]]).toEqual([
      gate,
      `${gate} --tier static`,
      `${gate} --tier unit`,
      `${gate} --tier scheduled`,
    ]);
    expect(scripts["verify:cron"]).toBe(`${gate} --config config/cron.ts --tier scheduled`);
    expect(scripts["verify:deploy"]).toBeUndefined();
    expect(scripts.prepublishOnly).toBe("bun run verify:scheduled");
  });

  it("keeps the `release` script on the release command, which is a moment rather than a tier", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;

    expect([scripts.release, scripts.scheduled]).toEqual(["bun run src/tooling/root/bin.ts release", undefined]);
  });

  // TEST_RUNNERS.md §6: the local `verify:scheduled` already ran every runtime suite on the tagged tree.
  it("verifies a tag on the unit tier, with no browser server to start", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf-8");

    expect(workflow.match(/bun run verify\S*/g)).toEqual(["bun run verify:unit"]);
    expect(workflow).not.toContain("playwright");
  });

  // BUILD_TOOLING.md §2m.
  it("claims a Bun floor equal to the Bun the release workflow installs from packageManager", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { packageManager: string; engines: { bun: string } };

    expect(manifest.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect(manifest.engines.bun).toBe(`>=${manifest.packageManager.slice("bun@".length)}`);
  });
});
