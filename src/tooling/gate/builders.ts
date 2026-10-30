import { createRequire } from "node:module";
import { isAbsolute } from "node:path";

import { importClosure } from "../assets/closure";
import { checkAssetManifest } from "./checks/asset-manifest";
import { checkAssetRoot } from "./checks/asset-root";
import { checkBundle, checkNodeExports, hasEsbuild } from "./checks/bundle";
import { checkClassGroups } from "./checks/class-groups";
import { checkClassOrder } from "./checks/class-order";
import { checkClassTokens } from "./checks/class-tokens";
import { checkCoLocation } from "./checks/co-location";
import { checkCommentBudget } from "./checks/comment-budget";
import { checkCompatibility } from "./checks/compatibility";
import { checkContrast } from "./checks/contrast";
import { checkCrossEngineTags } from "./checks/cross-engine-tags";
import { checkCssCoverage } from "./checks/css-coverage";
import { checkCssSources } from "./checks/css-sources";
import { checkCssTokens } from "./checks/css-tokens";
import { checkDesignScale } from "./checks/design-scale";
import { hasTailwind } from "./checks/design-system";
import { checkDevBoundary } from "./checks/dev-boundary";
import { checkDevBundle } from "./checks/dev-bundle";
import { checkExports } from "./checks/exports";
import { checkExposure } from "./checks/exposure";
import { checkFadedText } from "./checks/faded-text";
import { checkIccProfile } from "./checks/icc-profile";
import { checkImportBoundary } from "./checks/import-boundary";
import { checkJsx } from "./checks/jsx";
import { checkMarkdown, fixMarkdown } from "./checks/markdown";
import { checkMenuNaming } from "./checks/menu-naming";
import { checkModernCss } from "./checks/modern-css";
import { checkNamespaceGraph } from "./checks/namespace-graph";
import { checkPackaging } from "./checks/packaging";
import { playwrightServerStatus } from "./checks/playwright-server";
import { checkSsrBoundary } from "./checks/ssr-boundary";
import { checkStubGlobals } from "./checks/stub-globals";
import type { AssetManifestCheckConfig } from "./checks/types";
import type { AssetRootCheckConfig } from "./checks/types";
import type { BundleCheckConfig, IccProfileCheckConfig, NodeExportsCheckConfig } from "./checks/types";
import type { ClassGroupsCheckConfig } from "./checks/types";
import type { ClassOrderCheckConfig } from "./checks/types";
import type { ClassTokensCheckConfig } from "./checks/types";
import type { CoLocationCheckConfig } from "./checks/types";
import type { CommentBudgetCheckConfig } from "./checks/types";
import type { CompatibilityCheckConfig } from "./checks/types";
import type { ContrastCheckConfig } from "./checks/types";
import type { CrossEngineTagsCheckConfig } from "./checks/types";
import type { CssCoverageCheckConfig } from "./checks/types";
import type { CssSourcesCheckConfig } from "./checks/types";
import type { CssTokensCheckConfig } from "./checks/types";
import type { FadedTextCheckConfig } from "./checks/types";
import type { DesignScaleCheckConfig } from "./checks/types";
import type { DevBoundaryCheckConfig } from "./checks/types";
import type { DevBundleCheckConfig } from "./checks/types";
import type { ExportsCheckConfig } from "./checks/types";
import type { ExposureCheckConfig } from "./checks/types";
import type { ImportBoundaryCheckConfig } from "./checks/types";
import type { JsxCheckConfig } from "./checks/types";
import type { MarkdownCheckConfig } from "./checks/types";
import type { MenuNamingCheckConfig } from "./checks/types";
import type { StubGlobalsCheckConfig } from "./checks/types";
import type { ModernCssCheckConfig } from "./checks/types";
import type { PackagingCheckConfig } from "./checks/types";
import type { NamespaceGraphCheckConfig } from "./checks/types";
import type { SsrBoundaryCheckConfig } from "./checks/types";
import type { DeclaredGraph } from "./checks/types";
import { hasWorkerd } from "./checks/workerd";
import { PLAYWRIGHT_RESULTS } from "./playwright-results";
import type { BrowserProbes, CheckStep, CommandStep, GateTier, StepBase, StepRequirement } from "./types";
import type { SourceStepOptions, StepOptions } from "./types";

function tier(value: GateTier | undefined, fallback: GateTier = "static"): { tier: GateTier } | Record<string, never> {
  const resolved = value ?? fallback;
  return resolved === "static" ? {} : { tier: resolved };
}

type NarrowOptions = { args?: readonly string[]; wide?: readonly string[] };

type WidenOption = { widen?: StepBase["widen"] };

function playwrightListSelects(output: string): boolean {
  const last = output.trimEnd().split("\n").at(-1);
  return last !== "Total: 0 tests in 0 files";
}

function widening(widen: StepBase["widen"]): { widen: NonNullable<StepBase["widen"]> } | Record<string, never> {
  return widen === undefined ? {} : { widen };
}

// `--only-changed` traces each spec's imports, so what a spec reads without importing it widens the run whole.
// `--list` loads the specs without global setup or a browser, and Playwright exits 0 when `--only-changed` selects none.
function playwrightNarrowing(options: NarrowOptions | undefined): { narrow: NonNullable<StepBase["narrow"]> } {
  return {
    narrow: {
      args: options?.args ?? ["--only-changed"],
      wide: ["playwright.config.ts", ...(options?.wide ?? [])],
      probe: { args: ["--list"], selects: playwrightListSelects },
    },
  };
}

function prerequisite(
  override: StepRequirement | null | undefined,
  fallback?: StepRequirement,
): { requires: StepRequirement } | Record<string, never> {
  const resolved = override === undefined ? fallback : (override ?? undefined);
  return resolved === undefined ? {} : { requires: resolved };
}

function watching(
  override: readonly string[] | null | undefined,
  fallback?: readonly string[],
): { watches: readonly string[] } | Record<string, never> {
  const resolved = override === undefined ? fallback : (override ?? undefined);
  return resolved === undefined ? {} : { watches: resolved };
}

function trimEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => !entry.startsWith("!")).map((entry) => entry.replace(/^\.\//, "").replace(/\/+$/, ""));
}

/** Globs covering each source entry and everything beneath it, `!` exclusions dropped so the list stays a superset. */
export function sourceWatches(entries: readonly string[]): string[] {
  const globs = trimEntries(entries).flatMap((entry) => (entry === "." || entry === "" ? ["**"] : [entry, `${entry}/**`]));
  return [...new Set(globs)];
}

function markdownWatches(entries: readonly string[]): string[] {
  const globs = trimEntries(entries).map((entry) => {
    if (entry === "." || entry === "") return "**/*.md";
    return entry.endsWith(".md") ? entry : `${entry}/**/*.md`;
  });
  return [...new Set(globs)];
}

const STYLESHEET_WATCHES = "**/*.css";

/** Wraps a check function as a step, applying the tier and prerequisite an option table overrides. @public */
export function checkStep(
  label: string,
  run: CheckStep["run"],
  options: StepOptions,
  defaults: { tier?: GateTier; requires?: StepRequirement; fix?: CheckStep["fix"]; watches?: readonly string[] } = {},
): CheckStep {
  return {
    label,
    run,
    ...(defaults.fix === undefined ? {} : { fix: defaults.fix }),
    ...tier(options.tier, defaults.tier),
    ...prerequisite(options.requires, defaults.requires),
    ...watching(options.watches, defaults.watches),
  };
}

/** `tsc --noEmit`. Belongs first in a table: a type failure cascades into misleading lint and test failures. @public */
export function typecheckStep(options: StepOptions = {}): CommandStep {
  return { label: "typecheck", tail: 20, cmd: ["tsc", "--noEmit"], ...tier(options.tier), ...watching(options.watches) };
}

/** `oxlint` over `sources` (default `src/`), with `--fix` as its fixer. @public */
export function lintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint",
    tail: 20,
    // oxlint exits 0 on `warn`, so without this a green gate would not mean a clean tree.
    cmd: ["oxlint", "--deny-warnings", ...sources],
    fix: ["oxlint", "--fix", ...sources],
    ...tier(options.tier),
    ...watching(options.watches, [...sourceWatches(sources), ".oxlintrc*", ".oxlintignore", ".gitignore"]),
  };
}

/** `oxfmt --check` over `sources` (default `src/`), with a bare `oxfmt` run as its fixer. Ordered after `lintStep` so the formatter owns the final byte layout. @public */
export function formatStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "format",
    tail: 20,
    cmd: ["oxfmt", "--check", ...sources],
    fix: ["oxfmt", ...sources],
    ...tier(options.tier),
    ...watching(options.watches, [...sourceWatches(sources), ".oxfmtrc*", ".prettierignore", ".gitignore"]),
  };
}

/** `oxlint --type-aware` over `sources` (default `src/`), the slowest row of the `static` tier at a few seconds. @public */
export function typeAwareLintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint:types",
    tail: 40,
    // The unused-directive check rides here, not on `lint`: this run is a superset, so it is the only
    // one that can tell a stale directive from one that only a type-aware rule redeems.
    cmd: ["oxlint", "--type-aware", "--deny-warnings", "--report-unused-disable-directives-severity", "error", ...sources],
    ...tier(options.tier),
    ...watching(options.watches),
  };
}

/** `bun test` over `sources`, or the whole project when none are named; defaults to `unit`, the tier that runs the code rather than judging it. @public */
export function testStep(options: SourceStepOptions & { label?: string; leavesNoTemp?: boolean } = {}): CommandStep {
  return {
    label: options.label ?? "test",
    tail: 120,
    cmd: ["bun", "test", ...(options.sources ?? [])],
    ...(options.leavesNoTemp === true ? { leavesNoTemp: true } : {}),
    ...tier(options.tier, "unit"),
    ...watching(options.watches),
  };
}

function playwrightClientVersion(): string {
  return (createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }).version;
}

type ServerAnswer =
  | { state: "ready" }
  | { state: "unreachable"; reason: string }
  | { state: "mismatch"; server: string; client: string }
  | { state: "no-client"; reason: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function askServer(endpoint: string, probes: Pick<BrowserProbes, "env" | "clientVersion" | "serverStatus">): Promise<ServerAnswer> {
  let client: string;
  try {
    client = probes.clientVersion();
  } catch (error) {
    return { state: "no-client", reason: messageOf(error) };
  }
  let headers: Record<string, string>;
  try {
    headers = probes.env.PW_TEST_CONNECT_HEADERS === undefined ? {} : (JSON.parse(probes.env.PW_TEST_CONNECT_HEADERS) as Record<string, string>);
  } catch (error) {
    return { state: "unreachable", reason: `PW_TEST_CONNECT_HEADERS: ${messageOf(error)}` };
  }
  const status = await probes.serverStatus(endpoint, client, headers);
  return status.state === "mismatch" ? { ...status, client } : status;
}

interface PlaywrightServer {
  variable: string;
  tool: string;
  unset: string;
  running: string;
}

/** The server Chromium runs on. @internal */
export const PRIMARY_SERVER: PlaywrightServer = {
  variable: "PW_TEST_CONNECT_WS_ENDPOINT",
  tool: "Playwright server",
  unset: "set it to the Playwright container's ws:// URL",
  running: "check the Playwright sidecar is running",
};

/** The server Firefox and WebKit run on. @internal */
export const COMPAT_SERVER: PlaywrightServer = {
  variable: "PLAYWRIGHT_COMPAT_WS_ENDPOINT",
  tool: "Playwright compat server",
  unset:
    "Firefox and WebKit run on the playwright-compat server — start it with `devctl infra up playwright-compat` and set the variable to its ws:// URL",
  running: "check the playwright-compat server is up (`devctl infra up playwright-compat`)",
};

// Every browser step under one endpoint names the same tool, and the gate probes a tool once, so the
// answer is kept per endpoint: a step whose own probe never ran still prints what the server said.
const serverAnswers = new Map<string, ServerAnswer>();

function playwrightServerRequired(
  server: PlaywrightServer,
  endpoint: string,
  probes: Pick<BrowserProbes, "env" | "clientVersion" | "serverStatus">,
): StepRequirement {
  return {
    tool: `${server.tool} at ${endpoint}`,
    probe: async () => {
      const answer = await askServer(endpoint, probes);
      serverAnswers.set(endpoint, answer);
      return answer.state === "ready";
    },
    get hint() {
      const answer = serverAnswers.get(endpoint);
      if (answer?.state === "no-client") {
        return `\`@playwright/test\` cannot be resolved (${answer.reason}); add it as a devDependency at the server's Playwright version`;
      }
      if (answer?.state === "mismatch") {
        return `the server runs Playwright ${answer.server} and \`@playwright/test\` is ${answer.client}; pin \`@playwright/test\` to ${answer.server}`;
      }
      const host = URL.parse(endpoint)?.hostname ?? endpoint;
      const reason = answer?.state === "unreachable" ? ` (${answer.reason})` : "";
      return `nothing answered at ${endpoint}${reason}; ${server.running} and that NO_PROXY includes \`${host}\``;
    },
  };
}

/** A browser row's requirement: the Playwright server `server.variable` names, failing when it names none. @internal */
export function browserRequired(server: PlaywrightServer, probes: Partial<BrowserProbes> = {}): StepRequirement {
  const env = probes.env ?? process.env;
  const endpoint = env[server.variable];
  if (endpoint === undefined || endpoint === "") {
    return { tool: server.tool, probe: () => false, hint: `\`${server.variable}\` is unset; ${server.unset}` };
  }
  return playwrightServerRequired(server, endpoint, {
    env,
    clientVersion: probes.clientVersion ?? playwrightClientVersion,
    serverStatus: probes.serverStatus ?? playwrightServerStatus,
  });
}

/** `playwright test --project=chromium` under node, defaulting to the `release` tier: it needs the Playwright server, and the whole suite is too slow for the run a task closes on. Always run whole. @public */
export function browserStep(options: StepOptions = {}): CommandStep {
  return {
    label: "test:browser",
    ...tier(options.tier, "release"),
    tail: 120,
    // The installed binary off `binDir`, never `bunx`, which falls back to installing from the registry.
    // Its shebang is node: under bun a dev server playwright spawns binds where a sandboxed browser cannot reach it.
    cmd: ["playwright", "test", "--project=chromium"],
    // The probe targets the server, not the `playwright` CLI: the CLI is a devDependency and always
    // present, so probing it would pass vacuously and let every spec fail at connect.
    ...prerequisite(options.requires, options.requires === undefined ? browserRequired(PRIMARY_SERVER) : undefined),
    ...watching(options.watches),
    results: PLAYWRIGHT_RESULTS,
  };
}

/** `playwright test --project=firefox --project=webkit` on the compat server, defaulting to the `release` tier, for a cron table rather than the gate. Always run whole. @public */
export function crossEngineStep(options: StepOptions = {}): CommandStep {
  return {
    label: "test:browser:cross-engine",
    ...tier(options.tier, "release"),
    tail: 120,
    cmd: ["playwright", "test", "--project=firefox", "--project=webkit"],
    ...prerequisite(options.requires, options.requires === undefined ? browserRequired(COMPAT_SERVER) : undefined),
    ...watching(options.watches),
    results: PLAYWRIGHT_RESULTS,
  };
}

/** `playwright test --project=workerd` over `sources` (default every spec the project matches), defaulting to the `runtime` tier: it needs the workerd runtime installed. Narrowed and widened as {@link browserStep} is. @public */
export function workerdStep(
  options: { hint?: string; leavesNoTemp?: boolean; narrow?: NarrowOptions } & WidenOption & SourceStepOptions = {},
): CommandStep {
  return {
    label: "test:workerd",
    ...tier(options.tier, "runtime"),
    tail: 120,
    // Node, never bun: under bun `createTestHarness` loses the `cf` blob miniflare's own `undici` carries, and no request is ever answered.
    cmd: ["playwright", "test", "--project=workerd", ...(options.sources ?? [])],
    ...(options.leavesNoTemp === true ? { leavesNoTemp: true } : {}),
    tempCaches: ["playwright-transform-cache-*"],
    // The probe targets the runtime, not the test runner: the `playwright` CLI is a devDependency and
    // always present, so probing it would pass vacuously and let every spec fail at harness start.
    ...prerequisite(options.requires, {
      tool: "workerd",
      probe: hasWorkerd,
      hint: options.hint ?? "run `bun install` — `wrangler` brings the workerd runtime with it",
    }),
    ...watching(options.watches),
    ...widening(options.widen),
    ...playwrightNarrowing(options.narrow),
  };
}

/** Globs covering every namespace in `namespaces` and each one they reach through `graph`'s edges, primitives included; throws on a namespace the graph does not declare. */
export function namespaceWatches(namespaces: readonly string[], graph: DeclaredGraph): string[] {
  const declared = new Set([...Object.keys(graph.edges), ...Object.values(graph.edges).flatMap(Object.keys), ...graph.primitives, ...graph.leaf]);
  const unknown = namespaces.find((namespace) => !declared.has(namespace));
  if (unknown !== undefined) throw new Error(`"${unknown}", which the namespace graph does not declare`);
  const reached = new Set([...namespaces, ...graph.primitives]);
  for (const namespace of reached) for (const target of Object.keys(graph.edges[namespace] ?? {})) reached.add(target);
  return [...reached].sort().map((namespace) => `src/${namespace}/**`);
}

const SOURCE_ENTRY = /\.[cm]?[jt]sx?$/;

function dbWatches(root: string | undefined, exercises: readonly string[] | undefined, graph: DeclaredGraph | undefined): string[] | undefined {
  if (exercises === undefined) return undefined;
  if (graph === undefined) throw new Error("dbSteps: `exercises` names namespaces, so it needs the `graph` to expand them through");
  let watched: string[];
  try {
    watched = namespaceWatches(exercises, graph);
  } catch (error) {
    throw new Error(`dbSteps: \`exercises\` names ${messageOf(error)}`, { cause: error });
  }
  if (root === undefined || isAbsolute(root)) return undefined;
  return [...watched, `${root.replace(/\/+$/, "")}/**`];
}

/** The `forge db` rows: the schema digests in `static`; the lint, which reads the local database, and the schema replay in `runtime`, behind the installed runtime. `forge` is the command that runs the CLI, `["forge"]` by default. Watching a relative `root` and every namespace `exercises` reaches through `graph`, else every change; a source file in `forge` runs them whole when its import closure changes. @public */
export function dbSteps(
  options: { root?: string; forge?: readonly [string, ...string[]]; hint?: string; exercises?: readonly string[]; graph?: DeclaredGraph } = {},
): [CommandStep, CommandStep, CommandStep] {
  const forge = options.forge ?? ["forge"];
  const root = options.root === undefined ? [] : ["--root", options.root];
  const watches = watching(dbWatches(options.root, options.exercises, options.graph));
  const entries = forge.filter((arg) => SOURCE_ENTRY.test(arg)).map((arg) => `./${arg.replace(/^\.\//, "")}`);
  const traced = entries.length === 0 ? {} : { widen: (cwd: string) => importClosure(cwd, entries) };
  const requires = {
    tool: "workerd",
    probe: hasWorkerd,
    hint: options.hint ?? "run `bun install` — `wrangler` brings the workerd runtime with it",
  };
  return [
    { label: "db:schema:digests", tail: 40, cmd: [...forge, "db", "schema", "check", ...root], ...watches, ...traced },
    { label: "db:lint", tier: "runtime", tail: 40, cmd: [...forge, "db", "lint", ...root], requires, ...watches, ...traced },
    {
      label: "db:schema",
      tier: "runtime",
      tail: 60,
      cmd: [...forge, "db", "schema", "check", "--replay", ...root],
      requires,
      ...watches,
      ...traced,
    },
  ];
}

/** Audits the `exports` map against what is on disk and what is published. @public */
export function exportsStep(config: ExportsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-exports", () => checkExports(config), options);
}

/** Diffs the observed cross-namespace imports against the declared graph. @public */
export function namespaceGraphStep(config: NamespaceGraphCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-namespace-graph", () => checkNamespaceGraph(config), options);
}

/** Diffs the files the assets pipeline writes to the asset root against the `run_worker_first` exclusions. @public */
export function assetRootStep(config: AssetRootCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-asset-root", () => checkAssetRoot(config), options);
}

/** Fails on any Worker config key whose default runs toward exposure being unstated, in the top level and every `env.*` block; requiring a *value* rather than statedness is opt-in via `require`. @public */
export function exposureStep(config: ExposureCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-exposure", () => checkExposure(config), options, { watches: [config.workerConfig ?? "wrangler.jsonc"] });
}

/** Fails a Worker config whose `compatibility_flags` omits or contradicts the runtime posture, in the top level and every `env.*` block that states a set of its own. @public */
export function compatibilityStep(config: CompatibilityCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-compatibility", () => checkCompatibility(config), options, { watches: [config.workerConfig ?? "wrangler.jsonc"] });
}

/** Checks every path the emitted assets manifest maps to exists under the served asset directory. @public */
export function assetManifestStep(config: AssetManifestCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-asset-manifest", (gateTier) => checkAssetManifest(config, gateTier), options);
}

/** Checks every source module has a test beside it, so deleting one is loud rather than silent. @public */
export function coLocationStep(config: CoLocationCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-co-location", () => checkCoLocation(config), options, { watches: sourceWatches(config.sources) });
}

/** Checks every comment against the budget, so prose the code already states cannot accumulate unseen. @public */
export function commentBudgetStep(config: CommentBudgetCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-comment-budget", () => checkCommentBudget(config), options, { watches: sourceWatches(config.sources) });
}

/** Checks that the published tarball carries no module only a test imports. @public */
export function packagingStep(config: PackagingCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-packaging", () => checkPackaging(config), options);
}

/** Checks that no server-rendered file imports the browser-only runtime. @public */
export function ssrBoundaryStep(config: SsrBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-ssr-boundary", () => checkSsrBoundary(config), options, { watches: sourceWatches(config.sources) });
}

/** Checks that nothing outside a guarded tree, save a named crossing, imports it at value. @public */
export function importBoundaryStep(config: ImportBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-import-boundary", () => checkImportBoundary(config), options, {
    watches: sourceWatches([...(config.sources ?? ["src"]), ...config.guarded]),
  });
}

/** Checks that no deployable module names a development entry or a dev-only module. @public */
export function devBoundaryStep(config: DevBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  const workerConfig = config.workerConfig === undefined ? ["wrangler.jsonc"] : config.workerConfig === null ? [] : [config.workerConfig];
  return checkStep("validate-dev-boundary", () => checkDevBoundary(config), options, {
    watches: [...sourceWatches(config.sources ?? ["src"]), ...workerConfig],
  });
}

/** Bundles the deployed `main` and checks that no module in it is development code. @public */
export function devBundleStep(config: DevBundleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-dev-bundle", () => checkDevBundle(config), options, { tier: "release" });
}

/** Checks markdown against the house conventions, with a fixer for the mechanical rules. @public */
export function markdownStep(config: MarkdownCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-markdown", () => checkMarkdown(config), options, {
    fix: () => fixMarkdown(config),
    watches: markdownWatches(config.sources ?? ["src"]),
  });
}

/** Checks every shipped `.tsx` file carries the runtime pragmas. @public */
export function jsxStep(config: JsxCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-jsx", () => checkJsx(config), options, { watches: sourceWatches(config.sources ?? ["src"]) });
}

/** Checks every `triggered` menu popup is paired with the trigger it takes its name from. @public */
export function menuNamingStep(config: MenuNamingCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-menu-naming", () => checkMenuNaming(config), options, { watches: sourceWatches(config.sources ?? ["src"]) });
}

/** Checks every top-level browser spec block that reads an engine-computed value carries the `@cross-engine` tag. @public */
export function crossEngineTagsStep(config: CrossEngineTagsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-cross-engine-tags", () => checkCrossEngineTags(config), options, {
    watches: sourceWatches(config.sources ?? ["src"]),
  });
}

/** Checks that no shipped module names a global only the repository's private type stubs declare. @public */
export function stubGlobalsStep(config: StubGlobalsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-stub-globals", () => checkStubGlobals(config), options, {
    watches: sourceWatches([...config.stubs, ...config.sources]),
  });
}

/** The dependency every design-system step shares — `tailwindcss` is an optional peer. */
const tailwindRequired = (): StepRequirement => ({ tool: "tailwindcss", probe: hasTailwind, hint: "run `bun add -d tailwindcss`" });

/** The dependency every bundle-drift step shares — `esbuild` is an optional peer. */
const esbuildRequired = (): StepRequirement => ({ tool: "esbuild", probe: hasEsbuild, hint: "run `bun add -d esbuild`" });

/** Measures every audited foreground/background pair against its contrast criterion. @public */
export function contrastStep(config: ContrastCheckConfig, options: StepOptions = {}): CheckStep {
  const defaults = config.palettePath === undefined ? {} : { requires: tailwindRequired() };
  return checkStep("validate-contrast", () => checkContrast(config), options, defaults);
}

/** Fails an `opacity-*` that fades a class's text below full strength, unless a disabled variant or an audited alpha pair holds it. @public */
export function fadedTextStep(config: FadedTextCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-faded-text", () => checkFadedText(config), options, { watches: sourceWatches(config.sources) });
}

/** Regenerates `cn`'s conflict table from the design system and fails on any drift from the committed copy. @public */
export function classGroupsStep(config: ClassGroupsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-groups", () => checkClassGroups(config), options, {
    requires: tailwindRequired(),
    watches: [STYLESHEET_WATCHES, config.table],
  });
}

/** Regenerates the design-scale data forge's oxlint plugin reads and fails on any drift from the committed copy. @public */
export function designScaleStep(config: DesignScaleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design-scale", () => checkDesignScale(config), options, {
    requires: tailwindRequired(),
    watches: [STYLESHEET_WATCHES, config.table],
  });
}

/** Re-encodes the committed ICC module from the profile beside it and fails on any drift. @public */
export function iccProfileStep(config: IccProfileCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-icc-profile", () => checkIccProfile(config), options, { watches: [config.profile, config.module] });
}

/** Rebuilds a committed bundle under `label` and fails on any drift from its TypeScript source. @public */
export function bundleStep(label: string, config: BundleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep(label, () => checkBundle(config), options, { requires: esbuildRequired() });
}

/** Checks every `forge.node` export points `import` at a generated `.mjs`, and every `.mjs` export is listed there. @public */
export function nodeExportsStep(config: NodeExportsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-node-exports", () => checkNodeExports(config), options, { watches: ["package.json"] });
}

/** Checks every class literal is a fixed point of `cn`, so sorting one cannot change what it renders. @public */
export function classOrderStep(config: ClassOrderCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-order", () => checkClassOrder(config), options, { watches: sourceWatches(config.sources) });
}

/** Checks every class token resolves to CSS, so a misspelled utility fails rather than rendering nothing. @public */
export function classTokensStep(config: ClassTokensCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-tokens", () => checkClassTokens(config), options, {
    requires: tailwindRequired(),
    watches: [...sourceWatches(config.sources), STYLESHEET_WATCHES],
  });
}

/** Checks automatic source detection is off and every class-declaring source file is named by an `@source`. @public */
export function cssCoverageStep(config: CssCoverageCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-coverage", () => checkCssCoverage(config), options, {
    requires: tailwindRequired(),
    watches: [...sourceWatches(config.sources), STYLESHEET_WATCHES],
  });
}

/** Checks stylesheets and class literals for patterns the platform now expresses directly. @public */
export function modernCssStep(config: ModernCssCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-modern-css", () => checkModernCss(config), options, { watches: sourceWatches(config.sources) });
}

/** Checks every class-bearing directory is reached by an `@source` directive. @public */
export function cssSourcesStep(config: CssSourcesCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-sources", () => checkCssSources(config), options, {
    watches: sourceWatches([config.uiDir, config.cssDir, config.sourceDir, config.readme]),
  });
}

/** Checks no `@theme` token is declared in a namespace the utility vocabulary overloads. @public */
export function cssTokensStep(config: CssTokensCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-tokens", () => checkCssTokens(config), options, { requires: tailwindRequired(), watches: [STYLESHEET_WATCHES] });
}
