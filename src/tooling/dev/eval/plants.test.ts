import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sweepRules } from "../../../../warden/src/rules/check";
import { loadRegister } from "../../../../warden/src/rules/load";
import { stripJsonc } from "../../cli/jsonc";

const ROOT = resolve(import.meta.dir, "../../../..");
const EVALS = join(ROOT, "tests/evals");

// Each plant whose rule a pattern or a lint rule now decides, and the register id that must report it.
const DETECTED: readonly { task: string; plant: string; rule: string; by: "rg" | "lint" }[] = [
  { task: "consumer-contact-form", plant: "raw-env", rule: "apps-code-review-raw-env", by: "rg" },
  { task: "consumer-contact-form", plant: "substring-markup-assertion", rule: "apps-code-review-substring-markup", by: "rg" },
  { task: "consumer-d1-list", plant: "raw-env", rule: "apps-code-review-raw-env", by: "rg" },
  { task: "consumer-shared-greeting", plant: "controller-import", rule: "app-architecture-controller-imports-controller", by: "lint" },
  { task: "consumer-shared-greeting", plant: "view-imports-service", rule: "app-architecture-view-imports-service", by: "lint" },
  { task: "consumer-webhook", plant: "fetch-in-controller", rule: "apps-code-review-controller-fetch", by: "rg" },
  { task: "forge-middleware-body-limit", plant: "headers-facade", rule: "forge-remix-headers-facade", by: "lint" },
  { task: "forge-middleware-body-limit", plant: "sibling-barrel", rule: "forge-sibling-barrel-import", by: "rg" },
  { task: "forge-middleware-body-limit", plant: "web-apis-only", rule: "forge-runtime-web-apis-only", by: "rg" },
  { task: "forge-ui-description-list", plant: "substring-markup-assertion", rule: "forge-substring-markup", by: "rg" },
  { task: "forge-ui-description-list", plant: "focus-ring", rule: "forge-ui-recipe-respelled", by: "rg" },
];

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The lines a patch adds, by the file it adds them to. */
function addedLines(patch: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      current = path === "/dev/null" ? undefined : (files.get(path) ?? []);
      if (current !== undefined) files.set(path, current);
    } else if (line.startsWith("+") && current !== undefined) current.push(line.slice(1));
  }
  return files;
}

type Override = { files: string[]; rules: Record<string, unknown> };

/** A config holding only `config`'s import bans, so oxlint runs them without the plugin or the type-aware driver. */
function importBansOf(config: { rules?: Record<string, unknown>; overrides?: Override[] }): object {
  const key = "eslint/no-restricted-imports";
  return {
    rules: { [key]: config.rules?.[key] ?? "off" },
    overrides: (config.overrides ?? [])
      .filter((override) => key in override.rules)
      .map((override) => ({ files: override.files, rules: { [key]: override.rules[key] } })),
  };
}

function lintConfig(task: string): object {
  const file = task.startsWith("forge-") ? join(ROOT, ".oxlintrc.json") : join(ROOT, "src/tooling/config/oxlint.base.json");
  return importBansOf(JSON.parse(stripJsonc(readFileSync(file, "utf-8"))));
}

describe("each eval plant a detector now holds", () => {
  const register = loadRegister({ root: ROOT, kind: "libs", trees: ["shared", "libs", "apps"] });
  const rules = register.ok ? register.data : [];

  it.each(DETECTED.map((entry) => [`${entry.task}/${entry.plant}`, entry] as const))(
    "is reported under its rule: %s",
    (_name, { task, plant, rule, by }) => {
      const tree = mkdtempSync(join(tmpdir(), "forge-plant-"));
      dirs.push(tree);
      const patch = join(EVALS, task, "plants", `${plant}.patch`);
      const added = addedLines(readFileSync(patch, "utf-8"));
      // A consumer plant applies whole, onto the base, the bait and the reference, so the linted files parse; a forge plant's added lines stand alone.
      if (task.startsWith("consumer-")) {
        cpSync(join(EVALS, "consumer-base"), tree, { recursive: true });
        const { bait = [] } = JSON.parse(readFileSync(join(EVALS, task, "task.json"), "utf-8")) as { bait?: string[] };
        for (const step of [...bait.map((file) => join(EVALS, task, file)), join(EVALS, task, "reference.patch"), patch]) {
          const applied = spawnSync("git", ["apply", "--whitespace=nowarn", step], { cwd: tree, encoding: "utf-8" });
          expect(applied.stderr).toBe("");
        }
      } else {
        for (const [path, lines] of added) {
          mkdirSync(dirname(join(tree, path)), { recursive: true });
          writeFileSync(join(tree, path), `${lines.join("\n")}\n`);
        }
      }

      if (by === "rg") {
        const entry = rules.find((candidate) => candidate.id === rule);
        expect(entry?.detectors.some((detector) => detector.kind === "rg")).toBe(true);
        const swept = sweepRules({ root: tree, rules: entry === undefined ? [] : [entry], files: [...added.keys()] });
        expect(swept.ok && swept.data.findings.length).toBeGreaterThan(0);
      } else {
        writeFileSync(join(tree, ".oxlintrc.json"), JSON.stringify(lintConfig(task)));
        const run = spawnSync(join(ROOT, "node_modules/.bin/oxlint"), ["--format", "json", "-c", ".oxlintrc.json", ...added.keys()], {
          cwd: tree,
          encoding: "utf-8",
        });
        const { diagnostics } = JSON.parse(run.stdout) as { diagnostics: { help?: string; message: string }[] };
        const reported = diagnostics.map((diagnostic) => `${diagnostic.message} ${diagnostic.help ?? ""}`);
        const expected = task.startsWith("forge-") ? "@remix-run/headers" : `[${rule}]`;
        expect(reported.filter((text) => text.includes(expected))).toEqual([expect.any(String)]);
      }
    },
  );
});
