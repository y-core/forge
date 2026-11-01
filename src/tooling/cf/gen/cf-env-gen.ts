import { parseDevVars } from "../account/handlers/devvars";
import { HEADER, REGISTRY } from "./cf-env-registry";
import type { BindingDef, Entry, GenOptions } from "./types";

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

function declaresSecrets(cfg: Record<string, unknown>): boolean {
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

/** Renders the full env-schema module text for the collected entries. @internal */
export function emit(entries: Entry[]): string {
  // `.dev.vars` accepts names an object literal does not, so `WEIRD-KEY` must be
  // quoted or the generated module is a syntax error.
  const key = (name: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));
  const body = entries.map((e) => `  ${key(e.name)}: ${e.expr},`).join("\n");
  return `${HEADER}

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
${body}
});

/** The Worker's binding/var surface as a type — inferred from \`EnvSchema\`. */
export type Env = v.InferOutput<typeof EnvSchema>;
`;
}
