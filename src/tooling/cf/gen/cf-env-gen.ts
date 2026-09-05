import { parseDevVars } from "../account/handlers/devvars";
import { type BindingDef, type Entry, type GenOptions, HEADER, REGISTRY } from "./cf-env-registry";

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

/** Collects var entries: typed `wrangler.jsonc` vars first, then `.dev.vars` secrets, which win on name collisions. @internal */
export function collectVars(devVarsText: string, wranglerVars: Record<string, unknown>, opts: GenOptions): Entry[] {
  // One recogniser for `.dev.vars` in the namespace: a key this misses is a key the
  // app boots with and no schema knows about.
  const devVarNames = parseDevVars(devVarsText).map((entry) => entry.name);
  const secretNames = new Set(devVarNames);

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(wranglerVars)) {
    if (secretNames.has(name)) continue;
    const base = typeof value === "number" ? "v.number()" : typeof value === "boolean" ? "v.boolean()" : "v.string()";
    entries.push({ name, expr: refine(name, base, opts) });
    seen.add(name);
  }
  for (const name of devVarNames) {
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
