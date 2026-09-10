import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseCallableExports } from "./barrel-parse";
import { collectFiles } from "./source-scan";
import type { CoLocationCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

// Two names the tree already reserves: `types.ts` declares and `bin.ts` is argv in, `process.exit`
// out. Neither is asserted — a callable found in one fails below, so the convention stays true.
const DECLARED_NAMES = ["types.ts", "bin.ts"] as const;

/** A source module and the sibling test names that would satisfy it. */
interface Module {
  file: string;
  candidates: string[];
}

function stem(file: string): string {
  const ext = MODULE_EXTENSIONS.find((candidate) => file.endsWith(candidate));
  return ext ? file.slice(0, -ext.length) : file;
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

// A `.browser.ts` spec counts: for a module that only exists in a browser it is the *only* honest
// test, and demanding a second unit file would buy a fake one. What the gate forbids is neither.
/** Every filename that would count as a co-located test for `file`. @public */
export function testCandidates(file: string): string[] {
  const base = stem(file);
  return [`${base}.test.ts`, `${base}.test.tsx`, `${base}.browser.ts`, `${base}.browser.tsx`];
}

/** Whether a module's filename declares it needs no test of its own. @public */
export function declaredByName(file: string): boolean {
  return DECLARED_NAMES.includes(basename(file) as (typeof DECLARED_NAMES)[number]);
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
  const exempt = config.exempt ?? new Map<string, string>();
  const walked = config.sources.flatMap((dir) => collectFiles(config.root, dir, () => true));
  if (walked.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no file`, "co-location");
  const present = new Set(walked);
  const modules: Module[] = walked.filter((file) => needsTest(basename(file))).map((file) => ({ file, candidates: testCandidates(file) }));

  // The same argument the modern-CSS check makes for a deferral: the list only shrinks, so an entry
  // naming a file that is no longer walked is a stale exemption, not a silent pass.
  const stale = [...exempt.keys()]
    .filter((file) => !present.has(file))
    .map((file) => fail(`\`${file}\` is exempt from the co-location check but is not a module it walks — delete the entry`));

  // A reason is what makes the entry auditable, so a blank one is no entry at all — the same terms
  // `modernCssStep.deferred` holds an owner to.
  const reasonless = [...exempt]
    .filter(([, reason]) => reason.trim() === "")
    .map(([file]) => fail(`\`${file}\` is exempt from the co-location check with no reason — say why, or give it a test`));

  // The claim the filename makes, re-checked against the file: a `types.ts` that grew a function is
  // not a declaration file, and the convention stops covering it.
  const smuggled = modules
    .filter((module) => declaredByName(module.file) && !module.candidates.some((candidate) => present.has(candidate)))
    .flatMap((module) => {
      const callables = [...parseCallableExports(readFileSync(resolve(config.root, module.file), "utf-8"))].sort();
      if (callables.length === 0) return [];
      return [
        fail(`\`${basename(module.file)}\` needs no co-located test only while it declares — this one exports a callable`, {
          file: module.file,
          detail: [callables.join(", "), "give it a test, or move the function to a module that has one"],
        }),
      ];
    });

  const findings: Finding[] = modules
    .filter((module) => !exempt.has(module.file) && !declaredByName(module.file) && !module.candidates.some((candidate) => present.has(candidate)))
    .map((module) =>
      fail("no co-located test", {
        file: module.file,
        detail: [
          `expected one of: ${module.candidates.map(basename).join(", ")}`,
          "add one, or add this path to the check's `exempt` map with a reason",
        ],
      }),
    );

  const covered = modules.filter((module) => !exempt.has(module.file) && !declaredByName(module.file)).length;
  return checkResult([...stale, ...reasonless, ...smuggled, ...findings], `${covered} modules have a co-located test`);
}
