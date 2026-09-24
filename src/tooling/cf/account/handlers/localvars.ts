import { devVarsPath, readDevVars } from "./devvars";
import type { ReconcileResult, ResourceHandler } from "./types";

type LocalVarEntry = { name: string };

/** Reports the `.dev.vars` keys carrying no marker and no `vars` declaration, making no request. */
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
