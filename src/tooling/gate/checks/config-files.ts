import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { balancedSpan, blankSourceLiterals, endOfString, lineAt, listFiles } from "./source-scan";
import type { ConfigFileCheckConfig } from "./types";

const DEFINE_HELPER = /^define[A-Z]\w*$/;

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

/** Holds every `config/*.config.ts` to imports, `const` declarations and one default export calling an imported `define*` helper, and the tool configs to forge's bases under `baseline`. @public */
export function checkConfigFiles(config: ConfigFileCheckConfig): CheckResult {
  const files = listFiles(join(config.root, "config"), (name) => name.endsWith(".config.ts"));
  if (files.length === 0) return scannedNothing("`config/` holds no `*.config.ts` module", "config-files");
  const findings = files.flatMap((name) => checkConfigFile(config.root, name));
  if (config.baseline !== true) return checkResult(findings, `${files.length} config module(s)`);
  return checkResult([...findings, ...checkConfigBaseline(config.root)], `${files.length} config module(s) and the tool configs`);
}
