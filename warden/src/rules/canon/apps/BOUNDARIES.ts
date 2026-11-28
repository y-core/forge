import { defineRules } from "../../define";

export default defineRules([
  {
    id: "apps-boundaries-log-pii",
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
    id: "apps-boundaries-log-fields",
    statement: "Pass a log record's data as discrete key-value fields, never interpolated into its message string.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(?:log|logger)\.(?:debug|info|warn|error)\(\s*\x60[^\x60]*\$\{`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        exclude: ["*.test.*", "*.browser.*", "*.workerd.*"],
        level: "warn",
        triage: "A build-time script printing progress to a terminal writes no log record; a runtime logger call is the defect.",
      },
    ],
  },
  {
    id: "apps-boundaries-required-false",
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
    id: "apps-boundaries-private-cache",
    statement: "A response whose body depends on who asked is `private` or `no-store`, never `public`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bpublic\s*,\s*(?:s-)?max-age|max-age=\d+\s*,\s*public|["']public["']`,
        paths: ["src/"],
        ignoreCase: true,
        level: "warn",
        triage:
          "A response identical for every reader, such as an asset or a page that reads no session, is correctly `public`; one that reads the session, names the visitor or sets a cookie is the defect.",
      },
    ],
  },
]);
