import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../finding";
import { collectFiles } from "./source-scan";

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

/** Reports every source module with no co-located test beside it. @public */
export function checkCoLocation(config: CoLocationCheckConfig): CheckResult {
  const exempt = new Set(config.exempt ?? []);
  const walked = config.sources.flatMap((dir) => collectFiles(config.root, dir, () => true));
  if (walked.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no file`, "co-location");
  const present = new Set(walked);
  const modules: Module[] = walked
    .filter((file) => needsTest(file.slice(file.lastIndexOf("/") + 1)))
    .map((file) => ({ file, candidates: testCandidates(file) }));

  // The same argument the modern-CSS check makes for a deferral: the list only shrinks, so an entry
  // naming a file that is no longer walked is a stale exemption, not a silent pass.
  const stale = [...exempt]
    .filter((file) => !present.has(file))
    .map((file) => fail(`\`${file}\` is exempt from the co-location check but is not a module it walks — delete the entry`));

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

  return checkResult([...stale, ...findings], `${modules.length - exempt.size} modules have a co-located test`);
}
