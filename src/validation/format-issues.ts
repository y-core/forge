import type { v } from "./validation";

const UNNAMED_FIELD = "the submitted form";

const PATH_DEPTH_MAX = 3;
const PATH_SEGMENT_MAX = 40;

const ENV_UNNAMED_FIELD = "root";

/** Names the field at `path`, bounded in depth and per-segment length, falling back to fixed generic wording for an empty path. @internal */
export function describeValidationField(path: readonly string[]): string {
  const bounded = path.slice(0, PATH_DEPTH_MAX).map((segment) => segment.slice(0, PATH_SEGMENT_MAX));
  return bounded.length === 0 ? UNNAMED_FIELD : bounded.join(".");
}

/** The path segments of one issue, as strings. */
function issuePathSegments(issue: v.BaseIssue<unknown>): string[] {
  // Filtering rather than stringifying keeps a hostile `toString` off the path and the submission out of the refusal.
  return (issue.path ?? [])
    .map((item) => item.key)
    .filter((key): key is string | number => typeof key === "string" || typeof key === "number")
    .map(String);
}

/** Names the field one valibot issue is about, and nothing else — for the refusal a caller reads. @public */
export function describeValidationIssue(issue: v.BaseIssue<unknown>): string {
  return describeValidationField(issuePathSegments(issue));
}

/** Names the env var one issue is about and the kind of failure, never the rejected value. @internal */
export function describeEnvIssue(issue: v.BaseIssue<unknown>): string {
  const named = issuePathSegments(issue);
  const field = named.length === 0 ? ENV_UNNAMED_FIELD : describeValidationField(named);
  return `${field}: ${issue.received === "undefined" ? "missing" : issue.type}`;
}

/** Formats env issues as a `field: reason` list joined by `; `. @internal */
export function formatEnvIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues.map(describeEnvIssue).join("; ");
}
