import { readdirSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";

/** What the co-location check needs to know about the project. @public */
export interface CoLocationCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** Directories walked for source modules, relative to `root`. */
  sources: readonly string[];
  /** Modules exempt from needing a co-located test, as `root`-relative posix paths. */
  exempt?: readonly string[];
}

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

/** A source module and the sibling test names that would satisfy it. */
interface Module {
  file: string;
  candidates: string[];
}

function stem(file: string): string {
  const ext = MODULE_EXTENSIONS.find((candidate) => file.endsWith(candidate));
  return ext ? file.slice(0, -ext.length) : file;
}

// A `.browser.ts` spec counts: for a module that only exists in a browser it is the *only* honest
// test, and demanding a second unit file would buy a fake one. What the gate forbids is neither.
/** Every filename that would count as a co-located test for `file`. @public */
export function testCandidates(file: string): string[] {
  const base = stem(file);
  return [`${base}.test.ts`, `${base}.test.tsx`, `${base}.browser.ts`, `${base}.browser.tsx`];
}

/** Whether a file is itself a test, a spec, or a barrel — none of which need a test of their own. */
function needsTest(name: string): boolean {
  if (!MODULE_EXTENSIONS.some((ext) => name.endsWith(ext))) return false;
  if (/\.(test|browser)\.tsx?$/.test(name)) return false;
  // A barrel re-exports and declares nothing, so its coverage is the coverage of what it names.
  return name !== "mod.ts";
}

function collect(dir: string, root: string, out: Module[], present: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    const rel = relative(root, full).split(sep).join(posix.sep);
    if (entry.isDirectory()) {
      collect(full, root, out, present);
      continue;
    }
    if (!entry.isFile()) continue;
    present.add(rel);
    if (needsTest(entry.name)) out.push({ file: rel, candidates: testCandidates(rel) });
  }
}

/** Reports every source module with no co-located test beside it. @public */
export function checkCoLocation(config: CoLocationCheckConfig): CheckResult {
  const exempt = new Set(config.exempt ?? []);
  const modules: Module[] = [];
  const present = new Set<string>();
  for (const dir of config.sources) collect(resolve(config.root, dir), config.root, modules, present);

  const findings: Finding[] = modules
    .filter((module) => !exempt.has(module.file) && !module.candidates.some((candidate) => present.has(candidate)))
    .map((module) =>
      fail("no co-located test", {
        file: module.file,
        detail: [
          `expected one of: ${module.candidates.map((candidate) => candidate.slice(candidate.lastIndexOf("/") + 1)).join(", ")}`,
          "add one, or add this path to the check's `exempt` list with a reason",
        ],
      }),
    );

  return checkResult(findings, `${modules.length - exempt.size} modules have a co-located test`);
}
