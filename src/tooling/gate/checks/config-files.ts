import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { balancedSpan, blankSourceLiterals, endOfString, isTestSource, lineAt, listFiles } from "./source-scan";
import type { ConfigFileCheckConfig } from "./types";

const DEFINE_HELPER = /^define[A-Z]\w*$/;

/** The files tools write into `config/` by default: the release's section digests and the ratchet's budgets. @public */
export const CONFIG_STATE_FILES: readonly string[] = ["config/changelog-sections.json", "config/rules-baseline.json"];

/** The directories tools write into `config/` by default: `forge db`'s migrations, schema snapshot and row types, `DB_LAYOUT`'s home. @public */
export const CONFIG_STATE_DIRS: readonly string[] = ["config/db"];

const SIBLING_IMPORT = /(?:from|import)\s*\(?\s*["']\.\/([^"'/]+)["']/g;

const BASES = resolve(dirname(fileURLToPath(import.meta.url)), "../../config");

/** What `.oxlintrc.json` extends — a path, because oxlint reads `extends` as one and never consults `exports`. @public */
export const OXLINT_BASE = "./node_modules/@y-core/forge/src/tooling/config/oxlint.base.json";

/** What `tsconfig.json` extends — a path, because Bun's runtime transpiler ignores a package `extends` and `bun test` would lose the JSX source. @public */
export const TSCONFIG_BASE = "./node_modules/@y-core/forge/src/tooling/config/tsconfig.app.json";

// A local `ignorePatterns` replaces the base's rather than adding to it, so the generated trees are stated in each repository.
const LINT_IGNORES = [".forge/**", ".types/**"];

// Everything else the oxlint base sets is inherited; restating it locally would replace the base's value.
const OXLINT_LOCAL_KEYS = new Set(["$schema", "extends", "ignorePatterns", "rules", "overrides"]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface Statement {
  start: number;
  text: string;
}

function topLevelStatements(source: string): Statement[] {
  const starts: number[] = [];
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? "";
    if (depth === 0 && (i === 0 || source[i - 1] === "\n") && /\S/.test(char)) starts.push(i);
    if (char === "'" || char === '"' || char === "`") {
      const end = endOfString(source, i);
      if (end === -1) break;
      i = end - 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
  }
  return starts.map((start, index) => ({ start, text: source.slice(start, starts[index + 1] ?? source.length) }));
}

function importedBindings(text: string): string[] {
  const clause = /^import\s+([\s\S]*?)\s+from\s/.exec(text)?.[1];
  if (clause === undefined || /^type\s/.test(clause)) return [];
  const braced = /\{([\s\S]*)\}/.exec(clause)?.[1];
  const named = (braced ?? "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== "" && !/^type\s/.test(specifier))
    .map((specifier) => specifier.split(/\s+as\s+/).at(-1) ?? specifier);
  const outside = clause.replace(/\{[\s\S]*\}/, "").split(",");
  const unbraced = outside
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => part.replace(/^\*\s+as\s+/, ""));
  return [...named, ...unbraced];
}

function callsDefineHelper(text: string, bindings: ReadonlySet<string>): boolean {
  const body = text.replace(/^export\s+default\s+/, "");
  const callee = /^([A-Za-z_$][\w$]*)\s*\(/.exec(body);
  if (callee === null) return false;
  const name = callee[1] ?? "";
  if (!DEFINE_HELPER.test(name) || !bindings.has(name)) return false;
  const close = balancedSpan(body, callee[0].length - 1);
  return close !== -1 && /^[\s;]*$/.test(body.slice(close + 1));
}

function checkConfigFile(root: string, name: string): Finding[] {
  const file = `config/${name}`;
  const raw = readFileSync(join(root, "config", name), "utf-8");
  const source = blankSourceLiterals(raw);
  const findings: Finding[] = [];
  const at = (index: number): { file: string; line: number } => ({ file, line: lineAt(source, index) });

  const main = source.indexOf("import.meta.main");
  if (main !== -1) findings.push(fail("runs code when executed directly (`import.meta.main`) — a config module only declares", at(main)));

  const bindings = new Set<string>();
  let defaultExport: Statement | undefined;
  for (const statement of topLevelStatements(source)) {
    const { start, text } = statement;
    if (/^import\b/.test(text)) {
      for (const binding of importedBindings(text)) bindings.add(binding);
    } else if (/^const\b/.test(text)) {
      continue;
    } else if (/^export\s+default\b/.test(text)) {
      defaultExport = statement;
    } else if (/^export\b/.test(text)) {
      const firstLine =
        raw
          .slice(start, start + text.length)
          .split("\n")[0]
          ?.trim() ?? "";
      findings.push(fail(`exports \`${firstLine}\` — a config module's only export is its default`, at(start)));
    } else {
      const token = /^[A-Za-z_$][\w$]*|^\S/.exec(text)?.[0] ?? "";
      findings.push(
        fail(`top-level \`${token}\` statement — a config module holds only imports, \`const\` declarations and its default export`, at(start)),
      );
    }
  }

  if (defaultExport === undefined) {
    findings.push(fail("has no default export", { file }));
  } else if (!callsDefineHelper(defaultExport.text, bindings)) {
    findings.push(fail("default export is not a call to an imported `define*` helper", at(defaultExport.start)));
  }
  return findings;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: Json | undefined): string {
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]` : JSON.stringify(value ?? null);
}

function readJson(path: string): JsonObject | string {
  try {
    const parsed = JSON.parse(stripJsonc(readFileSync(path, "utf-8"))) as Json;
    return isObject(parsed) ? parsed : "is not a JSON object";
  } catch (error) {
    return `does not parse — ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The repository's copy of one tool config, or the findings that stop it being read. */
function localConfig(root: string, file: string): { config?: JsonObject; findings: Finding[] } {
  const findings: Finding[] = [];
  const jsonc = file.replace(/\.json$/, ".jsonc");
  if (existsSync(join(root, jsonc))) findings.push(fail(`name it \`${file}\` — the fleet spells every tool config \`.json\``, { file: jsonc }));
  if (!existsSync(join(root, file))) return { findings: findings.length > 0 ? findings : [fail("is missing", { file })] };
  const config = readJson(join(root, file));
  if (typeof config === "string") return { findings: [...findings, fail(config, { file })] };
  return { config, findings };
}

function stringsOf(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function missingFrom(local: Json | undefined, required: readonly string[]): string[] {
  const held = new Set(stringsOf(local));
  return required.filter((entry) => !held.has(entry));
}

/** A key the base already sets, restated locally — which replaces the base's value instead of adding to it. */
function overridden(local: Json | undefined, base: Json | undefined): string[] {
  return isObject(local) && isObject(base) ? Object.keys(local).filter((key) => key in base) : [];
}

function checkOxlint(root: string, base: JsonObject): Finding[] {
  const file = ".oxlintrc.json";
  const { config, findings } = localConfig(root, file);
  if (config === undefined) return findings;
  if (!stringsOf(config["extends"]).includes(OXLINT_BASE)) findings.push(fail(`does not extend \`${OXLINT_BASE}\``, { file }));
  for (const key of Object.keys(config).filter((name) => !OXLINT_LOCAL_KEYS.has(name))) {
    findings.push(fail(`sets \`${key}\` — the base states it, and a local value replaces the base's`, { file }));
  }
  for (const rule of overridden(config["rules"], base["rules"])) {
    findings.push(fail(`overrides the base's \`${rule}\` — a local rule is an addition; a change to a base rule is made in the base`, { file }));
  }
  const ignores = missingFrom(config["ignorePatterns"], LINT_IGNORES);
  if (ignores.length > 0) findings.push(fail(`\`ignorePatterns\` leaves out ${ignores.map((entry) => `\`${entry}\``).join(", ")}`, { file }));
  return findings;
}

// `bun fmt` ignores `extends`, so the repository's copy is held to the base key by key instead.
function checkOxfmt(root: string, base: JsonObject): Finding[] {
  const file = ".oxfmtrc.json";
  const { config, findings } = localConfig(root, file);
  if (config === undefined) return findings;
  for (const [key, value] of Object.entries(base)) {
    if (key === "ignorePatterns") continue;
    if (canonicalJson(config[key]) !== canonicalJson(value))
      findings.push(fail(`\`${key}\` differs from the base's \`${canonicalJson(value)}\``, { file }));
  }
  const ignores = missingFrom(config["ignorePatterns"], stringsOf(base["ignorePatterns"]));
  if (ignores.length > 0) findings.push(fail(`\`ignorePatterns\` leaves out ${ignores.map((entry) => `\`${entry}\``).join(", ")}`, { file }));
  return findings;
}

function checkTsconfig(root: string, base: JsonObject): Finding[] {
  const file = "tsconfig.json";
  const { config, findings } = localConfig(root, file);
  if (config === undefined) return findings;
  if (config["extends"] !== TSCONFIG_BASE) findings.push(fail(`does not extend \`${TSCONFIG_BASE}\``, { file }));
  for (const option of overridden(config["compilerOptions"], base["compilerOptions"])) {
    findings.push(
      fail(`overrides the base's \`${option}\` — a local compiler option is an addition; a change to a base one is made in the base`, { file }),
    );
  }
  if ("exclude" in config) findings.push(fail("has an `exclude` key — `include` is the whole answer", { file }));
  return findings;
}

/** Holds `.oxlintrc.json`, `.oxfmtrc.json` and `tsconfig.json` to forge's bases: each extends its base, and every local entry is an addition. @public */
export function checkConfigBaseline(root: string): Finding[] {
  const base = (name: string): JsonObject => readJson(join(BASES, name)) as JsonObject;
  return [
    ...checkOxlint(root, base("oxlint.base.json")),
    ...checkOxfmt(root, base("oxfmt.base.json")),
    ...checkTsconfig(root, base("tsconfig.app.json")),
  ];
}

const MARKDOWN_IGNORE = "**/*.md";

function checkMarkdownIgnored(root: string): Finding[] {
  const file = ".oxfmtrc.json";
  const { config, findings } = localConfig(root, file);
  if (config === undefined) return findings;
  if (stringsOf(config["ignorePatterns"]).includes(MARKDOWN_IGNORE)) return findings;
  return [
    ...findings,
    fail(
      `\`ignorePatterns\` leaves out \`${MARKDOWN_IGNORE}\` while the table runs \`validate-markdown\` — the formatter and the check would own the same bytes`,
      { file },
    ),
  ];
}

const PLAYWRIGHT_CONFIG = "playwright.config.ts";

// Node loads `playwright.config.ts` and refuses to strip types under `node_modules`, so only a prebuilt subpath loads there.
function checkPlaywrightImports(root: string, nodeSubpaths: readonly string[]): Finding[] {
  const path = join(root, PLAYWRIGHT_CONFIG);
  if (!existsSync(path)) return [];
  const source = readFileSync(path, "utf-8");
  const subpaths = nodeSubpaths.map((subpath) => subpath.replace(/^\.\//, ""));
  const reachesNodeSubpath = (specifier: string): boolean =>
    specifier.startsWith("@y-core/forge")
      ? subpaths.some((subpath) => specifier === `@y-core/forge/${subpath}`)
      : !specifier.startsWith("./src/") || subpaths.some((subpath) => specifier.startsWith(`./src/${subpath}/`));
  return [...source.matchAll(/from\s+"([^"]+)"/g)]
    .filter((match) => !reachesNodeSubpath(match[1] ?? ""))
    .map((match) =>
      fail(
        `imports \`${match[1] ?? ""}\`, which no \`forge.node\` subpath covers — node loads this file and cannot strip a \`.ts\` under \`node_modules\``,
        { file: PLAYWRIGHT_CONFIG, line: lineAt(source, match.index) },
      ),
    );
}

/** The `config/` files a `*.config.ts` reaches through sibling imports, directly or through another module there. */
function importedModules(dir: string, entries: readonly string[], present: ReadonlySet<string>): Set<string> {
  const reached = new Set<string>();
  const queue = [...entries];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (!name.endsWith(".ts")) continue;
    for (const match of readFileSync(join(dir, name), "utf-8").matchAll(SIBLING_IMPORT)) {
      const specifier = match[1] ?? "";
      const target = [specifier, `${specifier}.ts`].find((candidate) => present.has(candidate));
      if (target === undefined || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

// `config/` is where a developer tweaks the tools, so a test, a script or a tree of its own there is a file nobody looks for there.
function checkConfigScope(root: string, stateFiles: readonly string[], stateDirs: readonly string[]): Finding[] {
  const dir = join(root, "config");
  const listed = readdirSync(dir, { withFileTypes: true });
  const files = listed.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const present = new Set(files);
  const imported = importedModules(
    dir,
    files.filter((name) => name.endsWith(".config.ts")),
    present,
  );
  const declared = new Set(stateFiles);
  const declaredDirs = new Set(stateDirs.map((path) => path.replace(/\/+$/, "")));
  const findings: Finding[] = listed
    .filter((entry) => entry.isDirectory() && !declaredDirs.has(`config/${entry.name}`))
    .map((entry) =>
      fail("is a directory no tool is declared to write — move what it holds to the code it serves, or declare it in `stateDirs`", {
        file: `config/${entry.name}`,
      }),
    );
  for (const name of files) {
    const file = `config/${name}`;
    if (isTestSource(name)) {
      findings.push(fail("is a test — a config gets no test; test the code that reads it, beside that code", { file }));
      continue;
    }
    if (!name.endsWith(".ts")) {
      if (!declared.has(file) && !imported.has(name))
        findings.push(
          fail("is neither a module a `*.config.ts` imports nor a declared state file — move it, or declare it in `stateFiles`", { file }),
        );
      continue;
    }
    if (name.endsWith(".config.ts")) continue;
    const source = blankSourceLiterals(readFileSync(join(dir, name), "utf-8"));
    const main = source.indexOf("import.meta.main");
    if (main !== -1)
      findings.push(
        fail("runs code when executed directly (`import.meta.main`) — a script belongs beside the code it serves", {
          file,
          line: lineAt(source, main),
        }),
      );
    else if (!imported.has(name))
      findings.push(fail("is a module no `*.config.ts` imports — fold it into the code that uses it, or delete it", { file }));
  }
  return findings;
}

/** Holds every `config/*.config.ts` to imports, `const` declarations and one default export calling an imported `define*` helper, `config/` to those modules, what they import and its state files, the tool configs to forge's bases under `baseline`, markdown off the formatter under `markdown`, and the Playwright config to `nodeSubpaths`. @public */
export function checkConfigFiles(config: ConfigFileCheckConfig): CheckResult {
  const files = listFiles(join(config.root, "config"), (name) => name.endsWith(".config.ts"));
  if (files.length === 0) return scannedNothing("`config/` holds no `*.config.ts` module", "config-files");
  const findings = [
    ...files.flatMap((name) => checkConfigFile(config.root, name)),
    ...checkConfigScope(config.root, config.stateFiles ?? CONFIG_STATE_FILES, config.stateDirs ?? CONFIG_STATE_DIRS),
    ...(config.markdown === true ? checkMarkdownIgnored(config.root) : []),
    ...(config.nodeSubpaths === undefined ? [] : checkPlaywrightImports(config.root, config.nodeSubpaths)),
  ];
  if (config.baseline !== true) return checkResult(findings, `${files.length} config module(s)`);
  return checkResult([...findings, ...checkConfigBaseline(config.root)], `${files.length} config module(s) and the tool configs`);
}
