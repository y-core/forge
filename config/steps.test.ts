import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";

import { declaredByName } from "../src/tooling/gate/checks/co-location";
import { isBrowserSubpath } from "../src/tooling/gate/checks/exports";
import { resolveSources } from "../src/tooling/gate/checks/source-scan";
import { type GateMode, selectSteps } from "../src/tooling/gate/mod";
import { BROWSER_ONLY, CO_LOCATION_EXEMPT } from "./exemptions";
import { COMMENT_BUDGET_SOURCES, GATE_INPUTS, STEPS } from "./steps";

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

  it("holds every tracked TypeScript file to the comment budget, root config files included", () => {
    const tracked = Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx"], { cwd: ROOT })
      .stdout.toString()
      .split("\n")
      .filter((file) => file !== "");
    const scanned = new Set(resolveSources(ROOT, COMMENT_BUDGET_SOURCES, (name) => name.endsWith(".ts") || name.endsWith(".tsx")));

    expect(tracked).toContain("playwright.config.ts");
    expect(tracked.filter((file) => !scanned.has(file))).toEqual([]);
  });
});

describe("the gate's watches", () => {
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT })
    .stdout.toString()
    .split("\n")
    .filter((file) => file !== "");

  const affected = (changed: readonly string[]): string[] => {
    const selection = selectSteps(STEPS, { mode: "full", changed, gateInputs: GATE_INPUTS });
    return selection.ok ? selection.steps.map((step) => step.label) : [`refused: ${selection.error}`];
  };

  it("leaves undeclared exactly the rows whose inputs no path list bounds", () => {
    expect(STEPS.filter((step) => step.watches === undefined).map((step) => step.label)).toEqual([
      "typecheck",
      "typecheck:workers-consumer",
      "lint:types",
      "test",
      "validate-exports",
      "validate-namespace-graph",
      "validate-packaging",
      "validate-docs",
      "validate-design",
    ]);
  });

  it("declares no row whose watches match no tracked file", () => {
    const blind = STEPS.filter(
      (step) => step.watches !== undefined && !tracked.some((file) => step.watches?.some((glob) => matchesGlob(file, glob))),
    );

    expect(blind.map((step) => step.label)).toEqual([]);
  });

  it("holds no gate input that matches no tracked file", () => {
    expect(GATE_INPUTS.filter((glob) => !tracked.some((file) => matchesGlob(file, glob)))).toEqual([]);
  });

  it("selects every step when the gate runner changes", () => {
    expect(affected(["src/tooling/gate/command.ts"])).toEqual(labels("full"));
  });

  it("runs none of the slow or narrow rows for a documentation edit", () => {
    const selected = affected(["docs/TEST_RUNNERS.md"]);

    expect(selected).toContain("validate-markdown");
    expect(
      selected.filter((label) => ["test:browser", "test:workerd", "db:schema", "validate-contrast", "validate-icc-profile"].includes(label)),
    ).toEqual([]);
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

describe("the package's exports", () => {
  it("publishes no aggregate `storage` or `ui` barrel, so each client and UI surface is imported from its own subpath", () => {
    const exports = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { exports: Record<string, unknown> }).exports;

    expect(Object.keys(exports).filter((key) => key === "./storage" || key === "./ui")).toEqual([]);
    expect(Object.keys(exports)).toContain("./storage/db");
    expect(Object.keys(exports)).toContain("./ui/core");
  });
});
