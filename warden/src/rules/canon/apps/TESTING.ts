import { defineRules } from "../../define";

export default defineRules([
  {
    id: "apps-testing-exact-header-status",
    statement: "Assert a security header and an HTTP status with exact equality, never a substring match or a range comparison.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`headers\.get\([^)]*\)\)\.(?:not\.)?(?:toContain|toMatch)\(|\.status\)\.(?:not\.)?(?:toBeGreaterThan|toBeLessThan)`,
        paths: ["."],
        include: ["*.test.ts", "*.test.tsx"],
        level: "warn",
        triage:
          "A header whose value is not deterministic, such as one carrying a nonce or a date, may be matched by pattern; a security header or a status is the defect.",
      },
    ],
  },
  {
    id: "apps-testing-no-mock-library",
    statement: "Never install or add a mock library.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"(?:sinon|testdouble|jest-mock|ts-mockito|@sinonjs/[^"]+)"`,
        paths: ["package.json"],
        level: "warn",
        triage: "A hit only names the package in a script or a comment; a dependency entry is the defect.",
      },
    ],
  },
  {
    id: "apps-testing-split-not-dropped",
    statement: "A heavy test inside `unit` is split out into a scheduled row of its own, never deleted, skipped or ignored.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\b(?:it|test|describe)\.skip\(|#\[ignore\]`,
        paths: ["."],
        include: ["*.test.ts", "*.test.tsx", "*.spec.ts", "*.rs"],
        level: "warn",
        triage:
          "A skip on one browser engine, written as the case's first line and naming its task, is the sanctioned form; an unconditional skip drops the test from every run.",
      },
    ],
  },
  {
    id: "apps-testing-origin-spelling",
    statement: "A browser run spells its origin to match the bind address, `127.0.0.1`, never `localhost`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\blocalhost\b`,
        paths: ["playwright.config.ts", "tests/"],
        level: "warn",
        triage: "A hit that is no origin a browser run sends, such as a comment or a log line, is fine.",
      },
    ],
  },
  {
    id: "apps-testing-port-in-runner",
    statement: "A browser run's port override lives in the browser runner's config, never in the Worker config.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"port"\s*:|^\s*port\s*=`,
        paths: ["wrangler.jsonc", "wrangler.json", "wrangler.toml"],
        level: "warn",
        triage: "A port outside the `dev` block, such as a container's, is fine; a `dev` port is the override in the wrong file.",
      },
    ],
  },
  {
    id: "apps-testing-ephemeral-port",
    statement: "A server a spec starts per run takes an ephemeral port, never a number.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bport:\s*\d+`,
        paths: ["playwright.config.ts"],
        level: "warn",
        triage: "A fixed port on a server a human starts or attaches to is legitimate; one on a server the run starts is the defect.",
      },
    ],
  },
  {
    id: "apps-testing-no-retries",
    statement: "A browser run takes no retries.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`\bretries:\s*[1-9]`,
        paths: ["playwright.config.ts"],
        level: "warn",
        triage: "A hit in a comment is fine; any configured retry count above zero is the defect.",
      },
    ],
  },
]);
