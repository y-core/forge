import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";

import { worktreeFiles } from "../src/tooling/cli/worktree";
import { declaredByName } from "../src/tooling/gate/checks/co-location";
import { isBudgetedSource } from "../src/tooling/gate/checks/comment-budget";
import { isBrowserSubpath } from "../src/tooling/gate/checks/exports";
import { resolveSources } from "../src/tooling/gate/checks/source-scan";
import { GATE_TIERS, type GateTier, selectSteps } from "../src/tooling/gate/mod";
import { BROWSER_ONLY, CO_LOCATION_EXEMPT } from "./exemptions";
import { COMMENT_BUDGET_SOURCES, CSS_DIR, GATE_INPUTS, STEPS } from "./steps";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const labels = (tier: GateTier): string[] => {
  const selection = selectSteps(STEPS, { tier });
  return selection.ok ? selection.steps.map((step) => step.label) : [];
};

describe("the gate's step table", () => {
  it("gives every step a unique label, because a label is what `--only` addresses", () => {
    expect(STEPS.map((step) => step.label).length).toBe(new Set(STEPS.map((step) => step.label)).size);
  });

  it("selects each tier as a superset of the one below it", () => {
    const runs = GATE_TIERS.map(labels);

    expect(runs.slice(1).every((run, index) => (runs[index] ?? []).every((label) => run.includes(label)))).toBe(true);
  });

  it("selects without calling a probe, so what it selects never depends on the machine", () => {
    expect(selectSteps(STEPS, { tier: "scheduled" }).ok).toBe(true);
  });

  it("keeps the browser suite out of runtime and runs it on Chromium alone at scheduled", () => {
    const browsers = (tier: GateTier): string[] => labels(tier).filter((label) => label.startsWith("test:browser"));

    expect([browsers("unit"), browsers("runtime"), browsers("scheduled")]).toEqual([[], [], ["test:browser"]]);
  });

  it("names no Firefox or WebKit project in any row, so the cross-engine subset runs only by hand or on a schedule", () => {
    const projects = STEPS.flatMap((step) => step.cmd ?? []).filter((arg) => arg.startsWith("--project="));

    expect(projects).toEqual(["--project=chromium", "--project=workerd"]);
  });

  it("fails the test row when the suite leaves anything in its TMPDIR", () => {
    expect(STEPS.find((step) => step.label === "test")).toMatchObject({ leavesNoTemp: true });
  });

  it("runs the suite of the directory this file lives in, so an assertion here can redden the gate", () => {
    const row = STEPS.find((step) => step.label === "test");
    expect((row?.cmd ?? []).join(" ")).toContain("config/");
  });

  it("compiles every suite that references the node shim outside the Worker program, so a Node import in Worker code fails", () => {
    const fixture = join(ROOT, "tests/fixtures/workers-consumer");
    const included = (config: string): string[] => (JSON.parse(readFileSync(join(fixture, config), "utf-8")) as { include: string[] }).include;
    const referencesShim = (file: string): boolean => readFileSync(join(fixture, file), "utf-8").includes("src/testing/node.d.ts");

    const suites = readdirSync(fixture).filter((file) => file.endsWith(".ts") && referencesShim(file));

    expect(suites).toContain("harness-suite.ts");
    expect(included("tsconfig.json").filter(referencesShim)).toEqual([]);
    expect(suites.filter((file) => !included("tsconfig.node.json").includes(file))).toEqual([]);
    expect(STEPS.find((step) => step.label === "typecheck:workers-consumer-node")?.cmd).toContain(
      "tests/fixtures/workers-consumer/tsconfig.node.json",
    );
  });

  it("runs each Playwright row with the same command its package script does", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> }).scripts;
    for (const label of ["test:workerd", "test:browser"]) {
      expect(STEPS.find((step) => step.label === label)?.cmd?.join(" ")).toBe(scripts[label]);
    }
  });

  it("holds every tracked TypeScript and CSS file to the comment budget, root config files included", () => {
    const tracked = Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx", "*.css"], { cwd: ROOT })
      .stdout.toString()
      .split("\n")
      .filter((file) => file !== "" && existsSync(join(ROOT, file)));
    const scanned = new Set(resolveSources(ROOT, COMMENT_BUDGET_SOURCES, isBudgetedSource));

    expect(tracked).toContain("playwright.config.ts");
    expect(tracked).toContain("src/ui/assets/css/forge-ui.css");
    expect(tracked.filter((file) => !scanned.has(file))).toEqual([]);
  });
});

describe("the gate's watches", () => {
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT })
    .stdout.toString()
    .split("\n")
    .filter((file) => file !== "");

  const affected = (changed: readonly string[]): string[] => {
    const selection = selectSteps(STEPS, { tier: "scheduled", changed, gateInputs: GATE_INPUTS });
    return selection.ok ? selection.steps.map((step) => step.label) : [`refused: ${selection.error}`];
  };

  it("leaves undeclared exactly the rows whose inputs no path list bounds", () => {
    expect(STEPS.filter((step) => step.watches === undefined).map((step) => step.label)).toEqual([
      "typecheck",
      "typecheck:workers-consumer",
      "typecheck:workers-consumer-node",
      "typecheck:service-worker-consumer",
      "lint:types",
      "test",
      "validate-exports",
      "validate-namespace-graph",
      "validate-packaging",
      "validate-docs",
      "validate-design",
      "test:browser",
      "test:workerd",
    ]);
  });

  it("keeps a hand-kept watch list off every Playwright row, and narrows only the runtime one", () => {
    const playwright = STEPS.filter((step) => step.cmd?.[0] === "playwright");

    expect(playwright.map((step) => [step.label, step.watches, step.narrow?.probe?.args])).toEqual([
      ["test:browser", undefined, undefined],
      ["test:workerd", undefined, ["--list"]],
    ]);
  });

  it("passes the gate's own refusal of a watches or wide glob that matches no file in the work tree", () => {
    const files = worktreeFiles(ROOT) ?? [];
    const selection = selectSteps(STEPS, { tier: "scheduled", files });

    expect(files).toContain("package.json");
    expect(selection.ok ? "" : selection.error).toBe("");
  });

  it("declares the stylesheet directory once, and derives every path beneath it", () => {
    const source = readFileSync(join(ROOT, "config/steps.ts"), "utf-8");

    expect(source.split(CSS_DIR).length - 1).toBe(1);
  });

  it("holds no gate input that matches no tracked file", () => {
    expect(GATE_INPUTS.filter((glob) => !tracked.some((file) => matchesGlob(file, glob)))).toEqual([]);
  });

  it("selects every step when the gate runner changes", () => {
    expect(affected(["src/tooling/gate/command.ts"])).toEqual(labels("scheduled"));
  });

  it("runs none of the slow rows a watch list bounds for a documentation edit", () => {
    const selected = affected(["docs/TEST_RUNNERS.md"]);

    expect(selected).toContain("validate-markdown");
    expect(selected.filter((label) => ["db:lint", "db:schema", "validate-contrast", "validate-icc-profile"].includes(label))).toEqual([]);
  });
});

describe("the runtime tier's narrowing", () => {
  const reach = (pending: readonly string[]): Record<string, string> => {
    const selection = selectSteps(STEPS, { tier: "runtime", pending, gateInputs: GATE_INPUTS });
    if (!selection.ok) return {};
    const { "test:workerd": workerd = "", "db:schema": db = "" } = selection.reach;
    return { workerd, db };
  };

  it("hands the workerd row to its probe for any edit, and runs a database row whole or not at all", () => {
    expect(reach(["src/ui/core/button.tsx"])).toEqual({ workerd: "narrow", db: "untouched" });
    expect(reach(["tests/workerd/x.workerd.ts"])).toEqual({ workerd: "narrow", db: "untouched" });
  });

  const traced = async (label: string): Promise<readonly string[]> => (await STEPS.find((step) => step.label === label)?.widen?.(ROOT)) ?? [];

  it("traces every Worker a workerd spec serves and every file it names by URL, so a change confined to one runs the row whole", async () => {
    const workerd = await traced("test:workerd");

    expect(workerd).toContain("src/app/forge-app.ts");
    expect(workerd).toContain("tests/fixtures/harness-entry/worker.ts");
    expect(workerd).toContain("src/auth/schema.sql");
    expect(workerd).not.toContain("src/ui/client/menu.ts");
    expect(STEPS.find((step) => step.label === "test:workerd")?.narrow?.wide).toEqual(["playwright.config.ts", "tests/fixtures/**"]);
  });

  it("traces the command every database row runs, so a change to the CLI that loads `forge db` runs them whole", async () => {
    for (const label of ["db:lint", "db:schema"]) {
      const db = await traced(label);
      expect([label, db.includes("src/tooling/root/root.ts"), db.includes("src/tooling/release/release.ts")]).toEqual([label, true, true]);
    }
  });

  it("runs the database rows for a change to a namespace db tooling reaches through the graph, or the schema its fixture composes", () => {
    for (const path of ["src/tooling/db/sql.ts", "src/storage/db/sql.ts", "src/logging/mod.ts", "src/validation/mod.ts", "src/auth/schema.sql"]) {
      expect([path, reach([path]).db]).toEqual([path, "whole"]);
    }
  });

  it("watches no database row with a hand-kept source glob", () => {
    const db = STEPS.filter((step) => step.label.startsWith("db:"));

    expect(db.map((step) => step.watches?.includes("src/**"))).toEqual([false, false, false]);
    expect(db.every((step) => step.watches?.includes("tests/fixtures/db-schema/**"))).toBe(true);
  });

  it("runs the whole workerd set for a fixture, which specs read without importing", () => {
    expect(reach(["tests/fixtures/workers-form/worker.ts"]).workerd).toBe("whole");
  });

  it("runs no database row for a documentation edit, and leaves the workerd row to its probe", () => {
    expect(reach(["docs/TEST_RUNNERS.md"])).toEqual({ workerd: "narrow", db: "untouched" });
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
