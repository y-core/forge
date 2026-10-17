import { lintStatements, splitSqlStatements } from "../migrate/lint";
import { sqlLineAt } from "../sql";
import type { LintFinding, LintRule, Seed } from "../types";

/** The migration rules a seed is also held to: the ones that empty a table or reach outside the database. @internal */
export const SEED_MIGRATION_RULES: readonly LintRule[] = ["unbounded-update", "unbounded-delete", "attach-database"];

/** Reports an INSERT with no `OR IGNORE`, `OR REPLACE` or `ON CONFLICT`, which a second run would duplicate or refuse, and the migration rules a seed is held to. @internal */
export function lintSeed(file: string, sql: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const statement of splitSqlStatements(sql)) {
    const at = statement.masked.search(/\bINSERT\s+INTO\b/i);
    if (at === -1 || /\bON\s+CONFLICT\b/i.test(statement.masked)) continue;
    findings.push({
      rule: "seed-insert-not-idempotent",
      file,
      line: sqlLineAt(sql, statement.offset + at),
      message: "INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key",
    });
  }
  findings.push(...lintStatements(file, sql, SEED_MIGRATION_RULES));
  return findings.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
}

/** Checks every seed, naming each finding by the file it came from. @public */
export function lintSeeds(seeds: readonly Seed[]): LintFinding[] {
  return seeds.flatMap((seed) => lintSeed(seed.path, seed.sql));
}
