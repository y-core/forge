import type { EdgeKind } from "../src/cli/pkg/mod";

/** Namespaces any other namespace may import without that import counting as an edge. */
export const PRIMITIVES: readonly string[] = ["context", "crypto", "result", "validation"];

/** Namespaces declared to have zero cross-namespace edges beyond the primitives above. */
export const LEAF: readonly string[] = [
  "assets/manifest",
  "cli/term",
  "config",
  "context",
  "form",
  "html/htmx",
  "http",
  "result",
  "router",
  "session",
  "site",
  "storage/r2",
  "ui/contracts",
  "ui/contracts/theme",
  "validation",
];

/** Every declared cross-namespace edge: source → target → whether it survives type erasure. */
export const EDGES: Record<string, Record<string, EdgeKind>> = {
  app: { config: "value", form: "value", http: "value", logging: "value", security: "value" },
  // `assets` owns the config shape, so the `site` block's schema is part of it; `assets/build` runs
  // the generators. `site` reaches only `validation`, so neither edge can close a cycle.
  assets: { site: "value" },
  "assets/build": { assets: "value", site: "value" },
  "cli/assets": { assets: "value", "assets/build": "value", "cli/core": "value" },
  "cli/core": { "cli/term": "value" },
  // The asset-root check reads both configs; the class-order check judges a literal with the real
  // `cn`, so the conflict model has one home. No target reaches back into `cli/pkg`.
  "cli/pkg": { assets: "value", "cli/cf": "value", "cli/core": "value", "cli/term": "value", "ui/core": "value" },
  "cli/cf": { "cli/core": "value", "cli/term": "value", site: "value" },
  jsx: { http: "value" },
  // Type-only on purpose: `storage/kv → logging` is the runtime edge, so a value import here would
  // close a real cycle.
  logging: { "storage/kv": "type" },
  "logging/show": { "html/htmx": "value", http: "value", jsx: "value", logging: "value", "ui/core": "value" },
  security: { logging: "value" },
  "storage/db": { logging: "value" },
  "storage/kv": { logging: "value" },
  testing: { app: "type", form: "value", jsx: "value", logging: "value", "storage/db": "type", "storage/kv": "type", "storage/r2": "type" },
  "ui/assets": { assets: "type" },
  "ui/chrome": { jsx: "type", "ui/client": "value", "ui/contracts": "value", "ui/core": "value", "ui/server": "value" },
  "ui/client": { "ui/contracts": "value" },
  "ui/controls": { jsx: "type", "ui/core": "value", "ui/server": "value" },
  "ui/core": { form: "value", jsx: "value", "ui/client": "value", "ui/contracts": "value" },
  "ui/server": { "html/htmx": "value", jsx: "type", session: "value", "ui/core": "value" },
  "ui/show": {
    app: "value",
    form: "value",
    "html/htmx": "value",
    http: "value",
    jsx: "value",
    "ui/chrome": "value",
    "ui/client": "value",
    "ui/contracts": "value",
    "ui/contracts/theme": "value",
    "ui/controls": "value",
    "ui/core": "value",
    "ui/server": "value",
  },
};
