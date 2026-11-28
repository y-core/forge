import { defineRules } from "../../define";

export default defineRules([
  {
    id: "library-architecture-facade-import",
    statement: "Consumers import a wrapped dependency from a library subpath, never from the wrapped package directly.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "library-architecture-no-namespace-reexport",
    statement: "A facade never re-exports the entire third-party namespace.",
    detectors: [{ kind: "step", label: "validate-exports" }],
  },
  {
    id: "library-architecture-no-node-modules-path",
    statement: "Never import a path into `node_modules` directly from application code.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["'][^"']*node_modules/`,
        paths: ["."],
        include: ["*.ts", "*.tsx", "*.js", "*.mjs"],
        level: "warn",
        triage: "A hit inside a string that documents the mistake is fine; an import that resolves through the path is the defect.",
      },
    ],
  },
  {
    id: "library-architecture-web-apis-only",
    statement: "A runtime source file never reaches `process.env`, `require()`, a runtime-specific global or a Node.js built-in.",
    detectors: [
      { kind: "lint", key: "eslint/no-restricted-globals" },
      { kind: "lint", key: "eslint/no-restricted-imports" },
      {
        kind: "rg",
        pattern: String.raw`from\s+["']node:|\brequire\(|\bprocess\.env\b`,
        paths: ["src/"],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.fixture.*", "src/tooling/**"],
        level: "warn",
        triage: "A build-time module no Worker-executed entry point reaches is exempt (§1e); one a Worker executes is the defect.",
      },
    ],
  },
  {
    id: "library-architecture-declared-edge",
    statement: "Never add an import across namespaces that the declared dependency graph does not hold.",
    detectors: [{ kind: "step", label: "validate-namespace-graph" }],
  },
]);
