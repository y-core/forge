import type { ValidationResult } from "../../result/types";
import type { ClassOrderCheckConfig } from "./checks/types";
import type { DeferredFinding } from "./checks/types";
import type { ExportsCheckConfig } from "./checks/types";
import type { ExportsMap } from "./checks/types";
import type { JsxCheckConfig } from "./checks/types";
import type { GATE_MODES } from "./steps";

/** Overrides every pre-built step accepts; each builder documents the default it applies. @public */
export interface StepOptions {
  /** The lowest mode the step runs in. */
  tier?: GateMode;
  /** Replaces the step's default dependency; `null` drops it, so a project that vendors one is not gated on probing it. */
  requires?: StepRequirement | null;
}

/** Sources a tool step is pointed at. @public */
export interface SourceStepOptions extends StepOptions {
  /** Paths passed to the tool, relative to the runner's `cwd`. */
  sources?: readonly string[];
}

/** A released version heading, as it appears in the document. @public */
export interface VersionHeading {
  /** Bare semver, no brackets — `"0.0.83"`. */
  version: string;
  /** ISO calendar date — `"2026-08-11"`. */
  date: string;
  /** Zero-indexed line the heading sits on. */
  line: number;
}

/** The `[Unreleased]` section: where it sits, what it holds, and whether that amounts to anything. @public */
export interface UnreleasedSection {
  /** Zero-indexed line of the `## [Unreleased]` heading. */
  line: number;
  /** Verbatim body lines, from just after the heading up to the next `## ` heading or EOF. */
  body: readonly string[];
  /** True when the body carries no content — see {@link parseChangelog} for the exact rule. */
  empty: boolean;
}

/** A changelog's structure: the editable section, the released headings, and the link definitions. @public */
export interface ChangelogDocument {
  unreleased: UnreleasedSection;
  /** Released headings in document order — newest first, if the document is well-formed. */
  versions: readonly VersionHeading[];
  /** Versions named by a link reference definition, in document order. */
  linkRefs: readonly string[];
}

/** The outcome of reading a changelog: its structure, or every reason the document could not be read. @public */
export type ChangelogParse = ValidationResult<ChangelogDocument>;

/** Inputs to {@link promoteUnreleased}. @public */
export interface PromoteOptions {
  /** The version the section is being promoted to — bare semver, no leading `v`. */
  version: string;
  /** Release date, already formatted — see {@link formatReleaseDate}. */
  date: string;
  /** Tag prefix used when building the compare URL. Defaults to `"v"`. */
  tagPrefix?: string;
  /** Repository base URL, e.g. `https://github.com/y-core/forge`. Omit to skip the link definition. */
  compareUrlBase?: string;
}

/** What the runner needs to know about the project it is gating. @public */
export interface GateCommandConfig {
  /** Repository root. Every step is spawned here, so a step's relative paths resolve. */
  cwd: string;
  /** The table to resolve against — the project's own steps. */
  steps: readonly Step[];
  /** Prepended to `PATH` so bare tool names resolve. Defaults to `${cwd}/node_modules/.bin`. */
  binDir?: string;
}

/** The severity of a finding: `fail` fails the check, `warn` is reported and does not. */
export type FindingLevel = "fail" | "warn";

/** One thing a check has to say about the tree it walked. @public */
export interface Finding {
  level: FindingLevel;
  message: string;
  /** Repository-relative path, when the finding is about one file. */
  file?: string;
  /** 1-indexed line within `file`. */
  line?: number;
  /** Evidence lines shown indented beneath `message`. */
  detail?: readonly string[];
}

/** What a check returns: its verdict, its findings, and one line naming what it covered. @public */
export interface CheckResult {
  ok: boolean;
  findings: readonly Finding[];
  summary: string;
}

/** The design rows a Worker app opts into, and the paths they read. @public */
export interface CloudflareWorkerDesignOptions {
  /** The stylesheet the design system compiles from. Three of the four rows need it. */
  stylesheet: string;
  /** Directory of stylesheets the token check reads; omit to skip `validate-css-tokens`. */
  cssDir?: string;
  /** Sources the class rules scan. Defaults to `["src/"]` — deliberately not the table's `sources`. */
  sources?: readonly string[];
  /** Platform-CSS findings this app defers. Defaults to `[]`, never forge's own list. */
  deferred?: readonly DeferredFinding[];
}

/** Options for the shared Cloudflare Worker step table. @public */
export interface CloudflareWorkerStepOptions {
  /** Directories linted and type-checked. Defaults to `["src/", "tests/"]`. */
  sources?: readonly string[];
  /** Test paths passed to `bun test`. Defaults to `["tests/"]`. */
  tests?: readonly string[];
  /** Asset config path; omit to skip the asset-types step entirely. */
  assetConfig?: string;
  /** Where the asset-types emitter writes. Defaults to `.forge/assets.ts`. */
  assetOut?: string;
  /** Whether to emit the two `wrangler types` steps. Defaults to `true`. */
  wranglerTypes?: boolean;
  /** `--config` for the bindings invocation; the runtime invocation takes none. */
  workerConfig?: string;
  /** Whether to check the synced `.claude/` trees against the installed corpus. Defaults to `false`. */
  warden?: boolean;
  /** Application root, needed by the asset-root and design checks. Defaults to `process.cwd()`. */
  root?: string;
  /** Whether to emit the `full`-tier `test:browser` step. Defaults to `false`. */
  browser?: boolean;
  /** Whether to emit the `full`-tier `test:workerd` step. Defaults to `false`. */
  workerd?: boolean;
  /** Omit to emit no design rows, so an app that does not use `ui/*` needs no `tailwindcss` peer. */
  design?: CloudflareWorkerDesignOptions;
}

/** The fields `forgeChecks` reads from the consuming package's `package.json`. @public */
export interface GatePackage {
  name: string;
  version: string;
  exports: ExportsMap;
  files: readonly string[];
}

/** Options for the shared library step table. @public */
export interface LibraryStepOptions {
  /** Repository root. Every check resolves and reports its paths against it. */
  root: string;
  /** The consuming package's `package.json`, read for its name, version, `exports`, and `files`. */
  pkg: GatePackage;
  /** Directories linted. Defaults to `["src/"]`. */
  sources?: readonly string[];
  /** Test paths passed to `bun test`. Defaults to the whole project. */
  tests?: readonly string[];
  /** Merged over the exports config derived from `pkg`. */
  exports?: Omit<Partial<ExportsCheckConfig>, "root">;
  /** Merged over the jsx config derived from `root`. */
  jsx?: Omit<Partial<JsxCheckConfig>, "root">;
  /** Merged over the class-order config derived from `root`; `sources` defaults to `["src"]`. */
  classOrder?: Omit<Partial<ClassOrderCheckConfig>, "root">;
}

/** The counts and outcome a closing summary line is rendered from. */
export interface SummaryInput {
  /** Gate verb, used verbatim in the line so `check` and `verify` are distinguishable. */
  gate: string;
  /** Steps that ran and passed — the only number a green line may be built from. */
  passed: number;
  /** Steps whose dependency was absent below the `full` tier. */
  skipped: number;
  /** Steps the selection resolved to. */
  selected: number;
  /** Steps the gate holds in total. */
  total: number;
  /** The failing step and its position in the selection; absent when nothing failed. */
  failedAt?: { label: string; at: number };
  /** Wall-clock duration of the whole run. */
  ms: number;
}

/** A parsed `major.minor.patch` version. @public */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Which component of a {@link SemVer} to increment. @public */
export type BumpKind = "major" | "minor" | "patch";

/** How much of the table to run: `fast` is the inner loop, `standard` is the gate a task closes on,
 *  `full` adds everything, including the steps that may require a machine prerequisite. @public */
export type GateMode = (typeof GATE_MODES)[number];

/** A dependency a step needs, with the probe that detects it and the remedy to print — absent, a
 *  fast or standard run reports the step skipped and a full run fails it. @public */
export interface StepRequirement {
  /** What is missing, named verbatim in the skipped and failure lines. */
  tool: string;
  /** Answers whether the dependency is present. Defaults to whether `<tool> --version` exits 0. */
  probe?: () => boolean;
  // Rendered verbatim, so it carries its own verb and backticks: a remedy is not always one command.
  /** Remedy shown verbatim when the probe fails, e.g. ``run `bun add -d esbuild` ``. */
  hint: string;
}

/** What every step carries, whichever way it runs. @public */
export interface StepBase {
  /** Stable identifier — the `--only` token, and the name reported on failure. */
  label: string;
  /** The lowest mode this step runs in; omitted, it runs from `fast` up. */
  tier?: GateMode;
  /** Dependency probed before the step runs: absent, only a full run fails; the lower modes skip. */
  requires?: StepRequirement;
}

/** A step run as an external process, reported from the tail of its captured output. @public */
export interface CommandStep extends StepBase {
  /** Executable followed by its arguments. Resolved against the runner's `binDir` on `PATH`. */
  cmd: readonly [string, ...string[]];
  /** Lines of the step's captured output shown when it fails. */
  tail: number;
  /** Auto-fixing counterpart invoked by `--fix`. Steps without one are counted as having no fixer. */
  fix?: readonly [string, ...string[]];
  run?: never;
}

/** A step run in-process, reported from the findings it returns rather than from captured text. @public */
export interface CheckStep extends StepBase {
  /** Invoked by the runner with the mode of the run, so a check whose strictness depends on it — a
   *  release gate refusing what a dev loop tolerates — has one row rather than two. Its findings are
   *  printed verbatim, so there is no `tail` to truncate to. */
  run: (mode: GateMode) => CheckResult | Promise<CheckResult>;
  /** Auto-fixing counterpart invoked by `--fix`, called in-process like `run`. Absent, the step is
   *  counted as having no fixer. A fixer writes and reports nothing; `run` reports and writes
   *  nothing — the two halves of the dev loop are not the same verb. */
  fix?: () => void | Promise<void>;
  cmd?: never;
}

/** One gate step: an external command, or a check the runner calls directly. @public */
export type Step = CommandStep | CheckStep;

/** A resolved run plan, or the reason no run may proceed. @public */
export type Selection =
  | {
      ok: true;
      /** The steps to run, in table order. */
      steps: readonly Step[];
      /** How many steps the mode holds in total — the denominator of the scoped banner. */
      total: number;
      /** True when fewer steps were selected than the mode holds, i.e. a green is not a gate green. */
      scoped: boolean;
    }
  | { ok: false; error: string };
