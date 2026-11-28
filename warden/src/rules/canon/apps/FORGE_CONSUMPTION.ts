import { defineRules } from "../../define";

export default defineRules([
  {
    id: "forge-consumption-internal-path",
    statement: "Never import from a library-internal path.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`from\s+["']@y-core/forge/src/`,
        paths: ["."],
        include: ["*.ts", "*.tsx"],
        level: "warn",
        triage: "A hit inside a string that documents the mistake is fine; an import that resolves through the path is the defect.",
      },
    ],
  },
  {
    id: "forge-consumption-no-codeload",
    statement: "Never pin the library to a `codeload.github.com` URL.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`codeload\.github\.com`,
        paths: ["package.json", "bun.lock"],
        level: "warn",
        triage: "A lock entry for an unrelated package fetched that way is outside this rule; the library's own entry so pinned is the defect.",
      },
    ],
  },
]);
