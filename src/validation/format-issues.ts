import type { v } from "./validation";

/**
 * Formats valibot issues as a single `path: message` list joined by `; `, using `root`
 * for issues without a path. Shared by the env/config validators so the
 * `Invalid environment: …` message shape stays uniform across namespaces. @public
 */
export function formatValidationIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues.map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`).join("; ");
}
