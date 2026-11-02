import { CliError } from "../../cli/errors";
import type { LifecyclePlan, LifecycleRetention, R2LifecycleRule } from "./types";

const DAY_SECONDS = 86_400;

function readDays(flag: string, value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value))
    throw new CliError("invalid-args", `--${flag} takes a whole number of days, not ${String(value)}`);
  return Number(value);
}

/** The retention a run asks for, refusing none at all and a move to Infrequent Access that would come after the expiry. @internal */
export function readLifecycleRetention(flags: Readonly<Record<string, unknown>>): LifecycleRetention {
  const expireAfterDays = readDays("expire-days", flags["expire-days"]);
  const infrequentAccessAfterDays = readDays("ia-days", flags["ia-days"]);
  if (expireAfterDays === null && infrequentAccessAfterDays === null) {
    throw new CliError("invalid-args", "name a retention: --expire-days, --ia-days, or both");
  }
  if (expireAfterDays !== null && infrequentAccessAfterDays !== null && infrequentAccessAfterDays >= expireAfterDays) {
    throw new CliError(
      "invalid-args",
      `--ia-days ${infrequentAccessAfterDays} is not before --expire-days ${expireAfterDays}, so no object would ever move to Infrequent Access`,
    );
  }
  const prefix = typeof flags.prefix === "string" ? flags.prefix : "d1-backups";
  return { prefix: prefix.endsWith("/") || prefix === "" ? prefix : `${prefix}/`, expireAfterDays, infrequentAccessAfterDays };
}

/** The id of the one rule forge owns under `prefix`, so a later run finds and replaces only it. @internal */
export function forgeRuleId(prefix: string): string {
  return `forge-${prefix.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "all"}`;
}

/** The rule that carries `retention`, expiring the dumps and their sidecars alike since they share the prefix. @internal */
export function desiredLifecycleRule(retention: LifecycleRetention): R2LifecycleRule {
  const age = (days: number) => ({ type: "Age" as const, maxAge: days * DAY_SECONDS });
  return {
    id: forgeRuleId(retention.prefix),
    enabled: true,
    conditions: { prefix: retention.prefix },
    ...(retention.expireAfterDays === null ? {} : { deleteObjectsTransition: { condition: age(retention.expireAfterDays) } }),
    ...(retention.infrequentAccessAfterDays === null
      ? {}
      : { storageClassTransitions: [{ condition: age(retention.infrequentAccessAfterDays), storageClass: "InfrequentAccess" as const }] }),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The bucket's rules with forge's own replaced or added, every foreign rule kept as it was and where it was. @internal */
export function planLifecycle(bucket: string, remote: readonly R2LifecycleRule[], rule: R2LifecycleRule): LifecyclePlan {
  const index = remote.findIndex((existing) => existing.id === rule.id);
  const before = remote[index] ?? null;
  if (before !== null && before.conditions.prefix !== rule.conditions.prefix) {
    throw new CliError(
      "invalid-args",
      `${bucket} already has rule ${rule.id} for prefix ${JSON.stringify(before.conditions.prefix)}, and ${JSON.stringify(rule.conditions.prefix)} maps to the same id — choose a prefix that differs in a letter, digit, - or _`,
    );
  }
  if (before === null) return { bucket, rule, before, rules: [...remote, rule], action: "would-create" };
  const rules = remote.map((existing, at) => (at === index ? rule : existing));
  return { bucket, rule, before, rules, action: canonical(before) === canonical(rule) ? "in-sync" : "would-update" };
}
