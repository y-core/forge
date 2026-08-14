import type { v } from "./validation";

const UNNAMED_FIELD = "the submitted form";

const PATH_DEPTH_MAX = 3;
const PATH_SEGMENT_MAX = 40;

/** Formats valibot issues as a single `path: message` list joined by `; `, using `root` for issues without a path. @public */
export function formatValidationIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues.map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`).join("; ");
}

/** Names the field at `path`, bounded in depth and per-segment length, falling back to fixed generic wording for an empty path. @internal */
export function describeValidationField(path: readonly string[]): string {
  const bounded = path.slice(0, PATH_DEPTH_MAX).map((segment) => segment.slice(0, PATH_SEGMENT_MAX));
  return bounded.length === 0 ? UNNAMED_FIELD : bounded.join(".");
}

/** Names the field one valibot issue is about, and nothing else — for the refusal a caller reads. @public */
export function describeValidationIssue(issue: v.BaseIssue<unknown>): string {
  // Filtering rather than stringifying keeps a hostile `toString` off the path and the submission out of the refusal.
  const named = (issue.path ?? [])
    .map((item) => item.key)
    .filter((key): key is string | number => typeof key === "string" || typeof key === "number");
  return describeValidationField(named.map(String));
}
