import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import type { CheckResult } from "../../../src/tooling/gate/types";
import type { RuleEntry, RuleSource } from "../rules/types";
import { rulesStep } from "../steps";
import { checkRules, type RulesCheckConfig } from "./rules";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const RULES_DOC = ["## 1. Rules", "", "<!-- rule:forge-a --> Because tokens theme.", ""].join("\n");

const BASE_FILES: Record<string, string> = {
  "canon/shared/AGENT_GUIDE.md": "## 8. Single Home\n\nProse.\n",
  "docs/RULES.md": RULES_DOC,
  ".oxlintrc.json": JSON.stringify({ rules: { "forge/a-rule": "error" } }),
  "src/a.test.ts": "",
};

const ENTRY_A: RuleEntry = { id: "forge-a", statement: "Never do a.", detectors: [{ kind: "lint", key: "forge/a-rule" }] };

function repo(...entries: RuleEntry[]): RuleSource {
  return { origin: "repo", file: "config/rules.config.ts", entries };
}

function fixture(files: Record<string, string> = {}): string {
  const root = gateFixtureRoot({ ...BASE_FILES, ...files }, "warden-rules-check-");
  roots.push(root);
  return root;
}

function configFor(root: string, overrides: Partial<RulesCheckConfig> = {}): RulesCheckConfig {
  return {
    root,
    kind: "libs",
    sources: [repo(ENTRY_A)],
    repoSlug: "forge",
    trees: ["shared", "libs", "apps"],
    canonRoot: join(root, "canon"),
    oxlintConfigs: [".oxlintrc.json"],
    plugin: { file: "src/plugin.ts", prefix: "forge/", rules: { "a-rule": { id: "forge-a" } } },
    stepLabels: ["lint", "test"],
    findingSources: ["src/checks"],
    ...overrides,
  };
}

function run(files: Record<string, string> = {}, overrides: Partial<RulesCheckConfig> = {}): CheckResult {
  return checkRules(configFor(fixture(files), overrides));
}

function reported(result: CheckResult): string[] {
  return result.findings.map(
    (finding) => `${finding.level} ${finding.file ?? "-"}${finding.line === undefined ? "" : `:${finding.line}`}: ${finding.message}`,
  );
}

function withEntry(entry: Partial<RuleEntry>): Partial<RulesCheckConfig> {
  return { sources: [repo({ ...ENTRY_A, ...entry })] };
}

describe("checkRules() — the clean case", () => {
  it("passes, naming the rule, marker, document and plugin-rule counts", () => {
    const result = run();

    expect(reported(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 rules, 1 markers in 2 documents, 1 plugin rules");
  });

  it("takes a lint key enabled only in an override as enabled", () => {
    const oxlint = JSON.stringify({ rules: {}, overrides: [{ files: ["src/**"], rules: { "forge/a-rule": ["warn", {}] } }] });

    expect(run({ ".oxlintrc.json": oxlint }).ok).toBe(true);
  });
});

describe("checkRules() — the four required failures", () => {
  it("fails a marker with no entry, at the marker", () => {
    const result = run({ "docs/RULES.md": `${RULES_DOC}\n<!-- rule:forge-b --> More.\n` });

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual(["fail docs/RULES.md:5: rule marker `forge-b` has no register entry — declare it in a rule file"]);
  });

  it("fails an entry with no marker, at its rule file", () => {
    const orphan: RuleEntry = { id: "forge-c", statement: "Never do c.", detectors: [{ kind: "review" }] };
    const result = run({}, { sources: [repo(ENTRY_A, orphan)] });

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-c` has no marker — open the paragraph that argues it with `<!-- rule:forge-c -->`",
    ]);
  });

  it("fails a lint key no oxlint config enables", () => {
    const result = run({ ".oxlintrc.json": JSON.stringify({ rules: { "forge/a-rule": "off" } }) });

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual(["fail config/rules.config.ts: rule `forge-a` names lint key `forge/a-rule`, which no oxlint config enables"]);
  });

  it("fails a plugin rule that reports with no rule id, naming the rule whose lint detector it is", () => {
    const result = run({}, { plugin: { file: "src/plugin.ts", prefix: "forge/", rules: { "a-rule": {} } } });

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual(["fail src/plugin.ts: plugin rule `a-rule` reports with no rule id — `forge-a` names it as a lint detector"]);
  });

  it("fails a plugin rule that reports with no rule id and that no lint detector names, naming the plugin key alone", () => {
    const result = run({}, { plugin: { file: "src/plugin.ts", prefix: "forge/", rules: { "b-rule": {} } } });

    expect(reported(result)).toContain("fail src/plugin.ts: plugin rule `b-rule` reports with no rule id");
  });
});

describe("checkRules() — markers", () => {
  it("fails a marker split across lines", () => {
    const result = run({ "docs/RULES.md": `${RULES_DOC}\nProse. <!--\nrule:forge-split -->\n` });

    expect(reported(result)).toEqual([
      "fail docs/RULES.md:5: rule marker `forge-split` is split across lines — keep `<!-- rule:… -->` on one line, or its id is never read",
    ]);
  });

  it("fails a malformed id", () => {
    const result = run({ "docs/RULES.md": `${RULES_DOC}\n<!-- rule:Bad_Id --> More.\n` });

    expect(reported(result)).toEqual([
      "fail docs/RULES.md:5: rule id `Bad_Id` is malformed — ids are lower-case kebab-case of two or more segments",
    ]);
  });

  it("fails a second marker for one id", () => {
    const result = run({ "docs/RULES.md": `${RULES_DOC}\n<!-- rule:forge-a --> Again.\n` });

    expect(reported(result)).toEqual(["fail docs/RULES.md:5: duplicate rule marker `forge-a` — already at docs/RULES.md:3"]);
  });

  it("fails a marker under no numbered section", () => {
    const result = run({ "docs/RULES.md": "# Rules\n\n<!-- rule:forge-a --> Because.\n" });

    expect(reported(result)).toEqual([
      "fail docs/RULES.md:3: rule marker `forge-a` sits under no numbered section, so the rule has no rationale to cite",
    ]);
  });

  it("fails a marker after the sentence it marks", () => {
    const result = run({ "docs/RULES.md": "## 1. Rules\n\n**Never do a.** <!-- rule:forge-a --> Because.\n" });

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual([
      "fail docs/RULES.md:3: rule marker `forge-a` does not open its paragraph, list item or table cell — the prose restates a rule the register holds, so delete the sentence before the marker",
    ]);
  });

  it("skips a marker quoted in a fence", () => {
    expect(run({ "docs/RULES.md": `${RULES_DOC}\n\`\`\`md\n<!-- rule:forge-quoted -->\n\`\`\`\n` }).ok).toBe(true);
  });
});

describe("checkRules() — prose that restates its statement", () => {
  const statement = "Never let a raw `#hex` colour reach a component's class list.";
  const doc = (block: string): Record<string, string> => ({ "docs/RULES.md": `## 1. Rules\n\n<!-- rule:forge-a --> ${block}\n` });

  it("fails a block holding six consecutive words of the statement, naming the rule and the run", () => {
    const result = run(doc("Letting a Raw `#hex` colour reach a theme-less\ncomponent sidesteps the theme."), withEntry({ statement }));

    expect(reported(result)).toEqual([
      'fail docs/RULES.md:3: rule marker `forge-a` opens prose that restates its statement — "a raw hex colour reach a"; the register holds that sentence, so delete it',
    ]);
  });

  it("passes a block sharing only five consecutive words", () => {
    expect(run(doc("Tokens theme; nothing raw should reach a component's class list."), withEntry({ statement })).ok).toBe(true);
  });
});

describe("checkRules() — entries", () => {
  it("fails a second entry for one id", () => {
    const result = run({}, { sources: [repo(ENTRY_A), { ...repo(ENTRY_A), file: "config/more.config.ts" }] });

    expect(reported(result)).toEqual(["fail config/more.config.ts: rule `forge-a` is declared twice — first in config/rules.config.ts"]);
  });

  it("fails a canon entry marked in a repository document", () => {
    const entry: RuleEntry = { id: "agent-guide-a", statement: "Never do a.", detectors: [{ kind: "review" }] };
    const source: RuleSource = { origin: "canon", file: "rules/shared/AGENT_GUIDE.ts", tree: "shared", doc: "AGENT_GUIDE.md", entries: [entry] };
    const result = run({ "docs/RULES.md": `${RULES_DOC}\n<!-- rule:agent-guide-a --> Here.\n` }, { sources: [repo(ENTRY_A), source] });

    expect(reported(result)).toEqual([
      "fail docs/RULES.md:5: rule marker `agent-guide-a` sits outside what rules/shared/AGENT_GUIDE.ts governs — a canon file's rules are marked in the document it mirrors, a repository's in its own",
    ]);
  });

  it("fails a repository entry without the repository's prefix", () => {
    const result = run({ "docs/RULES.md": "## 1. Rules\n\n<!-- rule:other-a --> Because.\n" }, withEntry({ id: "other-a" }));

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `other-a` does not start with `forge-`, the prefix where it is declared",
      "fail src/plugin.ts: plugin rule `a-rule` reports under `forge-a`, which no rule file declares",
    ]);
  });

  it("requires a canon entry to carry its tree where both canon trees hold its document", () => {
    const entry: RuleEntry = { id: "testing-x", statement: "Never do x.", detectors: [{ kind: "review" }] };
    const source: RuleSource = { origin: "canon", file: "rules/libs/TESTING.ts", tree: "libs", doc: "TESTING.md", entries: [entry] };
    const files = { "canon/libs/TESTING.md": "## 3. Tests\n\n<!-- rule:testing-x --> Because.\n", "canon/apps/TESTING.md": "## 1. Tests\n" };

    expect(reported(run(files, { sources: [repo(ENTRY_A), source] }))).toEqual([
      "fail rules/libs/TESTING.ts: rule `testing-x` does not start with `libs-testing-`, the prefix where it is declared",
    ]);
  });

  const statements = [
    { name: "two sentences", statement: "Never do a. Do b instead.", fault: "is more than one sentence" },
    { name: "an empty statement", statement: " ", fault: "is empty" },
    { name: "a statement on two lines", statement: "Never do\na.", fault: "spans more than one line" },
    { name: "a statement with no closing period", statement: "Never do a", fault: "does not end in `.`" },
    { name: "a statement with emphasis", statement: "Never do *a*.", fault: "contains `*`" },
  ];
  for (const { name, statement, fault } of statements) {
    it(`fails ${name}`, () => {
      expect(reported(run({}, withEntry({ statement })))).toEqual([
        `fail config/rules.config.ts: rule \`forge-a\`'s statement ${fault} — a statement is one sentence on one line, ending in \`.\``,
      ]);
    });
  }

  it("reads a sentence break inside backticks as code, not a second sentence", () => {
    expect(run({}, withEntry({ statement: "Never call `a. B` directly." })).ok).toBe(true);
  });

  for (const statement of ["Default: do a.", "Default: do a, with no override."]) {
    it(`fails the \`Default:\` statement ${JSON.stringify(statement)}, which has no \`unless …\` clause`, () => {
      expect(reported(run({}, withEntry({ statement })))).toEqual([
        "fail config/rules.config.ts: rule `forge-a`'s statement opens `Default:` with no override condition — end it with an `unless …` clause, or drop `Default:` and refile it as Floor",
      ]);
    });
  }

  it("passes a `Default:` statement that ends in `unless …`", () => {
    expect(run({}, withEntry({ statement: "Default: do a, unless b." })).ok).toBe(true);
  });
});

describe("checkRules() — detectors", () => {
  it("fails a step the gate does not declare", () => {
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "step", label: "validate-nothing" },
        ],
      }),
    );

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-a` names step `validate-nothing`, which the gate does not declare",
    ]);
  });

  it("fails a test path that does not exist, and one that is not a test source", () => {
    const detectors = [
      { kind: "lint", key: "forge/a-rule" },
      { kind: "test", path: "src/missing.test.ts" },
      { kind: "test", path: "src/a.ts" },
    ] as const;

    expect(reported(run({}, withEntry({ detectors })))).toEqual([
      "fail config/rules.config.ts: rule `forge-a` names test `src/missing.test.ts`, which does not exist",
      "fail config/rules.config.ts: rule `forge-a` names test `src/a.ts`, which is not a test source",
    ]);
  });

  it("passes a test path that exists", () => {
    expect(
      run(
        {},
        withEntry({
          detectors: [
            { kind: "lint", key: "forge/a-rule" },
            { kind: "test", path: "src/a.test.ts" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("fails one detector listed twice", () => {
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "lint", key: "forge/a-rule" },
        ],
      }),
    );

    expect(reported(result)).toEqual(["fail config/rules.config.ts: rule `forge-a` lists the detector lint `forge/a-rule` twice"]);
  });

  it("fails a plugin-prefixed lint key the plugin does not register", () => {
    const oxlint = JSON.stringify({ rules: { "forge/a-rule": "error", "forge/ghost": "error" } });
    const result = run(
      { ".oxlintrc.json": oxlint },
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "lint", key: "forge/ghost" },
        ],
      }),
    );

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-a` names lint key `forge/ghost`, which the plugin does not register",
    ]);
  });

  it("passes an rg detector that compiles, a warn with its triage and a fail without one", () => {
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "rg", pattern: "a(?!b)", paths: ["src/"], pcre: true, level: "fail" },
          { kind: "rg", pattern: "c", paths: ["src/"], level: "warn", triage: "c in a comment is fine" },
        ],
      }),
    );

    expect(reported(result)).toEqual([]);
  });

  it("fails an rg pattern that does not compile, a lookaround without pcre, and a detector searching no path", () => {
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "rg", pattern: "a(", paths: ["src/"], level: "fail" },
          { kind: "rg", pattern: "a(?=b)", paths: [], level: "fail" },
        ],
      }),
    );

    expect(reported(result).map((line) => line.replace(/ — .*/, " — …"))).toEqual([
      "fail config/rules.config.ts: rule `forge-a`'s rg pattern does not compile — …",
      "fail config/rules.config.ts: rule `forge-a`'s rg pattern uses lookaround or a backreference without `pcre: true`",
      "fail config/rules.config.ts: rule `forge-a`'s rg detector searches no path — …",
    ]);
  });

  it("fails a warn-level rg detector with no triage, and a fail-level one with a triage", () => {
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "rg", pattern: "a", paths: ["src/"], level: "warn" },
          { kind: "rg", pattern: "b", paths: ["src/"], level: "fail", triage: "b is sometimes fine" },
        ],
      }),
    );

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-a`'s warn-level rg detector carries no triage — state the false-positive class a hit is read against",
      "fail config/rules.config.ts: rule `forge-a`'s fail-level rg detector carries a triage — a hit that needs triage is a warn, and a fail has none to read",
    ]);
  });

  it("passes an rg detector that reports each hit example and none of its pass examples", () => {
    const examples = {
      hits: [["src/a.ts", "do a();"]],
      passes: [
        ["src/a.ts", "do b();"],
        ["docs/a.ts", "do a();"],
      ],
    } as const;
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "rg", pattern: String.raw`\ba\(`, paths: ["src/"], level: "fail", examples },
        ],
      }),
    );

    expect(reported(result)).toEqual([]);
  });

  it("fails a hit example the detector passes, by pattern or by path, and a pass example it reports", () => {
    const examples = {
      hits: [
        ["src/a.ts", "do b();"],
        ["docs/a.ts", "do a();"],
      ],
      passes: [["src/a.ts", "do a();"]],
    } as const;
    const result = run(
      {},
      withEntry({
        detectors: [
          { kind: "lint", key: "forge/a-rule" },
          { kind: "rg", pattern: String.raw`\ba\(`, paths: ["src/"], level: "fail", examples },
        ],
      }),
    );

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-a`'s rg detector does not report its hit example `do b();` at `src/a.ts`",
      "fail config/rules.config.ts: rule `forge-a`'s rg detector does not report its hit example `do a();` at `docs/a.ts`",
      "fail config/rules.config.ts: rule `forge-a`'s rg detector reports its pass example `do a();` at `src/a.ts`",
    ]);
  });

  it("fails an oxlint config that cannot be read", () => {
    expect(reported(run({}, { oxlintConfigs: [".oxlintrc.json", "missing.json"] }))).toEqual([
      "fail missing.json: could not be read as an oxlint config",
    ]);
  });
});

describe("checkRules() — sourceReach", () => {
  const RG: RuleEntry = {
    ...ENTRY_A,
    detectors: [
      { kind: "lint", key: "forge/a-rule" },
      { kind: "rg", pattern: "a", paths: ["src/"], level: "fail" },
    ],
  };
  const FILES = { "src/tool/x.ts": "", "tool/x.ts": "" };

  it("passes an rg rule reaching a file under the tree, and one exempted with a reason", () => {
    expect(reported(run(FILES, { sources: [repo(RG)], sourceReach: { dir: "src/tool", exempt: {} } }))).toEqual([]);
    expect(reported(run(FILES, { sources: [repo(RG)], sourceReach: { dir: "tool/", exempt: { "forge-a": "Binds only src/." } } }))).toEqual([]);
  });

  it("fails an rg rule reaching no file under the tree, at its rule file", () => {
    expect(reported(run(FILES, { sources: [repo(RG)], sourceReach: { dir: "tool/", exempt: {} } }))).toEqual([
      "fail config/rules.config.ts: rule `forge-a`'s rg detectors reach no file under `tool/` — widen its paths, or exempt it with the reason it binds nothing there",
    ]);
  });

  it("fails an exemption for a rule that reaches the tree or carries no rg detector, and one with no reason", () => {
    expect(reported(run(FILES, { sources: [repo(RG)], sourceReach: { dir: "src/", exempt: { "forge-a": "Binds nothing." } } }))).toEqual([
      "fail -: rule `forge-a` is exempt from reaching `src/` but is not an in-scope rg rule that misses it — delete the entry",
    ]);
    expect(reported(run(FILES, { sourceReach: { dir: "src/", exempt: { "forge-a": "Binds nothing." } } }))).toHaveLength(1);
    expect(reported(run(FILES, { sources: [repo(RG)], sourceReach: { dir: "tool/", exempt: { "forge-a": " " } } }))).toEqual([
      "fail -: rule `forge-a` is exempt from reaching `tool/` with no reason — say why it binds nothing there",
    ]);
  });
});

describe("checkRules() — the plugin", () => {
  it("fails a plugin rule whose id no rule file declares", () => {
    const result = run(
      {},
      { plugin: { file: "src/plugin.ts", prefix: "forge/", rules: { "a-rule": { id: "forge-a" }, "b-rule": { id: "forge-b" } } } },
    );

    expect(reported(result)).toEqual(["fail src/plugin.ts: plugin rule `b-rule` reports under `forge-b`, which no rule file declares"]);
  });

  it("fails an entry a plugin rule reports under that names no lint key for it", () => {
    const result = run({}, withEntry({ detectors: [{ kind: "review" }] }));

    expect(reported(result)).toEqual([
      "fail config/rules.config.ts: rule `forge-a` has no lint detector naming `forge/a-rule`, the plugin rule reporting under it",
    ]);
  });
});

describe("checkRules() — finding sources", () => {
  it("fails a string literal citing a section", () => {
    const result = run({ "src/checks/c.ts": 'export const m = "see CODE_RULES §5a";\n' });

    expect(reported(result)).toEqual(["fail src/checks/c.ts:1: names its rule by section, not by id"]);
  });

  it("fails a template chunk citing a section, and never a comment or a test", () => {
    const files = {
      "src/checks/c.ts": "// §5a is the budget\nexport const m = (x: string) => `${x} breaks §5a`;\n",
      "src/checks/c.test.ts": 'const m = "§5a";\n',
    };

    expect(reported(run(files))).toEqual(["fail src/checks/c.ts:2: names its rule by section, not by id"]);
  });

  it("fails a finding whose literal rule no rule file declares, and passes one that is declared", () => {
    const source = [
      'fail("first", { file, rule: "forge-zz" });',
      'warn("second", { rule: "forge-a" });',
      'fail("rule: \\"forge-in-message\\"", { file });',
    ].join("\n");

    expect(reported(run({ "src/checks/c.ts": source }))).toEqual([
      "fail src/checks/c.ts:1: reports under rule `forge-zz`, which no rule file declares",
    ]);
  });

  it("fails an id a check reports under that no rule file declares", () => {
    expect(reported(run({}, { reportedIds: ["forge-a", "forge-css-x"] }))).toEqual([
      "fail -: `forge-css-x` is reported under, but no rule file declares it",
    ]);
  });
});

describe("rulesStep()", () => {
  const files = {
    "config/rules.config.ts": `export default [{ id: "forge-a", statement: "Never do a.", detectors: [{ kind: "step", label: "late" }] }];\n`,
  };

  it("is labelled validate-rules, and touches no disk when built", () => {
    const { sources: _sources, ...config } = configFor("/nowhere/forge-no-such-root");
    const step = rulesStep({ ...config, stepLabels: () => [] });

    expect(step.label).toBe("validate-rules");
  });

  it("loads the rule file and reads the step labels when it runs", async () => {
    const root = fixture(files);
    let labels: readonly string[] = [];
    const { sources: _sources, plugin: _plugin, ...config } = configFor(root);
    const step = rulesStep({ ...config, canonRulesRoot: join(root, "rules"), stepLabels: () => labels });
    labels = ["late"];

    const result = await step.run("static");

    expect(reported(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails, naming the file, when the rule file does not load", async () => {
    const root = fixture({ "config/rules.config.ts": "export default {};\n" });
    const step = rulesStep({ ...configFor(root), canonRulesRoot: join(root, "rules"), stepLabels: () => [] });

    const result = await step.run("static");

    expect(result.ok).toBe(false);
    expect(reported(result)).toEqual([
      "fail -: config/rules.config.ts: the default export is not an array of rule entries — export `defineRules([...])`",
    ]);
  });
});
