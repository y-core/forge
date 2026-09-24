import type { ResolvedPrefix } from "../../types";

/** The identifier form of a name: every character that is not a word character becomes `_`. */
export function sanitizeName(value: string): string {
  return value.replace(/[^\w]/g, "_");
}

/** The `PREFIX_BINDING` name a remote resource is created under. */
export function prefixedName(prefix: ResolvedPrefix, binding: string): string {
  const safe = sanitizeName(binding);
  return prefix ? `${sanitizeName(prefix)}_${safe}` : safe;
}

/** The prefixed name in the DNS shape R2 and Queues enforce: lowercase alphanumerics and single interior hyphens. */
export function dnsName(prefix: ResolvedPrefix, binding: string): string {
  return prefixedName(prefix, binding)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
