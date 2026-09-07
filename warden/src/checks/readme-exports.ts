import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseConsumerExportNames, parseTypeExportNames } from "../../../src/tooling/gate/checks/barrel-parse";
import {
  parseExportsHeadingLine,
  parseExportsTableSymbols,
  parseImportPathAnchors,
  parseTypesProse,
} from "../../../src/tooling/gate/checks/readme-exports-parse";
import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../../../src/tooling/gate/finding";

/** What the README-exports check needs to find both halves of the coupling. @public */
export interface ReadmeExportsCheckConfig {
  /** Application root. `readme` and every anchored barrel resolve against it. */
  root: string;
  /** The READMEs to check, each relative to `root`. */
  readmes: readonly string[];
  /** Subpaths whose section documents no export table, each legitimately so. */
  exempt?: readonly string[];
}

/** Holds a README's per-subpath export tables against the barrels they document. @public */
export function checkReadmeExports(config: ReadmeExportsCheckConfig): CheckResult {
  const { root } = config;
  const exempt = new Set(config.exempt ?? []);
  const findings: Finding[] = [];
  let checked = 0;

  // The anchor is opt-in, so `checked` reaching zero is supported; no README to hold is not.
  if (config.readmes.length === 0) return scannedNothing("no README is configured", "readme-exports", "held");

  for (const readme of config.readmes) {
    const readmePath = resolve(root, readme);
    if (!existsSync(readmePath)) {
      findings.push(fail(`\`${readme}\` not found`, { file: readme }));
      continue;
    }
    const markdown = readFileSync(readmePath, "utf-8");
    checked += checkOne(root, readme, markdown, exempt, findings);
  }

  return checkResult(
    findings,
    `README exports: ${checked} subpath tables across ${config.readmes.length} READMEs agree with their barrels, ${exempt.size} exempt`,
  );
}

/** One README's anchored sections, appending to `findings` and returning how many it checked. */
function checkOne(root: string, readme: string, markdown: string, exempt: ReadonlySet<string>, findings: Finding[]): number {
  const anchors = parseImportPathAnchors(markdown);
  let checked = 0;

  for (const anchor of anchors) {
    if (exempt.has(anchor.subpath)) continue;

    const barrelPath = resolve(root, anchor.barrel);
    if (!existsSync(barrelPath)) {
      findings.push(fail(`\`${anchor.subpath}\` points at \`${anchor.barrel}\`, which does not exist`, { file: readme, line: anchor.line }));
      continue;
    }

    const heading = parseExportsHeadingLine(markdown, anchor.sectionStart, anchor.sectionEnd);
    if (heading === null) {
      findings.push(
        fail(`\`${anchor.subpath}\` documents no exports — add an \`### Exports\` table, or exempt the subpath with a reason`, {
          file: readme,
          line: anchor.line,
        }),
      );
      continue;
    }

    const source = readFileSync(barrelPath, "utf-8");
    const exported = parseConsumerExportNames(source);
    const types = parseTypeExportNames(source);

    const rows = parseExportsTableSymbols(markdown, anchor.sectionStart, anchor.sectionEnd);
    const documented = new Set(rows.map((row) => row.name));
    const prose = parseTypesProse(markdown, anchor.sectionStart, anchor.sectionEnd);

    for (const name of [...exported].sort()) {
      if (documented.has(name)) continue;
      if (types.has(name) && prose.has(name)) continue;
      const kind = types.has(name) ? "type" : "value";
      findings.push(
        fail(`\`${anchor.barrel}\` exports the ${kind} \`${name}\`, which the \`${anchor.subpath}\` table does not name`, {
          file: readme,
          line: heading,
        }),
      );
    }

    for (const row of rows) {
      if (exported.has(row.name)) continue;
      findings.push(
        fail(`the \`${anchor.subpath}\` table names \`${row.name}\`, which \`${anchor.barrel}\` does not export`, { file: readme, line: row.line }),
      );
    }
    checked++;
  }
  return checked;
}
