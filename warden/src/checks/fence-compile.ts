import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { stripJsonc } from "../../../src/tooling/cli/jsonc";

/** A `tsx` fence keyed back to where it was written. @internal */
export interface FenceSource {
  file: string;
  line: number;
  body: string;
}

/** A compiler diagnostic mapped back to its markdown line. @internal */
export interface FenceDiagnostic {
  fence: number;
  file: string;
  line: number;
  code: number;
  message: string;
}

/** What the fences compile against. @internal */
export interface FenceProject {
  tsconfig: string;
  paths: Record<string, string[]>;
}

const DIAGNOSTIC_HEAD = /^(f(\d+)\.tsx)\((\d+),\d+\): error TS(\d+): (.*)$/;
const LOCATED_DIAGNOSTIC = /^.+\(\d+,\d+\): error TS\d+: /;
const CONTINUATION = /^\s+(\S.*)$/;
const UNRESOLVED_CODES = new Set([2304, 2552, 18004]);
const QUOTED_NAME = /'([^']+)'/;

/** The step tsconfig's own `include` entries that are ambient declarations, resolved against its directory. */
function ambientIncludes(tsconfig: string): Result<string[], string> {
  try {
    const parsed = JSON.parse(stripJsonc(readFileSync(tsconfig, "utf-8"))) as { include?: unknown };
    const include = Array.isArray(parsed.include) ? (parsed.include as unknown[]) : [];
    return ok(
      include
        .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".d.ts"))
        .map((entry) => (isAbsolute(entry) ? entry : resolve(dirname(tsconfig), entry))),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(`cannot read the step tsconfig ${tsconfig}: ${message}`);
  }
}

/** Compiles each fence as its own module, declaring each fence's `ambient` names as `any`. @internal */
export function compileFences(
  fences: readonly FenceSource[],
  project: FenceProject,
  ambient: ReadonlyMap<number, readonly string[]> = new Map(),
): Result<FenceDiagnostic[], string> {
  const ambientFiles = ambientIncludes(project.tsconfig);
  if (!ambientFiles.ok) return ambientFiles;
  const dir = mkdtempSync(join(tmpdir(), "forge-fences-"));
  try {
    fences.forEach((fence, index) => {
      const declarations = (ambient.get(index) ?? []).map((name) => `declare const ${name}: any; type ${name} = any;\n`);
      writeFileSync(join(dir, `f${index}.tsx`), `${fence.body}\nexport {};\n${declarations.join("")}`);
    });
    const tsconfig = {
      extends: project.tsconfig,
      compilerOptions: { noEmit: true, noImplicitAny: false, noUnusedLocals: false, noUnusedParameters: false, paths: project.paths },
      include: ["*.tsx", ...ambientFiles.data],
    };
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
    const run = spawnSync(process.execPath, ["check", "--no-script", "--no-pretty", "-p", "tsconfig.json"], { cwd: dir, encoding: "utf-8" });
    if (run.error !== undefined) return err(`bun check did not start: ${run.error.message}`);
    const stdout = run.stdout ?? "";
    if (run.status !== 0 && !stdout.split("\n").some((text) => LOCATED_DIAGNOSTIC.test(text))) {
      const output = `${stdout}\n${run.stderr ?? ""}`.trim().split("\n")[0] ?? "";
      return err(`bun check exited ${String(run.status)} with no diagnostic: ${output}`);
    }
    const foreign = stdout.split("\n").find((text) => LOCATED_DIAGNOSTIC.test(text) && !DIAGNOSTIC_HEAD.test(text));
    if (foreign !== undefined) return err(`bun check reported a diagnostic outside the fences: ${foreign}`);
    return ok(readDiagnostics(stdout, fences));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Parses `bun check --no-pretty` output, keeping only diagnostics raised in a fence file. @internal */
export function readDiagnostics(stdout: string, fences: readonly FenceSource[]): FenceDiagnostic[] {
  const raw: { fence: number; row: number; code: number; message: string }[] = [];
  let current: (typeof raw)[number] | undefined;
  for (const text of stdout.split("\n")) {
    const head = DIAGNOSTIC_HEAD.exec(text);
    if (head !== null) {
      current = { fence: Number(head[2]), row: Number(head[3]), code: Number(head[4]), message: head[5] ?? "" };
      raw.push(current);
      continue;
    }
    const continuation = CONTINUATION.exec(text);
    if (continuation !== null && current !== undefined) {
      current.message = continuation[1] ?? current.message;
      continue;
    }
    current = undefined;
  }

  const seen = new Set<string>();
  return raw.flatMap(({ fence, row, code, message }) => {
    const source = fences[fence];
    if (source === undefined) return [];
    const rows = source.body.split("\n").length;
    if (row > rows && !isParseDiagnostic(code)) return [];
    const line = source.line + Math.min(row, rows) - 1;
    const key = `${source.file}:${line}:${code}:${message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ fence, file: source.file, line, code, message }];
  });
}

/** Whether a code is a parse error, which suppresses every semantic diagnostic in the run. @internal */
export function isParseDiagnostic(code: number): boolean {
  return code < 2000 || code === 2657 || (code >= 17000 && code < 18000);
}

/** The name a "cannot find name" diagnostic is about. @internal */
export function unresolvedName(diagnostic: FenceDiagnostic): string | undefined {
  if (!UNRESOLVED_CODES.has(diagnostic.code)) return undefined;
  return QUOTED_NAME.exec(diagnostic.message)?.[1];
}
