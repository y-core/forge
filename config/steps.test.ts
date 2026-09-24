import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { declaredByName } from "../src/tooling/gate/checks/co-location";
import { isBrowserSubpath } from "../src/tooling/gate/checks/exports";
import { type GateMode, selectSteps } from "../src/tooling/gate/mod";
import { BROWSER_ONLY, CO_LOCATION_EXEMPT } from "./exemptions";
import { STEPS } from "./steps";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const labels = (mode: GateMode): string[] => {
  const selection = selectSteps(STEPS, { mode });
  return selection.ok ? selection.steps.map((step) => step.label) : [];
};

describe("the gate's step table", () => {
  it("gives every step a unique label, because a label is what `--only` addresses", () => {
    expect(STEPS.map((step) => step.label).length).toBe(new Set(STEPS.map((step) => step.label)).size);
  });

  it("selects each mode as a superset of the one below it", () => {
    expect(labels("quality").every((label) => labels("standard").includes(label))).toBe(true);
    expect(labels("standard").every((label) => labels("full").includes(label))).toBe(true);
  });

  it("selects without calling a probe, so what it selects never depends on the machine", () => {
    expect(selectSteps(STEPS, { mode: "full" }).ok).toBe(true);
  });

  it("runs the suite of the directory this file lives in, so an assertion here can redden the gate", () => {
    const row = STEPS.find((step) => step.label === "test");
    expect((row?.cmd ?? []).join(" ")).toContain("config/");
  });

  // The number is tuned against this machine's cores and against `db-compose.test.ts`, which already
  // runs four cases at once; the script is how it is run by hand, and the two disagreeing is a trap.
  it("runs the workerd row at the same file parallelism the package script does", () => {
    const row = STEPS.find((step) => step.label === "test:workerd");
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
    const flag = (command: readonly string[] | string) =>
      /--parallel=(\d+)/.exec(typeof command === "string" ? command : command.join(" "))?.[1] ?? null;

    expect(flag(row?.cmd ?? [])).toBe("2");
    expect(flag(scripts["test:workerd"] ?? "")).toBe(flag(row?.cmd ?? []));
  });
});

describe("the gate's exemptions", () => {
  it("nominates no module a filename convention already exempts", () => {
    expect([...CO_LOCATION_EXEMPT.keys()].filter(declaredByName)).toEqual([]);
  });

  it("gives every co-location exemption a reason", () => {
    expect([...CO_LOCATION_EXEMPT].filter(([, reason]) => reason.trim() === "").map(([file]) => file)).toEqual([]);
  });

  it("nominates no subpath the browser-only convention already derives", () => {
    expect(BROWSER_ONLY.filter(isBrowserSubpath)).toEqual([]);
  });
});
