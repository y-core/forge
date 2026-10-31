import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { balancedSpan, blankSourceLiterals, endOfString, lineAt, listFiles } from "./source-scan";
import type { ConfigFileCheckConfig } from "./types";

const DEFINE_HELPER = /^define[A-Z]\w*$/;

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

/** Holds every `config/*.config.ts` to imports, `const` declarations and one default export calling an imported `define*` helper. @public */
export function checkConfigFiles(config: ConfigFileCheckConfig): CheckResult {
  const files = listFiles(join(config.root, "config"), (name) => name.endsWith(".config.ts"));
  if (files.length === 0) return scannedNothing("`config/` holds no `*.config.ts` module", "config-files");
  const findings = files.flatMap((name) => checkConfigFile(config.root, name));
  return checkResult(findings, `${files.length} config module(s)`);
}
