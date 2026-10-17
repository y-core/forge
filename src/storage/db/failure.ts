import type { D1Constraint, D1ConstraintRule, D1FailureKind } from "./types";

/** A D1 call's failure, classified into the kind a caller branches on. @public */
export class D1Failure extends Error {
  override readonly name = "D1Failure";
  readonly kind: D1FailureKind;
  readonly constraint: D1Constraint | undefined;
  readonly attempts: number;

  constructor(kind: D1FailureKind, message: string, options: { constraint?: D1Constraint; attempts?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.constraint = options.constraint;
    this.attempts = options.attempts ?? 1;
  }
}

const CONSTRAINTS: readonly (readonly [D1ConstraintRule, RegExp])[] = [
  // D1 ends each name at the colon before `SQLITE_CONSTRAINT`, so the colon has to end the capture.
  ["unique", /UNIQUE constraint failed:\s*([^\s:)]+)/i],
  ["not-null", /NOT NULL constraint failed:\s*([^\s:)]+)/i],
  ["check", /CHECK constraint failed:\s*(.+?)(?::\s*SQLITE_\w+|$)/i],
  ["foreign-key", /FOREIGN KEY constraint failed/i],
];

const KINDS: readonly (readonly [Exclude<D1FailureKind, "constraint" | "guard" | "unavailable">, RegExp])[] = [
  ["timeout", /exceeded timeout/i],
  ["overloaded", /\boverloaded\b/i],
  [
    "limit",
    /memory limit|CPU time limit|statement too long|SQLITE_TOOBIG|too many SQL variables|too many terms in compound SELECT|too many columns|Exceeded maximum DB size|account storage limit|free tier daily row/i,
  ],
  [
    "transient",
    /Network connection lost|storage caused object to be reset|reset because its code was updated|Replica disconnected from primary|transient issue on remote node|client disconnected/i,
  ],
];

const GUARD_OVERFLOW = /integer overflow/i;

/** Classifies a thrown D1 error by its message; `guarded` says the call carried a `requireRowsWritten()` guard. @public */
export function classifyD1Error(thrown: unknown, options: { guarded?: boolean; attempts?: number } = {}): D1Failure {
  if (thrown instanceof D1Failure) return thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const base = { cause: thrown, ...(options.attempts === undefined ? {} : { attempts: options.attempts }) };
  if (options.guarded === true && GUARD_OVERFLOW.test(message)) {
    return new D1Failure("guard", "a guarded statement in this batch wrote no row, so the batch was rolled back", base);
  }
  for (const [rule, pattern] of CONSTRAINTS) {
    const match = pattern.exec(message);
    if (match !== null) return new D1Failure("constraint", message, { ...base, constraint: { rule, name: match[1]?.trim() ?? null } });
  }
  for (const [kind, pattern] of KINDS) if (pattern.test(message)) return new D1Failure(kind, message, base);
  return new D1Failure("unavailable", message, base);
}
