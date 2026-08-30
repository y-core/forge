import type { ResolvedPrefix } from "../../types";

/**
 * The identifier form: every character that is not a word character becomes `_`.
 *
 * A project name is not an identifier — `my.app` and `my app` are both legal — so
 * the prefix derived from one is sanitised before it reaches a resource name.
 * Replacing only `-` left the dot in place, producing `MY.APP_CACHE`, which is not
 * a legal name on any surface that later lowercases it into DNS form.
 */
export function sanitizeName(value: string): string {
  return value.replace(/[^\w]/g, "_");
}

/**
 * How a remote resource is named when it is created independently and then linked
 * to the project — D1, KV, R2, a queue.
 *
 * One rule, `PROJECT_BINDING`, with a per-resource normaliser rather than two
 * competing rules. R2 buckets and queues must be DNS-shaped, so they take the
 * lowercase-hyphenated form of the very same name.
 */
export function prefixedName(prefix: ResolvedPrefix, binding: string): string {
  const safe = sanitizeName(binding);
  return prefix ? `${sanitizeName(prefix)}_${safe}` : safe;
}

/**
 * The DNS-shaped form: lowercase alphanumerics and hyphens, no run of more than
 * one hyphen, and none at either end — the shape R2 and Queues enforce.
 *
 * Applied to the whole name, prefix included. Normalising only the binding left the
 * prefix in its uppercase-underscore form, yielding `MY_WORKER-my-bucket` — neither
 * rule, and not a legal bucket name.
 */
export function dnsName(prefix: ResolvedPrefix, binding: string): string {
  return prefixedName(prefix, binding)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
