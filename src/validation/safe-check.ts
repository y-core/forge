import { v } from "./validation";

// Keyed by the predicate because that is what the issue carries back: valibot puts the very same
// function reference on a `check` issue, so the lookup needs no id threaded through the schema.
/** Messages an author has vouched for as naming no input, keyed by the requirement they belong to. */
const VOUCHED = new WeakMap<object, string>();

/** A `v.check` whose message states the requirement and never the value, so a refusal may show it. @public */
export function safeCheck<TInput>(requirement: (input: TInput) => boolean, message: string): v.CheckAction<TInput, string> {
  VOUCHED.set(requirement, message);
  return v.check(requirement, message);
}

/** The vouched message behind one issue, or `undefined` — an unvouched message is never surfaced. @internal */
export function vouchedMessage(issue: v.BaseIssue<unknown>): string | undefined {
  const requirement = (issue as { requirement?: unknown }).requirement;
  return typeof requirement === "function" ? VOUCHED.get(requirement) : undefined;
}
