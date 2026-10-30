import type { ValidationResult } from "../../result/types";
import type { PlaywrightServerStatus } from "./checks/types";
import type { ClassOrderCheckConfig } from "./checks/types";
import type { ContrastCheckConfig } from "./checks/types";
import type { DeferredFinding } from "./checks/types";
import type { ExportsCheckConfig } from "./checks/types";
import type { CompatibilityCheckConfig, ExposureCheckConfig } from "./checks/types";
import type { ExportsMap } from "./checks/types";
import type { ImportBoundaryCheckConfig } from "./checks/types";
import type { JsxCheckConfig } from "./checks/types";
import type { MarkdownCheckConfig } from "./checks/types";
import type { SsrBoundaryCheckConfig } from "./checks/types";

export type { ImportBoundaryCheckConfig } from "./checks/types";

/** Overrides every pre-built step accepts; each builder documents the default it applies. @public */
export interface StepOptions {
  /** The lowest tier the step runs in. */
  tier?: GateTier;
  /** Replaces the step's default dependency; `null` drops it, so a project that vendors one is not gated on probing it. */
  requires?: StepRequirement | null;
  /** Replaces the step's derived `watches`; `null` drops it, so the step runs on every change. */
  watches?: readonly string[] | null;
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
  /** The section's prose, with the trailing rule, blank lines and link definitions dropped. */
  body: readonly string[];
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
  /** Globs whose change selects every step under `--affected`, appended to `DEFAULT_GATE_INPUTS`. */
  gateInputs?: readonly string[];
  /** Whether an unscoped run records or clears the verify receipt; `false` for a table whose verdict is not the gate's. Defaults to `true`. */
  receipt?: boolean;
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
  /** The stylesheet the design system compiles from. */
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
  /** Test paths passed to `bun test`. Defaults to `["tests/"]`. Ignored when `testSets` is set. */
  tests?: readonly string[];
  testSets?: readonly { label: string; sources: readonly string[] }[];
  /** Asset config path; omit to skip the asset-types step entirely. */
  assetConfig?: string;
  /** Where the asset-types emitter writes. Defaults to `.forge/assets.ts`. */
  assetOut?: string;
  /** Whether to emit the two `wrangler types` steps. Defaults to `true`. */
  wranglerTypes?: boolean;
  /** `--config` for the bindings invocation; the runtime invocation takes none. Also the config the exposure row reads. */
  workerConfig?: string;
  /** How the exposure row judges each deployment; omit to take `require: "stated"`. Read only when `workerConfig` is set. */
  exposure?: Omit<ExposureCheckConfig, "root" | "workerConfig">;
  /** Overrides the flag set the compatibility row demands; omit to take forge's posture. Read only when `workerConfig` is set. */
  compatibility?: Omit<CompatibilityCheckConfig, "root" | "workerConfig">;
  /** Whether to check the synced `.claude/` trees against the installed corpus. Defaults to `false`. */
  warden?: boolean;
  /** Application root, needed by the asset-root and design checks. Defaults to `process.cwd()`. */
  root?: string;
  /** Whether to emit the `forge db` rows: the digests in `static`, the lint and the replay in `runtime`. Defaults to `false`. */
  db?: boolean;
  /** Whether to emit the `scheduled`-tier `test:browser` row on Chromium. Defaults to `false`. */
  browser?: boolean;
  /** Whether to emit the `runtime`-tier `test:workerd` step. Defaults to `false`. */
  workerd?: boolean;
  /** Omit to emit no JSX-pragma row. */
  jsx?: Omit<Partial<JsxCheckConfig>, "root">;
  /** Omit to emit no SSR-boundary row: which directories are browser-only is a repository's own rule. */
  ssrBoundary?: Omit<SsrBoundaryCheckConfig, "root"> & {
    /** Omit to emit no client-boundary row; nothing under `clientDirs` may import these at value. */
    serverDirs?: readonly string[];
  };
  /** Omit to emit no import-boundary row: which trees are one-way is a repository's own rule. `features: true` also reads `config/features.ts`. */
  importBoundary?: Omit<ImportBoundaryCheckConfig, "root" | "features"> & { features?: boolean };
  /** Omit to emit no vendor-boundary row; its modules may import nothing beside it under its parent directory. */
  vendorDir?: string;
  /** Omit to emit no contrast row. */
  contrast?: Omit<ContrastCheckConfig, "root">;
  /** Omit to emit no design rows, so an app that does not use `ui/*` needs no `tailwindcss` peer. */
  design?: CloudflareWorkerDesignOptions;
  /** The markdown conventions to hold prose to; omit to emit no row. */
  markdown?: Omit<MarkdownCheckConfig, "root">;
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

/** The counts and outcome a closing summary line is rendered from. @internal */
export interface SummaryInput {
  /** Gate verb, used verbatim in the line so `check` and `verify` are distinguishable. */
  gate: string;
  /** Steps that ran and passed — the only number a green line may be built from. */
  passed: number;
  /** Steps whose dependency was absent below the `runtime` tier. */
  skipped: number;
  /** Steps the selection resolved to. */
  selected: number;
  /** Steps the gate holds in total. */
  total: number;
  /** True when the selection was narrowed, so a green here is not the gate's. */
  scoped: boolean;
  /** The failing step and its position in the selection; absent when nothing failed. */
  failedAt?: { label: string; at: number };
  /** Wall-clock duration of the whole run. */
  ms: number;
}

/** A passing unscoped run, recorded against the tree it judged. @internal */
export interface GateReceipt {
  /** `git write-tree` over the working tree, untracked files in and ignored ones out. */
  tree: string;
  tier: GateTier;
  /** The `HEAD` commit the run's pending changes were read against; absent in a repository with no commit. */
  base?: string;
  /** Every step the run executed. */
  labels: readonly string[];
}

/** How a step ended in a reported run: `setup` when the suite never reached a test, `skipped` when a dependency absent below `runtime` excused it, `unreached` when an earlier step failed first. @public */
export type StepStatus = "passed" | "failed" | "setup" | "skipped" | "untouched" | "unreached";

/** One failing test, as a step's results file records it. @public */
export interface TestFailure {
  /** The Playwright project the test ran under. */
  engine: string;
  /** As the runner names it, relative to its test directory. */
  spec: string;
  /** Every enclosing `describe` and then the test, joined by ` › `. */
  title: string;
  /** The first line of the first error, bounded. */
  error: string;
}

/** One step's line in `report.json`. @public */
export interface StepReport {
  label: string;
  status: StepStatus;
  durationMs: number;
  /** The step's whole output, as a file name inside the report directory; absent for a step that never ran. */
  log?: string;
  /** Present only on a step that declares `results` and whose file recorded a test result. */
  failures?: readonly TestFailure[];
}

/** What `--report <dir>` writes as `report.json`, whatever the verdict. @public */
export interface GateRunReport {
  tier: GateTier;
  /** The `HEAD` commit; absent in a repository with no commit. */
  head?: string;
  /** `git write-tree` over the working tree; absent outside a git work tree. */
  tree?: string;
  /** ISO 8601. */
  startedAt: string;
  durationMs: number;
  verdict: "pass" | "fail";
  steps: readonly StepReport[];
}

/** A parsed `major.minor.patch` version. @public */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Which component of a {@link SemVer} to increment. @public */
export type BumpKind = "major" | "minor" | "patch";

/** The tiers in ascending order, so the CLI, the docs and the selector share one order. @public */
export const GATE_TIERS = ["static", "unit", "runtime", "scheduled"] as const;

/** How much of the table to run. @public */
export type GateTier = (typeof GATE_TIERS)[number];

/** How a selected step runs: its whole command, its command plus `narrow.args`, or not at all because no pending change touches it. @public */
export type StepReach = "whole" | "narrow" | "untouched";

/** A dependency a step needs, with the probe that detects it and the remedy to print. @public */
export interface StepRequirement {
  /** What is missing, named verbatim in the skipped and failure lines. */
  tool: string;
  /** Answers whether the dependency is present. Defaults to whether `<tool> --version` exits 0. */
  probe?: () => boolean | Promise<boolean>;
  /** Remedy shown verbatim when the probe fails, e.g. ``run `bun add -d esbuild` ``. */
  hint: string;
}

/** What the browser requirement asks, each defaulting to the real environment. @internal */
export interface BrowserProbes {
  env: Readonly<Record<string, string | undefined>>;
  clientVersion: () => string;
  serverStatus: (endpoint: string, clientVersion: string, headers?: Readonly<Record<string, string>>) => Promise<PlaywrightServerStatus>;
}

/** What every step carries, whichever way it runs. @public */
export interface StepBase {
  /** Stable identifier — the `--only` token, and the name reported on failure. */
  label: string;
  /** The lowest tier this step runs in; omitted, it runs from `static` up. */
  tier?: GateTier;
  /** Dependency probed before the step runs: absent, a run from `runtime` up fails and the lower tiers skip. */
  requires?: StepRequirement;
  /** Globs, relative to the runner's `cwd`, of every path the step reads; omitted, `--affected` runs it on any change. */
  watches?: readonly string[];
  /** Resolves at the `runtime` tier, for a step that would otherwise narrow or stay untouched, the paths relative to `cwd` whose change runs it whole that no glob names ahead of time; a rejection runs it whole. */
  widen?: (cwd: string) => readonly string[] | Promise<readonly string[]>;
  /** Narrows the step to pending changes at the `runtime` tier; at `scheduled` it runs whole. */
  narrow?: {
    /** Appended to `cmd` when a pending change touches `watches`. */
    args: readonly string[];
    /** Globs whose change runs the step whole, for inputs its narrowing cannot trace. */
    wide?: readonly string[];
    /** Appended to `cmd` and `args` to ask the tool what the narrowed run would select, without running it; a non-zero exit runs the step whole. */
    probe?: StepProbe;
  };
}

/** How a narrowed step asks its tool whether the pending changes select anything. @public */
export interface StepProbe {
  /** Appended after `narrow.args`, turning the narrowed run into a listing. */
  args: readonly string[];
  /** False only when the listing proves nothing is selected, so output it cannot read still runs the step. */
  selects: (output: string) => boolean;
}

/** A step run as an external process, reported from the tail of its captured output. @public */
export interface CommandStep extends StepBase {
  /** Executable followed by its arguments. Resolved against the runner's `binDir` on `PATH`. */
  cmd: readonly [string, ...string[]];
  /** Lines of the step's captured output shown when it fails. */
  tail: number;
  /** Auto-fixing counterpart invoked by `--fix`. Steps without one are counted as having no fixer. */
  fix?: readonly [string, ...string[]];
  /** Fails the step, naming each entry, when it exits with anything still in the TMPDIR the runner gave it. */
  leavesNoTemp?: boolean;
  /** Globs naming the TMPDIR entries the step keeps by design, which `leavesNoTemp` never reports. */
  tempCaches?: readonly string[];
  /** Asked for only under `--report`, so a failed run names its failing tests rather than only its output. */
  results?: StepResults;
  run?: never;
}

/** A machine-readable results file a command step writes into its TMPDIR, read before that TMPDIR is removed. @public */
export interface StepResults {
  /** Appended to `cmd`, so the tool writes the file. */
  args: readonly string[];
  /** Set to the file's path. */
  env: string;
  /** The failing tests the file records, or `undefined` when it records no test result at all. */
  read: (text: string) => readonly TestFailure[] | undefined;
}

/** A step run in-process, reported from the findings it returns rather than from captured text. @public */
export interface CheckStep extends StepBase {
  run: (tier: GateTier) => CheckResult | Promise<CheckResult>;
  /** Auto-fixing counterpart invoked by `--fix`, called in-process like `run`. */
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
      /** How each selected step runs, by label. */
      reach: Readonly<Record<string, StepReach>>;
      /** How many steps the tier holds in total — the denominator of the scoped banner. */
      total: number;
      /** True when fewer steps were selected than the tier holds or `changed` narrowed the run, so a green is not a gate green. */
      scoped: boolean;
    }
  | { ok: false; error: string };
