import { defineRules } from "../../define";

export default defineRules([
  {
    id: "code-rules-comment-budget",
    statement:
      "Exactly three forms of comment are allowed in the source tree: one line of TSDoc on an exported symbol, the visibility tags, and a rare inline why of one or two lines.",
    detectors: [{ kind: "step", label: "validate-comment-budget" }],
  },
  {
    id: "code-rules-comment-forbidden",
    statement:
      "Never write multi-paragraph TSDoc, an `@example` block, a restatement of the code, a section banner, commented-out code, narration of the obvious, meta-commentary, a defence of an unobservable choice or a TODO.",
    detectors: [{ kind: "step", label: "validate-comment-budget" }],
  },
  {
    id: "code-rules-field-gloss",
    statement:
      "A field's gloss earns its one line only by adding a default, a unit, a constraint or a caveat, never by spelling the field name back.",
    detectors: [{ kind: "step", label: "validate-comment-budget" }],
  },
  {
    id: "code-rules-module-state",
    statement: "Never store request-scoped data in a module-level variable.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`^(?:export\s+)?(?:let|var)\s`,
        paths: ["src/"],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "src/tooling/**", "src/client/**"],
        level: "warn",
        triage:
          "A browser-only module holds page-scoped state legitimately (§1e), as does a binding written once at startup; one written per request is the defect.",
      },
    ],
  },
  {
    id: "code-rules-factory-verb",
    statement: "Name a factory with the `create` prefix, never `make` or `new`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bexport\s+(?:async\s+)?(?:function|const)\s+(?:make|new)[A-Z]`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        level: "warn",
        triage:
          "A function that instantiates nothing — a predicate or a verb that merely starts with the letters — is fine; a factory so named is the defect.",
      },
    ],
  },
  {
    id: "code-rules-validation-facade",
    statement:
      "All validation goes through the project's validation facade, never the underlying schema library imported directly, in application code, a shared namespace or a test.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "code-rules-directive-reason",
    statement: "A directive's human-readable reason is self-contained, never a pointer to a note elsewhere.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`--\s*see\s+(?:the\s+)?(?:note|comment|above|below)`,
        paths: ["."],
        include: ["*.ts", "*.tsx", "*.js", "*.mjs", "*.css"],
        ignoreCase: true,
        level: "warn",
        triage:
          "A reason citing a governing document by name and section survives alone and is fine; one pointing at a nearby comment is the defect.",
      },
    ],
  },
]);
