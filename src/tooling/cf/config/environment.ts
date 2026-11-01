import { err, ok } from "../../../result/result";
import type { Result } from "../../../result/types";
import type { WranglerConfig, WranglerEnvironmentConfig } from "../types";
import type { DeploymentKey, EnvironmentInheritance, ResolvedDeployment, WranglerDeployment } from "./types";

/** How wrangler carries each deployment key forge reads into an `env.<name>` block. @internal */
export const ENVIRONMENT_INHERITANCE = {
  name: "suffixed",
  account_id: "inherited",
  compatibility_date: "inherited",
  compatibility_flags: "inherited",
  main: "inherited",
  assets: "inherited",
  workers_dev: "inherited",
  preview_urls: "inherited",
  route: "inherited",
  routes: "inherited",
  build: "inherited",
  rules: "inherited",
  alias: "top-level",
  define: "not-inherited",
  d1_databases: "not-inherited",
} as const satisfies Record<DeploymentKey, EnvironmentInheritance>;

const DEPLOYMENT_KEYS = Object.keys(ENVIRONMENT_INHERITANCE) as DeploymentKey[];

function suffixName(value: unknown, env: string): string | undefined {
  return typeof value === "string" && value !== "" ? `${value}-${env}` : undefined;
}

function carryKey(key: DeploymentKey, config: WranglerConfig, stated: WranglerEnvironmentConfig, env: string): unknown {
  switch (ENVIRONMENT_INHERITANCE[key]) {
    case "inherited":
      return stated[key] ?? config[key];
    case "not-inherited":
      return stated[key];
    case "suffixed":
      return stated[key] ?? suffixName(config[key], env);
    case "top-level":
      return config[key];
  }
}

function buildDeployment(value: (key: DeploymentKey) => unknown): WranglerDeployment {
  return Object.fromEntries(
    DEPLOYMENT_KEYS.flatMap((key) => {
      const carried = value(key);
      return carried === undefined ? [] : [[key, carried]];
    }),
  ) as WranglerDeployment;
}

/** One deployment as wrangler builds it, each key forge reads carried per `ENVIRONMENT_INHERITANCE`. @internal */
export function readDeployment(config: WranglerConfig, env: string | null): Result<ResolvedDeployment, "undeclared-environment"> {
  if (env === null) {
    return ok({ env, prefix: "", stated: config, effective: buildDeployment((key) => config[key]), inherited: new Set() });
  }
  const prefix = `env.${env}.`;
  const envs = config.env;
  if (envs === undefined) {
    const effective = buildDeployment((key) => (ENVIRONMENT_INHERITANCE[key] === "suffixed" ? suffixName(config[key], env) : config[key]));
    return ok({ env, prefix, stated: {}, effective, inherited: new Set(DEPLOYMENT_KEYS) });
  }
  // Own keys only: a bare index answers `toString` and every other prototype member, so the
  // refusal below would not fire and a prototype member would be read as the environment's block.
  if (!Object.hasOwn(envs, env)) return err("undeclared-environment");
  const stated = envs[env] ?? {};
  const inherited = DEPLOYMENT_KEYS.filter((key) => {
    const rule = ENVIRONMENT_INHERITANCE[key];
    return rule === "top-level" || (rule !== "not-inherited" && stated[key] === undefined);
  });
  return ok({ env, prefix, stated, effective: buildDeployment((key) => carryKey(key, config, stated, env)), inherited: new Set(inherited) });
}

/** The top level and every declared environment, in declared order, each read as wrangler builds it. @internal */
export function listDeployments(config: WranglerConfig): ResolvedDeployment[] {
  return [null, ...Object.keys(config.env ?? {})].flatMap((env) => {
    const read = readDeployment(config, env);
    return read.ok ? [read.data] : [];
  });
}
