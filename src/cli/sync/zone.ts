import { resolve } from "node:path";
import process, { env } from "node:process";
import { resolveSiteConfig } from "../../site/config";
import type { SiteConfig, ZoneRule } from "../../site/types";
import { buildAllowRule, buildRedirectRule } from "../../site/zone";
import { createCommand } from "../core/command";
import { CliError } from "../core/errors";
import type { CliContext } from "../core/types";
import { PLAIN } from "../term/color";
import { createCfClient } from "./api/client";
import { ZONE_PHASES, zoneRulesetEntrypoint } from "./api/endpoints";
import { classifyCfError } from "./api/errors";
import type { CfApiClientError } from "./api/types";
import { renderSections, type TableRow, type TableSection } from "./table";

/** What the remote entry point ruleset returns, of the fields this command compares or writes. @internal */
interface RemoteRuleset {
  id?: string;
  description?: string;
  rules?: ZoneRule[];
}

/** One phase's reconciliation: what is there, what should be, and whether they differ. @internal */
interface PhasePlan {
  /** The `sync zone` name for this phase — `firewall` or `redirect`. */
  name: string;
  phase: string;
  desired: ZoneRule[];
  remote: ZoneRule[] | null;
  error?: string;
}

const zoneFlags = {
  config: { type: "string" as const, short: "c", description: "Path to the site config", default: "config/site.ts" },
  commit: { type: "boolean" as const, description: "Write the entry point rulesets. Without this flag nothing is written anywhere" },
  check: { type: "boolean" as const, description: "Exit non-zero when the zone is out of step with the config. For CI" },
  json: { type: "boolean" as const, description: "Print the run as a JSON document instead of a table. The only thing written to stdout" },
  "zone-id": { type: "string" as const, description: "Cloudflare zone ID (or CLOUDFLARE_ZONE_ID env)" },
  "api-token": { type: "string" as const, description: "Cloudflare API token (or CLOUDFLARE_API_TOKEN env)" },
};

type LooseFlags = Record<string, string | string[] | boolean | undefined>;

/** Loads the site config module and validates it. @internal */
async function loadSiteConfigModule(root: string, configPath: string): Promise<ReturnType<typeof resolveSiteConfig>> {
  const resolvedPath = resolve(root, configPath);
  let mod: { default?: SiteConfig };
  try {
    mod = (await import(resolvedPath)) as { default?: SiteConfig };
  } catch (error) {
    throw new CliError("invalid-args", `Could not load site config \`${configPath}\`: ${(error as Error).message}`);
  }
  const raw = mod.default;
  if (raw === undefined) throw new CliError("invalid-args", `\`${configPath}\` has no default export`);
  return resolveSiteConfig(raw);
}

/**
 * The rules each phase should hold, derived from the config alone.
 *
 * A phase the config says nothing about gets an empty array, and an empty array is a *statement* —
 * `PUT` replaces the rule list wholesale, so committing it clears the phase. That is the point:
 * one source of truth means a rule this config does not describe does not survive.
 *
 * @public
 */
export function planZoneRules(config: ReturnType<typeof resolveSiteConfig>): Array<Pick<PhasePlan, "name" | "phase" | "desired">> {
  const { zone } = config;
  if (zone === null) throw new CliError("invalid-args", "The site config declares no `zone` block — nothing to reconcile.");

  const allow = zone.allow;
  const redirect = zone.redirect;

  return [
    {
      name: "firewall",
      phase: ZONE_PHASES.firewall,
      desired: allow
        ? [
            buildAllowRule(
              {
                apex: zone.apex,
                // Every method, not the GET-only sitemap view: a `POST /api/contact` filtered out
                // here is a broken form, not a blocked probe.
                paths: allow.paths ?? config.pages,
                prefixes: allow.prefixes ?? [],
                files: allow.files ?? [],
              },
              { action: allow.action, ...(allow.description !== undefined ? { description: allow.description } : {}) },
            ),
          ]
        : [],
    },
    {
      name: "redirect",
      phase: ZONE_PHASES.redirect,
      desired: redirect
        ? [
            buildRedirectRule({
              from: redirect.from,
              apex: zone.apex,
              ...(redirect.statusCode !== undefined ? { statusCode: redirect.statusCode } : {}),
            }),
          ]
        : [],
    },
  ];
}

/** The fields this tool sets, so a remote rule is compared on those and not on `id` or `version`. @internal */
function comparable(rule: ZoneRule): string {
  return JSON.stringify({
    action: rule.action,
    expression: rule.expression,
    description: rule.description,
    enabled: rule.enabled,
    action_parameters: rule.action_parameters ?? null,
  });
}

/**
 * Whether a phase's remote rules already match what the config describes.
 *
 * Compared on the fields this tool sets, in order. A remote rule carries `id`, `version` and
 * `last_updated` besides, and comparing those would report drift on every run.
 *
 * @public
 */
export function rulesInSync(desired: readonly ZoneRule[], remote: readonly ZoneRule[] | null): boolean {
  if (remote === null || remote.length !== desired.length) return false;
  return desired.every((rule, index) => {
    const found = remote[index];
    return found !== undefined && comparable(found) === comparable(rule);
  });
}

/** @internal */
function phaseInSync(plan: PhasePlan): boolean {
  return rulesInSync(plan.desired, plan.remote);
}

/** Renders one phase as a report row. @internal */
function phaseRow(plan: PhasePlan, committed: boolean): TableRow {
  const state = plan.error ? "error" : phaseInSync(plan) ? "in sync" : committed ? "written" : "drift";
  const detail = plan.error ?? `${plan.remote?.length ?? 0} remote → ${plan.desired.length} desired`;
  return { phase: plan.phase, rules: String(plan.desired.length), action: state, detail };
}

async function runSyncZone(flags: LooseFlags, ctx?: CliContext): Promise<void> {
  const style = ctx?.out ?? PLAIN;
  const configPath = (flags.config as string | undefined) ?? "config/site.ts";
  const zoneId = (flags["zone-id"] as string | undefined) ?? env.CLOUDFLARE_ZONE_ID;
  const apiToken = (flags["api-token"] as string | undefined) ?? env.CLOUDFLARE_API_TOKEN;

  if (!zoneId) throw new CliError("invalid-args", "Missing zone ID. Set --zone-id or CLOUDFLARE_ZONE_ID");
  if (!apiToken)
    throw new CliError(
      "invalid-args",
      "Missing API token. Set --api-token or CLOUDFLARE_API_TOKEN. It needs Zone → Zone WAF:Edit and Dynamic Redirect:Edit, plus Zone:Read",
    );

  const config = await loadSiteConfigModule(process.cwd(), configPath);
  const client = createCfClient({ apiToken });

  const plans: PhasePlan[] = [];
  for (const planned of planZoneRules(config)) {
    const path = zoneRulesetEntrypoint(zoneId, planned.phase);
    const read = await client.get<RemoteRuleset>(path);
    if (read.ok) {
      plans.push({ ...planned, remote: read.data.rules ?? [] });
      continue;
    }
    // A phase with no entry point ruleset yet is not an error: the first write creates it.
    const kind = classifyCfError(read.error as CfApiClientError);
    if (kind === "not-found") plans.push({ ...planned, remote: [] });
    else plans.push({ ...planned, remote: null, error: describeFailure(kind, planned.phase) });
  }

  let committed = false;
  if (flags.commit === true) {
    for (const plan of plans) {
      if (plan.error !== undefined || phaseInSync(plan)) continue;
      const written = await client.put<RemoteRuleset>(zoneRulesetEntrypoint(zoneId, plan.phase), {
        description: `Managed by forge sync zone from ${configPath}`,
        rules: plan.desired,
      });
      if (written.ok) {
        plan.remote = plan.desired;
        committed = true;
      } else {
        plan.error = describeFailure(classifyCfError(written.error as CfApiClientError), plan.phase);
      }
    }
  }

  const drifted = plans.filter((plan) => plan.error === undefined && !phaseInSync(plan));
  const failed = plans.filter((plan) => plan.error !== undefined);

  if (flags.json === true) {
    console.log(
      JSON.stringify(
        {
          zone: config.zone?.apex,
          committed,
          phases: plans.map((plan) => ({
            phase: plan.phase,
            inSync: phaseInSync(plan),
            desired: plan.desired,
            remote: plan.remote,
            ...(plan.error !== undefined ? { error: plan.error } : {}),
          })),
        },
        null,
        2,
      ),
    );
  } else {
    const section: TableSection = {
      title: `Zone rules — ${config.zone?.apex}`,
      note: flags.commit === true ? "written by --commit" : "read-only; --commit writes the entry point rulesets",
      rows: plans.map((plan) => phaseRow(plan, committed)),
      footers:
        drifted.length > 0 && flags.commit !== true
          ? ["Sync before you push: allowing a path that does not exist yet is harmless, deploying one that is not yet allowed is an outage."]
          : [],
    };
    console.log(renderSections([section], { style, ...(ctx?.width === undefined ? {} : { width: ctx.width }) }));
  }

  if (failed.length > 0) process.exitCode = 1;
  else if (flags.check === true && drifted.length > 0) process.exitCode = 1;
}

/** @internal */
function describeFailure(kind: string, phase: string): string {
  if (kind === "auth") return `token lacks permission for \`${phase}\``;
  if (kind === "network") return "network error reaching the Cloudflare API";
  return `could not read \`${phase}\``;
}

/** The `forge sync zone` subcommand: reconciles zone entry point rulesets against `config/site.ts`. @public */
export function createSyncZoneCommand() {
  return createCommand({
    name: "zone",
    description:
      "Compare the zone's WAF and redirect rules against the site config and report on them. Read-only unless --commit, which replaces the entry point rulesets",
    flags: zoneFlags,
    run: (_args, flags, ctx) => runSyncZone(flags as LooseFlags, ctx),
  });
}
