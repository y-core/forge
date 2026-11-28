import { defineRules } from "../../define";

export default defineRules([
  {
    id: "config-baseline-no-local-type-aware-lint",
    statement: "An application never adds `typeAwareLintStep` to its own step table.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\btypeAwareLintStep\b`,
        paths: ["config/"],
        level: "warn",
        triage: "A comment naming the step is harmless; a call adds a second `lint:types` row the gate refuses.",
      },
    ],
  },
  {
    id: "config-baseline-config-dir-scope",
    statement:
      "`config/` holds only the entry points a tool loads, the plain modules they import and the state a tool writes there, never a test, a script or a subdirectory no tool writes.",
    detectors: [{ kind: "step", label: "validate-config-files" }],
  },
]);
