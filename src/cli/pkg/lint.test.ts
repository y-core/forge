import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { corpusIdOf, RULE_ENFORCER } from "./gate/checks/design-rules";
import plugin from "./lint";
import { suppressionNeedsReason } from "./lint/rules/suppression-needs-reason.ts";
import type { DisableDirective, RuleContext } from "./lint/types.ts";

const LINT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "lint");

/** Every `.ts` file under `lint/`, tests included, repo-relative to `lint/`. */
function pluginSources(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pluginSources(resolve(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

function run(directives: DisableDirective[]): string[] {
  const reported: string[] = [];
  const context: RuleContext = {
    report: (diagnostic) => reported.push(diagnostic.message),
    sourceCode: { getDisableDirectives: () => ({ directives }) },
  };
  (suppressionNeedsReason.create(context).Program as (node: unknown) => void)(undefined);
  return reported;
}

const directive = (over: Partial<DisableDirective> = {}): DisableDirective => ({
  type: "disable-next-line",
  value: "eslint/no-unused-vars",
  justification: "",
  node: {},
  ...over,
});

describe("plugin shape", () => {
  it("is named `forge`, which is the prefix a report carries", () => {
    expect(plugin.meta.name).toBe("forge");
  });

  it("registers the suppression rule under its kebab-case id", () => {
    expect(Object.keys(plugin.rules)).toContain("suppression-needs-reason");
    expect(plugin.rules["suppression-needs-reason"]).toBe(suppressionNeedsReason);
  });

  it("registers every corpus rule the register routes to the plugin, and no other corpus id", () => {
    const registered = Object.keys(plugin.rules).flatMap((key) => {
      const id = corpusIdOf(key);
      return id === undefined ? [] : [id];
    });
    const routed = Object.entries(RULE_ENFORCER).flatMap(([id, enforcer]) => (enforcer === "lint" ? [id] : []));

    expect(registered.sort()).toEqual(routed.sort());
  });
});

describe("the plugin's private directory", () => {
  it("holds no `@public` symbol", () => {
    const tagged = pluginSources(LINT_DIR).filter((name) => readFileSync(resolve(LINT_DIR, name), "utf-8").includes("@public"));

    expect(tagged).toEqual([]);
  });

  it("has no `mod.ts`, which would mint a namespace out of a private directory", () => {
    expect(pluginSources(LINT_DIR)).not.toContain("mod.ts");
  });
});

describe("suppression-needs-reason", () => {
  it("reports a directive written with no reason", () => {
    expect(run([directive()])).toEqual([
      "`oxlint-disable-next-line` for `eslint/no-unused-vars` with no reason — append ` -- <why>`, so the next reader can judge the suppression rather than only count it.",
    ]);
  });

  it("accepts a directive that states one", () => {
    expect(run([directive({ justification: "the parameter documents the shape" })])).toEqual([]);
  });

  it("reports a whitespace-only reason, because it tells the next reader nothing", () => {
    expect(run([directive({ justification: "   " })])).toHaveLength(1);
  });

  it("names `every rule` for a blanket directive, which suppresses more than any named one", () => {
    expect(run([directive({ type: "disable", value: "" })])).toEqual([
      "`oxlint-disable` for every rule with no reason — append ` -- <why>`, so the next reader can judge the suppression rather than only count it.",
    ]);
  });

  it("covers every rule, not only `design-allow` — which is what makes it stronger than the regex it replaces", () => {
    const reported = run([directive({ value: "typescript/no-explicit-any" }), directive({ value: "forge/suppression-needs-reason" })]);
    expect(reported).toHaveLength(2);
  });

  it("reports each reasonless directive in the file separately", () => {
    expect(run([directive(), directive({ justification: "stated" }), directive({ type: "disable-line" })])).toHaveLength(2);
  });
});
