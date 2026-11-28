import { defineRules } from "../../define";

export default defineRules([
  {
    id: "libs-boundaries-log-pii",
    statement: "A log record never contains user-identifiable or credential data, on any channel.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(?:log|logger)\.(?:debug|info|warn|error)\(.*\b(?:email|password|token|secret|ip)\s*:`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.workerd.*"],
        level: "warn",
        triage:
          "A field carrying a hash, a boolean or a redacted form of the value is fine; one carrying the raw address, credential or IP is the defect.",
      },
    ],
  },
  {
    id: "libs-boundaries-log-fields",
    statement: "Pass a log record's data as discrete key-value fields, never interpolated into its message string.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(?:log|logger)\.(?:debug|info|warn|error)\(\s*\x60[^\x60]*\$\{`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.workerd.*"],
        level: "warn",
        triage: "A build-time command printing progress to a terminal writes no log record; a runtime logger call is the defect.",
      },
    ],
  },
  {
    id: "libs-boundaries-required-false",
    statement: "CSRF verification, authentication middleware, origin and Referer checks and signature validation never take `required: false`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`required:\s*false\s*[,}]`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.workerd.*"],
        level: "warn",
        triage:
          "A resolver for a non-security feature, such as a log store, takes it legitimately; one feeding CSRF, authentication, origin or signature verification is the defect.",
      },
    ],
  },
  {
    id: "libs-boundaries-client-import",
    statement: "Only a client entry point imports a browser-only module from outside the client directory, and a `.tsx` file never does.",
    detectors: [{ kind: "step", label: "validate-ssr-boundary" }],
  },
]);
