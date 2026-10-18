import type { D1DatabaseConfig, ResolvedPrefix } from "../../types";

/** The identifier form of a name: every character that is not a word character becomes `_`. */
export function sanitizeName(value: string): string {
  return value.replace(/[^\w]/g, "_");
}

/** The `PREFIX_BINDING` name a remote resource is created under. */
export function prefixedName(prefix: ResolvedPrefix, binding: string): string {
  const safe = sanitizeName(binding);
  return prefix ? `${sanitizeName(prefix)}_${safe}` : safe;
}

/** The name of an entry's preview database: its `database_name`, else the prefixed name the D1 handler creates under, with `-preview`. */
export function previewName(entry: D1DatabaseConfig, prefix: ResolvedPrefix): string {
  return `${entry.database_name ?? prefixedName(prefix, entry.binding)}-preview`;
}

/** The prefixed name in the DNS shape R2 and Queues enforce: lowercase alphanumerics and single interior hyphens. */
export function dnsName(prefix: ResolvedPrefix, binding: string): string {
  return prefixedName(prefix, binding)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
