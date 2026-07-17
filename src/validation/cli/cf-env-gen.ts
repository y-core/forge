/** cf-env-gen.ts — portable, schema-first generator for the Cloudflare binding/var surface.
 *
 *  A reusable, IO-free core that re-creates the env half of `wrangler types …
 *  --include-env --no-include-runtime` as a committed valibot module: a runtime
 *  `EnvSchema` plus `type Env = v.InferOutput<typeof EnvSchema>`. The runnable command
 *  (file IO, CLI flags, formatting) lives next door in `cf-env-command.ts`; everything
 *  here is pure so both ship together under `@y-core/forge/validation/cli`.
 *
 *  The binding-kind data table (`REGISTRY`) and the policy/entry shapes it consumes live
 *  in `cf-env-registry.ts`; this module is the codegen that walks them.
 */

import { type BindingDef, type Entry, type GenOptions, HEADER, REGISTRY } from "./cf-env-registry";

/** Strip `//` and block comments from JSONC, string-aware so `//` inside a string survives. @internal */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += ch;
  }
  return out;
}

/** Resolve a (possibly dotted) path through an object, returning `undefined` on any gap. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Build a binding entry for `name`, wrapping in `v.optional` when policy marks it optional. */
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

/** Apply a name's `minLength` refinement to a string base, else return the base unchanged. */
function refine(name: string, base: string, opts: GenOptions): string {
  const min = opts.refinements[name]?.minLength;
  if (min != null && base === "v.string()") return `v.pipe(v.string(), v.minLength(${min}))`;
  return base;
}

/** Collect var entries: typed `wrangler.jsonc` `vars` first, then `.dev.vars` secrets
 *  (all `v.string()`). `.dev.vars` wins on name collisions (secret precedence). @internal */
export function collectVars(devVarsText: string, wranglerVars: Record<string, unknown>, opts: GenOptions): Entry[] {
  const secretNames = new Set<string>();
  for (const line of devVarsText.split("\n")) {
    const name = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim())?.[1];
    if (name) secretNames.add(name);
  }

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(wranglerVars)) {
    if (secretNames.has(name)) continue; // secret takes precedence
    const base = typeof value === "number" ? "v.number()" : typeof value === "boolean" ? "v.boolean()" : "v.string()";
    entries.push({ name, expr: refine(name, base, opts) });
    seen.add(name);
  }
  for (const line of devVarsText.split("\n")) {
    const name = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim())?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, expr: refine(name, "v.string()", opts) });
  }
  return entries;
}

/** Render the full env-schema module text for the collected entries (with the baked `HEADER`). @internal */
export function emit(entries: Entry[]): string {
  const body = entries.map((e) => `  ${e.name}: ${e.expr},`).join("\n");
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
