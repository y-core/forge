import type { v } from "./validation";

/** What a refusal names when the issue it describes points at no field at all. */
const UNNAMED_FIELD = "the submitted form";

/**
 * Caps on a described path. A path segment can be caller-supplied text — a `v.record` key, or the
 * undeclared key a `strictObject` refused — so both the depth and each segment are bounded, and the
 * description's length stops depending on how much the caller sent.
 */
const PATH_DEPTH_MAX = 3;
const PATH_SEGMENT_MAX = 40;

/**
 * Formats valibot issues as a single `path: message` list joined by `; `, using `root`
 * for issues without a path. Shared by the env/config validators so the
 * `Invalid environment: …` message shape stays uniform across namespaces.
 *
 * The messages it reproduces embed the rejected value, which is what makes it an internal
 * diagnostic: use `describeValidationIssue` for anything a caller will read. @public
 */
export function formatValidationIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues.map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`).join("; ");
}

/**
 * The wording a refusal uses to name the field at `path`, bounded in depth and in per-segment
 * length, and falling back to fixed generic wording for an empty path.
 *
 * Kept separate from `describeValidationIssue` so a caller holding a field name rather than an
 * issue — a guard mirroring the refusal a schema would have produced — reaches the same wording
 * through the same bound, instead of rebuilding it and drifting.
 *
 * @internal
 */
export function describeValidationField(path: readonly string[]): string {
  const bounded = path.slice(0, PATH_DEPTH_MAX).map((segment) => segment.slice(0, PATH_SEGMENT_MAX));
  return bounded.length === 0 ? UNNAMED_FIELD : bounded.join(".");
}

/**
 * Names the field one valibot issue is about, and nothing else — for the refusal a caller reads.
 *
 * It reproduces no part of the submission and no part of the schema. `issue.message` embeds the
 * rejected value; `issue.expected` can be a `v.regex` pattern source, which is the server's own
 * rule; and `issue.input` is the submission itself. Only the path survives, bounded, because a
 * `v.record` key or a refused undeclared key is caller-chosen text of caller-chosen length.
 *
 * The result therefore varies only with *which* field failed, never with what was sent — so a
 * 50,000-character value and a 5-character one produce the same refusal, and adding fields to a
 * submission cannot multiply the response.
 *
 * @example
 * ```typescript
 * const messages = result.issues.map(describeValidationIssue); // ["email"]
 * return fragmentResponse(renderValidationErrors(messages), 422);
 * ```
 * @public
 */
export function describeValidationIssue(issue: v.BaseIssue<unknown>): string {
  // A path item's key is `unknown` for a map or set segment. Only a string or a number names
  // something the caller can act on, so anything else contributes no segment rather than a
  // stringified placeholder — and nothing here can throw on a hostile `toString`.
  const named = (issue.path ?? [])
    .map((item) => item.key)
    .filter((key): key is string | number => typeof key === "string" || typeof key === "number");
  return describeValidationField(named.map(String));
}
