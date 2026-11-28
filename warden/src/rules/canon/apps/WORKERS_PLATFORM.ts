import { defineRules } from "../../define";

export default defineRules([
  {
    id: "workers-platform-no-hardcoded-secret",
    statement: "Never hardcode an API key, token or credential in a source file.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`sk_(?:live|test)_[0-9A-Za-z]{8,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[0-9A-Za-z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----`,
        paths: ["src/"],
        level: "warn",
        triage: "A fake key in a fixture, or a pattern that matches the shape in order to redact it, is fine; a real credential is the defect.",
      },
    ],
  },
  {
    id: "workers-platform-no-force-deploy",
    statement: "Never use a force flag to skip build or asset validation on a deploy.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"[^"]*deploy[^"]*"\s*:\s*"[^"]*--(?:force|no-verify)\b`,
        paths: ["package.json"],
        level: "warn",
        triage:
          "A flag forcing something other than validation past its check, named so in the script, may stand; one skipping build or asset validation is the defect.",
      },
    ],
  },
  {
    id: "workers-platform-no-public-file-route",
    statement: "Never add a route that reads and returns a file from the public directory.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`ASSETS\.fetch\(|["'](?:\./|/)?public/`,
        paths: ["src/"],
        level: "warn",
        triage:
          "Forwarding the incoming request unchanged to the asset binding, as a not-found fallback does, is fine; building a path from the request is the defect.",
      },
    ],
  },
]);
