import type { EdgeKind } from "../src/cli/pkg/mod";

/** Namespaces any other namespace may import without that import counting as an edge. */
export const PRIMITIVES: readonly string[] = ["context", "crypto", "result", "validation"];

/** Namespaces declared to have zero cross-namespace edges beyond the primitives above. */
export const LEAF: readonly string[] = [
  "assets",
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
  "storage/r2",
  "ui/contracts",
  "ui/contracts/theme",
  "validation",
];

/** Every declared cross-namespace edge: source → target → whether it survives type erasure. */
export const EDGES: Record<string, Record<string, EdgeKind>> = {
  app: { config: "value", form: "value", http: "value", logging: "value", security: "value" },
  "assets/build": { assets: "type" },
  "cli/assets": { assets: "value", "assets/build": "value", "cli/core": "value" },
  "cli/cfgen": { "cli/core": "value" },
  "cli/core": { "cli/term": "value" },
  "cli/pkg": { "cli/core": "value", "cli/term": "value" },
  "cli/sync": { "cli/core": "value", "cli/term": "value" },
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
