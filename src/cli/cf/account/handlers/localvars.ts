import { devVarsPath, readDevVars } from "./devvars";
import type { ReconcileResult, ResourceHandler } from "./types";

type LocalVarEntry = { name: string };

/**
 * The `.dev.vars` keys that carry no marker and no `vars` declaration.
 *
 * They are reported so that "nothing is going to happen to this" is a statement the
 * run makes, rather than an absence the reader has to notice. Nothing here is ever
 * sent anywhere, so this handler makes no request and needs no credentials — which
 * is also why a key lands here by default: the safe classification is the one you
 * get by saying nothing.
 *
 * A name declared in `wrangler.jsonc` `vars` is excluded: `.dev.vars` shadowing a
 * var is the documented `wrangler dev` pattern, and the vars handler reports it.
 */
export function createLocalVarsHandler(configPath: string): ResourceHandler<LocalVarEntry> {
  const path = devVarsPath(configPath);

  return {
    type: "local_vars",
    displayName: "Local Only",

    extract(config) {
      const declaredVars = new Set(Object.keys(config.vars ?? {}));
      return readDevVars(path)
        .filter((v) => v.kind === "local" && !declaredVars.has(v.name))
        .map((v) => ({ name: v.name }));
    },

    async reconcile(entries): Promise<ReconcileResult<LocalVarEntry>> {
      return {
        entries,
        results: entries.map((entry) => ({ resourceType: "local_vars" as const, binding: entry.name, action: "local-only" as const, local: true })),
      };
    },
  };
}
