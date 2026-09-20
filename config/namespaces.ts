import type { EdgeKind } from "../src/tooling/gate/mod";

/** Namespaces any other namespace may import without that import counting as an edge. */
export const PRIMITIVES: readonly string[] = ["context", "crypto", "result", "validation"];

/** Namespaces declared to have zero cross-namespace edges beyond the primitives above. */
export const LEAF: readonly string[] = [
  "assets",
  "config",
  "context",
  "dev",
  "html/htmx",
  "http",
  "result",
  "router",
  "session",
  "site",
  "storage/r2",
  "tooling/lint",
  "tooling/term",
  "ui/contracts",
  "ui/contracts/theme",
  "validation",
];

/** Every declared cross-namespace edge: source → target → whether it survives type erasure. */
export const EDGES: Record<string, Record<string, EdgeKind>> = {
  app: { config: "value", dev: "type", form: "value", http: "value", jsx: "value", logging: "value", security: "value" },
  auth: { "storage/db": "value" },
  "auth/client": { auth: "value", http: "value", "ui/client": "value" },
  "auth/web": {
    app: "value",
    auth: "value",
    form: "value",
    "html/htmx": "value",
    http: "value",
    jsx: "value",
    session: "value",
    "ui/core": "value",
  },
  form: { dev: "type" },
  jsx: { http: "value" },
  logging: { "storage/kv": "type" },
  "output/pdf": { jsx: "value" },
  // One way: the audit reads the engine's types and its declared defaults, and the engine never
  // reaches back for it — which is what keeps the `output/pdf` container acyclic.
  "output/pdf/audit": { "output/pdf": "value" },
  // Type-only, and one way for the same reason: a pack is adapted into the face shape the engine
  // embeds, so the names cross but nothing does at runtime and the container stays acyclic.
  "output/pdf/fonts": { "output/pdf": "type" },
  "logging/show": { app: "value", "html/htmx": "value", http: "value", jsx: "value", logging: "value", "ui/contracts": "type", "ui/core": "value" },
  security: { dev: "type", logging: "value" },
  "storage/db": { logging: "value" },
  "storage/kv": { logging: "value" },
  testing: { app: "type", form: "value", jsx: "value", logging: "value", "storage/db": "value", "storage/kv": "type", "storage/r2": "value" },
  "tooling/assets": { assets: "type", http: "value", site: "value", "tooling/cli": "value", "ui/assets/build": "value" },
  "tooling/cf": { "tooling/cli": "value", "tooling/term": "value", site: "value" },
  "tooling/cli": { "tooling/term": "value" },
  "tooling/db": { "storage/db": "value", "tooling/cf": "value", "tooling/cli": "value", "tooling/term": "value" },
  "tooling/gate": {
    "tooling/assets": "value",
    "tooling/cf": "type",
    "tooling/cli": "value",
    "tooling/lint": "value",
    "tooling/term": "value",
    "ui/contracts/theme": "value",
    "ui/core": "value",
  },
  "tooling/release": { "tooling/cli": "value", "tooling/gate": "value", "tooling/term": "value" },
  "ui/assets/build": { "tooling/assets": "type", "ui/assets": "value", "ui/contracts/theme": "value" },
  "ui/chrome": { jsx: "type", "ui/client": "value", "ui/contracts": "value", "ui/core": "value", "ui/server": "value" },
  "ui/client": { "ui/contracts": "value" },
  "ui/controls": { jsx: "type", "ui/core": "value", "ui/server": "value" },
  "ui/core": { form: "value", jsx: "value", "ui/client": "value", "ui/contracts": "value" },
  "ui/server": { "html/htmx": "value", jsx: "type", session: "value", "ui/contracts": "value", "ui/core": "value" },
  "ui/show": {
    app: "value",
    form: "value",
    "html/htmx": "value",
    http: "value",
    jsx: "value",
    security: "value",
    "ui/chrome": "value",
    "ui/client": "value",
    "ui/contracts": "value",
    "ui/contracts/theme": "value",
    "ui/controls": "value",
    "ui/core": "value",
    "ui/server": "value",
  },
};
