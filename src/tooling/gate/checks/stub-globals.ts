import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { balancedSpan, blankSourceComments, isTestSource, lineAt, resolveSources, unresolvedSourceEntries } from "./source-scan";
import type { StubGlobalsCheckConfig } from "./types";

const DECLARATION = /\b(?:interface|type|class|const|let|var|function|namespace)\s+([A-Za-z_$][\w$]*)/g;

const SCANNED = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestSource(name);

const STUB = (name: string): boolean => name.endsWith(".d.ts");

// Everything inside braces is blanked, so a `declare module` block's members and an interface's
// fields are never read as declarations of their own.
function outermost(code: string): string {
  let depth = 0;
  return [...code]
    .map((char) => {
      if (char === "{") depth++;
      const kept = depth === 0 ? char : " ";
      if (char === "}") depth--;
      return kept;
    })
    .join("");
}

// A top-level `import` or `export` makes the file a module, whose own declarations are not global;
// only a `declare global` block's are.
/** Every name a declaration file declares at global scope. @public */
export function declaredStubGlobals(source: string): string[] {
  const code = blankSourceComments(source);
  const top = outermost(code);
  const blocks = [...code.matchAll(/\bdeclare\s+global\s*\{/g)].map((match) => {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = balancedSpan(code, open);
    return outermost(code.slice(open + 1, close === -1 ? code.length : close));
  });
  const scopes = /^\s*(?:import|export)\b/m.test(top) ? blocks : [top, ...blocks];
  return [...new Set(scopes.flatMap((scope) => [...scope.matchAll(DECLARATION)].map((match) => match[1] ?? "")))].sort();
}

/** Every reference in `source` to one of `names`, a member access excluded. @public */
export function findStubGlobalReferences(source: string, names: ReadonlySet<string>): { name: string; line: number }[] {
  const code = blankSourceComments(source);
  return [...code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)]
    .filter((match) => names.has(match[0]))
    .map((match) => ({ name: match[0], line: lineAt(code, match.index ?? 0) }));
}

/** Fails every shipped module that names a global only a stub declares, so a consumer's real types cannot resolve it. @public */
export function checkStubGlobals(config: StubGlobalsCheckConfig): CheckResult {
  const stubFiles = resolveSources(config.root, config.stubs, STUB);
  if (stubFiles.length === 0) return scannedNothing(`\`${config.stubs.join("`, `")}\` matched no declaration file`, "stub-globals");
  const files = resolveSources(config.root, config.sources, SCANNED);
  if (files.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no module`, "stub-globals");
  const unresolved = unresolvedSourceEntries(config.root, [...config.stubs, ...config.sources], "file or directory");
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const declared = new Set(stubFiles.flatMap((file) => declaredStubGlobals(readFileSync(resolve(config.root, file), "utf-8"))));
  const stale: Finding[] = config.shared
    .filter((name) => !declared.has(name))
    .map((name) => fail(`\`shared\` entry \`${name}\` names no global a stub declares`));
  const stubOnly = new Set([...declared].filter((name) => !config.shared.includes(name)));

  const findings = [
    ...stale,
    ...files.flatMap((file) =>
      findStubGlobalReferences(readFileSync(resolve(config.root, file), "utf-8"), stubOnly).map(({ name, line }) =>
        fail(`\`${name}\` is declared only by a stub this package does not ship`, { file, line }),
      ),
    ),
  ];

  if (findings.some((finding) => finding.file !== undefined)) {
    findings.push(
      fail(
        "A consumer type-checks shipped code against the real runtime types; name a real type, or declare the shape under a name of the module's own.",
      ),
    );
  }

  return checkResult(findings, `${files.length} modules name no global only a stub declares.`);
}
