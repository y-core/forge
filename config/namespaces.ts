import type { EdgeKind } from "../src/tooling/gate/mod";

/** Namespaces any other namespace may import without that import counting as an edge. */
export const PRIMITIVES: readonly string[] = ["context", "crypto", "result", "validation"];

/** Namespaces declared to have zero cross-namespace edges beyond the primitives above. */
export const LEAF: readonly string[] = [
  "assets",
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
  "tooling/lint",
  "tooling/term",
  "ui/contracts",
  "ui/contracts/theme",
  "validation",
];

/** Every declared cross-namespace edge: source → target → whether it survives type erasure. */
export const EDGES: Record<string, Record<string, EdgeKind>> = {
  app: { config: "value", form: "value", http: "value", logging: "value", security: "value" },
  jsx: { http: "value" },
  // Type-only on purpose: `storage/kv → logging` is the runtime edge, so a value import here would
  // close a real cycle.
  logging: { "storage/kv": "type" },
  "logging/show": { "html/htmx": "value", http: "value", jsx: "value", logging: "value", "ui/contracts": "type", "ui/core": "value" },
  security: { logging: "value" },
  "storage/db": { logging: "value" },
  "storage/kv": { logging: "value" },
  testing: { app: "type", form: "value", jsx: "value", logging: "value", "storage/db": "type", "storage/kv": "type", "storage/r2": "value" },
  "tooling/assets": { site: "value", "tooling/cli": "value", "ui/assets/build": "value" },
  "tooling/cf": { "tooling/cli": "value", "tooling/term": "value", site: "value" },
  "tooling/cli": { "tooling/term": "value" },
  // Each fact has one home: the checks judge literals with the real `cn` and share
  // `ui/contracts/theme`'s OKLab conversion. The gate is the lower layer: it owns the changelog
  // and semver parsers and the barrel parser, and `tooling/release` builds its workflow on them.
  "tooling/gate": {
    "tooling/assets": "value",
    "tooling/cli": "value",
    "tooling/lint": "value",
    "tooling/term": "value",
    "ui/contracts/theme": "value",
    "ui/core": "value",
  },
  "tooling/release": { "tooling/cli": "value", "tooling/gate": "value", "tooling/term": "value" },
  // Type-only back to `tooling/assets`: the config shapes these builders read are owned there,
  // while `tooling/assets` names `ui/assets/build` at value — only one direction survives emit.
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
    "ui/chrome": "value",
    "ui/client": "value",
    "ui/contracts": "value",
    "ui/contracts/theme": "value",
    "ui/controls": "value",
    "ui/core": "value",
    "ui/server": "value",
  },
};
