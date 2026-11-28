import { defineRules } from "../../define";

export default defineRules([
  {
    id: "namespace-design-named-exports",
    statement: "A barrel uses named exports only, never a star re-export.",
    detectors: [{ kind: "step", label: "validate-exports" }],
  },
  {
    id: "namespace-design-sealed-barrel",
    statement: "A barrel with no export subpath is declared on the gate's sealed-internal allowlist.",
    detectors: [{ kind: "step", label: "validate-exports" }],
  },
  {
    id: "namespace-design-behaviour-suffix",
    statement:
      "A type of behaviour knobs takes the `Options` suffix, never `Config` or `Definition`, and a declarative shape never takes `Config`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bcreate\w*\([^)]*:\s*\w+(?:Config|Definition)\b`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        level: "warn",
        triage:
          "A factory whose parameter is validated data, such as a resolved env shape, is correctly `Config`; one taking behaviour knobs so named is the defect.",
      },
    ],
  },
  {
    id: "namespace-design-type-edge",
    statement: "A type-only import across namespaces is declared in the graph as an edge of kind `type`.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "namespace-design-closed-primitives",
    statement: "A foundational primitive never imports a namespace outside the primitive set.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
  {
    id: "namespace-design-subpath-namespace",
    statement: "Classify a namespace by its published subpath, never by its directory.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
]);
