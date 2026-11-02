import { resolve } from "node:path";

import { createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import type { CliContext } from "../../cli/types";
import { createCfClient } from "../api/client";
import { r2LifecyclePath } from "../api/endpoints";
import { CF_OPERATIONS } from "../api/operations";
import type { CfClient } from "../api/types";
import { readCfAuth } from "../auth";
import { loadWranglerConfig } from "../config/parse";
import type { R2BucketConfig } from "../types";
import { desiredLifecycleRule, planLifecycle, readLifecycleRetention } from "./plan";
import type { LifecyclePlan, LifecycleRetention, R2LifecycleRule } from "./types";

/** The bucket a `--bucket` names: the bucket an `r2_buckets` binding of that name points at, else the name itself. @internal */
export function resolveLifecycleBucket(buckets: readonly R2BucketConfig[] | undefined, named: string): string {
  return buckets?.find((bucket) => bucket.binding === named)?.bucket_name ?? named;
}

/** Reads a bucket's lifecycle rules, plans forge's rule into them, and writes the whole list back when `commit` asks and they differ. @internal */
export async function syncLifecycle(
  client: CfClient,
  accountId: string,
  bucket: string,
  retention: LifecycleRetention,
  commit: boolean,
): Promise<{ plan: LifecyclePlan; written: boolean }> {
  const path = r2LifecyclePath(accountId, bucket);
  const read = await client.get(path, CF_OPERATIONS.getR2Lifecycle);
  if (!read.ok) throw new CliError("external", `reading ${bucket}'s lifecycle rules failed: ${read.error.message}`, { cause: read.error });
  const plan = planLifecycle(bucket, read.data.rules as R2LifecycleRule[], desiredLifecycleRule(retention));
  if (!commit || plan.action === "in-sync") return { plan, written: false };
  const written = await client.put(path, { rules: plan.rules }, CF_OPERATIONS.putR2Lifecycle);
  if (!written.ok) throw new CliError("external", `writing ${bucket}'s lifecycle rules failed: ${written.error.message}`, { cause: written.error });
  return { plan, written: true };
}

function describe(rule: R2LifecycleRule | null): string {
  if (rule === null) return "none";
  const days = (seconds: number) => `${seconds / 86_400} days`;
  const parts = [
    ...(rule.storageClassTransitions ?? []).map((transition) => `Infrequent Access after ${days(transition.condition.maxAge)}`),
    ...(rule.deleteObjectsTransition === undefined ? [] : [`expire after ${days(rule.deleteObjectsTransition.condition.maxAge)}`]),
  ];
  return `${parts.join(", ") || "no transition"}${rule.enabled ? "" : " (disabled)"}`;
}

/** The lines a lifecycle sync prints: the rule as it is and as forge wants it, and what the run did. @internal */
export function describeLifecycle(plan: LifecyclePlan, written: boolean): string[] {
  const outcome = written ? (plan.action === "would-create" ? "created" : "updated") : plan.action;
  return [
    `${outcome} — ${plan.bucket}: rule ${plan.rule.id} on ${plan.rule.conditions.prefix || "every object"}`,
    `  now:    ${describe(plan.before)}`,
    `  wanted: ${describe(plan.rule)}`,
    ...(plan.action !== "in-sync" && !written ? ["  read-only; --commit writes the bucket's lifecycle rules, every other rule kept"] : []),
  ];
}

/** The `forge cf sync lifecycle` subcommand: expire or move a bucket's backups by age, through R2's own lifecycle rules. @public */
export function createSyncLifecycleCommand() {
  return createCommand({
    name: "lifecycle",
    description: "Reconcile the R2 lifecycle rule that expires a backup prefix and moves it to Infrequent Access by age",
    flags: {
      config: { type: "string" as const, short: "c", description: "Path to wrangler.jsonc", default: "wrangler.jsonc" },
      bucket: { type: "string" as const, required: true, description: "The r2_buckets binding, or the bucket's name" },
      prefix: { type: "string" as const, description: "The key prefix the rule covers. Defaults to d1-backups" },
      "expire-days": { type: "string" as const, description: "Delete an object this many days after it was written" },
      "ia-days": { type: "string" as const, description: "Move an object to Infrequent Access this many days after it was written" },
      commit: { type: "boolean" as const, description: "Write the rule. Without this flag nothing is written" },
      json: { type: "boolean" as const, description: "Print the plan as JSON" },
      "account-id": { type: "string" as const, description: "The Cloudflare account" },
      "api-token": { type: "string" as const, description: "A token holding Account → Workers R2 Storage → Edit" },
    },
    run: async (_args, flags, ctx?: CliContext) => {
      const retention = readLifecycleRetention(flags);
      const auth = readCfAuth(flags);
      const config = loadWranglerConfig(resolve(flags.config ?? "wrangler.jsonc")).config;
      const bucket = resolveLifecycleBucket(config.r2_buckets, flags.bucket);
      const { plan, written } = await syncLifecycle(createCfClient(auth), auth.accountId, bucket, retention, flags.commit === true);
      const print = (line: string) => (ctx?.io === undefined ? console.log(line) : ctx.io.stdout(line));
      if (flags.json === true) print(JSON.stringify({ bucket, action: plan.action, written, rule: plan.rule, before: plan.before }));
      else for (const line of describeLifecycle(plan, written)) print(line);
    },
  });
}
