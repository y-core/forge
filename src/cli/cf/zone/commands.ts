import { resolve } from "node:path";
import process, { env } from "node:process";
import { resolveSiteConfig } from "../../../site/config";
import type { SiteConfig, ZoneRule } from "../../../site/types";
import { buildAllowRule, buildRedirectRule } from "../../../site/zone";
import { createCommand } from "../../core/command";
import { CliError } from "../../core/errors";
import type { CliContext } from "../../core/types";
import { type Colorize, PLAIN } from "../../term/color";
import { styleAction } from "../account/commands";
import { createCfClient } from "../api/client";
import { ZONE_PHASES, zoneRulesetEntrypoint } from "../api/endpoints";
import { classifyCfError } from "../api/errors";
import type { CfApiClientError } from "../api/types";
import { renderSections, type TableRow, type TableSection } from "../table";
import type { SyncAction } from "../types";

/** What the remote entry point ruleset returns, of the fields this command compares or writes. @internal */
interface RemoteRuleset {
  id?: string;
  description?: string;
  rules?: ZoneRule[];
}

/**
 * The API-token permission each phase needs, named in the failure row.
 *
 * "Check your scopes" is not a fix, so the failure row names the permission. No single permission
 * covers both phases — which is why a token can succeed on one and fail on the other, and why both
 * failing together points at the token itself rather than at a scope.
 *
 * @internal
 */
const PHASE_PERMISSIONS: Record<string, string> = {
  http_request_firewall_custom: "Zone → Zone WAF: Edit",
  http_request_dynamic_redirect: "Zone → Dynamic Redirect: Edit",
};

/** One phase's reconciliation: what is there, what should be, and whether they differ. @internal */
interface PhasePlan {
  /** The `sync zone` name for this phase — `firewall` or `redirect`. */
  name: string;
  phase: string;
  desired: ZoneRule[];
  remote: ZoneRule[] | null;
  error?: string;
  /** The upstream message, printed under the table — too long for the row, too useful to drop. */
  errorDetail?: string;
}

const zoneFlags = {
  config: { type: "string" as const, short: "c", description: "Path to the site config", default: "config/site.ts" },
  commit: { type: "boolean" as const, description: "Write the entry point rulesets. Without this flag nothing is written anywhere" },
  check: { type: "boolean" as const, description: "Exit non-zero when the zone is out of step with the config. For CI" },
  json: { type: "boolean" as const, description: "Print the run as a JSON document instead of a table. The only thing written to stdout" },
  "zone-id": { type: "string" as const, description: "Cloudflare zone ID. Prefer the CLOUDFLARE_ZONE_ID environment variable" },
  "api-token": { type: "string" as const, description: "Cloudflare API token. Prefer the CLOUDFLARE_API_TOKEN environment variable" },
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

/**
 * Recursively sorts object keys, so a comparison is about values rather than the order a server
 * happened to serialise them in.
 *
 * Cloudflare returns `action_parameters` alphabetised and this tool writes them in the order the
 * builder composes them. Without this, a rule that had *just been written* compared unequal to
 * itself, and `--check` reported drift on every run — a gate step that always fails teaches people
 * to ignore it.
 *
 * Arrays keep their order: a ruleset's rules are ordered and two orderings are genuinely different.
 *
 * @internal
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonical(record[key])]),
  );
}

/** The fields this tool sets, so a remote rule is compared on those and not on `id` or `version`. @internal */
function comparable(rule: ZoneRule): string {
  return JSON.stringify(
    canonical({
      action: rule.action,
      expression: rule.expression,
      description: rule.description,
      enabled: rule.enabled,
      action_parameters: rule.action_parameters ?? null,
    }),
  );
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

/**
 * Which of `sync`'s outcomes this phase is in.
 *
 * The same vocabulary the binding report uses, so a reader who knows one table can read the other:
 * `drift` is the state that needs a `--commit`, and it is what a phase sits in before one.
 *
 * @internal
 */
function phaseAction(plan: PhasePlan, committed: boolean): SyncAction {
  if (plan.error !== undefined) return "error";
  if (!phaseInSync(plan)) return "drift";
  return committed ? "updated" : "in-sync";
}

/** Renders one phase as a report row. @internal */
function phaseRow(plan: PhasePlan, committed: boolean, style: Colorize): TableRow {
  return {
    Phase: plan.phase,
    Rules: String(plan.desired.length),
    Action: styleAction(phaseAction(plan, committed), style),
    Detail: plan.error ?? `${plan.remote?.length ?? 0} remote → ${plan.desired.length} desired`,
  };
}

async function runSyncZone(flags: LooseFlags, ctx?: CliContext): Promise<void> {
  const style = ctx?.out ?? PLAIN;
  const configPath = (flags.config as string | undefined) ?? "config/site.ts";
  const zoneId = (flags["zone-id"] as string | undefined) ?? env.CLOUDFLARE_ZONE_ID;
  const apiToken = (flags["api-token"] as string | undefined) ?? env.CLOUDFLARE_API_TOKEN;

  // Refused up front rather than carried as an empty string into a call that would fail as an auth
  // error, which reads as "your token is wrong" rather than "you did not set one".
  if (!zoneId) throw new CliError("invalid-args", "CLOUDFLARE_ZONE_ID is not set. Export it, or pass --zone-id");
  if (!apiToken)
    throw new CliError(
      "invalid-args",
      "CLOUDFLARE_API_TOKEN is not set. Export it, or pass --api-token. It needs Zone → Zone WAF:Edit and Dynamic Redirect:Edit, plus Zone:Read",
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
    else plans.push({ ...planned, remote: null, ...describeFailure(read.error as CfApiClientError, planned.phase) });
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
        Object.assign(plan, describeFailure(written.error as CfApiClientError, plan.phase));
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
            ...(plan.error !== undefined ? { error: plan.error, errorDetail: plan.errorDetail } : {}),
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
      rows: plans.map((plan) => phaseRow(plan, committed, style)),
      // The row's `detail` column is truncated to fit; the upstream message is the part that
      // actually diagnoses, so it goes below the grid where it has the width to be read.
      footers: [
        ...failed.map((plan) => plan.errorDetail ?? ""),
        ...(drifted.length > 0 && failed.length === 0 && flags.commit !== true
          ? ["Sync before you push: allowing a path that does not exist yet is harmless, deploying one that is not yet allowed is an outage."]
          : []),
      ].filter((line) => line !== ""),
    };
    // `Action` and `Detail` are prose and may wrap; `Phase` is an identifier and truncates. The
    // same split the binding report makes, and for the same reason: a truncated verb has lost its
    // meaning where a truncated identifier is still recognisable.
    console.log(renderSections([section], { style, wrap: ["Action", "Detail"], ...(ctx?.width === undefined ? {} : { width: ctx.width }) }));
  }

  if (failed.length > 0) process.exitCode = 1;
  else if (flags.check === true && drifted.length > 0) process.exitCode = 1;
}

/**
 * Why a phase could not be read or written, in the two registers a reader needs: a short reason for
 * the row, and Cloudflare's own words underneath it.
 *
 * **An auth failure names both possibilities rather than asserting one.** Cloudflare returns the
 * same code for a token it rejects and for a valid token missing the permission — `endpoints.ts`
 * records this — so "your token lacks permission" is a guess presented as a diagnosis, and it sends
 * someone editing scopes when the token is simply wrong.
 *
 * @internal
 */
function describeFailure(error: CfApiClientError, phase: string): { error: string; errorDetail: string } {
  const kind = classifyCfError(error);
  const codes = error.cfErrors?.map((e) => e.code) ?? [];
  const code = codes.length > 0 ? ` (code ${codes.join(", ")})` : "";
  const upstream = error.message ? `${phase}: ${error.message}` : `${phase}: no message`;

  if (kind === "auth") {
    const permission = PHASE_PERMISSIONS[phase] ?? "the phase's product permission";
    return {
      error: `auth failed${code} — token rejected, or missing ${permission}`,
      errorDetail: `${upstream}. Cloudflare returns one code for a rejected token and for a valid token missing a permission. Confirm the token itself with GET /user/tokens/verify: if it is active, this is a permission — most often Account → Account Rulesets: Edit, which unlocks both phases and which zone-level scopes alone do not cover, then ${permission}. Note that Zone → Zone: Read reads the zone but not its rulesets.`,
    };
  }
  if (kind === "network") return { error: "network error", errorDetail: upstream };
  return { error: `could not read the phase${code}`, errorDetail: upstream };
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
