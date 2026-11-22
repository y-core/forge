import { parseDevVars } from "../account/handlers/devvars";
import { REGISTRY } from "./cf-env-registry";
import type { BindingDef, Entry, GenOptions, RateLimitWindow } from "./types";

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function bindingEntry(name: string, def: BindingDef, opts: GenOptions): Entry {
  const base = `v.custom<${def.tsType}>(${opts.bindingCheck}, "${def.message(name)}")`;
  return { name, expr: opts.optional.has(name) ? `v.optional(${base})` : base };
}

/** Collect binding entries from `cfg`, walking `REGISTRY` in order. @internal */
export function collectBindings(cfg: Record<string, unknown>, opts: GenOptions): Entry[] {
  const entries: Entry[] = [];
  for (const def of REGISTRY) {
    const node = getPath(cfg, def.configKey);
    if (def.shape === "list") {
      const list = Array.isArray(node) ? node : [];
      for (const item of list) {
        const name = (item as Record<string, unknown> | null)?.[def.nameField];
        if (typeof name === "string" && name) entries.push(bindingEntry(name, def, opts));
      }
      continue;
    }
    const name = (node as Record<string, unknown> | null)?.[def.nameField];
    if (node && typeof name === "string" && name) entries.push(bindingEntry(name, def, opts));
  }
  return entries;
}

function refine(name: string, base: string, opts: GenOptions): string {
  const min = opts.refinements[name]?.minLength;
  if (min != null && base === "v.string()") return `v.pipe(v.string(), v.minLength(${min}))`;
  return base;
}

/** Whether the worker config declares `secrets`, at the top level or in any named env. @internal */
export function declaresSecrets(cfg: Record<string, unknown>): boolean {
  if (cfg.secrets !== undefined) return true;
  const envs = cfg.env;
  if (envs == null || typeof envs !== "object") return false;
  return Object.values(envs).some((env) => (env as Record<string, unknown> | null)?.secrets !== undefined);
}

/** Secret names for the Env: `secrets.required` once the config declares `secrets`, else every `.dev.vars` key. @internal */
export function collectSecretNames(cfg: Record<string, unknown>, devVarsText: string): string[] {
  if (declaresSecrets(cfg)) {
    const required = getPath(cfg, "secrets.required");
    if (!Array.isArray(required)) return [];
    return required.filter((name): name is string => typeof name === "string" && name !== "");
  }
  // One recogniser for `.dev.vars` in the namespace: a key this misses is a key the
  // app boots with and no schema knows about.
  return parseDevVars(devVarsText).map((entry) => entry.name);
}

/** Collects var entries: typed `wrangler.jsonc` vars first, then the secret names, which win on name collisions. @internal */
export function collectVars(secretNames: readonly string[], wranglerVars: Record<string, unknown>, opts: GenOptions): Entry[] {
  const secrets = new Set(secretNames);

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(wranglerVars)) {
    if (secrets.has(name)) continue;
    const base = typeof value === "number" ? "v.number()" : typeof value === "boolean" ? "v.boolean()" : "v.string()";
    entries.push({ name, expr: refine(name, base, opts) });
    seen.add(name);
  }
  for (const name of secretNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, expr: refine(name, "v.string()", opts) });
  }
  return entries;
}

/** The vars and required secrets only a named environment declares, each optional on the Env as `wrangler types` makes it; a secret is a string. @internal */
export function collectNamedEnvVars(cfg: Record<string, unknown>, declared: ReadonlySet<string>, opts: GenOptions): Entry[] {
  const envs = cfg.env !== null && typeof cfg.env === "object" ? Object.values(cfg.env) : [];
  const bases = new Map<string, string>();
  for (const env of envs) {
    if (env === null || typeof env !== "object") continue;
    const vars = (env as Record<string, unknown>).vars;
    for (const [name, value] of Object.entries(vars !== null && typeof vars === "object" ? vars : {})) {
      if (!bases.has(name)) bases.set(name, typeof value === "number" ? "v.number()" : typeof value === "boolean" ? "v.boolean()" : "v.string()");
    }
    const required = getPath(env, "secrets.required");
    for (const name of Array.isArray(required) ? required : []) {
      if (typeof name === "string" && name !== "") bases.set(name, "v.string()");
    }
  }
  return [...bases].filter(([name]) => !declared.has(name)).map(([name, base]) => ({ name, expr: `v.optional(${refine(name, base, opts)})` }));
}

/** An optional string var for each `optional` name nothing else declares, such as one set only in the dashboard. @internal */
export function collectPolicyVars(declared: ReadonlySet<string>, opts: GenOptions): Entry[] {
  return [...opts.optional]
    .filter((name) => !declared.has(name))
    .map((name) => ({ name, expr: `v.optional(${refine(name, "v.string()", opts)})` }));
}

function rateLimitEntries(scope: unknown): Record<string, unknown>[] {
  const list = (scope as Record<string, unknown> | null)?.ratelimits;
  return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}

function rateLimitWindow(name: string, entry: Record<string, unknown>): RateLimitWindow {
  const limit = getPath(entry, "simple.limit");
  const period = getPath(entry, "simple.period");
  if (period !== 10 && period !== 60) throw new Error(`ratelimits "${name}": simple.period must be 10 or 60, got ${JSON.stringify(period)}`);
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`ratelimits "${name}": simple.limit must be a positive integer, got ${JSON.stringify(limit)}`);
  }
  return { limit, period };
}

/** Each top-level `ratelimits` binding's window; throws on a bad `simple` or a named env that changes a binding's `period`, which `Retry-After` reports. @internal */
export function collectRateLimits(cfg: Record<string, unknown>): Record<string, RateLimitWindow> {
  const table: Record<string, RateLimitWindow> = {};
  for (const entry of rateLimitEntries(cfg)) {
    if (typeof entry.name === "string" && entry.name) table[entry.name] = rateLimitWindow(entry.name, entry);
  }
  const envs = cfg.env !== null && typeof cfg.env === "object" ? Object.entries(cfg.env) : [];
  for (const [envName, env] of envs) {
    for (const entry of rateLimitEntries(env)) {
      const top = typeof entry.name === "string" ? table[entry.name] : undefined;
      if (!top) continue;
      const period = getPath(entry, "simple.period");
      if (period === top.period) continue;
      throw new Error(
        `ratelimits "${entry.name}": env.${envName} declares period ${JSON.stringify(period)}, the top level ${top.period} — ` +
          `a binding has one period across environments`,
      );
    }
  }
  return table;
}

function renderRateLimits(rateLimits: Readonly<Record<string, RateLimitWindow>>, key: (name: string) => string): string {
  const rows = Object.entries(rateLimits).map(([name, w]) => `  ${key(name)}: { limit: ${w.limit}, period: ${w.period} },`);
  if (rows.length === 0) return "";
  return `
/** Each rate-limit binding's top-level window from \`wrangler.jsonc\`'s \`ratelimits\`; an environment may set its own \`limit\`, never its \`period\`. */
export const RATELIMITS = {
${rows.join("\n")}
} as const;
`;
}

/** Renders the env-schema module for the collected entries and top-level rate-limit windows, its header naming `command`, the invocation that regenerates it. @internal */
export function emit(entries: Entry[], command: string, rateLimits: Readonly<Record<string, RateLimitWindow>> = {}): string {
  // `.dev.vars` accepts names an object literal does not, so `WEIRD-KEY` must be
  // quoted or the generated module is a syntax error.
  const key = (name: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));
  const body = entries.map((e) => `  ${key(e.name)}: ${e.expr},`).join("\n");
  return `/** GENERATED — do not edit; run \`${command}\`. */

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a type — inferred from \`EnvSchema\`. */
export type Env = v.InferOutput<typeof EnvSchema>;

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
${body}
});
${renderRateLimits(rateLimits, key)}
declare module "@y-core/forge/config" {
  interface DeclaredEnv extends Env {}
}
`;
}
